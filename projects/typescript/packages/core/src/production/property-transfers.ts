import type { Item } from '#core/data/item';
import {
    maximizePropertyTransferQuantity,
    type PropertyTransferAllocatedEdge,
    type PropertyTransferAllocationDestination,
    type PropertyTransferAllocationEdge,
    type PropertyTransferAllocationSource,
} from '#core/production/property-transfer-allocation';
import {
    hasCompleteRelevantPropertyTransferEvidence,
    indexPropertyTransferCandidates,
    indexPropertyTransferDemands,
    indexPropertyTransferDestinations,
    indexPropertyTransferSupplies,
    propertyTransferDestinationKey,
    propertyTransferSourceKey,
    type IndexedPropertyTransferCandidate,
    type IndexedPropertyTransferDemand,
    type IndexedPropertyTransferSupply,
} from '#core/production/property-transfer-input';
import type {
    FinishedRecipePropertyTransferAllocation,
    FinishedRecipePropertyTransferDestination,
    FinishedRecipePropertyTransferEvidence,
    FinishedRecipePropertyTransferPlan,
    FinishedRecipePropertyTransferRequirement,
    FinishedRecipePropertyTransferSourceResult,
    FinishedRecipePropertyTransferSupply,
} from '#core/production/property-transfer-types';
export type {
    FinishedRecipePropertyTransferAllocation,
    FinishedRecipePropertyTransferCandidate,
    FinishedRecipePropertyTransferDestination,
    FinishedRecipePropertyTransferEvidence,
    FinishedRecipePropertyTransferPlan,
    FinishedRecipePropertyTransferRequirement,
    FinishedRecipePropertyTransferSourceResult,
    FinishedRecipePropertyTransferSupply,
} from '#core/production/property-transfer-types';

export function planFinishedRecipePropertyTransfers(
    itemsById: ReadonlyMap<string, Item>,
    destinations: readonly FinishedRecipePropertyTransferDestination[],
    supplies: readonly FinishedRecipePropertyTransferSupply[],
    evidence: FinishedRecipePropertyTransferEvidence
): FinishedRecipePropertyTransferPlan {
    if (evidence.coverage !== 'complete' && evidence.coverage !== 'partial') {
        throw new Error('Property transfer evidence coverage must be complete or partial');
    }
    const indexedDestinations = indexPropertyTransferDestinations(destinations);
    const indexedSupplies = indexPropertyTransferSupplies(itemsById, supplies);
    const demands = indexPropertyTransferDemands(itemsById, indexedDestinations);
    const candidates = indexPropertyTransferCandidates(
        itemsById,
        indexedDestinations,
        indexedSupplies,
        demands,
        evidence.candidates
    );
    const demandProof = destinations.every(
        (destination) => destination.inventory.quantityProof === 'exact'
    )
        ? 'exact'
        : 'inventory-plan-incomplete';
    const relevantEvidenceComplete = demandProof === 'exact' && hasCompleteRelevantPropertyTransferEvidence(
        indexedSupplies,
        demands,
        candidates,
        evidence.coverage
    );
    const transferEvidenceProof = relevantEvidenceComplete ? 'exact' : 'partial';

    if (demandProof !== 'exact') {
        return incompleteDemandPlan(indexedSupplies, demands, transferEvidenceProof);
    }

    const allocations = allocateByItem(itemsById, indexedSupplies, demands, candidates);
    const allocationProof = transferEvidenceProof === 'exact'
        ? 'maximum'
        : 'known-feasible-lower-bound';
    const residualProof = transferEvidenceProof === 'exact'
        ? 'exact'
        : 'transfer-evidence-incomplete';
    const allocationByDemand = sumByKey(
        allocations.map((allocation) => [
            propertyTransferDestinationKey(allocation.destinationPropertyId, allocation.itemId),
            allocation.quantity,
        ])
    );
    const allocationBySupply = sumByKey(
        allocations.map((allocation) => [
            propertyTransferSourceKey(allocation.sourcePropertyId, allocation.itemId),
            allocation.quantity,
        ])
    );
    const exactResidual = residualProof === 'exact';
    const requirements = demands.map((demand) => requirementResult(
        demand,
        allocationByDemand.get(demand.key) ?? 0,
        exactResidual
    ));
    const residualCostProof = !exactResidual
        ? 'residual-quantity-not-exact'
        : requirements.some(
              (requirement) =>
                  requirement.unallocatedReorderQuantity > 0 &&
                  requirement.residualReorderCost === null
          )
          ? 'item-price-not-recorded'
          : 'exact';
    const sourceResults = indexedSupplies.map((supply) => {
        const allocatedQuantity = allocationBySupply.get(supply.key) ?? 0;
        return {
            propertyId: supply.propertyId,
            itemId: supply.itemId,
            transferableQuantity: supply.transferableQuantity,
            allocatedQuantity,
            remainingTransferableQuantity: supply.transferableQuantity - allocatedQuantity,
        } satisfies FinishedRecipePropertyTransferSourceResult;
    });
    const totalRequested = safeSum(
        requirements.map((requirement) => requirement.requestedReorderQuantity),
        'Property transfer requested reorder quantity'
    );
    const knownAllocated = safeSum(
        allocations.map((allocation) => allocation.quantity),
        'Property transfer allocated quantity'
    );
    const unallocated = totalRequested - knownAllocated;

    return {
        objective: 'maximize-transferred-reorder-quantity-per-item',
        tieBreak: 'canonical-item-source-destination-candidate-identity-order',
        routeOptimization: 'not-evaluated',
        demandProof,
        transferEvidenceProof,
        allocationProof,
        residualProof,
        residualCostProof,
        requirements,
        sources: sourceResults,
        allocations,
        totalRequestedReorderQuantity: totalRequested,
        knownAllocatedQuantity: knownAllocated,
        unallocatedAfterKnownTransfersQuantity: unallocated,
        totalResidualReorderQuantity: exactResidual ? unallocated : null,
        totalResidualMaterialReorderCost: exactResidual
            ? sumExactCosts(requirements.map((requirement) => requirement.residualMaterialReorderCost))
            : null,
        totalResidualEquipmentReorderCost: exactResidual
            ? sumExactCosts(requirements.map((requirement) => requirement.residualEquipmentReorderCost))
            : null,
        totalResidualReorderCost: exactResidual
            ? sumExactCosts(requirements.map((requirement) => requirement.residualReorderCost))
            : null,
    };
}

function incompleteDemandPlan(
    supplies: readonly IndexedPropertyTransferSupply[],
    demands: readonly IndexedPropertyTransferDemand[],
    transferEvidenceProof: FinishedRecipePropertyTransferPlan['transferEvidenceProof']
): FinishedRecipePropertyTransferPlan {
    return {
        objective: 'maximize-transferred-reorder-quantity-per-item',
        tieBreak: 'canonical-item-source-destination-candidate-identity-order',
        routeOptimization: 'not-evaluated',
        demandProof: 'inventory-plan-incomplete',
        transferEvidenceProof,
        allocationProof: 'not-evaluated',
        residualProof: 'inventory-plan-incomplete',
        residualCostProof: 'residual-quantity-not-exact',
        requirements: demands.map((demand) => requirementResult(demand, 0, false)),
        sources: supplies.map((supply) => ({
            propertyId: supply.propertyId,
            itemId: supply.itemId,
            transferableQuantity: supply.transferableQuantity,
            allocatedQuantity: 0,
            remainingTransferableQuantity: supply.transferableQuantity,
        })),
        allocations: [],
        totalRequestedReorderQuantity: null,
        knownAllocatedQuantity: 0,
        unallocatedAfterKnownTransfersQuantity: null,
        totalResidualReorderQuantity: null,
        totalResidualMaterialReorderCost: null,
        totalResidualEquipmentReorderCost: null,
        totalResidualReorderCost: null,
    };
}

function allocateByItem(
    itemsById: ReadonlyMap<string, Item>,
    supplies: readonly IndexedPropertyTransferSupply[],
    demands: readonly IndexedPropertyTransferDemand[],
    candidates: readonly IndexedPropertyTransferCandidate[]
): readonly FinishedRecipePropertyTransferAllocation[] {
    const itemIds = [...new Set(demands.map((demand) => demand.itemId))].sort();
    return itemIds.flatMap((itemId) => {
        const item = requireStorableItem(itemsById, itemId, 'allocation');
        const itemSources = supplies.filter(
            (supply) => supply.itemId === itemId && supply.transferableQuantity > 0
        );
        const itemDemands = demands.filter((demand) => demand.itemId === itemId);
        const sourceInputs: PropertyTransferAllocationSource[] = itemSources.map((supply) => ({
            key: supply.key,
            capacity: supply.transferableQuantity,
        }));
        const destinationInputs: PropertyTransferAllocationDestination[] = itemDemands.map(
            (demand) => ({ key: demand.key, capacity: demand.requestedReorderQuantity })
        );
        safeSum(
            sourceInputs.map((source) => source.capacity),
            `Property transfer ${JSON.stringify(itemId)} source quantity`
        );
        safeSum(
            destinationInputs.map((destination) => destination.capacity),
            `Property transfer ${JSON.stringify(itemId)} destination quantity`
        );
        const sourceKeys = new Set(sourceInputs.map((source) => source.key));
        const destinationKeys = new Set(destinationInputs.map((destination) => destination.key));
        const candidateInputs: PropertyTransferAllocationEdge[] = candidates.flatMap((candidate) =>
            candidate.itemId === itemId &&
            sourceKeys.has(candidate.sourceKey) &&
            destinationKeys.has(candidate.destinationKey) &&
            candidate.quantityCapacity !== null &&
            candidate.quantityCapacity > 0
                ? [{
                      candidateId: candidate.candidateId,
                      sourceKey: candidate.sourceKey,
                      destinationKey: candidate.destinationKey,
                      capacity: candidate.quantityCapacity,
                  }]
                : []
        );
        const indexedCandidates = new Map(
            candidates.map((candidate) => [candidate.candidateId, candidate])
        );
        return maximizePropertyTransferQuantity(
            sourceInputs,
            destinationInputs,
            candidateInputs
        ).map((allocation) => allocationResult(item, allocation, indexedCandidates));
    });
}

function allocationResult(
    item: Item,
    allocation: PropertyTransferAllocatedEdge,
    candidates: ReadonlyMap<string, IndexedPropertyTransferCandidate>
): FinishedRecipePropertyTransferAllocation {
    const candidate = candidates.get(allocation.candidateId);
    if (candidate === undefined) {
        throw new Error(`Missing property transfer candidate ${JSON.stringify(allocation.candidateId)}`);
    }
    return {
        candidateId: candidate.candidateId,
        itemId: candidate.itemId,
        sourcePropertyId: candidate.sourcePropertyId,
        destinationPropertyId: candidate.destinationPropertyId,
        quantity: allocation.quantity,
        itemStackLimit: item.stackLimit,
        stackCount: stackCount(allocation.quantity, item.stackLimit),
    };
}

function requirementResult(
    demand: IndexedPropertyTransferDemand,
    allocatedQuantity: number,
    exactResidual: boolean
): FinishedRecipePropertyTransferRequirement {
    const allocatedEquipmentQuantity = Math.min(
        allocatedQuantity,
        demand.equipmentReorderQuantity
    );
    const allocatedMaterialQuantity = allocatedQuantity - allocatedEquipmentQuantity;
    const unallocatedEquipmentQuantity =
        demand.equipmentReorderQuantity - allocatedEquipmentQuantity;
    const unallocatedMaterialQuantity = demand.materialReorderQuantity - allocatedMaterialQuantity;
    const unallocatedReorderQuantity = safeAdd(
        unallocatedEquipmentQuantity,
        unallocatedMaterialQuantity,
        `Property ${JSON.stringify(demand.propertyId)} unallocated reorder quantity`
    );
    const equipmentCost = exactResidual
        ? reorderCost(unallocatedEquipmentQuantity, demand.unitPurchasePrice)
        : null;
    const materialCost = exactResidual
        ? reorderCost(unallocatedMaterialQuantity, demand.unitPurchasePrice)
        : null;
    return {
        propertyId: demand.propertyId,
        itemId: demand.itemId,
        unitPurchasePrice: demand.unitPurchasePrice,
        materialReorderQuantity: demand.materialReorderQuantity,
        equipmentReorderQuantity: demand.equipmentReorderQuantity,
        requestedReorderQuantity: demand.requestedReorderQuantity,
        allocatedQuantity,
        allocatedEquipmentQuantity,
        allocatedMaterialQuantity,
        unallocatedEquipmentQuantity,
        unallocatedMaterialQuantity,
        unallocatedReorderQuantity,
        residualEquipmentReorderQuantity: exactResidual ? unallocatedEquipmentQuantity : null,
        residualMaterialReorderQuantity: exactResidual ? unallocatedMaterialQuantity : null,
        residualReorderQuantity: exactResidual ? unallocatedReorderQuantity : null,
        residualEquipmentReorderCost: equipmentCost,
        residualMaterialReorderCost: materialCost,
        residualReorderCost:
            equipmentCost === null || materialCost === null
                ? null
                : finiteAdd(equipmentCost, materialCost, 'Property transfer residual reorder cost'),
    };
}

function reorderCost(quantity: number, unitPrice: number | null): number | null {
    if (quantity === 0) return 0;
    if (unitPrice === null) return null;
    const result = quantity * unitPrice;
    if (!Number.isFinite(result)) throw new Error('Property transfer residual reorder cost must be finite');
    return result;
}

function sumExactCosts(values: readonly (number | null)[]): number | null {
    if (values.some((value) => value === null)) return null;
    return finiteSum(values as readonly number[], 'Property transfer residual reorder cost');
}

function sumByKey(entries: readonly (readonly [string, number])[]): ReadonlyMap<string, number> {
    const result = new Map<string, number>();
    for (const [key, quantity] of entries) {
        result.set(key, safeAdd(result.get(key) ?? 0, quantity, `Property transfer ${JSON.stringify(key)} quantity`));
    }
    return result;
}

function requireStorableItem(
    itemsById: ReadonlyMap<string, Item>,
    itemId: string,
    label: string
): Item {
    const item = itemsById.get(itemId);
    if (item === undefined) throw new Error(`Unknown property transfer ${label} item ${JSON.stringify(itemId)}`);
    if (!item.isStorable) {
        throw new Error(`Property transfer ${label} item ${JSON.stringify(itemId)} is not storable`);
    }
    return item;
}

function stackCount(quantity: number, stackLimit: number): number {
    return quantity === 0 ? 0 : Math.ceil(quantity / stackLimit);
}

function safeSum(values: readonly number[], label: string): number {
    let result = 0;
    for (const value of values) result = safeAdd(result, value, label);
    return result;
}

function finiteSum(values: readonly number[], label: string): number {
    let result = 0;
    for (const value of values) result = finiteAdd(result, value, label);
    return result;
}

function safeAdd(left: number, right: number, label: string): number {
    const result = left + right;
    if (!Number.isSafeInteger(result)) throw new Error(`${label} must be a safe integer`);
    return result;
}

function finiteAdd(left: number, right: number, label: string): number {
    const result = left + right;
    if (!Number.isFinite(result)) throw new Error(`${label} must be finite`);
    return result;
}
