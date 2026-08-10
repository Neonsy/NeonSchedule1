import { describe, expect, it } from 'vitest';

import {
    BRICK_PRESS_OPERATION_RULES,
    FinishedRecipeProductionPlanner,
    PACKAGING_OPERATION_RULES,
    ProductionBatchPlanner,
    ProductionMaterialCostEvaluator,
    type Item,
    type ProductionCatalog,
    type RecipeEvaluation,
} from '@neonschedule1/core';

const dataset = { gameVersion: 'test', datasetSha256: 'a'.repeat(64) };

describe('finished recipe production plans', () => {
    it('composes base production with ordered repeated mixing operations', () => {
        const { planner, recipe } = fixture();

        const plan = planner.plan(recipe, 3, { mixingStationItemId: 'mixer' });

        expect(plan).toMatchObject({
            dataset,
            finishedQuantity: 3,
            baseProductPlan: {
                targetItemId: 'product',
                targetQuantity: 3,
                totalProcessMinutes: 20,
                requiredMaterialCost: 12,
                productionSteps: [
                    {
                        itemId: 'product',
                        batchCount: 2,
                        producedQuantity: 4,
                        leftoverQuantity: 1,
                    },
                ],
            },
            ingredientDemands: [
                {
                    itemId: 'banana',
                    occurrencesPerFinishedItem: 2,
                    requiredQuantity: 6,
                    unitCost: 2,
                    requiredCost: 12,
                },
                {
                    itemId: 'cuke',
                    occurrencesPerFinishedItem: 1,
                    requiredQuantity: 3,
                    unitCost: 3,
                    requiredCost: 9,
                },
            ],
            purchases: [
                {
                    itemId: 'banana',
                    requiredQuantity: 6,
                    purchaseQuantity: 6,
                    purchaseCost: 12,
                },
                {
                    itemId: 'cuke',
                    requiredQuantity: 3,
                    purchaseQuantity: 3,
                    purchaseCost: 9,
                },
                {
                    itemId: 'seed',
                    requiredQuantity: 2,
                    purchaseQuantity: 2,
                    purchaseCost: 10,
                },
                {
                    itemId: 'soil',
                    requiredQuantity: 2,
                    purchaseQuantity: 2,
                    purchaseCost: 2,
                },
            ],
            mixingSteps: [
                {
                    sequence: 0,
                    ingredientId: 'banana',
                    capacityPerBatch: 2,
                    batchQuantities: [2, 1],
                    inputProductQuantity: 3,
                    ingredientQuantity: 3,
                    outputProductQuantity: 3,
                    totalProcessMinutes: 18,
                },
                { sequence: 1, ingredientId: 'cuke', totalProcessMinutes: 18 },
                { sequence: 2, ingredientId: 'banana', totalProcessMinutes: 18 },
            ],
            duration: {
                baseProductProcessMinutes: 20,
                mixingProcessMinutes: 54,
                dryingProcessMinutes: null,
                knownProcessMinutes: 74,
                modeledTotalProcessMinutes: 74,
            },
            cost: {
                recipeEstimatedUnitMaterialCost: 10,
                recipeEstimatedMaterialCost: 30,
                requiredMaterialCost: 33,
                materialPurchaseCost: 33,
                equipmentPurchaseCost: null,
                combinedPurchaseCost: null,
            },
            evidence: {
                modeledScope: 'base-product-and-ordered-mixing',
                modeledQuantityProof: 'exact',
                materialCostCoverage: 'modeled-materials-only',
                modeledDurationProof: 'complete',
                finishedLifecycleProof: 'partial',
                missingFacts: ['equipment-ownership'],
                dryingApplicability: 'available-not-selected',
                packagingApplicability: 'available-not-selected',
            },
        });
        expect(plan.evidence.unmodeledOperations).toEqual([
            unmodeled('drying', 'available-not-selected'),
            unmodeled('packaging', 'available-not-selected'),
            unmodeled('brick-pressing', 'available-not-selected'),
            unmodeled('equipment-purchase'),
            unmodeled('transport'),
        ]);
        expect(planner.plan(recipe, 3, { mixingStationItemId: 'mixer' })).toEqual(plan);
    });

    it('adds a selected same-item drying quality upgrade after ordered mixing', () => {
        const { planner, recipe } = fixture();

        const plan = planner.plan(recipe, 3, {
            mixingStationItemId: 'mixer',
            drying: {
                stationItemId: 'dryer',
                startingQuality: 'Standard',
                targetQuality: 'Heavenly',
                averageTemperature: 40,
            },
        });

        expect(plan.dryingStep).toEqual({
            position: 'after-ordered-mixing',
            stationItemId: 'dryer',
            itemId: 'product',
            startingQuality: 'Standard',
            targetQuality: 'Heavenly',
            qualityTierCount: 2,
            capacityPerBatch: 2,
            batchQuantities: [2, 1],
            inputQuantity: 3,
            outputQuantity: 3,
            averageTemperature: 40,
            processMultiplier: 2.5,
            baseMinutesPerTier: 720,
            effectiveMinutesPerTier: 288,
            minutesPerBatch: 576,
            totalProcessMinutes: 1_152,
        });
        expect(plan.duration).toEqual({
            baseProductProcessMinutes: 20,
            mixingProcessMinutes: 54,
            dryingProcessMinutes: 1_152,
            packagingEmployeeRealSeconds: null,
            brickPressingEmployeeRealSeconds: null,
            knownProcessMinutes: 1_226,
            modeledTotalProcessMinutes: 1_226,
        });
        expect(plan.evidence).toMatchObject({
            modeledScope: 'base-product-ordered-mixing-and-selected-drying',
            dryingApplicability: 'selected',
            finishedLifecycleProof: 'partial',
        });
        expect(plan.evidence.unmodeledOperations.map(({ operation }) => operation)).not.toContain(
            'drying'
        );

        expect(
            planner.plan(recipe, 3, {
                mixingStationItemId: 'mixer',
                drying: {
                    stationItemId: 'dryer',
                    startingQuality: 'Standard',
                    targetQuality: 'Premium',
                    averageTemperature: 20,
                },
            }).dryingStep
        ).toMatchObject({
            qualityTierCount: 1,
            processMultiplier: 1,
            effectiveMinutesPerTier: 720,
            totalProcessMinutes: 1_440,
        });
    });

    it('packages the largest supported whole quantity with exact material and employee time', () => {
        const { planner, recipe } = fixture();

        const plan = planner.plan(recipe, 21, {
            mixingStationItemId: 'mixer',
            packaging: {
                stationItemId: 'packager-mk2',
                packagingItemId: 'jar',
                employeePackagingSpeedMultiplier: 1.25,
                employeeCurrentWorkSpeed: 0.8,
            },
        });

        expect(plan.packagingStep).toEqual({
            position: 'after-optional-drying',
            stationItemId: 'packager-mk2',
            stationKind: 'packaging-mk2',
            productItemId: 'product',
            packagingItemId: 'jar',
            inputProductState: 'unpackaged',
            outputProductState: 'packaged',
            inputProductQuantity: 21,
            productQuantityPerPackage: 5,
            packageCount: 4,
            packagedProductQuantity: 20,
            unpackagedRemainderQuantity: 1,
            packagingMaterialQuantity: 4,
            outputSlotCapacityPackages: 20,
            outputBatchPackageCounts: [4],
            employeeBaseSecondsPerPackage: 5,
            employeePackagingSpeedMultiplier: 1.25,
            stationEmployeeSpeedMultiplier: 2,
            employeeCurrentWorkSpeed: 0.8,
            employeeSecondsPerPackage: 2.5,
            totalEmployeeRealSeconds: 10,
        });
        expect(plan.purchases).toContainEqual(
            expect.objectContaining({
                itemId: 'jar',
                requiredQuantity: 4,
                purchaseQuantity: 4,
                requiredCost: 12,
                purchaseCost: 12,
            })
        );
        expect(plan.duration.packagingEmployeeRealSeconds).toBe(10);
        expect(plan.evidence).toMatchObject({
            modeledScope: 'base-product-ordered-mixing-and-selected-packaging',
            packagingApplicability: 'selected',
            brickPressingApplicability: 'not-applicable',
        });
        expect(plan.evidence.unmodeledOperations.map(({ operation }) => operation)).not.toContain(
            'packaging'
        );
        expect(plan.evidence.unmodeledOperations.map(({ operation }) => operation)).not.toContain(
            'brick-pressing'
        );
        expect(
            planner.plan(recipe, 21, {
                packaging: {
                    stationItemId: 'packager-mk2',
                    packagingItemId: 'baggie',
                    employeePackagingSpeedMultiplier: 1,
                    employeeCurrentWorkSpeed: 1,
                },
            }).packagingStep
        ).toMatchObject({
            packageCount: 21,
            packagedProductQuantity: 21,
            unpackagedRemainderQuantity: 0,
            outputBatchPackageCounts: [20, 1],
        });
        expect(
            planner.plan(recipe, 3, {
                drying: {
                    stationItemId: 'dryer',
                    startingQuality: 'Standard',
                    targetQuality: 'Premium',
                    averageTemperature: 20,
                },
                packaging: {
                    stationItemId: 'packager-mk2',
                    packagingItemId: 'baggie',
                    employeePackagingSpeedMultiplier: 1,
                    employeeCurrentWorkSpeed: 1,
                },
            }).evidence.modeledScope
        ).toBe('base-product-ordered-mixing-selected-drying-and-packaging');
    });

    it('presses whole bricks without consuming packaging material and leaves loose remainder', () => {
        const { planner, recipe } = fixture();

        const plan = planner.plan(recipe, 41, {
            mixingStationItemId: 'mixer',
            brickPressing: {
                stationItemId: 'brick-press',
                employeePackagingSpeedMultiplier: 1.25,
                employeeCurrentWorkSpeed: 0.8,
            },
        });

        expect(plan.brickPressingStep).toEqual({
            position: 'after-optional-drying',
            stationItemId: 'brick-press',
            stationKind: 'brick-press',
            productItemId: 'product',
            outputPackagingItemId: 'brick',
            inputProductState: 'unpackaged',
            outputProductState: 'packaged',
            inputProductQuantity: 41,
            productQuantityPerBrick: 20,
            brickCount: 2,
            pressedProductQuantity: 40,
            unpackagedRemainderQuantity: 1,
            packagingMaterialConsumption: 'none',
            outputSlotCapacityBricks: 20,
            outputBatchBrickCounts: [2],
            employeeBaseSecondsPerBrick: 15,
            employeeCompletionOverheadSecondsPerBrick: 1.2,
            employeePackagingSpeedMultiplier: 1.25,
            employeeCurrentWorkSpeed: 0.8,
            employeeSecondsPerBrick: 16.2,
            totalEmployeeRealSeconds: 32.4,
            manualDuration: 'interactive-not-fixed',
        });
        expect(plan.purchases.map(({ itemId }) => itemId)).not.toContain('brick');
        expect(plan.duration.brickPressingEmployeeRealSeconds).toBe(32.4);
        expect(plan.evidence).toMatchObject({
            modeledScope: 'base-product-ordered-mixing-and-selected-brick-pressing',
            packagingApplicability: 'not-applicable',
            brickPressingApplicability: 'selected',
        });
        expect(plan.evidence.unmodeledOperations.map(({ operation }) => operation)).not.toContain(
            'brick-pressing'
        );
        expect(plan.evidence.unmodeledOperations.map(({ operation }) => operation)).not.toContain(
            'packaging'
        );
        expect(
            planner.plan(recipe, 20, {
                drying: {
                    stationItemId: 'dryer',
                    startingQuality: 'Standard',
                    targetQuality: 'Premium',
                    averageTemperature: 20,
                },
                brickPressing: {
                    stationItemId: 'brick-press',
                    employeePackagingSpeedMultiplier: 1,
                    employeeCurrentWorkSpeed: 1,
                },
            }).evidence.modeledScope
        ).toBe('base-product-ordered-mixing-selected-drying-and-brick-pressing');
    });

    it('deduplicates selected equipment and subtracts caller-supplied ownership', () => {
        const { planner, recipe } = fixture();

        const plan = planner.plan(recipe, 20, {
            mixingStationItemId: 'mixer',
            drying: {
                stationItemId: 'dryer',
                startingQuality: 'Standard',
                targetQuality: 'Premium',
                averageTemperature: 20,
            },
            brickPressing: {
                stationItemId: 'brick-press',
                employeePackagingSpeedMultiplier: 1,
                employeeCurrentWorkSpeed: 1,
            },
            ownedEquipment: [
                { itemId: 'pot', quantity: 1 },
                { itemId: 'mixer', quantity: 0 },
                { itemId: 'dryer', quantity: 2 },
                { itemId: 'brick-press', quantity: 0 },
                { itemId: 'packager-mk2', quantity: 1 },
            ],
        });

        expect(plan.equipment).toEqual({
            quantityBasis: 'minimum-one-per-selected-item-for-serial-plan',
            selectionProof: 'exact',
            unresolvedProductionRouteIds: [],
            ownershipProof: 'supplied',
            purchaseCostProof: 'exact',
            requirements: [
                {
                    itemId: 'brick-press',
                    roles: ['brick-pressing'],
                    requiredQuantity: 1,
                    ownedQuantity: 0,
                    missingQuantity: 1,
                    unitPurchasePrice: 500,
                    missingPurchaseCost: 500,
                },
                {
                    itemId: 'dryer',
                    roles: ['drying'],
                    requiredQuantity: 1,
                    ownedQuantity: 2,
                    missingQuantity: 0,
                    unitPurchasePrice: null,
                    missingPurchaseCost: 0,
                },
                {
                    itemId: 'mixer',
                    roles: ['mixing'],
                    requiredQuantity: 1,
                    ownedQuantity: 0,
                    missingQuantity: 1,
                    unitPurchasePrice: 200,
                    missingPurchaseCost: 200,
                },
                {
                    itemId: 'pot',
                    roles: ['base-production'],
                    requiredQuantity: 1,
                    ownedQuantity: 1,
                    missingQuantity: 0,
                    unitPurchasePrice: 100,
                    missingPurchaseCost: 0,
                },
            ],
            totalMissingPurchaseCost: 700,
        });
        expect(plan.cost).toEqual({
            recipeEstimatedUnitMaterialCost: 10,
            recipeEstimatedMaterialCost: 200,
            requiredMaterialCost: 200,
            materialPurchaseCost: 200,
            equipmentPurchaseCost: 700,
            combinedPurchaseCost: 900,
        });
        expect(plan.evidence.missingFacts).toEqual([]);
        expect(plan.evidence.unmodeledOperations.map(({ operation }) => operation)).not.toContain(
            'equipment-purchase'
        );
    });

    it('returns partial modeled duration when no mixing-station fact is supplied', () => {
        const { planner, recipe } = fixture();

        expect(planner.plan(recipe, 3)).toMatchObject({
            mixingSteps: [],
            duration: {
                baseProductProcessMinutes: 20,
                mixingProcessMinutes: null,
                dryingProcessMinutes: null,
                knownProcessMinutes: 20,
                modeledTotalProcessMinutes: null,
            },
            evidence: {
                modeledDurationProof: 'partial',
                finishedLifecycleProof: 'partial',
                missingFacts: ['mixing-station', 'equipment-ownership'],
            },
        });
    });

    it('retains an unknown equipment total when base-production equipment is not selected', () => {
        const { planner, recipe } = fixture(false);

        const plan = planner.plan(recipe, 3, {
            mixingStationItemId: 'mixer',
            ownedEquipment: [{ itemId: 'mixer', quantity: 1 }],
        });

        expect(plan.equipment).toMatchObject({
            selectionProof: 'partial',
            unresolvedProductionRouteIds: ['seed:seed:product:soil'],
            ownershipProof: 'supplied',
            purchaseCostProof: 'production-equipment-selection-missing',
            totalMissingPurchaseCost: null,
        });
        expect(plan.cost).toMatchObject({
            materialPurchaseCost: 33,
            equipmentPurchaseCost: null,
            combinedPurchaseCost: null,
        });
        expect(plan.evidence.missingFacts).toEqual(['production-equipment-selection']);
        expect(plan.evidence.unmodeledOperations.map(({ operation }) => operation)).toContain(
            'equipment-purchase'
        );
    });

    it('retains an unknown equipment total when a missing item has no recorded price', () => {
        const { planner, recipe } = fixture();

        const plan = planner.plan(recipe, 3, {
            mixingStationItemId: 'mixer',
            drying: {
                stationItemId: 'dryer',
                startingQuality: 'Standard',
                targetQuality: 'Premium',
                averageTemperature: 20,
            },
            ownedEquipment: [
                { itemId: 'pot', quantity: 1 },
                { itemId: 'mixer', quantity: 1 },
                { itemId: 'dryer', quantity: 0 },
            ],
        });

        expect(plan.equipment).toMatchObject({
            purchaseCostProof: 'equipment-price-not-recorded',
            totalMissingPurchaseCost: null,
        });
        expect(plan.evidence.missingFacts).toEqual(['equipment-purchase-price']);
    });

    it('needs no mixing station for a recipe with no ingredients', () => {
        const product = item('product', 8, 'product');
        const catalog = emptyCatalog();
        const costs = new ProductionMaterialCostEvaluator(new Map([[product.id, product]]), catalog);
        const planner = new FinishedRecipeProductionPlanner(
            new ProductionBatchPlanner(costs, dataset),
            new Map([[product.id, product]]),
            catalog
        );

        expect(planner.plan(recipe([], 8, 'base-purchase-price'), 1)).toMatchObject({
            mixingSteps: [],
            equipment: {
                requirements: [],
                ownershipProof: 'not-required',
                purchaseCostProof: 'exact',
                totalMissingPurchaseCost: 0,
            },
            cost: {
                materialPurchaseCost: 8,
                equipmentPurchaseCost: 0,
                combinedPurchaseCost: 8,
            },
            duration: {
                baseProductProcessMinutes: 0,
                mixingProcessMinutes: 0,
                dryingProcessMinutes: null,
                knownProcessMinutes: 0,
                modeledTotalProcessMinutes: 0,
            },
            evidence: {
                modeledDurationProof: 'complete',
                missingFacts: [],
                dryingApplicability: 'available-not-selected',
            },
        });
    });

    it('marks excluded product drug types as not dryable', () => {
        const product = item('product', 8, 'product', 'Shrooms');
        const rack = item('dryer');
        const catalog: ProductionCatalog = {
            ...emptyCatalog(),
            stations: [{
                schema: 'neonschedule1-production-station-3',
                itemId: 'dryer',
                kind: 'drying-rack',
                capacity: 20,
                maxProcessMultiplier: 1.5,
                processMinutesPerTier: 720,
                minimumTemperatureThreshold: 20,
                maximumTemperatureThreshold: 40,
            }],
        };
        const itemsById = new Map([product, rack].map((entry) => [entry.id, entry]));
        const costs = new ProductionMaterialCostEvaluator(itemsById, catalog);
        const planner = new FinishedRecipeProductionPlanner(
            new ProductionBatchPlanner(costs, dataset),
            itemsById,
            catalog
        );
        const evaluated = recipe([], 8, 'base-purchase-price');

        const plan = planner.plan(evaluated, 1);
        expect(plan.evidence.dryingApplicability).toBe('not-applicable');
        expect(plan.evidence.unmodeledOperations.map(({ operation }) => operation)).not.toContain(
            'drying'
        );
        expect(() =>
            planner.plan(evaluated, 1, {
                drying: {
                    stationItemId: 'dryer',
                    startingQuality: 'Standard',
                    targetQuality: 'Heavenly',
                    averageTemperature: 20,
                },
            })
        ).toThrow('Product "product" is not dryable');
    });

    it('rejects invalid quantities, stations, recipes, and missing material routes', () => {
        const { planner, recipe: evaluated } = fixture();

        expect(() => planner.plan(evaluated, 0)).toThrow('finishedQuantity must be a positive integer');
        expect(() => planner.plan(evaluated, 1.5)).toThrow(
            'finishedQuantity must be a positive integer'
        );
        expect(() => planner.plan(evaluated, 1, { mixingStationItemId: 'pot' })).toThrow(
            'Unknown mixing station "pot"'
        );
        expect(() =>
            planner.plan(evaluated, 1, {
                drying: {
                    stationItemId: 'pot',
                    startingQuality: 'Standard',
                    targetQuality: 'Heavenly',
                    averageTemperature: 20,
                },
            })
        ).toThrow('Unknown drying rack "pot"');
        expect(() =>
            planner.plan(evaluated, 1, {
                drying: {
                    stationItemId: 'dryer',
                    startingQuality: 'Heavenly',
                    targetQuality: 'Standard',
                    averageTemperature: 20,
                },
            })
        ).toThrow('Drying target quality must be higher than starting quality');
        expect(() =>
            planner.plan(evaluated, 1, {
                packaging: {
                    stationItemId: 'pot',
                    packagingItemId: 'baggie',
                    employeePackagingSpeedMultiplier: 1,
                    employeeCurrentWorkSpeed: 1,
                },
            })
        ).toThrow('Unknown packaging station "pot"');
        expect(() =>
            planner.plan(evaluated, 1, {
                packaging: {
                    stationItemId: 'packager-mk2',
                    packagingItemId: 'wrap',
                    employeePackagingSpeedMultiplier: 1,
                    employeeCurrentWorkSpeed: 1,
                },
            })
        ).toThrow('Packaging item "wrap" is not valid for product "product"');
        expect(() =>
            planner.plan(evaluated, 1, {
                packaging: {
                    stationItemId: 'packager-mk2',
                    packagingItemId: 'jar',
                    employeePackagingSpeedMultiplier: 1,
                    employeeCurrentWorkSpeed: 1,
                },
            })
        ).toThrow('Product quantity is insufficient for one "jar" package');
        expect(() =>
            planner.plan(evaluated, 1, {
                packaging: {
                    stationItemId: 'packager-mk2',
                    packagingItemId: 'baggie',
                    employeePackagingSpeedMultiplier: 0,
                    employeeCurrentWorkSpeed: 1,
                },
            })
        ).toThrow('Employee packaging speed multiplier must be positive');
        expect(() =>
            planner.plan(evaluated, 20, {
                packaging: {
                    stationItemId: 'packager-mk2',
                    packagingItemId: 'brick',
                    employeePackagingSpeedMultiplier: 1,
                    employeeCurrentWorkSpeed: 1,
                },
                brickPressing: {
                    stationItemId: 'brick-press',
                    employeePackagingSpeedMultiplier: 1,
                    employeeCurrentWorkSpeed: 1,
                },
            })
        ).toThrow('Finished recipe cannot select packaging and brick pressing together');
        expect(() =>
            planner.plan(evaluated, 19, {
                brickPressing: {
                    stationItemId: 'brick-press',
                    employeePackagingSpeedMultiplier: 1,
                    employeeCurrentWorkSpeed: 1,
                },
            })
        ).toThrow('Product quantity is insufficient for one brick from "brick-press"');
        expect(() =>
            planner.plan(evaluated, 20, {
                brickPressing: {
                    stationItemId: 'pot',
                    employeePackagingSpeedMultiplier: 1,
                    employeeCurrentWorkSpeed: 1,
                },
            })
        ).toThrow('Unknown brick press "pot"');
        expect(() => planner.plan({ ...evaluated, ingredientCost: 1 }, 1)).toThrow(
            'Recipe ingredient cost is incompatible with normalized item prices'
        );
        expect(() => planner.plan({ ...evaluated, ingredientCount: 2 }, 1)).toThrow(
            'Recipe ingredient count does not match its ordered ingredient IDs'
        );
        expect(() =>
            planner.plan(evaluated, 1, {
                ownedEquipment: [
                    { itemId: 'pot', quantity: 1 },
                    { itemId: 'pot', quantity: 1 },
                ],
            })
        ).toThrow('Owned equipment contains duplicate item "pot"');
        expect(() =>
            planner.plan(evaluated, 1, {
                ownedEquipment: [{ itemId: 'pot', quantity: 0.5 }],
            })
        ).toThrow('Owned equipment "pot" quantity must be a non-negative integer');
        expect(() =>
            planner.plan(evaluated, 1, {
                ownedEquipment: [{ itemId: 'unknown', quantity: 1 }],
            })
        ).toThrow('Unknown owned equipment "unknown"');

        const product = item('unrouted', null, 'product');
        const catalog = emptyCatalog();
        const costs = new ProductionMaterialCostEvaluator(new Map([[product.id, product]]), catalog);
        const missingRoutePlanner = new FinishedRecipeProductionPlanner(
            new ProductionBatchPlanner(costs, dataset),
            new Map([[product.id, product]]),
            catalog
        );
        expect(() =>
            missingRoutePlanner.plan(
                {
                    ...recipe([], 1, 'production-materials'),
                    productId: 'unrouted',
                },
                1
            )
        ).toThrow('No complete material-cost route for "unrouted"');
    });
});

function fixture(selectGrowContainer = true): {
    readonly planner: FinishedRecipeProductionPlanner;
    readonly recipe: RecipeEvaluation;
} {
    const items = [
        item('seed', 5),
        item('soil', 1, 'soil'),
        item('product', null, 'product', 'Marijuana', ['baggie', 'brick', 'jar']),
        item('banana', 2, 'ingredient'),
        item('cuke', 3, 'ingredient'),
        item('pot', 100),
        item('mixer', 200),
        item('dryer'),
        item('packager-mk2', 400),
        item('brick-press', 500),
        packagingItem('baggie', 1, 1),
        packagingItem('jar', 5, 3),
        packagingItem('brick', 20, 1),
        packagingItem('wrap', 2, 1),
    ];
    const itemsById = new Map(items.map((entry) => [entry.id, entry]));
    const catalog: ProductionCatalog = {
        ...emptyCatalog(),
        seeds: [
            {
                schema: 'neonschedule1-seed-production-3',
                seedItemId: 'seed',
                soilItemIds: ['soil'],
                plantRuntimeType: 'Plant',
                growthTimeMinutes: 10,
                baseYieldQuantity: 2,
                harvestTarget: 'product',
                harvestProducts: [{ itemId: 'product', quantity: 1 }],
            },
        ],
        stations: [
            {
                schema: 'neonschedule1-production-station-3',
                itemId: 'pot',
                kind: 'grow-container',
                yieldMultiplier: 1,
                growSpeedMultiplier: 1,
                requiresExternalGrowLight: false,
                maxTemperatureGrowthMultiplier: 1,
                minimumTemperatureThreshold: 1,
                maximumTemperatureThreshold: 1,
                allowedSoilIds: ['soil'],
                allowedAdditiveIds: [],
            },
            {
                schema: 'neonschedule1-production-station-3',
                itemId: 'mixer',
                kind: 'mixing',
                capacity: 2,
                timePerItem: 6,
                requiresManualIngredientInsertion: true,
            },
            {
                schema: 'neonschedule1-production-station-3',
                itemId: 'dryer',
                kind: 'drying-rack',
                capacity: 2,
                maxProcessMultiplier: 1.5,
                processMinutesPerTier: 720,
                minimumTemperatureThreshold: 20,
                maximumTemperatureThreshold: 40,
            },
            {
                schema: 'neonschedule1-production-station-3',
                itemId: 'packager-mk2',
                kind: 'packaging-mk2',
                employeeSpeedMultiplier: 2,
            },
            {
                schema: 'neonschedule1-production-station-3',
                itemId: 'brick-press',
                kind: 'brick-press',
                packagingItemId: 'brick',
                packagingQuantity: 20,
            },
        ],
    };
    const costs = new ProductionMaterialCostEvaluator(
        itemsById,
        catalog,
        selectGrowContainer ? { growContainerItemId: 'pot' } : undefined
    );
    return {
        planner: new FinishedRecipeProductionPlanner(
            new ProductionBatchPlanner(costs, dataset),
            itemsById,
            catalog
        ),
        recipe: recipe(['banana', 'cuke', 'banana'], 3, 'production-materials'),
    };
}

function recipe(
    ingredientIds: readonly string[],
    baseProductCost: number,
    baseProductCostBasis: RecipeEvaluation['baseProductCostBasis']
): RecipeEvaluation {
    const prices = new Map([
        ['banana', 2],
        ['cuke', 3],
    ]);
    const ingredientCost = ingredientIds.reduce(
        (total, itemId) => total + (prices.get(itemId) ?? 0),
        0
    );
    return {
        ruleProfile: { kind: 'standard' },
        productId: 'product',
        ingredientIds: [...ingredientIds],
        effectIds: [],
        productValue: 20,
        baseProductCost,
        baseProductCostBasis,
        ingredientCost,
        totalCost: baseProductCost + ingredientCost,
        netValue: 20 - baseProductCost - ingredientCost,
        ingredientCount: ingredientIds.length,
    };
}

function unmodeled(
    operation: string,
    applicability: 'not-established' | 'available-not-selected' = 'not-established'
): unknown {
    return {
        operation,
        applicability,
        materialCost: null,
        processMinutes: null,
    };
}

function dryingRules(): ProductionCatalog['drying'] {
    return {
        schema: 'neonschedule1-drying-operation-rules-1',
        requiresUnpackagedProduct: true,
        acceptedProductDrugTypes: ['Cocaine', 'Marijuana', 'Methamphetamine'],
        specialQualityItemIdSubstring: 'cocaleaf',
        specialItemRequiresQualityInstance: true,
        maximumQualityTier: 'Heavenly',
        itemIdTransformation: 'preserved',
        quantityTransformation: 'preserved',
        qualityTierIncrement: 1,
    };
}

function emptyCatalog(): ProductionCatalog {
    return {
        schema: 'neonschedule1-production-catalog-8',
        drying: dryingRules(),
        packaging: { ...PACKAGING_OPERATION_RULES },
        brickPressing: { ...BRICK_PRESS_OPERATION_RULES },
        quality: {
            basePlantLevel: 0.5,
            monetaryValueVariesByQuality: false,
            customerQualityMaxEffect: 0.3,
            tiers: [
                { name: 'Trash', minimumLevelExclusive: null, customerScalar: 0 },
                { name: 'Poor', minimumLevelExclusive: 0.25, customerScalar: 0.25 },
                { name: 'Standard', minimumLevelExclusive: 0.4, customerScalar: 0.5 },
                { name: 'Premium', minimumLevelExclusive: 0.75, customerScalar: 0.75 },
                { name: 'Heavenly', minimumLevelExclusive: 0.9, customerScalar: 1 },
            ],
        },
        seeds: [],
        shrooms: [],
        stationRecipes: [],
        ovenTransforms: [],
        stations: [],
    };
}

function item(
    id: string,
    basePurchasePrice: number | null = null,
    role?: 'ingredient' | 'product' | 'soil',
    drugType = 'Marijuana',
    validPackagingIds: readonly string[] = []
): Item {
    return {
        schema: 'neonschedule1-item-3',
        id,
        name: id,
        category: 'Test',
        isRuntimeOnly: false,
        stackLimit: 20,
        isStorable: true,
        basePurchasePrice,
        resellMultiplier: 1,
        requiredRank: null,
        requiredRankTier: null,
        product:
            role === 'product'
                ? {
                      drugType,
                      basePrice: 20,
                      marketValue: 20,
                      baseAddictiveness: 0,
                      effectIds: [],
                      validPackagingIds: [...validPackagingIds],
                  }
                : null,
        packaging: null,
        additive: null,
        soil: role === 'soil' ? { quality: 'Test', uses: 1 } : null,
        mixingIngredient: role === 'ingredient' ? { effectIds: ['test-effect'] } : null,
        presentation: {
            description: '',
            iconFileId: null,
            visualKind: 'none',
            fallbackMeshIds: [],
            fallbackMaterialIds: [],
        },
    };
}

function packagingItem(id: string, quantity: number, price: number): Item {
    return {
        ...item(id, price),
        packaging: { quantity, basePurchasePrice: price },
    };
}
