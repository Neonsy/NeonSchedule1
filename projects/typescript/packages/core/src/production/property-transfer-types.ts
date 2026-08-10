import type { FinishedRecipeInventoryPlan } from '#core/production/inventory';

export interface FinishedRecipePropertyTransferDestination {
    readonly propertyId: string;
    readonly inventory: FinishedRecipeInventoryPlan;
}

export interface FinishedRecipePropertyTransferSupply {
    readonly propertyId: string;
    readonly itemId: string;
    /** Whole items left after the caller reserves this property's own requirements. */
    readonly transferableQuantity: number;
}

export interface FinishedRecipePropertyTransferCandidate {
    readonly candidateId: string;
    readonly itemId: string;
    readonly sourcePropertyId: string;
    readonly destinationPropertyId: string;
    /** Exact total whole-item capacity for this plan, or null when capacity is unknown. */
    readonly quantityCapacity: number | null;
}

export interface FinishedRecipePropertyTransferEvidence {
    /** Complete coverage makes an omitted relevant source-destination pair exactly unavailable. */
    readonly coverage: 'complete' | 'partial';
    readonly candidates: readonly FinishedRecipePropertyTransferCandidate[];
}

export interface FinishedRecipePropertyTransferAllocation {
    readonly candidateId: string;
    readonly itemId: string;
    readonly sourcePropertyId: string;
    readonly destinationPropertyId: string;
    readonly quantity: number;
    readonly itemStackLimit: number;
    readonly stackCount: number;
}

export interface FinishedRecipePropertyTransferSourceResult {
    readonly propertyId: string;
    readonly itemId: string;
    readonly transferableQuantity: number;
    readonly allocatedQuantity: number;
    readonly remainingTransferableQuantity: number;
}

export interface FinishedRecipePropertyTransferRequirement {
    readonly propertyId: string;
    readonly itemId: string;
    readonly unitPurchasePrice: number | null;
    readonly materialReorderQuantity: number;
    readonly equipmentReorderQuantity: number;
    readonly requestedReorderQuantity: number;
    readonly allocatedQuantity: number;
    readonly allocatedEquipmentQuantity: number;
    readonly allocatedMaterialQuantity: number;
    readonly unallocatedEquipmentQuantity: number;
    readonly unallocatedMaterialQuantity: number;
    readonly unallocatedReorderQuantity: number;
    readonly residualEquipmentReorderQuantity: number | null;
    readonly residualMaterialReorderQuantity: number | null;
    readonly residualReorderQuantity: number | null;
    readonly residualEquipmentReorderCost: number | null;
    readonly residualMaterialReorderCost: number | null;
    readonly residualReorderCost: number | null;
}

export interface FinishedRecipePropertyTransferPlan {
    readonly objective: 'maximize-transferred-reorder-quantity-per-item';
    readonly tieBreak: 'canonical-item-source-destination-candidate-identity-order';
    readonly routeOptimization: 'not-evaluated';
    readonly demandProof: 'exact' | 'inventory-plan-incomplete';
    readonly transferEvidenceProof: 'exact' | 'partial';
    readonly allocationProof: 'maximum' | 'known-feasible-lower-bound' | 'not-evaluated';
    readonly residualProof:
        | 'exact'
        | 'inventory-plan-incomplete'
        | 'transfer-evidence-incomplete';
    readonly residualCostProof:
        | 'exact'
        | 'residual-quantity-not-exact'
        | 'item-price-not-recorded';
    readonly requirements: readonly FinishedRecipePropertyTransferRequirement[];
    readonly sources: readonly FinishedRecipePropertyTransferSourceResult[];
    readonly allocations: readonly FinishedRecipePropertyTransferAllocation[];
    readonly totalRequestedReorderQuantity: number | null;
    readonly knownAllocatedQuantity: number;
    readonly unallocatedAfterKnownTransfersQuantity: number | null;
    readonly totalResidualReorderQuantity: number | null;
    readonly totalResidualMaterialReorderCost: number | null;
    readonly totalResidualEquipmentReorderCost: number | null;
    readonly totalResidualReorderCost: number | null;
}
