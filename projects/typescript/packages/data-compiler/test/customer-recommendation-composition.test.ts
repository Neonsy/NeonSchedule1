import {
    CustomerRecommendationComposer,
    type Customer,
    type CustomerCatalog,
    type CustomerEligibilityDecision,
    type CustomerRecommendationCandidate,
    type CustomerRecommendationCompositionInput,
    type CustomerRecommendationProductionPlan,
    type RecipeEvaluation,
} from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

describe('customer recommendation composition', () => {
    const composer = new CustomerRecommendationComposer(catalog());

    it('recommends eligible current stock without inventing production work', () => {
        const selected = candidate('ready', 60, 20);
        const result = composer.compose(input({
            candidates: [selected],
            finishedInventory: [{ recipe: selected.recipe, quality: 'Standard', quantity: 4 }],
        }));

        expect(result.evidence).toEqual({
            dataset: dataset(),
            status: 'resolved',
            eligibilityStatus: 'eligible',
            missingFacts: [],
            candidateCount: 1,
            availableCandidateCount: 1,
            unavailableCandidateCount: 0,
            unknownCandidateCount: 0,
        });
        expect(result.recommendations[0]).toMatchObject({
            recommendation: {
                productionCost: 40,
                grossProfit: 80,
                quantity: 2,
            },
            fulfillment: {
                source: 'finished-inventory',
                finishedInventoryQuantity: 4,
                finishedInventoryQuantityUsed: 2,
                productionQuantity: 0,
                production: null,
            },
        });
    });

    it('composes partial stock with an exact production shortfall and modeled evidence', () => {
        const selected = candidate('mixed', 70, 20);
        const result = composer.compose(input({
            candidates: [selected],
            finishedInventory: [{ recipe: selected.recipe, quality: 'Standard', quantity: 1 }],
            productionPlans: [productionPlan(selected.recipe, 1, 27, 31, 95)],
            maximumProductionCost: 50,
            maximumProductionMinutes: 95,
        }));

        expect(result.recommendations[0]).toMatchObject({
            recommendation: {
                productionCost: 47,
                grossProfit: 93,
            },
            fulfillment: {
                source: 'finished-inventory-and-production',
                finishedInventoryQuantityUsed: 1,
                productionQuantity: 1,
                production: {
                    requiredMaterialCost: 27,
                    additionalReorderCost: 31,
                    modeledProcessMinutes: 95,
                    modeledDurationProof: 'complete',
                    finishedLifecycleProof: 'partial',
                },
            },
        });
    });

    it('reports missing live state and does not use normalized defaults', () => {
        const selected = candidate('unknown', 60, 20);
        const result = composer.compose({
            dataset: dataset(),
            customer: customer(),
            eligibility: eligibility('eligible', 2),
            candidates: [selected],
            quality: 'Standard',
            quantity: 2,
            priceMultiplier: 1,
            maximumProductionCost: 100,
            maximumProductionMinutes: 120,
            limit: 5,
        });

        expect(result).toMatchObject({
            recommendations: [],
            evidence: {
                status: 'unknown',
                missingFacts: [
                    'current-addiction',
                    'order-limit-multiplier',
                    'finished-inventory',
                ],
                unknownCandidateCount: 1,
            },
        });
        expect(result.candidates[0]?.reasons).toEqual([
            { code: 'missing-current-addiction' },
            { code: 'missing-order-limit-multiplier' },
            { code: 'missing-finished-inventory' },
        ]);
    });

    it('distinguishes unknown production evidence from known unavailable production', () => {
        const selected = candidate('shortfall', 60, 20);
        const unknown = composer.compose(input({
            candidates: [selected],
            finishedInventory: [],
        }));
        const unavailable = composer.compose(input({
            candidates: [selected],
            finishedInventory: [],
            productionPlans: [],
        }));

        expect(unknown.candidates[0]).toMatchObject({
            status: 'unknown',
            reasons: [{ code: 'missing-production-plans' }],
        });
        expect(unavailable).toMatchObject({
            recommendations: [],
            evidence: { status: 'resolved', unavailableCandidateCount: 1 },
            candidates: [{
                status: 'unavailable',
                reasons: [{ code: 'production-not-supported' }],
            }],
        });
    });

    it('keeps available recommendations while marking unresolved candidates as partial', () => {
        const ready = candidate('ready', 60, 20);
        const unresolved = candidate('unresolved', 70, 20);
        const result = composer.compose(input({
            candidates: [ready, unresolved],
            finishedInventory: [{ recipe: ready.recipe, quality: 'Standard', quantity: 2 }],
        }));

        expect(result.recommendations).toHaveLength(1);
        expect(result.recommendations[0]?.recommendation.recipe.productId).toBe('ready');
        expect(result.evidence).toMatchObject({
            status: 'partial',
            availableCandidateCount: 1,
            unknownCandidateCount: 1,
        });
    });

    it('names every missing production value instead of treating a partial plan as available', () => {
        const selected = candidate('partial-plan', 60, 20);
        const incomplete: CustomerRecommendationProductionPlan = {
            quality: 'Standard',
            plan: {
                dataset: dataset(),
                recipe: selected.recipe,
                finishedQuantity: 2,
                duration: { modeledTotalProcessMinutes: null },
                cost: { requiredMaterialCost: 40, combinedReorderCost: null },
                evidence: {
                    modeledDurationProof: 'partial',
                    finishedLifecycleProof: 'partial',
                    missingFacts: ['inventory'],
                },
            },
        };
        const result = composer.compose(input({
            candidates: [selected],
            finishedInventory: [],
            productionPlans: [incomplete],
        }));

        expect(result.candidates[0]).toMatchObject({
            status: 'unknown',
            reasons: [{
                code: 'incomplete-production-plan',
                missingFacts: [
                    'inventory',
                    'complete-duration-proof',
                    'modeled-process-minutes',
                    'combined-reorder-cost',
                ],
            }],
        });
    });

    it('applies production cost and time ceilings before ranking', () => {
        const expensive = candidate('expensive', 100, 10);
        const slow = candidate('slow', 90, 10);
        const result = composer.compose(input({
            candidates: [expensive, slow],
            finishedInventory: [],
            productionPlans: [
                productionPlan(expensive.recipe, 2, 61, 61, 20),
                productionPlan(slow.recipe, 2, 40, 40, 121),
            ],
            maximumProductionCost: 60,
            maximumProductionMinutes: 120,
        }));

        expect(result.recommendations).toEqual([]);
        expect(result.candidates.map(({ recipe, status, reasons }) => ({
            productId: recipe.productId,
            status,
            reasons,
        }))).toEqual([
            {
                productId: 'expensive',
                status: 'unavailable',
                reasons: [{
                    code: 'production-cost-limit',
                    productionCost: 61,
                    maximumProductionCost: 60,
                }],
            },
            {
                productId: 'slow',
                status: 'unavailable',
                reasons: [{
                    code: 'production-time-limit',
                    productionMinutes: 121,
                    maximumProductionMinutes: 120,
                }],
            },
        ]);
    });

    it('lets known ineligibility dominate absent live recommendation facts', () => {
        const selected = candidate('blocked', 60, 20);
        const result = composer.compose({
            dataset: dataset(),
            customer: customer(),
            candidates: [selected],
            eligibility: eligibility('ineligible', null),
            quality: 'Standard',
            quantity: 2,
            priceMultiplier: 1,
            maximumProductionCost: 100,
            maximumProductionMinutes: 120,
            limit: 5,
        });

        expect(result).toMatchObject({
            recommendations: [],
            candidates: [{
                status: 'unavailable',
                reasons: [{ code: 'customer-ineligible' }],
            }],
            evidence: {
                status: 'ineligible',
                eligibilityStatus: 'ineligible',
                candidateCount: 1,
                unavailableCandidateCount: 1,
            },
        });
    });

    it('rejects a production plan that does not match the exact shortfall', () => {
        const selected = candidate('mismatch', 60, 20);

        expect(() => composer.compose(input({
            candidates: [selected],
            finishedInventory: [{ recipe: selected.recipe, quality: 'Standard', quantity: 1 }],
            productionPlans: [productionPlan(selected.recipe, 2, 40, 40, 60)],
        }))).toThrow('must produce the exact finished shortfall');
    });

    it('rejects production evidence from another normalized dataset', () => {
        const selected = candidate('other-dataset', 60, 20);
        const production = productionPlan(selected.recipe, 2, 40, 40, 60);
        const otherDatasetPlan: CustomerRecommendationProductionPlan = {
            ...production,
            plan: {
                ...production.plan,
                dataset: {
                    ...production.plan.dataset,
                    datasetSha256: 'b'.repeat(64),
                },
            },
        };

        expect(() => composer.compose(input({
            candidates: [selected],
            finishedInventory: [],
            productionPlans: [otherDatasetPlan],
        }))).toThrow('production plan belongs to a different dataset');
    });
});

function input(
    overrides: Partial<CustomerRecommendationCompositionInput> = {}
): CustomerRecommendationCompositionInput {
    return {
        dataset: dataset(),
        customer: customer(),
        eligibility: eligibility('eligible', 2),
        addiction: 0.2,
        orderLimitMultiplier: 1.5,
        candidates: [],
        finishedInventory: [],
        quality: 'Standard',
        quantity: 2,
        priceMultiplier: 1,
        maximumProductionCost: 100,
        maximumProductionMinutes: 120,
        limit: 5,
        ...overrides,
    };
}

function eligibility(
    status: CustomerEligibilityDecision['status'],
    currentRelationship: number | null
): CustomerEligibilityDecision {
    return {
        customerId: 'customer',
        status,
        currentRelationship,
        reasons: status === 'ineligible' ? [{ code: 'person-not-unlocked' }] : [],
    };
}

function candidate(
    productId: string,
    productValue: number,
    totalCost: number
): CustomerRecommendationCandidate {
    return {
        drugTypes: ['Marijuana'],
        recipe: recipe(productId, productValue, totalCost),
    };
}

function recipe(productId: string, productValue: number, totalCost: number): RecipeEvaluation {
    return {
        ruleProfile: { kind: 'standard' },
        productId,
        ingredientIds: [],
        effectIds: ['refreshing'],
        productValue,
        baseProductCost: totalCost,
        baseProductCostBasis: 'production-materials',
        ingredientCost: 0,
        totalCost,
        netValue: productValue - totalCost,
        ingredientCount: 0,
    };
}

function productionPlan(
    selectedRecipe: RecipeEvaluation,
    quantity: number,
    requiredMaterialCost: number,
    combinedReorderCost: number,
    modeledTotalProcessMinutes: number
): CustomerRecommendationProductionPlan {
    return {
        quality: 'Standard',
        plan: {
            dataset: dataset(),
            recipe: selectedRecipe,
            finishedQuantity: quantity,
            duration: { modeledTotalProcessMinutes },
            cost: { requiredMaterialCost, combinedReorderCost },
            evidence: {
                modeledDurationProof: 'complete',
                finishedLifecycleProof: 'partial',
                missingFacts: [],
            },
        },
    };
}

function dataset() {
    return {
        gameVersion: '0.4.6f12',
        datasetSha256: 'a'.repeat(64),
    };
}

function customer(): Customer {
    return {
        schema: 'neonschedule1-customer-1',
        id: 'customer',
        name: { first: 'Test', last: 'Customer', full: 'Test Customer' },
        region: 'Downtown',
        standards: 'Moderate',
        preferredEffectIds: ['refreshing'],
        drugAffinities: [{ drugType: 'Marijuana', affinity: 1 }],
        baseAddiction: 0.1,
        dependenceMultiplier: 1,
        callPoliceChance: 0,
        canBeDirectlyApproached: true,
        guaranteeFirstSampleSuccess: false,
        weeklySpend: { minimum: 600, maximum: 1_000 },
        weeklyOrders: { minimum: 3, maximum: 6 },
        preferredOrderDay: 'Monday',
        orderTime: 1_200,
        mutualRelationshipRequirement: { minimum: 0, maximum: 5 },
        evaluationOracle: [],
    };
}

function catalog(): Pick<CustomerCatalog, 'constants' | 'qualityTiers'> {
    return {
        constants: {
            affinityMaxEffect: 0.3,
            propertyMaxEffect: 0.4,
            qualityMaxEffect: 0.3,
            maximumRelationship: 5,
            maximumOrderQuantityPerProduct: 1_000,
        } as CustomerCatalog['constants'],
        qualityTiers: [
            { name: 'Trash', value: 0, scalar: 0 },
            { name: 'Poor', value: 1, scalar: 0.25 },
            { name: 'Standard', value: 2, scalar: 0.5 },
            { name: 'Premium', value: 3, scalar: 0.75 },
            { name: 'Heavenly', value: 4, scalar: 1 },
        ],
    };
}
