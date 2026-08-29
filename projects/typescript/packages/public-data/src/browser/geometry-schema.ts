import { type } from 'arktype';

import { PublicKeySchema, Vector3Schema } from '#public-data/browser/common-schema';

const PublicTransformSchema = type({
    position: Vector3Schema,
    rotation: Vector3Schema,
    scale: Vector3Schema,
});

const PublicBoundsSchema = type({
    center: Vector3Schema,
    size: Vector3Schema,
});

const PublicBasisSchema = type({
    right: Vector3Schema,
    up: Vector3Schema,
    forward: Vector3Schema,
});

const PublicHalfAxesSchema = type([Vector3Schema, Vector3Schema, Vector3Schema]);

const PublicWorldBoxSchema = type({
    center: Vector3Schema,
    halfAxes: PublicHalfAxesSchema,
});

const PublicColliderSchema = type({
    key: PublicKeySchema,
    enabled: 'boolean',
    isTrigger: 'boolean',
    shape: "'box' | 'capsule' | 'mesh' | 'sphere'",
    box: PublicWorldBoxSchema.or('null'),
    bounds: PublicBoundsSchema,
    meshKey: PublicKeySchema.or('null'),
    meshFrame: type({ position: Vector3Schema, basis: PublicBasisSchema }).or('null'),
    convex: 'boolean | null',
});

const PublicFootprintTileSchema = type({
    x: 'number',
    y: 'number',
    requiredOffset: 'number',
    transform: PublicTransformSchema,
    cornerDirections: type({ x: '-1 | 1', y: '-1 | 1' }).array(),
});

const PublicProceduralTileSchema = type({
    key: PublicKeySchema,
    type: "'rack'",
    transform: PublicTransformSchema,
});

export const PublicBuildableGeometrySchema = type({
    itemKey: PublicKeySchema,
    placement: {
        kind: "'grid' | 'procedural-grid' | 'surface'",
        holdDistance: 'number',
        footprintWidth: 'number | null',
        footprintHeight: 'number | null',
        proceduralTileType: "'rack' | null",
        tileSharingRule: "'standard' | 'floor-rack' | null",
        allowRotation: 'boolean | null',
        rotationIncrement: 'number | null',
        validSurfaceTypes: "('roof' | 'wall')[]",
        buildPoint: PublicTransformSchema,
        boundingCollider: PublicColliderSchema,
        footprintTiles: PublicFootprintTileSchema.array(),
    },
    colliders: PublicColliderSchema.array(),
    storage: type({
        slotCount: 'number',
        displayRowCount: 'number',
        slotsAreFilterable: 'boolean',
        maximumAccessDistance: 'number',
    }).or('null'),
    temperatureEmitters: type({
        temperature: 'number',
        range: 'number',
        position: Vector3Schema,
    }).array(),
    interactionPoints: type({
        key: PublicKeySchema,
        role: "'automation-link' | 'item-placement' | 'operator-access'",
        transform: PublicTransformSchema,
    }).array(),
    isTransitEntity: 'boolean',
    transitAccessPoints: type({
        key: PublicKeySchema,
        transform: PublicTransformSchema,
    }).array(),
    usableByCleaners: 'boolean | null',
    proceduralTiles: PublicProceduralTileSchema.array(),
});
export type PublicBuildableGeometry = typeof PublicBuildableGeometrySchema.infer;

const PublicSurfaceColliderGroupSchema = type({
    key: PublicKeySchema,
    colliders: PublicColliderSchema.array(),
});

export const PublicPropertyLayoutSchema = type({
    propertyKey: PublicKeySchema,
    frame: { position: Vector3Schema, rotation: Vector3Schema },
    entryPoints: {
        player: PublicTransformSchema,
        interior: PublicTransformSchema,
        npc: PublicTransformSchema,
    },
    boundingCollider: PublicColliderSchema.or('null'),
    boundaryColliders: PublicColliderSchema.array(),
    fixedColliders: PublicColliderSchema.array(),
    surfaceMeshes: type({
        key: PublicKeySchema,
        vertices: Vector3Schema.array(),
        triangles: 'number[]',
        bounds: PublicBoundsSchema,
    }).array(),
    surfaces: type({
        key: PublicKeySchema,
        type: "'roof' | 'wall'",
        transform: PublicTransformSchema,
        validFaces: "('front' | 'back' | 'top' | 'bottom' | 'left' | 'right')[]",
        colliderGroups: PublicSurfaceColliderGroupSchema.array(),
    }).array(),
    proceduralTiles: PublicProceduralTileSchema.array(),
    loadingDocks: type({
        key: PublicKeySchema,
        transform: PublicTransformSchema,
        parkingTransform: PublicTransformSchema,
        inputSlotCount: 'number',
        outputSlotCount: 'number',
        accessPoints: type({
            key: PublicKeySchema,
            transform: PublicTransformSchema,
        }).array(),
    }).array(),
    grids: type({
        key: PublicKeySchema,
        width: 'number',
        height: 'number',
        tileSize: 'number',
        origin: Vector3Schema,
        tiles: type({
            x: 'number',
            y: 'number',
            availableOffset: 'number',
            position: Vector3Schema,
            rotation: Vector3Schema,
        }).array(),
    }).array(),
});
export type PublicPropertyLayout = typeof PublicPropertyLayoutSchema.infer;

export const PublicBlueprintGeometrySchema = type({
    proof: {
        status: "'blueprint-calculation-input-complete'",
        renderAssets: "'not-published'",
        sourceRuntimeMetadata: "'not-published'",
    },
    buildables: PublicBuildableGeometrySchema.array(),
    properties: PublicPropertyLayoutSchema.array(),
    counts: {
        buildables: 'number',
        properties: 'number',
        buildableColliders: 'number',
        footprintTiles: 'number',
        interactionPoints: 'number',
        transitAccessPoints: 'number',
        propertyFixedColliders: 'number',
        propertyBoundaryColliders: 'number',
        propertySurfaceColliders: 'number',
        surfaceMeshes: 'number',
        surfaces: 'number',
        proceduralTiles: 'number',
        loadingDocks: 'number',
        grids: 'number',
        gridTiles: 'number',
    },
});
export type PublicBlueprintGeometry = typeof PublicBlueprintGeometrySchema.infer;
