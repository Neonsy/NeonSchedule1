import { type } from 'arktype';

import { Vector3Schema } from '#core/data/common';

export const MapImageSchema = type({
    fileId: 'string',
    width: 'number',
    height: 'number',
});
export type MapImage = typeof MapImageSchema.infer;

export const MapProjectionCalibrationSchema = type({
    origin: Vector3Schema,
    edge: Vector3Schema,
    mapDimensions: 'number',
    conversionFactor: 'number',
});
export type MapProjectionCalibration = typeof MapProjectionCalibrationSchema.infer;

export const DeliveryLocationCandidateSchema = type({
    id: 'string',
    position: Vector3Schema,
});
export type DeliveryLocationCandidate = typeof DeliveryLocationCandidateSchema.infer;

export const WorldRegionSchema = type({
    id: 'string',
    name: 'string',
    unlockedByDefault: 'boolean',
    rankRequirement: 'string | null',
    spriteFileId: 'string | null',
    boundsPointA: Vector3Schema.or('null'),
    boundsPointB: Vector3Schema.or('null'),
    isClosed: 'boolean',
    verticalSize: 'number',
    polygonPoints: Vector3Schema.array(),
    adjacentRegionIds: 'string[]',
    deliveryLocations: DeliveryLocationCandidateSchema.array(),
});
export type WorldRegion = typeof WorldRegionSchema.infer;

export const WorldMapSchema = type({
    schema: "'neonschedule1-world-map-2'",
    mainMap: MapImageSchema.or('null'),
    tutorialMap: MapImageSchema.or('null'),
    projection: MapProjectionCalibrationSchema,
    regions: WorldRegionSchema.array(),
});
export type WorldMap = typeof WorldMapSchema.infer;

export const WorldLocationSchema = type({
    sourceKind: 'string',
    sourceId: 'string',
    name: 'string',
    description: 'string',
    sceneName: 'string',
    position: Vector3Schema.or('null'),
    rotation: Vector3Schema.or('null'),
    personId: 'string | null',
    iconFileIds: 'string[]',
});
export type WorldLocation = typeof WorldLocationSchema.infer;

export const MapServiceSchema = type({
    kind: 'string',
    id: 'string',
    name: 'string',
    description: 'string',
    sceneName: 'string',
    regionId: 'string | null',
    position: Vector3Schema,
    rotation: Vector3Schema,
    accessPointPosition: Vector3Schema.or('null'),
    accessPointRotation: Vector3Schema.or('null'),
    locationSource: 'string',
    linkedPersonId: 'string | null',
});
export type MapService = typeof MapServiceSchema.infer;

export const NearbyShopSchema = type({ shopCode: 'string', distance: 'number' });
export type NearbyShop = typeof NearbyShopSchema.infer;

export const TimedAccessZoneSchema = type({
    id: 'string',
    openTime: 'number',
    closeTime: 'number',
    allowExitWhenClosed: 'boolean',
    autoCloseDoor: 'boolean',
    position: Vector3Schema,
    rotation: Vector3Schema,
    sceneName: 'string',
    doorCount: 'number',
    nearestShops: NearbyShopSchema.array(),
});
export type TimedAccessZone = typeof TimedAccessZoneSchema.infer;

export const WorldLocationCatalogSchema = type({
    schema: "'neonschedule1-world-location-catalog-1'",
    locations: WorldLocationSchema.array(),
    services: MapServiceSchema.array(),
    timedAccessZones: TimedAccessZoneSchema.array(),
});
export type WorldLocationCatalog = typeof WorldLocationCatalogSchema.infer;

export const NavigationSampleSchema = type({
    gridX: 'number',
    gridZ: 'number',
    position: Vector3Schema,
    areaMask: 'number',
});
export type NavigationSample = typeof NavigationSampleSchema.infer;

export const NavigationEdgeSchema = type({ sampleA: 'number', sampleB: 'number' });
export type NavigationEdge = typeof NavigationEdgeSchema.infer;

export const NavigationAgentSchema = type({
    source: "'employee-prefabs'",
    typeId: 'number',
    name: 'string',
    radius: 'number',
    height: 'number',
    maximumSlope: 'number',
    stepHeight: 'number',
    employeeTypes: 'string[]',
});
export type NavigationAgent = typeof NavigationAgentSchema.infer;

export const NavigationGraphSchema = type({
    schema: "'neonschedule1-navigation-graph-2'",
    method: 'string',
    agent: NavigationAgentSchema,
    sampleSpacing: 'number',
    queryHeight: 'number',
    maxSampleDistance: 'number',
    boundsMinimum: Vector3Schema,
    boundsMaximum: Vector3Schema,
    gridWidth: 'number',
    gridHeight: 'number',
    samples: NavigationSampleSchema.array(),
    edges: NavigationEdgeSchema.array(),
});
export type NavigationGraph = typeof NavigationGraphSchema.infer;
