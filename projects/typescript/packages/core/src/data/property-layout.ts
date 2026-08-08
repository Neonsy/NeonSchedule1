import { type } from 'arktype';

import { Vector3Schema } from '#core/data/common';
import { ColliderSchema, SceneVisualsSchema, TransformSchema } from '#core/data/geometry';

export const PropertySurfaceSchema = type({
    id: 'string',
    sourceGuid: 'string | null',
    type: 'string',
    transform: TransformSchema,
    container: TransformSchema,
    validFaces: 'string[]',
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
    schema: "'neonschedule1-property-layout-1'",
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
    surfaces: PropertySurfaceSchema.array(),
    loadingDocks: LoadingDockSchema.array(),
    grids: PropertyGridSchema.array(),
    visuals: SceneVisualsSchema,
});
export type PropertyLayout = typeof PropertyLayoutSchema.infer;
