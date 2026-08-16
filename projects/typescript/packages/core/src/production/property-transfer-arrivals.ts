import type { FinishedRecipePropertyTransferAllocation } from '#core/production/property-transfer-types';
import type {
    FinishedRecipePropertyTransferAllocationArrival,
    FinishedRecipePropertyTransferArrivalEvidenceGap,
    FinishedRecipePropertyTransferArrivalInput,
    FinishedRecipePropertyTransferArrivalResult,
    FinishedRecipePropertyTransferArrivalTrip,
    FinishedRecipePropertyTransferMovementAssignment,
    FinishedRecipePropertyTransferMovementLeg,
} from '#core/production/property-transfer-arrival-types';

export type {
    FinishedRecipePropertyTransferAllocationArrival,
    FinishedRecipePropertyTransferArrivalEvidenceGap,
    FinishedRecipePropertyTransferArrivalInput,
    FinishedRecipePropertyTransferArrivalPlan,
    FinishedRecipePropertyTransferArrivalResult,
    FinishedRecipePropertyTransferArrivalTrip,
    FinishedRecipePropertyTransferDestinationArrival,
    FinishedRecipePropertyTransferMovementAssignment,
    FinishedRecipePropertyTransferMovementEvidence,
    FinishedRecipePropertyTransferMovementLeg,
} from '#core/production/property-transfer-arrival-types';

export function planFinishedRecipePropertyTransferArrivals(
    input: FinishedRecipePropertyTransferArrivalInput
): FinishedRecipePropertyTransferArrivalResult {
    validateCoverage(input.movementEvidence.coverage);
    requirePositiveSafeInteger(
        input.movementEvidence.maximumTripsPerAllocation,
        'Property transfer maximum trips per allocation'
    );
    const allocations = indexAllocations(input.transferPlan.allocations);
    const assignments = indexAssignments(input.movementEvidence.assignments, allocations);
    const arrivals: FinishedRecipePropertyTransferAllocationArrival[] = [];
    const evidenceGaps: FinishedRecipePropertyTransferArrivalEvidenceGap[] = [];

    for (const allocation of allocations.values()) {
        const assignment = assignments.get(allocation.candidateId);
        if (assignment === undefined) {
            evidenceGaps.push(gap('movement-assignment-not-recorded', allocation));
            continue;
        }
        const planned = planAllocationArrival(
            allocation,
            assignment,
            input.movementEvidence.maximumTripsPerAllocation
        );
        if ('code' in planned) evidenceGaps.push(gap(planned.code, allocation));
        else arrivals.push(planned);
    }

    if (evidenceGaps.length > 0) {
        return {
            kind: 'not-planned',
            reason: 'selected-allocation-movement-unavailable',
            proof: input.movementEvidence.coverage === 'complete' &&
                !evidenceGaps.some(({ code }) => code === 'trip-limit-exceeded')
                ? 'exact'
                : 'incomplete',
            evidenceGaps,
            arrivals,
        };
    }

    const destinations = summarizeDestinations(arrivals);
    return {
        kind: 'planned',
        plan: {
            scope: 'selected-property-transfer-allocations',
            routeOptimization: 'not-evaluated',
            carryingModel: 'caller-supplied-load-units',
            tripModel: 'each-allocation-runs-between-its-source-and-destination',
            scheduleModel: 'caller-supplied-independent-allocation-start-times',
            proof: 'exact-selected-allocation-timing',
            evidenceProof: input.movementEvidence.coverage === 'complete'
                ? 'complete'
                : 'selected-allocations-supported',
            maximumTripsPerAllocation: input.movementEvidence.maximumTripsPerAllocation,
            arrivals,
            destinations,
            completionMinute: arrivals.length === 0
                ? null
                : Math.max(...arrivals.map((arrival) => arrival.completionMinute)),
        },
    };
}

export function validateFinishedRecipePropertyTransferArrivalResult(
    input: FinishedRecipePropertyTransferArrivalInput['transferPlan'],
    result: FinishedRecipePropertyTransferArrivalResult
): void {
    const allocations = indexAllocations(input.allocations);
    const arrivals = result.kind === 'planned' ? result.plan.arrivals : result.arrivals;
    const seen = new Set<string>();
    for (const arrival of arrivals) {
        const allocation = allocations.get(arrival.candidateId);
        if (allocation === undefined) {
            throw new Error(
                `Property transfer arrival contains unknown allocation ${JSON.stringify(arrival.candidateId)}`
            );
        }
        if (seen.has(arrival.candidateId)) {
            throw new Error(
                `Property transfer arrival contains duplicate allocation ${JSON.stringify(arrival.candidateId)}`
            );
        }
        seen.add(arrival.candidateId);
        validateArrivalIdentity(allocation, arrival);
        validateArrivalTiming(arrival);
    }

    if (result.kind === 'planned') {
        if (seen.size !== allocations.size) {
            throw new Error('Planned property transfer arrivals do not cover every selected allocation');
        }
        validateDestinationSummaries(result.plan.destinations, arrivals);
        const completionMinute = arrivals.length === 0
            ? null
            : Math.max(...arrivals.map((arrival) => arrival.completionMinute));
        if (result.plan.completionMinute !== completionMinute) {
            throw new Error('Property transfer arrival completion minute is inconsistent');
        }
        return;
    }

    const gapCandidates = new Set<string>();
    if (result.evidenceGaps.length === 0) {
        throw new Error('Unplanned property transfer arrivals must contain an evidence gap');
    }
    for (const evidenceGap of result.evidenceGaps) {
        const allocation = allocations.get(evidenceGap.candidateId);
        if (allocation === undefined) {
            throw new Error(
                `Property transfer arrival gap contains unknown allocation ${JSON.stringify(evidenceGap.candidateId)}`
            );
        }
        if (gapCandidates.has(evidenceGap.candidateId) || seen.has(evidenceGap.candidateId)) {
            throw new Error(
                `Property transfer arrival has conflicting evidence for ${JSON.stringify(evidenceGap.candidateId)}`
            );
        }
        validateGapIdentity(allocation, evidenceGap);
        gapCandidates.add(evidenceGap.candidateId);
    }
    if (seen.size + gapCandidates.size !== allocations.size) {
        throw new Error('Property transfer arrival result does not cover every selected allocation');
    }
}

function indexAllocations(
    input: readonly FinishedRecipePropertyTransferAllocation[]
): ReadonlyMap<string, FinishedRecipePropertyTransferAllocation> {
    const result = new Map<string, FinishedRecipePropertyTransferAllocation>();
    for (const allocation of input) {
        requireNonBlank(allocation.candidateId, 'Property transfer candidate ID');
        requireNonBlank(allocation.itemId, 'Property transfer item ID');
        requireNonBlank(allocation.sourcePropertyId, 'Property transfer source property ID');
        requireNonBlank(allocation.destinationPropertyId, 'Property transfer destination property ID');
        requirePositiveSafeInteger(allocation.quantity, 'Property transfer allocation quantity');
        if (result.has(allocation.candidateId)) {
            throw new Error(
                `Property transfer allocations contain duplicate candidate ${JSON.stringify(allocation.candidateId)}`
            );
        }
        result.set(allocation.candidateId, allocation);
    }
    return new Map([...result].sort(([left], [right]) => left.localeCompare(right)));
}

function indexAssignments(
    input: readonly FinishedRecipePropertyTransferMovementAssignment[],
    allocations: ReadonlyMap<string, FinishedRecipePropertyTransferAllocation>
): ReadonlyMap<string, FinishedRecipePropertyTransferMovementAssignment> {
    const result = new Map<string, FinishedRecipePropertyTransferMovementAssignment>();
    for (const assignment of input) {
        requireNonBlank(assignment.candidateId, 'Property transfer movement candidate ID');
        const allocation = allocations.get(assignment.candidateId);
        if (allocation === undefined) {
            throw new Error(
                `Property transfer movement contains unknown allocation ${JSON.stringify(assignment.candidateId)}`
            );
        }
        if (result.has(assignment.candidateId)) {
            throw new Error(
                `Property transfer movement contains duplicate allocation ${JSON.stringify(assignment.candidateId)}`
            );
        }
        validateAssignment(allocation, assignment);
        result.set(assignment.candidateId, assignment);
    }
    return result;
}

function validateAssignment(
    allocation: FinishedRecipePropertyTransferAllocation,
    assignment: FinishedRecipePropertyTransferMovementAssignment
): void {
    if (
        assignment.itemId !== allocation.itemId ||
        assignment.sourcePropertyId !== allocation.sourcePropertyId ||
        assignment.destinationPropertyId !== allocation.destinationPropertyId
    ) {
        throw new Error(
            `Property transfer movement does not match allocation ${JSON.stringify(allocation.candidateId)}`
        );
    }
    requireNonBlank(assignment.movementModelId, 'Property transfer movement model ID');
    requirePositiveFinite(assignment.carryingCapacity, 'Property transfer carrying capacity');
    requirePositiveFinite(assignment.itemLoadUnits, 'Property transfer item load units');
    requireNonNegativeFinite(assignment.startMinute, 'Property transfer start minute');
    requireNonNegativeFinite(assignment.loadMinutesPerTrip, 'Property transfer load minutes');
    requireNonNegativeFinite(assignment.unloadMinutesPerTrip, 'Property transfer unload minutes');
    if (assignment.outboundLeg !== null) {
        validateLeg(
            assignment.outboundLeg,
            allocation.sourcePropertyId,
            allocation.destinationPropertyId,
            'outbound'
        );
    }
    if (assignment.returnLeg !== null) {
        validateLeg(
            assignment.returnLeg,
            allocation.destinationPropertyId,
            allocation.sourcePropertyId,
            'return'
        );
    }
}

function planAllocationArrival(
    allocation: FinishedRecipePropertyTransferAllocation,
    assignment: FinishedRecipePropertyTransferMovementAssignment,
    maximumTripsPerAllocation: number
): FinishedRecipePropertyTransferAllocationArrival | FinishedRecipePropertyTransferArrivalEvidenceGap {
    if (assignment.outboundLeg === null) return gap('outbound-leg-not-recorded', allocation);
    const quantityPerTrip = Math.min(
        allocation.quantity,
        Math.floor(assignment.carryingCapacity / assignment.itemLoadUnits)
    );
    if (quantityPerTrip < 1) return gap('carrying-capacity-too-small', allocation);
    const tripCount = Math.ceil(allocation.quantity / quantityPerTrip);
    if (tripCount > maximumTripsPerAllocation) return gap('trip-limit-exceeded', allocation);
    if (tripCount > 1 && assignment.returnLeg === null) {
        return gap('return-leg-not-recorded', allocation);
    }

    const trips: FinishedRecipePropertyTransferArrivalTrip[] = [];
    let remainingQuantity = allocation.quantity;
    let startMinute = assignment.startMinute;
    for (let tripIndex = 0; tripIndex < tripCount; tripIndex += 1) {
        const quantity = Math.min(quantityPerTrip, remainingQuantity);
        const departureMinute = addFinite(
            startMinute,
            assignment.loadMinutesPerTrip,
            'Property transfer departure minute'
        );
        const arrivalMinute = addFinite(
            departureMinute,
            assignment.outboundLeg.durationMinutes,
            'Property transfer arrival minute'
        );
        const completionMinute = addFinite(
            arrivalMinute,
            assignment.unloadMinutesPerTrip,
            'Property transfer completion minute'
        );
        const needsReturn = tripIndex + 1 < tripCount;
        const returnLeg = needsReturn ? assignment.returnLeg : null;
        const returnArrivalMinute = returnLeg === null
            ? null
            : addFinite(
                  completionMinute,
                  returnLeg.durationMinutes,
                  'Property transfer return arrival minute'
              );
        trips.push({
            tripIndex,
            quantity,
            loadUnits: multiplyFinite(
                quantity,
                assignment.itemLoadUnits,
                'Property transfer trip load units'
            ),
            startMinute,
            departureMinute,
            arrivalMinute,
            completionMinute,
            outboundLeg: { ...assignment.outboundLeg },
            returnLeg: returnLeg === null ? null : { ...returnLeg },
            returnArrivalMinute,
        });
        remainingQuantity -= quantity;
        if (returnArrivalMinute !== null) startMinute = returnArrivalMinute;
    }

    return {
        ...allocation,
        movementModelId: assignment.movementModelId,
        carryingCapacity: assignment.carryingCapacity,
        itemLoadUnits: assignment.itemLoadUnits,
        startMinute: assignment.startMinute,
        loadMinutesPerTrip: assignment.loadMinutesPerTrip,
        unloadMinutesPerTrip: assignment.unloadMinutesPerTrip,
        trips,
        completionMinute: trips.at(-1)?.completionMinute ?? assignment.startMinute,
    };
}

function summarizeDestinations(
    arrivals: readonly FinishedRecipePropertyTransferAllocationArrival[]
) {
    const byProperty = new Map<string, number>();
    for (const arrival of arrivals) {
        byProperty.set(
            arrival.destinationPropertyId,
            Math.max(byProperty.get(arrival.destinationPropertyId) ?? 0, arrival.completionMinute)
        );
    }
    return [...byProperty]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([propertyId, completionMinute]) => ({ propertyId, completionMinute }));
}

function validateArrivalIdentity(
    allocation: FinishedRecipePropertyTransferAllocation,
    arrival: FinishedRecipePropertyTransferAllocationArrival
): void {
    const keys = [
        'itemId',
        'sourcePropertyId',
        'destinationPropertyId',
        'quantity',
        'itemStackLimit',
        'stackCount',
    ] as const;
    if (keys.some((key) => arrival[key] !== allocation[key])) {
        throw new Error(
            `Property transfer arrival does not match allocation ${JSON.stringify(allocation.candidateId)}`
        );
    }
}

function validateArrivalTiming(arrival: FinishedRecipePropertyTransferAllocationArrival): void {
    requireNonBlank(arrival.movementModelId, 'Property transfer arrival movement model ID');
    requirePositiveFinite(arrival.carryingCapacity, 'Property transfer arrival carrying capacity');
    requirePositiveFinite(arrival.itemLoadUnits, 'Property transfer arrival item load units');
    requireNonNegativeFinite(arrival.startMinute, 'Property transfer arrival start minute');
    requireNonNegativeFinite(arrival.loadMinutesPerTrip, 'Property transfer arrival load minutes');
    requireNonNegativeFinite(arrival.unloadMinutesPerTrip, 'Property transfer arrival unload minutes');
    const quantityPerTrip = Math.min(
        arrival.quantity,
        Math.floor(arrival.carryingCapacity / arrival.itemLoadUnits)
    );
    if (quantityPerTrip < 1) throw new Error('Property transfer arrival exceeds carrying capacity');
    const expectedTripCount = Math.ceil(arrival.quantity / quantityPerTrip);
    if (arrival.trips.length !== expectedTripCount) {
        throw new Error('Property transfer arrival trip count is inconsistent');
    }

    let remainingQuantity = arrival.quantity;
    let expectedStart = arrival.startMinute;
    for (const [tripIndex, trip] of arrival.trips.entries()) {
        const expectedQuantity = Math.min(quantityPerTrip, remainingQuantity);
        const expectedLoadUnits = multiplyFinite(
            expectedQuantity,
            arrival.itemLoadUnits,
            'Property transfer arrival trip load units'
        );
        if (
            trip.tripIndex !== tripIndex ||
            trip.quantity !== expectedQuantity ||
            trip.loadUnits !== expectedLoadUnits ||
            trip.startMinute !== expectedStart
        ) {
            throw new Error('Property transfer arrival trip load is inconsistent');
        }
        validateLeg(
            trip.outboundLeg,
            arrival.sourcePropertyId,
            arrival.destinationPropertyId,
            'arrival outbound'
        );
        const expectedDeparture = addFinite(
            expectedStart,
            arrival.loadMinutesPerTrip,
            'Property transfer arrival departure minute'
        );
        const expectedArrival = addFinite(
            expectedDeparture,
            trip.outboundLeg.durationMinutes,
            'Property transfer arrival minute'
        );
        const expectedCompletion = addFinite(
            expectedArrival,
            arrival.unloadMinutesPerTrip,
            'Property transfer arrival completion minute'
        );
        const needsReturn = tripIndex + 1 < expectedTripCount;
        if (
            trip.departureMinute !== expectedDeparture ||
            trip.arrivalMinute !== expectedArrival ||
            trip.completionMinute !== expectedCompletion ||
            (needsReturn && trip.returnLeg === null) ||
            (!needsReturn && trip.returnLeg !== null)
        ) {
            throw new Error('Property transfer arrival trip timing is inconsistent');
        }
        if (trip.returnLeg !== null) {
            validateLeg(
                trip.returnLeg,
                arrival.destinationPropertyId,
                arrival.sourcePropertyId,
                'arrival return'
            );
            const expectedReturn = addFinite(
                expectedCompletion,
                trip.returnLeg.durationMinutes,
                'Property transfer arrival return minute'
            );
            if (trip.returnArrivalMinute !== expectedReturn) {
                throw new Error('Property transfer arrival return timing is inconsistent');
            }
            expectedStart = expectedReturn;
        } else if (trip.returnArrivalMinute !== null) {
            throw new Error('Property transfer arrival return timing is inconsistent');
        }
        remainingQuantity -= expectedQuantity;
    }
    if (arrival.completionMinute !== arrival.trips.at(-1)?.completionMinute) {
        throw new Error('Property transfer allocation completion minute is inconsistent');
    }
}

function validateDestinationSummaries(
    input: readonly { readonly propertyId: string; readonly completionMinute: number }[],
    arrivals: readonly FinishedRecipePropertyTransferAllocationArrival[]
): void {
    const expected = summarizeDestinations(arrivals);
    if (JSON.stringify(input) !== JSON.stringify(expected)) {
        throw new Error('Property transfer destination arrivals are inconsistent');
    }
}

function validateGapIdentity(
    allocation: FinishedRecipePropertyTransferAllocation,
    evidenceGap: FinishedRecipePropertyTransferArrivalEvidenceGap
): void {
    if (
        evidenceGap.itemId !== allocation.itemId ||
        evidenceGap.sourcePropertyId !== allocation.sourcePropertyId ||
        evidenceGap.destinationPropertyId !== allocation.destinationPropertyId
    ) {
        throw new Error(
            `Property transfer arrival gap does not match allocation ${JSON.stringify(allocation.candidateId)}`
        );
    }
}

function gap(
    code: FinishedRecipePropertyTransferArrivalEvidenceGap['code'],
    allocation: FinishedRecipePropertyTransferAllocation
): FinishedRecipePropertyTransferArrivalEvidenceGap {
    return {
        code,
        candidateId: allocation.candidateId,
        itemId: allocation.itemId,
        sourcePropertyId: allocation.sourcePropertyId,
        destinationPropertyId: allocation.destinationPropertyId,
    };
}

function validateLeg(
    leg: FinishedRecipePropertyTransferMovementLeg,
    sourcePropertyId: string,
    destinationPropertyId: string,
    label: string
): void {
    requireNonBlank(leg.legId, `Property transfer ${label} leg ID`);
    if (
        leg.sourcePropertyId !== sourcePropertyId ||
        leg.destinationPropertyId !== destinationPropertyId
    ) {
        throw new Error(`Property transfer ${label} leg endpoints do not match the allocation`);
    }
    requireNonNegativeFinite(leg.distance, `Property transfer ${label} leg distance`);
    requireNonNegativeFinite(leg.durationMinutes, `Property transfer ${label} leg duration`);
}

function validateCoverage(value: string): void {
    if (value !== 'complete' && value !== 'partial') {
        throw new Error('Property transfer movement evidence coverage must be complete or partial');
    }
}

function requireNonBlank(value: string, label: string): void {
    if (value.trim().length === 0) throw new Error(`${label} must not be blank`);
}

function requirePositiveSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${label} must be a positive safe integer`);
    }
}

function requirePositiveFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive and finite`);
}

function requireNonNegativeFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${label} must be non-negative and finite`);
    }
}

function addFinite(left: number, right: number, label: string): number {
    const result = left + right;
    if (!Number.isFinite(result)) throw new Error(`${label} must be finite`);
    return result;
}

function multiplyFinite(left: number, right: number, label: string): number {
    const result = left * right;
    if (!Number.isFinite(result)) throw new Error(`${label} must be finite`);
    return result;
}
