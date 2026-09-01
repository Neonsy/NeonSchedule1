import { createHash } from 'node:crypto';

import {
    applicationDataPolicy,
    applyPlannerObservation,
    canonicalJson,
    validateApplicationAccount,
    validateApplicationAccountDataExport,
    validateApplicationCommunityEntry,
    validateApplicationProfileExport,
    validateApplicationProfileSyncRecord,
    validateApplicationShareEnvelope,
    type ApplicationAccount,
    type ApplicationAccountDataExport,
    type ApplicationCommunityEntry,
    type ApplicationProfileExport,
    type ApplicationProfileSyncRecord,
    type ApplicationShareEnvelope,
    type PlannerDocumentMetadata,
    type PlannerObservationApplyRequest,
    type PlannerProfileBundle,
    type PlannerStateSnapshot,
} from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

const compatibility = {
    gameVersion: '0.4.6f13',
    datasetSha256: 'a'.repeat(64),
};
const createdAt = '2026-09-01T10:00:00.000Z';
const updatedAt = '2026-09-01T11:00:00.000Z';
const appliedAt = '2026-09-01T12:00:00.000Z';

describe('application-owned data contracts', () => {
    it('publishes local-first ownership, life-cycle, privacy, and size policies without teams', () => {
        expect(applicationDataPolicy).toMatchObject({
            profiles: {
                owner: 'local-user',
                sourceOfTruth: 'manual-state',
                synchronization: 'optional-explicit-account-sync',
                conflict: 'reject-base-content-mismatch',
            },
            exports: {
                import: 'as-new-or-explicit-replace',
                merge: 'never-automatic',
            },
            sharing: {
                content: 'recipe-or-blueprint-only',
                identifiers: 'opaque-public-keys',
                mutation: 'immutable-content-addressed-copy',
            },
            accounts: {
                credentials: 'never-stored-in-application-contracts',
                recovery: 'external-provider',
            },
            liveState: {
                access: 'read-only-observation',
                consent: 'explicit-user-reviewed-apply',
                gameWrites: 'forbidden',
            },
        });
        expect(canonicalJson(applicationDataPolicy)).not.toContain('teams');
        expect(applicationDataPolicy.forbiddenFields).toContain('teamId');
    });

    it('validates private full-profile and individual-document exports by canonical hash', () => {
        const fullPayload = { kind: 'full-profile' as const, profile: profile() };
        const fullExport: ApplicationProfileExport = {
            schema: 'neonschedule1-profile-export-1',
            policy: applicationDataPolicy.schema,
            exportId: 'export-main',
            exportedAt: updatedAt,
            encoding: 'canonical-json',
            privacy: 'private-user-data',
            integrity: { algorithm: 'sha256', payloadSha256: hash(fullPayload) },
            payload: fullPayload,
        };

        expect(validateApplicationProfileExport(fullExport, sha256).payload.kind)
            .toBe('full-profile');

        const inventory = profile().inventories[0]!;
        const documentPayload = {
            kind: 'individual-document' as const,
            profileId: 'profile-a',
            compatibility,
            value: { kind: 'inventory' as const, document: inventory },
        };
        const documentExport: ApplicationProfileExport = {
            ...fullExport,
            exportId: 'export-inventory',
            integrity: { algorithm: 'sha256', payloadSha256: hash(documentPayload) },
            payload: documentPayload,
        };
        expect(validateApplicationProfileExport(documentExport, sha256).payload.kind)
            .toBe('individual-document');

        expect(() => validateApplicationProfileExport({
            ...fullExport,
            integrity: { ...fullExport.integrity, payloadSha256: 'b'.repeat(64) },
        }, sha256)).toThrow('payload SHA-256 mismatch');

        expect(() => validateApplicationProfileExport({
            ...fullExport,
            payload: { ...fullPayload, rawSave: 'private' },
        }, sha256)).toThrow();
    });

    it('validates immutable recipe and blueprint shares through opaque public keys', () => {
        const recipe = recipeShare();
        expect(validateApplicationShareEnvelope(recipe, sha256).payload.kind).toBe('recipe');

        const blueprintPayload = {
            kind: 'blueprint' as const,
            title: 'Barn starter',
            propertyKey: publicKey('property', '1'),
            placements: [{
                id: 'placement-a',
                kind: 'grid' as const,
                itemKey: publicKey('item', '2'),
                gridKey: publicKey('grid', '3'),
                anchor: { x: 0, y: 1 },
                rotation: 90 as const,
            }],
            productionLogistics: {
                employees: [],
                supplies: [{
                    id: 'supply-a',
                    itemKey: publicKey('item', '4'),
                    sourcePlacementId: 'placement-a',
                    quantity: 1,
                }],
            },
        };
        const blueprint: ApplicationShareEnvelope = {
            schema: 'neonschedule1-share-1',
            policy: applicationDataPolicy.schema,
            createdAt,
            compatibility,
            encoding: 'canonical-json',
            integrity: { algorithm: 'sha256', payloadSha256: hash(blueprintPayload) },
            payload: blueprintPayload,
        };
        expect(validateApplicationShareEnvelope(blueprint, sha256).payload.kind)
            .toBe('blueprint');

        const privateIdentifier = recipeShare();
        privateIdentifier.payload = {
            ...privateIdentifier.payload,
            productKey: 'internal-product-id',
        };
        privateIdentifier.integrity.payloadSha256 = hash(privateIdentifier.payload);
        expect(() => validateApplicationShareEnvelope(privateIdentifier, sha256))
            .toThrow('opaque public key');

        const oversized = recipeShare();
        oversized.payload = {
            ...oversized.payload,
            ingredientKeys: Array.from(
                { length: 2_500 },
                (_, index) => publicKey('item', (index % 16).toString(16))
            ),
        };
        oversized.integrity.payloadSha256 = hash(oversized.payload);
        expect(() => validateApplicationShareEnvelope(oversized, sha256))
            .toThrow('payload exceeds');
    });

    it('validates account, community, optional sync, and complete account export ownership', () => {
        const account = activeAccount();
        expect(validateApplicationAccount(account).status).toBe('active');
        expect(() => validateApplicationAccount({ ...account, credentials: 'secret' }))
            .toThrow();
        expect(() => validateApplicationAccount({
            ...account,
            status: 'deleted',
        })).toThrow('must not retain a display name');

        const sync = profileSync();
        expect(validateApplicationProfileSyncRecord(sync, sha256).revision).toBe(1);

        const share = recipeShare();
        const entry = communityEntry(share);
        expect(validateApplicationCommunityEntry(entry, sha256).status).toBe('visible');
        expect(() => validateApplicationCommunityEntry({
            ...entry,
            duplicateOfEntryId: entry.entryId,
        }, sha256)).toThrow('cannot duplicate itself');

        const payload = {
            account,
            communityEntries: [entry],
            profileSyncRecords: [sync],
        };
        const accountExport: ApplicationAccountDataExport = {
            schema: 'neonschedule1-account-data-export-1',
            policy: applicationDataPolicy.schema,
            exportedAt: appliedAt,
            credentialData: 'excluded',
            recoveryData: 'excluded',
            integrity: { algorithm: 'sha256', payloadSha256: hash(payload) },
            payload,
        };
        expect(validateApplicationAccountDataExport(accountExport, sha256).payload.account.accountId)
            .toBe(account.accountId);

        const deleted: ApplicationCommunityEntry = {
            ...entry,
            authorAccountId: null,
            status: 'deleted',
            duplicateOfEntryId: null,
            share: null,
            reports: [],
            moderationActions: [],
        };
        expect(validateApplicationCommunityEntry(deleted, sha256).share).toBeNull();
    });

    it('applies only reviewed observation fields and inventories to an unchanged profile', () => {
        const bundle = profile();
        const request = applyRequest(bundle);

        const result = applyPlannerObservation(bundle, request, sha256);

        expect(result.manualState.state.availableCash).toEqual({ status: 'known', value: 500 });
        expect(result.manualState.state.currentRank).toEqual({
            status: 'known',
            value: { rank: 'Hoodlum', tier: 2 },
        });
        expect(result.manualState.state.relationships).toEqual({
            status: 'known',
            coverage: 'complete',
            values: [],
        });
        expect(result.inventories.map(({ metadata, inventory }) => [
            metadata.documentId,
            inventory.owner.kind,
            inventory.entries[0]?.currentQuantity,
        ])).toEqual([
            ['inventory-barn', 'property', { status: 'known', value: 8 }],
            ['inventory-player', 'player', { status: 'known', value: 3 }],
        ]);
        expect(result.observation).toBe(bundle.observation);
        expect(result.manifest.updatedAt).toBe(appliedAt);

        expect(() => applyPlannerObservation(bundle, {
            ...request,
            expectedProfileSha256: 'b'.repeat(64),
        }, sha256)).toThrow('changed after review');

        expect(() => applyPlannerObservation(bundle, {
            ...request,
            confirmation: 'automatic',
        }, sha256)).toThrow();
    });
});

function recipeShare(): ApplicationShareEnvelope & {
    payload: Extract<ApplicationShareEnvelope['payload'], { kind: 'recipe' }>;
} {
    const payload = {
        kind: 'recipe' as const,
        title: 'Starter mix',
        productKey: publicKey('item', '1'),
        ingredientKeys: [publicKey('item', '2')],
        ruleProfile: { kind: 'standard' as const },
    };
    return {
        schema: 'neonschedule1-share-1',
        policy: applicationDataPolicy.schema,
        createdAt,
        compatibility,
        encoding: 'canonical-json',
        integrity: { algorithm: 'sha256', payloadSha256: hash(payload) },
        payload,
    };
}

function activeAccount(): ApplicationAccount {
    return {
        schema: 'neonschedule1-account-1',
        policy: applicationDataPolicy.schema,
        accountId: 'account-a',
        displayName: 'Neon',
        createdAt,
        updatedAt,
        status: 'active',
        authentication: 'external-provider',
        credentialRetention: 'none',
        recovery: 'external-provider',
        communityPublishing: 'account-required',
        profileSynchronization: 'opt-in-explicit',
        deletion: 'remove-private-data-and-anonymize-retained-public-authorship',
    };
}

function profileSync(): ApplicationProfileSyncRecord {
    const bundle = profile();
    return {
        schema: 'neonschedule1-profile-sync-1',
        policy: applicationDataPolicy.schema,
        syncId: 'sync-a',
        accountId: 'account-a',
        profileId: bundle.manifest.profileId,
        revision: 1,
        updatedAt: appliedAt,
        compatibility,
        baseContentSha256: null,
        contentSha256: hash(bundle),
        sourceOfTruth: 'local-profile',
        upload: 'explicit',
        downloadApply: 'explicit',
        conflict: 'reject-base-content-mismatch',
        retention: 'until-explicit-remote-copy-deletion',
        deletion: 'delete-remote-copy',
        profile: bundle,
    };
}

function communityEntry(share: ApplicationShareEnvelope): ApplicationCommunityEntry {
    return {
        schema: 'neonschedule1-community-entry-1',
        policy: applicationDataPolicy.schema,
        entryId: 'entry-a',
        authorAccountId: 'account-a',
        createdAt,
        updatedAt,
        revision: 1,
        visibility: 'public',
        status: 'visible',
        contentSha256: share.integrity.payloadSha256,
        duplicateOfEntryId: null,
        share,
        reports: [],
        moderationActions: [],
        retention: 'until-author-deletion-or-moderation-removal',
        deletion: 'remove-content-retain-minimal-tombstone',
    };
}

function applyRequest(bundle: PlannerProfileBundle): PlannerObservationApplyRequest {
    return {
        schema: 'neonschedule1-planner-observation-apply-request-1',
        policy: applicationDataPolicy.schema,
        requestId: 'apply-a',
        requestedAt: appliedAt,
        profileId: bundle.manifest.profileId,
        compatibility,
        observationDocumentId: bundle.observation!.metadata.documentId,
        expectedProfileSha256: hash(bundle),
        confirmation: 'user-reviewed',
        stateFields: ['availableCash', 'currentRank'],
        inventories: [
            {
                sourceOwner: { kind: 'player', id: 'player' },
                target: { kind: 'new', documentId: 'inventory-player' },
            },
            {
                sourceOwner: { kind: 'property', id: 'barn' },
                target: { kind: 'existing', documentId: 'inventory-barn' },
            },
        ],
        selectedValues: 'replace-without-coercion',
        unselectedValues: 'preserve',
        collectionCoverage: 'preserve-source-coverage',
        conflict: 'reject-profile-content-mismatch',
    };
}

function profile(): PlannerProfileBundle {
    return {
        manifest: {
            schema: 'neonschedule1-planner-profile-1',
            profileId: 'profile-a',
            name: 'Main profile',
            createdAt,
            updatedAt,
            compatibility: { ...compatibility },
            documents: {
                manualStateDocumentId: 'manual-state',
                inventoryDocumentIds: ['inventory-barn'],
                checklistDocumentIds: [],
                blueprintDocumentIds: [],
                latestObservationDocumentId: 'observation-latest',
            },
            ownership: 'local-user',
            sourceOfTruth: 'manual-state-with-explicit-observation-apply',
            observationRetention: 'latest-only',
            rawSaveRetention: 'none',
            incompatibleDocumentBehavior: 'reject-without-explicit-migration',
            exportScope: 'individual-documents-or-full-profile',
            deletionScope: 'optional-documents-or-full-profile',
        },
        manualState: {
            schema: 'neonschedule1-planner-manual-state-1',
            metadata: metadata('manual-state'),
            source: 'manual',
            state: manualState(),
        },
        inventories: [{
            schema: 'neonschedule1-planner-inventory-1',
            metadata: metadata('inventory-barn'),
            inventory: inventory('property', 'barn', 1),
        }],
        checklists: [],
        blueprints: [],
        observation: {
            schema: 'neonschedule1-planner-observation-1',
            metadata: metadata('observation-latest'),
            source: {
                kind: 'save',
                observedAt: updatedAt,
                connectorVersion: '0.0.33',
                access: 'read-only',
                rawPayloadRetention: 'none',
            },
            state: observedState(),
            inventories: [
                inventory('property', 'barn', 8),
                inventory('player', 'player', 3),
            ],
        },
    };
}

function metadata(documentId: string): PlannerDocumentMetadata {
    return {
        documentId,
        profileId: 'profile-a',
        createdAt,
        updatedAt,
        compatibility: { ...compatibility },
    };
}

function inventory(kind: 'player' | 'property', id: string, quantity: number) {
    return {
        owner: { kind, id },
        coverage: 'complete' as const,
        entries: [{
            itemId: 'cuke',
            currentQuantity: { status: 'known' as const, value: quantity },
            currentStackCount: { status: 'unknown' as const },
        }],
    };
}

function manualState(): PlannerStateSnapshot {
    return {
        ...unknownState(),
        relationships: { status: 'known', coverage: 'complete', values: [] },
        availableCash: { status: 'known', value: 0 },
    };
}

function observedState(): PlannerStateSnapshot {
    return {
        ...unknownState(),
        currentRank: { status: 'known', value: { rank: 'Hoodlum', tier: 2 } },
        availableCash: { status: 'known', value: 500 },
    };
}

function unknownState(): PlannerStateSnapshot {
    return {
        mixingRuleProfile: { status: 'unknown' },
        currentRank: { status: 'unknown' },
        unlockedPersonIds: { status: 'unknown' },
        relationships: { status: 'unknown' },
        recommendedDealerIds: { status: 'unknown' },
        recruitedDealerIds: { status: 'unknown' },
        customers: { status: 'unknown' },
        dealers: { status: 'unknown' },
        availableCash: { status: 'unknown' },
        gameMinute: { status: 'unknown' },
        properties: { status: 'unknown' },
        employees: { status: 'unknown' },
    };
}

function publicKey(namespace: string, character: string): string {
    return `${namespace}-${character.repeat(20)}`;
}

function hash(value: unknown): string {
    return sha256(canonicalJson(value));
}

function sha256(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
}
