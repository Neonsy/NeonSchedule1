import type { FinishedRecipePurchasePlan } from '#core/production/finished-recipe-purchase-types';

export type FinishedRecipeShoppingObjective =
    | 'minimum-purchase-cost'
    | 'minimum-elapsed-minutes'
    | 'minimum-travel-distance';

export interface FinishedRecipeShoppingMovementModel {
    readonly modelId: string;
    readonly carryingCapacity: number;
    readonly itemLoadUnits: readonly {
        readonly itemId: string;
        readonly loadUnitsPerItem: number;
    }[];
    readonly startMinute: number;
    readonly serviceMinutesPerVisit: number;
}

export interface FinishedRecipeShoppingTravelLeg {
    readonly legId: string;
    readonly fromLocationId: string;
    readonly toLocationId: string;
    readonly distance: number;
    readonly durationMinutes: number;
}

export interface FinishedRecipeShoppingTravelEvidence {
    /** Complete coverage makes an omitted directed pair exactly unreachable. */
    readonly coverage: 'complete' | 'partial';
    readonly depotLocationId: string;
    readonly legs: readonly FinishedRecipeShoppingTravelLeg[];
}

export interface FinishedRecipeRemoteDeliveryFact {
    readonly shopCode: string;
    /** Elapsed from route start until this supplier's delivery is available. */
    readonly durationMinutes: number;
}

export interface FinishedRecipeRemoteDeliveryEvidence {
    /** Complete coverage makes an omitted remote supplier exactly unavailable. */
    readonly coverage: 'complete' | 'partial';
    readonly deliveries: readonly FinishedRecipeRemoteDeliveryFact[];
}

export interface FinishedRecipeShoppingRouteInput {
    readonly purchasePlan: FinishedRecipePurchasePlan;
    readonly objective: FinishedRecipeShoppingObjective;
    readonly movement: FinishedRecipeShoppingMovementModel;
    readonly travel: FinishedRecipeShoppingTravelEvidence;
    readonly remoteDelivery: FinishedRecipeRemoteDeliveryEvidence;
    readonly maximumStates: number;
}

export interface FinishedRecipeShoppingEvidenceGap {
    readonly code:
        | 'purchase-seller-evidence-incomplete'
        | 'purchase-time-filtered-before-route'
        | 'travel-evidence-partial'
        | 'remote-delivery-evidence-partial'
        | 'seller-stock-unknown'
        | 'seller-eligibility-unknown'
        | 'physical-shop-schedule-missing'
        | 'remote-delivery-duration-missing';
    readonly itemId: string | null;
    readonly shopCode: string | null;
}

export interface FinishedRecipeShoppingAllocation {
    readonly shopCode: string;
    readonly itemId: string;
    readonly access: 'physical' | 'remote-delivery';
    readonly quantity: number;
    readonly unitPrice: number;
    readonly totalPrice: number;
}

export interface FinishedRecipeShoppingRouteVisit {
    readonly shopCode: string;
    readonly leg: FinishedRecipeShoppingTravelLeg;
    readonly arrivalMinute: number;
    readonly waitingMinutes: number;
    readonly serviceStartMinute: number;
    readonly departureMinute: number;
    readonly pickedUp: readonly {
        readonly itemId: string;
        readonly quantity: number;
        readonly loadUnits: number;
    }[];
    readonly carriedLoadUnitsAfterVisit: number;
}

export interface FinishedRecipeShoppingTrip {
    readonly tripIndex: number;
    readonly startMinute: number;
    readonly endMinute: number;
    readonly elapsedMinutes: number;
    readonly travelDistance: number;
    readonly peakCarriedLoadUnits: number;
    readonly visits: readonly FinishedRecipeShoppingRouteVisit[];
    readonly returnLeg: FinishedRecipeShoppingTravelLeg;
}

export interface FinishedRecipeRemoteDeliveryAllocation {
    readonly shopCode: string;
    readonly completionMinute: number;
    readonly allocations: readonly FinishedRecipeShoppingAllocation[];
}

export interface FinishedRecipeShoppingRoutePlan {
    readonly objective: FinishedRecipeShoppingObjective;
    readonly tieBreak:
        'remaining-metrics-then-trip-count-then-canonical-shop-item-identity-order';
    readonly movementModelId: string;
    readonly carryingModel: 'caller-supplied-load-units';
    readonly tripModel: 'each-trip-starts-and-returns-to-depot';
    readonly scheduleModel: 'service-start-must-be-within-recurring-shop-window';
    readonly remoteDeliveryModel: 'caller-supplied-concurrent-duration-from-route-start';
    readonly proof: 'optimal' | 'best-known-feasible';
    readonly evidenceProof: 'complete' | 'incomplete';
    readonly searchProof: 'exhaustive' | 'state-limit-reached';
    readonly evidenceGaps: readonly FinishedRecipeShoppingEvidenceGap[];
    readonly visitedStates: number;
    readonly maximumStates: number;
    readonly allocations: readonly FinishedRecipeShoppingAllocation[];
    readonly trips: readonly FinishedRecipeShoppingTrip[];
    readonly remoteDeliveries: readonly FinishedRecipeRemoteDeliveryAllocation[];
    readonly totalPurchaseCost: number;
    readonly totalTravelDistance: number;
    readonly physicalCompletionMinute: number;
    readonly remoteCompletionMinute: number;
    readonly completionMinute: number;
    readonly elapsedMinutes: number;
}

export type FinishedRecipeShoppingRouteResult =
    | { readonly kind: 'planned'; readonly plan: FinishedRecipeShoppingRoutePlan }
    | {
        readonly kind: 'not-planned';
        readonly reason:
            | 'purchase-demand-incomplete'
            | 'no-supported-complete-fulfillment'
            | 'no-known-feasible-route'
            | 'search-limit-before-feasible-plan';
        readonly proof: 'exact' | 'incomplete';
        readonly evidenceGaps: readonly FinishedRecipeShoppingEvidenceGap[];
        readonly visitedStates: number;
        readonly maximumStates: number;
    };
