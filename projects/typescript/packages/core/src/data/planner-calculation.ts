import { type } from 'arktype';

import { MixingRuleProfileSchema } from '#core/data/mixing';
import {
    PlannerCompatibilitySchema,
    PlannerInventoryOwnerSchema,
    PlannerStringSetValueSchema,
    PlannerUnknownValueSchema,
    PlannerVector3ValueSchema,
} from '#core/data/planner-profile';

export const PlannerManualStateSourceSchema = type({
    kind: "'manual-state'",
    documentId: 'string',
});
export const PlannerObservationStateSourceSchema = type({
    kind: "'observation'",
    documentId: 'string',
});
export const PlannerCalculationStateSourceSchema = PlannerManualStateSourceSchema.or(
    PlannerObservationStateSourceSchema
);
export type PlannerCalculationStateSource = typeof PlannerCalculationStateSourceSchema.infer;

export const PlannerNoInventorySourceSchema = type({ kind: "'none'" });
export const PlannerManualInventorySourceSchema = type({
    kind: "'manual-inventories'",
    documentIds: 'string[]',
});
export const PlannerObservationInventorySourceSchema = type({
    kind: "'observation'",
    documentId: 'string',
});
export const PlannerCalculationInventorySourceSchema = PlannerNoInventorySourceSchema
    .or(PlannerManualInventorySourceSchema)
    .or(PlannerObservationInventorySourceSchema);
export type PlannerCalculationInventorySource =
    typeof PlannerCalculationInventorySourceSchema.infer;

export const PlannerCalculationContextSelectionSchema = type({
    state: PlannerCalculationStateSourceSchema,
    inventories: PlannerCalculationInventorySourceSchema,
    reconciliation: "'explicit-sources-no-automatic-merge'",
}).onDeepUndeclaredKey('reject');
export type PlannerCalculationContextSelection =
    typeof PlannerCalculationContextSelectionSchema.infer;

export const PlannerProgressionRequestFactsSchema = type({
    unlockedProductIds: PlannerStringSetValueSchema,
    accessibleShopCodes: PlannerStringSetValueSchema,
}).onDeepUndeclaredKey('reject');
export type PlannerProgressionRequestFacts = typeof PlannerProgressionRequestFactsSchema.infer;

export const PlannerProductionIdentitySchema = type({
    recipe: {
        productId: 'string',
        ingredientIds: 'string[]',
        ruleProfile: MixingRuleProfileSchema,
    },
    finishedQuantity: 'number',
    propertyId: 'string',
    inventoryOwner: PlannerInventoryOwnerSchema.or(type('null')),
});
export type PlannerProductionIdentity = typeof PlannerProductionIdentitySchema.infer;

export const PlannerMovementPositionSchema = type({
    locationId: 'string',
    source: "'planner-state' | 'static-dataset' | 'request'",
    observedAt: 'string | null',
    position: PlannerVector3ValueSchema,
});
export type PlannerMovementPosition = typeof PlannerMovementPositionSchema.infer;

export const PlannerKnownMovementPositionsSchema = type({
    status: "'known'",
    coverage: "'complete' | 'partial'",
    values: PlannerMovementPositionSchema.array(),
});
export const PlannerMovementPositionsSchema = PlannerUnknownValueSchema.or(
    PlannerKnownMovementPositionsSchema
);
export type PlannerMovementPositions = typeof PlannerMovementPositionsSchema.infer;

export const PlannerPropertyTransferSupplySchema = type({
    propertyId: 'string',
    itemId: 'string',
    transferableQuantity: 'number',
});
export type PlannerPropertyTransferSupply = typeof PlannerPropertyTransferSupplySchema.infer;

export const PlannerPropertyTransferCandidateSchema = type({
    candidateId: 'string',
    itemId: 'string',
    sourcePropertyId: 'string',
    destinationPropertyId: 'string',
    quantityCapacity: 'number | null',
});
export type PlannerPropertyTransferCandidate = typeof PlannerPropertyTransferCandidateSchema.infer;

export const PlannerPropertyTransferEvidenceSchema = type({
    coverage: "'complete' | 'partial'",
    candidates: PlannerPropertyTransferCandidateSchema.array(),
});
export type PlannerPropertyTransferEvidence = typeof PlannerPropertyTransferEvidenceSchema.infer;

export const PlannerPropertyTransferMovementLegSchema = type({
    legId: 'string',
    sourcePropertyId: 'string',
    destinationPropertyId: 'string',
    distance: 'number',
    durationMinutes: 'number',
});
export type PlannerPropertyTransferMovementLeg =
    typeof PlannerPropertyTransferMovementLegSchema.infer;

export const PlannerPropertyTransferMovementAssignmentSchema = type({
    candidateId: 'string',
    itemId: 'string',
    sourcePropertyId: 'string',
    destinationPropertyId: 'string',
    movementModelId: 'string',
    carryingCapacity: 'number',
    itemLoadUnits: 'number',
    startMinute: 'number',
    loadMinutesPerTrip: 'number',
    unloadMinutesPerTrip: 'number',
    outboundLeg: PlannerPropertyTransferMovementLegSchema.or(type('null')),
    returnLeg: PlannerPropertyTransferMovementLegSchema.or(type('null')),
});
export type PlannerPropertyTransferMovementAssignment =
    typeof PlannerPropertyTransferMovementAssignmentSchema.infer;

export const PlannerPropertyTransferMovementEvidenceSchema = type({
    coverage: "'complete' | 'partial'",
    maximumTripsPerAllocation: 'number',
    assignments: PlannerPropertyTransferMovementAssignmentSchema.array(),
});
export type PlannerPropertyTransferMovementEvidence =
    typeof PlannerPropertyTransferMovementEvidenceSchema.infer;

export const PlannerKnownPropertyTransferMovementEvidenceSchema = type({
    status: "'known'",
    value: PlannerPropertyTransferMovementEvidenceSchema,
});
export const PlannerPropertyTransferMovementValueSchema = PlannerUnknownValueSchema.or(
    PlannerKnownPropertyTransferMovementEvidenceSchema
);
export type PlannerPropertyTransferMovementValue =
    typeof PlannerPropertyTransferMovementValueSchema.infer;

export const PlannerKnownPropertyTransferRequestSchema = type({
    status: "'known'",
    value: {
        supplies: PlannerPropertyTransferSupplySchema.array(),
        evidence: PlannerPropertyTransferEvidenceSchema,
        movement: PlannerPropertyTransferMovementValueSchema,
    },
});
export const PlannerPropertyTransferRequestSchema = PlannerUnknownValueSchema.or(
    PlannerKnownPropertyTransferRequestSchema
);
export type PlannerPropertyTransferRequest = typeof PlannerPropertyTransferRequestSchema.infer;

export const PlannerShoppingItemLoadSchema = type({
    itemId: 'string',
    loadUnitsPerItem: 'number',
});

export const PlannerShoppingMovementModelSchema = type({
    modelId: 'string',
    carryingCapacity: 'number',
    itemLoadUnits: PlannerShoppingItemLoadSchema.array(),
    startMinute: 'number',
    serviceMinutesPerVisit: 'number',
});
export type PlannerShoppingMovementModel = typeof PlannerShoppingMovementModelSchema.infer;

export const PlannerShoppingTravelLegSchema = type({
    legId: 'string',
    fromLocationId: 'string',
    toLocationId: 'string',
    distance: 'number',
    durationMinutes: 'number',
});
export type PlannerShoppingTravelLeg = typeof PlannerShoppingTravelLegSchema.infer;

export const PlannerShoppingTravelEvidenceSchema = type({
    coverage: "'complete' | 'partial'",
    depotLocationId: 'string',
    legs: PlannerShoppingTravelLegSchema.array(),
});
export type PlannerShoppingTravelEvidence = typeof PlannerShoppingTravelEvidenceSchema.infer;

export const PlannerRemoteDeliveryFactSchema = type({
    shopCode: 'string',
    durationMinutes: 'number',
});

export const PlannerRemoteDeliveryEvidenceSchema = type({
    coverage: "'complete' | 'partial'",
    deliveries: PlannerRemoteDeliveryFactSchema.array(),
});
export type PlannerRemoteDeliveryEvidence = typeof PlannerRemoteDeliveryEvidenceSchema.infer;

export const PlannerKnownShoppingRequestSchema = type({
    status: "'known'",
    value: {
        objective:
            "'minimum-purchase-cost' | 'minimum-elapsed-minutes' | 'minimum-travel-distance'",
        movement: PlannerShoppingMovementModelSchema,
        travel: PlannerShoppingTravelEvidenceSchema,
        remoteDelivery: PlannerRemoteDeliveryEvidenceSchema,
        maximumStates: 'number',
    },
});
export const PlannerShoppingRequestSchema = PlannerUnknownValueSchema.or(
    PlannerKnownShoppingRequestSchema
);
export type PlannerShoppingRequest = typeof PlannerShoppingRequestSchema.infer;

export const PlannerKnownProductionExecutionSchema = type({
    status: "'known'",
    value: {
        startMinute: 'number',
        executionModel: "'caller-supplied-exclusive-sequential-execution'",
    },
});
export const PlannerProductionExecutionSchema = PlannerUnknownValueSchema.or(
    PlannerKnownProductionExecutionSchema
);
export type PlannerProductionExecution = typeof PlannerProductionExecutionSchema.infer;

const saleBase = {
    sellerId: 'string',
    destinationId: 'string',
    quantity: 'number',
    startMinute: 'number',
    completionMinute: 'number',
} as const;

export const PlannerDirectSaleSchema = type({
    ...saleBase,
    kind: "'direct'",
    travelDurationMinutes: 'number',
    completionRule: "'caller-supplied-sale-confirmed-at-destination'",
});
export const PlannerDeliveredSaleSchema = type({
    ...saleBase,
    kind: "'delivered'",
    deliveryDurationMinutes: 'number',
    completionRule: "'caller-supplied-delivery-confirmed-at-destination'",
});
export const PlannerSaleSchema = PlannerDirectSaleSchema.or(PlannerDeliveredSaleSchema);
export type PlannerSale = typeof PlannerSaleSchema.infer;

export const PlannerKnownSaleSchema = type({
    status: "'known'",
    value: PlannerSaleSchema,
});
export const PlannerSaleValueSchema = PlannerUnknownValueSchema.or(PlannerKnownSaleSchema);
export type PlannerSaleValue = typeof PlannerSaleValueSchema.infer;

export const PlannerKnownRealizedRevenueSchema = type({
    status: "'known'",
    value: {
        coverage: "'complete' | 'partial'",
        recordedRevenue: 'number',
    },
});
export const PlannerRealizedRevenueSchema = PlannerUnknownValueSchema.or(
    PlannerKnownRealizedRevenueSchema
);
export type PlannerRealizedRevenue = typeof PlannerRealizedRevenueSchema.infer;

export const PlannerRealizedCostTreatmentSchema = type({
    category: "'materials' | 'equipment' | 'labor' | 'transport' | 'sale-fees' | 'other'",
    treatment: "'included' | 'not-incurred'",
    amount: 'number',
});
export type PlannerRealizedCostTreatment = typeof PlannerRealizedCostTreatmentSchema.infer;

export const PlannerKnownRealizedCostsSchema = type({
    status: "'known'",
    value: {
        coverage: "'complete' | 'partial'",
        treatments: PlannerRealizedCostTreatmentSchema.array(),
    },
});
export const PlannerRealizedCostsSchema = PlannerUnknownValueSchema.or(
    PlannerKnownRealizedCostsSchema
);
export type PlannerRealizedCosts = typeof PlannerRealizedCostsSchema.infer;

export const PlannerProductionEvidenceRequestSchema = type({
    schema: "'neonschedule1-planner-production-evidence-request-1'",
    requestId: 'string',
    profileId: 'string',
    createdAt: 'string',
    compatibility: PlannerCompatibilitySchema,
    context: PlannerCalculationContextSelectionSchema,
    production: PlannerProductionIdentitySchema,
    positions: PlannerMovementPositionsSchema,
    propertyTransfers: PlannerPropertyTransferRequestSchema,
    shopping: PlannerShoppingRequestSchema,
    lifecycle: {
        execution: PlannerProductionExecutionSchema,
        sale: PlannerSaleValueSchema,
    },
    realized: {
        revenue: PlannerRealizedRevenueSchema,
        costs: PlannerRealizedCostsSchema,
    },
}).onDeepUndeclaredKey('reject');
export type PlannerProductionEvidenceRequest =
    typeof PlannerProductionEvidenceRequestSchema.infer;
