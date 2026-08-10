import { describe, expect, it } from 'vitest';

import {
    ProductionBatchPlanner,
    ProductionMaterialCostEvaluator,
    type Item,
    type ProductionCatalog,
} from '@neonschedule1/core';

const productionDataset = { gameVersion: 'test', datasetSha256: 'a'.repeat(64) };

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
            item('pot'),
            item('oven'),
            item('chemistry-station'),
            item('mushroom-bed'),
        ];
        const evaluator = new ProductionMaterialCostEvaluator(
            new Map(items.map((entry) => [entry.id, entry])),
            catalog()
        );

        expect(evaluator.evaluate('leaf')).toMatchObject({
            kind: 'production',
            method: 'seed-harvest',
            durationMinutesPerBatch: 60,
            acceptedEquipmentItemIds: ['pot'],
            equipmentItemId: null,
            growLightItemId: null,
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
            acceptedEquipmentItemIds: ['oven'],
            equipmentItemId: 'oven',
            unitCost: 22,
            inputs: [
                {
                    itemId: 'base',
                    unitCost: 22,
                    cost: {
                        method: 'cauldron',
                        durationMinutesPerBatch: 1,
                        acceptedEquipmentItemIds: ['cauldron'],
                        equipmentItemId: 'cauldron',
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
            acceptedEquipmentItemIds: ['oven'],
            equipmentItemId: 'oven',
            unitCost: 14,
            inputs: [
                {
                    cost: {
                        method: 'station-recipe',
                        durationMinutesPerBatch: 1,
                        acceptedEquipmentItemIds: ['chemistry-station'],
                        equipmentItemId: 'chemistry-station',
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
            acceptedEquipmentItemIds: ['mushroom-bed'],
            equipmentItemId: 'mushroom-bed',
            unitCost: 12.5,
            inputs: [
                {
                    itemId: 'spawn',
                    unitCost: 140,
                    cost: {
                        method: 'mushroom-spawn',
                        durationMinutesPerBatch: 6,
                        acceptedEquipmentItemIds: ['spawn-station'],
                        equipmentItemId: 'spawn-station',
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
            stations: [labOvenStation()],
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
            new Map([
                ['left', item('left')],
                ['right', item('right')],
                ['oven', item('oven')],
            ]),
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
            item('pot'),
            item('oven'),
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
                stations: source.stations.filter((station) =>
                    ['cauldron', 'grow-container', 'lab-oven'].includes(station.kind)
                ),
            }
        );

        expect(new ProductionBatchPlanner(costs, productionDataset).plan('cocaine', 100)).toEqual({
            dataset: productionDataset,
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
                    acceptedEquipmentItemIds: ['pot'],
                    equipmentItemId: null,
                    growLightItemId: null,
                    additiveItemIds: [],
                    quality: { level: 0.5, tier: 'Standard', customerScalar: 0.5 },
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
                    acceptedEquipmentItemIds: ['cauldron'],
                    equipmentItemId: 'cauldron',
                    growLightItemId: null,
                    additiveItemIds: [],
                    quality: null,
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
                    acceptedEquipmentItemIds: ['oven'],
                    equipmentItemId: 'oven',
                    growLightItemId: null,
                    additiveItemIds: [],
                    quality: null,
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

    it('applies the selected grow container to yield and duration', () => {
        const source = catalog();
        const tent = {
            schema: 'neonschedule1-production-station-3' as const,
            itemId: 'tent',
            kind: 'grow-container' as const,
            yieldMultiplier: 0.6666667,
            growSpeedMultiplier: 1.333333,
            requiresExternalGrowLight: false,
            maxTemperatureGrowthMultiplier: 1,
            minimumTemperatureThreshold: 1,
            maximumTemperatureThreshold: 1,
            allowedSoilIds: ['soil'],
            allowedAdditiveIds: [],
        };
        const selectedCatalog: ProductionCatalog = {
            ...emptyCatalog(),
            seeds: source.seeds.map((seed) => ({
                ...seed,
                soilItemIds: ['soil'],
                baseYieldQuantity: 12,
            })),
            stations: [tent],
        };
        const items = [item('seed', 100), item('leaf'), item('soil', 10, 1), item('tent')];
        const costs = new ProductionMaterialCostEvaluator(
            new Map(items.map((entry) => [entry.id, entry])),
            selectedCatalog,
            { growContainerItemId: 'tent' }
        );

        expect(new ProductionBatchPlanner(costs, productionDataset).plan('leaf', 100)).toMatchObject({
            totalProcessMinutes: 585,
            requiredMaterialCost: 1_430,
            purchaseCost: 1_430,
            productionSteps: [
                {
                    routeId: 'seed:seed:leaf:soil:tent',
                    outputQuantityPerBatch: 8,
                    durationMinutesPerBatch: 45,
                    batchCount: 13,
                    producedQuantity: 104,
                    leftoverQuantity: 4,
                    acceptedEquipmentItemIds: ['tent'],
                    equipmentItemId: 'tent',
                    growLightItemId: null,
                },
            ],
        });
    });

    it('applies a selected external grow light at full exposure', () => {
        const source = catalog();
        const light = {
            schema: 'neonschedule1-production-station-3' as const,
            itemId: 'light',
            kind: 'grow-light' as const,
            growSpeedMultiplier: 1.3,
        };
        const selectedCatalog: ProductionCatalog = {
            ...emptyCatalog(),
            seeds: source.seeds.map((seed) => ({
                ...seed,
                soilItemIds: ['soil'],
                baseYieldQuantity: 12,
            })),
            stations: [source.stations[0]!, light],
        };
        const items = [
            item('seed', 100),
            item('leaf'),
            item('soil', 10, 1),
            item('pot'),
            item('light'),
        ];
        const itemsById = new Map(items.map((entry) => [entry.id, entry]));
        const costs = new ProductionMaterialCostEvaluator(itemsById, selectedCatalog, {
            growContainerItemId: 'pot',
            growLightItemId: 'light',
        });

        expect(new ProductionBatchPlanner(costs, productionDataset).plan('leaf', 100)).toMatchObject({
            totalProcessMinutes: 423,
            requiredMaterialCost: 990,
            purchaseCost: 990,
            productionSteps: [
                {
                    routeId: 'seed:seed:leaf:soil:pot:light',
                    outputQuantityPerBatch: 12,
                    durationMinutesPerBatch: 47,
                    batchCount: 9,
                    producedQuantity: 108,
                    leftoverQuantity: 8,
                    acceptedEquipmentItemIds: ['pot'],
                    equipmentItemId: 'pot',
                    growLightItemId: 'light',
                },
            ],
        });
        expect(
            () =>
                new ProductionMaterialCostEvaluator(itemsById, selectedCatalog, {
                    growContainerItemId: 'pot',
                })
        ).toThrow('Grow container "pot" requires a grow light');
    });
});

function catalog(): ProductionCatalog {
    return {
        ...emptyCatalog(),
        seeds: [
            {
                schema: 'neonschedule1-seed-production-3',
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
                schema: 'neonschedule1-shroom-production-3',
                spawnItemId: 'spawn',
                soilItemIds: ['substrate'],
                productItemId: 'shroom',
                acceptedEquipmentItemIds: ['mushroom-bed'],
                growTimeMinutes: 60,
                baseYieldQuantity: 16,
                maximumTemperatureForGrowth: 1,
                minimumSoilMoistureForGrowth: 0,
            },
        ],
        stationRecipes: [
            {
                schema: 'neonschedule1-station-recipe-2',
                id: 'liquid-meth',
                title: 'Liquid Meth',
                cookTimeMinutes: 1,
                cookTemperature: 1,
                cookTemperatureTolerance: 1,
                qualityCalculationMethod: 'Additive',
                acceptedEquipmentItemIds: ['chemistry-station'],
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
                schema: 'neonschedule1-production-station-3',
                itemId: 'pot',
                kind: 'grow-container',
                yieldMultiplier: 1,
                growSpeedMultiplier: 1,
                requiresExternalGrowLight: true,
                maxTemperatureGrowthMultiplier: 1,
                minimumTemperatureThreshold: 1,
                maximumTemperatureThreshold: 1,
                allowedSoilIds: ['soil', 'reusable-soil'],
                allowedAdditiveIds: [],
            },
            labOvenStation(),
            {
                schema: 'neonschedule1-production-station-3',
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
                schema: 'neonschedule1-production-station-3',
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
        quality: qualityRules(),
        seeds: [],
        shrooms: [],
        stationRecipes: [],
        ovenTransforms: [],
        stations: [],
    };
}

function qualityRules(): ProductionCatalog['quality'] {
    return {
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
    };
}

function labOvenStation(): ProductionCatalog['stations'][number] {
    return {
        schema: 'neonschedule1-production-station-3',
        itemId: 'oven',
        kind: 'lab-oven',
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
