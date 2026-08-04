import { describe, expect, it } from 'vitest';

import {
    ProductionBatchPlanner,
    ProductionMaterialCostEvaluator,
    type Item,
    type ProductionCatalog,
} from '@neonschedule1/core';

describe('production material costs', () => {
    it('derives nested unit costs and selects the cheapest accepted input', () => {
        const items = [
            item('seed', 100),
            item('leaf'),
            item('fuel', 5),
            item('base'),
            item('cocaine', 80),
            item('acid', 40),
            item('low-pseudo', 60),
            item('high-pseudo', 110),
            item('phosphorus', 40),
            item('liquid-meth'),
            item('meth', 50),
            item('grain-bag', 20),
            item('syringe', 120),
            item('spawn', 100),
            item('shroom', 65),
            item('soil', 10, 1),
            item('reusable-soil', 15, 2),
            item('substrate', 60, 1),
            item('cauldron'),
            item('spawn-station'),
        ];
        const evaluator = new ProductionMaterialCostEvaluator(
            new Map(items.map((entry) => [entry.id, entry])),
            catalog()
        );

        expect(evaluator.evaluate('leaf')).toMatchObject({
            kind: 'production',
            method: 'seed-harvest',
            durationMinutesPerBatch: 60,
            unitCost: 10.75,
            inputs: [
                { itemId: 'seed', quantity: 1, totalCost: 100 },
                { itemId: 'reusable-soil', quantity: 0.5, totalCost: 7.5 },
            ],
        });
        expect(evaluator.evaluate('cocaine')).toMatchObject({
            kind: 'production',
            method: 'oven',
            durationMinutesPerBatch: 1,
            unitCost: 22,
            inputs: [
                {
                    itemId: 'base',
                    unitCost: 22,
                    cost: {
                        method: 'cauldron',
                        durationMinutesPerBatch: 1,
                        outputQuantity: 10,
                        batchCost: 220,
                    },
                },
            ],
        });
        expect(evaluator.evaluate('meth')).toMatchObject({
            kind: 'production',
            method: 'oven',
            durationMinutesPerBatch: 1,
            unitCost: 14,
            inputs: [
                {
                    cost: {
                        method: 'station-recipe',
                        durationMinutesPerBatch: 1,
                        batchCost: 140,
                        inputs: [{ itemId: 'acid' }, { itemId: 'low-pseudo' }, { itemId: 'phosphorus' }],
                    },
                },
            ],
        });
        expect(evaluator.evaluate('shroom')).toMatchObject({
            kind: 'production',
            method: 'shroom-harvest',
            durationMinutesPerBatch: 60,
            unitCost: 12.5,
            inputs: [
                {
                    itemId: 'spawn',
                    unitCost: 140,
                    cost: {
                        method: 'mushroom-spawn',
                        durationMinutesPerBatch: 6,
                        batchCost: 140,
                    },
                },
                { itemId: 'substrate', quantity: 1, totalCost: 60 },
            ],
        });
    });

    it('rejects a production cycle without a priced source input', () => {
        const cycleCatalog: ProductionCatalog = {
            ...emptyCatalog(),
            ovenTransforms: [
                {
                    schema: 'neonschedule1-oven-transform-2',
                    inputItemId: 'right',
                    cookType: 'Test',
                    cookTimeMinutes: 1,
                    outputItemId: 'left',
                    outputQuantity: 1,
                },
                {
                    schema: 'neonschedule1-oven-transform-2',
                    inputItemId: 'left',
                    cookType: 'Test',
                    cookTimeMinutes: 1,
                    outputItemId: 'right',
                    outputQuantity: 1,
                },
            ],
        };
        const evaluator = new ProductionMaterialCostEvaluator(
            new Map([['left', item('left')], ['right', item('right')]]),
            cycleCatalog
        );

        expect(() => evaluator.evaluate('left')).toThrow('No complete material-cost route for "left"');
    });
});

describe('production batch plans', () => {
    it('expands whole batches and rounds each purchase once', () => {
        const items = [
            item('seed', 100),
            item('leaf'),
            item('fuel', 5),
            item('base'),
            item('cocaine', 80),
            item('soil', 10, 1),
            item('reusable-soil', 15, 2),
            item('cauldron'),
        ];
        const source = catalog();
        const costs = new ProductionMaterialCostEvaluator(
            new Map(items.map((entry) => [entry.id, entry])),
            {
                ...source,
                seeds: source.seeds.map((seed) => ({ ...seed, baseYieldQuantity: 12 })),
                shrooms: [],
                stationRecipes: [],
                ovenTransforms: source.ovenTransforms.filter(
                    (transform) => transform.outputItemId === 'cocaine'
                ),
                stations: source.stations.filter((station) => station.kind === 'cauldron'),
            }
        );

        expect(new ProductionBatchPlanner(costs).plan('cocaine', 100)).toEqual({
            targetItemId: 'cocaine',
            targetQuantity: 100,
            productionSteps: [
                {
                    itemId: 'leaf',
                    routeId: 'seed:seed:leaf:reusable-soil',
                    method: 'seed-harvest',
                    requiredQuantity: 200,
                    batchCount: 17,
                    outputQuantityPerBatch: 12,
                    durationMinutesPerBatch: 60,
                    totalProcessMinutes: 1_020,
                    producedQuantity: 204,
                    leftoverQuantity: 4,
                    inputs: [
                        { itemId: 'seed', quantityPerBatch: 1, totalQuantity: 17 },
                        { itemId: 'reusable-soil', quantityPerBatch: 0.5, totalQuantity: 8.5 },
                    ],
                },
                {
                    itemId: 'base',
                    routeId: 'cauldron:cauldron',
                    method: 'cauldron',
                    requiredQuantity: 100,
                    batchCount: 10,
                    outputQuantityPerBatch: 10,
                    durationMinutesPerBatch: 1,
                    totalProcessMinutes: 10,
                    producedQuantity: 100,
                    leftoverQuantity: 0,
                    inputs: [
                        { itemId: 'leaf', quantityPerBatch: 20, totalQuantity: 200 },
                        { itemId: 'fuel', quantityPerBatch: 1, totalQuantity: 10 },
                    ],
                },
                {
                    itemId: 'cocaine',
                    routeId: 'oven:base:cocaine',
                    method: 'oven',
                    requiredQuantity: 100,
                    batchCount: 100,
                    outputQuantityPerBatch: 1,
                    durationMinutesPerBatch: 1,
                    totalProcessMinutes: 100,
                    producedQuantity: 100,
                    leftoverQuantity: 0,
                    inputs: [{ itemId: 'base', quantityPerBatch: 1, totalQuantity: 100 }],
                },
            ],
            purchases: [
                {
                    itemId: 'fuel',
                    requiredQuantity: 10,
                    purchaseQuantity: 10,
                    leftoverQuantity: 0,
                    unitCost: 5,
                    requiredCost: 50,
                    purchaseCost: 50,
                },
                {
                    itemId: 'reusable-soil',
                    requiredQuantity: 8.5,
                    purchaseQuantity: 9,
                    leftoverQuantity: 0.5,
                    unitCost: 15,
                    requiredCost: 127.5,
                    purchaseCost: 135,
                },
                {
                    itemId: 'seed',
                    requiredQuantity: 17,
                    purchaseQuantity: 17,
                    leftoverQuantity: 0,
                    unitCost: 100,
                    requiredCost: 1700,
                    purchaseCost: 1700,
                },
            ],
            totalProcessMinutes: 1_130,
            requiredMaterialCost: 1877.5,
            purchaseCost: 1885,
        });
    });
});

function catalog(): ProductionCatalog {
    return {
        ...emptyCatalog(),
        seeds: [
            {
                schema: 'neonschedule1-seed-production-2',
                seedItemId: 'seed',
                soilItemIds: ['soil', 'reusable-soil'],
                plantRuntimeType: 'Plant',
                growthTimeMinutes: 60,
                baseYieldQuantity: 10,
                harvestTarget: 'leaf',
                harvestProducts: [{ itemId: 'leaf', quantity: 1 }],
            },
        ],
        shrooms: [
            {
                schema: 'neonschedule1-shroom-production-2',
                spawnItemId: 'spawn',
                soilItemIds: ['substrate'],
                productItemId: 'shroom',
                growTimeMinutes: 60,
                baseYieldQuantity: 16,
                maximumTemperatureForGrowth: 1,
                minimumSoilMoistureForGrowth: 0,
            },
        ],
        stationRecipes: [
            {
                schema: 'neonschedule1-station-recipe-1',
                id: 'liquid-meth',
                title: 'Liquid Meth',
                cookTimeMinutes: 1,
                cookTemperature: 1,
                cookTemperatureTolerance: 1,
                qualityCalculationMethod: 'Additive',
                ingredients: [
                    { quantity: 1, acceptedItemIds: ['acid'] },
                    { quantity: 1, acceptedItemIds: ['high-pseudo', 'low-pseudo'] },
                    { quantity: 1, acceptedItemIds: ['phosphorus'] },
                ],
                outputItemId: 'liquid-meth',
                outputQuantity: 1,
            },
        ],
        ovenTransforms: [
            {
                schema: 'neonschedule1-oven-transform-2',
                inputItemId: 'base',
                cookType: 'Solid',
                cookTimeMinutes: 1,
                outputItemId: 'cocaine',
                outputQuantity: 1,
            },
            {
                schema: 'neonschedule1-oven-transform-2',
                inputItemId: 'liquid-meth',
                cookType: 'Liquid',
                cookTimeMinutes: 1,
                outputItemId: 'meth',
                outputQuantity: 10,
            },
        ],
        stations: [
            {
                schema: 'neonschedule1-production-station-2',
                itemId: 'cauldron',
                kind: 'cauldron',
                cookTimeMinutes: 1,
                requiredPrimaryInputQuantity: 20,
                primaryInputItemId: 'leaf',
                secondaryInputItemId: 'fuel',
                secondaryInputQuantity: 1,
                outputItemId: 'base',
                outputQuantity: 10,
            },
            {
                schema: 'neonschedule1-production-station-2',
                itemId: 'spawn-station',
                kind: 'mushroom-spawn',
                grainBagItemId: 'grain-bag',
                grainBagQuantity: 1,
                workTimeMinutes: 6,
                sporeSyringes: [
                    {
                        syringeItemId: 'syringe',
                        syringeQuantity: 1,
                        outputSpawnItemId: 'spawn',
                        outputSpawnQuantity: 1,
                    },
                ],
            },
        ],
    };
}

function emptyCatalog(): ProductionCatalog {
    return {
        schema: 'neonschedule1-production-catalog-2',
        seeds: [],
        shrooms: [],
        stationRecipes: [],
        ovenTransforms: [],
        stations: [],
    };
}

function item(id: string, basePurchasePrice: number | null = null, soilUses: number | null = null): Item {
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
        additive: null,
        soil: soilUses === null ? null : { quality: 'Test', uses: soilUses },
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
