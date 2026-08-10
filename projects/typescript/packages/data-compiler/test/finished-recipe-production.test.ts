import { describe, expect, it } from 'vitest';

import {
    FinishedRecipeProductionPlanner,
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
                purchaseCost: 33,
            },
            evidence: {
                modeledScope: 'base-product-and-ordered-mixing',
                modeledQuantityProof: 'exact',
                materialCostCoverage: 'modeled-materials-only',
                modeledDurationProof: 'complete',
                finishedLifecycleProof: 'partial',
                missingFacts: [],
                dryingApplicability: 'available-not-selected',
            },
        });
        expect(plan.evidence.unmodeledOperations).toEqual([
            unmodeled('finished-product-additives'),
            unmodeled('drying', 'available-not-selected'),
            unmodeled('packaging'),
            unmodeled('brick-pressing'),
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
                missingFacts: ['mixing-station'],
            },
        });
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
        expect(() => planner.plan({ ...evaluated, ingredientCost: 1 }, 1)).toThrow(
            'Recipe ingredient cost is incompatible with normalized item prices'
        );
        expect(() => planner.plan({ ...evaluated, ingredientCount: 2 }, 1)).toThrow(
            'Recipe ingredient count does not match its ordered ingredient IDs'
        );

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

function fixture(): {
    readonly planner: FinishedRecipeProductionPlanner;
    readonly recipe: RecipeEvaluation;
} {
    const items = [
        item('seed', 5),
        item('soil', 1, 'soil'),
        item('product', null, 'product'),
        item('banana', 2, 'ingredient'),
        item('cuke', 3, 'ingredient'),
        item('pot'),
        item('mixer'),
        item('dryer'),
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
        ],
    };
    const costs = new ProductionMaterialCostEvaluator(itemsById, catalog, {
        growContainerItemId: 'pot',
    });
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
        schema: 'neonschedule1-production-catalog-6',
        drying: dryingRules(),
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
    drugType = 'Marijuana'
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
                      validPackagingIds: [],
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
