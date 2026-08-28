import {
    plannerCustomerFacts,
    plannerFinishedRecipeInventory,
    plannerLifecycleEvidenceInputs,
    plannerPersonEligibilityFacts,
    plannerProgressionFacts,
    plannerPropertyTransferInputs,
    plannerRealizedEvidence,
    plannerShoppingEvidenceInputs,
    resolvePlannerCalculationContext,
    validatePlannerProductionEvidenceRequest,
    validatePlannerProductionEvidenceRequestForBundle,
    type PlannerDocumentMetadata,
    type PlannerProductionEvidenceRequest,
    type PlannerProfileBundle,
    type PlannerStateSnapshot,
} from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

const compatibility = {
    gameVersion: '0.4.6f13',
    datasetSha256: 'a'.repeat(64),
};
const createdAt = '2026-08-28T20:00:00.000Z';

describe('planner calculation contracts', () => {
    it('selects explicit state and inventory sources without merging them', () => {
        const context = resolvePlannerCalculationContext(bundle(), {
            state: { kind: 'manual-state', documentId: 'manual-state' },
            inventories: {
                kind: 'manual-inventories',
                documentIds: ['inventory-barn'],
            },
            reconciliation: 'explicit-sources-no-automatic-merge',
        });

        expect(context.selection).toEqual({
            state: { kind: 'manual-state', documentId: 'manual-state' },
            inventories: {
                kind: 'manual-inventories',
                documentIds: ['inventory-barn'],
            },
            reconciliation: 'explicit-sources-no-automatic-merge',
        });
        expect(context.state.currentRank).toEqual({
            status: 'known',
            value: { rank: 'Hoodlum', tier: 1 },
        });
        expect(context.inventories.map(({ owner }) => owner)).toEqual([
            { kind: 'property', id: 'barn' },
        ]);
    });

    it('rejects unknown source documents and duplicate selected inventory owners', () => {
        expect(() => resolvePlannerCalculationContext(bundle(), {
            state: { kind: 'manual-state', documentId: 'missing' },
            inventories: { kind: 'none' },
            reconciliation: 'explicit-sources-no-automatic-merge',
        })).toThrow('unknown manual state document');

        const input = bundle();
        input.manifest.documents.inventoryDocumentIds.push('inventory-barn-copy');
        input.inventories.push({
            ...input.inventories[0]!,
            metadata: metadata('inventory-barn-copy'),
        });
        expect(() => resolvePlannerCalculationContext(input, {
            state: { kind: 'manual-state', documentId: 'manual-state' },
            inventories: {
                kind: 'manual-inventories',
                documentIds: ['inventory-barn', 'inventory-barn-copy'],
            },
            reconciliation: 'explicit-sources-no-automatic-merge',
        })).toThrow('Planner calculation inventory owners contain duplicate');
    });

    it('maps complete progression and relationship state into existing calculation facts', () => {
        const state = completeState();
        expect(plannerProgressionFacts(state, {
            unlockedProductIds: {
                status: 'known',
                coverage: 'complete',
                values: ['og-kush'],
            },
            accessibleShopCodes: {
                status: 'known',
                coverage: 'complete',
                values: ['hardware'],
            },
        })).toEqual({
            facts: {
                currentRank: { rank: 'Hoodlum', tier: 1 },
                unlockedProductIds: ['og-kush'],
                accessibleShopCodes: ['hardware'],
                ownedPropertyCodes: ['barn'],
            },
            gaps: [],
        });
        expect(plannerPersonEligibilityFacts(state)).toEqual({
            facts: {
                currentRank: { rank: 'Hoodlum', tier: 1 },
                unlockedPersonIds: ['customer-a'],
                relationships: [{ personId: 'customer-a', relationship: 2 }],
                recommendedDealerIds: ['dealer-a'],
                recruitedDealerIds: [],
            },
            gaps: [],
        });
    });

    it('does not turn partial progression evidence into negative facts', () => {
        const state = completeState();
        state.properties = {
            status: 'known',
            coverage: 'partial',
            values: state.properties.status === 'known' ? state.properties.values : [],
        };
        const progression = plannerProgressionFacts(state, {
            unlockedProductIds: {
                status: 'known',
                coverage: 'partial',
                values: ['og-kush'],
            },
            accessibleShopCodes: { status: 'unknown' },
        });

        expect(progression.facts).toEqual({
            currentRank: { rank: 'Hoodlum', tier: 1 },
        });
        expect(progression.gaps).toEqual([
            { code: 'unlocked-products-partial' },
            { code: 'accessible-shops-unknown' },
            { code: 'owned-properties-partial' },
        ]);
    });

    it('preserves zero customer facts and reports target-specific partial coverage', () => {
        const state = completeState();
        if (state.customers.status !== 'known') throw new Error('Expected customer state');
        state.customers.coverage = 'partial';
        state.customers.values[0]!.addiction = { status: 'known', value: 0 };

        expect(plannerCustomerFacts(state, 'customer-a')).toEqual({
            facts: {
                customerId: 'customer-a',
                addiction: 0,
                orderLimitMultiplier: 1.25,
                drugAffinities: [{ drugType: 'Weed', affinity: 0.5 }],
            },
            gaps: [{ code: 'customer-state-partial' }],
        });
        expect(plannerCustomerFacts(state, 'missing')).toEqual({
            facts: { customerId: 'missing' },
            gaps: [{ code: 'customer-state-partial' }],
        });
    });

    it('projects only complete whole-item inventory into finished-recipe inputs', () => {
        const inventory = bundle().inventories[0]!.inventory;
        expect(plannerFinishedRecipeInventory(
            [inventory],
            { kind: 'property', id: 'barn' }
        )).toEqual({
            status: 'available',
            items: [{ itemId: 'cuke', quantity: 2 }],
            gaps: [],
        });

        inventory.coverage = 'partial';
        expect(plannerFinishedRecipeInventory(
            [inventory],
            { kind: 'property', id: 'barn' }
        )).toEqual({
            status: 'unavailable',
            items: null,
            gaps: [{ code: 'inventory-coverage-partial' }],
        });
        expect(() => plannerFinishedRecipeInventory(
            [inventory, inventory],
            { kind: 'property', id: 'barn' }
        )).toThrow('Planner calculation inventory owners contain duplicate');
    });

    it('validates and projects production economics, movement, and timing evidence', () => {
        const request = validatePlannerProductionEvidenceRequestForBundle(
            productionRequest(),
            bundle()
        );

        expect(request.schema).toBe('neonschedule1-planner-production-evidence-request-1');
        expect(plannerPropertyTransferInputs(request)).toMatchObject({
            supplies: [{
                propertyId: 'warehouse',
                itemId: 'cuke',
                transferableQuantity: 2,
            }],
            evidence: {
                coverage: 'complete',
                candidates: [{ candidateId: 'warehouse-barn-cuke' }],
            },
            movementEvidence: {
                coverage: 'complete',
                maximumTripsPerAllocation: 2,
            },
        });
        expect(plannerShoppingEvidenceInputs(request)).toMatchObject({
            objective: 'minimum-elapsed-minutes',
            movement: { modelId: 'player-car', carryingCapacity: 20 },
            travel: { depotLocationId: 'barn', coverage: 'complete' },
            remoteDelivery: { coverage: 'complete' },
            maximumStates: 1_000,
        });
        expect(plannerLifecycleEvidenceInputs(request)).toEqual({
            execution: {
                startMinute: 120,
                executionModel: 'caller-supplied-exclusive-sequential-execution',
            },
            sale: {
                kind: 'direct',
                sellerId: 'player',
                destinationId: 'customer-a',
                quantity: 2,
                startMinute: 180,
                completionMinute: 190,
                travelDurationMinutes: 10,
                completionRule: 'caller-supplied-sale-confirmed-at-destination',
            },
        });
        const realized = plannerRealizedEvidence(request);
        expect(realized).toMatchObject({
            status: 'available',
            revenue: {
                dataset: compatibility,
                quantity: 2,
                coverage: 'complete',
                recordedRevenue: 200,
            },
            costs: {
                dataset: compatibility,
                quantity: 2,
                coverage: 'complete',
            },
        });
        if (realized.status !== 'available') throw new Error('Expected realized evidence');
        expect(realized.costs.treatments.slice(0, 2)).toEqual([
            { category: 'materials', treatment: 'included', amount: 50 },
            { category: 'equipment', treatment: 'not-incurred', amount: 0 },
        ]);
    });

    it('keeps unknown evidence unavailable instead of inventing defaults', () => {
        const request = productionRequest();
        request.propertyTransfers = { status: 'unknown' };
        request.shopping = { status: 'unknown' };
        request.lifecycle.execution = { status: 'unknown' };
        request.lifecycle.sale = { status: 'unknown' };
        request.realized.revenue = { status: 'unknown' };
        request.realized.costs = { status: 'unknown' };

        expect(plannerPropertyTransferInputs(request)).toBeNull();
        expect(plannerShoppingEvidenceInputs(request)).toBeNull();
        expect(plannerLifecycleEvidenceInputs(request)).toEqual({});
        expect(plannerRealizedEvidence(request)).toEqual({
            status: 'unavailable',
            revenue: null,
            costs: null,
            gaps: ['realized-revenue-unknown', 'realized-costs-unknown'],
        });
    });

    it('rejects incompatible, inconsistent, noncanonical, and undeclared request data', () => {
        const incompatible = productionRequest();
        incompatible.compatibility.datasetSha256 = 'b'.repeat(64);
        expect(() => validatePlannerProductionEvidenceRequestForBundle(
            incompatible,
            bundle()
        )).toThrow('incompatible with the selected profile');

        const unselectedInventory = productionRequest();
        unselectedInventory.production.inventoryOwner = { kind: 'player', id: 'local' };
        expect(() => validatePlannerProductionEvidenceRequestForBundle(
            unselectedInventory,
            bundle()
        )).toThrow('references an unselected inventory owner');

        const wrongDestination = productionRequest();
        if (wrongDestination.propertyTransfers.status !== 'known') {
            throw new Error('Expected transfer evidence');
        }
        wrongDestination.propertyTransfers.value.evidence.candidates[0]!.destinationPropertyId =
            'rv';
        expect(() => validatePlannerProductionEvidenceRequest(wrongDestination)).toThrow(
            'targets a different production property'
        );

        const wrongSaleQuantity = productionRequest();
        if (wrongSaleQuantity.lifecycle.sale.status !== 'known') {
            throw new Error('Expected sale evidence');
        }
        wrongSaleQuantity.lifecycle.sale.value.quantity = 1;
        expect(() => validatePlannerProductionEvidenceRequest(wrongSaleQuantity)).toThrow(
            'sale quantity does not match planned output'
        );

        const missingCost = productionRequest();
        if (missingCost.realized.costs.status !== 'known') {
            throw new Error('Expected cost evidence');
        }
        missingCost.realized.costs.value.treatments.pop();
        expect(() => validatePlannerProductionEvidenceRequest(missingCost)).toThrow(
            'must treat every category'
        );

        const undeclared = productionRequest() as PlannerProductionEvidenceRequest & {
            rawSave: string;
        };
        undeclared.rawSave = 'private';
        expect(() => validatePlannerProductionEvidenceRequest(undeclared)).toThrow();
    });
});

function productionRequest(): PlannerProductionEvidenceRequest {
    return {
        schema: 'neonschedule1-planner-production-evidence-request-1',
        requestId: 'request-a',
        profileId: 'profile-a',
        createdAt,
        compatibility: { ...compatibility },
        context: {
            state: { kind: 'manual-state', documentId: 'manual-state' },
            inventories: {
                kind: 'manual-inventories',
                documentIds: ['inventory-barn'],
            },
            reconciliation: 'explicit-sources-no-automatic-merge',
        },
        production: {
            recipe: {
                productId: 'og-kush',
                ingredientIds: ['cuke'],
                ruleProfile: { kind: 'standard' },
            },
            finishedQuantity: 2,
            propertyId: 'barn',
            inventoryOwner: { kind: 'property', id: 'barn' },
        },
        positions: {
            status: 'known',
            coverage: 'complete',
            values: [
                {
                    locationId: 'barn',
                    source: 'static-dataset',
                    observedAt: null,
                    position: { status: 'known', value: { x: 0, y: 0, z: 0 } },
                },
                {
                    locationId: 'hardware',
                    source: 'static-dataset',
                    observedAt: null,
                    position: { status: 'known', value: { x: 10, y: 0, z: 0 } },
                },
                {
                    locationId: 'warehouse',
                    source: 'request',
                    observedAt: createdAt,
                    position: { status: 'known', value: { x: -10, y: 0, z: 0 } },
                },
            ],
        },
        propertyTransfers: {
            status: 'known',
            value: {
                supplies: [{
                    propertyId: 'warehouse',
                    itemId: 'cuke',
                    transferableQuantity: 2,
                }],
                evidence: {
                    coverage: 'complete',
                    candidates: [{
                        candidateId: 'warehouse-barn-cuke',
                        itemId: 'cuke',
                        sourcePropertyId: 'warehouse',
                        destinationPropertyId: 'barn',
                        quantityCapacity: 2,
                    }],
                },
                movement: {
                    status: 'known',
                    value: {
                        coverage: 'complete',
                        maximumTripsPerAllocation: 2,
                        assignments: [{
                            candidateId: 'warehouse-barn-cuke',
                            itemId: 'cuke',
                            sourcePropertyId: 'warehouse',
                            destinationPropertyId: 'barn',
                            movementModelId: 'player-car',
                            carryingCapacity: 20,
                            itemLoadUnits: 1,
                            startMinute: 100,
                            loadMinutesPerTrip: 1,
                            unloadMinutesPerTrip: 1,
                            outboundLeg: {
                                legId: 'warehouse-barn',
                                sourcePropertyId: 'warehouse',
                                destinationPropertyId: 'barn',
                                distance: 10,
                                durationMinutes: 5,
                            },
                            returnLeg: {
                                legId: 'barn-warehouse',
                                sourcePropertyId: 'barn',
                                destinationPropertyId: 'warehouse',
                                distance: 10,
                                durationMinutes: 5,
                            },
                        }],
                    },
                },
            },
        },
        shopping: {
            status: 'known',
            value: {
                objective: 'minimum-elapsed-minutes',
                movement: {
                    modelId: 'player-car',
                    carryingCapacity: 20,
                    itemLoadUnits: [{ itemId: 'cuke', loadUnitsPerItem: 1 }],
                    startMinute: 110,
                    serviceMinutesPerVisit: 1,
                },
                travel: {
                    coverage: 'complete',
                    depotLocationId: 'barn',
                    legs: [
                        {
                            legId: 'barn-hardware',
                            fromLocationId: 'barn',
                            toLocationId: 'hardware',
                            distance: 10,
                            durationMinutes: 5,
                        },
                        {
                            legId: 'hardware-barn',
                            fromLocationId: 'hardware',
                            toLocationId: 'barn',
                            distance: 10,
                            durationMinutes: 5,
                        },
                    ],
                },
                remoteDelivery: { coverage: 'complete', deliveries: [] },
                maximumStates: 1_000,
            },
        },
        lifecycle: {
            execution: {
                status: 'known',
                value: {
                    startMinute: 120,
                    executionModel: 'caller-supplied-exclusive-sequential-execution',
                },
            },
            sale: {
                status: 'known',
                value: {
                    kind: 'direct',
                    sellerId: 'player',
                    destinationId: 'customer-a',
                    quantity: 2,
                    startMinute: 180,
                    completionMinute: 190,
                    travelDurationMinutes: 10,
                    completionRule: 'caller-supplied-sale-confirmed-at-destination',
                },
            },
        },
        realized: {
            revenue: {
                status: 'known',
                value: { coverage: 'complete', recordedRevenue: 200 },
            },
            costs: {
                status: 'known',
                value: {
                    coverage: 'complete',
                    treatments: [
                        { category: 'materials', treatment: 'included', amount: 50 },
                        { category: 'equipment', treatment: 'not-incurred', amount: 0 },
                        { category: 'labor', treatment: 'included', amount: 10 },
                        { category: 'transport', treatment: 'included', amount: 5 },
                        { category: 'sale-fees', treatment: 'not-incurred', amount: 0 },
                        { category: 'other', treatment: 'not-incurred', amount: 0 },
                    ],
                },
            },
        },
    };
}

function bundle(): PlannerProfileBundle {
    return {
        manifest: {
            schema: 'neonschedule1-planner-profile-1',
            profileId: 'profile-a',
            name: 'Main profile',
            createdAt,
            updatedAt: createdAt,
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
            state: completeState(),
        },
        inventories: [{
            schema: 'neonschedule1-planner-inventory-1',
            metadata: metadata('inventory-barn'),
            inventory: {
                owner: { kind: 'property', id: 'barn' },
                coverage: 'complete',
                entries: [{
                    itemId: 'cuke',
                    currentQuantity: { status: 'known', value: 2 },
                    currentStackCount: { status: 'known', value: 1 },
                }],
            },
        }],
        checklists: [],
        blueprints: [],
        observation: {
            schema: 'neonschedule1-planner-observation-1',
            metadata: metadata('observation-latest'),
            source: {
                kind: 'save',
                observedAt: createdAt,
                connectorVersion: '0.0.32',
                access: 'read-only',
                rawPayloadRetention: 'none',
            },
            state: completeState(),
            inventories: [],
        },
    };
}

function metadata(documentId: string): PlannerDocumentMetadata {
    return {
        documentId,
        profileId: 'profile-a',
        createdAt,
        updatedAt: createdAt,
        compatibility: { ...compatibility },
    };
}

function completeState(): PlannerStateSnapshot {
    return {
        mixingRuleProfile: { status: 'known', value: { kind: 'standard' } },
        currentRank: { status: 'known', value: { rank: 'Hoodlum', tier: 1 } },
        unlockedPersonIds: {
            status: 'known',
            coverage: 'complete',
            values: ['customer-a'],
        },
        relationships: {
            status: 'known',
            coverage: 'complete',
            values: [{ personId: 'customer-a', relationship: 2 }],
        },
        recommendedDealerIds: {
            status: 'known',
            coverage: 'complete',
            values: ['dealer-a'],
        },
        recruitedDealerIds: { status: 'known', coverage: 'complete', values: [] },
        customers: {
            status: 'known',
            coverage: 'complete',
            values: [{
                customerId: 'customer-a',
                addiction: { status: 'known', value: 0.25 },
                orderLimitMultiplier: { status: 'known', value: 1.25 },
                drugAffinities: {
                    status: 'known',
                    coverage: 'complete',
                    values: [{ drugType: 'Weed', affinity: 0.5 }],
                },
            }],
        },
        dealers: {
            status: 'known',
            coverage: 'complete',
            values: [{
                personId: 'dealer-a',
                signingFeePaid: { status: 'known', value: false },
            }],
        },
        availableCash: { status: 'known', value: 500 },
        gameMinute: { status: 'known', value: 100 },
        properties: {
            status: 'known',
            coverage: 'complete',
            values: [{
                propertyCode: 'barn',
                owned: { status: 'known', value: true },
                placements: { status: 'known', coverage: 'complete', values: [] },
            }],
        },
        employees: { status: 'known', coverage: 'complete', values: [] },
    };
}
