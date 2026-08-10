import { describe, expect, it } from 'vitest';

import {
    planFinishedRecipeInventory,
    type FinishedRecipeEquipmentPlan,
    type Item,
    type ProductionPurchase,
} from '@neonschedule1/core';

describe('finished recipe inventory plans', () => {
    it('subtracts stock, rounds material reorders, and reports stack capacity', () => {
        const soil = item('soil', 10, 10);
        const machine = item('machine', 100, 2);
        const spare = item('spare', 5, 5);

        const plan = planFinishedRecipeInventory(
            indexItems([soil, machine, spare]),
            [purchase('soil', 1.5, 2, 10)],
            equipment([{ itemId: 'machine', unitPurchasePrice: 100 }]),
            [
                { itemId: 'soil', quantity: 1 },
                { itemId: 'machine', quantity: 0 },
                { itemId: 'spare', quantity: 5 },
            ]
        );

        expect(plan).toMatchObject({
            allocationOrder: 'reserve-equipment-before-recurring-materials',
            demandProof: 'exact',
            inventoryProof: 'supplied',
            quantityProof: 'exact',
            costProof: 'exact',
            totalMaterialReorderCost: 10,
            totalEquipmentReorderCost: 100,
            totalReorderCost: 110,
            requiredStackCount: 2,
            currentStackCount: 1,
            reorderStackCount: 2,
            postReorderStackCount: 2,
            additionalStackCount: 1,
        });
        expect(plan.requirements).toEqual([
            {
                itemId: 'machine',
                unitPurchasePrice: 100,
                currentQuantity: 0,
                material: {
                    requiredQuantity: 0,
                    purchaseQuantityBeforeInventory: 0,
                    stockAppliedQuantity: 0,
                    shortageQuantity: 0,
                    reorderQuantity: 0,
                    reorderCost: 0,
                },
                equipment: {
                    requiredQuantity: 1,
                    stockAppliedQuantity: 0,
                    shortageQuantity: 1,
                    reorderQuantity: 1,
                    reorderCost: 100,
                },
                shortageQuantity: 1,
                reorderQuantity: 1,
                reorderCost: 100,
                postReorderSurplusQuantity: 0,
                stacks: {
                    itemStackLimit: 2,
                    requiredStackCount: 1,
                    currentStackCount: 0,
                    reorderStackCount: 1,
                    postReorderStackCount: 1,
                    additionalStackCount: 1,
                    postReorderCapacity: 2,
                    unusedPostReorderCapacity: 1,
                },
            },
            {
                itemId: 'soil',
                unitPurchasePrice: 10,
                currentQuantity: 1,
                material: {
                    requiredQuantity: 1.5,
                    purchaseQuantityBeforeInventory: 2,
                    stockAppliedQuantity: 1,
                    shortageQuantity: 0.5,
                    reorderQuantity: 1,
                    reorderCost: 10,
                },
                equipment: {
                    requiredQuantity: 0,
                    stockAppliedQuantity: 0,
                    shortageQuantity: 0,
                    reorderQuantity: 0,
                    reorderCost: 0,
                },
                shortageQuantity: 0.5,
                reorderQuantity: 1,
                reorderCost: 10,
                postReorderSurplusQuantity: 0.5,
                stacks: {
                    itemStackLimit: 10,
                    requiredStackCount: 1,
                    currentStackCount: 1,
                    reorderStackCount: 1,
                    postReorderStackCount: 1,
                    additionalStackCount: 0,
                    postReorderCapacity: 10,
                    unusedPostReorderCapacity: 8,
                },
            },
        ]);
    });

    it('reserves shared stock for durable equipment before recurring materials', () => {
        const shared = item('shared', 20, 2);

        const plan = planFinishedRecipeInventory(
            indexItems([shared]),
            [purchase('shared', 2.5, 3, 20)],
            equipment([{ itemId: 'shared', unitPurchasePrice: 20 }]),
            [{ itemId: 'shared', quantity: 2 }]
        );

        expect(plan.requirements[0]).toMatchObject({
            currentQuantity: 2,
            material: {
                requiredQuantity: 2.5,
                stockAppliedQuantity: 1,
                shortageQuantity: 1.5,
                reorderQuantity: 2,
                reorderCost: 40,
            },
            equipment: {
                requiredQuantity: 1,
                stockAppliedQuantity: 1,
                shortageQuantity: 0,
                reorderQuantity: 0,
                reorderCost: 0,
            },
            shortageQuantity: 1.5,
            reorderQuantity: 2,
            reorderCost: 40,
            postReorderSurplusQuantity: 0.5,
            stacks: {
                requiredStackCount: 2,
                currentStackCount: 1,
                reorderStackCount: 1,
                postReorderStackCount: 2,
                additionalStackCount: 1,
            },
        });
    });

    it('keeps quantities unknown when inventory or equipment selection is incomplete', () => {
        const material = item('material', 3, 10);
        const purchasePlan = [purchase('material', 2, 2, 3)];

        const absent = planFinishedRecipeInventory(
            indexItems([material]),
            purchasePlan,
            equipment([]),
            undefined
        );
        expect(absent).toMatchObject({
            demandProof: 'exact',
            inventoryProof: 'not-supplied',
            quantityProof: 'inventory-not-supplied',
            costProof: 'reorder-quantity-not-exact',
            totalReorderCost: null,
            requiredStackCount: 1,
            currentStackCount: null,
        });
        expect(absent.requirements[0]).toMatchObject({
            currentQuantity: null,
            shortageQuantity: null,
            reorderQuantity: null,
        });

        const unresolved = planFinishedRecipeInventory(
            indexItems([material]),
            purchasePlan,
            { ...equipment([]), selectionProof: 'partial', unresolvedProductionRouteIds: ['route'] },
            []
        );
        expect(unresolved).toMatchObject({
            demandProof: 'production-equipment-selection-missing',
            inventoryProof: 'supplied',
            quantityProof: 'production-equipment-selection-missing',
            costProof: 'reorder-quantity-not-exact',
            totalReorderCost: null,
            requiredStackCount: null,
        });
    });

    it('needs no inventory for an exact plan with no material or equipment demand', () => {
        expect(planFinishedRecipeInventory(new Map(), [], equipment([]), undefined)).toEqual({
            allocationOrder: 'reserve-equipment-before-recurring-materials',
            demandProof: 'exact',
            inventoryProof: 'not-required',
            quantityProof: 'exact',
            costProof: 'exact',
            requirements: [],
            totalMaterialReorderCost: 0,
            totalEquipmentReorderCost: 0,
            totalReorderCost: 0,
            requiredStackCount: 0,
            currentStackCount: 0,
            reorderStackCount: 0,
            postReorderStackCount: 0,
            additionalStackCount: 0,
        });
    });

    it('only needs a price when unowned inventory must be reordered', () => {
        const unpriced = item('unpriced', null, 10);
        const requiredEquipment = equipment([{ itemId: 'unpriced', unitPurchasePrice: null }]);

        expect(
            planFinishedRecipeInventory(
                indexItems([unpriced]),
                [],
                requiredEquipment,
                [{ itemId: 'unpriced', quantity: 0 }]
            )
        ).toMatchObject({
            quantityProof: 'exact',
            costProof: 'item-price-not-recorded',
            totalMaterialReorderCost: 0,
            totalEquipmentReorderCost: null,
            totalReorderCost: null,
        });
        expect(
            planFinishedRecipeInventory(
                indexItems([unpriced]),
                [],
                requiredEquipment,
                [{ itemId: 'unpriced', quantity: 1 }]
            )
        ).toMatchObject({
            quantityProof: 'exact',
            costProof: 'exact',
            totalEquipmentReorderCost: 0,
            totalReorderCost: 0,
        });
    });

    it('rejects unusable inventory and stack facts', () => {
        const valid = item('valid', 1, 10);
        const items = indexItems([valid]);
        const purchases = [purchase('valid', 1, 1, 1)];

        expect(() =>
            planFinishedRecipeInventory(items, purchases, equipment([]), [
                { itemId: 'valid', quantity: 1 },
                { itemId: 'valid', quantity: 1 },
            ])
        ).toThrow('Inventory contains duplicate item "valid"');
        expect(() =>
            planFinishedRecipeInventory(items, purchases, equipment([]), [
                { itemId: 'valid', quantity: -1 },
            ])
        ).toThrow('Inventory item "valid" quantity must be a non-negative safe integer');
        expect(() =>
            planFinishedRecipeInventory(items, purchases, equipment([]), [
                { itemId: 'missing', quantity: 1 },
            ])
        ).toThrow('Unknown inventory item "missing"');
        expect(() =>
            planFinishedRecipeInventory(
                indexItems([{ ...valid, stackLimit: 0 }]),
                purchases,
                equipment([]),
                []
            )
        ).toThrow('Inventory item "valid" stack limit must be a positive safe integer');
        expect(() =>
            planFinishedRecipeInventory(
                indexItems([{ ...valid, isStorable: false }]),
                purchases,
                equipment([]),
                []
            )
        ).toThrow('Required inventory item "valid" is not storable');
    });
});

function equipment(
    requirements: readonly { readonly itemId: string; readonly unitPurchasePrice: number | null }[]
): FinishedRecipeEquipmentPlan {
    const total = requirements.reduce(
        (sum, requirement) => sum + (requirement.unitPurchasePrice ?? 0),
        0
    );
    const priceMissing = requirements.some((requirement) => requirement.unitPurchasePrice === null);
    return {
        quantityBasis: 'minimum-one-per-selected-item-for-serial-plan',
        selectionProof: 'exact',
        unresolvedProductionRouteIds: [],
        purchaseCostProof: priceMissing ? 'equipment-price-not-recorded' : 'exact',
        requirements: requirements.map((requirement) => ({
            itemId: requirement.itemId,
            roles: ['base-production'],
            requiredQuantity: 1,
            unitPurchasePrice: requirement.unitPurchasePrice,
            requiredPurchaseCost: requirement.unitPurchasePrice,
        })),
        totalRequiredPurchaseCost: priceMissing ? null : total,
    };
}

function purchase(
    itemId: string,
    requiredQuantity: number,
    purchaseQuantity: number,
    unitCost: number
): ProductionPurchase {
    return {
        itemId,
        requiredQuantity,
        purchaseQuantity,
        leftoverQuantity: purchaseQuantity - requiredQuantity,
        unitCost,
        requiredCost: requiredQuantity * unitCost,
        purchaseCost: purchaseQuantity * unitCost,
    };
}

function indexItems(items: readonly Item[]): ReadonlyMap<string, Item> {
    return new Map(items.map((entry) => [entry.id, entry]));
}

function item(id: string, basePurchasePrice: number | null, stackLimit: number): Item {
    return {
        schema: 'neonschedule1-item-3',
        id,
        name: id,
        category: 'Test',
        isRuntimeOnly: false,
        stackLimit,
        isStorable: true,
        basePurchasePrice,
        resellMultiplier: 1,
        requiredRank: null,
        requiredRankTier: null,
        product: null,
        packaging: null,
        additive: null,
        soil: null,
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
