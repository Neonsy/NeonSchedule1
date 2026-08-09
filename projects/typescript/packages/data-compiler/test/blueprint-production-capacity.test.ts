import { describe, expect, it } from 'vitest';

import {
    BlueprintProductionCapacityAnalyzer,
    BlueprintProductionScheduleAnalyzer,
    ProductionBatchPlanner,
    ProductionMaterialCostEvaluator,
    type BlueprintDocument,
    type BlueprintProductionCapacityDataset,
    type Buildable,
    type Collider,
    type Item,
    type ProductionBatchPlan,
    type ProductionCatalog,
    type Property,
    type PropertyLayout,
    type Transform,
    type Vector3,
} from '@neonschedule1/core';

const gameVersion = '0.4.6f12';
const datasetSha256 = 'a'.repeat(64);

describe('blueprint production capacity', () => {
    it('reports installed equipment, process records, explicit limits, and tile temperatures', () => {
        const result = analyzer().analyze(blueprint([
            placement('cooler', 'cooler', 0),
            placement('pot', 'pot', 1),
            placement('dryer', 'dryer', 2),
            placement('mixer-two', 'mixer', 4),
            placement('mixer-one', 'mixer', 3),
            placement('chemistry', 'chemistry', 5),
            placement('mushroom-bed', 'mushroom-bed', 6),
            placement('decoration', 'decoration', 7),
        ]));

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.capacityScope).toBe('installed-production-equipment');
        expect(result.processValues).toBe('normalized-records');
        expect(result.parallelScheduling).toBe('not-evaluated');
        expect(result.effectiveTemperature).toBe('not-evaluated');
        expect(result.equipment.map((entry) => entry.itemId)).toEqual([
            'chemistry',
            'dryer',
            'mixer',
            'mushroom-bed',
            'pot',
        ]);

        const pot = result.equipment.find((entry) => entry.itemId === 'pot')!;
        expect(pot).toMatchObject({
            installedUnitCount: 1,
            itemLimitPerUnit: null,
            installedItemLimit: null,
            processes: [{
                id: 'seed:seed:leaf',
                kind: 'seed-harvest',
                inputItemIds: ['seed', 'soil'],
                outputItemId: 'leaf',
                recordedOutputQuantity: 10,
                recordedItemLimit: null,
                recordedDuration: { kind: 'fixed', minutes: 60 },
                temperatureRule: {
                    kind: 'environmental-performance-range',
                    minimumTemperature: 20,
                    maximumTemperature: 40,
                    maximumMultiplier: 1.5,
                },
            }],
        });
        expect(pot.placements[0]?.temperature).toEqual({
            kind: 'property-grid-tiles',
            coverageProofStatus: 'exact',
            temperatureCombination: 'not-evaluated',
            tiles: [{
                gridId: 'main',
                x: 1,
                y: 0,
                ambientTemperature: 20,
                sources: [{
                    placementId: 'cooler',
                    emitterIndex: 0,
                    temperature: 0,
                    distance: 2,
                }],
            }],
        });

        const dryer = result.equipment.find((entry) => entry.itemId === 'dryer')!;
        expect(dryer).toMatchObject({
            installedUnitCount: 1,
            itemLimitPerUnit: 20,
            installedItemLimit: 20,
            processes: [{
                id: 'drying-rack:dryer',
                kind: 'drying-rack',
                recordedItemLimit: 20,
                recordedDuration: { kind: 'per-tier', minutes: 720 },
                temperatureRule: {
                    kind: 'environmental-performance-range',
                    minimumTemperature: 20,
                    maximumTemperature: 40,
                    maximumMultiplier: 1.5,
                },
            }],
        });
        expect(dryer.placements[0]?.temperature).toMatchObject({
            tiles: [{ x: 2, ambientTemperature: 20, sources: [] }],
        });

        const mixer = result.equipment.find((entry) => entry.itemId === 'mixer')!;
        expect(mixer).toMatchObject({
            installedUnitCount: 2,
            itemLimitPerUnit: 10,
            installedItemLimit: 20,
            placements: [
                { placementId: 'mixer-two' },
                { placementId: 'mixer-one' },
            ],
            processes: [{
                id: 'mixing:mixer',
                kind: 'mixing',
                recordedItemLimit: 10,
                recordedDuration: { kind: 'per-item', minutes: 6 },
            }],
        });

        const chemistry = result.equipment.find((entry) => entry.itemId === 'chemistry')!;
        expect(chemistry).toMatchObject({
            station: null,
            processes: [{
                id: 'recipe:liquid',
                kind: 'station-recipe',
                outputItemId: 'liquid',
                recordedOutputQuantity: 1,
                recordedDuration: { kind: 'fixed', minutes: 10 },
                temperatureRule: {
                    kind: 'internal-cook-setpoint',
                    temperature: 180,
                    tolerance: 25,
                },
            }],
        });

        const bed = result.equipment.find((entry) => entry.itemId === 'mushroom-bed')!;
        expect(bed).toMatchObject({
            station: null,
            processes: [{
                id: 'shroom:spawn:shroom',
                kind: 'shroom-harvest',
                outputItemId: 'shroom',
                recordedOutputQuantity: 16,
                recordedDuration: { kind: 'fixed', minutes: 1_080 },
                temperatureRule: {
                    kind: 'environmental-maximum',
                    maximumTemperature: 15,
                },
            }],
        });
    });

    it('preserves blueprint rejection without reporting production capacity', () => {
        const result = analyzer().analyze(blueprint([
            placement('pot', 'pot', 99),
        ]));

        expect(result.kind).toBe('rejected');
        expect(result.equipment).toEqual([]);
        expect(result.temperature.kind).toBe('rejected');
    });

    it('keeps overlapping emitter evidence without choosing an effective temperature', () => {
        const source = dataset();
        const result = new BlueprintProductionCapacityAnalyzer({
            ...source,
            buildables: [
                ...source.buildables,
                buildable('heater', [{
                    temperature: 30,
                    range: 2,
                    emissionPoint: vector(0, 0, 0),
                }]),
            ],
        }).analyze(blueprint([
            placement('cooler', 'cooler', 0),
            placement('pot', 'pot', 1),
            placement('heater', 'heater', 2),
        ]));

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.effectiveTemperature).toBe('not-evaluated');
        expect(result.equipment[0]?.placements[0]?.temperature).toMatchObject({
            temperatureCombination: 'not-evaluated',
            tiles: [{
                x: 1,
                sources: [
                    { placementId: 'cooler', temperature: 0, distance: 2 },
                    { placementId: 'heater', temperature: 30, distance: 2 },
                ],
            }],
        });
    });

    it('rejects duplicate production station identities', () => {
        const source = dataset();
        const pot = source.production.stations.find((station) => station.itemId === 'pot')!;

        expect(() => new BlueprintProductionCapacityAnalyzer({
            ...source,
            production: {
                ...source.production,
                stations: [...source.production.stations, pot],
            },
        })).toThrow('duplicate production station item ID "pot"');

        expect(() => new BlueprintProductionCapacityAnalyzer({
            ...source,
            production: {
                ...source.production,
                stations: source.production.stations.map((station) =>
                    station.kind === 'grow-container'
                        ? { ...station, maximumTemperatureThreshold: 10 }
                        : station
                ),
            },
        })).toThrow('Grow-container minimum temperature must not exceed its maximum');
    });

    it('schedules whole batches across installed units within each production step', () => {
        const result = new BlueprintProductionScheduleAnalyzer(dataset()).analyze(
            blueprint([
                placement('pot-b', 'pot', 1),
                placement('chemistry', 'chemistry', 2),
                placement('pot-a', 'pot', 0),
            ]),
            schedulePlan()
        );

        expect(result.kind).toBe('scheduled');
        if (result.kind !== 'scheduled') return;
        expect(result).toMatchObject({
            durationBasis: 'production-batch-plan',
            parallelScheduling: 'whole-batches-within-each-production-step',
            crossStepConcurrency: 'not-evaluated',
            batchPipelining: 'not-evaluated',
            routing: 'not-evaluated',
            lightingCoverage: 'not-evaluated',
            effectiveTemperature: 'not-evaluated',
            serialProcessMinutes: 350,
            scheduledElapsedMinutes: 230,
            parallelTimeSavedMinutes: 120,
            schedule: [
                {
                    stepIndex: 0,
                    itemId: 'leaf',
                    equipmentItemId: 'pot',
                    installedUnitCount: 2,
                    usedUnitCount: 2,
                    batchCount: 5,
                    durationMinutesPerBatch: 60,
                    waveCount: 3,
                    startMinute: 0,
                    endMinute: 180,
                    elapsedMinutes: 180,
                    assignments: [
                        {
                            placementId: 'pot-a',
                            firstBatchNumber: 1,
                            lastBatchNumber: 3,
                            batchCount: 3,
                            startMinute: 0,
                            endMinute: 180,
                        },
                        {
                            placementId: 'pot-b',
                            firstBatchNumber: 4,
                            lastBatchNumber: 5,
                            batchCount: 2,
                            startMinute: 0,
                            endMinute: 120,
                        },
                    ],
                },
                {
                    stepIndex: 1,
                    itemId: 'liquid',
                    equipmentItemId: 'chemistry',
                    installedUnitCount: 1,
                    usedUnitCount: 1,
                    batchCount: 5,
                    waveCount: 5,
                    startMinute: 180,
                    endMinute: 230,
                },
            ],
        });
    });

    it('preserves blueprint rejection without producing a schedule', () => {
        const result = new BlueprintProductionScheduleAnalyzer(dataset()).analyze(
            blueprint([
                placement('pot', 'pot', 99),
                placement('chemistry', 'chemistry', 1),
            ]),
            schedulePlan()
        );

        expect(result.kind).toBe('rejected');
        expect(result.schedule).toEqual([]);
    });

    it('returns no partial schedule when compatible equipment is missing', () => {
        const result = new BlueprintProductionScheduleAnalyzer(dataset()).analyze(
            blueprint([placement('pot', 'pot', 0)]),
            schedulePlan()
        );

        expect(result.kind).toBe('unavailable');
        if (result.kind !== 'unavailable') return;
        expect(result.schedule).toEqual([]);
        expect(result.issues).toEqual([{
            code: 'missing-compatible-equipment',
            stepIndex: 1,
            itemId: 'liquid',
            routeId: 'recipe:liquid',
            acceptedEquipmentItemIds: ['chemistry'],
            selectedEquipmentItemId: 'chemistry',
            compatibleInstalledEquipmentItemIds: [],
        }]);
    });

    it('requires an equipment choice instead of combining heterogeneous station types', () => {
        const source = dataset();
        const recipe = source.production.stationRecipes[0]!;
        const plan = schedulePlan();
        const liquid = plan.productionSteps[1]!;
        const result = new BlueprintProductionScheduleAnalyzer({
            ...source,
            buildables: [...source.buildables, buildable('chemistry-mk2')],
            production: {
                ...source.production,
                stationRecipes: [{
                    ...recipe,
                    acceptedEquipmentItemIds: ['chemistry', 'chemistry-mk2'],
                }],
            },
        }).analyze(
            blueprint([
                placement('pot', 'pot', 0),
                placement('chemistry', 'chemistry', 1),
                placement('chemistry-mk2', 'chemistry-mk2', 2),
            ]),
            {
                ...plan,
                productionSteps: [
                    plan.productionSteps[0]!,
                    {
                        ...liquid,
                        acceptedEquipmentItemIds: ['chemistry', 'chemistry-mk2'],
                        equipmentItemId: null,
                    },
                ],
            }
        );

        expect(result.kind).toBe('unavailable');
        if (result.kind !== 'unavailable') return;
        expect(result.issues).toEqual([{
            code: 'equipment-selection-required',
            stepIndex: 1,
            itemId: 'liquid',
            routeId: 'recipe:liquid',
            acceptedEquipmentItemIds: ['chemistry', 'chemistry-mk2'],
            selectedEquipmentItemId: null,
            compatibleInstalledEquipmentItemIds: ['chemistry', 'chemistry-mk2'],
        }]);
    });

    it('rejects a batch plan whose produced dependency appears after its consumer', () => {
        const plan = schedulePlan();

        expect(() => new BlueprintProductionScheduleAnalyzer(dataset()).analyze(
            blueprint([
                placement('pot', 'pot', 0),
                placement('chemistry', 'chemistry', 1),
            ]),
            {
                ...plan,
                targetItemId: 'leaf',
                productionSteps: [...plan.productionSteps].reverse(),
            }
        )).toThrow('Production step "recipe:liquid" depends on later step item "leaf"');
    });

    it('rejects a batch plan from a different normalized dataset', () => {
        const plan = schedulePlan();

        expect(() => new BlueprintProductionScheduleAnalyzer(dataset()).analyze(
            blueprint([
                placement('pot', 'pot', 0),
                placement('chemistry', 'chemistry', 1),
            ]),
            {
                ...plan,
                dataset: { ...plan.dataset, datasetSha256: 'b'.repeat(64) },
            }
        )).toThrow('Production plan belongs to a different normalized dataset');
    });

    it('does not treat a different process route with the same output as compatible', () => {
        const plan = schedulePlan();
        const liquid = plan.productionSteps[1]!;
        const result = new BlueprintProductionScheduleAnalyzer(dataset()).analyze(
            blueprint([
                placement('pot', 'pot', 0),
                placement('chemistry', 'chemistry', 1),
            ]),
            {
                ...plan,
                productionSteps: [
                    plan.productionSteps[0]!,
                    { ...liquid, routeId: 'recipe:other' },
                ],
            }
        );

        expect(result.kind).toBe('unavailable');
        if (result.kind !== 'unavailable') return;
        expect(result.issues).toEqual([{
            code: 'missing-compatible-equipment',
            stepIndex: 1,
            itemId: 'liquid',
            routeId: 'recipe:other',
            acceptedEquipmentItemIds: ['chemistry'],
            selectedEquipmentItemId: 'chemistry',
            compatibleInstalledEquipmentItemIds: [],
        }]);
    });
});

function schedulePlan(): ProductionBatchPlan {
    const items = ['seed', 'soil', 'leaf', 'liquid', 'pot', 'chemistry']
        .map((itemId) => item(itemId, ['seed', 'soil'].includes(itemId) ? 1 : null));
    const catalog = production();
    const costs = new ProductionMaterialCostEvaluator(
        new Map(items.map((entry) => [entry.id, entry])),
        { ...catalog, shrooms: [] }
    );
    return new ProductionBatchPlanner(
        costs,
        { gameVersion, datasetSha256 }
    ).plan('liquid', 5);
}

function analyzer(): BlueprintProductionCapacityAnalyzer {
    return new BlueprintProductionCapacityAnalyzer(dataset());
}

function dataset(): BlueprintProductionCapacityDataset {
    return {
        manifest: { gameVersion, datasetSha256 },
        properties: [property()],
        buildables: [
            buildable('cooler', [{ temperature: 0, range: 2, emissionPoint: vector(0, 0, 0) }]),
            buildable('pot'),
            buildable('dryer'),
            buildable('mixer'),
            buildable('chemistry'),
            buildable('mushroom-bed'),
            buildable('decoration'),
        ],
        propertyLayouts: [propertyLayout()],
        production: production(),
    };
}

function production(): ProductionCatalog {
    return {
        schema: 'neonschedule1-production-catalog-5',
        quality: {
            basePlantLevel: 0.5,
            monetaryValueVariesByQuality: false,
            customerQualityMaxEffect: 0.3,
            tiers: [{ name: 'Standard', minimumLevelExclusive: null, customerScalar: 0.5 }],
        },
        seeds: [{
            schema: 'neonschedule1-seed-production-3',
            seedItemId: 'seed',
            soilItemIds: ['soil'],
            plantRuntimeType: 'Game.Plant',
            growthTimeMinutes: 60,
            baseYieldQuantity: 10,
            harvestTarget: 'leaf',
            harvestProducts: [{ itemId: 'leaf', quantity: 1 }],
        }],
        shrooms: [{
            schema: 'neonschedule1-shroom-production-3',
            spawnItemId: 'spawn',
            soilItemIds: ['mushroom-soil'],
            productItemId: 'shroom',
            acceptedEquipmentItemIds: ['mushroom-bed'],
            growTimeMinutes: 1_080,
            baseYieldQuantity: 16,
            maximumTemperatureForGrowth: 15,
            minimumSoilMoistureForGrowth: 0,
        }],
        stationRecipes: [{
            schema: 'neonschedule1-station-recipe-2',
            id: 'liquid',
            title: 'Liquid',
            cookTimeMinutes: 10,
            cookTemperature: 180,
            cookTemperatureTolerance: 25,
            qualityCalculationMethod: 'Additive',
            acceptedEquipmentItemIds: ['chemistry'],
            ingredients: [{ quantity: 10, acceptedItemIds: ['leaf'] }],
            outputItemId: 'liquid',
            outputQuantity: 1,
        }],
        ovenTransforms: [],
        stations: [
            {
                schema: 'neonschedule1-production-station-3',
                itemId: 'pot',
                kind: 'grow-container',
                yieldMultiplier: 1,
                growSpeedMultiplier: 1,
                requiresExternalGrowLight: true,
                maxTemperatureGrowthMultiplier: 1.5,
                minimumTemperatureThreshold: 20,
                maximumTemperatureThreshold: 40,
                allowedSoilIds: ['soil'],
                allowedAdditiveIds: [],
            },
            {
                schema: 'neonschedule1-production-station-3',
                itemId: 'dryer',
                kind: 'drying-rack',
                capacity: 20,
                maxProcessMultiplier: 1.5,
                processMinutesPerTier: 720,
                minimumTemperatureThreshold: 20,
                maximumTemperatureThreshold: 40,
            },
            {
                schema: 'neonschedule1-production-station-3',
                itemId: 'mixer',
                kind: 'mixing',
                capacity: 10,
                timePerItem: 6,
                requiresManualIngredientInsertion: true,
            },
        ],
    };
}

function blueprint(placements: BlueprintDocument['placements']): BlueprintDocument {
    return {
        schema: 'neonschedule1-blueprint-1',
        gameVersion,
        datasetSha256,
        propertyCode: 'warehouse',
        placements,
    };
}

function placement(
    id: string,
    itemId: string,
    x: number
): BlueprintDocument['placements'][number] {
    return { id, kind: 'grid', itemId, gridId: 'main', anchor: { x, y: 0 }, rotation: 0 };
}

function property(): Property {
    return {
        schema: 'neonschedule1-property-1',
        code: 'warehouse',
        name: 'Warehouse',
        price: 0,
        employeeCapacity: 1,
        loadingDockCount: 0,
        gridCount: 1,
        ambientTemperature: 20,
        ownedByDefault: false,
        position: vector(0, 0, 0),
        business: null,
        hasLayout: true,
    };
}

function buildable(
    itemId: string,
    temperatureEmitters: Buildable['temperatureEmitters'] = []
): Buildable {
    return {
        schema: 'neonschedule1-buildable-4',
        itemId,
        runtimeType: 'Game.GridItem',
        placement: {
            kind: 'grid',
            holdDistance: 3,
            footprintWidth: 1,
            footprintHeight: 1,
            proceduralTileType: null,
            tileSharingRule: 'standard',
            tileSharingImplementation: 'Game.GridItem',
            allowRotation: null,
            rotationIncrement: null,
            validSurfaceTypes: [],
            buildPoint: transform('BuildPoint'),
            midAirCenterPoint: null,
            boundingCollider: collider(),
            footprintTiles: [{
                x: 0,
                y: 0,
                requiredOffset: 0,
                transform: transform('Footprint/[0,0]'),
                cornerObstacles: [],
            }],
        },
        componentTypes: [],
        colliders: [],
        storage: null,
        temperatureEmitters,
        interactionPoints: [],
        isTransitEntity: false,
        transitAccessPoints: [],
        proceduralTiles: [],
        visuals: { renderers: [], meshes: [] },
    };
}

function item(id: string, basePurchasePrice: number | null): Item {
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
        soil: id === 'soil' ? { quality: 'Test', uses: 1 } : null,
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

function propertyLayout(): PropertyLayout {
    return {
        schema: 'neonschedule1-property-layout-4',
        propertyCode: 'warehouse',
        propertyName: 'Warehouse',
        worldPosition: vector(0, 0, 0),
        worldRotation: vector(0, 0, 0),
        spawnPoint: transform('Spawn'),
        interiorSpawnPoint: transform('InteriorSpawn'),
        npcSpawnPoint: transform('NpcSpawn'),
        boundingBox: null,
        boundaryColliders: [],
        fixedColliders: [],
        surfaceMeshes: [],
        surfaces: [],
        proceduralTiles: [],
        loadingDocks: [],
        grids: [{
            id: 'main',
            width: 8,
            height: 1,
            tileSize: 2,
            worldOrigin: vector(0, 0, 0),
            tiles: Array.from({ length: 8 }, (_, x) => ({
                x,
                y: 0,
                availableOffset: 0,
                worldPosition: vector(2 * x, 0, 0),
                worldRotation: vector(0, 0, 0),
            })),
        }],
        visuals: { renderers: [], meshes: [] },
    };
}

function collider(): Collider {
    const zero = vector(0, 0, 0);
    const one = vector(1, 1, 1);
    return {
        source: 'fixture',
        runtimeType: 'UnityEngine.BoxCollider',
        shape: 'box',
        enabled: true,
        isTrigger: false,
        layer: 0,
        layerName: 'Default',
        tag: 'Untagged',
        transform: transform('Bounds'),
        worldScale: one,
        worldBasis: { right: vector(1, 0, 0), up: vector(0, 1, 0), forward: vector(0, 0, 1) },
        worldBounds: { center: zero, size: one },
        localCenter: zero,
        localSize: one,
        radius: null,
        height: null,
        direction: null,
        meshName: null,
        meshId: null,
        meshIsReadable: null,
        isConvex: null,
    };
}

function transform(path: string): Transform {
    return {
        name: path,
        path,
        worldPosition: vector(0, 0, 0),
        localPosition: vector(0, 0, 0),
        worldRotation: vector(0, 0, 0),
        localScale: vector(1, 1, 1),
    };
}

function vector(x: number, y: number, z: number): Vector3 {
    return { x, y, z };
}
