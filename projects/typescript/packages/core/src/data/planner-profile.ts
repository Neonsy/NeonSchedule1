import { type } from 'arktype';

import { Vector3Schema } from '#core/data/common';
import { BlueprintDocumentSchema } from '#core/data/blueprint';
import { MixingRuleProfileSchema } from '#core/data/mixing';

export const PlannerCompatibilitySchema = type({
    gameVersion: 'string',
    datasetSha256: 'string',
});
export type PlannerCompatibility = typeof PlannerCompatibilitySchema.infer;

export const PlannerDocumentMetadataSchema = type({
    documentId: 'string',
    profileId: 'string',
    createdAt: 'string',
    updatedAt: 'string',
    compatibility: PlannerCompatibilitySchema,
});
export type PlannerDocumentMetadata = typeof PlannerDocumentMetadataSchema.infer;

export const PlannerUnknownValueSchema = type({ status: "'unknown'" });
export type PlannerUnknownValue = typeof PlannerUnknownValueSchema.infer;

export const PlannerKnownBooleanValueSchema = type({
    status: "'known'",
    value: 'boolean',
});
export const PlannerBooleanValueSchema = PlannerUnknownValueSchema.or(
    PlannerKnownBooleanValueSchema
);
export type PlannerBooleanValue = typeof PlannerBooleanValueSchema.infer;

export const PlannerKnownNumberValueSchema = type({
    status: "'known'",
    value: 'number',
});
export const PlannerNumberValueSchema = PlannerUnknownValueSchema.or(PlannerKnownNumberValueSchema);
export type PlannerNumberValue = typeof PlannerNumberValueSchema.infer;

export const PlannerKnownStringValueSchema = type({
    status: "'known'",
    value: 'string',
});
export const PlannerStringValueSchema = PlannerUnknownValueSchema.or(PlannerKnownStringValueSchema);
export type PlannerStringValue = typeof PlannerStringValueSchema.infer;

export const PlannerKnownVector3ValueSchema = type({
    status: "'known'",
    value: Vector3Schema,
});
export const PlannerVector3ValueSchema = PlannerUnknownValueSchema.or(
    PlannerKnownVector3ValueSchema
);
export type PlannerVector3Value = typeof PlannerVector3ValueSchema.infer;

export const PlannerKnownRankValueSchema = type({
    status: "'known'",
    value: {
        rank: 'string',
        tier: 'number',
    },
});
export const PlannerRankValueSchema = PlannerUnknownValueSchema.or(PlannerKnownRankValueSchema);
export type PlannerRankValue = typeof PlannerRankValueSchema.infer;

export const PlannerKnownMixingRuleProfileValueSchema = type({
    status: "'known'",
    value: MixingRuleProfileSchema,
});
export const PlannerMixingRuleProfileValueSchema = PlannerUnknownValueSchema.or(
    PlannerKnownMixingRuleProfileValueSchema
);
export type PlannerMixingRuleProfileValue = typeof PlannerMixingRuleProfileValueSchema.infer;

export const PlannerKnownStringSetValueSchema = type({
    status: "'known'",
    coverage: "'complete' | 'partial'",
    values: 'string[]',
});
export const PlannerStringSetValueSchema = PlannerUnknownValueSchema.or(
    PlannerKnownStringSetValueSchema
);
export type PlannerStringSetValue = typeof PlannerStringSetValueSchema.infer;

export const PlannerRelationshipFactSchema = type({
    personId: 'string',
    relationship: 'number',
});
export type PlannerRelationshipFact = typeof PlannerRelationshipFactSchema.infer;

export const PlannerKnownRelationshipSetValueSchema = type({
    status: "'known'",
    coverage: "'complete' | 'partial'",
    values: PlannerRelationshipFactSchema.array(),
});
export const PlannerRelationshipSetValueSchema = PlannerUnknownValueSchema.or(
    PlannerKnownRelationshipSetValueSchema
);
export type PlannerRelationshipSetValue = typeof PlannerRelationshipSetValueSchema.infer;

export const PlannerCustomerDrugAffinitySchema = type({
    drugType: 'string',
    affinity: 'number',
});
export type PlannerCustomerDrugAffinity = typeof PlannerCustomerDrugAffinitySchema.infer;

export const PlannerKnownCustomerDrugAffinitySetValueSchema = type({
    status: "'known'",
    coverage: "'complete' | 'partial'",
    values: PlannerCustomerDrugAffinitySchema.array(),
});
export const PlannerCustomerDrugAffinitySetValueSchema = PlannerUnknownValueSchema.or(
    PlannerKnownCustomerDrugAffinitySetValueSchema
);
export type PlannerCustomerDrugAffinitySetValue =
    typeof PlannerCustomerDrugAffinitySetValueSchema.infer;

export const PlannerCustomerStateSchema = type({
    customerId: 'string',
    addiction: PlannerNumberValueSchema,
    orderLimitMultiplier: PlannerNumberValueSchema,
    drugAffinities: PlannerCustomerDrugAffinitySetValueSchema,
});
export type PlannerCustomerState = typeof PlannerCustomerStateSchema.infer;

export const PlannerKnownCustomerStateSetValueSchema = type({
    status: "'known'",
    coverage: "'complete' | 'partial'",
    values: PlannerCustomerStateSchema.array(),
});
export const PlannerCustomerStateSetValueSchema = PlannerUnknownValueSchema.or(
    PlannerKnownCustomerStateSetValueSchema
);
export type PlannerCustomerStateSetValue = typeof PlannerCustomerStateSetValueSchema.infer;

export const PlannerDealerStateSchema = type({
    personId: 'string',
    signingFeePaid: PlannerBooleanValueSchema,
});
export type PlannerDealerState = typeof PlannerDealerStateSchema.infer;

export const PlannerKnownDealerStateSetValueSchema = type({
    status: "'known'",
    coverage: "'complete' | 'partial'",
    values: PlannerDealerStateSchema.array(),
});
export const PlannerDealerStateSetValueSchema = PlannerUnknownValueSchema.or(
    PlannerKnownDealerStateSetValueSchema
);
export type PlannerDealerStateSetValue = typeof PlannerDealerStateSetValueSchema.infer;

export const PlannerPlacementRuntimeStateSchema = type({
    placementId: 'string',
    itemId: PlannerStringValueSchema,
    position: PlannerVector3ValueSchema,
    rotation: PlannerVector3ValueSchema,
    moisture: PlannerNumberValueSchema,
    trashQuantity: PlannerNumberValueSchema,
    taskReady: PlannerBooleanValueSchema,
});
export type PlannerPlacementRuntimeState = typeof PlannerPlacementRuntimeStateSchema.infer;

export const PlannerKnownPlacementRuntimeStateSetValueSchema = type({
    status: "'known'",
    coverage: "'complete' | 'partial'",
    values: PlannerPlacementRuntimeStateSchema.array(),
});
export const PlannerPlacementRuntimeStateSetValueSchema = PlannerUnknownValueSchema.or(
    PlannerKnownPlacementRuntimeStateSetValueSchema
);
export type PlannerPlacementRuntimeStateSetValue =
    typeof PlannerPlacementRuntimeStateSetValueSchema.infer;

export const PlannerPropertyStateSchema = type({
    propertyCode: 'string',
    owned: PlannerBooleanValueSchema,
    placements: PlannerPlacementRuntimeStateSetValueSchema,
});
export type PlannerPropertyState = typeof PlannerPropertyStateSchema.infer;

export const PlannerKnownPropertyStateSetValueSchema = type({
    status: "'known'",
    coverage: "'complete' | 'partial'",
    values: PlannerPropertyStateSchema.array(),
});
export const PlannerPropertyStateSetValueSchema = PlannerUnknownValueSchema.or(
    PlannerKnownPropertyStateSetValueSchema
);
export type PlannerPropertyStateSetValue = typeof PlannerPropertyStateSetValueSchema.infer;

export const PlannerEmployeeStateSchema = type({
    employeeId: 'string',
    position: PlannerVector3ValueSchema,
    currentWorkSpeed: PlannerNumberValueSchema,
    taskReady: PlannerBooleanValueSchema,
});
export type PlannerEmployeeState = typeof PlannerEmployeeStateSchema.infer;

export const PlannerKnownEmployeeStateSetValueSchema = type({
    status: "'known'",
    coverage: "'complete' | 'partial'",
    values: PlannerEmployeeStateSchema.array(),
});
export const PlannerEmployeeStateSetValueSchema = PlannerUnknownValueSchema.or(
    PlannerKnownEmployeeStateSetValueSchema
);
export type PlannerEmployeeStateSetValue = typeof PlannerEmployeeStateSetValueSchema.infer;

export const PlannerStateSnapshotSchema = type({
    mixingRuleProfile: PlannerMixingRuleProfileValueSchema,
    currentRank: PlannerRankValueSchema,
    unlockedPersonIds: PlannerStringSetValueSchema,
    relationships: PlannerRelationshipSetValueSchema,
    recommendedDealerIds: PlannerStringSetValueSchema,
    recruitedDealerIds: PlannerStringSetValueSchema,
    customers: PlannerCustomerStateSetValueSchema,
    dealers: PlannerDealerStateSetValueSchema,
    availableCash: PlannerNumberValueSchema,
    gameMinute: PlannerNumberValueSchema,
    properties: PlannerPropertyStateSetValueSchema,
    employees: PlannerEmployeeStateSetValueSchema,
});
export type PlannerStateSnapshot = typeof PlannerStateSnapshotSchema.infer;

export const PlannerInventoryEntrySchema = type({
    itemId: 'string',
    currentQuantity: PlannerNumberValueSchema,
    currentStackCount: PlannerNumberValueSchema,
});
export type PlannerInventoryEntry = typeof PlannerInventoryEntrySchema.infer;

export const PlannerInventoryOwnerSchema = type({
    kind: "'player' | 'property' | 'vehicle' | 'placement' | 'dealer' | 'supplier' | 'employee'",
    id: 'string',
});
export type PlannerInventoryOwner = typeof PlannerInventoryOwnerSchema.infer;

export const PlannerInventorySnapshotSchema = type({
    owner: PlannerInventoryOwnerSchema,
    coverage: "'complete' | 'partial'",
    entries: PlannerInventoryEntrySchema.array(),
});
export type PlannerInventorySnapshot = typeof PlannerInventorySnapshotSchema.infer;

export const PlannerManualStateDocumentSchema = type({
    schema: "'neonschedule1-planner-manual-state-1'",
    metadata: PlannerDocumentMetadataSchema,
    source: "'manual'",
    state: PlannerStateSnapshotSchema,
}).onDeepUndeclaredKey('reject');
export type PlannerManualStateDocument = typeof PlannerManualStateDocumentSchema.infer;

export const PlannerInventoryDocumentSchema = type({
    schema: "'neonschedule1-planner-inventory-1'",
    metadata: PlannerDocumentMetadataSchema,
    inventory: PlannerInventorySnapshotSchema,
}).onDeepUndeclaredKey('reject');
export type PlannerInventoryDocument = typeof PlannerInventoryDocumentSchema.infer;

export const PlannerChecklistItemSchema = type({
    id: 'string',
    label: 'string',
    completed: 'boolean',
});
export type PlannerChecklistItem = typeof PlannerChecklistItemSchema.infer;

export const PlannerChecklistDocumentSchema = type({
    schema: "'neonschedule1-planner-checklist-1'",
    metadata: PlannerDocumentMetadataSchema,
    title: 'string',
    items: PlannerChecklistItemSchema.array(),
}).onDeepUndeclaredKey('reject');
export type PlannerChecklistDocument = typeof PlannerChecklistDocumentSchema.infer;

export const PlannerBlueprintDocumentSchema = type({
    schema: "'neonschedule1-planner-blueprint-1'",
    metadata: PlannerDocumentMetadataSchema,
    title: 'string',
    blueprint: BlueprintDocumentSchema,
}).onDeepUndeclaredKey('reject');
export type PlannerBlueprintDocument = typeof PlannerBlueprintDocumentSchema.infer;

export const PlannerObservationSourceSchema = type({
    kind: "'save' | 'mod'",
    observedAt: 'string',
    connectorVersion: 'string',
    access: "'read-only'",
    rawPayloadRetention: "'none'",
});
export type PlannerObservationSource = typeof PlannerObservationSourceSchema.infer;

export const PlannerObservationDocumentSchema = type({
    schema: "'neonschedule1-planner-observation-1'",
    metadata: PlannerDocumentMetadataSchema,
    source: PlannerObservationSourceSchema,
    state: PlannerStateSnapshotSchema,
    inventories: PlannerInventorySnapshotSchema.array(),
}).onDeepUndeclaredKey('reject');
export type PlannerObservationDocument = typeof PlannerObservationDocumentSchema.infer;

export const PlannerProfileManifestSchema = type({
    schema: "'neonschedule1-planner-profile-1'",
    profileId: 'string',
    name: 'string',
    createdAt: 'string',
    updatedAt: 'string',
    compatibility: PlannerCompatibilitySchema,
    documents: {
        manualStateDocumentId: 'string',
        inventoryDocumentIds: 'string[]',
        checklistDocumentIds: 'string[]',
        blueprintDocumentIds: 'string[]',
        latestObservationDocumentId: 'string | null',
    },
    ownership: "'local-user'",
    sourceOfTruth: "'manual-state-with-explicit-observation-apply'",
    observationRetention: "'latest-only'",
    rawSaveRetention: "'none'",
    incompatibleDocumentBehavior: "'reject-without-explicit-migration'",
    exportScope: "'individual-documents-or-full-profile'",
    deletionScope: "'optional-documents-or-full-profile'",
}).onDeepUndeclaredKey('reject');
export type PlannerProfileManifest = typeof PlannerProfileManifestSchema.infer;

export const PlannerProfileBundleSchema = type({
    manifest: PlannerProfileManifestSchema,
    manualState: PlannerManualStateDocumentSchema,
    inventories: PlannerInventoryDocumentSchema.array(),
    checklists: PlannerChecklistDocumentSchema.array(),
    blueprints: PlannerBlueprintDocumentSchema.array(),
    observation: PlannerObservationDocumentSchema.or(type('null')),
}).onDeepUndeclaredKey('reject');
export type PlannerProfileBundle = typeof PlannerProfileBundleSchema.infer;
