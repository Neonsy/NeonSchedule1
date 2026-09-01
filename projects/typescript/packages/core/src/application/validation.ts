import {
    ApplicationAccountDataExportSchema,
    ApplicationAccountSchema,
    ApplicationCommunityEntrySchema,
    ApplicationDataPolicySchema,
    ApplicationProfileExportSchema,
    ApplicationProfileSyncRecordSchema,
    ApplicationShareEnvelopeSchema,
    PlannerObservationApplyRequestSchema,
    type ApplicationAccount,
    type ApplicationAccountDataExport,
    type ApplicationCommunityEntry,
    type ApplicationDataPolicy,
    type ApplicationExportDocumentPayload,
    type ApplicationProfileExport,
    type ApplicationProfileSyncRecord,
    type ApplicationShareEnvelope,
    type ApplicationSharePayload,
    type PlannerObservationApplyRequest,
    type PlannerObservationApplyStateField,
} from '#core/data/application';
import { canonicalJson } from '#core/data/canonical-json';
import { normalizeMixingRuleProfile } from '#core/data/mixing';
import {
    type PlannerCompatibility,
    type PlannerInventoryDocument,
    type PlannerInventoryOwner,
    type PlannerProfileBundle,
    type PlannerStateSnapshot,
} from '#core/data/planner-profile';
import {
    validatePlannerBlueprintDocument,
    validatePlannerChecklistDocument,
    validatePlannerInventoryDocument,
    validatePlannerManualStateDocument,
    validatePlannerObservationDocument,
    validatePlannerProfileBundle,
} from '#core/planner-profile/validation';

export type ApplicationSha256 = (canonicalContent: string) => string;

export const applicationDataPolicy: ApplicationDataPolicy =
    ApplicationDataPolicySchema.assert({
        schema: 'neonschedule1-application-data-policy-1',
        profiles: {
            owner: 'local-user',
            sourceOfTruth: 'manual-state',
            persistence: 'application-adapter',
            synchronization: 'optional-explicit-account-sync',
            conflict: 'reject-base-content-mismatch',
            retention: 'until-explicit-profile-deletion',
            deletion: 'optional-documents-or-full-profile',
            migration: 'reject-until-explicit-migration',
        },
        exports: {
            owner: 'local-user',
            access: 'private-holder-controlled',
            snapshot: 'validated-profile-or-document',
            encoding: 'canonical-json',
            import: 'as-new-or-explicit-replace',
            merge: 'never-automatic',
            retention: 'until-holder-deletes-copy',
            deletion: 'delete-held-copy',
        },
        sharing: {
            owner: 'creator',
            access: 'holder-controlled-copy',
            content: 'recipe-or-blueprint-only',
            identifiers: 'opaque-public-keys',
            encoding: 'canonical-json',
            compatibility: 'matching-game-and-dataset-required',
            mutation: 'immutable-content-addressed-copy',
            revocation: 'not-supported-after-copy',
            retention: 'until-holder-deletes-copy',
            deletion: 'delete-held-copy',
        },
        community: {
            owner: 'submitting-account',
            visibility: 'public-or-unlisted',
            authorship: 'account-or-anonymized-after-account-deletion',
            deduplication: 'canonical-content-sha256',
            moderation: 'report-and-action-history',
            retention: 'until-author-deletion-or-moderation-removal',
            deletion: 'remove-content-retain-minimal-tombstone',
        },
        accounts: {
            identity: 'opaque-account-id',
            authentication: 'external-provider',
            credentials: 'never-stored-in-application-contracts',
            recovery: 'external-provider',
            authorization: 'account-owns-community-and-sync-records',
            retention: 'until-explicit-account-deletion',
            deletion: 'remove-private-data-and-anonymize-retained-public-authorship',
            export: 'account-community-and-sync-records',
        },
        liveState: {
            access: 'read-only-observation',
            consent: 'explicit-user-reviewed-apply',
            target: 'manual-profile-documents-only',
            staleState: 'reject-profile-content-mismatch',
            selectedValues: 'replace-without-coercion',
            unselectedValues: 'preserve',
            collectionCoverage: 'preserve-source-coverage',
            retry: 'new-request-after-conflict',
            gameWrites: 'forbidden',
        },
        limits: {
            recipeShareBytes: 65_536,
            blueprintShareBytes: 1_048_576,
            profileExportBytes: 33_554_432,
            accountExportBytes: 67_108_864,
            displayNameCharacters: 80,
            communityReportCount: 500,
            communityModerationActionCount: 500,
        },
        forbiddenFields: [
            'credentials',
            'machinePath',
            'organizationName',
            'playerName',
            'rawPayload',
            'rawSave',
            'recoverySecret',
            'steamId',
            'teamId',
        ],
    });

export function validateApplicationProfileExport(
    input: unknown,
    sha256: ApplicationSha256
): ApplicationProfileExport {
    const envelope = ApplicationProfileExportSchema.assert(input);
    requireId(envelope.exportId, 'Profile export ID');
    validateTimestamp(envelope.exportedAt, 'Profile export timestamp');
    if (envelope.payload.kind === 'full-profile') {
        const profile = validatePlannerProfileBundle(envelope.payload.profile);
        if (envelope.exportedAt < profile.manifest.updatedAt) {
            throw new Error('Profile export timestamp precedes the exported profile');
        }
    } else {
        requireId(envelope.payload.profileId, 'Profile export profile ID');
        validateCompatibility(envelope.payload.compatibility, 'Profile export');
        validateExportDocument(envelope.payload.value);
        const metadata = envelope.payload.value.document.metadata;
        if (metadata.profileId !== envelope.payload.profileId) {
            throw new Error('Exported document belongs to a different profile');
        }
        if (!sameCompatibility(metadata.compatibility, envelope.payload.compatibility)) {
            throw new Error('Exported document has incompatible game data');
        }
        if (envelope.exportedAt < metadata.updatedAt) {
            throw new Error('Profile export timestamp precedes the exported document');
        }
    }
    verifyPayload(
        envelope.payload,
        envelope.integrity.payloadSha256,
        applicationDataPolicy.limits.profileExportBytes,
        'Profile export',
        sha256
    );
    return envelope;
}

export function validateApplicationShareEnvelope(
    input: unknown,
    sha256: ApplicationSha256
): ApplicationShareEnvelope {
    const envelope = ApplicationShareEnvelopeSchema.assert(input);
    validateTimestamp(envelope.createdAt, 'Share timestamp');
    validateCompatibility(envelope.compatibility, 'Share');
    validateSharePayload(envelope.payload);
    verifyPayload(
        envelope.payload,
        envelope.integrity.payloadSha256,
        envelope.payload.kind === 'recipe'
            ? applicationDataPolicy.limits.recipeShareBytes
            : applicationDataPolicy.limits.blueprintShareBytes,
        `${envelope.payload.kind === 'recipe' ? 'Recipe' : 'Blueprint'} share`,
        sha256
    );
    return envelope;
}

export function validateApplicationAccount(input: unknown): ApplicationAccount {
    const account = ApplicationAccountSchema.assert(input);
    requireId(account.accountId, 'Account ID');
    validateTimestamp(account.createdAt, 'Account createdAt');
    validateTimestamp(account.updatedAt, 'Account updatedAt');
    requireChronology(account.createdAt, account.updatedAt, 'Account');
    if (account.status === 'deleted') {
        if (account.displayName !== null) {
            throw new Error('Deleted account must not retain a display name');
        }
    } else {
        requireDisplayName(account.displayName, 'Account display name');
    }
    return account;
}

export function validateApplicationProfileSyncRecord(
    input: unknown,
    sha256: ApplicationSha256
): ApplicationProfileSyncRecord {
    const record = ApplicationProfileSyncRecordSchema.assert(input);
    requireId(record.syncId, 'Profile sync ID');
    requireId(record.accountId, 'Profile sync account ID');
    requireId(record.profileId, 'Profile sync profile ID');
    requirePositiveSafeInteger(record.revision, 'Profile sync revision');
    validateTimestamp(record.updatedAt, 'Profile sync timestamp');
    validateCompatibility(record.compatibility, 'Profile sync');
    const profile = validatePlannerProfileBundle(record.profile);
    if (profile.manifest.profileId !== record.profileId) {
        throw new Error('Profile sync record contains a different profile');
    }
    if (!sameCompatibility(profile.manifest.compatibility, record.compatibility)) {
        throw new Error('Profile sync record has incompatible game data');
    }
    if (record.updatedAt < profile.manifest.updatedAt) {
        throw new Error('Profile sync timestamp precedes the profile update');
    }
    verifyPayload(
        record.profile,
        record.contentSha256,
        applicationDataPolicy.limits.profileExportBytes,
        'Profile sync',
        sha256
    );
    return record;
}

export function validateApplicationCommunityEntry(
    input: unknown,
    sha256: ApplicationSha256
): ApplicationCommunityEntry {
    const entry = ApplicationCommunityEntrySchema.assert(input);
    requireId(entry.entryId, 'Community entry ID');
    if (entry.authorAccountId !== null) {
        requireId(entry.authorAccountId, 'Community author account ID');
    }
    validateTimestamp(entry.createdAt, 'Community entry createdAt');
    validateTimestamp(entry.updatedAt, 'Community entry updatedAt');
    requireChronology(entry.createdAt, entry.updatedAt, 'Community entry');
    requirePositiveSafeInteger(entry.revision, 'Community entry revision');
    if (entry.duplicateOfEntryId !== null) {
        requireId(entry.duplicateOfEntryId, 'Duplicate community entry ID');
        if (entry.duplicateOfEntryId === entry.entryId) {
            throw new Error('Community entry cannot duplicate itself');
        }
    }
    if (entry.status === 'deleted') {
        if (
            entry.authorAccountId !== null ||
            entry.share !== null ||
            entry.duplicateOfEntryId !== null ||
            entry.reports.length > 0 ||
            entry.moderationActions.length > 0
        ) {
            throw new Error('Deleted community entry must be a minimal anonymized tombstone');
        }
    } else {
        if (entry.share === null) {
            throw new Error('Active community entry must retain its shared content');
        }
        const share = validateApplicationShareEnvelope(entry.share, sha256);
        if (share.createdAt > entry.createdAt) {
            throw new Error('Community entry predates its shared content');
        }
        if (share.integrity.payloadSha256 !== entry.contentSha256) {
            throw new Error('Community entry content identity differs from its share');
        }
    }
    if (entry.reports.length > applicationDataPolicy.limits.communityReportCount) {
        throw new RangeError('Community entry exceeds the report retention limit');
    }
    if (
        entry.moderationActions.length >
        applicationDataPolicy.limits.communityModerationActionCount
    ) {
        throw new RangeError('Community entry exceeds the moderation action retention limit');
    }
    validateOrderedEvents(
        entry.reports,
        ({ reportId }) => reportId,
        ({ reporterAccountId }) => reporterAccountId,
        'Community report'
    );
    validateOrderedEvents(
        entry.moderationActions,
        ({ actionId }) => actionId,
        ({ actorAccountId }) => actorAccountId,
        'Community moderation action'
    );
    for (const action of entry.moderationActions) {
        requireNonBlank(action.reason, 'Community moderation reason');
    }
    for (const event of [...entry.reports, ...entry.moderationActions]) {
        if (event.createdAt < entry.createdAt || event.createdAt > entry.updatedAt) {
            throw new Error('Community event falls outside its entry life cycle');
        }
    }
    return entry;
}

export function validateApplicationAccountDataExport(
    input: unknown,
    sha256: ApplicationSha256
): ApplicationAccountDataExport {
    const envelope = ApplicationAccountDataExportSchema.assert(input);
    validateTimestamp(envelope.exportedAt, 'Account export timestamp');
    const account = validateApplicationAccount(envelope.payload.account);
    if (envelope.exportedAt < account.updatedAt) {
        throw new Error('Account export timestamp precedes the account update');
    }
    requireUnique(
        envelope.payload.communityEntries,
        ({ entryId }) => entryId,
        'Account export community entry IDs'
    );
    for (const entryInput of envelope.payload.communityEntries) {
        const entry = validateApplicationCommunityEntry(entryInput, sha256);
        if (envelope.exportedAt < entry.updatedAt) {
            throw new Error('Account export timestamp precedes a community entry update');
        }
        if (entry.authorAccountId !== null && entry.authorAccountId !== account.accountId) {
            throw new Error('Account export contains community content owned by another account');
        }
    }
    requireUnique(
        envelope.payload.profileSyncRecords,
        ({ syncId }) => syncId,
        'Account export profile sync IDs'
    );
    for (const recordInput of envelope.payload.profileSyncRecords) {
        const record = validateApplicationProfileSyncRecord(recordInput, sha256);
        if (envelope.exportedAt < record.updatedAt) {
            throw new Error('Account export timestamp precedes a profile sync update');
        }
        if (record.accountId !== account.accountId) {
            throw new Error('Account export contains a profile sync owned by another account');
        }
    }
    verifyPayload(
        envelope.payload,
        envelope.integrity.payloadSha256,
        applicationDataPolicy.limits.accountExportBytes,
        'Account export',
        sha256
    );
    return envelope;
}

export function applyPlannerObservation(
    bundleInput: unknown,
    requestInput: unknown,
    sha256: ApplicationSha256
): PlannerProfileBundle {
    const bundle = validatePlannerProfileBundle(bundleInput);
    const request = validateObservationApplyRequest(bundle, requestInput, sha256);
    const observation = bundle.observation!;
    let state = bundle.manualState.state;
    for (const field of request.stateFields) {
        state = replaceStateField(state, observation.state, field);
    }
    const inventoryByDocumentId = new Map(
        bundle.inventories.map((document) => [document.metadata.documentId, document])
    );
    const observationInventoryByOwner = new Map(
        observation.inventories.map((inventory) => [ownerKey(inventory.owner), inventory])
    );
    for (const selection of request.inventories) {
        const source = observationInventoryByOwner.get(ownerKey(selection.sourceOwner))!;
        const existing = inventoryByDocumentId.get(selection.target.documentId);
        const metadata = existing === undefined
            ? {
                documentId: selection.target.documentId,
                profileId: bundle.manifest.profileId,
                createdAt: request.requestedAt,
                updatedAt: request.requestedAt,
                compatibility: { ...bundle.manifest.compatibility },
            }
            : {
                ...existing.metadata,
                updatedAt: request.requestedAt,
            };
        inventoryByDocumentId.set(selection.target.documentId, {
            schema: 'neonschedule1-planner-inventory-1',
            metadata,
            inventory: source,
        });
    }
    const inventories = [...inventoryByDocumentId.values()]
        .sort((left, right) => left.metadata.documentId.localeCompare(right.metadata.documentId));
    const result: PlannerProfileBundle = {
        manifest: {
            ...bundle.manifest,
            updatedAt: request.requestedAt,
            documents: {
                ...bundle.manifest.documents,
                inventoryDocumentIds: inventories.map(({ metadata }) => metadata.documentId),
            },
        },
        manualState: request.stateFields.length === 0
            ? bundle.manualState
            : {
                ...bundle.manualState,
                metadata: {
                    ...bundle.manualState.metadata,
                    updatedAt: request.requestedAt,
                },
                state,
            },
        inventories,
        checklists: bundle.checklists,
        blueprints: bundle.blueprints,
        observation,
    };
    return validatePlannerProfileBundle(result);
}

function validateObservationApplyRequest(
    bundle: PlannerProfileBundle,
    input: unknown,
    sha256: ApplicationSha256
): PlannerObservationApplyRequest {
    const request = PlannerObservationApplyRequestSchema.assert(input);
    requireId(request.requestId, 'Observation apply request ID');
    requireId(request.profileId, 'Observation apply profile ID');
    requireId(request.observationDocumentId, 'Observation apply document ID');
    validateTimestamp(request.requestedAt, 'Observation apply timestamp');
    validateCompatibility(request.compatibility, 'Observation apply');
    if (bundle.observation === null) {
        throw new Error('Observation apply requires a latest observation');
    }
    if (request.profileId !== bundle.manifest.profileId) {
        throw new Error('Observation apply targets a different profile');
    }
    if (!sameCompatibility(request.compatibility, bundle.manifest.compatibility)) {
        throw new Error('Observation apply has incompatible game data');
    }
    if (request.observationDocumentId !== bundle.observation.metadata.documentId) {
        throw new Error('Observation apply targets a stale observation');
    }
    if (
        request.requestedAt < bundle.manifest.updatedAt ||
        request.requestedAt < bundle.observation.source.observedAt
    ) {
        throw new Error('Observation apply timestamp precedes its source data');
    }
    const actualProfileSha256 = checkedSha256(sha256(canonicalJson(bundle)), 'Profile content');
    if (request.expectedProfileSha256 !== actualProfileSha256) {
        throw new Error('Observation apply profile content changed after review');
    }
    if (request.stateFields.length === 0 && request.inventories.length === 0) {
        throw new Error('Observation apply must select at least one value');
    }
    requireCanonicalStrings(request.stateFields, 'Observation apply state fields');
    requireCanonicalEntries(
        request.inventories,
        ({ sourceOwner }) => ownerKey(sourceOwner),
        'Observation apply inventory owners'
    );
    requireUnique(
        request.inventories,
        ({ target }) => target.documentId,
        'Observation apply target document IDs'
    );
    const inventoryByDocumentId = new Map(
        bundle.inventories.map((document) => [document.metadata.documentId, document])
    );
    const observationOwners = new Set(
        bundle.observation.inventories.map(({ owner }) => ownerKey(owner))
    );
    for (const selection of request.inventories) {
        requireId(selection.target.documentId, 'Observation apply inventory document ID');
        if (!observationOwners.has(ownerKey(selection.sourceOwner))) {
            throw new Error('Observation apply references an unavailable observation inventory');
        }
        const existing = inventoryByDocumentId.get(selection.target.documentId);
        if (selection.target.kind === 'new') {
            if (existing !== undefined) {
                throw new Error('Observation apply new inventory document already exists');
            }
        } else {
            if (existing === undefined) {
                throw new Error('Observation apply existing inventory document is unavailable');
            }
            if (ownerKey(existing.inventory.owner) !== ownerKey(selection.sourceOwner)) {
                throw new Error('Observation apply cannot replace a different inventory owner');
            }
        }
    }
    return request;
}

function validateExportDocument(payload: ApplicationExportDocumentPayload): void {
    switch (payload.kind) {
        case 'manual-state': validatePlannerManualStateDocument(payload.document); break;
        case 'inventory': validatePlannerInventoryDocument(payload.document); break;
        case 'checklist': validatePlannerChecklistDocument(payload.document); break;
        case 'blueprint': validatePlannerBlueprintDocument(payload.document); break;
        case 'observation': validatePlannerObservationDocument(payload.document); break;
    }
}

function validateSharePayload(payload: ApplicationSharePayload): void {
    requireDisplayName(payload.title, 'Share title', 120);
    if (payload.kind === 'recipe') {
        requirePublicKey(payload.productKey, 'Shared recipe product key');
        payload.ingredientKeys.forEach((key, index) => {
            requirePublicKey(key, `Shared recipe ingredient key at index ${index}`);
        });
        normalizeMixingRuleProfile(payload.ruleProfile);
        return;
    }
    requirePublicKey(payload.propertyKey, 'Shared blueprint property key');
    const placementIds = new Set<string>();
    for (const [index, placement] of payload.placements.entries()) {
        requireId(placement.id, `Shared blueprint placement ID at index ${index}`);
        if (placementIds.has(placement.id)) {
            throw new Error(`Shared blueprint contains duplicate placement ID ${placement.id}`);
        }
        placementIds.add(placement.id);
        requirePublicKey(placement.itemKey, `Shared blueprint item key at index ${index}`);
        if (placement.kind === 'grid') {
            requirePublicKey(placement.gridKey, `Shared blueprint grid key at index ${index}`);
            requireSafeInteger(placement.anchor.x, `Shared blueprint anchor X at index ${index}`);
            requireSafeInteger(placement.anchor.y, `Shared blueprint anchor Y at index ${index}`);
        } else if (placement.kind === 'surface') {
            requirePublicKey(placement.surfaceKey, `Shared blueprint surface key at index ${index}`);
            requirePublicKey(
                placement.surfaceColliderKey,
                `Shared blueprint surface collider key at index ${index}`
            );
            requireFiniteValues(
                Object.values(placement.relativeHitPoint),
                `Shared blueprint hit point at index ${index}`
            );
            requireFiniteValues(
                Object.values(placement.relativePosition),
                `Shared blueprint position at index ${index}`
            );
            const rotation = Object.values(placement.relativeRotation);
            requireFiniteValues(rotation, `Shared blueprint rotation at index ${index}`);
            if (Math.abs(Math.hypot(...rotation) - 1) > 1e-4) {
                throw new RangeError(`Shared blueprint rotation at index ${index} is not normalized`);
            }
        } else {
            if (placement.parentPlacementId !== null) {
                requireId(
                    placement.parentPlacementId,
                    `Shared blueprint parent placement ID at index ${index}`
                );
            }
            requireUnique(
                placement.tiles,
                ({ x, y }) => `${x},${y}`,
                `Shared blueprint procedural coordinates for ${placement.id}`
            );
            requireUnique(
                placement.tiles,
                ({ tileKey }) => tileKey,
                `Shared blueprint procedural tile keys for ${placement.id}`
            );
            for (const tile of placement.tiles) {
                requireSafeInteger(tile.x, `Shared blueprint tile X for ${placement.id}`);
                requireSafeInteger(tile.y, `Shared blueprint tile Y for ${placement.id}`);
                requirePublicKey(tile.tileKey, `Shared blueprint tile key for ${placement.id}`);
            }
        }
    }
    for (const placement of payload.placements) {
        if (
            placement.kind === 'procedural-grid' &&
            placement.parentPlacementId !== null &&
            !placementIds.has(placement.parentPlacementId)
        ) {
            throw new Error(`Shared blueprint placement ${placement.id} has an unknown parent`);
        }
    }
    validateNoParentCycles(payload);
    validateSharedLogistics(payload, placementIds);
}

function validateSharedLogistics(
    payload: Extract<ApplicationSharePayload, { readonly kind: 'blueprint' }>,
    placementIds: ReadonlySet<string>
): void {
    requireUnique(
        payload.productionLogistics.employees,
        ({ id }) => id,
        'Shared blueprint employee IDs'
    );
    for (const employee of payload.productionLogistics.employees) {
        requireId(employee.id, 'Shared blueprint employee ID');
        const assignments = employee.employeeType === 'Botanist'
            ? employee.assignedPotPlacementIds
            : employee.employeeType === 'Cleaner'
                ? employee.assignedBinPlacementIds
                : employee.assignedStationPlacementIds;
        requireUnique(assignments, (value) => value, `Shared blueprint ${employee.id} assignments`);
        assignments.forEach((id) => requirePlacementReference(id, placementIds));
        if (employee.employeeType === 'Botanist' && employee.supplyPlacementId !== null) {
            requirePlacementReference(employee.supplyPlacementId, placementIds);
        }
        if (employee.employeeType !== 'Handler') continue;
        requireUnique(
            employee.handlerRoutes,
            ({ id }) => id,
            `Shared blueprint ${employee.id} route IDs`
        );
        for (const route of employee.handlerRoutes) {
            requireId(route.id, 'Shared blueprint route ID');
            requirePlacementReference(route.sourcePlacementId, placementIds);
            requirePlacementReference(route.destinationPlacementId, placementIds);
            route.filter.itemKeys.forEach((key) => {
                requirePublicKey(key, 'Shared blueprint route filter item key');
            });
        }
    }
    requireUnique(
        payload.productionLogistics.supplies,
        ({ id }) => id,
        'Shared blueprint supply IDs'
    );
    for (const supply of payload.productionLogistics.supplies) {
        requireId(supply.id, 'Shared blueprint supply ID');
        requirePublicKey(supply.itemKey, 'Shared blueprint supply item key');
        requirePlacementReference(supply.sourcePlacementId, placementIds);
        requirePositiveSafeInteger(supply.quantity, 'Shared blueprint supply quantity');
    }
}

function validateNoParentCycles(
    payload: Extract<ApplicationSharePayload, { readonly kind: 'blueprint' }>
): void {
    const parentByPlacementId = new Map(payload.placements.flatMap((placement) =>
        placement.kind === 'procedural-grid' && placement.parentPlacementId !== null
            ? [[placement.id, placement.parentPlacementId] as const]
            : []
    ));
    for (const placementId of parentByPlacementId.keys()) {
        const visited = new Set<string>();
        let current: string | undefined = placementId;
        while (current !== undefined) {
            if (visited.has(current)) {
                throw new Error('Shared blueprint contains a procedural parent cycle');
            }
            visited.add(current);
            current = parentByPlacementId.get(current);
        }
    }
}

function validateOrderedEvents<T extends { readonly createdAt: string }>(
    values: readonly T[],
    id: (value: T) => string,
    accountId: (value: T) => string,
    label: string
): void {
    requireUnique(values, id, `${label} IDs`);
    requireCanonicalEntries(values, (value) => {
        const valueId = id(value);
        requireId(valueId, `${label} ID`);
        requireId(accountId(value), `${label} account ID`);
        validateTimestamp(value.createdAt, `${label} timestamp`);
        return `${value.createdAt}\0${valueId}`;
    }, `${label} order`);
}

function replaceStateField<K extends PlannerObservationApplyStateField>(
    target: PlannerStateSnapshot,
    source: PlannerStateSnapshot,
    field: K
): PlannerStateSnapshot {
    return { ...target, [field]: source[field] };
}

function verifyPayload(
    payload: unknown,
    expectedSha256: string,
    maximumBytes: number,
    label: string,
    sha256: ApplicationSha256
): void {
    const content = canonicalJson(payload);
    const bytes = utf8ByteLength(content);
    if (bytes > maximumBytes) {
        throw new RangeError(`${label} payload exceeds ${maximumBytes} bytes`);
    }
    const actualSha256 = checkedSha256(sha256(content), `${label} payload`);
    if (expectedSha256 !== actualSha256) {
        throw new Error(`${label} payload SHA-256 mismatch`);
    }
}

function utf8ByteLength(value: string): number {
    let bytes = 0;
    for (const character of value) {
        const codePoint = character.codePointAt(0)!;
        bytes += codePoint <= 0x7f
            ? 1
            : codePoint <= 0x7ff
                ? 2
                : codePoint <= 0xffff
                    ? 3
                    : 4;
    }
    return bytes;
}

function checkedSha256(value: string, label: string): string {
    if (!/^[a-f0-9]{64}$/u.test(value)) {
        throw new TypeError(`${label} hash adapter returned an invalid SHA-256`);
    }
    return value;
}

function validateCompatibility(value: PlannerCompatibility, label: string): void {
    requireNonBlank(value.gameVersion, `${label} game version`);
    if (!/^[a-f0-9]{64}$/u.test(value.datasetSha256)) {
        throw new TypeError(`${label} dataset identity must be a lowercase SHA-256`);
    }
}

function sameCompatibility(left: PlannerCompatibility, right: PlannerCompatibility): boolean {
    return left.gameVersion === right.gameVersion &&
        left.datasetSha256 === right.datasetSha256;
}

function ownerKey(owner: PlannerInventoryOwner): string {
    requireId(owner.id, 'Inventory owner ID');
    return `${owner.kind}\0${owner.id}`;
}

function requirePlacementReference(value: string, placementIds: ReadonlySet<string>): void {
    requireId(value, 'Shared blueprint placement reference');
    if (!placementIds.has(value)) {
        throw new Error(`Shared blueprint references unknown placement ${value}`);
    }
}

function requirePublicKey(value: string, label: string): void {
    if (!/^[a-z][a-z0-9-]*-[a-f0-9]{20}$/u.test(value)) {
        throw new TypeError(`${label} must be an opaque public key`);
    }
}

function requireDisplayName(value: string | null, label: string, maximum?: number): void {
    if (value === null) throw new TypeError(`${label} must not be null`);
    requireNonBlank(value, label);
    const limit = maximum ?? applicationDataPolicy.limits.displayNameCharacters;
    if ([...value].length > limit) {
        throw new RangeError(`${label} exceeds ${limit} characters`);
    }
}

function requireId(value: string, label: string): void {
    requireNonBlank(value, label);
    if (value.includes('\0')) throw new TypeError(`${label} must not contain a null character`);
}

function requireNonBlank(value: string, label: string): void {
    if (value.trim().length === 0) throw new TypeError(`${label} must not be blank`);
}

function validateTimestamp(value: string, label: string): void {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
        throw new TypeError(`${label} must be a canonical UTC timestamp`);
    }
}

function requireChronology(createdAt: string, updatedAt: string, label: string): void {
    if (updatedAt < createdAt) throw new RangeError(`${label} updatedAt precedes createdAt`);
}

function requirePositiveSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${label} must be a positive safe integer`);
    }
}

function requireSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`);
}

function requireFiniteValues(values: readonly number[], label: string): void {
    if (!values.every(Number.isFinite)) throw new RangeError(`${label} must be finite`);
}

function requireCanonicalStrings(values: readonly string[], label: string): void {
    requireCanonicalEntries(values, (value) => value, label);
}

function requireCanonicalEntries<T>(
    values: readonly T[],
    key: (value: T, index: number) => string,
    label: string
): void {
    let previous: string | null = null;
    values.forEach((value, index) => {
        const current = key(value, index);
        if (previous !== null && previous >= current) {
            throw new Error(`${label} must be sorted and unique`);
        }
        previous = current;
    });
}

function requireUnique<T>(
    values: readonly T[],
    key: (value: T, index: number) => string,
    label: string
): void {
    const seen = new Set<string>();
    values.forEach((value, index) => {
        const current = key(value, index);
        if (seen.has(current)) {
            throw new Error(`${label} contain duplicate ${JSON.stringify(current)}`);
        }
        seen.add(current);
    });
}
