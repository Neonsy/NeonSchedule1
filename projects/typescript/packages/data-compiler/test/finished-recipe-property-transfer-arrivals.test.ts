import {
    planFinishedRecipePropertyTransferArrivals,
    validateFinishedRecipePropertyTransferArrivalResult,
    type FinishedRecipePropertyTransferAllocation,
    type FinishedRecipePropertyTransferMovementAssignment,
    type FinishedRecipePropertyTransferMovementLeg,
    type FinishedRecipePropertyTransferPlan,
} from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

describe('finished recipe property transfer arrivals', () => {
    it('proves an empty selected transfer plan without movement evidence', () => {
        expect(planFinishedRecipePropertyTransferArrivals({
            transferPlan: transferPlan([]),
            movementEvidence: {
                coverage: 'partial',
                maximumTripsPerAllocation: 100,
                assignments: [],
            },
        })).toEqual({
            kind: 'planned',
            plan: {
                scope: 'selected-property-transfer-allocations',
                routeOptimization: 'not-evaluated',
                carryingModel: 'caller-supplied-load-units',
                tripModel: 'each-allocation-runs-between-its-source-and-destination',
                scheduleModel: 'caller-supplied-independent-allocation-start-times',
                proof: 'exact-selected-allocation-timing',
                evidenceProof: 'selected-allocations-supported',
                maximumTripsPerAllocation: 100,
                arrivals: [],
                destinations: [],
                completionMinute: null,
            },
        });
    });

    it('times one trip from explicit capacity, service, and movement evidence', () => {
        const allocation = transfer('warehouse-lab', 'soil', 'warehouse', 'lab', 2);
        const result = planFinishedRecipePropertyTransferArrivals({
            transferPlan: transferPlan([allocation]),
            movementEvidence: {
                coverage: 'complete',
                maximumTripsPerAllocation: 100,
                assignments: [assignment(allocation, {
                    carryingCapacity: 3,
                    startMinute: 5,
                    loadMinutesPerTrip: 2,
                    unloadMinutesPerTrip: 1,
                    outboundLeg: leg('out', 'warehouse', 'lab', 4),
                })],
            },
        });

        expect(result).toMatchObject({
            kind: 'planned',
            plan: {
                evidenceProof: 'complete',
                completionMinute: 12,
                destinations: [{ propertyId: 'lab', completionMinute: 12 }],
                arrivals: [{
                    candidateId: 'warehouse-lab',
                    quantity: 2,
                    completionMinute: 12,
                    trips: [{
                        tripIndex: 0,
                        quantity: 2,
                        loadUnits: 2,
                        startMinute: 5,
                        departureMinute: 7,
                        arrivalMinute: 11,
                        completionMinute: 12,
                        returnLeg: null,
                        returnArrivalMinute: null,
                    }],
                }],
            },
        });
    });

    it('returns to the source between capacity-limited trips', () => {
        const allocation = transfer('warehouse-lab', 'soil', 'warehouse', 'lab', 5);
        const result = planFinishedRecipePropertyTransferArrivals({
            transferPlan: transferPlan([allocation]),
            movementEvidence: {
                coverage: 'complete',
                maximumTripsPerAllocation: 100,
                assignments: [assignment(allocation, {
                    carryingCapacity: 2,
                    loadMinutesPerTrip: 1,
                    unloadMinutesPerTrip: 1,
                    outboundLeg: leg('out', 'warehouse', 'lab', 3),
                    returnLeg: leg('back', 'lab', 'warehouse', 2),
                })],
            },
        });

        expect(result).toMatchObject({
            kind: 'planned',
            plan: {
                completionMinute: 19,
                arrivals: [{
                    quantity: 5,
                    completionMinute: 19,
                    trips: [
                        { quantity: 2, startMinute: 0, completionMinute: 5, returnArrivalMinute: 7 },
                        { quantity: 2, startMinute: 7, completionMinute: 12, returnArrivalMinute: 14 },
                        { quantity: 1, startMinute: 14, completionMinute: 19, returnArrivalMinute: null },
                    ],
                }],
            },
        });
    });

    it('keeps missing route evidence unavailable with the declared coverage proof', () => {
        const allocation = transfer('warehouse-lab', 'soil', 'warehouse', 'lab', 3);
        const incomplete = planFinishedRecipePropertyTransferArrivals({
            transferPlan: transferPlan([allocation]),
            movementEvidence: {
                coverage: 'partial',
                maximumTripsPerAllocation: 100,
                assignments: [assignment(allocation, { outboundLeg: null })],
            },
        });
        const exact = planFinishedRecipePropertyTransferArrivals({
            transferPlan: transferPlan([allocation]),
            movementEvidence: {
                coverage: 'complete',
                maximumTripsPerAllocation: 100,
                assignments: [assignment(allocation, {
                    carryingCapacity: 2,
                    returnLeg: null,
                })],
            },
        });

        expect(incomplete).toMatchObject({
            kind: 'not-planned',
            proof: 'incomplete',
            evidenceGaps: [{
                code: 'outbound-leg-not-recorded',
                candidateId: 'warehouse-lab',
            }],
        });
        expect(exact).toMatchObject({
            kind: 'not-planned',
            proof: 'exact',
            evidenceGaps: [{
                code: 'return-leg-not-recorded',
                candidateId: 'warehouse-lab',
            }],
        });
    });

    it('reports when one item cannot fit within carrying capacity', () => {
        const allocation = transfer('warehouse-lab', 'soil', 'warehouse', 'lab', 1);
        const result = planFinishedRecipePropertyTransferArrivals({
            transferPlan: transferPlan([allocation]),
            movementEvidence: {
                coverage: 'complete',
                maximumTripsPerAllocation: 100,
                assignments: [assignment(allocation, {
                    carryingCapacity: 0.5,
                    itemLoadUnits: 1,
                })],
            },
        });

        expect(result).toMatchObject({
            kind: 'not-planned',
            proof: 'exact',
            evidenceGaps: [{ code: 'carrying-capacity-too-small' }],
        });
    });

    it('stops before materializing more trips than the caller permits', () => {
        const allocation = transfer('warehouse-lab', 'soil', 'warehouse', 'lab', 3);
        const result = planFinishedRecipePropertyTransferArrivals({
            transferPlan: transferPlan([allocation]),
            movementEvidence: {
                coverage: 'complete',
                maximumTripsPerAllocation: 2,
                assignments: [assignment(allocation, {
                    carryingCapacity: 1,
                    returnLeg: leg('back', 'lab', 'warehouse', 1),
                })],
            },
        });

        expect(result).toMatchObject({
            kind: 'not-planned',
            proof: 'incomplete',
            evidenceGaps: [{ code: 'trip-limit-exceeded' }],
        });
    });

    it('rejects movement evidence that does not match the selected allocation', () => {
        const allocation = transfer('warehouse-lab', 'soil', 'warehouse', 'lab', 1);
        expect(() => planFinishedRecipePropertyTransferArrivals({
            transferPlan: transferPlan([allocation]),
            movementEvidence: {
                coverage: 'complete',
                maximumTripsPerAllocation: 100,
                assignments: [{
                    ...assignment(allocation),
                    destinationPropertyId: 'barn',
                }],
            },
        })).toThrow('Property transfer movement does not match allocation "warehouse-lab"');
    });

    it('rejects an arrival result whose timing was altered after planning', () => {
        const allocation = transfer('warehouse-lab', 'soil', 'warehouse', 'lab', 1);
        const input = {
            transferPlan: transferPlan([allocation]),
            movementEvidence: {
                coverage: 'complete' as const,
                maximumTripsPerAllocation: 100,
                assignments: [assignment(allocation)],
            },
        };
        const result = planFinishedRecipePropertyTransferArrivals(input);
        if (result.kind !== 'planned') throw new Error('Expected planned transfer arrivals');
        const arrival = result.plan.arrivals[0];
        if (arrival === undefined) throw new Error('Expected one transfer arrival');

        expect(() => validateFinishedRecipePropertyTransferArrivalResult(
            input.transferPlan,
            {
                kind: 'planned',
                plan: {
                    ...result.plan,
                    arrivals: [{ ...arrival, completionMinute: arrival.completionMinute + 1 }],
                },
            }
        )).toThrow('Property transfer allocation completion minute is inconsistent');
    });

    it('summarizes independent arrivals for multiple destination properties', () => {
        const lab = transfer('warehouse-lab', 'soil', 'warehouse', 'lab', 1);
        const barn = transfer('warehouse-barn', 'soil', 'warehouse', 'barn', 1);
        const input = {
            transferPlan: transferPlan([lab, barn]),
            movementEvidence: {
                coverage: 'complete' as const,
                maximumTripsPerAllocation: 100,
                assignments: [
                    assignment(lab, { outboundLeg: leg('lab', 'warehouse', 'lab', 4) }),
                    assignment(barn, {
                        startMinute: 2,
                        outboundLeg: leg('barn', 'warehouse', 'barn', 7),
                    }),
                ],
            },
        };
        const result = planFinishedRecipePropertyTransferArrivals(input);

        expect(result).toMatchObject({
            kind: 'planned',
            plan: {
                completionMinute: 9,
                destinations: [
                    { propertyId: 'barn', completionMinute: 9 },
                    { propertyId: 'lab', completionMinute: 4 },
                ],
            },
        });
        expect(() => validateFinishedRecipePropertyTransferArrivalResult(
            input.transferPlan,
            result
        )).not.toThrow();
    });
});

interface AssignmentOverrides {
    readonly carryingCapacity?: number;
    readonly itemLoadUnits?: number;
    readonly startMinute?: number;
    readonly loadMinutesPerTrip?: number;
    readonly unloadMinutesPerTrip?: number;
    readonly outboundLeg?: FinishedRecipePropertyTransferMovementLeg | null;
    readonly returnLeg?: FinishedRecipePropertyTransferMovementLeg | null;
}

function assignment(
    allocation: FinishedRecipePropertyTransferAllocation,
    overrides: AssignmentOverrides = {}
): FinishedRecipePropertyTransferMovementAssignment {
    return {
        candidateId: allocation.candidateId,
        itemId: allocation.itemId,
        sourcePropertyId: allocation.sourcePropertyId,
        destinationPropertyId: allocation.destinationPropertyId,
        movementModelId: 'test-player-carry',
        carryingCapacity: overrides.carryingCapacity ?? 10,
        itemLoadUnits: overrides.itemLoadUnits ?? 1,
        startMinute: overrides.startMinute ?? 0,
        loadMinutesPerTrip: overrides.loadMinutesPerTrip ?? 0,
        unloadMinutesPerTrip: overrides.unloadMinutesPerTrip ?? 0,
        outboundLeg: overrides.outboundLeg === undefined
            ? leg('out', allocation.sourcePropertyId, allocation.destinationPropertyId, 1)
            : overrides.outboundLeg,
        returnLeg: overrides.returnLeg ?? null,
    };
}

function leg(
    legId: string,
    sourcePropertyId: string,
    destinationPropertyId: string,
    durationMinutes: number
): FinishedRecipePropertyTransferMovementLeg {
    return { legId, sourcePropertyId, destinationPropertyId, distance: 1, durationMinutes };
}

function transfer(
    candidateId: string,
    itemId: string,
    sourcePropertyId: string,
    destinationPropertyId: string,
    quantity: number
): FinishedRecipePropertyTransferAllocation {
    return {
        candidateId,
        itemId,
        sourcePropertyId,
        destinationPropertyId,
        quantity,
        itemStackLimit: 20,
        stackCount: Math.ceil(quantity / 20),
    };
}

function transferPlan(
    allocations: readonly FinishedRecipePropertyTransferAllocation[]
): FinishedRecipePropertyTransferPlan {
    const allocatedQuantity = allocations.reduce((total, allocation) => total + allocation.quantity, 0);
    return {
        objective: 'maximize-transferred-reorder-quantity-per-item',
        tieBreak: 'canonical-item-source-destination-candidate-identity-order',
        routeOptimization: 'not-evaluated',
        demandProof: 'exact',
        transferEvidenceProof: 'exact',
        allocationProof: 'maximum',
        residualProof: 'exact',
        residualCostProof: 'exact',
        requirements: [],
        sources: [],
        allocations,
        totalRequestedReorderQuantity: allocatedQuantity,
        knownAllocatedQuantity: allocatedQuantity,
        unallocatedAfterKnownTransfersQuantity: 0,
        totalResidualReorderQuantity: 0,
        totalResidualMaterialReorderCost: 0,
        totalResidualEquipmentReorderCost: 0,
        totalResidualReorderCost: 0,
    };
}
