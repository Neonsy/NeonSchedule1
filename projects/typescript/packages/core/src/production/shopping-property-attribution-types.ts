import type { FinishedRecipePurchasePlan } from '#core/production/finished-recipe-purchase-types';
import type {
    FinishedRecipeShoppingAllocation,
    FinishedRecipeShoppingRoutePlan,
} from '#core/production/shopping-route-types';

interface FinishedRecipeShoppingPropertyAssignmentBase {
    readonly shopCode: string;
    readonly itemId: string;
    readonly quantity: number;
}

export type FinishedRecipeShoppingPropertyAssignment =
    | FinishedRecipeShoppingPropertyAssignmentBase & {
        readonly access: 'physical';
        readonly destination: {
            readonly kind: 'property';
            readonly propertyId: string;
            readonly arrivalMinute: number;
            readonly evidence: 'caller-supplied-physical-property-arrival';
        };
    }
    | FinishedRecipeShoppingPropertyAssignmentBase & {
        readonly access: 'physical';
        readonly destination: {
            readonly kind: 'shared';
            readonly reason: 'destination-property-not-established';
        };
    }
    | FinishedRecipeShoppingPropertyAssignmentBase & {
        readonly access: 'remote-delivery';
        readonly destination: {
            readonly kind: 'property';
            readonly propertyId: string;
            readonly arrivalMinute: number;
            readonly evidence: 'caller-supplied-remote-delivery-destination';
        };
    }
    | FinishedRecipeShoppingPropertyAssignmentBase & {
        readonly access: 'remote-delivery';
        readonly destination: {
            readonly kind: 'shared';
            readonly reason: 'destination-property-not-established';
        };
    };

export interface FinishedRecipeShoppingPropertyAttributionEvidence {
    /** Complete coverage makes an omitted selected quantity exactly unattributed. */
    readonly coverage: 'complete' | 'partial';
    readonly assignments: readonly FinishedRecipeShoppingPropertyAssignment[];
}

export interface FinishedRecipeShoppingPropertyAllocation
    extends FinishedRecipeShoppingAllocation {
    readonly propertyId: string;
    readonly sourceCompletionMinute: number;
    readonly arrivalMinute: number;
    readonly destinationEvidence:
        | 'caller-supplied-physical-property-arrival'
        | 'caller-supplied-remote-delivery-destination';
}

export interface FinishedRecipeShoppingSharedAllocation
    extends FinishedRecipeShoppingAllocation {
    readonly sourceCompletionMinute: number;
    readonly reason:
        | 'destination-property-not-established'
        | 'attribution-assignment-not-recorded';
}

export interface FinishedRecipeShoppingPropertyAttributionGap {
    readonly code:
        | 'selected-allocation-attribution-missing'
        | 'shared-destination-property'
        | 'property-demand-attribution-missing';
    readonly shopCode: string | null;
    readonly itemId: string;
    readonly access: FinishedRecipeShoppingAllocation['access'] | null;
    readonly propertyId: string | null;
    readonly quantity: number;
}

export interface FinishedRecipeShoppingPropertyAttributionDetails {
    readonly scope: 'selected-shopping-allocations-by-destination-property';
    readonly assignmentModel: 'caller-supplied-selected-allocation-partitions';
    readonly evidenceProof: 'complete' | 'selected-allocations-supported' | 'partial';
    readonly evidence: FinishedRecipeShoppingPropertyAttributionEvidence;
    readonly allocations: readonly FinishedRecipeShoppingPropertyAllocation[];
    readonly sharedAllocations: readonly FinishedRecipeShoppingSharedAllocation[];
    readonly gaps: readonly FinishedRecipeShoppingPropertyAttributionGap[];
}

export type FinishedRecipeShoppingPropertyAttributionResult =
    FinishedRecipeShoppingPropertyAttributionDetails & (
        | {
            readonly kind: 'attributed';
            readonly proof: 'exact';
        }
        | {
            readonly kind: 'not-attributed';
            readonly reason: 'destination-property-attribution-unavailable';
            readonly proof: 'exact' | 'incomplete';
        }
    );

export interface FinishedRecipeShoppingPropertyAttributionInput {
    readonly purchasePlan: FinishedRecipePurchasePlan;
    readonly routePlan: FinishedRecipeShoppingRoutePlan;
    readonly evidence: FinishedRecipeShoppingPropertyAttributionEvidence;
}
