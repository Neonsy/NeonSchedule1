import { type } from 'arktype';

import {
    BlueprintGridCoordinateSchema,
    BlueprintGridRotationSchema,
} from '#core/data/blueprint';
import { MixingRuleProfileSchema } from '#core/data/mixing';
import {
    PlannerBlueprintDocumentSchema,
    PlannerChecklistDocumentSchema,
    PlannerCompatibilitySchema,
    PlannerInventoryDocumentSchema,
    PlannerInventoryOwnerSchema,
    PlannerManualStateDocumentSchema,
    PlannerObservationDocumentSchema,
    PlannerProfileBundleSchema,
} from '#core/data/planner-profile';

export const ApplicationSha256Schema = type(/^[a-f0-9]{64}$/u);
export const ApplicationPolicyKeySchema = type("'neonschedule1-application-data-policy-1'");

export const ApplicationDataPolicySchema = type({
    schema: ApplicationPolicyKeySchema,
    profiles: {
        owner: "'local-user'",
        sourceOfTruth: "'manual-state'",
        persistence: "'application-adapter'",
        synchronization: "'optional-explicit-account-sync'",
        conflict: "'reject-base-content-mismatch'",
        retention: "'until-explicit-profile-deletion'",
        deletion: "'optional-documents-or-full-profile'",
        migration: "'reject-until-explicit-migration'",
    },
    exports: {
        owner: "'local-user'",
        access: "'private-holder-controlled'",
        snapshot: "'validated-profile-or-document'",
        encoding: "'canonical-json'",
        import: "'as-new-or-explicit-replace'",
        merge: "'never-automatic'",
        retention: "'until-holder-deletes-copy'",
        deletion: "'delete-held-copy'",
    },
    sharing: {
        owner: "'creator'",
        access: "'holder-controlled-copy'",
        content: "'recipe-or-blueprint-only'",
        identifiers: "'opaque-public-keys'",
        encoding: "'canonical-json'",
        compatibility: "'matching-game-and-dataset-required'",
        mutation: "'immutable-content-addressed-copy'",
        revocation: "'not-supported-after-copy'",
        retention: "'until-holder-deletes-copy'",
        deletion: "'delete-held-copy'",
    },
    community: {
        owner: "'submitting-account'",
        visibility: "'public-or-unlisted'",
        authorship: "'account-or-anonymized-after-account-deletion'",
        deduplication: "'canonical-content-sha256'",
        moderation: "'report-and-action-history'",
        retention: "'until-author-deletion-or-moderation-removal'",
        deletion: "'remove-content-retain-minimal-tombstone'",
    },
    accounts: {
        identity: "'opaque-account-id'",
        authentication: "'external-provider'",
        credentials: "'never-stored-in-application-contracts'",
        recovery: "'external-provider'",
        authorization: "'account-owns-community-and-sync-records'",
        retention: "'until-explicit-account-deletion'",
        deletion: "'remove-private-data-and-anonymize-retained-public-authorship'",
        export: "'account-community-and-sync-records'",
    },
    liveState: {
        access: "'read-only-observation'",
        consent: "'explicit-user-reviewed-apply'",
        target: "'manual-profile-documents-only'",
        staleState: "'reject-profile-content-mismatch'",
        selectedValues: "'replace-without-coercion'",
        unselectedValues: "'preserve'",
        collectionCoverage: "'preserve-source-coverage'",
        retry: "'new-request-after-conflict'",
        gameWrites: "'forbidden'",
    },
    limits: {
        recipeShareBytes: 'number',
        blueprintShareBytes: 'number',
        profileExportBytes: 'number',
        accountExportBytes: 'number',
        displayNameCharacters: 'number',
        communityReportCount: 'number',
        communityModerationActionCount: 'number',
    },
    forbiddenFields: 'string[]',
}).onDeepUndeclaredKey('reject');
export type ApplicationDataPolicy = typeof ApplicationDataPolicySchema.infer;

export const ApplicationExportDocumentPayloadSchema = type({
    kind: "'manual-state'",
    document: PlannerManualStateDocumentSchema,
}).or(type({
    kind: "'inventory'",
    document: PlannerInventoryDocumentSchema,
})).or(type({
    kind: "'checklist'",
    document: PlannerChecklistDocumentSchema,
})).or(type({
    kind: "'blueprint'",
    document: PlannerBlueprintDocumentSchema,
})).or(type({
    kind: "'observation'",
    document: PlannerObservationDocumentSchema,
}));
export type ApplicationExportDocumentPayload =
    typeof ApplicationExportDocumentPayloadSchema.infer;

export const ApplicationExportPayloadSchema = type({
    kind: "'full-profile'",
    profile: PlannerProfileBundleSchema,
}).or(type({
    kind: "'individual-document'",
    profileId: 'string',
    compatibility: PlannerCompatibilitySchema,
    value: ApplicationExportDocumentPayloadSchema,
}));
export type ApplicationExportPayload = typeof ApplicationExportPayloadSchema.infer;

export const ApplicationProfileExportSchema = type({
    schema: "'neonschedule1-profile-export-1'",
    policy: ApplicationPolicyKeySchema,
    exportId: 'string',
    exportedAt: 'string',
    encoding: "'canonical-json'",
    privacy: "'private-user-data'",
    integrity: {
        algorithm: "'sha256'",
        payloadSha256: ApplicationSha256Schema,
    },
    payload: ApplicationExportPayloadSchema,
}).onDeepUndeclaredKey('reject');
export type ApplicationProfileExport = typeof ApplicationProfileExportSchema.infer;

const ApplicationSharedRecipeSchema = type({
    kind: "'recipe'",
    title: 'string',
    productKey: 'string',
    ingredientKeys: 'string[]',
    ruleProfile: MixingRuleProfileSchema,
});

const ApplicationSharedGridPlacementSchema = type({
    id: 'string',
    kind: "'grid'",
    itemKey: 'string',
    gridKey: 'string',
    anchor: BlueprintGridCoordinateSchema,
    rotation: BlueprintGridRotationSchema,
});

const ApplicationSharedSurfacePlacementSchema = type({
    id: 'string',
    kind: "'surface'",
    itemKey: 'string',
    surfaceKey: 'string',
    surfaceColliderKey: 'string',
    relativeHitPoint: { x: 'number', y: 'number', z: 'number' },
    relativePosition: { x: 'number', y: 'number', z: 'number' },
    relativeRotation: { x: 'number', y: 'number', z: 'number', w: 'number' },
});

const ApplicationSharedProceduralPlacementSchema = type({
    id: 'string',
    kind: "'procedural-grid'",
    itemKey: 'string',
    parentPlacementId: 'string | null',
    tiles: type({
        x: 'number',
        y: 'number',
        tileKey: 'string',
    }).array(),
});

const ApplicationSharedPlacementSchema = ApplicationSharedGridPlacementSchema
    .or(ApplicationSharedSurfacePlacementSchema)
    .or(ApplicationSharedProceduralPlacementSchema);

const ApplicationSharedBotanistSchema = type({
    id: 'string',
    employeeType: "'Botanist'",
    assignedPotPlacementIds: 'string[]',
    supplyPlacementId: 'string | null',
});

const ApplicationSharedChemistSchema = type({
    id: 'string',
    employeeType: "'Chemist'",
    assignedStationPlacementIds: 'string[]',
});

const ApplicationSharedHandlerSchema = type({
    id: 'string',
    employeeType: "'Handler'",
    assignedStationPlacementIds: 'string[]',
    handlerRoutes: type({
        id: 'string',
        sourcePlacementId: 'string',
        destinationPlacementId: 'string',
        filter: {
            mode: "'whitelist' | 'blacklist'",
            itemKeys: 'string[]',
        },
    }).array(),
});

const ApplicationSharedCleanerSchema = type({
    id: 'string',
    employeeType: "'Cleaner'",
    assignedBinPlacementIds: 'string[]',
});

const ApplicationSharedEmployeeSchema = ApplicationSharedBotanistSchema
    .or(ApplicationSharedChemistSchema)
    .or(ApplicationSharedHandlerSchema)
    .or(ApplicationSharedCleanerSchema);

const ApplicationSharedBlueprintSchema = type({
    kind: "'blueprint'",
    title: 'string',
    propertyKey: 'string',
    placements: ApplicationSharedPlacementSchema.array(),
    productionLogistics: {
        employees: ApplicationSharedEmployeeSchema.array(),
        supplies: type({
            id: 'string',
            itemKey: 'string',
            sourcePlacementId: 'string',
            quantity: 'number',
        }).array(),
    },
});

export const ApplicationSharePayloadSchema = ApplicationSharedRecipeSchema
    .or(ApplicationSharedBlueprintSchema);
export type ApplicationSharePayload = typeof ApplicationSharePayloadSchema.infer;

export const ApplicationShareEnvelopeSchema = type({
    schema: "'neonschedule1-share-1'",
    policy: ApplicationPolicyKeySchema,
    createdAt: 'string',
    compatibility: PlannerCompatibilitySchema,
    encoding: "'canonical-json'",
    integrity: {
        algorithm: "'sha256'",
        payloadSha256: ApplicationSha256Schema,
    },
    payload: ApplicationSharePayloadSchema,
}).onDeepUndeclaredKey('reject');
export type ApplicationShareEnvelope = typeof ApplicationShareEnvelopeSchema.infer;

export const ApplicationAccountSchema = type({
    schema: "'neonschedule1-account-1'",
    policy: ApplicationPolicyKeySchema,
    accountId: 'string',
    displayName: 'string | null',
    createdAt: 'string',
    updatedAt: 'string',
    status: "'active' | 'deletion-pending' | 'deleted'",
    authentication: "'external-provider'",
    credentialRetention: "'none'",
    recovery: "'external-provider'",
    communityPublishing: "'account-required'",
    profileSynchronization: "'opt-in-explicit'",
    deletion: "'remove-private-data-and-anonymize-retained-public-authorship'",
}).onDeepUndeclaredKey('reject');
export type ApplicationAccount = typeof ApplicationAccountSchema.infer;

export const ApplicationProfileSyncRecordSchema = type({
    schema: "'neonschedule1-profile-sync-1'",
    policy: ApplicationPolicyKeySchema,
    syncId: 'string',
    accountId: 'string',
    profileId: 'string',
    revision: 'number',
    updatedAt: 'string',
    compatibility: PlannerCompatibilitySchema,
    baseContentSha256: ApplicationSha256Schema.or('null'),
    contentSha256: ApplicationSha256Schema,
    sourceOfTruth: "'local-profile'",
    upload: "'explicit'",
    downloadApply: "'explicit'",
    conflict: "'reject-base-content-mismatch'",
    retention: "'until-explicit-remote-copy-deletion'",
    deletion: "'delete-remote-copy'",
    profile: PlannerProfileBundleSchema,
}).onDeepUndeclaredKey('reject');
export type ApplicationProfileSyncRecord = typeof ApplicationProfileSyncRecordSchema.infer;

const ApplicationCommunityReportSchema = type({
    reportId: 'string',
    reporterAccountId: 'string',
    createdAt: 'string',
    reason: "'spam' | 'abuse' | 'misleading' | 'incompatible' | 'other'",
    status: "'open' | 'dismissed' | 'resolved'",
});

const ApplicationCommunityModerationActionSchema = type({
    actionId: 'string',
    actorAccountId: 'string',
    createdAt: 'string',
    action: "'publish' | 'hold-for-review' | 'remove' | 'restore' | 'delete'",
    reason: 'string',
});

export const ApplicationCommunityEntrySchema = type({
    schema: "'neonschedule1-community-entry-1'",
    policy: ApplicationPolicyKeySchema,
    entryId: 'string',
    authorAccountId: 'string | null',
    createdAt: 'string',
    updatedAt: 'string',
    revision: 'number',
    visibility: "'public' | 'unlisted'",
    status: "'visible' | 'under-review' | 'removed' | 'deleted'",
    contentSha256: ApplicationSha256Schema,
    duplicateOfEntryId: 'string | null',
    share: ApplicationShareEnvelopeSchema.or('null'),
    reports: ApplicationCommunityReportSchema.array(),
    moderationActions: ApplicationCommunityModerationActionSchema.array(),
    retention: "'until-author-deletion-or-moderation-removal'",
    deletion: "'remove-content-retain-minimal-tombstone'",
}).onDeepUndeclaredKey('reject');
export type ApplicationCommunityEntry = typeof ApplicationCommunityEntrySchema.infer;

export const ApplicationAccountDataExportPayloadSchema = type({
    account: ApplicationAccountSchema,
    communityEntries: ApplicationCommunityEntrySchema.array(),
    profileSyncRecords: ApplicationProfileSyncRecordSchema.array(),
});
export type ApplicationAccountDataExportPayload =
    typeof ApplicationAccountDataExportPayloadSchema.infer;

export const ApplicationAccountDataExportSchema = type({
    schema: "'neonschedule1-account-data-export-1'",
    policy: ApplicationPolicyKeySchema,
    exportedAt: 'string',
    credentialData: "'excluded'",
    recoveryData: "'excluded'",
    integrity: {
        algorithm: "'sha256'",
        payloadSha256: ApplicationSha256Schema,
    },
    payload: ApplicationAccountDataExportPayloadSchema,
}).onDeepUndeclaredKey('reject');
export type ApplicationAccountDataExport = typeof ApplicationAccountDataExportSchema.infer;

export const PlannerObservationApplyStateFieldSchema = type("'mixingRuleProfile'")
    .or("'currentRank'")
    .or("'unlockedPersonIds'")
    .or("'relationships'")
    .or("'recommendedDealerIds'")
    .or("'recruitedDealerIds'")
    .or("'customers'")
    .or("'dealers'")
    .or("'availableCash'")
    .or("'gameMinute'")
    .or("'properties'")
    .or("'employees'");
export type PlannerObservationApplyStateField =
    typeof PlannerObservationApplyStateFieldSchema.infer;

const PlannerObservationApplyExistingInventorySchema = type({
    sourceOwner: PlannerInventoryOwnerSchema,
    target: {
        kind: "'existing'",
        documentId: 'string',
    },
});

const PlannerObservationApplyNewInventorySchema = type({
    sourceOwner: PlannerInventoryOwnerSchema,
    target: {
        kind: "'new'",
        documentId: 'string',
    },
});

export const PlannerObservationApplyInventorySchema =
    PlannerObservationApplyExistingInventorySchema.or(
        PlannerObservationApplyNewInventorySchema
    );
export type PlannerObservationApplyInventory =
    typeof PlannerObservationApplyInventorySchema.infer;

export const PlannerObservationApplyRequestSchema = type({
    schema: "'neonschedule1-planner-observation-apply-request-1'",
    policy: ApplicationPolicyKeySchema,
    requestId: 'string',
    requestedAt: 'string',
    profileId: 'string',
    compatibility: PlannerCompatibilitySchema,
    observationDocumentId: 'string',
    expectedProfileSha256: ApplicationSha256Schema,
    confirmation: "'user-reviewed'",
    stateFields: PlannerObservationApplyStateFieldSchema.array(),
    inventories: PlannerObservationApplyInventorySchema.array(),
    selectedValues: "'replace-without-coercion'",
    unselectedValues: "'preserve'",
    collectionCoverage: "'preserve-source-coverage'",
    conflict: "'reject-profile-content-mismatch'",
}).onDeepUndeclaredKey('reject');
export type PlannerObservationApplyRequest =
    typeof PlannerObservationApplyRequestSchema.infer;
