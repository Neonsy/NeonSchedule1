import { describe, expect, it } from 'vitest';

import {
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
            unitCost: 10.75,
            inputs: [
                { itemId: 'seed', quantity: 1, totalCost: 100 },
                { itemId: 'reusable-soil', quantity: 0.5, totalCost: 7.5 },
            ],
        });
        expect(evaluator.evaluate('cocaine')).toMatchObject({
            kind: 'production',
            method: 'oven',
            unitCost: 22,
            inputs: [
                {
                    itemId: 'base',
                    unitCost: 22,
                    cost: {
                        method: 'cauldron',
                        outputQuantity: 10,
                        batchCost: 220,
                    },
                },
            ],
        });
        expect(evaluator.evaluate('meth')).toMatchObject({
            kind: 'production',
            method: 'oven',
            unitCost: 14,
            inputs: [
                {
                    cost: {
                        method: 'station-recipe',
                        batchCost: 140,
                        inputs: [{ itemId: 'acid' }, { itemId: 'low-pseudo' }, { itemId: 'phosphorus' }],
                    },
                },
            ],
        });
        expect(evaluator.evaluate('shroom')).toMatchObject({
            kind: 'production',
            method: 'shroom-harvest',
            unitCost: 12.5,
            inputs: [
                {
                    itemId: 'spawn',
                    unitCost: 140,
                    cost: { method: 'mushroom-spawn', batchCost: 140 },
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
                    schema: 'neonschedule1-oven-transform-1',
                    inputItemId: 'right',
                    cookType: 'Test',
                    cookTime: 1,
                    outputItemId: 'left',
                    outputQuantity: 1,
                },
                {
                    schema: 'neonschedule1-oven-transform-1',
                    inputItemId: 'left',
                    cookType: 'Test',
                    cookTime: 1,
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

function catalog(): ProductionCatalog {
    return {
        ...emptyCatalog(),
        seeds: [
            {
                schema: 'neonschedule1-seed-production-1',
                seedItemId: 'seed',
                soilItemIds: ['soil', 'reusable-soil'],
                plantRuntimeType: 'Plant',
                growthTime: 1,
                baseYieldQuantity: 10,
                harvestTarget: 'leaf',
                harvestProducts: [{ itemId: 'leaf', quantity: 1 }],
            },
        ],
        shrooms: [
            {
                schema: 'neonschedule1-shroom-production-1',
                spawnItemId: 'spawn',
                soilItemIds: ['substrate'],
                productItemId: 'shroom',
                growTime: 1,
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
                schema: 'neonschedule1-oven-transform-1',
                inputItemId: 'base',
                cookType: 'Solid',
                cookTime: 1,
                outputItemId: 'cocaine',
                outputQuantity: 1,
            },
            {
                schema: 'neonschedule1-oven-transform-1',
                inputItemId: 'liquid-meth',
                cookType: 'Liquid',
                cookTime: 1,
                outputItemId: 'meth',
                outputQuantity: 10,
            },
        ],
        stations: [
            {
                schema: 'neonschedule1-production-station-1',
                itemId: 'cauldron',
                kind: 'cauldron',
                cookTime: 1,
                requiredPrimaryInputQuantity: 20,
                primaryInputItemId: 'leaf',
                secondaryInputItemId: 'fuel',
                secondaryInputQuantity: 1,
                outputItemId: 'base',
                outputQuantity: 10,
            },
            {
                schema: 'neonschedule1-production-station-1',
                itemId: 'spawn-station',
                kind: 'mushroom-spawn',
                grainBagItemId: 'grain-bag',
                grainBagQuantity: 1,
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
        schema: 'neonschedule1-production-catalog-1',
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
