import {
    FinishedRecipePurchasePlanner,
    NavigationNetwork,
    type FinishedRecipePropertyTransferPlan,
    type FinishedRecipePropertyTransferRequirement,
    type Item,
    type NavigationGraph,
    type Shop,
    type Vector3,
} from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

describe('finished recipe purchasing', () => {
    it('aggregates property residuals once and buys equipment then materials by price', () => {
        const planner = purchasePlanner([
            shop('cheap', 5, 2),
            shop('expensive', 8, null),
        ]);

        const plan = planner.plan(input(exactTransfer([
            requirement('barn', 2, 1),
            requirement('bungalow', 2, 0),
        ], 5), ['cheap', 'expensive']));

        expect(plan).toMatchObject({
            objective: 'maximize-supported-fulfillment-then-minimize-cost-per-item',
            routeOptimization: 'not-evaluated',
            timingProof: 'not-evaluated',
            demandProof: 'exact',
            sellerEvidenceProof: 'exact',
            allocationProof: 'minimum-cost',
            fulfillmentProof: 'exact',
            totalRequestedQuantity: 5,
            knownAllocatedQuantity: 5,
            totalFinalUnallocatedQuantity: 0,
            knownAllocatedCost: 34,
            minimumRequiredPurchaseCost: 34,
        });
        expect(plan.requirements).toEqual([
            {
                propertyId: 'barn',
                itemId: 'soil',
                materialQuantity: 2,
                equipmentQuantity: 1,
                requestedQuantity: 3,
            },
            {
                propertyId: 'bungalow',
                itemId: 'soil',
                materialQuantity: 2,
                equipmentQuantity: 0,
                requestedQuantity: 2,
            },
        ]);
        expect(plan.items[0]).toMatchObject({
            itemId: 'soil',
            requiredRank: { rank: 'Hustler', tier: 2 },
            itemEligibility: 'eligible',
            materialQuantity: 4,
            equipmentQuantity: 1,
            requestedQuantity: 5,
        });
        expect(plan.items[0]?.sellerOptions.map((seller) => ({
            code: seller.option.shopCode,
            rank: seller.priceRank,
            eligibility: seller.eligibility,
            availability: seller.option.availability.kind,
            access: seller.option.access.kind,
            deliverable: seller.option.purchase.canBeDelivered,
        }))).toEqual([
            {
                code: 'cheap',
                rank: 1,
                eligibility: { kind: 'supported', quantityCapacity: 2 },
                availability: 'not-evaluated',
                access: 'route',
                deliverable: true,
            },
            {
                code: 'expensive',
                rank: 2,
                eligibility: { kind: 'supported', quantityCapacity: null },
                availability: 'not-evaluated',
                access: 'route',
                deliverable: true,
            },
        ]);
        expect(plan.allocations).toEqual([
            {
                shopCode: 'cheap',
                itemId: 'soil',
                quantity: 2,
                equipmentQuantity: 1,
                materialQuantity: 1,
                unitPrice: 5,
                totalPrice: 10,
            },
            {
                shopCode: 'expensive',
                itemId: 'soil',
                quantity: 3,
                equipmentQuantity: 0,
                materialQuantity: 3,
                unitPrice: 8,
                totalPrice: 24,
            },
        ]);
    });

    it('does not allocate a negative unknown stock sentinel', () => {
        const planner = purchasePlanner([shop('unknown-stock', 5, -1)]);

        const plan = planner.plan(input(
            exactTransfer([requirement('barn', 2, 0)], 2),
            ['unknown-stock']
        ));

        expect(plan).toMatchObject({
            sellerEvidenceProof: 'incomplete',
            allocationProof: 'minimum-cost-among-supported-sellers',
            fulfillmentProof: 'seller-evidence-incomplete',
            knownAllocatedQuantity: 0,
            unallocatedAfterSupportedPurchases: 2,
            totalFinalUnallocatedQuantity: null,
            minimumRequiredPurchaseCost: null,
        });
        expect(plan.items[0]?.sellerOptions[0]?.eligibility).toEqual({
            kind: 'unknown',
            reason: 'stock-quantity-unknown',
        });
    });

    it('keeps omitted partial eligibility unknown and minimizes among supported sellers only', () => {
        const planner = purchasePlanner([
            shop('cheap-unknown', 3, null),
            shop('known', 8, null),
        ]);

        const plan = planner.plan({
            ...input(exactTransfer([requirement('barn', 2, 0)], 2), ['known']),
            sellerEligibility: { coverage: 'partial', accessibleShopCodes: ['known'] },
        });

        expect(plan.allocations).toEqual([expect.objectContaining({
            shopCode: 'known',
            quantity: 2,
            totalPrice: 16,
        })]);
        expect(plan.items[0]).toMatchObject({
            sellerEvidenceProof: 'incomplete',
            finalUnallocatedQuantity: null,
            minimumRequiredPurchaseCost: null,
        });
        expect(plan.items[0]?.sellerOptions[0]?.eligibility).toEqual({
            kind: 'unknown',
            reason: 'shop-access-evidence-incomplete',
        });
    });

    it('treats a seller omitted by complete eligibility as unavailable, not unknown', () => {
        const planner = purchasePlanner([
            shop('cheap-inaccessible', 3, null),
            shop('known', 8, null),
        ]);

        const plan = planner.plan(input(
            exactTransfer([requirement('barn', 2, 0)], 2),
            ['known']
        ));

        expect(plan).toMatchObject({
            sellerEvidenceProof: 'exact',
            allocationProof: 'minimum-cost',
            knownAllocatedCost: 16,
            minimumRequiredPurchaseCost: 16,
        });
        expect(plan.items[0]?.sellerOptions[0]?.eligibility).toEqual({
            kind: 'unavailable',
            reason: 'shop-inaccessible',
        });
    });

    it('accepts explicit remote access but leaves missing physical access unknown', () => {
        const planner = purchasePlanner([
            shop('missing', 4, null, { position: null }),
            shop('remote-no-delivery', 5, null, {
                locationSource: 'supplier-phone-interface',
                position: null,
                openTime: null,
                closeTime: null,
                canBeDelivered: false,
            }),
            shop('remote', 6, null, {
                locationSource: 'supplier-phone-interface',
                position: null,
                openTime: null,
                closeTime: null,
            }),
        ]);

        const plan = planner.plan(input(
            exactTransfer([requirement('barn', 1, 0)], 1),
            ['missing', 'remote-no-delivery', 'remote']
        ));

        expect(plan.allocations).toEqual([expect.objectContaining({
            shopCode: 'remote',
            quantity: 1,
        })]);
        expect(plan.items[0]?.sellerOptions.map((seller) => seller.eligibility)).toEqual([
            { kind: 'unknown', reason: 'physical-access-data-missing' },
            { kind: 'unavailable', reason: 'remote-delivery-unavailable' },
            { kind: 'supported', quantityCapacity: null },
        ]);
        expect(plan.items[0]?.sellerOptions[2]?.option.access).toEqual({
            kind: 'remote',
            source: 'supplier-phone-interface',
        });
    });

    it('uses opening evidence only when a purchase time is requested', () => {
        const planner = purchasePlanner([
            shop('closed', 4, null, { openTime: 500, closeTime: 600 }),
            shop('unknown-schedule', 6, null, { openTime: null, closeTime: null }),
        ]);

        const plan = planner.plan({
            ...input(
                exactTransfer([requirement('barn', 1, 0)], 1),
                ['closed', 'unknown-schedule']
            ),
            atTime: 700,
        });

        expect(plan.timingProof).toBe('evaluated-at-requested-time');
        expect(plan.allocations).toEqual([]);
        expect(plan.items[0]?.sellerOptions.map((seller) => seller.eligibility)).toEqual([
            { kind: 'unavailable', reason: 'shop-closed-at-requested-time' },
            { kind: 'unknown', reason: 'schedule-data-missing-at-requested-time' },
        ]);
        expect(plan.totalFinalUnallocatedQuantity).toBeNull();
    });

    it('does not evaluate sellers when transfer residual demand is incomplete', () => {
        const transfer = exactTransfer([requirement('barn', 2, 0)], 2);
        const incomplete: FinishedRecipePropertyTransferPlan = {
            ...transfer,
            residualProof: 'transfer-evidence-incomplete',
            totalResidualReorderQuantity: null,
            requirements: transfer.requirements.map((entry) => ({
                ...entry,
                residualMaterialReorderQuantity: null,
                residualEquipmentReorderQuantity: null,
                residualReorderQuantity: null,
            })),
        };

        expect(purchasePlanner([shop('known', 5, null)]).plan(input(incomplete, ['known'])))
            .toMatchObject({
                demandProof: 'transfer-residual-incomplete',
                sellerEvidenceProof: 'not-evaluated',
                allocationProof: 'not-evaluated',
                items: [],
                totalRequestedQuantity: null,
            });
    });

    it('rejects duplicate eligibility and inconsistent exact transfer totals', () => {
        const planner = purchasePlanner([shop('known', 5, null)]);
        const transfer = exactTransfer([requirement('barn', 1, 0)], 1);

        expect(() => planner.plan(input(transfer, ['known', 'known'])))
            .toThrow('Duplicate accessible shop "known"');
        expect(() => planner.plan(input({
            ...transfer,
            totalResidualReorderQuantity: 2,
        }, ['known']))).toThrow('Transfer residual total purchase quantity is inconsistent');

        const unknownItem = planner.plan({
            ...input(transfer, ['known']),
            itemEligibility: { coverage: 'partial', eligibleItemIds: [] },
        });
        expect(unknownItem.allocations).toEqual([]);
        expect(unknownItem.items[0]?.sellerOptions[0]?.eligibility).toEqual({
            kind: 'unknown',
            reason: 'item-eligibility-evidence-incomplete',
        });
    });
});

function purchasePlanner(shops: readonly Shop[]): FinishedRecipePurchasePlanner {
    return new FinishedRecipePurchasePlanner(
        new NavigationNetwork(graph()),
        [item()],
        shops
    );
}

function input(
    transferPlan: FinishedRecipePropertyTransferPlan,
    accessibleShopCodes: readonly string[]
) {
    return {
        transferPlan,
        itemEligibility: { coverage: 'complete' as const, eligibleItemIds: ['soil'] },
        sellerEligibility: { coverage: 'complete' as const, accessibleShopCodes },
        start: position(0, 0),
        maximumStartSnapDistance: 0,
        maximumAccessSnapDistance: 0,
    };
}

function exactTransfer(
    requirements: readonly FinishedRecipePropertyTransferRequirement[],
    total: number
): FinishedRecipePropertyTransferPlan {
    return {
        objective: 'maximize-transferred-reorder-quantity-per-item',
        tieBreak: 'canonical-item-source-destination-candidate-identity-order',
        routeOptimization: 'not-evaluated',
        demandProof: 'exact',
        transferEvidenceProof: 'exact',
        allocationProof: 'maximum',
        residualProof: 'exact',
        residualCostProof: 'exact',
        requirements,
        sources: [],
        allocations: [],
        totalRequestedReorderQuantity: total,
        knownAllocatedQuantity: 0,
        unallocatedAfterKnownTransfersQuantity: total,
        totalResidualReorderQuantity: total,
        totalResidualMaterialReorderCost: total * 10,
        totalResidualEquipmentReorderCost: 0,
        totalResidualReorderCost: total * 10,
    };
}

function requirement(
    propertyId: string,
    material: number,
    equipment: number
): FinishedRecipePropertyTransferRequirement {
    const total = material + equipment;
    return {
        propertyId,
        itemId: 'soil',
        unitPurchasePrice: 10,
        materialReorderQuantity: material,
        equipmentReorderQuantity: equipment,
        requestedReorderQuantity: total,
        allocatedQuantity: 0,
        allocatedEquipmentQuantity: 0,
        allocatedMaterialQuantity: 0,
        unallocatedEquipmentQuantity: equipment,
        unallocatedMaterialQuantity: material,
        unallocatedReorderQuantity: total,
        residualEquipmentReorderQuantity: equipment,
        residualMaterialReorderQuantity: material,
        residualReorderQuantity: total,
        residualEquipmentReorderCost: equipment * 10,
        residualMaterialReorderCost: material * 10,
        residualReorderCost: total * 10,
    };
}

interface ShopOverrides {
    readonly locationSource?: string;
    readonly position?: Vector3 | null;
    readonly openTime?: number | null;
    readonly closeTime?: number | null;
    readonly canBeDelivered?: boolean;
}

function shop(
    code: string,
    price: number,
    defaultStock: number | null,
    overrides: ShopOverrides = {}
): Shop {
    return {
        schema: 'neonschedule1-shop-1',
        code,
        name: code,
        description: '',
        paymentType: 'Cash',
        sceneName: 'Test',
        locationSource: overrides.locationSource ?? 'shopkeeper-schedule',
        position: overrides.position === undefined ? position(0, 0) : overrides.position,
        rotation: null,
        holderPersonId: null,
        openTime: overrides.openTime === undefined ? 500 : overrides.openTime,
        closeTime: overrides.closeTime === undefined ? 1800 : overrides.closeTime,
        deliveryBayPositions: [],
        listings: [{
            itemId: 'soil',
            price,
            defaultStock,
            canBeDelivered: overrides.canBeDelivered ?? true,
        }],
    };
}

function item(): Item {
    return {
        schema: 'neonschedule1-item-3',
        id: 'soil',
        name: 'Soil',
        category: 'Product',
        isRuntimeOnly: false,
        stackLimit: 20,
        isStorable: true,
        basePurchasePrice: 10,
        resellMultiplier: 0.5,
        requiredRank: 'Hustler',
        requiredRankTier: 2,
        product: null,
        packaging: null,
        additive: null,
        soil: { quality: 'Standard', uses: 1 },
        mixingIngredient: null,
        presentation: {
            description: '',
            iconFileId: null,
            visualKind: 'none',
            fallbackMeshIds: [],
            fallbackMaterialIds: [],
        },
    };
}

function graph(): NavigationGraph {
    return {
        schema: 'neonschedule1-navigation-graph-2',
        method: 'test',
        agent: {
            source: 'employee-prefabs',
            typeId: 7,
            name: 'Employee',
            radius: 0.35,
            height: 1.8,
            maximumSlope: 45,
            stepHeight: 0.4,
            employeeTypes: ['Botanist'],
        },
        sampleSpacing: 2,
        queryHeight: 0,
        maxSampleDistance: 12,
        boundsMinimum: position(-1, -1),
        boundsMaximum: position(1, 1),
        gridWidth: 1,
        gridHeight: 1,
        samples: [{ gridX: 0, gridZ: 0, position: position(0, 0), areaMask: 1 }],
        edges: [],
    };
}

function position(x: number, z: number): Vector3 {
    return { x, y: 0, z };
}
