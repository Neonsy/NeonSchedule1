import { type } from 'arktype';

import { Vector3Schema } from '#core/data/common';
import { QuaternionSchema } from '#core/data/geometry';

export const BlueprintGridCoordinateSchema = type({
    x: 'number',
    y: 'number',
});
export type BlueprintGridCoordinate = typeof BlueprintGridCoordinateSchema.infer;

export const BlueprintGridRotationSchema = type('0 | 90 | 180 | 270');
export type BlueprintGridRotation = typeof BlueprintGridRotationSchema.infer;

export const BlueprintGridPlacementSchema = type({
    id: 'string',
    kind: "'grid'",
    itemId: 'string',
    gridId: 'string',
    anchor: BlueprintGridCoordinateSchema,
    rotation: BlueprintGridRotationSchema,
});
export type BlueprintGridPlacement = typeof BlueprintGridPlacementSchema.infer;

export const BlueprintSurfacePlacementSchema = type({
    id: 'string',
    kind: "'surface'",
    itemId: 'string',
    surfaceId: 'string',
    surfaceColliderPath: 'string',
    relativeHitPoint: Vector3Schema,
    relativePosition: Vector3Schema,
    relativeRotation: QuaternionSchema,
});
export type BlueprintSurfacePlacement = typeof BlueprintSurfacePlacementSchema.infer;

export const BlueprintProceduralTileReferenceSchema = type({
    x: 'number',
    y: 'number',
    tileId: 'string',
});
export type BlueprintProceduralTileReference =
    typeof BlueprintProceduralTileReferenceSchema.infer;

export const BlueprintProceduralGridPlacementSchema = type({
    id: 'string',
    kind: "'procedural-grid'",
    itemId: 'string',
    parentPlacementId: 'string | null',
    tiles: BlueprintProceduralTileReferenceSchema.array(),
});
export type BlueprintProceduralGridPlacement =
    typeof BlueprintProceduralGridPlacementSchema.infer;

export const BlueprintPlacementSchema = BlueprintGridPlacementSchema
    .or(BlueprintSurfacePlacementSchema)
    .or(BlueprintProceduralGridPlacementSchema);
export type BlueprintPlacement = typeof BlueprintPlacementSchema.infer;

export const BlueprintDocumentSchema = type({
    schema: "'neonschedule1-blueprint-1'",
    gameVersion: 'string',
    datasetSha256: 'string',
    propertyCode: 'string',
    placements: BlueprintPlacementSchema.array(),
});
export type BlueprintDocument = typeof BlueprintDocumentSchema.infer;
