import { type } from 'arktype';

import { Vector3Schema } from '#core/data/common';

export const VehicleNavigationGraphRoleSchema = type("'general' | 'road'");
export type VehicleNavigationGraphRole = typeof VehicleNavigationGraphRoleSchema.infer;

export const VehicleNavigationNodeSchema = type({
    index: 'number',
    runtimeType: 'string',
    geometryKind: 'string',
    position: Vector3Schema,
    walkable: 'boolean',
    penalty: 'number',
    tag: 'number',
    vertices: Vector3Schema.array(),
    weakComponentId: 'number',
    strongComponentId: 'number',
});
export type VehicleNavigationNode = typeof VehicleNavigationNodeSchema.infer;

export const VehicleNavigationConnectionSchema = type({
    sourceNodeIndex: 'number',
    targetNodeIndex: 'number',
    rawCost: 'number',
    geometricDistance: 'number',
    loose: 'boolean',
    shapeEdge: 'number',
});
export type VehicleNavigationConnection = typeof VehicleNavigationConnectionSchema.infer;

export const VehicleNavigationGraphSchema = type({
    role: VehicleNavigationGraphRoleSchema,
    name: 'string',
    runtimeType: 'string',
    guid: 'string',
    weakComponentCount: 'number',
    strongComponentCount: 'number',
    nodes: VehicleNavigationNodeSchema.array(),
    connections: VehicleNavigationConnectionSchema.array(),
});
export type VehicleNavigationGraph = typeof VehicleNavigationGraphSchema.infer;

export const VehicleNavigationEndpointMappingSchema = type({
    subjectKind: 'string',
    subjectCode: 'string',
    subjectInstanceKey: 'string',
    endpointIndex: 'number',
    graphRole: VehicleNavigationGraphRoleSchema,
    position: Vector3Schema,
    nodeIndex: 'number',
    graphPosition: Vector3Schema,
    projectionMethod: 'string',
    nodeCenterDistance: 'number',
    graphDistance: 'number',
    weakComponentId: 'number',
    strongComponentId: 'number',
});
export type VehicleNavigationEndpointMapping =
    typeof VehicleNavigationEndpointMappingSchema.infer;

export const VehicleNavigationSchema = type({
    schema: "'neonschedule1-vehicle-navigation-1'",
    sourceMethod: 'string',
    sourceApplicability: 'string',
    sourceLimitation: 'string',
    endpointMappingMethod: 'string',
    connectionDirection: "'directed'",
    geometricDistanceMethod: "'node-center-euclidean-3d'",
    endpointOffsetStatus: "'reported-not-traversable'",
    layerCompositionStatus: "'unproven'",
    graphs: VehicleNavigationGraphSchema.array(),
    endpointMappings: VehicleNavigationEndpointMappingSchema.array(),
});
export type VehicleNavigation = typeof VehicleNavigationSchema.infer;
