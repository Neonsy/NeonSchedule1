import type { FinishedRecipeProductionPlan } from '#core/production/finished-recipe';
import type { FinishedRecipePurchasePlan } from '#core/production/finished-recipe-purchase-types';
import type { FinishedRecipePropertyTransferPlan } from '#core/production/property-transfer-types';
import type { FinishedRecipePropertyTransferArrivalResult } from '#core/production/property-transfer-arrival-types';
import type { ProductionPlanDataset } from '#core/production/plan';
import type { FinishedRecipeShoppingRouteResult } from '#core/production/shopping-route-types';
import type { FinishedRecipeShoppingPropertyAttributionResult } from '#core/production/shopping-property-attribution-types';

export type FinishedRecipeShoppingNotPlannedReason = Extract<
    FinishedRecipeShoppingRouteResult,
    { readonly kind: 'not-planned' }
>['reason'];

export type FinishedRecipeShoppingArrivalDestination =
    | {
        readonly kind: 'production-property';
        readonly propertyId: string;
        readonly evidence: 'caller-supplied-depot-and-remote-delivery-destination';
    }
    | { readonly kind: 'not-established' };

export interface FinishedRecipeProductionReadinessInput {
    readonly propertyId: string;
    readonly productionPlan: FinishedRecipeProductionPlan;
    readonly transferPlan: FinishedRecipePropertyTransferPlan;
    readonly propertyTransferArrivals?: FinishedRecipePropertyTransferArrivalResult;
    readonly purchasePlan: FinishedRecipePurchasePlan;
    readonly shopping: {
        /** Identifies the normalized dataset used to build the shopping evidence. */
        readonly dataset: ProductionPlanDataset;
        readonly arrivalDestination: FinishedRecipeShoppingArrivalDestination;
        readonly route: FinishedRecipeShoppingRouteResult;
        readonly propertyAttribution?: FinishedRecipeShoppingPropertyAttributionResult;
    };
}

export interface FinishedRecipeProductionReadinessGap {
    readonly code:
        | 'production-inventory-incomplete'
        | 'property-transfer-residual-incomplete'
        | 'purchase-fulfillment-incomplete'
        | 'purchase-allocation-by-property-unavailable'
        | 'shopping-property-attribution-incomplete'
        | 'shopping-route-not-planned'
        | 'shopping-arrival-destination-not-established'
        | 'shopping-arrival-at-other-property'
        | 'property-transfer-arrival-not-evaluated'
        | 'property-transfer-arrival-not-planned';
    readonly itemId: string | null;
    readonly propertyId: string | null;
    readonly shoppingReason: FinishedRecipeShoppingNotPlannedReason | null;
}

export interface FinishedRecipeProductionInputReadiness {
    readonly itemId: string;
    readonly requiredMaterialQuantity: number;
    readonly requiredEquipmentQuantity: number;
    readonly currentAppliedQuantity: number;
    readonly transferredQuantity: number;
    readonly transferArrivalMinute: number | null;
    readonly purchasedQuantity: number;
    readonly purchaseArrivalMinute: number | null;
    readonly readyMinute: number | null;
    readonly readinessProof:
        | 'exact'
        | 'purchase-not-fulfilled'
        | 'shopping-arrival-unavailable'
        | 'property-transfer-arrival-unavailable';
}

export interface FinishedRecipeProductionReadinessResult {
    readonly scope: 'one-property-production-input-availability';
    readonly persistence: 'not-modeled';
    readonly livePurchaseInteraction: 'not-modeled';
    readonly dataset: ProductionPlanDataset;
    readonly propertyId: string;
    readonly status: 'ready' | 'not-ready' | 'unavailable';
    readonly readinessProof: 'exact' | 'incomplete';
    readonly shoppingRouteProof:
        | 'optimal'
        | 'best-known-feasible'
        | 'exact-not-planned'
        | 'incomplete-not-planned';
    readonly routeStartMinute: number | null;
    readonly shoppingCompletionMinute: number | null;
    readonly productionInputsReadyMinute: number | null;
    readonly inputs: readonly FinishedRecipeProductionInputReadiness[];
    readonly gaps: readonly FinishedRecipeProductionReadinessGap[];
}
