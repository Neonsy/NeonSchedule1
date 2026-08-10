import {
    planFinishedRecipeShoppingRoute,
    type FinishedRecipePurchaseItemPlan,
    type FinishedRecipePurchasePlan,
    type FinishedRecipePurchaseSellerOption,
    type FinishedRecipeShoppingObjective,
    type FinishedRecipeShoppingRouteInput,
    type FinishedRecipeShoppingTravelLeg,
} from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

describe('finished recipe shopping routes', () => {
    it('selects the exact shortest visit order and consolidates one trip', () => {
        const purchase = purchasePlan([
            itemPlan('seed', 1, [physicalSeller('seed-shop', 'seed', 10)]),
            itemPlan('soil', 1, [physicalSeller('soil-shop', 'soil', 5)]),
        ]);
        const result = planFinishedRecipeShoppingRoute(routeInput(purchase, [
            leg('depot-seed', 'depot', 'seed-shop', 2),
            leg('seed-soil', 'seed-shop', 'soil-shop', 2),
            leg('soil-depot', 'soil-shop', 'depot', 2),
            leg('depot-soil', 'depot', 'soil-shop', 6),
            leg('soil-seed', 'soil-shop', 'seed-shop', 6),
            leg('seed-depot', 'seed-shop', 'depot', 6),
        ], { serviceMinutesPerVisit: 1 }));

        expect(result).toMatchObject({
            kind: 'planned',
            plan: {
                proof: 'optimal',
                evidenceProof: 'complete',
                searchProof: 'exhaustive',
                totalPurchaseCost: 15,
                totalTravelDistance: 6,
                elapsedMinutes: 8,
            },
        });
        if (result.kind !== 'planned') throw new Error('Expected a shopping route');
        expect(result.plan.trips).toHaveLength(1);
        expect(result.plan.trips[0]?.visits.map((visit) => visit.shopCode))
            .toEqual(['seed-shop', 'soil-shop']);
        expect(result.plan.trips[0]?.visits.map((visit) => visit.pickedUp))
            .toEqual([
                [{ itemId: 'seed', quantity: 1, loadUnits: 1 }],
                [{ itemId: 'soil', quantity: 1, loadUnits: 1 }],
            ]);
    });

    it('returns to the depot and unloads when carrying capacity requires two trips', () => {
        const purchase = purchasePlan([
            itemPlan('seed', 1, [physicalSeller('seed-shop', 'seed', 10)]),
            itemPlan('soil', 1, [physicalSeller('soil-shop', 'soil', 5)]),
        ]);
        const result = planFinishedRecipeShoppingRoute(routeInput(purchase, [
            leg('depot-seed', 'depot', 'seed-shop', 1),
            leg('seed-depot', 'seed-shop', 'depot', 1),
            leg('depot-soil', 'depot', 'soil-shop', 1),
            leg('soil-depot', 'soil-shop', 'depot', 1),
        ], { carryingCapacity: 1 }));

        if (result.kind !== 'planned') throw new Error('Expected a shopping route');
        expect(result.plan.proof).toBe('optimal');
        expect(result.plan.trips).toHaveLength(2);
        expect(result.plan.trips.map((trip) => trip.peakCarriedLoadUnits)).toEqual([1, 1]);
        expect(result.plan.totalTravelDistance).toBe(4);
    });

    it('supports explicit cost, elapsed-time, and distance objectives', () => {
        const purchase = purchasePlan([
            itemPlan('soil', 1, [
                physicalSeller('cheap-far', 'soil', 1),
                physicalSeller('expensive-near', 'soil', 5),
            ]),
        ]);
        const legs = [
            leg('depot-cheap', 'depot', 'cheap-far', 10),
            leg('cheap-depot', 'cheap-far', 'depot', 10),
            leg('depot-near', 'depot', 'expensive-near', 1),
            leg('near-depot', 'expensive-near', 'depot', 1),
        ];

        expect(selectedShop(route(purchase, legs, 'minimum-purchase-cost'))).toBe('cheap-far');
        expect(selectedShop(route(purchase, legs, 'minimum-elapsed-minutes'))).toBe('expensive-near');
        expect(selectedShop(route(purchase, legs, 'minimum-travel-distance'))).toBe('expensive-near');
    });

    it('waits for recurring daytime and overnight opening windows', () => {
        const daytime = purchasePlan([
            itemPlan('soil', 1, [physicalSeller('shop', 'soil', 5, { openTime: 100, closeTime: 200 })]),
        ]);
        const daytimeResult = route(daytime, [
            leg('out', 'depot', 'shop', 10),
            leg('back', 'shop', 'depot', 10),
        ], 'minimum-elapsed-minutes');
        if (daytimeResult.kind !== 'planned') throw new Error('Expected daytime route');
        expect(daytimeResult.plan.trips[0]?.visits[0]).toMatchObject({
            arrivalMinute: 10,
            waitingMinutes: 50,
            serviceStartMinute: 60,
        });

        const overnight = purchasePlan([
            itemPlan('soil', 1, [physicalSeller('shop', 'soil', 5, { openTime: 2200, closeTime: 200 })]),
        ]);
        const overnightResult = planFinishedRecipeShoppingRoute(routeInput(overnight, [
            leg('out', 'depot', 'shop', 1),
            leg('back', 'shop', 'depot', 1),
        ], { startMinute: 23 * 60 }));
        if (overnightResult.kind !== 'planned') throw new Error('Expected overnight route');
        expect(overnightResult.plan.trips[0]?.visits[0]?.waitingMinutes).toBe(0);

        const missingSchedule = physicalSeller('shop', 'soil', 5);
        const unknown = purchasePlan([itemPlan('soil', 1, [{
            ...missingSchedule,
            option: {
                ...missingSchedule.option,
                availability: { kind: 'unknown', reason: 'no-schedule-data' },
            },
        }])]);
        expect(planFinishedRecipeShoppingRoute(routeInput(unknown, []))).toMatchObject({
            kind: 'not-planned',
            reason: 'no-supported-complete-fulfillment',
            proof: 'incomplete',
        });
    });

    it('chooses between remote delivery and physical pickup under the selected objective', () => {
        const purchase = purchasePlan([
            itemPlan('seed', 1, [
                remoteSeller('remote-cheap', 'seed', 1),
                physicalSeller('physical-fast', 'seed', 5),
            ]),
        ]);
        const input = routeInput(purchase, [
            leg('out', 'depot', 'physical-fast', 2),
            leg('back', 'physical-fast', 'depot', 2),
        ], {
            remoteDeliveries: [{ shopCode: 'remote-cheap', durationMinutes: 20 }],
        });

        const cheapest = planFinishedRecipeShoppingRoute({
            ...input,
            objective: 'minimum-purchase-cost',
        });
        const fastest = planFinishedRecipeShoppingRoute({
            ...input,
            objective: 'minimum-elapsed-minutes',
        });
        expect(allocationShop(cheapest)).toBe('remote-cheap');
        expect(allocationShop(fastest)).toBe('physical-fast');
        if (cheapest.kind !== 'planned') throw new Error('Expected remote route');
        expect(cheapest.plan.remoteDeliveries[0]?.completionMinute).toBe(20);
        expect(cheapest.plan.trips).toEqual([]);
    });

    it('reports partial travel evidence and a reached search limit without claiming optimality', () => {
        const purchase = purchasePlan([
            itemPlan('soil', 1, [physicalSeller('shop', 'soil', 5)]),
        ]);
        const partial = planFinishedRecipeShoppingRoute({
            ...routeInput(purchase, [
                leg('out', 'depot', 'shop', 1),
                leg('back', 'shop', 'depot', 1),
            ]),
            travel: {
                coverage: 'partial',
                depotLocationId: 'depot',
                legs: [leg('out', 'depot', 'shop', 1), leg('back', 'shop', 'depot', 1)],
            },
        });
        expect(partial).toMatchObject({
            kind: 'planned',
            plan: {
                proof: 'best-known-feasible',
                evidenceProof: 'incomplete',
                evidenceGaps: [{
                    code: 'travel-evidence-partial',
                    itemId: null,
                    shopCode: null,
                }],
            },
        });

        const aggregateSellerEvidenceIncomplete = planFinishedRecipeShoppingRoute({
            ...routeInput({ ...purchase, sellerEvidenceProof: 'incomplete' }, [
                leg('out', 'depot', 'shop', 1),
                leg('back', 'shop', 'depot', 1),
            ]),
        });
        expect(aggregateSellerEvidenceIncomplete).toMatchObject({
            kind: 'planned',
            plan: {
                proof: 'best-known-feasible',
                evidenceProof: 'incomplete',
                evidenceGaps: [{
                    code: 'purchase-seller-evidence-incomplete',
                    itemId: null,
                    shopCode: null,
                }],
            },
        });

        const bounded = planFinishedRecipeShoppingRoute({
            ...routeInput(purchase, [
                leg('out', 'depot', 'shop', 1),
                leg('back', 'shop', 'depot', 1),
            ]),
            maximumStates: 9,
        });
        expect(bounded).toMatchObject({
            kind: 'planned',
            plan: {
                proof: 'best-known-feasible',
                evidenceProof: 'complete',
                searchProof: 'state-limit-reached',
                visitedStates: 9,
            },
        });

        const limited = planFinishedRecipeShoppingRoute({
            ...routeInput(purchase, [
                leg('out', 'depot', 'shop', 1),
                leg('back', 'shop', 'depot', 1),
            ]),
            maximumStates: 1,
        });
        expect(limited).toMatchObject({
            kind: 'not-planned',
            reason: 'search-limit-before-feasible-plan',
            proof: 'incomplete',
            visitedStates: 1,
        });
    });

    it('distinguishes incomplete purchase demand from exact route infeasibility', () => {
        const empty = planFinishedRecipeShoppingRoute(routeInput(purchasePlan([]), []));
        expect(empty).toMatchObject({
            kind: 'planned',
            plan: {
                proof: 'optimal',
                allocations: [],
                trips: [],
                elapsedMinutes: 0,
            },
        });

        const exact = purchasePlan([
            itemPlan('soil', 1, [physicalSeller('shop', 'soil', 5)]),
        ]);
        const incomplete: FinishedRecipePurchasePlan = {
            ...exact,
            demandProof: 'transfer-residual-incomplete',
            totalRequestedQuantity: null,
        };
        expect(planFinishedRecipeShoppingRoute(routeInput(incomplete, []))).toMatchObject({
            kind: 'not-planned',
            reason: 'purchase-demand-incomplete',
            proof: 'incomplete',
        });

        const infeasible = planFinishedRecipeShoppingRoute(routeInput(exact, [], {
            carryingCapacity: 1,
            itemLoadUnits: [{ itemId: 'soil', loadUnitsPerItem: 2 }],
        }));
        expect(infeasible).toMatchObject({
            kind: 'not-planned',
            reason: 'no-known-feasible-route',
            proof: 'exact',
        });
    });

    it('rejects malformed carrying and directed-leg evidence', () => {
        const purchase = purchasePlan([
            itemPlan('soil', 1, [physicalSeller('shop', 'soil', 5)]),
        ]);
        expect(() => planFinishedRecipeShoppingRoute(routeInput(purchase, [], {
            itemLoadUnits: [],
        }))).toThrow('Missing shopping load units for "soil"');
        expect(() => planFinishedRecipeShoppingRoute(routeInput(purchase, [
            leg('one', 'depot', 'shop', 1),
            leg('two', 'depot', 'shop', 2),
        ]))).toThrow('Duplicate directed shopping travel pair');
    });
});

function route(
    purchasePlan: FinishedRecipePurchasePlan,
    legs: readonly FinishedRecipeShoppingTravelLeg[],
    objective: FinishedRecipeShoppingObjective
) {
    return planFinishedRecipeShoppingRoute({ ...routeInput(purchasePlan, legs), objective });
}

function selectedShop(result: ReturnType<typeof route>): string | undefined {
    return result.kind === 'planned' ? result.plan.allocations[0]?.shopCode : undefined;
}

function allocationShop(result: ReturnType<typeof planFinishedRecipeShoppingRoute>): string | undefined {
    return result.kind === 'planned' ? result.plan.allocations[0]?.shopCode : undefined;
}

interface RouteOverrides {
    readonly carryingCapacity?: number;
    readonly itemLoadUnits?: FinishedRecipeShoppingRouteInput['movement']['itemLoadUnits'];
    readonly startMinute?: number;
    readonly serviceMinutesPerVisit?: number;
    readonly remoteDeliveries?: FinishedRecipeShoppingRouteInput['remoteDelivery']['deliveries'];
}

function routeInput(
    purchasePlan: FinishedRecipePurchasePlan,
    legs: readonly FinishedRecipeShoppingTravelLeg[],
    overrides: RouteOverrides = {}
): FinishedRecipeShoppingRouteInput {
    return {
        purchasePlan,
        objective: 'minimum-travel-distance',
        movement: {
            modelId: 'explicit-test-walker',
            carryingCapacity: overrides.carryingCapacity ?? 10,
            itemLoadUnits: overrides.itemLoadUnits ?? purchasePlan.items.map((item) => ({
                itemId: item.itemId,
                loadUnitsPerItem: 1,
            })),
            startMinute: overrides.startMinute ?? 0,
            serviceMinutesPerVisit: overrides.serviceMinutesPerVisit ?? 0,
        },
        travel: { coverage: 'complete', depotLocationId: 'depot', legs },
        remoteDelivery: {
            coverage: 'complete',
            deliveries: overrides.remoteDeliveries ?? [],
        },
        maximumStates: 100_000,
    };
}

function purchasePlan(items: readonly FinishedRecipePurchaseItemPlan[]): FinishedRecipePurchasePlan {
    const requested = items.reduce((total, item) => total + item.requestedQuantity, 0);
    return {
        objective: 'maximize-supported-fulfillment-then-minimize-cost-per-item',
        tieBreak: 'unit-price-then-shop-code',
        routeOptimization: 'not-evaluated',
        timingProof: 'not-evaluated',
        demandProof: 'exact',
        sellerEvidenceProof: 'exact',
        allocationProof: 'minimum-cost',
        fulfillmentProof: 'exact',
        requirements: [],
        items,
        allocations: [],
        totalRequestedQuantity: requested,
        knownAllocatedQuantity: 0,
        unallocatedAfterSupportedPurchases: requested,
        totalFinalUnallocatedQuantity: requested,
        knownAllocatedCost: 0,
        minimumRequiredPurchaseCost: null,
    };
}

function itemPlan(
    itemId: string,
    quantity: number,
    sellerOptions: readonly FinishedRecipePurchaseSellerOption[]
): FinishedRecipePurchaseItemPlan {
    return {
        itemId,
        requiredRank: null,
        itemEligibility: 'eligible',
        materialQuantity: quantity,
        equipmentQuantity: 0,
        requestedQuantity: quantity,
        sellerEvidenceProof: 'exact',
        allocationProof: 'minimum-cost',
        sellerOptions,
        allocations: [],
        knownAllocatedQuantity: 0,
        unallocatedAfterSupportedPurchases: quantity,
        finalUnallocatedQuantity: quantity,
        knownAllocatedCost: 0,
        minimumRequiredPurchaseCost: null,
    };
}

interface ScheduleOverrides {
    readonly openTime?: number;
    readonly closeTime?: number;
}

function physicalSeller(
    shopCode: string,
    itemId: string,
    unitPrice: number,
    schedule: ScheduleOverrides = {}
): FinishedRecipePurchaseSellerOption {
    return {
        priceRank: 1,
        option: {
            shopCode,
            shopName: shopCode,
            paymentType: 'Cash',
            availability: {
                kind: 'not-evaluated',
                schedule: {
                    openTime: schedule.openTime ?? 0,
                    closeTime: schedule.closeTime ?? 2359,
                },
            },
            purchase: {
                itemId,
                quantity: 1,
                unitPrice,
                totalPrice: unitPrice,
                stock: { kind: 'unlimited' },
                canBeDelivered: false,
            },
            access: {
                kind: 'unreachable',
                reason: 'no-reachable-access',
                candidates: [{
                    kind: 'shop-position',
                    locationSource: 'explicit-test',
                    position: { x: 0, y: 0, z: 0 },
                }],
            },
        },
        eligibility: { kind: 'unavailable', reason: 'no-reachable-access' },
    };
}

function remoteSeller(
    shopCode: string,
    itemId: string,
    unitPrice: number
): FinishedRecipePurchaseSellerOption {
    return {
        priceRank: 1,
        option: {
            shopCode,
            shopName: shopCode,
            paymentType: 'Cash',
            availability: { kind: 'unknown', reason: 'no-schedule-data' },
            purchase: {
                itemId,
                quantity: 1,
                unitPrice,
                totalPrice: unitPrice,
                stock: { kind: 'unlimited' },
                canBeDelivered: true,
            },
            access: { kind: 'remote', source: 'supplier-phone-interface' },
        },
        eligibility: { kind: 'supported', quantityCapacity: null },
    };
}

function leg(
    legId: string,
    fromLocationId: string,
    toLocationId: string,
    distance: number
): FinishedRecipeShoppingTravelLeg {
    return { legId, fromLocationId, toLocationId, distance, durationMinutes: distance };
}
