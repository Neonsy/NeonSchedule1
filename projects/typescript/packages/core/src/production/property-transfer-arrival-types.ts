import type {
    FinishedRecipePropertyTransferAllocation,
    FinishedRecipePropertyTransferPlan,
} from '#core/production/property-transfer-types';

export interface FinishedRecipePropertyTransferMovementLeg {
    readonly legId: string;
    readonly sourcePropertyId: string;
    readonly destinationPropertyId: string;
    readonly distance: number;
    readonly durationMinutes: number;
}

export interface FinishedRecipePropertyTransferMovementAssignment {
    readonly candidateId: string;
    readonly itemId: string;
    readonly sourcePropertyId: string;
    readonly destinationPropertyId: string;
    readonly movementModelId: string;
    readonly carryingCapacity: number;
    readonly itemLoadUnits: number;
    readonly startMinute: number;
    readonly loadMinutesPerTrip: number;
    readonly unloadMinutesPerTrip: number;
    readonly outboundLeg: FinishedRecipePropertyTransferMovementLeg | null;
    readonly returnLeg: FinishedRecipePropertyTransferMovementLeg | null;
}

export interface FinishedRecipePropertyTransferMovementEvidence {
    /** Complete coverage makes an omitted selected allocation or required leg exactly unavailable. */
    readonly coverage: 'complete' | 'partial';
    /** Bounds materialized trips for each allocation. */
    readonly maximumTripsPerAllocation: number;
    readonly assignments: readonly FinishedRecipePropertyTransferMovementAssignment[];
}

export interface FinishedRecipePropertyTransferArrivalTrip {
    readonly tripIndex: number;
    readonly quantity: number;
    readonly loadUnits: number;
    readonly startMinute: number;
    readonly departureMinute: number;
    readonly arrivalMinute: number;
    readonly completionMinute: number;
    readonly outboundLeg: FinishedRecipePropertyTransferMovementLeg;
    readonly returnLeg: FinishedRecipePropertyTransferMovementLeg | null;
    readonly returnArrivalMinute: number | null;
}

export interface FinishedRecipePropertyTransferAllocationArrival
    extends FinishedRecipePropertyTransferAllocation {
    readonly movementModelId: string;
    readonly carryingCapacity: number;
    readonly itemLoadUnits: number;
    readonly startMinute: number;
    readonly loadMinutesPerTrip: number;
    readonly unloadMinutesPerTrip: number;
    readonly trips: readonly FinishedRecipePropertyTransferArrivalTrip[];
    readonly completionMinute: number;
}

export interface FinishedRecipePropertyTransferDestinationArrival {
    readonly propertyId: string;
    readonly completionMinute: number;
}

export interface FinishedRecipePropertyTransferArrivalEvidenceGap {
    readonly code:
        | 'movement-assignment-not-recorded'
        | 'outbound-leg-not-recorded'
        | 'return-leg-not-recorded'
        | 'carrying-capacity-too-small'
        | 'trip-limit-exceeded';
    readonly candidateId: string;
    readonly itemId: string;
    readonly sourcePropertyId: string;
    readonly destinationPropertyId: string;
}

export interface FinishedRecipePropertyTransferArrivalPlan {
    readonly scope: 'selected-property-transfer-allocations';
    readonly routeOptimization: 'not-evaluated';
    readonly carryingModel: 'caller-supplied-load-units';
    readonly tripModel: 'each-allocation-runs-between-its-source-and-destination';
    readonly scheduleModel: 'caller-supplied-independent-allocation-start-times';
    readonly proof: 'exact-selected-allocation-timing';
    readonly evidenceProof: 'complete' | 'selected-allocations-supported';
    readonly maximumTripsPerAllocation: number;
    readonly arrivals: readonly FinishedRecipePropertyTransferAllocationArrival[];
    readonly destinations: readonly FinishedRecipePropertyTransferDestinationArrival[];
    readonly completionMinute: number | null;
}

export type FinishedRecipePropertyTransferArrivalResult =
    | {
        readonly kind: 'planned';
        readonly plan: FinishedRecipePropertyTransferArrivalPlan;
    }
    | {
        readonly kind: 'not-planned';
        readonly reason: 'selected-allocation-movement-unavailable';
        readonly proof: 'exact' | 'incomplete';
        readonly evidenceGaps: readonly FinishedRecipePropertyTransferArrivalEvidenceGap[];
        readonly arrivals: readonly FinishedRecipePropertyTransferAllocationArrival[];
    };

export interface FinishedRecipePropertyTransferArrivalInput {
    readonly transferPlan: FinishedRecipePropertyTransferPlan;
    readonly movementEvidence: FinishedRecipePropertyTransferMovementEvidence;
}
