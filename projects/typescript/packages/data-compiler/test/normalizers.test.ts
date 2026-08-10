import { describe, expect, it } from 'vitest';

import type { VerifiedAssets } from '#data-compiler/acquisition/assets';
import type { RawReport } from '#data-compiler/acquisition/types';
import { Integrity } from '#data-compiler/integrity';
import { normalizeEffects } from '#data-compiler/normalize/effects';
import { normalizeItems } from '#data-compiler/normalize/items';
import { normalizeProperties } from '#data-compiler/normalize/properties';
import { normalizeProduction } from '#data-compiler/normalize/production';
import { normalizeRanks } from '#data-compiler/normalize/progression';
import { normalizeShops } from '#data-compiler/normalize/shops';

const noAssets: VerifiedAssets = {
    files: [],
    directFileIdByPath: new Map(),
    offlineFileIdsByMeshKey: new Map(),
    filePathById: new Map(),
    directFileCount: 0,
    offlineFileCount: 0,
};

describe('domain normalization', () => {
    it('normalizes the exported rank order', () => {
        const report = emptyReport();
        report.world.ranks.push(
            { rank: 'Hoodlum', tier: 1, totalXpRequired: 1_000, orderLimitMultiplier: 1.25 },
            { rank: 'Street_Rat', tier: 1, totalXpRequired: 0, orderLimitMultiplier: 1 }
        );
        const integrity = new Integrity();

        const ranks = normalizeRanks(report, integrity);

        expect(ranks.levels.map(({ rank, tier }) => ({ rank, tier }))).toEqual([
            { rank: 'Street_Rat', tier: 1 },
            { rank: 'Hoodlum', tier: 1 },
        ]);
        expect(integrity.errors).toEqual([]);
    });

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
        report.products.push({ id: 'product' });
        report.qualityValues.push(
            ...['Trash', 'Poor', 'Standard', 'Premium', 'Heavenly'].map((quality) => ({
                productId: 'product',
                quality,
                monetaryValue: 38,
            }))
        );
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
                itemId: 'growtent',
                kind: 'grow-container',
                yieldMultiplier: 0.6666667,
                growSpeedMultiplier: 1.333333,
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

        const itemIds = new Set([
            'seed',
            'product',
            'soil',
            'substrate',
            'shroom',
            'input',
            'liquid',
            'mixer',
            'pot',
            'growtent',
            'cauldron',
            'leaf',
            'fuel',
            'base',
            'spawn-station',
            'grain-bag',
            'syringe',
            'spawn',
            'chemistrystation',
            'mushroombed',
        ]);
        const production = normalizeProduction(report, itemIds, new Set(), integrity);

        expect(integrity.errors).toEqual([]);
        expect(production.seeds[0]).toMatchObject({
            seedItemId: 'seed',
            soilItemIds: ['soil'],
            growthTimeMinutes: 540,
            baseYieldQuantity: 12,
            harvestProducts: [{ itemId: 'product', quantity: 1 }],
        });
        expect(production.quality).toEqual({
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
        });
        expect(production.drying).toEqual({
            schema: 'neonschedule1-drying-operation-rules-1',
            requiresUnpackagedProduct: true,
            acceptedProductDrugTypes: ['Cocaine', 'Marijuana', 'Methamphetamine'],
            specialQualityItemIdSubstring: 'cocaleaf',
            specialItemRequiresQualityInstance: true,
            maximumQualityTier: 'Heavenly',
            itemIdTransformation: 'preserved',
            quantityTransformation: 'preserved',
            qualityTierIncrement: 1,
        });
        expect(production.packaging).toEqual({
            schema: 'neonschedule1-packaging-operation-rules-1',
            requiresUnpackagedProduct: true,
            packagingMaterialQuantityPerOperation: 1,
            packagedItemQuantityPerOperation: 1,
            productQuantitySource: 'packaging-definition-quantity',
            itemIdTransformation: 'preserved',
            productStateTransformation: 'unpackaged-to-packaged',
            insufficientProductRemainder: 'left-unpackaged',
            employeeBaseSecondsPerOperation: 5,
            employeeDurationFormula:
                'base-seconds / employee-packaging-speed-multiplier / station-employee-speed-multiplier / employee-current-work-speed',
            manualDuration: 'interactive-not-fixed',
        });
        expect(production.shrooms[0]).toMatchObject({
            spawnItemId: 'spawn',
            soilItemIds: ['substrate'],
            productItemId: 'shroom',
            acceptedEquipmentItemIds: ['mushroombed'],
            growTimeMinutes: 1_080,
        });
        expect(production.stationRecipes[0]).toMatchObject({
            id: 'liquid',
            acceptedEquipmentItemIds: ['chemistrystation'],
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
            itemId: 'growtent',
            kind: 'grow-container',
            requiresExternalGrowLight: false,
        });
        expect(production.stations[2]).toMatchObject({
            itemId: 'mixer',
            kind: 'mixing',
            capacity: 10,
        });
        expect(production.stations[3]).toMatchObject({
            itemId: 'pot',
            kind: 'grow-container',
            requiresExternalGrowLight: true,
        });
        expect(production.stations[4]).toMatchObject({
            itemId: 'spawn-station',
            kind: 'mushroom-spawn',
            grainBagQuantity: 1,
            workTimeMinutes: 6,
            sporeSyringes: [{ syringeQuantity: 1, outputSpawnQuantity: 1 }],
        });

        const pot = report.productionStations.find((station) => station.itemId === 'pot');
        if (pot === undefined) throw new Error('Missing pot fixture');
        pot.allowedAdditiveIds = ['soil'];
        const invalidAdditiveIntegrity = new Integrity();
        normalizeProduction(report, itemIds, new Set(), invalidAdditiveIntegrity);
        expect(invalidAdditiveIntegrity.errors).toContain(
            'report.productionStations["pot"].allowedAdditiveIds references non-additive item "soil"'
        );
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

    it('rejects invalid packaging quantities and product packaging relationships', () => {
        const report = emptyReport();
        report.items.push(
            rawItem('product', 'Product'),
            rawItem('package', 'Packaging'),
            rawItem('loose', 'Ingredient')
        );
        report.products.push({
            id: 'product',
            drugType: 'Marijuana',
            basePrice: 20,
            marketValue: 20,
            baseAddictiveness: 0,
            effectIds: [],
            validPackagingIds: ['package', 'package', 'loose'],
            basePurchasePrice: 1,
        });
        report.packaging.push({ itemId: 'package', quantity: 0, basePurchasePrice: 1 });
        report.discovery.itemPresentations.push(
            { itemId: 'product', description: '', fallbackVisuals: { renderers: [], meshes: [] } },
            { itemId: 'package', description: '' },
            { itemId: 'loose', description: '', fallbackVisuals: { renderers: [], meshes: [] } }
        );
        const integrity = new Integrity();

        normalizeItems(report, noAssets, integrity);

        expect(integrity.errors).toContain('Packaging "package" quantity must be a positive integer');
        expect(integrity.errors).toContain('Product "product" has duplicate valid packaging IDs');
        expect(integrity.errors).toContain(
            'Product "product" references non-packaging item "loose"'
        );
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
        productionLogistics: {},
        qualityValues: [],
        qualityMechanics: {
            customerQualityMaxEffect: 0.3,
            monetaryValueVariesByQuality: false,
            qualityScalars: [
                { quality: 'Trash', scalar: 0 },
                { quality: 'Poor', scalar: 0.25 },
                { quality: 'Standard', scalar: 0.5 },
                { quality: 'Premium', scalar: 0.75 },
                { quality: 'Heavenly', scalar: 1 },
            ],
        },
        shops: [],
        peopleSources: {
            npcRegistryCount: 0,
            lockedCustomerCount: 0,
            unlockedCustomerCount: 0,
            uniquePersonCount: 0,
            uniqueCustomerCount: 0,
            directedConnectionCount: 0,
            uniqueRelationshipEdgeCount: 0,
        },
        people: [],
        relationshipEdges: [],
        customers: [],
        customerConstants: {},
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
        world: {
            currentOrderLimitMultiplierInLoadedSave: 1,
            dealerMechanics: {
                maximumCustomers: 0,
                dealArrivalDelay: 0,
                minimumTravelTime: 0,
                maximumTravelTime: 0,
                overflowSlotCount: 0,
                cashReminderThreshold: 0,
                relationshipChangePerDeal: 0,
            },
            dealers: [],
            suppliers: [],
            properties: [],
            businesses: [],
            employeeTypes: [],
            ranks: [],
        },
        discovery: {
            assetDirectory: 'assets',
            assetFileCount: 0,
            assetVerificationErrors: [],
            itemPresentations: [],
            effectVisuals: [],
            buildables: [],
            propertyLayouts: [],
            shopDetails: [],
            people: [],
            npcSchedules: [],
            uniquePersonArchetypeCount: 0,
            scheduleManagerCount: 0,
            scheduleActionCount: 0,
            visualMeshes: [],
            visualMaterials: [],
            map: {},
            navigation: {},
            locations: [],
            mapServices: [],
            timedAccessZones: [],
        },
    };
}
