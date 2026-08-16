import {
    attributeFinishedRecipeShoppingRouteToProperties,
    validateFinishedRecipeShoppingPropertyAttributionResult,
    type FinishedRecipePurchasePlan,
    type FinishedRecipePurchaseRequirement,
    type FinishedRecipeShoppingAllocation,
    type FinishedRecipeShoppingPropertyAssignment,
    type FinishedRecipeShoppingRoutePlan,
} from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

describe('finished recipe shopping property attribution', () => {
    it('attributes one physical purchase to its explicit property arrival', () => {
        const selected = allocation('shop', 'soil', 'physical', 2);
        const input = attributionInput(
            [requirement('lab', 'soil', 2)],
            routePlan([selected], { physicalCompletionMinute: 10 }),
            [physicalAssignment(selected, 'lab', 12)]
        );

        const result = attributeFinishedRecipeShoppingRouteToProperties(input);

        expect(result).toMatchObject({
            kind: 'attributed',
            proof: 'exact',
            evidenceProof: 'complete',
            sharedAllocations: [],
            gaps: [],
            allocations: [{
                propertyId: 'lab',
                shopCode: 'shop',
                itemId: 'soil',
                access: 'physical',
                quantity: 2,
                sourceCompletionMinute: 10,
                arrivalMinute: 12,
            }],
        });
    });

    it('partitions one selected seller allocation between properties sharing an item', () => {
        const selected = allocation('shop', 'soil', 'physical', 3);
        const input = attributionInput(
            [requirement('barn', 'soil', 2), requirement('lab', 'soil', 1)],
            routePlan([selected], { physicalCompletionMinute: 10 }),
            [
                physicalAssignment(selected, 'lab', 11, 1),
                physicalAssignment(selected, 'barn', 14, 2),
            ]
        );

        const result = attributeFinishedRecipeShoppingRouteToProperties(input);

        expect(result).toMatchObject({
            kind: 'attributed',
            allocations: [
                { propertyId: 'barn', quantity: 2, arrivalMinute: 14 },
                { propertyId: 'lab', quantity: 1, arrivalMinute: 11 },
            ],
        });
    });

    it('preserves separate physical and remote source and property arrival times', () => {
        const physical = allocation('walk-in', 'soil', 'physical', 1);
        const remote = allocation('delivery', 'soil', 'remote-delivery', 1);
        const input = attributionInput(
            [requirement('barn', 'soil', 1), requirement('lab', 'soil', 1)],
            routePlan([physical, remote], {
                physicalCompletionMinute: 8,
                remoteCompletionMinute: 20,
            }),
            [
                physicalAssignment(physical, 'lab', 9),
                remoteAssignment(remote, 'barn', 20),
            ]
        );

        const result = attributeFinishedRecipeShoppingRouteToProperties(input);

        expect(result).toMatchObject({
            kind: 'attributed',
            allocations: [
                {
                    propertyId: 'barn',
                    access: 'remote-delivery',
                    sourceCompletionMinute: 20,
                    arrivalMinute: 20,
                },
                {
                    propertyId: 'lab',
                    access: 'physical',
                    sourceCompletionMinute: 8,
                    arrivalMinute: 9,
                },
            ],
        });
    });

    it('keeps split seller selections attached to their assigned properties', () => {
        const cheap = allocation('cheap', 'soil', 'physical', 2);
        const extra = allocation('extra', 'soil', 'physical', 1);
        const result = attributeFinishedRecipeShoppingRouteToProperties(attributionInput(
            [requirement('barn', 'soil', 1), requirement('lab', 'soil', 2)],
            routePlan([cheap, extra], { physicalCompletionMinute: 10 }),
            [
                physicalAssignment(cheap, 'lab', 10),
                physicalAssignment(extra, 'barn', 13),
            ]
        ));

        expect(result).toMatchObject({
            kind: 'attributed',
            allocations: [
                { propertyId: 'barn', shopCode: 'extra', quantity: 1 },
                { propertyId: 'lab', shopCode: 'cheap', quantity: 2 },
            ],
        });
    });

    it('keeps omitted attribution explicit under partial evidence', () => {
        const selected = allocation('shop', 'soil', 'physical', 2);
        const result = attributeFinishedRecipeShoppingRouteToProperties({
            ...attributionInput(
                [requirement('lab', 'soil', 2)],
                routePlan([selected], { physicalCompletionMinute: 10 }),
                [physicalAssignment(selected, 'lab', 12, 1)]
            ),
            evidence: {
                coverage: 'partial',
                assignments: [physicalAssignment(selected, 'lab', 12, 1)],
            },
        });

        expect(result).toMatchObject({
            kind: 'not-attributed',
            proof: 'incomplete',
            evidenceProof: 'partial',
            sharedAllocations: [{
                quantity: 1,
                reason: 'attribution-assignment-not-recorded',
            }],
        });
        expect(result.gaps.map((gap) => gap.code)).toEqual([
            'property-demand-attribution-missing',
            'selected-allocation-attribution-missing',
        ]);
    });

    it('preserves an explicitly shared purchase as exact non-attribution', () => {
        const selected = allocation('shop', 'soil', 'physical', 1);
        const result = attributeFinishedRecipeShoppingRouteToProperties(attributionInput(
            [requirement('lab', 'soil', 1)],
            routePlan([selected], { physicalCompletionMinute: 10 }),
            [{
                shopCode: selected.shopCode,
                itemId: selected.itemId,
                access: 'physical',
                quantity: 1,
                destination: {
                    kind: 'shared',
                    reason: 'destination-property-not-established',
                },
            }]
        ));

        expect(result).toMatchObject({
            kind: 'not-attributed',
            proof: 'exact',
            sharedAllocations: [{
                quantity: 1,
                reason: 'destination-property-not-established',
            }],
        });
        expect(result.gaps.map((gap) => gap.code)).toEqual([
            'property-demand-attribution-missing',
            'shared-destination-property',
        ]);
    });

    it('rejects excess selected or property quantities and premature arrival', () => {
        const selected = allocation('shop', 'soil', 'physical', 2);
        const base = attributionInput(
            [requirement('lab', 'soil', 2)],
            routePlan([selected], { physicalCompletionMinute: 10 }),
            []
        );
        expect(() => attributeFinishedRecipeShoppingRouteToProperties({
            ...base,
            evidence: {
                coverage: 'complete',
                assignments: [physicalAssignment(selected, 'lab', 12, 3)],
            },
        })).toThrow('Shopping property assignments exceed selected allocation');

        expect(() => attributeFinishedRecipeShoppingRouteToProperties({
            ...base,
            evidence: {
                coverage: 'complete',
                assignments: [physicalAssignment(selected, 'lab', 9)],
            },
        })).toThrow('Shopping property arrival precedes selected physical completion');

        const otherProperty = requirement('barn', 'soil', 2);
        expect(() => attributeFinishedRecipeShoppingRouteToProperties({
            ...base,
            evidence: {
                coverage: 'complete',
                assignments: [physicalAssignment(selected, otherProperty.propertyId, 12)],
            },
        })).toThrow('Shopping attribution references unknown property demand');
    });

    it('rejects remote delivery quantities that differ from the selected allocation', () => {
        const selected = allocation('delivery', 'soil', 'remote-delivery', 1);
        const route = routePlan([selected], { remoteCompletionMinute: 20 });
        const delivery = route.remoteDeliveries[0];
        if (delivery === undefined) throw new Error('Expected one remote delivery');
        const mismatchedRoute: FinishedRecipeShoppingRoutePlan = {
            ...route,
            remoteDeliveries: [{
                ...delivery,
                allocations: [allocation('delivery', 'soil', 'remote-delivery', 2)],
            }],
        };

        expect(() => attributeFinishedRecipeShoppingRouteToProperties(attributionInput(
            [requirement('lab', 'soil', 1)],
            mismatchedRoute,
            [remoteAssignment(selected, 'lab', 20)]
        ))).toThrow('Remote delivery allocation does not match selected shopping allocation');
    });

    it('rejects an attributed result altered after composition', () => {
        const selected = allocation('shop', 'soil', 'physical', 1);
        const input = attributionInput(
            [requirement('lab', 'soil', 1)],
            routePlan([selected], { physicalCompletionMinute: 10 }),
            [physicalAssignment(selected, 'lab', 10)]
        );
        const result = attributeFinishedRecipeShoppingRouteToProperties(input);
        const first = result.allocations[0];
        if (first === undefined) throw new Error('Expected an attributed allocation');

        expect(() => validateFinishedRecipeShoppingPropertyAttributionResult(
            input.purchasePlan,
            input.routePlan,
            { ...result, allocations: [{ ...first, arrivalMinute: 11 }] }
        )).toThrow('Shopping property attribution result is inconsistent');
    });
});

function attributionInput(
    requirements: readonly FinishedRecipePurchaseRequirement[],
    route: FinishedRecipeShoppingRoutePlan,
    assignments: readonly FinishedRecipeShoppingPropertyAssignment[]
) {
    return {
        purchasePlan: purchasePlan(requirements),
        routePlan: route,
        evidence: { coverage: 'complete' as const, assignments },
    };
}

function requirement(
    propertyId: string,
    itemId: string,
    quantity: number
): FinishedRecipePurchaseRequirement {
    return {
        propertyId,
        itemId,
        materialQuantity: quantity,
        equipmentQuantity: 0,
        requestedQuantity: quantity,
    };
}

function purchasePlan(
    requirements: readonly FinishedRecipePurchaseRequirement[]
): FinishedRecipePurchasePlan {
    const byItem = new Map<string, number>();
    for (const entry of requirements) {
        byItem.set(entry.itemId, (byItem.get(entry.itemId) ?? 0) + (entry.requestedQuantity ?? 0));
    }
    const items = [...byItem].sort(([left], [right]) => left.localeCompare(right))
        .map(([itemId, quantity]) => ({
            itemId,
            requiredRank: null,
            itemEligibility: 'eligible' as const,
            materialQuantity: quantity,
            equipmentQuantity: 0,
            requestedQuantity: quantity,
            sellerEvidenceProof: 'exact' as const,
            allocationProof: 'minimum-cost' as const,
            sellerOptions: [],
            allocations: [],
            knownAllocatedQuantity: quantity,
            unallocatedAfterSupportedPurchases: 0,
            finalUnallocatedQuantity: 0,
            knownAllocatedCost: quantity,
            minimumRequiredPurchaseCost: quantity,
        }));
    const total = [...byItem.values()].reduce((sum, quantity) => sum + quantity, 0);
    return {
        objective: 'maximize-supported-fulfillment-then-minimize-cost-per-item',
        tieBreak: 'unit-price-then-shop-code',
        routeOptimization: 'not-evaluated',
        timingProof: 'not-evaluated',
        demandProof: 'exact',
        sellerEvidenceProof: 'exact',
        allocationProof: 'minimum-cost',
        fulfillmentProof: 'exact',
        requirements,
        items,
        allocations: [],
        totalRequestedQuantity: total,
        knownAllocatedQuantity: total,
        unallocatedAfterSupportedPurchases: 0,
        totalFinalUnallocatedQuantity: 0,
        knownAllocatedCost: total,
        minimumRequiredPurchaseCost: total,
    };
}

interface RouteOverrides {
    readonly physicalCompletionMinute?: number;
    readonly remoteCompletionMinute?: number;
}

function routePlan(
    allocations: readonly FinishedRecipeShoppingAllocation[],
    overrides: RouteOverrides = {}
): FinishedRecipeShoppingRoutePlan {
    const physical = allocations.filter((entry) => entry.access === 'physical');
    const remote = allocations.filter((entry) => entry.access === 'remote-delivery');
    const physicalCompletionMinute = overrides.physicalCompletionMinute ?? 0;
    const remoteCompletionMinute = overrides.remoteCompletionMinute ?? 0;
    const completionMinute = Math.max(physicalCompletionMinute, remoteCompletionMinute);
    const physicalByShop = new Map<string, FinishedRecipeShoppingAllocation[]>();
    for (const entry of physical) {
        const current = physicalByShop.get(entry.shopCode) ?? [];
        current.push(entry);
        physicalByShop.set(entry.shopCode, current);
    }
    const remoteByShop = new Map<string, FinishedRecipeShoppingAllocation[]>();
    for (const entry of remote) {
        const current = remoteByShop.get(entry.shopCode) ?? [];
        current.push(entry);
        remoteByShop.set(entry.shopCode, current);
    }
    return {
        objective: 'minimum-elapsed-minutes',
        tieBreak: 'remaining-metrics-then-trip-count-then-canonical-shop-item-identity-order',
        movementModelId: 'test',
        carryingModel: 'caller-supplied-load-units',
        tripModel: 'each-trip-starts-and-returns-to-depot',
        scheduleModel: 'service-start-must-be-within-recurring-shop-window',
        remoteDeliveryModel: 'caller-supplied-concurrent-duration-from-route-start',
        proof: 'optimal',
        evidenceProof: 'complete',
        searchProof: 'exhaustive',
        evidenceGaps: [],
        visitedStates: 1,
        maximumStates: 100,
        allocations,
        trips: physical.length === 0 ? [] : [{
            tripIndex: 0,
            startMinute: 0,
            endMinute: physicalCompletionMinute,
            elapsedMinutes: physicalCompletionMinute,
            travelDistance: 1,
            peakCarriedLoadUnits: physical.reduce((sum, entry) => sum + entry.quantity, 0),
            visits: [...physicalByShop].map(([shopCode, values]) => ({
                shopCode,
                leg: leg(`to-${shopCode}`, 'depot', shopCode),
                arrivalMinute: 1,
                waitingMinutes: 0,
                serviceStartMinute: 1,
                departureMinute: 1,
                pickedUp: values.map((entry) => ({
                    itemId: entry.itemId,
                    quantity: entry.quantity,
                    loadUnits: entry.quantity,
                })),
                carriedLoadUnitsAfterVisit: values.reduce((sum, entry) => sum + entry.quantity, 0),
            })),
            returnLeg: leg('return', physical.at(-1)?.shopCode ?? 'shop', 'depot'),
        }],
        remoteDeliveries: [...remoteByShop].map(([shopCode, values]) => ({
            shopCode,
            completionMinute: remoteCompletionMinute,
            allocations: values,
        })),
        totalPurchaseCost: allocations.reduce((sum, entry) => sum + entry.totalPrice, 0),
        totalTravelDistance: physical.length === 0 ? 0 : 1,
        physicalCompletionMinute,
        remoteCompletionMinute,
        completionMinute,
        elapsedMinutes: completionMinute,
    };
}

function allocation(
    shopCode: string,
    itemId: string,
    access: FinishedRecipeShoppingAllocation['access'],
    quantity: number
): FinishedRecipeShoppingAllocation {
    return { shopCode, itemId, access, quantity, unitPrice: 1, totalPrice: quantity };
}

function physicalAssignment(
    selected: FinishedRecipeShoppingAllocation,
    propertyId: string,
    arrivalMinute: number,
    quantity: number = selected.quantity
): FinishedRecipeShoppingPropertyAssignment {
    return {
        shopCode: selected.shopCode,
        itemId: selected.itemId,
        access: 'physical',
        quantity,
        destination: {
            kind: 'property',
            propertyId,
            arrivalMinute,
            evidence: 'caller-supplied-physical-property-arrival',
        },
    };
}

function remoteAssignment(
    selected: FinishedRecipeShoppingAllocation,
    propertyId: string,
    arrivalMinute: number
): FinishedRecipeShoppingPropertyAssignment {
    return {
        shopCode: selected.shopCode,
        itemId: selected.itemId,
        access: 'remote-delivery',
        quantity: selected.quantity,
        destination: {
            kind: 'property',
            propertyId,
            arrivalMinute,
            evidence: 'caller-supplied-remote-delivery-destination',
        },
    };
}

function leg(legId: string, fromLocationId: string, toLocationId: string) {
    return { legId, fromLocationId, toLocationId, distance: 1, durationMinutes: 1 };
}
