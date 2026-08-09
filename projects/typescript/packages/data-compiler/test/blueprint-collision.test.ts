import { describe, expect, it } from 'vitest';

import {
    BlueprintCollisionAnalyzer,
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

describe('blueprint collision analysis', () => {
    it('reports exact fixed-box overlaps, preserves disabled definitions, and ignores triggers', () => {
        const property = propertyLayout([
            collider('blocking', vector(0, 0.5, 0)),
            collider('contact', vector(2, 0.5, 0)),
            collider('disabled', vector(0, 0.5, 0), { enabled: false }),
            collider('trigger', vector(0, 0.5, 0), { isTrigger: true }),
        ]);

        const result = analyzer(property).analyze(blueprint([placement('bench-1', 0)]));

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.proofStatus).toBe('exact');
        expect(result.collisions).toEqual([
            {
                code: 'fixed-geometry-overlap',
                placementIds: ['bench-1'],
                propertyCollider: { index: 0, path: 'blocking', shape: 'box' },
            },
            {
                code: 'fixed-geometry-overlap',
                placementIds: ['bench-1'],
                propertyCollider: { index: 2, path: 'disabled', shape: 'box' },
            },
        ]);
        expect(result.limitations).toEqual([]);
    });

    it('reports placement overlap and only nearby unsupported fixed geometry', () => {
        const property = propertyLayout([
            collider('near-sphere', vector(-1, 0.5, 0), { shape: 'sphere' }),
            collider('far-mesh', vector(100, 0.5, 0), { shape: 'mesh' }),
        ]);

        const result = analyzer(property).analyze(blueprint([
            placement('z-placement', 0),
            placement('a-placement', 1),
        ]));

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.proofStatus).toBe('incomplete');
        expect(result.collisions).toEqual([{
            code: 'placement-overlap',
            placementIds: ['a-placement', 'z-placement'],
            propertyCollider: null,
        }]);
        expect(result.limitations).toEqual([{
            code: 'unsupported-fixed-geometry',
            placementId: 'z-placement',
            propertyCollider: { index: 0, path: 'near-sphere', shape: 'sphere' },
            placementShape: null,
        }]);
    });

    it('preserves projection rejection without claiming collision proof', () => {
        const input = blueprint([placement('bench-1', 9)]);

        const result = analyzer(propertyLayout([])).analyze(input);

        expect(result.kind).toBe('rejected');
        expect(result.proofStatus).toBe('not-applicable');
        expect(result.collisions).toEqual([]);
        expect(result.limitations).toEqual([]);
        expect(result.projection.validation.issues.map((issue) => issue.code)).toEqual([
            'tile-outside-grid',
        ]);
    });

    it('reports unsupported placement bounds without making a collision claim', () => {
        const input = buildable();
        const dataset: BlueprintDataset = {
            manifest: { gameVersion, datasetSha256 },
            buildables: [{
                ...input,
                placement: {
                    ...input.placement,
                    boundingCollider: {
                        ...input.placement.boundingCollider,
                        shape: 'sphere',
                        radius: 1,
                    },
                },
            }],
            propertyLayouts: [propertyLayout([])],
        };

        const result = new BlueprintCollisionAnalyzer(dataset)
            .analyze(blueprint([placement('bench-1', 0)]));

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.proofStatus).toBe('incomplete');
        expect(result.collisions).toEqual([]);
        expect(result.limitations).toEqual([{
            code: 'unsupported-placement-geometry',
            placementId: 'bench-1',
            propertyCollider: null,
            placementShape: 'sphere',
        }]);
    });

    it('reports degenerate boxes as incomplete evidence instead of throwing', () => {
        const fixedResult = analyzer(propertyLayout([{
            ...collider('degenerate', vector(0, 0.5, 0)),
            localSize: vector(0, 2, 2),
        }])).analyze(blueprint([placement('bench-1', 0)]));

        expect(fixedResult.kind).toBe('analyzed');
        if (fixedResult.kind !== 'analyzed') return;
        expect(fixedResult.proofStatus).toBe('incomplete');
        expect(fixedResult.collisions).toEqual([]);
        expect(fixedResult.limitations).toEqual([{
            code: 'unsupported-fixed-geometry',
            placementId: 'bench-1',
            propertyCollider: { index: 0, path: 'degenerate', shape: 'box' },
            placementShape: null,
        }]);

        const input = buildable();
        const dataset: BlueprintDataset = {
            manifest: { gameVersion, datasetSha256 },
            buildables: [{
                ...input,
                placement: {
                    ...input.placement,
                    boundingCollider: {
                        ...input.placement.boundingCollider,
                        localSize: vector(0, 2, 2),
                    },
                },
            }],
            propertyLayouts: [propertyLayout([])],
        };

        const result = new BlueprintCollisionAnalyzer(dataset)
            .analyze(blueprint([placement('bench-1', 0)]));

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.proofStatus).toBe('incomplete');
        expect(result.collisions).toEqual([]);
        expect(result.limitations).toEqual([{
            code: 'unsupported-placement-geometry',
            placementId: 'bench-1',
            propertyCollider: null,
            placementShape: 'box',
        }]);
    });
});

function analyzer(property: PropertyLayout): BlueprintCollisionAnalyzer {
    const dataset: BlueprintDataset = {
        manifest: { gameVersion, datasetSha256 },
        buildables: [buildable()],
        propertyLayouts: [property],
    };
    return new BlueprintCollisionAnalyzer(dataset);
}

function blueprint(
    placements: BlueprintDocument['placements']
): BlueprintDocument {
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
    return { id, kind: 'grid', itemId: 'bench', gridId: 'main', anchor: { x, y: 0 }, rotation: 0 };
}

function buildable(): Buildable {
    return {
        schema: 'neonschedule1-buildable-4',
        itemId: 'bench',
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
            boundingCollider: collider('Bounds', vector(0, 0.5, 0)),
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
        isTransitEntity: false,
        transitAccessPoints: [],
        proceduralTiles: [],
        visuals: { renderers: [], meshes: [] },
    };
}

function propertyLayout(fixedColliders: readonly Collider[]): PropertyLayout {
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
        fixedColliders: [...fixedColliders],
        surfaceMeshes: [],
        surfaces: [],
        proceduralTiles: [],
        loadingDocks: [],
        grids: [{
            id: 'main',
            width: 2,
            height: 1,
            tileSize: 1,
            worldOrigin: vector(0, 0, 0),
            tiles: [0, 1].map((x) => ({
                x,
                y: 0,
                availableOffset: 0,
                worldPosition: vector(1.5 * x, 0, 0),
                worldRotation: vector(0, 0, 0),
            })),
        }],
        visuals: { renderers: [], meshes: [] },
    };
}

function collider(
    path: string,
    position: Vector3,
    input: {
        readonly shape?: ColliderShape;
        readonly enabled?: boolean;
        readonly isTrigger?: boolean;
    } = {}
): Collider {
    const size = vector(2, 2, 2);
    return {
        source: 'fixture',
        runtimeType: `UnityEngine.${input.shape ?? 'box'}Collider`,
        shape: input.shape ?? 'box',
        enabled: input.enabled ?? true,
        isTrigger: input.isTrigger ?? false,
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
        localCenter: vector(0, 0, 0),
        localSize: size,
        radius: input.shape === 'sphere' ? 1 : null,
        height: null,
        direction: null,
        meshName: input.shape === 'mesh' ? path : null,
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
