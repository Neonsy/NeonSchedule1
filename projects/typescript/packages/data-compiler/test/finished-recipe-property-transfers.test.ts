import { describe, expect, it } from 'vitest';

import {
    planFinishedRecipeInventory,
    planFinishedRecipePropertyTransfers,
    type FinishedRecipeEquipmentPlan,
    type FinishedRecipeInventoryPlan,
    type Item,
    type ProductionPurchase,
} from '@neonschedule1/core';

describe('finished recipe property transfer plans', () => {
    it('maximizes fulfilled shortages when a greedy source-first assignment would fail', () => {
        const product = item('product', 10, 20);
        const items = indexItems([product]);
        const demand = inventory(items, [purchase('product', 1, 10)]);

        const plan = planFinishedRecipePropertyTransfers(
            items,
            [
                { propertyId: 'x', inventory: demand },
                { propertyId: 'y', inventory: demand },
            ],
            [
                { propertyId: 'a', itemId: 'product', transferableQuantity: 1 },
                { propertyId: 'b', itemId: 'product', transferableQuantity: 1 },
            ],
            {
                coverage: 'complete',
                candidates: [
                    candidate('a-x', 'product', 'a', 'x', 1),
                    candidate('a-y', 'product', 'a', 'y', 1),
                    candidate('b-x', 'product', 'b', 'x', 1),
                ],
            }
        );

        expect(plan).toMatchObject({
            objective: 'maximize-transferred-reorder-quantity-per-item',
            tieBreak: 'canonical-item-source-destination-candidate-identity-order',
            routeOptimization: 'not-evaluated',
            demandProof: 'exact',
            transferEvidenceProof: 'exact',
            allocationProof: 'maximum',
            residualProof: 'exact',
            residualCostProof: 'exact',
            totalRequestedReorderQuantity: 2,
            knownAllocatedQuantity: 2,
            unallocatedAfterKnownTransfersQuantity: 0,
            totalResidualReorderQuantity: 0,
            totalResidualReorderCost: 0,
        });
        expect(plan.allocations).toEqual([
            {
                candidateId: 'a-y',
                itemId: 'product',
                sourcePropertyId: 'a',
                destinationPropertyId: 'y',
                quantity: 1,
                itemStackLimit: 20,
                stackCount: 1,
            },
            {
                candidateId: 'b-x',
                itemId: 'product',
                sourcePropertyId: 'b',
                destinationPropertyId: 'x',
                quantity: 1,
                itemStackLimit: 20,
                stackCount: 1,
            },
        ]);
        expect(plan.requirements.map((requirement) => ({
            propertyId: requirement.propertyId,
            allocatedQuantity: requirement.allocatedQuantity,
            residualReorderQuantity: requirement.residualReorderQuantity,
        }))).toEqual([
            { propertyId: 'x', allocatedQuantity: 1, residualReorderQuantity: 0 },
            { propertyId: 'y', allocatedQuantity: 1, residualReorderQuantity: 0 },
        ]);
    });

    it('uses canonical identities to choose one of equal maximum allocations', () => {
        const product = item('product', 10, 20);
        const items = indexItems([product]);
        const plan = planFinishedRecipePropertyTransfers(
            items,
            [{ propertyId: 'destination', inventory: inventory(items, [purchase('product', 1, 10)]) }],
            [
                { propertyId: 'a', itemId: 'product', transferableQuantity: 1 },
                { propertyId: 'b', itemId: 'product', transferableQuantity: 1 },
            ],
            {
                coverage: 'complete',
                candidates: [
                    candidate('b-route', 'product', 'b', 'destination', 1),
                    candidate('a-route', 'product', 'a', 'destination', 1),
                ],
            }
        );

        expect(plan.allocations).toHaveLength(1);
        expect(plan.allocations[0]).toMatchObject({
            candidateId: 'a-route',
            sourcePropertyId: 'a',
        });
        expect(plan.sources).toEqual([
            {
                propertyId: 'a',
                itemId: 'product',
                transferableQuantity: 1,
                allocatedQuantity: 1,
                remainingTransferableQuantity: 0,
            },
            {
                propertyId: 'b',
                itemId: 'product',
                transferableQuantity: 1,
                allocatedQuantity: 0,
                remainingTransferableQuantity: 1,
            },
        ]);
    });

    it('matches every capacity-one two-source two-destination maximum', () => {
        const product = item('product', 10, 20);
        const items = indexItems([product]);
        const demand = inventory(items, [purchase('product', 1, 10)]);
        const pairs = [
            ['a', 'x'],
            ['a', 'y'],
            ['b', 'x'],
            ['b', 'y'],
        ] as const;

        for (let mask = 0; mask < 16; mask += 1) {
            const availablePairs = pairs.filter((_, index) => (mask & (1 << index)) !== 0);
            const plan = planFinishedRecipePropertyTransfers(
                items,
                [
                    { propertyId: 'x', inventory: demand },
                    { propertyId: 'y', inventory: demand },
                ],
                [
                    { propertyId: 'a', itemId: 'product', transferableQuantity: 1 },
                    { propertyId: 'b', itemId: 'product', transferableQuantity: 1 },
                ],
                {
                    coverage: 'complete',
                    candidates: availablePairs.map(([source, destination]) =>
                        candidate(`${source}-${destination}`, 'product', source, destination, 1)
                    ),
                }
            );
            const hasDisjointPair = availablePairs.some(([leftSource, leftDestination]) =>
                availablePairs.some(([rightSource, rightDestination]) =>
                    leftSource !== rightSource && leftDestination !== rightDestination
                )
            );
            const expected = hasDisjointPair ? 2 : availablePairs.length > 0 ? 1 : 0;
            expect(plan.knownAllocatedQuantity, `edge mask ${mask}`).toBe(expected);
            expect(plan.allocationProof).toBe('maximum');
        }
    });

    it('reserves incoming items for equipment before material and prices the exact residual', () => {
        const shared = item('shared', 25, 2);
        const items = indexItems([shared]);
        const demand = planFinishedRecipeInventory(
            items,
            [purchase('shared', 1, 25)],
            equipment('shared', 25),
            []
        );

        const plan = planFinishedRecipePropertyTransfers(
            items,
            [{ propertyId: 'lab', inventory: demand }],
            [{ propertyId: 'warehouse', itemId: 'shared', transferableQuantity: 1 }],
            {
                coverage: 'complete',
                candidates: [candidate('warehouse-lab', 'shared', 'warehouse', 'lab', 1)],
            }
        );

        expect(plan.requirements).toEqual([
            {
                propertyId: 'lab',
                itemId: 'shared',
                unitPurchasePrice: 25,
                materialReorderQuantity: 1,
                equipmentReorderQuantity: 1,
                requestedReorderQuantity: 2,
                allocatedQuantity: 1,
                allocatedEquipmentQuantity: 1,
                allocatedMaterialQuantity: 0,
                unallocatedEquipmentQuantity: 0,
                unallocatedMaterialQuantity: 1,
                unallocatedReorderQuantity: 1,
                residualEquipmentReorderQuantity: 0,
                residualMaterialReorderQuantity: 1,
                residualReorderQuantity: 1,
                residualEquipmentReorderCost: 0,
                residualMaterialReorderCost: 25,
                residualReorderCost: 25,
            },
        ]);
        expect(plan.allocations[0]).toMatchObject({ quantity: 1, stackCount: 1 });
        expect(plan).toMatchObject({
            totalResidualMaterialReorderCost: 25,
            totalResidualEquipmentReorderCost: 0,
            totalResidualReorderCost: 25,
        });
    });

    it('keeps the shopping residual unknown when transfer evidence is partial', () => {
        const product = item('product', 10, 20);
        const items = indexItems([product]);
        const demand = inventory(items, [purchase('product', 1, 10)]);
        const plan = planFinishedRecipePropertyTransfers(
            items,
            [
                { propertyId: 'x', inventory: demand },
                { propertyId: 'y', inventory: demand },
            ],
            [{ propertyId: 'source', itemId: 'product', transferableQuantity: 2 }],
            {
                coverage: 'partial',
                candidates: [candidate('known', 'product', 'source', 'x', 1)],
            }
        );

        expect(plan).toMatchObject({
            demandProof: 'exact',
            transferEvidenceProof: 'partial',
            allocationProof: 'known-feasible-lower-bound',
            residualProof: 'transfer-evidence-incomplete',
            residualCostProof: 'residual-quantity-not-exact',
            totalRequestedReorderQuantity: 2,
            knownAllocatedQuantity: 1,
            unallocatedAfterKnownTransfersQuantity: 1,
            totalResidualReorderQuantity: null,
            totalResidualReorderCost: null,
        });
        expect(plan.requirements.find(({ propertyId }) => propertyId === 'y')).toMatchObject({
            unallocatedReorderQuantity: 1,
            residualReorderQuantity: null,
            residualReorderCost: null,
        });
    });

    it('does not allocate when any destination inventory demand is incomplete', () => {
        const product = item('product', 10, 20);
        const items = indexItems([product]);
        const incomplete = planFinishedRecipeInventory(
            items,
            [purchase('product', 1, 10)],
            equipment(),
            undefined
        );
        const plan = planFinishedRecipePropertyTransfers(
            items,
            [{ propertyId: 'destination', inventory: incomplete }],
            [{ propertyId: 'source', itemId: 'product', transferableQuantity: 1 }],
            {
                coverage: 'complete',
                candidates: [candidate('route', 'product', 'source', 'destination', 1)],
            }
        );

        expect(plan).toMatchObject({
            demandProof: 'inventory-plan-incomplete',
            allocationProof: 'not-evaluated',
            residualProof: 'inventory-plan-incomplete',
            residualCostProof: 'residual-quantity-not-exact',
            allocations: [],
            totalRequestedReorderQuantity: null,
            knownAllocatedQuantity: 0,
            unallocatedAfterKnownTransfersQuantity: null,
            totalResidualReorderQuantity: null,
        });
    });

    it('requires a price only when the exact transfer residual still needs purchasing', () => {
        const unpriced = item('unpriced', null, 10);
        const items = indexItems([unpriced]);
        const demand = planFinishedRecipeInventory(
            items,
            [],
            equipment('unpriced'),
            []
        );
        const destination = { propertyId: 'destination', inventory: demand };

        expect(planFinishedRecipePropertyTransfers(
            items,
            [destination],
            [{ propertyId: 'source', itemId: 'unpriced', transferableQuantity: 0 }],
            { coverage: 'complete', candidates: [] }
        )).toMatchObject({
            residualProof: 'exact',
            residualCostProof: 'item-price-not-recorded',
            totalResidualReorderQuantity: 1,
            totalResidualEquipmentReorderCost: null,
            totalResidualReorderCost: null,
        });

        expect(planFinishedRecipePropertyTransfers(
            items,
            [destination],
            [{ propertyId: 'source', itemId: 'unpriced', transferableQuantity: 1 }],
            {
                coverage: 'complete',
                candidates: [candidate('route', 'unpriced', 'source', 'destination', 1)],
            }
        )).toMatchObject({
            residualProof: 'exact',
            residualCostProof: 'exact',
            totalResidualReorderQuantity: 0,
            totalResidualEquipmentReorderCost: 0,
            totalResidualReorderCost: 0,
        });
    });

    it('rejects ambiguous or invalid property transfer facts', () => {
        const product = item('product', 10, 20);
        const items = indexItems([product]);
        const destination = {
            propertyId: 'destination',
            inventory: inventory(items, [purchase('product', 1, 10)]),
        };
        const supply = { propertyId: 'source', itemId: 'product', transferableQuantity: 1 };

        expect(() => planFinishedRecipePropertyTransfers(
            items,
            [destination, destination],
            [supply],
            { coverage: 'complete', candidates: [] }
        )).toThrow('Property transfer destinations contain duplicate property "destination"');
        expect(() => planFinishedRecipePropertyTransfers(
            items,
            [destination],
            [supply, supply],
            { coverage: 'complete', candidates: [] }
        )).toThrow('Property transfer supplies contain duplicate property item');
        expect(() => planFinishedRecipePropertyTransfers(
            items,
            [destination],
            [{ ...supply, transferableQuantity: -1 }],
            { coverage: 'complete', candidates: [] }
        )).toThrow('quantity must be a non-negative safe integer');
        expect(() => planFinishedRecipePropertyTransfers(
            items,
            [destination],
            [supply],
            { coverage: 'invalid' as 'complete', candidates: [] }
        )).toThrow('evidence coverage must be complete or partial');
        expect(() => planFinishedRecipePropertyTransfers(
            items,
            [destination],
            [supply, { propertyId: 'destination', itemId: 'product', transferableQuantity: 1 }],
            {
                coverage: 'complete',
                candidates: [candidate('self', 'product', 'destination', 'destination', 1)],
            }
        )).toThrow('cannot transfer within one property');
        expect(() => planFinishedRecipePropertyTransfers(
            items,
            [destination],
            [supply],
            {
                coverage: 'complete',
                candidates: [
                    candidate('one', 'product', 'source', 'destination', 1),
                    candidate('two', 'product', 'source', 'destination', 1),
                ],
            }
        )).toThrow('duplicate item source-destination pair');
        expect(() => planFinishedRecipePropertyTransfers(
            items,
            [destination],
            [supply],
            {
                coverage: 'complete',
                candidates: [candidate('route', 'product', 'source', 'destination', -1)],
            }
        )).toThrow('quantity capacity must be a non-negative safe integer');

        const maximum = Number.MAX_SAFE_INTEGER;
        const overflowItem = item('overflow', 0, 1);
        const overflowItems = indexItems([overflowItem]);
        const maximumDemand = inventory(overflowItems, [purchase('overflow', maximum, 0)]);
        expect(() => planFinishedRecipePropertyTransfers(
            overflowItems,
            [{ propertyId: 'destination', inventory: maximumDemand }],
            [
                { propertyId: 'a', itemId: 'overflow', transferableQuantity: maximum },
                { propertyId: 'b', itemId: 'overflow', transferableQuantity: maximum },
            ],
            {
                coverage: 'complete',
                candidates: [
                    candidate('a', 'overflow', 'a', 'destination', maximum),
                    candidate('b', 'overflow', 'b', 'destination', maximum),
                ],
            }
        )).toThrow('source quantity must be a safe integer');
    });
});

function inventory(
    items: ReadonlyMap<string, Item>,
    purchases: readonly ProductionPurchase[]
): FinishedRecipeInventoryPlan {
    return planFinishedRecipeInventory(items, purchases, equipment(), []);
}

function equipment(
    itemId?: string,
    unitPurchasePrice?: number
): FinishedRecipeEquipmentPlan {
    const requirements = itemId === undefined
        ? []
        : [{
              itemId,
              roles: ['base-production'] as const,
              requiredQuantity: 1 as const,
              unitPurchasePrice: unitPurchasePrice ?? null,
              requiredPurchaseCost: unitPurchasePrice ?? null,
          }];
    return {
        quantityBasis: 'minimum-one-per-selected-item-for-serial-plan',
        selectionProof: 'exact',
        unresolvedProductionRouteIds: [],
        purchaseCostProof: itemId === undefined || unitPurchasePrice !== undefined
            ? 'exact'
            : 'equipment-price-not-recorded',
        requirements,
        totalRequiredPurchaseCost: itemId === undefined ? 0 : (unitPurchasePrice ?? null),
    };
}

function candidate(
    candidateId: string,
    itemId: string,
    sourcePropertyId: string,
    destinationPropertyId: string,
    quantityCapacity: number | null
) {
    return {
        candidateId,
        itemId,
        sourcePropertyId,
        destinationPropertyId,
        quantityCapacity,
    };
}

function purchase(itemId: string, quantity: number, unitCost: number): ProductionPurchase {
    return {
        itemId,
        requiredQuantity: quantity,
        purchaseQuantity: quantity,
        leftoverQuantity: 0,
        unitCost,
        requiredCost: quantity * unitCost,
        purchaseCost: quantity * unitCost,
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
