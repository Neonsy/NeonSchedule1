import {
    validatePlannerProfileBundle,
    validatePlannerProfileBundleForDataset,
    type PlannerDocumentMetadata,
    type PlannerProfileBundle,
    type PlannerStateSnapshot,
} from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

const compatibility = {
    gameVersion: '0.4.6f13',
    datasetSha256: 'a'.repeat(64),
};
const createdAt = '2026-08-28T18:00:00.000Z';
const updatedAt = '2026-08-28T19:00:00.000Z';

describe('planner profile storage contract', () => {
    it('validates separate owned documents without collapsing unknown and known-empty state', () => {
        const result = validatePlannerProfileBundle(bundle());

        expect(result.manifest).toMatchObject({
            ownership: 'local-user',
            sourceOfTruth: 'manual-state-with-explicit-observation-apply',
            observationRetention: 'latest-only',
            rawSaveRetention: 'none',
            incompatibleDocumentBehavior: 'reject-without-explicit-migration',
            exportScope: 'individual-documents-or-full-profile',
            deletionScope: 'optional-documents-or-full-profile',
        });
        expect(result.manualState.state).toMatchObject({
            currentRank: { status: 'unknown' },
            unlockedPersonIds: { status: 'known', coverage: 'complete', values: [] },
            availableCash: { status: 'known', value: 0 },
            customers: {
                status: 'known',
                coverage: 'partial',
                values: [{
                    customerId: 'customer-a',
                    addiction: { status: 'known', value: 0 },
                    drugAffinities: { status: 'unknown' },
                }],
            },
            dealers: {
                status: 'known',
                coverage: 'partial',
                values: [{
                    personId: 'dealer-a',
                    signingFeePaid: { status: 'known', value: false },
                }],
            },
            properties: {
                status: 'known',
                coverage: 'partial',
                values: [{
                    propertyCode: 'barn',
                    owned: { status: 'known', value: true },
                    placements: { status: 'unknown' },
                }],
            },
        });
        expect(result.observation).toMatchObject({
            source: {
                kind: 'save',
                access: 'read-only',
                rawPayloadRetention: 'none',
            },
        });
    });

    it('rejects missing or unreferenced documents instead of creating implicit state', () => {
        const input = bundle();
        input.inventories = [];

        expect(() => validatePlannerProfileBundle(input)).toThrow(
            'Planner profile inventory documents differ from its manifest references'
        );

        const unreferenced = bundle();
        unreferenced.checklists.push({
            ...unreferenced.checklists[0]!,
            metadata: metadata('checklist-extra'),
        });
        expect(() => validatePlannerProfileBundle(unreferenced)).toThrow(
            'Planner profile checklist documents differ from its manifest references'
        );
    });

    it('rejects incompatible documents, blueprint payloads, and loaded datasets', () => {
        const documentMismatch = bundle();
        documentMismatch.inventories[0]!.metadata.compatibility.datasetSha256 = 'b'.repeat(64);
        expect(() => validatePlannerProfileBundle(documentMismatch)).toThrow(
            'has incompatible game data'
        );

        const blueprintMismatch = bundle();
        blueprintMismatch.blueprints[0]!.blueprint.datasetSha256 = 'b'.repeat(64);
        expect(() => validatePlannerProfileBundle(blueprintMismatch)).toThrow(
            'Blueprint document compatibility differs from its blueprint payload'
        );

        expect(() => validatePlannerProfileBundleForDataset(bundle(), {
            ...compatibility,
            gameVersion: '0.4.6f14',
        })).toThrow('Planner profile is incompatible with the loaded dataset');
    });

    it('rejects writable observations and raw-payload retention at the schema boundary', () => {
        const writable = bundle() as unknown as {
            observation: { source: { access: string; rawPayloadRetention: string } };
        };
        writable.observation.source.access = 'read-write';
        expect(() => validatePlannerProfileBundle(writable)).toThrow();

        const retained = bundle() as unknown as {
            observation: { source: { access: string; rawPayloadRetention: string } };
        };
        retained.observation.source.rawPayloadRetention = 'forever';
        expect(() => validatePlannerProfileBundle(retained)).toThrow();

        const rawPayload = bundle() as unknown as {
            observation: { rawPayload: string };
        };
        rawPayload.observation.rawPayload = 'private save data';
        expect(() => validatePlannerProfileBundle(rawPayload)).toThrow();
    });

    it('rejects ambiguous collections, invalid ranges, and noncanonical timestamps', () => {
        const duplicateRelationships = bundle();
        duplicateRelationships.manualState.state.relationships = {
            status: 'known',
            coverage: 'partial',
            values: [
                { personId: 'person-a', relationship: 1 },
                { personId: 'person-a', relationship: 2 },
            ],
        };
        expect(() => validatePlannerProfileBundle(duplicateRelationships)).toThrow(
            'Manual state relationships must be sorted and unique'
        );

        const missingCoverage = bundle() as unknown as {
            manualState: { state: { unlockedPersonIds: { status: string; values: string[] } } };
        };
        delete (missingCoverage.manualState.state.unlockedPersonIds as {
            coverage?: string;
        }).coverage;
        expect(() => validatePlannerProfileBundle(missingCoverage)).toThrow();

        const invalidAddiction = bundle();
        if (invalidAddiction.manualState.state.customers.status !== 'known') {
            throw new Error('Expected known customer state');
        }
        invalidAddiction.manualState.state.customers.values[0]!.addiction = {
            status: 'known',
            value: 1.1,
        };
        expect(() => validatePlannerProfileBundle(invalidAddiction)).toThrow(
            'Manual state customer states addiction is outside its supported range'
        );

        const invalidTime = bundle();
        invalidTime.manifest.updatedAt = '2026-08-28T19:00:00Z';
        expect(() => validatePlannerProfileBundle(invalidTime)).toThrow(
            'Planner profile updatedAt must be a canonical UTC timestamp'
        );
    });
});

function bundle(): PlannerProfileBundle {
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
                inventoryDocumentIds: ['inventory-property'],
                checklistDocumentIds: ['checklist-main'],
                blueprintDocumentIds: ['blueprint-barn'],
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
            state: state(),
        },
        inventories: [{
            schema: 'neonschedule1-planner-inventory-1',
            metadata: metadata('inventory-property'),
            inventory: {
                owner: { kind: 'property', id: 'barn' },
                coverage: 'partial',
                entries: [{
                    itemId: 'cuke',
                    currentQuantity: { status: 'known', value: 0 },
                    currentStackCount: { status: 'unknown' },
                }],
            },
        }],
        checklists: [{
            schema: 'neonschedule1-planner-checklist-1',
            metadata: metadata('checklist-main'),
            title: 'Setup',
            items: [{ id: 'buy-cuke', label: 'Buy a cuke', completed: false }],
        }],
        blueprints: [{
            schema: 'neonschedule1-planner-blueprint-1',
            metadata: metadata('blueprint-barn'),
            title: 'Barn layout',
            blueprint: {
                schema: 'neonschedule1-blueprint-4',
                ...compatibility,
                propertyCode: 'barn',
                placements: [],
                productionLogistics: { employees: [], supplies: [] },
            },
        }],
        observation: {
            schema: 'neonschedule1-planner-observation-1',
            metadata: metadata('observation-latest'),
            source: {
                kind: 'save',
                observedAt: updatedAt,
                connectorVersion: '0.0.1',
                access: 'read-only',
                rawPayloadRetention: 'none',
            },
            state: unknownState(),
            inventories: [],
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

function state(): PlannerStateSnapshot {
    return {
        mixingRuleProfile: { status: 'unknown' },
        currentRank: { status: 'unknown' },
        unlockedPersonIds: { status: 'known', coverage: 'complete', values: [] },
        relationships: { status: 'unknown' },
        recommendedDealerIds: { status: 'unknown' },
        recruitedDealerIds: { status: 'unknown' },
        customers: {
            status: 'known',
            coverage: 'partial',
            values: [{
                customerId: 'customer-a',
                addiction: { status: 'known', value: 0 },
                orderLimitMultiplier: { status: 'unknown' },
                drugAffinities: { status: 'unknown' },
            }],
        },
        dealers: {
            status: 'known',
            coverage: 'partial',
            values: [{
                personId: 'dealer-a',
                signingFeePaid: { status: 'known', value: false },
            }],
        },
        availableCash: { status: 'known', value: 0 },
        gameMinute: { status: 'unknown' },
        properties: {
            status: 'known',
            coverage: 'partial',
            values: [{
                propertyCode: 'barn',
                owned: { status: 'known', value: true },
                placements: { status: 'unknown' },
            }],
        },
        employees: { status: 'unknown' },
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
