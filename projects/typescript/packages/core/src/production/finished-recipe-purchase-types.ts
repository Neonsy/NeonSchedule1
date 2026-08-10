import type { RankReference } from '#core/data/progression';
import type { FinishedRecipePropertyTransferPlan } from '#core/production/property-transfer-types';
import type { ShopPurchaseOption } from '#core/world/shop-routing';
import type { Vector3 } from '#core/data/common';

export interface FinishedRecipeSellerEligibilityEvidence {
    /** Complete coverage makes an omitted normalized shop exactly inaccessible. */
    readonly coverage: 'complete' | 'partial';
    readonly accessibleShopCodes: readonly string[];
}

export interface FinishedRecipeItemEligibilityEvidence {
    /** Complete coverage makes an omitted normalized item exactly unavailable at current progression. */
    readonly coverage: 'complete' | 'partial';
    readonly eligibleItemIds: readonly string[];
}

export interface FinishedRecipePurchaseInput {
    readonly transferPlan: FinishedRecipePropertyTransferPlan;
    readonly itemEligibility: FinishedRecipeItemEligibilityEvidence;
    readonly sellerEligibility: FinishedRecipeSellerEligibilityEvidence;
    readonly start: Vector3;
    readonly maximumStartSnapDistance: number;
    readonly maximumAccessSnapDistance: number;
    /** When supplied, only sellers known to be open at this HHMM game time may be allocated. */
    readonly atTime?: number;
}

export interface FinishedRecipePurchaseRequirement {
    readonly propertyId: string;
    readonly itemId: string;
    readonly materialQuantity: number | null;
    readonly equipmentQuantity: number | null;
    readonly requestedQuantity: number | null;
}

export type FinishedRecipeSellerEligibility =
    | {
        readonly kind: 'supported';
        /** Null means normalized unlimited stock. */
        readonly quantityCapacity: number | null;
    }
    | {
        readonly kind: 'unavailable';
        readonly reason:
            | 'item-inaccessible'
            | 'shop-inaccessible'
            | 'shop-closed-at-requested-time'
            | 'remote-delivery-unavailable'
            | 'no-reachable-access';
    }
    | {
        readonly kind: 'unknown';
        readonly reason:
            | 'item-eligibility-evidence-incomplete'
            | 'shop-access-evidence-incomplete'
            | 'stock-quantity-unknown'
            | 'physical-access-data-missing'
            | 'schedule-data-missing-at-requested-time';
    };

export interface FinishedRecipePurchaseSellerOption {
    readonly priceRank: number;
    readonly option: ShopPurchaseOption;
    readonly eligibility: FinishedRecipeSellerEligibility;
}

export interface FinishedRecipePurchaseAllocation {
    readonly shopCode: string;
    readonly itemId: string;
    readonly quantity: number;
    readonly equipmentQuantity: number;
    readonly materialQuantity: number;
    readonly unitPrice: number;
    readonly totalPrice: number;
}

export interface FinishedRecipePurchaseItemPlan {
    readonly itemId: string;
    readonly requiredRank: RankReference | null;
    readonly itemEligibility: 'eligible' | 'ineligible' | 'unknown';
    readonly materialQuantity: number;
    readonly equipmentQuantity: number;
    readonly requestedQuantity: number;
    readonly sellerEvidenceProof: 'exact' | 'incomplete';
    readonly allocationProof: 'minimum-cost' | 'minimum-cost-among-supported-sellers';
    readonly sellerOptions: readonly FinishedRecipePurchaseSellerOption[];
    readonly allocations: readonly FinishedRecipePurchaseAllocation[];
    readonly knownAllocatedQuantity: number;
    readonly unallocatedAfterSupportedPurchases: number;
    readonly finalUnallocatedQuantity: number | null;
    readonly knownAllocatedCost: number;
    readonly minimumRequiredPurchaseCost: number | null;
}

export interface FinishedRecipePurchasePlan {
    readonly objective: 'maximize-supported-fulfillment-then-minimize-cost-per-item';
    readonly tieBreak: 'unit-price-then-shop-code';
    readonly routeOptimization: 'not-evaluated';
    readonly timingProof: 'not-evaluated' | 'evaluated-at-requested-time';
    readonly demandProof: 'exact' | 'transfer-residual-incomplete';
    readonly sellerEvidenceProof: 'exact' | 'incomplete' | 'not-evaluated';
    readonly allocationProof:
        | 'minimum-cost'
        | 'minimum-cost-among-supported-sellers'
        | 'not-evaluated';
    readonly fulfillmentProof:
        | 'exact'
        | 'seller-evidence-incomplete'
        | 'transfer-residual-incomplete';
    readonly requirements: readonly FinishedRecipePurchaseRequirement[];
    readonly items: readonly FinishedRecipePurchaseItemPlan[];
    readonly allocations: readonly FinishedRecipePurchaseAllocation[];
    readonly totalRequestedQuantity: number | null;
    readonly knownAllocatedQuantity: number;
    readonly unallocatedAfterSupportedPurchases: number | null;
    readonly totalFinalUnallocatedQuantity: number | null;
    readonly knownAllocatedCost: number;
    readonly minimumRequiredPurchaseCost: number | null;
}
