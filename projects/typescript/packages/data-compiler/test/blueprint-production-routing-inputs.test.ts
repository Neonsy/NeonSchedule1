import { describe, expect, it } from 'vitest';

import {
    BlueprintProductionRoutingInputsAnalyzer,
    type BlueprintDocument,
    type BlueprintProductionCapacityDataset,
    type Buildable,
    type Collider,
    type ProductionCatalog,
    type Property,
    type PropertyLayout,
    type Transform,
    type Vector3,
} from '@neonschedule1/core';

const gameVersion = 'test';
const datasetSha256 = 'a'.repeat(64);

describe('blueprint production routing inputs', () => {
    it('projects recorded production-equipment endpoints without inferring routes', () => {
        const result = analyzer().analyze(blueprint([
            placement('pot', 'pot', 0),
            placement('decoration', 'decoration', 2),
            placement('chemistry', 'chemistry', 1),
        ]));

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result).toMatchObject({
            endpointBasis: 'normalized-buildable-interaction-and-transit-points',
            interactionRoleBasis: 'exported-classification',
            routeConnectivity: 'not-evaluated',
            employeeReachability: 'not-evaluated',
            itemFlowDirection: 'not-evaluated',
            staticObstacleClearance: 'not-evaluated',
            dynamicObstacleClearance: 'not-evaluated',
            placements: [
                {
                    placementId: 'chemistry',
                    itemId: 'chemistry',
                    placementKind: 'grid',
                    isTransitEntity: true,
                    operatorAccessPoints: [{
                        interactionPointIndex: 0,
                        role: 'operator-access',
                        componentType: 'Game.ChemistryStation',
                        member: 'AccessPoint',
                        transform: { path: 'AccessPoint', worldPosition: vector(11, 0, 0) },
                    }],
                    itemPlacementPoints: [{
                        interactionPointIndex: 1,
                        role: 'item-placement',
                        member: 'IngredientTransform',
                        transform: { worldPosition: vector(12, 0, 0) },
                    }],
                    automationLinkPoints: [{
                        interactionPointIndex: 2,
                        role: 'automation-link',
                        member: 'LinkOrigin',
                        transform: { worldPosition: vector(13, 0, 0) },
                    }],
                    transitAccessPoints: [{
                        accessPointIndex: 0,
                        transform: { path: 'TransitAccess', worldPosition: vector(14, 0, 0) },
                    }],
                },
                {
                    placementId: 'pot',
                    itemId: 'pot',
                    placementKind: 'grid',
                    isTransitEntity: true,
                    operatorAccessPoints: [{
                        interactionPointIndex: 0,
                        transform: { worldPosition: vector(1, 0, 0) },
                    }],
                    itemPlacementPoints: [{
                        interactionPointIndex: 1,
                        transform: { worldPosition: vector(2, 0, 0) },
                    }],
                    automationLinkPoints: [],
                    transitAccessPoints: [{
                        accessPointIndex: 0,
                        transform: { worldPosition: vector(4, 0, 0) },
                    }],
                },
            ],
        });
    });

    it('preserves blueprint rejection without returning routing inputs', () => {
        const result = analyzer().analyze(blueprint([
            placement('pot', 'pot', 99),
        ]));

        expect(result.kind).toBe('rejected');
        expect(result.endpointBasis).toBe('not-applicable');
        expect(result.placements).toEqual([]);
    });

    it('preserves missing endpoint categories as empty recorded evidence', () => {
        const source = dataset();
        const result = new BlueprintProductionRoutingInputsAnalyzer({
            ...source,
            buildables: source.buildables.map((entry) => entry.itemId === 'pot'
                ? {
                    ...entry,
                    interactionPoints: [],
                    isTransitEntity: false,
                    transitAccessPoints: [],
                }
                : entry),
        }).analyze(blueprint([placement('pot', 'pot', 0)]));

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.placements).toEqual([{
            placementId: 'pot',
            itemId: 'pot',
            placementKind: 'grid',
            isTransitEntity: false,
            operatorAccessPoints: [],
            itemPlacementPoints: [],
            automationLinkPoints: [],
            transitAccessPoints: [],
        }]);
    });
});

function analyzer(): BlueprintProductionRoutingInputsAnalyzer {
    return new BlueprintProductionRoutingInputsAnalyzer(dataset());
}

function dataset(): BlueprintProductionCapacityDataset {
    return {
        manifest: { gameVersion, datasetSha256 },
        properties: [property()],
        buildables: [
            buildable('pot', [
                interaction('operator-access', 'AccessPoint', 1, 'Game.Pot'),
                interaction('item-placement', 'SeedStartPoint', 2, 'Game.Pot'),
                interaction('camera', 'CameraPosition', 3, 'Game.Pot'),
            ], [transform('TransitAccess', 4)]),
            buildable('chemistry', [
                interaction('operator-access', 'AccessPoint', 1, 'Game.ChemistryStation'),
                interaction('item-placement', 'IngredientTransform', 2, 'Game.ChemistryStation'),
                interaction('automation-link', 'LinkOrigin', 3, 'Game.ChemistryStation'),
            ], [transform('TransitAccess', 4)]),
            buildable('decoration', [
                interaction('operator-access', 'AccessPoint', 1, 'Game.Decoration'),
            ], [transform('TransitAccess', 2)]),
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
        shrooms: [],
        stationRecipes: [{
            schema: 'neonschedule1-station-recipe-2',
            id: 'liquid',
            title: 'Liquid',
            cookTimeMinutes: 10,
            cookTemperature: 180,
            cookTemperatureTolerance: 25,
            qualityCalculationMethod: 'Additive',
            acceptedEquipmentItemIds: ['chemistry'],
            ingredients: [{ quantity: 1, acceptedItemIds: ['leaf'] }],
            outputItemId: 'liquid',
            outputQuantity: 1,
        }],
        ovenTransforms: [],
        stations: [{
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
        }],
    };
}

function blueprint(placements: BlueprintDocument['placements']): BlueprintDocument {
    return {
        schema: 'neonschedule1-blueprint-3',
        gameVersion,
        datasetSha256,
        propertyCode: 'warehouse',
        productionLogistics: { employees: [], supplies: [] },
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

function buildable(
    itemId: string,
    interactionPoints: Buildable['interactionPoints'],
    transitAccessPoints: Buildable['transitAccessPoints']
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
            buildPoint: transform('BuildPoint', 0),
            midAirCenterPoint: null,
            boundingCollider: collider(),
            footprintTiles: [{
                x: 0,
                y: 0,
                requiredOffset: 0,
                transform: transform('Footprint/[0,0]', 0),
                cornerObstacles: [],
            }],
        },
        componentTypes: [],
        colliders: [],
        storage: null,
        temperatureEmitters: [],
        interactionPoints,
        isTransitEntity: transitAccessPoints.length > 0,
        transitAccessPoints,
        proceduralTiles: [],
        visuals: { renderers: [], meshes: [] },
    };
}

function interaction(
    role: string,
    member: string,
    x: number,
    componentType: string
): Buildable['interactionPoints'][number] {
    return { role, member, componentType, transform: transform(member, x) };
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

function propertyLayout(): PropertyLayout {
    return {
        schema: 'neonschedule1-property-layout-4',
        propertyCode: 'warehouse',
        propertyName: 'Warehouse',
        worldPosition: vector(0, 0, 0),
        worldRotation: vector(0, 0, 0),
        spawnPoint: transform('Spawn', 0),
        interiorSpawnPoint: transform('InteriorSpawn', 0),
        npcSpawnPoint: transform('NpcSpawn', 0),
        boundingBox: null,
        boundaryColliders: [],
        fixedColliders: [],
        surfaceMeshes: [],
        surfaces: [],
        proceduralTiles: [],
        loadingDocks: [],
        grids: [{
            id: 'main',
            width: 3,
            height: 1,
            tileSize: 10,
            worldOrigin: vector(0, 0, 0),
            tiles: Array.from({ length: 3 }, (_, x) => ({
                x,
                y: 0,
                availableOffset: 0,
                worldPosition: vector(10 * x, 0, 0),
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
        transform: transform('Bounds', 0),
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

function transform(path: string, x: number): Transform {
    return {
        name: path,
        path,
        worldPosition: vector(x, 0, 0),
        localPosition: vector(x, 0, 0),
        worldRotation: vector(0, 0, 0),
        localScale: vector(1, 1, 1),
    };
}

function vector(x: number, y: number, z: number): Vector3 {
    return { x, y, z };
}
