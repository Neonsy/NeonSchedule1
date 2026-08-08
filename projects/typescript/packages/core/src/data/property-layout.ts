import { type } from 'arktype';

import { Vector3Schema } from '#core/data/common';
import {
    ColliderSchema,
    SceneVisualsSchema,
    TransformSchema,
    TriangleMeshSchema,
} from '#core/data/geometry';
import { ProceduralTileSchema } from '#core/data/buildable';

export const PropertySurfaceSchema = type({
    id: 'string',
    sourceGuid: 'string | null',
    type: 'string',
    transform: TransformSchema,
    container: TransformSchema,
    validFaces: 'string[]',
    colliders: ColliderSchema.array(),
});
export type PropertySurface = typeof PropertySurfaceSchema.infer;

export const LoadingDockSchema = type({
    id: 'string',
    name: 'string',
    transform: TransformSchema,
    parkingTransform: TransformSchema,
    inputSlotCount: 'number',
    outputSlotCount: 'number',
    accessPoints: TransformSchema.array(),
});
export type LoadingDock = typeof LoadingDockSchema.infer;

export const PropertyGridTileSchema = type({
    x: 'number',
    y: 'number',
    availableOffset: 'number',
    worldPosition: Vector3Schema,
    worldRotation: Vector3Schema,
});
export type PropertyGridTile = typeof PropertyGridTileSchema.infer;

export const PropertyGridSchema = type({
    id: 'string',
    width: 'number',
    height: 'number',
    tileSize: 'number',
    worldOrigin: Vector3Schema,
    tiles: PropertyGridTileSchema.array(),
});
export type PropertyGrid = typeof PropertyGridSchema.infer;

export const PropertyLayoutSchema = type({
    schema: "'neonschedule1-property-layout-4'",
    propertyCode: 'string',
    propertyName: 'string',
    worldPosition: Vector3Schema,
    worldRotation: Vector3Schema,
    spawnPoint: TransformSchema,
    interiorSpawnPoint: TransformSchema,
    npcSpawnPoint: TransformSchema,
    boundingBox: ColliderSchema.or('null'),
    boundaryColliders: ColliderSchema.array(),
    fixedColliders: ColliderSchema.array(),
    surfaceMeshes: TriangleMeshSchema.array(),
    surfaces: PropertySurfaceSchema.array(),
    proceduralTiles: ProceduralTileSchema.array(),
    loadingDocks: LoadingDockSchema.array(),
    grids: PropertyGridSchema.array(),
    visuals: SceneVisualsSchema,
});
export type PropertyLayout = typeof PropertyLayoutSchema.infer;
