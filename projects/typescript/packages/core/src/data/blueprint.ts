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

export const BlueprintHandlerRouteFilterSchema = type({
    mode: "'whitelist' | 'blacklist'",
    itemIds: 'string[]',
});
export type BlueprintHandlerRouteFilter = typeof BlueprintHandlerRouteFilterSchema.infer;

export const BlueprintHandlerRouteSchema = type({
    id: 'string',
    sourcePlacementId: 'string',
    destinationPlacementId: 'string',
    filter: BlueprintHandlerRouteFilterSchema,
});
export type BlueprintHandlerRoute = typeof BlueprintHandlerRouteSchema.infer;

export const BlueprintBotanistAssignmentSchema = type({
    id: 'string',
    employeeType: "'Botanist'",
    assignedPotPlacementIds: 'string[]',
    supplyPlacementId: 'string | null',
});
export type BlueprintBotanistAssignment = typeof BlueprintBotanistAssignmentSchema.infer;

export const BlueprintChemistAssignmentSchema = type({
    id: 'string',
    employeeType: "'Chemist'",
    assignedStationPlacementIds: 'string[]',
});
export type BlueprintChemistAssignment = typeof BlueprintChemistAssignmentSchema.infer;

export const BlueprintHandlerAssignmentSchema = type({
    id: 'string',
    employeeType: "'Handler'",
    assignedStationPlacementIds: 'string[]',
    handlerRoutes: BlueprintHandlerRouteSchema.array(),
});
export type BlueprintHandlerAssignment = typeof BlueprintHandlerAssignmentSchema.infer;

export const BlueprintEmployeeAssignmentSchema = BlueprintBotanistAssignmentSchema
    .or(BlueprintChemistAssignmentSchema)
    .or(BlueprintHandlerAssignmentSchema);
export type BlueprintEmployeeAssignment = typeof BlueprintEmployeeAssignmentSchema.infer;

export const BlueprintProductionSupplySchema = type({
    id: 'string',
    itemId: 'string',
    sourcePlacementId: 'string',
    quantity: 'number',
});
export type BlueprintProductionSupply = typeof BlueprintProductionSupplySchema.infer;

export const BlueprintProductionLogisticsSchema = type({
    employees: BlueprintEmployeeAssignmentSchema.array(),
    supplies: BlueprintProductionSupplySchema.array(),
});
export type BlueprintProductionLogistics = typeof BlueprintProductionLogisticsSchema.infer;

export const BlueprintDocumentSchema = type({
    schema: "'neonschedule1-blueprint-3'",
    gameVersion: 'string',
    datasetSha256: 'string',
    propertyCode: 'string',
    placements: BlueprintPlacementSchema.array(),
    productionLogistics: BlueprintProductionLogisticsSchema,
});
export type BlueprintDocument = typeof BlueprintDocumentSchema.infer;
