import { describe, expect, it } from 'vitest';

import {
    BRICK_PRESS_OPERATION_RULES,
    FinishedRecipeProductionPlanner,
    PACKAGING_OPERATION_RULES,
    ProductionBatchPlanner,
    ProductionMaterialCostEvaluator,
    type Additive,
    type Item,
    type ProductionCatalog,
    type RecipeEvaluation,
} from '@neonschedule1/core';

const productionDataset = { gameVersion: 'test', datasetSha256: 'a'.repeat(64) };

describe('plant production additives', () => {
    it('charges one of each additive per batch and applies their stacked grow effects', () => {
        const { catalog, itemsById } = fixture();
        const costs = new ProductionMaterialCostEvaluator(itemsById, catalog, {
            growContainerItemId: 'tent',
            additiveItemIds: ['speedgrow', 'pgr'],
        });

        expect(costs.evaluate('leaf')).toMatchObject({
            routeId: 'seed:seed:leaf:soil:tent:pgr:speedgrow',
            outputQuantity: 18,
            durationMinutesPerBatch: 30,
            additiveItemIds: ['pgr', 'speedgrow'],
            quality: { level: expect.closeTo(0.1), tier: 'Trash', customerScalar: 0 },
            batchCost: 170,
            inputs: [
                { itemId: 'seed', quantity: 1, totalCost: 100 },
                { itemId: 'soil', quantity: 1, totalCost: 10 },
                { itemId: 'pgr', quantity: 1, totalCost: 30 },
                { itemId: 'speedgrow', quantity: 1, totalCost: 30 },
            ],
        });
        expect(new ProductionBatchPlanner(costs, productionDataset).plan('leaf', 100)).toMatchObject({
            totalProcessMinutes: 180,
            requiredMaterialCost: 1_020,
            purchaseCost: 1_020,
            productionSteps: [
                {
                    batchCount: 6,
                    outputQuantityPerBatch: 18,
                    producedQuantity: 108,
                    leftoverQuantity: 8,
                    additiveItemIds: ['pgr', 'speedgrow'],
                },
            ],
            purchases: [
                { itemId: 'pgr', requiredQuantity: 6, purchaseCost: 180 },
                { itemId: 'seed', requiredQuantity: 6, purchaseCost: 600 },
                { itemId: 'soil', requiredQuantity: 6, purchaseCost: 60 },
                { itemId: 'speedgrow', requiredQuantity: 6, purchaseCost: 180 },
            ],
        });
    });

    it('uses game float precision when additive quality lands on a tier boundary', () => {
        const { catalog, itemsById } = fixture();
        const fertilizer = item('fertilizer', 30, {
            qualityChange: 0.3,
            yieldMultiplier: 1,
            instantGrowth: 0,
        });
        const expandedCatalog: ProductionCatalog = {
            ...catalog,
            stations: catalog.stations.map((station) =>
                station.kind === 'grow-container'
                    ? { ...station, allowedAdditiveIds: [...station.allowedAdditiveIds, 'fertilizer'] }
                    : station
            ),
        };
        const expandedItems = new Map(itemsById).set(fertilizer.id, fertilizer);

        const fertilizerQuality = new ProductionMaterialCostEvaluator(expandedItems, expandedCatalog, {
            growContainerItemId: 'tent',
            additiveItemIds: ['fertilizer'],
        }).evaluate('leaf');
        const allAdditivesQuality = new ProductionMaterialCostEvaluator(expandedItems, expandedCatalog, {
            growContainerItemId: 'tent',
            additiveItemIds: ['fertilizer', 'pgr', 'speedgrow'],
        }).evaluate('leaf');

        expect(fertilizerQuality).toMatchObject({
            quality: { level: expect.closeTo(0.8), tier: 'Premium', customerScalar: 0.75 },
        });
        expect(allAdditivesQuality).toMatchObject({
            quality: { level: expect.closeTo(0.4), tier: 'Standard', customerScalar: 0.5 },
        });
    });

    it('composes selected grow additives as base-growth operations', () => {
        const { catalog, itemsById } = fixture();
        const costs = new ProductionMaterialCostEvaluator(itemsById, catalog, {
            growContainerItemId: 'tent',
            additiveItemIds: ['speedgrow', 'pgr'],
        });
        const baseProductCost = costs.evaluate('leaf').unitCost;
        const recipe: RecipeEvaluation = {
            ruleProfile: { kind: 'standard' },
            productId: 'leaf',
            ingredientIds: [],
            effectIds: [],
            productValue: 100,
            baseProductCost,
            baseProductCostBasis: 'production-materials',
            ingredientCost: 0,
            totalCost: baseProductCost,
            netValue: 100 - baseProductCost,
            ingredientCount: 0,
        };
        const planner = new FinishedRecipeProductionPlanner(
            new ProductionBatchPlanner(costs, productionDataset),
            itemsById,
            catalog
        );

        const plan = planner.plan(recipe, 100);

        expect(plan.growAdditiveSteps).toEqual([
            {
                position: 'during-base-product-growth',
                productionItemId: 'leaf',
                growContainerItemId: 'tent',
                additiveItemId: 'pgr',
                batchCount: 6,
                applicationCount: 6,
                materialQuantity: 6,
                qualityChange: -0.2,
                yieldMultiplier: 1.5,
                instantGrowth: 0,
                manualApplicationDuration: 'interactive-not-fixed',
            },
            {
                position: 'during-base-product-growth',
                productionItemId: 'leaf',
                growContainerItemId: 'tent',
                additiveItemId: 'speedgrow',
                batchCount: 6,
                applicationCount: 6,
                materialQuantity: 6,
                qualityChange: -0.2,
                yieldMultiplier: 1,
                instantGrowth: 0.5,
                manualApplicationDuration: 'interactive-not-fixed',
            },
        ]);
        expect(plan.purchases).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ itemId: 'pgr', requiredQuantity: 6 }),
                expect.objectContaining({ itemId: 'speedgrow', requiredQuantity: 6 }),
            ])
        );
        expect(plan.evidence.unmodeledOperations.map(({ operation }) => operation)).not.toContain(
            'finished-product-additives'
        );
    });

    it('rejects additive selections the game would not accept', () => {
        const { catalog, itemsById } = fixture();

        expect(
            () => new ProductionMaterialCostEvaluator(itemsById, catalog, { additiveItemIds: ['pgr'] })
        ).toThrow('Additives cannot be selected without a grow container');
        expect(
            () =>
                new ProductionMaterialCostEvaluator(itemsById, catalog, {
                    growContainerItemId: 'tent',
                    additiveItemIds: ['pgr', 'pgr'],
                })
        ).toThrow('A grow additive can only be selected once');
        expect(
            () =>
                new ProductionMaterialCostEvaluator(itemsById, catalog, {
                    growContainerItemId: 'tent',
                    additiveItemIds: ['soil'],
                })
        ).toThrow('Unknown grow additive "soil"');
        expect(
            () =>
                new ProductionMaterialCostEvaluator(itemsById, catalog, {
                    growContainerItemId: 'tent',
                    additiveItemIds: ['unsupported'],
                })
        ).toThrow('Grow container "tent" does not accept additive "unsupported"');
    });
});

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

function fixture(): {
    readonly catalog: ProductionCatalog;
    readonly itemsById: ReadonlyMap<string, Item>;
} {
    const items = [
        item('seed', 100),
        productItem('leaf'),
        item('soil', 10, undefined, 1),
        item('tent'),
        item('pgr', 30, { qualityChange: -0.2, yieldMultiplier: 1.5, instantGrowth: 0 }),
        item('speedgrow', 30, { qualityChange: -0.2, yieldMultiplier: 1, instantGrowth: 0.5 }),
        item('unsupported', 30, { qualityChange: 0, yieldMultiplier: 2, instantGrowth: 0 }),
    ];
    return {
        itemsById: new Map(items.map((entry) => [entry.id, entry])),
        catalog: {
            schema: 'neonschedule1-production-catalog-9',
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
            seeds: [
                {
                    schema: 'neonschedule1-seed-production-3',
                    seedItemId: 'seed',
                    soilItemIds: ['soil'],
                    plantRuntimeType: 'Plant',
                    growthTimeMinutes: 60,
                    baseYieldQuantity: 12,
                    harvestTarget: 'leaf',
                    harvestProducts: [{ itemId: 'leaf', quantity: 1 }],
                },
            ],
            shrooms: [],
            stationRecipes: [],
            ovenTransforms: [],
            stations: [
                {
                    schema: 'neonschedule1-production-station-4',
                    itemId: 'tent',
                    kind: 'grow-container',
                    yieldMultiplier: 1,
                    growSpeedMultiplier: 1,
                    requiresExternalGrowLight: false,
                    maxTemperatureGrowthMultiplier: 1,
                    minimumTemperatureThreshold: 1,
                    maximumTemperatureThreshold: 1,
                    allowedSoilIds: ['soil'],
                    allowedAdditiveIds: ['pgr', 'speedgrow'],
                },
            ],
        },
    };
}

function item(
    id: string,
    basePurchasePrice: number | null = null,
    additive?: Additive,
    soilUses?: number
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
        product: null,
        packaging: null,
        additive: additive ?? null,
        soil: soilUses === undefined ? null : { quality: 'Test', uses: soilUses },
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

function productItem(id: string): Item {
    return {
        ...item(id),
        product: {
            drugType: 'Marijuana',
            basePrice: 100,
            marketValue: 100,
            baseAddictiveness: 0,
            effectIds: [],
            validPackagingIds: [],
        },
    };
}
