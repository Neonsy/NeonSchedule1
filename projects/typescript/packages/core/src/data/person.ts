import { type } from 'arktype';

import { Vector3Schema } from '#core/data/common';

export const PersonPresentationSchema = type({
    mugshotFileId: 'string | null',
    modelMeshIds: 'string[]',
    modelMaterialIds: 'string[]',
});
export type PersonPresentation = typeof PersonPresentationSchema.infer;

export const PersonScheduleLocationSchema = type({
    member: 'string',
    name: 'string',
    objectPath: 'string',
    position: Vector3Schema.or('null'),
    rotation: Vector3Schema.or('null'),
});
export type PersonScheduleLocation = typeof PersonScheduleLocationSchema.infer;

export const PersonScheduleActionSchema = type({
    runtimeType: 'string',
    name: 'string',
    startTime: 'number',
    endTime: 'number',
    duration: 'number | null',
    maxDuration: 'number | null',
    priority: 'number',
    isEvent: 'boolean',
    isSignal: 'boolean',
    location: PersonScheduleLocationSchema.or('null'),
    targetResolution: 'string | null',
});
export type PersonScheduleAction = typeof PersonScheduleActionSchema.infer;

export const PersonInstanceSchema = type({
    key: 'string',
    objectPath: 'string',
    presentation: PersonPresentationSchema,
    schedule: PersonScheduleActionSchema.array().or('null'),
});
export type PersonInstance = typeof PersonInstanceSchema.infer;

export const PersonSchema = type({
    schema: "'neonschedule1-person-1'",
    id: 'string',
    name: {
        first: 'string',
        last: 'string',
        full: 'string',
    },
    regions: 'string[]',
    roles: 'string[]',
    defaultRelationship: 'number | null',
    displayRelationship: 'boolean | null',
    instances: PersonInstanceSchema.array(),
});
export type Person = typeof PersonSchema.infer;

export const RelationshipEdgeSchema = type({
    sourceId: 'string',
    targetId: 'string',
    bidirectional: 'boolean',
});
export type RelationshipEdge = typeof RelationshipEdgeSchema.infer;

export const RelationshipCatalogSchema = type({
    schema: "'neonschedule1-relationship-catalog-1'",
    personIds: 'string[]',
    edges: RelationshipEdgeSchema.array(),
});
export type RelationshipCatalog = typeof RelationshipCatalogSchema.infer;
