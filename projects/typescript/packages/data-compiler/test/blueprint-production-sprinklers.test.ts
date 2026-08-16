import { describe, expect, it } from 'vitest';

import {
    BRICK_PRESS_OPERATION_RULES,
    PACKAGING_OPERATION_RULES,
    BlueprintSprinklerAnalyzer,
    type BlueprintDocument,
    type BlueprintSprinklerDataset,
    type Buildable,
    type Collider,
    type ProductionCatalog,
    type PropertyLayout,
    type Transform,
    type Vector3,
} from '@neonschedule1/core';

const gameVersion = '0.4.6f13';
const datasetSha256 = 'a'.repeat(64);

describe('blueprint production sprinklers', () => {
    it('rotates native target offsets and applies the minimum covered-tile rule', () => {
        const result = analyzer().analyze(blueprint([
            placement('sprinkler', 'sprinkler', 3, 3, 90),
            placement('wide-pot', 'wide-pot', 3, 4),
            placement('small-pot', 'small-pot', 2, 3),
            placement('outside-pot', 'small-pot', 7, 7),
        ]));

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result).toMatchObject({
            coverageScope: 'installed-sprinklers-over-installed-pot-grid-tiles',
            potTargetType: 'grow-container-production-stations',
            applicationSegmentCount: 5,
            requestedWaterCapacityFractionPerSegment: 0.2,
            requestedWaterCapacityFractionPerApplication: 1,
            movingPotsDuringApplication: 'not-evaluated',
        });
        expect(result.sprinklers).toEqual([{
            placementId: 'sprinkler',
            itemId: 'sprinkler',
            coverage: {
                kind: 'exact',
                proof: 'native-rotated-target-tiles-and-pot-tile-count',
                minimumTargetCount: 2,
                resolvedTargetTiles: [
                    { gridId: 'main', x: 2, y: 3 },
                    { gridId: 'main', x: 3, y: 4 },
                    { gridId: 'main', x: 4, y: 4 },
                ],
                intersectingPots: [
                    {
                        placementId: 'small-pot',
                        itemId: 'small-pot',
                        coveredTileCount: 1,
                        qualifiesForWatering: false,
                    },
                    {
                        placementId: 'wide-pot',
                        itemId: 'wide-pot',
                        coveredTileCount: 2,
                        qualifiesForWatering: true,
                    },
                ],
                wateredPotPlacementIds: ['wide-pot'],
            },
            timing: {
                kind: 'exact',
                applyDelaySeconds: 6,
                particleStopDelaySeconds: 2,
                cooldownSeconds: 1.5,
                fullCycleSeconds: 9.5,
            },
        }]);
    });

    it('preserves unavailable coverage and timing for older acquisitions', () => {
        const source = dataset();
        const result = new BlueprintSprinklerAnalyzer({
            ...source,
            production: {
                ...source.production,
                stations: source.production.stations.map((station) =>
                    station.kind === 'sprinkler'
                        ? { ...station, particleStopDelay: null, targetTileCoordinates: null }
                        : station
                ),
            },
        }).analyze(blueprint([placement('sprinkler', 'sprinkler', 3, 3)]));

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.sprinklers[0]).toMatchObject({
            coverage: {
                kind: 'not-evaluated',
                reason: 'target-tile-coordinates-not-recorded',
                minimumTargetCount: 2,
            },
            timing: {
                kind: 'not-evaluated',
                reason: 'particle-stop-delay-not-recorded',
                applyDelaySeconds: 6,
                particleStopDelaySeconds: null,
                cooldownSeconds: 1.5,
                fullCycleSeconds: null,
            },
        });
    });
});

function analyzer(): BlueprintSprinklerAnalyzer {
    return new BlueprintSprinklerAnalyzer(dataset());
}

function dataset(): BlueprintSprinklerDataset {
    return {
        manifest: { gameVersion, datasetSha256 },
        buildables: [
            buildable('sprinkler', [{ x: 0, y: 0 }]),
            buildable('small-pot', [{ x: 0, y: 0 }]),
            buildable('wide-pot', [{ x: 0, y: 0 }, { x: 1, y: 0 }]),
        ],
        propertyLayouts: [propertyLayout()],
        production: production(),
    };
}

function production(): ProductionCatalog {
    return {
        schema: 'neonschedule1-production-catalog-9',
        quality: {
            basePlantLevel: 0.5,
            monetaryValueVariesByQuality: false,
            customerQualityMaxEffect: 0.3,
            tiers: [{ name: 'Standard', minimumLevelExclusive: null, customerScalar: 0.5 }],
        },
        drying: {
            schema: 'neonschedule1-drying-operation-rules-1',
            requiresUnpackagedProduct: true,
            acceptedProductDrugTypes: [],
            specialQualityItemIdSubstring: 'cocaleaf',
            specialItemRequiresQualityInstance: true,
            maximumQualityTier: 'Heavenly',
            itemIdTransformation: 'preserved',
            quantityTransformation: 'preserved',
            qualityTierIncrement: 1,
        },
        packaging: { ...PACKAGING_OPERATION_RULES },
        brickPressing: { ...BRICK_PRESS_OPERATION_RULES },
        seeds: [],
        shrooms: [],
        stationRecipes: [],
        ovenTransforms: [],
        stations: [
            growContainer('small-pot'),
            growContainer('wide-pot'),
            {
                schema: 'neonschedule1-production-station-4',
                itemId: 'sprinkler',
                kind: 'sprinkler',
                applyDelay: 6,
                particleStopDelay: 2,
                cooldown: 1.5,
                minimumTargetCount: 2,
                targetTileCoordinates: [
                    { x: -1, y: 1 },
                    { x: 0, y: -1 },
                    { x: -1, y: 0 },
                    { x: 5, y: 0 },
                ],
            },
        ],
    };
}

function growContainer(itemId: string): ProductionCatalog['stations'][number] {
    return {
        schema: 'neonschedule1-production-station-4',
        itemId,
        kind: 'grow-container',
        yieldMultiplier: 1,
        growSpeedMultiplier: 1,
        requiresExternalGrowLight: true,
        maxTemperatureGrowthMultiplier: 1,
        minimumTemperatureThreshold: 0,
        maximumTemperatureThreshold: 100,
        allowedSoilIds: [],
        allowedAdditiveIds: [],
    };
}

function blueprint(placements: BlueprintDocument['placements']): BlueprintDocument {
    return {
        schema: 'neonschedule1-blueprint-3',
        gameVersion,
        datasetSha256,
        propertyCode: 'warehouse',
        placements,
        productionLogistics: { employees: [], supplies: [] },
    };
}

function placement(
    id: string,
    itemId: string,
    x: number,
    y: number,
    rotation: 0 | 90 | 180 | 270 = 0
): BlueprintDocument['placements'][number] {
    return { id, kind: 'grid', itemId, gridId: 'main', anchor: { x, y }, rotation };
}

function buildable(
    itemId: string,
    footprint: readonly { readonly x: number; readonly y: number }[]
): Buildable {
    return {
        schema: 'neonschedule1-buildable-4',
        itemId,
        runtimeType: 'Game.GridItem',
        placement: {
            kind: 'grid',
            holdDistance: 3,
            footprintWidth: Math.max(...footprint.map((tile) => tile.x)) + 1,
            footprintHeight: Math.max(...footprint.map((tile) => tile.y)) + 1,
            proceduralTileType: null,
            tileSharingRule: 'standard',
            tileSharingImplementation: 'Game.GridItem',
            allowRotation: true,
            rotationIncrement: 90,
            validSurfaceTypes: [],
            buildPoint: transform('BuildPoint'),
            midAirCenterPoint: null,
            boundingCollider: collider(),
            footprintTiles: footprint.map((tile) => ({
                ...tile,
                requiredOffset: 0,
                transform: transform(`Footprint/[${tile.x},${tile.y}]`),
                cornerObstacles: [],
            })),
        },
        componentTypes: [],
        colliders: [],
        storage: null,
        temperatureEmitters: [],
        interactionPoints: [],
        isTransitEntity: false,
        transitAccessPoints: [],
        proceduralTiles: [],
        visuals: { renderers: [], meshes: [] },
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
            height: 8,
            tileSize: 1,
            worldOrigin: vector(0, 0, 0),
            tiles: Array.from({ length: 8 }, (_, x) =>
                Array.from({ length: 8 }, (_, y) => ({
                    x,
                    y,
                    availableOffset: 0,
                    worldPosition: vector(x, 0, y),
                    worldRotation: vector(0, 0, 0),
                }))
            ).flat(),
        }],
        visuals: { renderers: [], meshes: [] },
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

function vector(x: number, y: number, z: number): Vector3 {
    return { x, y, z };
}
