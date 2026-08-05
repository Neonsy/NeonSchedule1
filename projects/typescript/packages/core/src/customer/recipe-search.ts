import {
    customerMarketRelativePrice,
    CustomerRecommendationRanker,
    type CustomerRecommendation,
    type CustomerRecommendationCandidate,
    type CustomerRecommendationInput,
} from '#core/customer/recommendation';
import { CustomerOfferEvaluator } from '#core/customer/offer';
import { CustomerProfitBound } from '#core/customer/recipe-bound';
import type {
    CustomerCatalog,
    CustomerDrugType,
    CustomerQuality,
} from '#core/data/customer';
import type { Item, Product } from '#core/data/item';
import { FinalEffectConstraints } from '#core/mixing/effect-constraints';
import type { MixingEngine } from '#core/mixing/engine';
import {
    RecipeEvaluator,
    type RecipeEvaluation,
} from '#core/mixing/recipe';
import {
    exactSearchEvidence,
    RecipeSearchLimitError,
    RecipeSearchWorkLimitError,
    type RecipeSearchEvidence,
} from '#core/mixing/search-evidence';
import { RecipeSearchWorkBudget } from '#core/mixing/search-work';
import type { ProductionMaterialCostResolver } from '#core/production/cost';

const defaultMaxStates = 100_000;

export interface CustomerRecipeSearchInput {
    readonly productIds: readonly string[];
    readonly availableIngredientIds: readonly string[];
    readonly maxIngredients: number;
    readonly requiredEffectIds?: readonly string[];
    readonly forbiddenEffectIds?: readonly string[];
    readonly profile: CustomerRecommendationInput['profile'];
    readonly state: CustomerRecommendationInput['state'];
    readonly quality: CustomerQuality;
    readonly quantity: number;
    readonly priceMultiplier: number;
    readonly maximumProductionCost: number;
    readonly limit: number;
}

export interface CustomerRecipeSearchOptions {
    readonly maxStates?: number;
    readonly maxTransitionEvaluations?: number;
    readonly productionCosts?: ProductionMaterialCostResolver;
}

export interface CustomerRecipeSearchResult {
    readonly recommendations: readonly CustomerRecommendation[];
    readonly evidence: RecipeSearchEvidence;
}

interface IngredientAction {
    readonly id: string;
    readonly effectId: string;
    readonly cost: number;
}

interface SearchState {
    readonly effectIds: readonly string[];
    readonly ingredientIds: readonly string[];
    readonly ingredientCost: number;
}

interface SearchMetrics {
    exploredStates: number;
    prunedStates: number;
    transitionEvaluations: number;
    boundTransitionEvaluations: number;
}

interface SearchProduct extends Product {
    readonly customerDrugType: CustomerDrugType;
    readonly baseProductCost: number;
}

export class CustomerRecipeSearch {
    readonly #engine: MixingEngine;
    readonly #itemsById: ReadonlyMap<string, Item>;
    readonly #recipes: RecipeEvaluator;
    readonly #recommendations: CustomerRecommendationRanker;
    readonly #offers: CustomerOfferEvaluator;
    readonly #maxStates: number;
    readonly #maxTransitionEvaluations: number | undefined;

    constructor(
        engine: MixingEngine,
        itemsById: ReadonlyMap<string, Item>,
        catalog: Pick<CustomerCatalog, 'constants' | 'qualityTiers'>,
        options: CustomerRecipeSearchOptions = {}
    ) {
        this.#engine = engine;
        this.#itemsById = itemsById;
        this.#recipes = new RecipeEvaluator(engine, itemsById, options);
        this.#recommendations = new CustomerRecommendationRanker(catalog);
        this.#offers = new CustomerOfferEvaluator(catalog);
        this.#maxStates = options.maxStates ?? defaultMaxStates;
        this.#maxTransitionEvaluations = options.maxTransitionEvaluations;
        requirePositiveSafeInteger(this.#maxStates, 'maxStates');
        if (this.#maxTransitionEvaluations !== undefined) {
            requirePositiveSafeInteger(
                this.#maxTransitionEvaluations,
                'maxTransitionEvaluations'
            );
        }
    }

    search(input: CustomerRecipeSearchInput): CustomerRecipeSearchResult {
        requireNonNegativeSafeInteger(input.maxIngredients, 'maxIngredients');
        this.#rank(input, []);

        const actions = this.#ingredients(input.availableIngredientIds);
        const constraints = new FinalEffectConstraints(
            this.#engine,
            input.requiredEffectIds ?? [],
            input.forbiddenEffectIds ?? []
        );
        const seenProductIds = new Set<string>();
        const metrics: SearchMetrics = {
            exploredStates: 0,
            prunedStates: 0,
            transitionEvaluations: 0,
            boundTransitionEvaluations: 0,
        };
        let topCandidates: CustomerRecommendationCandidate[] = [];
        let topRecommendations: CustomerRecommendation[] = [];

        const consider = (candidates: readonly CustomerRecommendationCandidate[]): void => {
            if (candidates.length === 0) return;
            const merged = new Map(
                topCandidates.map((candidate) => [candidateKey(candidate), candidate])
            );
            for (const candidate of candidates) merged.set(candidateKey(candidate), candidate);
            topRecommendations = this.#rank(input, [...merged.values()]);
            topCandidates = topRecommendations.map(({ recipe, drugTypes }) => ({
                recipe,
                drugTypes,
            }));
        };
        const cutoff = (): number | null =>
            topRecommendations.length < input.limit
                ? null
                : topRecommendations[topRecommendations.length - 1]!.expectedProfit;

        for (const productId of input.productIds) {
            if (seenProductIds.has(productId)) {
                throw new Error(
                    `Duplicate customer recommendation product ${JSON.stringify(productId)}`
                );
            }
            seenProductIds.add(productId);
            this.#searchProduct(input, productId, actions, constraints, consider, cutoff, metrics);
        }

        return {
            recommendations: topRecommendations,
            evidence: exactSearchEvidence(
                metrics.exploredStates,
                metrics.prunedStates,
                input.maxIngredients,
                metrics
            ),
        };
    }

    #searchProduct(
        input: CustomerRecipeSearchInput,
        productId: string,
        actions: readonly IngredientAction[],
        constraints: FinalEffectConstraints,
        consider: (candidates: readonly CustomerRecommendationCandidate[]) => void,
        cutoff: () => number | null,
        metrics: SearchMetrics
    ): void {
        const baseRecipe = this.#recipes.evaluate({ productId, ingredientIds: [] });
        const product = this.#product(productId, baseRecipe);
        const acceptanceUpper = this.#offers.evaluate(
            input.profile,
            {
                drugTypes: [product.customerDrugType],
                effectIds: input.profile.preferredEffectIds,
                marketValue: Math.max(1, product.basePrice),
            },
            input.state,
            { quality: input.quality, quantity: input.quantity, askingPrice: 0 }
        );
        let currentDepth = 0;
        let productExploredStates = 1;
        const workBudget = new RecipeSearchWorkBudget(
            this.#maxTransitionEvaluations,
            metrics,
            (maximum) => new RecipeSearchWorkLimitError(
                currentDepth,
                maximum,
                metrics.exploredStates,
                metrics.prunedStates,
                metrics
            )
        );
        const bound = new CustomerProfitBound(
            this.#engine,
            product,
            actions,
            input.quantity,
            input.priceMultiplier,
            acceptanceUpper,
            workBudget
        );
        const base: SearchState = {
            effectIds: baseRecipe.effectIds,
            ingredientIds: [],
            ingredientCost: 0,
        };
        metrics.exploredStates++;
        let layer = new Map([[stateKey(base.effectIds), base]]);
        const outcomes = new Map(layer);
        if (constraints.matches(base.effectIds)) {
            consider([candidate(baseRecipe, product.customerDrugType)]);
        }

        for (let depth = 1; depth <= input.maxIngredients && layer.size > 0; depth++) {
            currentDepth = depth;
            const remainingIngredients = input.maxIngredients - depth + 1;
            const rankedStates = [...layer.values()]
                .map((state) => ({
                    state,
                    upperExpectedProfit: this.#subtreeUpper(
                        input,
                        product,
                        state,
                        actions,
                        constraints,
                        bound,
                        remainingIngredients,
                        workBudget
                    ),
                }))
                .sort(
                    (left, right) =>
                        right.upperExpectedProfit - left.upperExpectedProfit ||
                        compareStrings(left.state.effectIds, right.state.effectIds)
                );
            const next = new Map<string, SearchState>();
            for (const ranked of rankedStates) {
                if (ranked.upperExpectedProfit === Number.NEGATIVE_INFINITY) {
                    metrics.prunedStates++;
                    continue;
                }
                const currentCutoff = cutoff();
                if (
                    currentCutoff !== null &&
                    ranked.upperExpectedProfit < currentCutoff
                ) {
                    metrics.prunedStates++;
                    continue;
                }

                for (const action of actions) {
                    workBudget.transition();
                    const candidateState: SearchState = {
                        effectIds: this.#engine.mixEffectIds(
                            product.drugType,
                            ranked.state.effectIds,
                            action.effectId
                        ),
                        ingredientIds: [...ranked.state.ingredientIds, action.id],
                        ingredientCost: ranked.state.ingredientCost + action.cost,
                    };
                    const key = stateKey(candidateState.effectIds);
                    const prior = outcomes.get(key);
                    if (prior !== undefined && comparePaths(prior, candidateState) <= 0) {
                        metrics.prunedStates++;
                        continue;
                    }
                    const current = next.get(key);
                    if (current !== undefined && comparePaths(current, candidateState) <= 0) {
                        metrics.prunedStates++;
                        continue;
                    }
                    const candidateUpper = this.#subtreeUpper(
                        input,
                        product,
                        candidateState,
                        actions,
                        constraints,
                        bound,
                        remainingIngredients - 1,
                        workBudget
                    );
                    const candidateCutoff = cutoff();
                    if (
                        candidateUpper === Number.NEGATIVE_INFINITY ||
                        (candidateCutoff !== null && candidateUpper < candidateCutoff)
                    ) {
                        metrics.prunedStates++;
                        continue;
                    }
                    if (
                        current === undefined &&
                        productExploredStates + next.size >= this.#maxStates
                    ) {
                        throw new RecipeSearchLimitError(
                            depth,
                            this.#maxStates,
                            metrics.exploredStates + next.size,
                            metrics.prunedStates,
                            metrics
                        );
                    }
                    if (current !== undefined) metrics.prunedStates++;
                    next.set(key, candidateState);
                }
            }

            productExploredStates += next.size;
            metrics.exploredStates += next.size;
            const changed: CustomerRecommendationCandidate[] = [];
            for (const [key, state] of next) {
                const current = outcomes.get(key);
                if (current !== undefined && comparePaths(current, state) <= 0) continue;
                outcomes.set(key, state);
                if (!constraints.matches(state.effectIds)) continue;
                changed.push(
                    candidate(
                        this.#recipes.evaluate({
                            productId,
                            ingredientIds: state.ingredientIds,
                        }),
                        product.customerDrugType
                    )
                );
            }
            consider(changed);
            layer = next;
        }
    }

    #subtreeUpper(
        input: CustomerRecipeSearchInput,
        product: SearchProduct,
        state: SearchState,
        actions: readonly IngredientAction[],
        constraints: FinalEffectConstraints,
        bound: CustomerProfitBound,
        remainingIngredients: number,
        workBudget: RecipeSearchWorkBudget
    ): number {
        const productionCost =
            (product.baseProductCost + state.ingredientCost) * input.quantity;
        if (productionCost > input.maximumProductionCost) return Number.NEGATIVE_INFINITY;
        if (remainingIngredients <= 2) {
            return (
                this.#exactSubtreeBest(
                    input,
                    product,
                    state,
                    actions,
                    constraints,
                    remainingIngredients,
                    workBudget
                ) ?? Number.NEGATIVE_INFINITY
            );
        }
        return bound.upperExpectedProfit(
            state.effectIds,
            state.ingredientCost,
            remainingIngredients
        );
    }

    #exactSubtreeBest(
        input: CustomerRecipeSearchInput,
        product: SearchProduct,
        initial: SearchState,
        actions: readonly IngredientAction[],
        constraints: FinalEffectConstraints,
        remainingIngredients: number,
        workBudget: RecipeSearchWorkBudget
    ): number | null {
        let best = constraints.matches(initial.effectIds)
            ? this.#expectedProfit(input, product, initial)
            : null;
        let layer = new Map([[stateKey(initial.effectIds), initial]]);

        for (let depth = 0; depth < remainingIngredients; depth++) {
            const next = new Map<string, SearchState>();
            for (const state of layer.values()) {
                for (const action of actions) {
                    workBudget.boundTransition();
                    const result: SearchState = {
                        effectIds: this.#engine.mixEffectIds(
                            product.drugType,
                            state.effectIds,
                            action.effectId
                        ),
                        ingredientIds: [...state.ingredientIds, action.id],
                        ingredientCost: state.ingredientCost + action.cost,
                    };
                    const key = stateKey(result.effectIds);
                    const current = next.get(key);
                    if (current === undefined || comparePaths(current, result) > 0) {
                        next.set(key, result);
                    }
                }
            }
            for (const state of next.values()) {
                if (!constraints.matches(state.effectIds)) continue;
                const score = this.#expectedProfit(input, product, state);
                if (score !== null && (best === null || score > best)) best = score;
            }
            layer = next;
        }
        return best;
    }

    #expectedProfit(
        input: CustomerRecipeSearchInput,
        product: SearchProduct,
        state: SearchState
    ): number | null {
        const productValue = this.#engine.calculateProductValue(
            product.basePrice,
            state.effectIds
        );
        if (!Number.isFinite(productValue) || productValue <= 0) {
            throw new Error('Recipe product value must be positive');
        }
        const productionCost =
            (product.baseProductCost + state.ingredientCost) * input.quantity;
        if (productionCost > input.maximumProductionCost) return null;
        const askingPrice = customerMarketRelativePrice(
            productValue,
            input.quantity,
            input.priceMultiplier
        );
        const acceptanceChance = this.#offers.evaluate(
            input.profile,
            {
                drugTypes: [product.customerDrugType],
                effectIds: state.effectIds,
                marketValue: productValue,
            },
            input.state,
            {
                quality: input.quality,
                quantity: input.quantity,
                askingPrice,
            }
        );
        return acceptanceChance * (askingPrice - productionCost);
    }

    #rank(
        input: CustomerRecipeSearchInput,
        candidates: readonly CustomerRecommendationCandidate[]
    ): CustomerRecommendation[] {
        return this.#recommendations.rank({
            candidates,
            profile: input.profile,
            state: input.state,
            quality: input.quality,
            quantity: input.quantity,
            priceMultiplier: input.priceMultiplier,
            maximumProductionCost: input.maximumProductionCost,
            limit: input.limit,
        });
    }

    #product(productId: string, baseRecipe: RecipeEvaluation): SearchProduct {
        const item = this.#itemsById.get(productId);
        if (item === undefined) throw new Error(`Unknown product ${JSON.stringify(productId)}`);
        if (item.product === null) {
            throw new Error(`Item ${JSON.stringify(productId)} is not a product`);
        }
        if (!Number.isFinite(baseRecipe.baseProductCost) || baseRecipe.baseProductCost < 0) {
            throw new Error(`Product ${JSON.stringify(productId)} has an invalid base cost`);
        }
        return {
            ...item.product,
            customerDrugType: item.product.drugType,
            baseProductCost: baseRecipe.baseProductCost,
        };
    }

    #ingredients(ids: readonly string[]): IngredientAction[] {
        const seen = new Set<string>();
        return ids.map((id) => {
            if (seen.has(id)) {
                throw new Error(`Duplicate available mixing ingredient ${JSON.stringify(id)}`);
            }
            seen.add(id);
            const item = this.#itemsById.get(id);
            if (item === undefined) {
                throw new Error(`Unknown mixing ingredient ${JSON.stringify(id)}`);
            }
            const effectId = item.mixingIngredient?.effectIds[0];
            if (effectId === undefined) {
                throw new Error(`Item ${JSON.stringify(id)} is not a mixing ingredient`);
            }
            if (
                item.basePurchasePrice === null ||
                !Number.isFinite(item.basePurchasePrice) ||
                item.basePurchasePrice < 0
            ) {
                throw new Error(
                    `Mixing ingredient ${JSON.stringify(id)} has no valid purchase price`
                );
            }
            return { id, effectId, cost: item.basePurchasePrice };
        });
    }
}

function candidate(
    recipe: RecipeEvaluation,
    drugType: CustomerDrugType
): CustomerRecommendationCandidate {
    return { recipe, drugTypes: [drugType] };
}

function candidateKey(value: CustomerRecommendationCandidate): string {
    return JSON.stringify([value.recipe.productId, value.recipe.effectIds]);
}

function comparePaths(left: SearchState, right: SearchState): number {
    return (
        left.ingredientCost - right.ingredientCost ||
        left.ingredientIds.length - right.ingredientIds.length ||
        compareStrings(left.ingredientIds, right.ingredientIds) ||
        compareStrings(left.effectIds, right.effectIds)
    );
}

function compareStrings(left: readonly string[], right: readonly string[]): number {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
        const leftValue = left[index]!;
        const rightValue = right[index]!;
        if (leftValue === rightValue) continue;
        return leftValue < rightValue ? -1 : 1;
    }
    return left.length - right.length;
}

function stateKey(effectIds: readonly string[]): string {
    return JSON.stringify(effectIds);
}

function requireNonNegativeSafeInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${name} must be a non-negative safe integer`);
    }
}

function requirePositiveSafeInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive safe integer`);
    }
}
