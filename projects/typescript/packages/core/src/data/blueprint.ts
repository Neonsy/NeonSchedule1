import { type } from 'arktype';

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

export const BlueprintDocumentSchema = type({
    schema: "'neonschedule1-blueprint-1'",
    gameVersion: 'string',
    datasetSha256: 'string',
    propertyCode: 'string',
    placements: BlueprintGridPlacementSchema.array(),
});
export type BlueprintDocument = typeof BlueprintDocumentSchema.infer;
