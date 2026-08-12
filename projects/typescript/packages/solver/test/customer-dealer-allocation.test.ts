import type { CustomerRecommendation, TradeCatalog } from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

import { CustomerRecommendationDealerAllocator } from '#solver/customer-dealer-allocation';
import { customerRecommendationStockResourceId } from '#solver/customer-allocation';

describe('customer recommendation dealer allocation', () => {
    const datasetSha256 = 'a'.repeat(64);

    it('chooses recommendations by profit after the dealer cut', () => {
        const highRevenue = recommendation('high-revenue', 200, 50, 10);
        const lowRevenue = recommendation('low-revenue', 50, 45, 10);
        const allocator = new CustomerRecommendationDealerAllocator(tradeCatalog(10, [
            dealer('dealer', 0.2, 0),
        ]));
        const input = {
            datasetSha256,
            dealers: [{ personId: 'dealer', signingFeePaid: true }],
            recommendationSets: [{
                customerId: 'customer',
                recommendations: [highRevenue, lowRevenue],
            }],
            maximumProductionCost: 10,
            maximumDealerSubsets: 2,
            maximumStatesPerDealerSubset: 100,
        } as const;
        const allocation = allocator.allocate(input);

        expect(allocation.result).toMatchObject({
            status: 'exact',
            expectedRevenue: 50,
            expectedProfitBeforeDealerCosts: 45,
            dealerCut: 10,
            signingFees: 0,
            expectedProfit: 35,
        });
        expect(allocation.allocations[0]).toMatchObject({
            customerId: 'customer',
            dealerId: 'dealer',
            recommendation: lowRevenue,
        });
        expect(allocator.allocate({
            ...input,
            recommendationSets: [{
                customerId: 'customer',
                recommendations: [lowRevenue, highRevenue],
            }],
        })).toEqual(allocation);
    });

    it('enforces stock and capacity while charging each used signing fee once', () => {
        const offer = recommendation('shared', 100, 50, 10);
        const stockResourceId = customerRecommendationStockResourceId(datasetSha256, offer);
        const allocation = new CustomerRecommendationDealerAllocator(tradeCatalog(1, [
            dealer('d1', 0.1, 10),
            dealer('d2', 0.2, 0),
        ])).allocate({
            datasetSha256,
            dealers: [
                { personId: 'd1', signingFeePaid: false },
                { personId: 'd2', signingFeePaid: true },
            ],
            recommendationSets: [
                { customerId: 'alice', recommendations: [offer] },
                { customerId: 'bob', recommendations: [offer] },
            ],
            maximumProductionCost: 20,
            stock: [{ resourceId: stockResourceId, quantity: 2 }],
            maximumDealerSubsets: 4,
            maximumStatesPerDealerSubset: 1_000,
        });

        expect(allocation.result).toMatchObject({
            status: 'exact',
            productionCost: 20,
            expectedProfitBeforeDealerCosts: 100,
            dealerCut: 30,
            signingFees: 10,
            expectedProfit: 60,
            resourceUsage: [{ resourceId: stockResourceId, quantity: 2 }],
        });
        expect(allocation.result.allocations.map(({ dealerId }) => dealerId).sort()).toEqual([
            'd1',
            'd2',
        ]);
    });

    it('reduces equivalent dealers by count and selects the cheapest concrete fees', () => {
        const offer = recommendation('offer', 0, 100, 1);
        const allocation = new CustomerRecommendationDealerAllocator(tradeCatalog(1, [
            dealer('d1', 0.2, 10),
            dealer('d2', 0.2, 0),
            dealer('d3', 0.2, 5),
        ])).allocate({
            datasetSha256,
            dealers: [
                { personId: 'd1', signingFeePaid: false },
                { personId: 'd2', signingFeePaid: false },
                { personId: 'd3', signingFeePaid: false },
            ],
            recommendationSets: [
                { customerId: 'alice', recommendations: [offer] },
                { customerId: 'bob', recommendations: [offer] },
            ],
            maximumProductionCost: 2,
            maximumDealerSubsets: 4,
            maximumStatesPerDealerSubset: 100,
        });

        expect(allocation.result).toMatchObject({
            status: 'exact',
            signingFees: 5,
            expectedProfit: 195,
            evidence: {
                possibleDealerSubsets: 8,
                equivalentDealerClassCount: 1,
                possibleDealerClassSelections: 4,
                skippedEquivalentDealerSubsets: 4,
                evaluatedDealerSubsets: 4,
            },
        });
        expect(allocation.result.allocations.map(({ dealerId }) => dealerId).sort()).toEqual([
            'd2',
            'd3',
        ]);
        expect(allocation.result.allocations[0]).not.toHaveProperty('dealerClassId');
    });

    it('keeps dealers separate when customer eligibility distinguishes them', () => {
        const allocation = new CustomerRecommendationDealerAllocator(tradeCatalog(1, [
            dealer('d1', 0.2, 0),
            dealer('d2', 0.2, 0),
        ])).allocate({
            datasetSha256,
            dealers: [
                { personId: 'd1', signingFeePaid: true },
                { personId: 'd2', signingFeePaid: true },
            ],
            recommendationSets: [{
                customerId: 'customer',
                recommendations: [recommendation('offer', 10, 10, 1)],
                eligibleDealerIds: ['d1'],
            }],
            maximumProductionCost: 1,
            maximumDealerSubsets: 4,
            maximumStatesPerDealerSubset: 100,
        });

        expect(allocation.result).toMatchObject({
            status: 'exact',
            evidence: {
                equivalentDealerClassCount: 2,
                possibleDealerClassSelections: 4,
                skippedEquivalentDealerSubsets: 0,
            },
        });
        expect(allocation.result.allocations[0]).toMatchObject({ dealerId: 'd1' });
    });

    it('intersects configured eligibility with worst-case travel feasibility', () => {
        const allocation = new CustomerRecommendationDealerAllocator(tradeCatalog(1, [
            dealer('d1', 0.1, 0),
            dealer('d2', 0.2, 0),
        ])).allocate({
            datasetSha256,
            dealers: [
                { personId: 'd1', signingFeePaid: true },
                { personId: 'd2', signingFeePaid: true },
            ],
            recommendationSets: [{
                customerId: 'customer',
                recommendations: [recommendation('offer', 100, 50, 1)],
                eligibleDealerIds: ['d1', 'd2'],
                travelFeasibility: {
                    policy: 'worst-case-regional-delivery-location',
                    regionId: 'Test',
                    decisions: [{
                        dealerId: 'd2',
                        status: 'feasible',
                        deliveryLocationCount: 1,
                        minutesUntilDeliveryWindowStart: 10,
                        availableTravelMinutes: 40,
                        worstCase: {
                            deliveryLocationId: 'location',
                            method: 'native-straight-line-walk-speed',
                            straightLineDistance: 100,
                            travelMinutesBeforeClamp: 25,
                            travelMinutes: 25,
                            targetArrivalTime: 1230,
                            departureTime: 1205,
                        },
                        reasons: [],
                    }],
                    eligibleDealerIds: ['d2'],
                },
            }],
            maximumProductionCost: 1,
            maximumDealerSubsets: 4,
            maximumStatesPerDealerSubset: 100,
        });

        expect(allocation.result.allocations).toHaveLength(1);
        expect(allocation.result.allocations[0]).toMatchObject({ dealerId: 'd2' });
    });

    it('reports dealer-subset and allocation-state limits separately', () => {
        const allocator = new CustomerRecommendationDealerAllocator(tradeCatalog(10, [
            dealer('dealer', 0, 0),
        ]));
        const input = {
            datasetSha256,
            dealers: [{ personId: 'dealer', signingFeePaid: true }],
            recommendationSets: [{
                customerId: 'customer',
                recommendations: [recommendation('offer', 10, 10, 1)],
            }],
            maximumProductionCost: 1,
        } as const;

        expect(allocator.allocate({
            ...input,
            maximumDealerSubsets: 1,
            maximumStatesPerDealerSubset: 100,
        }).result).toMatchObject({
            status: 'incomplete',
            evidence: { stopReasons: ['dealer-subset-limit'] },
        });
        expect(allocator.allocate({
            ...input,
            maximumDealerSubsets: 2,
            maximumStatesPerDealerSubset: 1,
        }).result).toMatchObject({
            status: 'incomplete',
            evidence: { stopReasons: ['allocation-state-limit'] },
        });
    });

    it('applies one mode budget without hiding an incomplete result', () => {
        const dealers = Array.from({ length: 7 }, (_, index) =>
            dealer(`d${index}`, index / 100, 0)
        );
        const allocator = new CustomerRecommendationDealerAllocator(tradeCatalog(10, dealers));
        const allocation = allocator.allocateForMode({
            datasetSha256,
            dealers: dealers.map(({ personId }) => ({ personId, signingFeePaid: true })),
            recommendationSets: [{
                customerId: 'customer',
                recommendations: [recommendation('offer', 10, 10, 1)],
            }],
            maximumProductionCost: 1,
        }, 'quick');

        expect(allocation).toMatchObject({
            mode: 'quick',
            policy: {
                version: '1',
                budget: {
                    maximumDealerConfigurations: 64,
                    maximumStatesPerDealerConfiguration: 50_000,
                },
            },
            result: {
                status: 'incomplete',
                evidence: {
                    possibleDealerClassSelections: 128,
                    evaluatedDealerSubsets: 64,
                    maximumDealerSubsets: 64,
                    maximumStatesPerDealerSubset: 50_000,
                    stopReasons: ['dealer-subset-limit'],
                },
            },
        });
    });
});

function recommendation(
    productId: string,
    expectedRevenue: number,
    expectedProfit: number,
    productionCost: number
): CustomerRecommendation {
    return {
        recipe: {
            productId,
            ingredientIds: [],
            effectIds: [],
            productValue: expectedRevenue,
            baseProductCost: productionCost,
            baseProductCostBasis: 'purchase-price',
            ingredientCost: 0,
            totalCost: productionCost,
            netValue: expectedRevenue - productionCost,
            ingredientCount: 0,
        },
        drugTypes: ['Marijuana'],
        quality: 'Standard',
        quantity: 1,
        askingPrice: expectedRevenue,
        productionCost,
        grossProfit: expectedRevenue - productionCost,
        acceptanceChance: 1,
        expectedRevenue,
        expectedProfit,
    };
}

function dealer(
    personId: string,
    salesCutPercentage: number,
    signingFee: number
): TradeCatalog['dealers'][number] {
    return {
        personId,
        instanceKey: `${personId}:one`,
        type: 'PlayerDealer',
        homeName: `${personId} home`,
        walkSpeed: 4,
        salesCutPercentage,
        signingFee,
        qualityTolerance: { negative: -2, positive: 5 },
    };
}

function tradeCatalog(
    maximumCustomers: number,
    dealers: TradeCatalog['dealers']
): TradeCatalog {
    return {
        schema: 'neonschedule1-trade-catalog-2',
        dealerMechanics: {
            maximumCustomers,
            dealArrivalDelay: 30,
            travelTime: { minimum: 15, maximum: 360 },
            overflowSlotCount: 10,
            cashReminderThreshold: 500,
            relationshipChangePerDeal: 0.05,
        },
        dealers,
        suppliers: [],
    };
}
