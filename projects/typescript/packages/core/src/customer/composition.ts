import { canonicalJson } from '#core/data/canonical-json';
import type { CustomerCatalog, CustomerQuality } from '#core/data/customer';
import type {
    ComposedCustomerRecommendation,
    CustomerFinishedInventoryEntry,
    CustomerRecommendationCandidateDecision,
    CustomerRecommendationCompositionEvidence,
    CustomerRecommendationCompositionInput,
    CustomerRecommendationCompositionReason,
    CustomerRecommendationCompositionResult,
    CustomerRecommendationFulfillment,
    CustomerRecommendationProductionEvidence,
    CustomerRecommendationProductionMissingFact,
    CustomerRecommendationProductionPlan,
} from '#core/customer/composition-types';
import {
    CustomerOfferEvaluator,
    type CustomerOfferState,
} from '#core/customer/offer';
import {
    compareCustomerRecommendations,
    customerMarketRelativePrice,
    type CustomerRecommendation,
    type CustomerRecommendationCandidate,
} from '#core/customer/recommendation';
import type { RecipeEvaluation } from '#core/mixing/recipe';

export * from '#core/customer/composition-types';

interface IndexedCandidate {
    readonly key: string;
    readonly candidate: CustomerRecommendationCandidate;
}

const productionMissingFacts = new Set([
    'mixing-station',
    'production-equipment-selection',
    'inventory',
    'equipment-purchase-price',
]);

export class CustomerRecommendationComposer {
    readonly #offers: CustomerOfferEvaluator;
    readonly #maximumQuantity: number;

    constructor(catalog: Pick<CustomerCatalog, 'constants' | 'qualityTiers'>) {
        this.#offers = new CustomerOfferEvaluator(catalog);
        this.#maximumQuantity = catalog.constants.maximumOrderQuantityPerProduct;
        requirePositiveSafeInteger(this.#maximumQuantity, 'maximum customer order quantity');
    }

    compose(input: CustomerRecommendationCompositionInput): CustomerRecommendationCompositionResult {
        requireId(input.customer.id, 'Customer');
        if (input.eligibility.customerId !== input.customer.id) {
            throw new Error('Customer eligibility does not belong to the requested customer');
        }
        if (!['eligible', 'ineligible', 'unknown'].includes(input.eligibility.status)) {
            throw new Error('Customer eligibility status is invalid');
        }
        validateRequest(input, this.#maximumQuantity);
        const candidates = indexCandidates(input.candidates, input.quality);
        if (input.eligibility.status !== 'eligible') {
            const ineligible = input.eligibility.status === 'ineligible';
            const decisions = candidates.map(({ candidate }) => ineligible
                ? unavailableDecision(candidate.recipe, input.quality, [{
                      code: 'customer-ineligible',
                  }])
                : unknownDecision(candidate.recipe, input.quality, [{
                      code: 'customer-eligibility-unknown',
                  }])
            );
            return result(
                input,
                candidates,
                decisions,
                [],
                ineligible ? 'ineligible' : 'unknown',
                []
            );
        }
        if (input.eligibility.currentRelationship === null) {
            throw new Error('Eligible customer has no current relationship');
        }

        const missingFacts = globalMissingFacts(input);
        if (missingFacts.length > 0) {
            const reasons = missingFacts.map(missingFactReason);
            const decisions = candidates.map(({ candidate }) => unknownDecision(
                candidate.recipe,
                input.quality,
                reasons
            ));
            return result(input, candidates, decisions, [], 'unknown', missingFacts);
        }

        if (
            input.addiction === undefined ||
            input.orderLimitMultiplier === undefined ||
            input.finishedInventory === undefined
        ) {
            throw new Error('Customer recommendation live facts were not resolved');
        }

        const inventory = indexInventory(input.finishedInventory, candidates);
        const production = input.productionPlans === undefined
            ? undefined
            : indexProduction(input.productionPlans, candidates, input.dataset);
        const offerState: CustomerOfferState = {
            addiction: input.addiction,
            relationship: input.eligibility.currentRelationship,
            orderLimitMultiplier: input.orderLimitMultiplier,
        };
        const decisions: CustomerRecommendationCandidateDecision[] = [];
        const available: ComposedCustomerRecommendation[] = [];

        for (const indexed of candidates) {
            const resolved = this.#candidate(input, offerState, indexed, inventory, production);
            decisions.push(resolved);
            if (resolved.status === 'available') {
                available.push(resolved.composed);
            }
        }

        const recommendations = available
            .sort((left, right) => compareCustomerRecommendations(
                left.recommendation,
                right.recommendation
            ))
            .slice(0, input.limit);
        const unknownCount = decisions.filter(({ status }) => status === 'unknown').length;
        return result(
            input,
            candidates,
            decisions,
            recommendations,
            unknownCount === 0 ? 'resolved' : recommendations.length === 0 ? 'unknown' : 'partial',
            []
        );
    }

    #candidate(
        input: CustomerRecommendationCompositionInput,
        offerState: CustomerOfferState,
        indexed: IndexedCandidate,
        inventory: ReadonlyMap<string, CustomerFinishedInventoryEntry>,
        production: ReadonlyMap<string, CustomerRecommendationProductionPlan> | undefined
    ): CustomerRecommendationCandidateDecision {
        const { candidate, key } = indexed;
        const finishedInventoryQuantity = inventory.get(key)?.quantity ?? 0;
        const finishedInventoryQuantityUsed = Math.min(finishedInventoryQuantity, input.quantity);
        const finishedInventoryEstimatedMaterialCost =
            candidate.recipe.totalCost * finishedInventoryQuantityUsed;
        const productionQuantity = input.quantity - finishedInventoryQuantityUsed;
        let productionEvidence: CustomerRecommendationProductionEvidence | null = null;
        let productionCost = finishedInventoryEstimatedMaterialCost;

        if (productionQuantity > 0) {
            if (production === undefined) {
                return unknownDecision(candidate.recipe, input.quality, [{
                    code: 'missing-production-plans',
                }]);
            }
            const selected = production.get(key);
            if (selected === undefined) {
                return unavailableDecision(candidate.recipe, input.quality, [{
                    code: 'production-not-supported',
                }]);
            }
            assertSameRecipe(candidate.recipe, selected.plan.recipe, 'Production plan');
            if (selected.plan.finishedQuantity !== productionQuantity) {
                throw new Error(
                    `Production plan for ${JSON.stringify(candidate.recipe.productId)} ` +
                    'must produce the exact finished shortfall'
                );
            }
            validateProductionPlan(selected.plan);
            const planMissingFacts: CustomerRecommendationProductionMissingFact[] = [
                ...selected.plan.evidence.missingFacts,
            ];
            const modeledProcessMinutes = selected.plan.duration.modeledTotalProcessMinutes;
            const additionalReorderCost = selected.plan.cost.combinedReorderCost;
            if (selected.plan.evidence.modeledDurationProof !== 'complete') {
                planMissingFacts.push('complete-duration-proof');
            }
            if (modeledProcessMinutes === null) {
                planMissingFacts.push('modeled-process-minutes');
            }
            if (additionalReorderCost === null) {
                planMissingFacts.push('combined-reorder-cost');
            }
            if (planMissingFacts.length > 0) {
                return unknownDecision(candidate.recipe, input.quality, [{
                    code: 'incomplete-production-plan',
                    missingFacts: planMissingFacts,
                }]);
            }
            if (modeledProcessMinutes === null || additionalReorderCost === null) {
                throw new Error('Complete production plan is missing required values');
            }
            productionCost += selected.plan.cost.requiredMaterialCost;
            productionEvidence = {
                requiredMaterialCost: selected.plan.cost.requiredMaterialCost,
                additionalReorderCost,
                modeledProcessMinutes,
                modeledDurationProof: 'complete',
                finishedLifecycleProof: selected.plan.evidence.finishedLifecycleProof,
            };
        }

        requireNonNegativeFinite(productionCost, 'Composed customer recommendation production cost');
        if (productionCost > input.maximumProductionCost) {
            return unavailableDecision(candidate.recipe, input.quality, [{
                code: 'production-cost-limit',
                productionCost,
                maximumProductionCost: input.maximumProductionCost,
            }]);
        }
        const productionMinutes = productionEvidence?.modeledProcessMinutes ?? 0;
        if (
            input.maximumProductionMinutes !== undefined &&
            productionMinutes > input.maximumProductionMinutes
        ) {
            return unavailableDecision(candidate.recipe, input.quality, [{
                code: 'production-time-limit',
                productionMinutes,
                maximumProductionMinutes: input.maximumProductionMinutes,
            }]);
        }

        const askingPrice = customerMarketRelativePrice(
            candidate.recipe.productValue,
            input.quantity,
            input.priceMultiplier
        );
        const acceptanceChance = this.#offers.evaluate(
            input.customer,
            {
                drugTypes: candidate.drugTypes,
                effectIds: candidate.recipe.effectIds,
                marketValue: candidate.recipe.productValue,
            },
            offerState,
            {
                quality: input.quality,
                quantity: input.quantity,
                askingPrice,
            }
        );
        const grossProfit = askingPrice - productionCost;
        const recommendation: CustomerRecommendation = {
            ...candidate,
            quality: input.quality,
            quantity: input.quantity,
            askingPrice,
            productionCost,
            grossProfit,
            acceptanceChance,
            expectedRevenue: acceptanceChance * askingPrice,
            expectedProfit: acceptanceChance * grossProfit,
        };
        const fulfillment: CustomerRecommendationFulfillment = {
            source: productionQuantity === 0
                ? 'finished-inventory'
                : finishedInventoryQuantityUsed === 0
                  ? 'production'
                  : 'finished-inventory-and-production',
            finishedInventoryQuantity,
            finishedInventoryQuantityUsed,
            finishedInventoryEstimatedMaterialCost,
            productionQuantity,
            production: productionEvidence,
        };
        return {
            recipe: candidate.recipe,
            quality: input.quality,
            status: 'available',
            reasons: [],
            composed: { recommendation, fulfillment },
        };
    }
}

function result(
    input: CustomerRecommendationCompositionInput,
    indexed: readonly IndexedCandidate[],
    decisions: readonly CustomerRecommendationCandidateDecision[],
    recommendations: readonly ComposedCustomerRecommendation[],
    status: CustomerRecommendationCompositionEvidence['status'],
    missingFacts: CustomerRecommendationCompositionEvidence['missingFacts']
): CustomerRecommendationCompositionResult {
    return {
        customerId: input.customer.id,
        eligibility: input.eligibility,
        recommendations,
        candidates: decisions,
        evidence: {
            status,
            dataset: { ...input.dataset },
            eligibilityStatus: input.eligibility.status,
            missingFacts,
            candidateCount: indexed.length,
            availableCandidateCount: decisions.filter(
                ({ status: value }) => value === 'available'
            ).length,
            unavailableCandidateCount: decisions.filter(
                ({ status: value }) => value === 'unavailable'
            ).length,
            unknownCandidateCount: decisions.filter(
                ({ status: value }) => value === 'unknown'
            ).length,
        },
    };
}

function indexCandidates(
    input: Iterable<CustomerRecommendationCandidate>,
    quality: CustomerQuality
): IndexedCandidate[] {
    const result = new Map<string, CustomerRecommendationCandidate>();
    for (const candidate of input) {
        const key = recipeKey(candidate.recipe, quality);
        if (result.has(key)) {
            throw new Error(`Duplicate customer recommendation candidate ${JSON.stringify(key)}`);
        }
        requirePositiveFinite(candidate.recipe.productValue, 'Recipe product value');
        requireNonNegativeFinite(candidate.recipe.totalCost, 'Recipe total cost');
        result.set(key, candidate);
    }
    return [...result]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, candidate]) => ({ key, candidate }));
}

function indexInventory(
    entries: readonly CustomerFinishedInventoryEntry[],
    candidates: readonly IndexedCandidate[]
): ReadonlyMap<string, CustomerFinishedInventoryEntry> {
    const known = new Map(candidates.map((entry) => [entry.key, entry.candidate]));
    const result = new Map<string, CustomerFinishedInventoryEntry>();
    for (const entry of entries) {
        requireNonNegativeSafeInteger(entry.quantity, 'Finished inventory quantity');
        const key = recipeKey(entry.recipe, entry.quality);
        const candidate = known.get(key);
        if (candidate === undefined) {
            throw new Error(`Unknown finished inventory recipe ${JSON.stringify(key)}`);
        }
        assertSameRecipe(candidate.recipe, entry.recipe, 'Finished inventory');
        if (result.has(key)) {
            throw new Error(`Duplicate finished inventory recipe ${JSON.stringify(key)}`);
        }
        result.set(key, entry);
    }
    return result;
}

function indexProduction(
    entries: readonly CustomerRecommendationProductionPlan[],
    candidates: readonly IndexedCandidate[],
    dataset: CustomerRecommendationCompositionInput['dataset']
): ReadonlyMap<string, CustomerRecommendationProductionPlan> {
    const known = new Map(candidates.map((entry) => [entry.key, entry.candidate]));
    const result = new Map<string, CustomerRecommendationProductionPlan>();
    for (const entry of entries) {
        if (
            entry.plan.dataset.gameVersion !== dataset.gameVersion ||
            entry.plan.dataset.datasetSha256 !== dataset.datasetSha256
        ) {
            throw new Error('Customer recommendation production plan belongs to a different dataset');
        }
        const key = recipeKey(entry.plan.recipe, entry.quality);
        const candidate = known.get(key);
        if (candidate === undefined) {
            throw new Error(`Unknown customer recommendation production plan ${JSON.stringify(key)}`);
        }
        assertSameRecipe(candidate.recipe, entry.plan.recipe, 'Production plan');
        if (result.has(key)) {
            throw new Error(`Duplicate customer recommendation production plan ${JSON.stringify(key)}`);
        }
        result.set(key, entry);
    }
    return result;
}

function validateRequest(
    input: CustomerRecommendationCompositionInput,
    maximumQuantity: number
): void {
    requireId(input.dataset.gameVersion, 'Customer recommendation dataset game version');
    if (!/^[a-f0-9]{64}$/u.test(input.dataset.datasetSha256)) {
        throw new Error('Customer recommendation dataset identity must be a lowercase SHA-256');
    }
    requirePositiveSafeInteger(input.quantity, 'Customer recommendation quantity');
    if (input.quantity > maximumQuantity) {
        throw new Error(`Customer recommendation quantity cannot exceed ${maximumQuantity}`);
    }
    requireNonNegativeFinite(input.priceMultiplier, 'Customer recommendation price multiplier');
    requireNonNegativeFinite(
        input.maximumProductionCost,
        'Customer recommendation production-cost ceiling'
    );
    if (input.maximumProductionMinutes !== undefined) {
        requireNonNegativeFinite(
            input.maximumProductionMinutes,
            'Customer recommendation production-time ceiling'
        );
    }
    requirePositiveSafeInteger(input.limit, 'Customer recommendation limit');
    if (input.addiction !== undefined && (
        !Number.isFinite(input.addiction) || input.addiction < 0 || input.addiction > 1
    )) {
        throw new Error('Customer addiction must be between zero and one');
    }
    if (input.orderLimitMultiplier !== undefined && (
        !Number.isFinite(input.orderLimitMultiplier) || input.orderLimitMultiplier <= 0
    )) {
        throw new Error('Customer order limit multiplier must be positive');
    }
}

function validateProductionPlan(
    plan: CustomerRecommendationProductionPlan['plan']
): void {
    requirePositiveSafeInteger(plan.finishedQuantity, 'Production plan finished quantity');
    requireNonNegativeFinite(plan.cost.requiredMaterialCost, 'Production required material cost');
    if (plan.cost.combinedReorderCost !== null) {
        requireNonNegativeFinite(plan.cost.combinedReorderCost, 'Production combined reorder cost');
    }
    if (plan.duration.modeledTotalProcessMinutes !== null) {
        requireNonNegativeFinite(
            plan.duration.modeledTotalProcessMinutes,
            'Production modeled process minutes'
        );
    }
    if (
        plan.evidence.modeledDurationProof !== 'complete' &&
        plan.evidence.modeledDurationProof !== 'partial'
    ) {
        throw new Error('Production modeled duration proof is invalid');
    }
    if (plan.evidence.finishedLifecycleProof !== 'partial') {
        throw new Error('Production finished lifecycle proof is invalid');
    }
    const seen = new Set<string>();
    for (const fact of plan.evidence.missingFacts) {
        if (!productionMissingFacts.has(fact)) {
            throw new Error(`Unknown production missing fact ${JSON.stringify(fact)}`);
        }
        if (seen.has(fact)) {
            throw new Error(`Duplicate production missing fact ${JSON.stringify(fact)}`);
        }
        seen.add(fact);
    }
}

function globalMissingFacts(
    input: CustomerRecommendationCompositionInput
): CustomerRecommendationCompositionEvidence['missingFacts'] {
    const result: CustomerRecommendationCompositionEvidence['missingFacts'][number][] = [];
    if (input.addiction === undefined) result.push('current-addiction');
    if (input.orderLimitMultiplier === undefined) result.push('order-limit-multiplier');
    if (input.finishedInventory === undefined) result.push('finished-inventory');
    return result;
}

function missingFactReason(
    fact: CustomerRecommendationCompositionEvidence['missingFacts'][number]
): CustomerRecommendationCompositionReason {
    switch (fact) {
        case 'current-addiction':
            return { code: 'missing-current-addiction' };
        case 'order-limit-multiplier':
            return { code: 'missing-order-limit-multiplier' };
        case 'finished-inventory':
            return { code: 'missing-finished-inventory' };
    }
}

function unknownDecision(
    recipe: RecipeEvaluation,
    quality: CustomerQuality,
    reasons: readonly CustomerRecommendationCompositionReason[]
): CustomerRecommendationCandidateDecision {
    return { recipe, quality, status: 'unknown', reasons, composed: null };
}

function unavailableDecision(
    recipe: RecipeEvaluation,
    quality: CustomerQuality,
    reasons: readonly CustomerRecommendationCompositionReason[]
): CustomerRecommendationCandidateDecision {
    return { recipe, quality, status: 'unavailable', reasons, composed: null };
}

function recipeKey(recipe: RecipeEvaluation, quality: CustomerQuality): string {
    return canonicalJson({
        ruleProfile: recipe.ruleProfile,
        productId: recipe.productId,
        ingredientIds: recipe.ingredientIds,
        quality,
    });
}

function assertSameRecipe(
    expected: RecipeEvaluation,
    actual: RecipeEvaluation,
    label: string
): void {
    if (canonicalJson(expected) !== canonicalJson(actual)) {
        throw new Error(`${label} recipe evaluation does not match its recommendation candidate`);
    }
}

function requireId(value: string, label: string): void {
    if (value.trim().length === 0) throw new Error(`${label} ID must not be blank`);
}

function requirePositiveFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`);
}

function requireNonNegativeFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative`);
}

function requirePositiveSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${label} must be a positive safe integer`);
    }
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${label} must be a non-negative safe integer`);
    }
}
