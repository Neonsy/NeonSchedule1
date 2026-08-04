import { describe, expect, it } from 'vitest';

import type { VerifiedAssets } from '#data-compiler/acquisition/assets';
import type { RawReport } from '#data-compiler/acquisition/types';
import { Integrity } from '#data-compiler/integrity';
import { normalizeEffects } from '#data-compiler/normalize/effects';
import { normalizeItems } from '#data-compiler/normalize/items';
import { normalizeProperties } from '#data-compiler/normalize/properties';
import { normalizeProduction } from '#data-compiler/normalize/production';
import { normalizeShops } from '#data-compiler/normalize/shops';

const noAssets: VerifiedAssets = {
    files: [],
    directFileIdByPath: new Map(),
    offlineFileIdsByMeshKey: new Map(),
    directFileCount: 0,
    offlineFileCount: 0,
};

describe('domain normalization', () => {
    it('joins effect presentation data and validates inbound effect references', () => {
        const report = emptyReport();
        report.mixing.effects.push({
            id: 'calming',
            name: 'Calming',
            tier: 1,
            addictiveness: 0.1,
            implementedPriorMixingRework: true,
            valueChange: 0,
            valueMultiplier: 1,
            addBaseValueMultiple: 0.1,
            mixDirectionX: 0,
            mixDirectionY: 1,
            mixMagnitude: 1,
        });
        report.discovery.effectVisuals.push({
            effectId: 'calming',
            name: 'Calming',
            description: 'Calms the user.',
            productColor: rgba('#FFFFFFFF'),
            labelColor: rgba('#808080FF'),
        });
        report.products.push({ id: 'known-product', effectIds: ['calming'] });
        report.mixing.ingredients.push({ id: 'broken-ingredient', effectIds: ['missing'] });
        const integrity = new Integrity();

        const effects = normalizeEffects(report, integrity);

        expect(effects).toHaveLength(1);
        expect(effects[0]).toMatchObject({
            id: 'calming',
            mixing: { direction: { x: 0, y: 1 }, magnitude: 1 },
            presentation: { description: 'Calms the user.' },
        });
        expect(integrity.errors).toContain('ingredient broken-ingredient effect references missing id "missing"');
    });

    it('joins item presentation and shop details without copying item data into listings', () => {
        const report = emptyReport();
        report.items.push({
            id: 'coffee',
            name: 'Coffee',
            category: 'Consumable',
            stackLimit: 20,
            isStorable: true,
            basePurchasePrice: 5,
            resellMultiplier: 0.5,
            requiresLevelToPurchase: false,
            requiredRank: 'Street_Rat',
            requiredRankTier: 0,
        });
        report.discovery.itemPresentations.push({
            itemId: 'coffee',
            description: 'A drink',
            fallbackVisuals: {
                renderers: [{ materialAssetReferenceKeys: ['material:coffee'] }],
                meshes: [{ meshAssetReferenceKey: 'mesh:coffee' }],
            },
        });
        report.shops.push({
            code: 'corner',
            listings: [
                {
                    itemId: 'coffee',
                    resolvedPrice: 8,
                    limitedStock: false,
                    defaultStock: -1,
                    canBeDelivered: true,
                },
            ],
        });
        report.discovery.shopDetails.push({
            code: 'corner',
            name: 'Corner Shop',
            description: 'General goods',
            paymentType: 'Cash',
            sceneName: 'Main',
            locationSource: 'supplier-phone-interface',
            holderPersonId: '',
            deliveryBayPositions: [],
        });
        const integrity = new Integrity();

        const items = normalizeItems(report, noAssets, integrity);
        const shops = normalizeShops(report, new Set(items.map((item) => item.id)), integrity);

        expect(integrity.errors).toEqual([]);
        expect(items[0]?.presentation.description).toBe('A drink');
        expect(items[0]?.presentation.iconFileId).toBeNull();
        expect(items[0]?.presentation.visualKind).toBe('model');
        expect(items[0]?.presentation.fallbackMeshIds).toEqual(['mesh:coffee']);
        expect(shops[0]?.position).toBeNull();
        expect(shops[0]?.openTime).toBeNull();
        expect(shops[0]?.listings).toEqual([{ itemId: 'coffee', price: 8, defaultStock: null, canBeDelivered: true }]);
        expect(shops[0]?.listings[0]).not.toHaveProperty('name');
    });

    it('attaches mixing data to its item and reports duplicated economic drift', () => {
        const report = emptyReport();
        report.items.push(rawItem('cuke', 'Ingredient'));
        report.mixing.ingredients.push({
            id: 'cuke',
            name: 'cuke',
            basePurchasePrice: 2,
            resellMultiplier: 0.5,
            effectIds: ['energizing'],
        });
        report.discovery.itemPresentations.push({
            itemId: 'cuke',
            description: '',
            fallbackVisuals: {
                renderers: [{ materialAssetReferenceKeys: ['material:cuke'] }],
                meshes: [{ meshAssetReferenceKey: 'mesh:cuke' }],
            },
        });
        const integrity = new Integrity();

        const items = normalizeItems(report, noAssets, integrity);

        expect(items[0]?.mixingIngredient).toEqual({ effectIds: ['energizing'] });
        expect(integrity.errors).toContain(
            'Mixing ingredient "cuke" basePurchasePrice differs from its item'
        );
    });

    it('reports broken shop references and contradictory property ownership', () => {
        const report = emptyReport();
        report.shops.push({
            code: 'corner',
            listings: [
                {
                    itemId: 'missing',
                    resolvedPrice: 8,
                    limitedStock: false,
                    defaultStock: -1,
                    canBeDelivered: false,
                },
            ],
        });
        report.discovery.shopDetails.push({
            code: 'corner',
            name: 'Corner Shop',
            description: 'General goods',
            paymentType: 'Cash',
            sceneName: 'Main',
            locationSource: 'shopkeeper-schedule',
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            holderPersonId: null,
            openTime: 700,
            closeTime: 1800,
            deliveryBayPositions: [],
        });
        report.world.properties.push({
            code: 'barn',
            name: 'Barn',
            price: 100,
            employeeCapacity: 2,
            loadingDockCount: 1,
            gridCount: 1,
            ambientTemperature: 20,
            ownedByDefault: false,
            isBusiness: true,
            position: { x: 0, y: 0, z: 0 },
        });
        report.discovery.propertyLayouts.push({ propertyCode: 'barn' });
        const integrity = new Integrity();

        normalizeShops(report, new Set(), integrity);
        normalizeProperties(report, integrity);

        expect(integrity.errors).toContain('shop report.shops["corner"] references missing id "missing"');
        expect(integrity.errors).toContain('Property "barn" business flag and business record differ');
    });

    it('normalizes production definitions with item references intact', () => {
        const report = emptyReport();
        report.seeds.push({
            itemId: 'seed',
            plantRuntimeType: 'Plant',
            growthTime: 9,
            baseYieldQuantity: 12,
            harvestTarget: 'buds',
            harvestables: [{ productId: 'product', quantity: 1 }],
        });
        report.shroomSpawns.push({
            itemId: 'spawn',
            productId: 'shroom',
            growTime: 18,
            baseYieldQuantity: 16,
            maximumTemperatureForGrowth: 15,
            minimumSoilMoistureForGrowth: 0.1,
        });
        report.soils.push(
            { itemId: 'soil', quality: 'Basic', uses: 1 },
            { itemId: 'substrate', quality: 'Basic', uses: 1 }
        );
        report.recipes.push({
            id: 'liquid',
            title: 'Liquid',
            cookTimeMinutes: 60,
            cookTemperature: 100,
            cookTemperatureTolerance: 5,
            qualityCalculationMethod: 'Additive',
            ingredients: [{ quantity: 1, acceptedItemIds: ['input'] }],
            outputItemId: 'liquid',
            outputQuantity: 1,
        });
        report.ovenTransforms.push({
            inputItemId: 'liquid',
            cookType: 'Liquid',
            cookTime: 60,
            outputItemId: 'product',
            outputQuantity: 10,
        });
        report.productionStations.push({
            itemId: 'mixer',
            kind: 'mixing',
            capacity: 10,
            timePerItem: 6,
            requiresManualIngredientInsertion: true,
        });
        report.productionStations.push(
            {
                itemId: 'pot',
                kind: 'grow-container',
                yieldMultiplier: 1,
                growSpeedMultiplier: 1,
                maxTemperatureGrowthMultiplier: 1.5,
                minimumTemperatureThreshold: 20,
                maximumTemperatureThreshold: 40,
                allowedSoilIds: ['soil'],
                allowedAdditiveIds: [],
            },
            {
                itemId: 'cauldron',
                kind: 'cauldron',
                cookTime: 6,
                requiredPrimaryInputQuantity: 20,
                primaryInputItemId: 'leaf',
                secondaryInputItemId: 'fuel',
                outputItemId: 'base',
            },
            {
                itemId: 'spawn-station',
                kind: 'mushroom-spawn',
                grainBagItemId: 'grain-bag',
                sporeSyringes: [{ itemId: 'syringe', outputSpawnItemId: 'spawn' }],
            }
        );
        const integrity = new Integrity();

        const production = normalizeProduction(
            report,
            new Set([
                'seed',
                'product',
                'soil',
                'substrate',
                'shroom',
                'input',
                'liquid',
                'mixer',
                'pot',
                'cauldron',
                'leaf',
                'fuel',
                'base',
                'spawn-station',
                'grain-bag',
                'syringe',
                'spawn',
            ]),
            integrity
        );

        expect(integrity.errors).toEqual([]);
        expect(production.seeds[0]).toMatchObject({
            seedItemId: 'seed',
            soilItemIds: ['soil'],
            growthTimeMinutes: 540,
            baseYieldQuantity: 12,
            harvestProducts: [{ itemId: 'product', quantity: 1 }],
        });
        expect(production.shrooms[0]).toMatchObject({
            spawnItemId: 'spawn',
            soilItemIds: ['substrate'],
            productItemId: 'shroom',
            growTimeMinutes: 1_080,
        });
        expect(production.stationRecipes[0]).toMatchObject({
            id: 'liquid',
            ingredients: [{ quantity: 1, acceptedItemIds: ['input'] }],
        });
        expect(production.ovenTransforms[0]).toMatchObject({
            inputItemId: 'liquid',
            cookTimeMinutes: 60,
            outputItemId: 'product',
            outputQuantity: 10,
        });
        expect(production.stations[0]).toMatchObject({
            itemId: 'cauldron',
            kind: 'cauldron',
            cookTimeMinutes: 6,
            secondaryInputQuantity: 1,
            outputQuantity: 10,
        });
        expect(production.stations[1]).toMatchObject({
            itemId: 'mixer',
            kind: 'mixing',
            capacity: 10,
        });
        expect(production.stations[3]).toMatchObject({
            itemId: 'spawn-station',
            kind: 'mushroom-spawn',
            grainBagQuantity: 1,
            workTimeMinutes: 6,
            sporeSyringes: [{ syringeQuantity: 1, outputSpawnQuantity: 1 }],
        });
    });

    it('classifies intentional iconless definitions and reports unexplained ones', () => {
        const report = emptyReport();
        report.items.push(
            rawItem('cuke_effects', 'Product'),
            rawItem('package', 'Packaging'),
            rawItem('unexpected-product', 'Product')
        );
        report.packaging.push({ itemId: 'package', quantity: 20, basePurchasePrice: 1 });
        report.discovery.itemPresentations.push(
            { itemId: 'cuke_effects', description: '' },
            { itemId: 'package', description: '' },
            {
                itemId: 'unexpected-product',
                description: '',
                fallbackVisuals: {
                    renderers: [{ materialAssetReferenceKeys: ['material:unexpected'] }],
                    meshes: [{ meshAssetReferenceKey: 'mesh:unexpected' }],
                },
            }
        );
        const integrity = new Integrity();

        const items = normalizeItems(report, noAssets, integrity);
        const byId = new Map(items.map((item) => [item.id, item]));

        expect(byId.get('cuke_effects')).toMatchObject({
            isRuntimeOnly: true,
            presentation: { visualKind: 'none' },
        });
        expect(byId.get('package')).toMatchObject({
            isRuntimeOnly: false,
            presentation: { visualKind: 'variant-dependent' },
        });
        expect(integrity.errors).toContain(
            'Product-category item "unexpected-product" has no product record'
        );
        expect(byId.get('unexpected-product')?.isRuntimeOnly).toBe(false);
    });
});

function rawItem(id: string, category: string) {
    return {
        id,
        name: id,
        category,
        stackLimit: 10,
        isStorable: true,
        basePurchasePrice: 1,
        resellMultiplier: 0.5,
        requiresLevelToPurchase: false,
        requiredRank: 'Street_Rat',
        requiredRankTier: 0,
    };
}

function rgba(htmlRgba: string) {
    return { r: 1, g: 1, b: 1, a: 1, htmlRgba };
}

function emptyReport(): RawReport {
    return {
        document: {},
        schemaVersion: 'neonschedule1-game-data-export-1',
        exporterVersion: 'test',
        gameVersion: 'test',
        items: [],
        products: [],
        packaging: [],
        additives: [],
        soils: [],
        recipes: [],
        seeds: [],
        shroomSpawns: [],
        ovenTransforms: [],
        productionStations: [],
        shops: [],
        mixing: {
            maxProperties: 8,
            maxDeltaDifference: 0.5,
            validIngredientCount: 0,
            effectCount: 0,
            mixerMapEffectCounts: {},
            defaultProductIds: [],
            effects: [],
            ingredients: [],
            mixerMaps: [],
            oracles: [],
        },
        world: { properties: [], businesses: [] },
        discovery: {
            assetDirectory: 'assets',
            assetFileCount: 0,
            assetVerificationErrors: [],
            itemPresentations: [],
            effectVisuals: [],
            buildables: [],
            propertyLayouts: [],
            shopDetails: [],
            visualMeshes: [],
            visualMaterials: [],
        },
    };
}
