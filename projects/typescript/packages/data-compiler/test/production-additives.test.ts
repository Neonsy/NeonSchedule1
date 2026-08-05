import { describe, expect, it } from 'vitest';

import {
    ProductionBatchPlanner,
    ProductionMaterialCostEvaluator,
    type Additive,
    type Item,
    type ProductionCatalog,
} from '@neonschedule1/core';

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
        expect(new ProductionBatchPlanner(costs).plan('leaf', 100)).toMatchObject({
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

function fixture(): {
    readonly catalog: ProductionCatalog;
    readonly itemsById: ReadonlyMap<string, Item>;
} {
    const items = [
        item('seed', 100),
        item('leaf'),
        item('soil', 10, undefined, 1),
        item('tent'),
        item('pgr', 30, { qualityChange: -0.2, yieldMultiplier: 1.5, instantGrowth: 0 }),
        item('speedgrow', 30, { qualityChange: -0.2, yieldMultiplier: 1, instantGrowth: 0.5 }),
        item('unsupported', 30, { qualityChange: 0, yieldMultiplier: 2, instantGrowth: 0 }),
    ];
    return {
        itemsById: new Map(items.map((entry) => [entry.id, entry])),
        catalog: {
            schema: 'neonschedule1-production-catalog-5',
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
                    schema: 'neonschedule1-production-station-3',
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
