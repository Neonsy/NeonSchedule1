import { describe, expect, it } from 'vitest';

import {
    BlueprintAccessAnalyzer,
    type BlueprintDataset,
    type BlueprintDocument,
    type Buildable,
    type Collider,
    type ColliderShape,
    type PropertyLayout,
    type Transform,
    type Vector3,
} from '@neonschedule1/core';

const gameVersion = '0.4.6f12';
const datasetSha256 = 'a'.repeat(64);

describe('blueprint access clearance', () => {
    it('measures access-point clearance from other placements and fixed boxes', () => {
        const result = analyzer().analyze(blueprint([
            placement('station', 0),
            placement('blocker', 1),
        ]));

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.proofStatus).toBe('exact');
        expect(result.reachability).toBe('not-evaluated');
        expect(result.accessPoints).toEqual([
            {
                placementId: 'blocker',
                accessPointIndex: 0,
                path: 'AccessPoint',
                worldPosition: vector(6, 0, 0),
                minimumClearance: 1,
                nearestObstacles: [{ kind: 'property-fixed', index: 0, path: 'Wall', shape: 'box' }],
            },
            {
                placementId: 'station',
                accessPointIndex: 0,
                path: 'AccessPoint',
                worldPosition: vector(2, 0, 0),
                minimumClearance: 1,
                nearestObstacles: [{ kind: 'placement', placementId: 'blocker' }],
            },
        ]);
        expect(result.limitations).toEqual([]);
    });

    it('does not claim exact proof when unsupported geometry can be nearer', () => {
        const result = analyzer({ fixedShape: 'sphere' }).analyze(blueprint([
            placement('station', 0),
            placement('blocker', 1),
        ]));

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.proofStatus).toBe('incomplete');
        expect(result.limitations).toEqual([{
            code: 'unsupported-obstacle-geometry',
            placementId: 'blocker',
            accessPointIndex: 0,
            obstacle: { kind: 'property-fixed', index: 0, path: 'Wall', shape: 'sphere' },
        }]);
    });

    it('reports missing native transit points and preserves projection rejection', () => {
        const input = buildable();
        const withoutPoints: BlueprintDataset = {
            manifest: { gameVersion, datasetSha256 },
            buildables: [{ ...input, transitAccessPoints: [] }],
            propertyLayouts: [propertyLayout('box')],
        };
        const analyzed = new BlueprintAccessAnalyzer(withoutPoints)
            .analyze(blueprint([placement('station', 0)]));
        expect(analyzed.kind).toBe('analyzed');
        if (analyzed.kind !== 'analyzed') return;
        expect(analyzed.proofStatus).toBe('incomplete');
        expect(analyzed.limitations).toEqual([{
            code: 'missing-transit-access-points',
            placementId: 'station',
            accessPointIndex: null,
            obstacle: null,
        }]);

        const rejected = new BlueprintAccessAnalyzer(withoutPoints)
            .analyze(blueprint([placement('station', 9)]));
        expect(rejected.kind).toBe('rejected');
        expect(rejected.proofStatus).toBe('not-applicable');
        expect(rejected.accessPoints).toEqual([]);
    });
});

function analyzer(input: { readonly fixedShape?: ColliderShape } = {}): BlueprintAccessAnalyzer {
    const dataset: BlueprintDataset = {
        manifest: { gameVersion, datasetSha256 },
        buildables: [buildable()],
        propertyLayouts: [propertyLayout(input.fixedShape ?? 'box')],
    };
    return new BlueprintAccessAnalyzer(dataset);
}

function blueprint(placements: BlueprintDocument['placements']): BlueprintDocument {
    return {
        schema: 'neonschedule1-blueprint-2',
        gameVersion,
        datasetSha256,
        propertyCode: 'warehouse',
        productionLogistics: { employees: [] },
        placements,
    };
}

function placement(id: string, x: number): BlueprintDocument['placements'][number] {
    return { id, kind: 'grid', itemId: 'station', gridId: 'main', anchor: { x, y: 0 }, rotation: 0 };
}

function buildable(): Buildable {
    return {
        schema: 'neonschedule1-buildable-4',
        itemId: 'station',
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
            boundingCollider: collider('Bounds', vector(0, 0, 0), 'box'),
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
        temperatureEmitters: [],
        interactionPoints: [],
        isTransitEntity: true,
        transitAccessPoints: [transform('AccessPoint', vector(2, 0, 0))],
        proceduralTiles: [],
        visuals: { renderers: [], meshes: [] },
    };
}

function propertyLayout(fixedShape: ColliderShape): PropertyLayout {
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
        fixedColliders: [collider('Wall', vector(8, 0, 0), fixedShape)],
        surfaceMeshes: [],
        surfaces: [],
        proceduralTiles: [],
        loadingDocks: [],
        grids: [{
            id: 'main',
            width: 2,
            height: 1,
            tileSize: 4,
            worldOrigin: vector(0, 0, 0),
            tiles: [0, 1].map((x) => ({
                x,
                y: 0,
                availableOffset: 0,
                worldPosition: vector(4 * x, 0, 0),
                worldRotation: vector(0, 0, 0),
            })),
        }],
        visuals: { renderers: [], meshes: [] },
    };
}

function collider(path: string, position: Vector3, shape: ColliderShape): Collider {
    const size = vector(2, 2, 2);
    return {
        source: 'fixture',
        runtimeType: `UnityEngine.${shape}Collider`,
        shape,
        enabled: true,
        isTrigger: false,
        layer: 0,
        layerName: 'Default',
        tag: 'Untagged',
        transform: transform(path, position),
        worldScale: vector(1, 1, 1),
        worldBasis: {
            right: vector(1, 0, 0),
            up: vector(0, 1, 0),
            forward: vector(0, 0, 1),
        },
        worldBounds: { center: position, size },
        localCenter: shape === 'box' ? vector(0, 0, 0) : null,
        localSize: shape === 'box' ? size : null,
        radius: shape === 'sphere' ? 1 : null,
        height: null,
        direction: null,
        meshName: null,
        meshId: null,
        meshIsReadable: null,
        isConvex: null,
    };
}

function transform(path: string, worldPosition = vector(0, 0, 0)): Transform {
    return {
        name: path,
        path,
        worldPosition,
        localPosition: worldPosition,
        worldRotation: vector(0, 0, 0),
        localScale: vector(1, 1, 1),
    };
}

function vector(x: number, y: number, z: number): Vector3 {
    return { x, y, z };
}
