import { describe, expect, it } from 'vitest';

import {
    BlueprintProjector,
    BlueprintValidator,
    planBlueprintConstructionOrder,
    type BlueprintDataset,
    type BlueprintDocument,
    type Buildable,
    type Collider,
    type ColliderWorldBasis,
    type PropertyLayout,
    type PropertySurface,
    type Transform,
    type Vector3,
} from '@neonschedule1/core';

const gameVersion = '0.4.6f12';
const datasetSha256 = 'a'.repeat(64);

describe('surface blueprint placement', () => {
    it('validates an owned box face and projects the saved relative transform', () => {
        const input = dataset();
        const validation = new BlueprintValidator(input).validate(blueprint());
        const projection = new BlueprintProjector(input).project(blueprint());

        expect(validation.valid).toBe(true);
        expect(validation.resolvedPlacements).toEqual([expect.objectContaining({
            id: 'lamp-1',
            kind: 'surface',
            surfaceId: 'wall-a',
            surfaceColliderPath: 'Wall',
            relativeHitPoint: vector(0, 0.1, 0),
        })]);
        expect(projection.kind).toBe('projected');
        if (projection.kind !== 'projected') return;
        const placement = projection.placements[0]!;
        expect(placement.kind).toBe('surface');
        if (placement.kind !== 'surface') return;
        expect(placement.surfaceId).toBe('wall-a');
        expect(placement.surfaceColliderPath).toBe('Wall');
        expect(placement.worldHitPoint).toEqual(vector(10, 2.1, 20));
        expect(placement.root.worldPosition).toEqual(vector(10, 2.4, 20));
        expect(placement.root.worldRotation.y).toBeCloseTo(Math.SQRT1_2);
        expect(placement.root.worldRotation.w).toBeCloseTo(Math.SQRT1_2);
        expect(planBlueprintConstructionOrder(validation)).toEqual(expect.objectContaining({
            kind: 'ordered',
            placementIds: ['lamp-1'],
        }));
    });

    it.each([
        ['surface-type-incompatible', { surfaceType: 'Roof' }],
        ['surface-face-incompatible', { relativeHitPoint: vector(0, -0.1, 0) }],
        ['surface-point-outside-collider', { relativeHitPoint: vector(2, 0.1, 0) }],
        ['surface-geometry-unsupported', { colliderShape: 'mesh' }],
    ] as const)('reports %s without claiming placement validity', (code, change) => {
        const input = dataset();
        const property = input.propertyLayouts[0]!;
        const surface = property.surfaces[0]!;
        const document = blueprint();
        const placement = document.placements[0]!;
        if (placement.kind !== 'surface') throw new Error('Expected surface fixture');
        const nextSurface: PropertySurface = {
            ...surface,
            type: 'surfaceType' in change ? change.surfaceType : surface.type,
            colliders: surface.colliders.map((collider) => ({
                ...collider,
                shape: 'colliderShape' in change ? change.colliderShape : collider.shape,
            })),
        };
        const result = new BlueprintValidator({
            ...input,
            propertyLayouts: [{ ...property, surfaces: [nextSurface] }],
        }).validate({
            ...document,
            placements: [{
                ...placement,
                relativeHitPoint: 'relativeHitPoint' in change
                    ? change.relativeHitPoint
                    : placement.relativeHitPoint,
            }],
        });

        expect(result.valid).toBe(false);
        expect(result.resolvedPlacements).toEqual([]);
        expect(result.issues).toEqual([expect.objectContaining({
            code,
            placementIds: ['lamp-1'],
            surfaceId: 'wall-a',
        })]);
    });

    it('rejects a non-normalized saved rotation before geometry evaluation', () => {
        const document = blueprint();
        const placement = document.placements[0]!;
        if (placement.kind !== 'surface') throw new Error('Expected surface fixture');

        expect(() => new BlueprintValidator(dataset()).validate({
            ...document,
            placements: [{
                ...placement,
                relativeRotation: { x: 0, y: 0, z: 0, w: 2 },
            }],
        })).toThrow('rotation at index 0 must be normalized');
    });

    it('uses the hit point to resolve colliders that share a transform path', () => {
        const input = dataset();
        const property = input.propertyLayouts[0]!;
        const surface = property.surfaces[0]!;
        const validCollider = surface.colliders[0]!;
        const otherCollider = {
            ...validCollider,
            localCenter: vector(0, 10, 0),
        } satisfies Collider;

        const result = new BlueprintValidator({
            ...input,
            propertyLayouts: [{
                ...property,
                surfaces: [{ ...surface, colliders: [otherCollider, validCollider] }],
            }],
        }).validate(blueprint());

        expect(result.valid).toBe(true);
        expect(result.issues).toEqual([]);
        expect(result.resolvedPlacements).toHaveLength(1);
    });

    it('uses source triangles only for non-convex mesh colliders', () => {
        const input = dataset();
        const property = input.propertyLayouts[0]!;
        const surface = property.surfaces[0]!;
        const source = surface.colliders[0]!;
        const meshLayout = (isConvex: boolean): BlueprintDataset => ({
            ...input,
            propertyLayouts: [{
                ...property,
                surfaceMeshes: [{
                    meshId: 'mesh:wall',
                    vertices: [
                        vector(-1, 0.1, -1),
                        vector(1, 0.1, -1),
                        vector(0, 0.1, 1),
                    ],
                    triangles: [0, 1, 2],
                    bounds: { center: vector(0, 0.1, 0), size: vector(2, 0, 2) },
                }],
                surfaces: [{
                    ...surface,
                    colliders: [{
                        ...source,
                        shape: 'mesh',
                        localCenter: null,
                        localSize: null,
                        meshId: 'mesh:wall',
                        meshName: 'Wall',
                        meshIsReadable: false,
                        isConvex,
                    } satisfies Collider],
                }],
            }],
        });

        const result = new BlueprintValidator(meshLayout(false)).validate(blueprint());
        const convexResult = new BlueprintValidator(meshLayout(true)).validate(blueprint());

        expect(result.valid).toBe(true);
        expect(result.issues).toEqual([]);
        expect(convexResult.valid).toBe(false);
        expect(convexResult.issues).toEqual([
            expect.objectContaining({ code: 'surface-geometry-unsupported' }),
        ]);
    });
});

function dataset(): BlueprintDataset {
    return {
        manifest: { gameVersion, datasetSha256 },
        buildables: [surfaceBuildable()],
        propertyLayouts: [propertyLayout()],
    };
}

function blueprint(): BlueprintDocument {
    return {
        schema: 'neonschedule1-blueprint-1',
        gameVersion,
        datasetSha256,
        propertyCode: 'warehouse',
        placements: [{
            id: 'lamp-1',
            kind: 'surface',
            itemId: 'wall-lamp',
            surfaceId: 'wall-a',
            surfaceColliderPath: 'Wall',
            relativeHitPoint: vector(0, 0.1, 0),
            relativePosition: vector(0, 0.4, 0),
            relativeRotation: { x: 0, y: 0, z: 0, w: 1 },
        }],
    };
}

function surfaceBuildable(): Buildable {
    return {
        schema: 'neonschedule1-buildable-4',
        itemId: 'wall-lamp',
        runtimeType: 'Game.SurfaceItem',
        placement: {
            kind: 'surface',
            holdDistance: 3,
            footprintWidth: null,
            footprintHeight: null,
            proceduralTileType: null,
            tileSharingRule: null,
            tileSharingImplementation: null,
            allowRotation: true,
            rotationIncrement: 45,
            validSurfaceTypes: ['Wall'],
            buildPoint: transform('BuildPoint'),
            midAirCenterPoint: null,
            boundingCollider: collider('built-item', 'Bounds'),
            footprintTiles: [],
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
    const surfaceTransform = transform(
        'Wall',
        vector(10, 2, 20),
        vector(0, 90, 0),
        vector(2, 1, 1)
    );
    const surfaceCollider = {
        ...collider('property-surface', 'Wall'),
        transform: surfaceTransform,
        worldScale: vector(2, 1, 1),
        worldBasis: {
            right: vector(0, 0, -2),
            up: vector(0, 1, 0),
            forward: vector(1, 0, 0),
        },
        worldBounds: { center: vector(10, 2, 20), size: vector(2, 0.2, 4) },
        localSize: vector(2, 0.2, 2),
    } satisfies Collider;
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
        surfaces: [{
            id: 'wall-a',
            sourceGuid: 'wall-a',
            type: 'Wall',
            transform: surfaceTransform,
            container: transform('Container'),
            validFaces: ['Top'],
            colliders: [surfaceCollider],
        }],
        proceduralTiles: [],
        loadingDocks: [],
        grids: [],
        visuals: { renderers: [], meshes: [] },
    };
}

function collider(source: string, path: string): Collider {
    return {
        source,
        runtimeType: 'UnityEngine.BoxCollider',
        shape: 'box',
        enabled: true,
        isTrigger: false,
        layer: 0,
        layerName: 'Default',
        tag: 'Untagged',
        transform: transform(path),
        worldScale: vector(1, 1, 1),
        worldBasis: identityBasis(),
        worldBounds: { center: vector(0, 0, 0), size: vector(1, 1, 1) },
        localCenter: vector(0, 0, 0),
        localSize: vector(1, 1, 1),
        radius: null,
        height: null,
        direction: null,
        meshName: null,
        meshId: null,
        meshIsReadable: null,
        isConvex: null,
    };
}

function identityBasis(): ColliderWorldBasis {
    return {
        right: vector(1, 0, 0),
        up: vector(0, 1, 0),
        forward: vector(0, 0, 1),
    };
}

function transform(
    path: string,
    worldPosition = vector(0, 0, 0),
    worldRotation = vector(0, 0, 0),
    localScale = vector(1, 1, 1)
): Transform {
    return {
        name: path,
        path,
        worldPosition,
        localPosition: worldPosition,
        worldRotation,
        localScale,
    };
}

function vector(x: number, y: number, z: number): Vector3 {
    return { x, y, z };
}
