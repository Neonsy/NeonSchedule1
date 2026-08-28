import { type } from 'arktype';

import {
    PlannerInventorySnapshotSchema,
    PlannerStateSnapshotSchema,
} from '#core/data/planner-profile';

export const PlannerObservationRequestSchema = type({
    schema: "'neonschedule1-planner-observation-request-1'",
    requestId: 'string',
    expectedGameVersion: 'string',
}).onDeepUndeclaredKey('reject');
export type PlannerObservationRequest = typeof PlannerObservationRequestSchema.infer;

export const PlannerObservationInventoryScopeSchema = type(
    "'complete' | 'partial' | 'unknown'"
);
export type PlannerObservationInventoryScope =
    typeof PlannerObservationInventoryScopeSchema.infer;

export const PlannerObservationInventoryScopesSchema = type({
    player: PlannerObservationInventoryScopeSchema,
    dealers: PlannerObservationInventoryScopeSchema,
    suppliers: PlannerObservationInventoryScopeSchema,
    properties: PlannerObservationInventoryScopeSchema,
    placements: PlannerObservationInventoryScopeSchema,
    employees: PlannerObservationInventoryScopeSchema,
    vehicles: PlannerObservationInventoryScopeSchema,
});
export type PlannerObservationInventoryScopes =
    typeof PlannerObservationInventoryScopesSchema.infer;

export const PlannerObservationResponseSchema = type({
    schema: "'neonschedule1-planner-observation-response-1'",
    exporterVersion: 'string',
    observedAtUtc: 'string',
    gameVersion: 'string',
    requestId: 'string',
    requestSha256: 'string',
    source: {
        kind: "'mod'",
        access: "'read-only'",
        rawPayloadRetention: "'none'",
    },
    state: PlannerStateSnapshotSchema,
    inventoryScopes: PlannerObservationInventoryScopesSchema,
    inventories: PlannerInventorySnapshotSchema.array(),
}).onDeepUndeclaredKey('reject');
export type PlannerObservationResponse = typeof PlannerObservationResponseSchema.infer;
