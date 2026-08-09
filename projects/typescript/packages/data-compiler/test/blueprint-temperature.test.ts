import { describe, expect, it } from 'vitest';

import {
    BlueprintTemperatureCoverageAnalyzer,
    type BlueprintDocument,
    type BlueprintTemperatureDataset,
    type Buildable,
    type Collider,
    type Property,
    type PropertyLayout,
    type Transform,
    type Vector3,
} from '@neonschedule1/core';

const gameVersion = '0.4.6f12';
const datasetSha256 = 'a'.repeat(64);

describe('blueprint temperature coverage', () => {
    it('reports exact emitter coverage without inventing overlap temperature behavior', () => {
        const result = analyzer().analyze(blueprint([
            placement('cooler', 'cooler', 0),
            placement('heater', 'heater', 2),
        ]));

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.coverageProofStatus).toBe('exact');
        expect(result.coverageScope).toBe('blueprint-emitters-over-property-grid-tiles');
        expect(result.temperatureCombination).toBe('not-evaluated');
        expect(result.propertyCode).toBe('warehouse');
        expect(result.ambientTemperature).toBe(20);
        expect(result.emitters).toEqual([
            {
                placementId: 'cooler',
                emitterIndex: 0,
                temperature: 0,
                range: 2,
                worldPosition: vector(0, 0, 0),
            },
            {
                placementId: 'heater',
                emitterIndex: 0,
                temperature: 30,
                range: 2,
                worldPosition: vector(4, 0, 0),
            },
        ]);
        expect(result.tiles.map(({ x, sources }) => ({ x, sources }))).toEqual([
            {
                x: 0,
                sources: [{
                    placementId: 'cooler',
                    emitterIndex: 0,
                    temperature: 0,
                    distance: 0,
                }],
            },
            {
                x: 1,
                sources: [
                    {
                        placementId: 'cooler',
                        emitterIndex: 0,
                        temperature: 0,
                        distance: 2,
                    },
                    {
                        placementId: 'heater',
                        emitterIndex: 0,
                        temperature: 30,
                        distance: 2,
                    },
                ],
            },
            {
                x: 2,
                sources: [{
                    placementId: 'heater',
                    emitterIndex: 0,
                    temperature: 30,
                    distance: 0,
                }],
            },
            {
                x: 3,
                sources: [{
                    placementId: 'heater',
                    emitterIndex: 0,
                    temperature: 30,
                    distance: 2,
                }],
            },
            { x: 4, sources: [] },
        ]);
    });

    it('preserves blueprint rejection without claiming temperature coverage', () => {
        const result = analyzer().analyze(blueprint([
            placement('cooler', 'cooler', 9),
        ]));

        expect(result.kind).toBe('rejected');
        expect(result.coverageProofStatus).toBe('not-applicable');
        expect(result.ambientTemperature).toBeNull();
        expect(result.emitters).toEqual([]);
        expect(result.tiles).toEqual([]);
    });

    it('rejects invalid emitter ranges at the projection boundary', () => {
        const invalid = buildable('cooler', 0);
        const dataset: BlueprintTemperatureDataset = {
            manifest: { gameVersion, datasetSha256 },
            properties: [property()],
            buildables: [{
                ...invalid,
                temperatureEmitters: [{
                    ...invalid.temperatureEmitters[0]!,
                    range: -1,
                }],
            }],
            propertyLayouts: [propertyLayout()],
        };

        expect(() => new BlueprintTemperatureCoverageAnalyzer(dataset).analyze(blueprint([
            placement('cooler', 'cooler', 0),
        ]))).toThrow('Temperature emitter range must be finite and non-negative');
    });
});

function analyzer(): BlueprintTemperatureCoverageAnalyzer {
    const dataset: BlueprintTemperatureDataset = {
        manifest: { gameVersion, datasetSha256 },
        properties: [property()],
        buildables: [buildable('cooler', 0), buildable('heater', 30)],
        propertyLayouts: [propertyLayout()],
    };
    return new BlueprintTemperatureCoverageAnalyzer(dataset);
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

function buildable(itemId: string, temperature: number): Buildable {
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
        temperatureEmitters: [{ temperature, range: 2, emissionPoint: vector(0, 0, 0) }],
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
            width: 5,
            height: 1,
            tileSize: 2,
            worldOrigin: vector(0, 0, 0),
            tiles: [0, 1, 2, 3, 4].map((x) => ({
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
