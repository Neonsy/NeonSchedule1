import type { Item } from '#core/data/item';
import type { FinishedRecipeInventoryPlan } from '#core/production/inventory';
import type {
    FinishedRecipePropertyTransferCandidate,
    FinishedRecipePropertyTransferDestination,
    FinishedRecipePropertyTransferEvidence,
    FinishedRecipePropertyTransferSupply,
} from '#core/production/property-transfer-types';

export interface IndexedPropertyTransferDemand {
    readonly key: string;
    readonly propertyId: string;
    readonly itemId: string;
    readonly unitPurchasePrice: number | null;
    readonly materialReorderQuantity: number;
    readonly equipmentReorderQuantity: number;
    readonly requestedReorderQuantity: number;
}

export interface IndexedPropertyTransferSupply extends FinishedRecipePropertyTransferSupply {
    readonly key: string;
}

export interface IndexedPropertyTransferCandidate extends FinishedRecipePropertyTransferCandidate {
    readonly sourceKey: string;
    readonly destinationKey: string;
}

export function indexPropertyTransferDestinations(
    destinations: readonly FinishedRecipePropertyTransferDestination[]
): ReadonlyMap<string, FinishedRecipeInventoryPlan> {
    const result = new Map<string, FinishedRecipeInventoryPlan>();
    for (const destination of destinations) {
        requireNonBlank(destination.propertyId, 'Property transfer destination property ID');
        if (result.has(destination.propertyId)) {
            throw new Error(
                `Property transfer destinations contain duplicate property ${JSON.stringify(destination.propertyId)}`
            );
        }
        result.set(destination.propertyId, destination.inventory);
    }
    return result;
}

export function indexPropertyTransferDemands(
    itemsById: ReadonlyMap<string, Item>,
    destinations: ReadonlyMap<string, FinishedRecipeInventoryPlan>
): readonly IndexedPropertyTransferDemand[] {
    const result: IndexedPropertyTransferDemand[] = [];
    const demandKeys = new Set<string>();
    for (const [propertyId, inventory] of destinations) {
        for (const requirement of inventory.requirements) {
            const item = requireStorableItem(itemsById, requirement.itemId, 'destination demand');
            requirePositiveSafeInteger(
                item.stackLimit,
                `Property transfer item ${JSON.stringify(item.id)} stack limit`
            );
            validateUnitPrice(item, requirement.unitPurchasePrice, propertyId);
            const key = propertyTransferDestinationKey(propertyId, item.id);
            if (demandKeys.has(key)) {
                throw new Error(
                    `Property transfer destination inventory contains duplicate item ${JSON.stringify(key)}`
                );
            }
            demandKeys.add(key);
            const material = requirement.material.reorderQuantity;
            const equipment = requirement.equipment.reorderQuantity;
            if (material === null || equipment === null) {
                if (inventory.quantityProof === 'exact') {
                    throw new Error(
                        `Property ${JSON.stringify(propertyId)} exact inventory has an unknown reorder quantity for ${JSON.stringify(item.id)}`
                    );
                }
                continue;
            }
            requireNonNegativeSafeInteger(
                material,
                `Property ${JSON.stringify(propertyId)} material reorder quantity`
            );
            requireNonNegativeSafeInteger(
                equipment,
                `Property ${JSON.stringify(propertyId)} equipment reorder quantity`
            );
            const requested = safeAdd(
                material,
                equipment,
                `Property ${JSON.stringify(propertyId)} reorder quantity`
            );
            if (requested === 0) continue;
            if (requirement.reorderQuantity !== requested) {
                throw new Error(
                    `Property ${JSON.stringify(propertyId)} item ${JSON.stringify(item.id)} reorder quantity is inconsistent`
                );
            }
            result.push({
                key,
                propertyId,
                itemId: item.id,
                unitPurchasePrice: requirement.unitPurchasePrice,
                materialReorderQuantity: material,
                equipmentReorderQuantity: equipment,
                requestedReorderQuantity: requested,
            });
        }
    }
    return result.sort(compareDemand);
}

export function indexPropertyTransferSupplies(
    itemsById: ReadonlyMap<string, Item>,
    supplies: readonly FinishedRecipePropertyTransferSupply[]
): readonly IndexedPropertyTransferSupply[] {
    const result = new Map<string, IndexedPropertyTransferSupply>();
    for (const supply of supplies) {
        requireNonBlank(supply.propertyId, 'Property transfer source property ID');
        const item = requireStorableItem(itemsById, supply.itemId, 'source supply');
        requirePositiveSafeInteger(
            item.stackLimit,
            `Property transfer item ${JSON.stringify(item.id)} stack limit`
        );
        requireNonNegativeSafeInteger(
            supply.transferableQuantity,
            `Property ${JSON.stringify(supply.propertyId)} transferable ${JSON.stringify(item.id)} quantity`
        );
        const key = propertyTransferSourceKey(supply.propertyId, item.id);
        if (result.has(key)) {
            throw new Error(
                `Property transfer supplies contain duplicate property item ${JSON.stringify(key)}`
            );
        }
        result.set(key, { ...supply, key });
    }
    return [...result.values()].sort(compareSupply);
}

export function indexPropertyTransferCandidates(
    itemsById: ReadonlyMap<string, Item>,
    destinations: ReadonlyMap<string, FinishedRecipeInventoryPlan>,
    supplies: readonly IndexedPropertyTransferSupply[],
    demands: readonly IndexedPropertyTransferDemand[],
    candidates: readonly FinishedRecipePropertyTransferCandidate[]
): readonly IndexedPropertyTransferCandidate[] {
    const sourceProperties = new Set(supplies.map((supply) => supply.propertyId));
    const demandProperties = new Set(destinations.keys());
    const candidateIds = new Set<string>();
    const pairKeys = new Set<string>();
    const demandKeys = new Set(demands.map((demand) => demand.key));
    const sourceKeys = new Set(supplies.map((supply) => supply.key));
    const result: IndexedPropertyTransferCandidate[] = [];
    for (const candidate of candidates) {
        requireNonBlank(candidate.candidateId, 'Property transfer candidate ID');
        if (candidateIds.has(candidate.candidateId)) {
            throw new Error(
                `Property transfer evidence contains duplicate candidate ${JSON.stringify(candidate.candidateId)}`
            );
        }
        candidateIds.add(candidate.candidateId);
        const item = requireStorableItem(itemsById, candidate.itemId, 'candidate');
        if (!sourceProperties.has(candidate.sourcePropertyId)) {
            throw new Error(
                `Property transfer candidate ${JSON.stringify(candidate.candidateId)} has unknown source property ${JSON.stringify(candidate.sourcePropertyId)}`
            );
        }
        if (!demandProperties.has(candidate.destinationPropertyId)) {
            throw new Error(
                `Property transfer candidate ${JSON.stringify(candidate.candidateId)} has unknown destination property ${JSON.stringify(candidate.destinationPropertyId)}`
            );
        }
        if (candidate.sourcePropertyId === candidate.destinationPropertyId) {
            throw new Error(
                `Property transfer candidate ${JSON.stringify(candidate.candidateId)} cannot transfer within one property`
            );
        }
        if (candidate.quantityCapacity !== null) {
            requireNonNegativeSafeInteger(
                candidate.quantityCapacity,
                `Property transfer candidate ${JSON.stringify(candidate.candidateId)} quantity capacity`
            );
        }
        const sourceKey = propertyTransferSourceKey(candidate.sourcePropertyId, item.id);
        const destinationKey = propertyTransferDestinationKey(
            candidate.destinationPropertyId,
            item.id
        );
        const pairKey = `${sourceKey}\u0000${destinationKey}`;
        if (pairKeys.has(pairKey)) {
            throw new Error(
                `Property transfer evidence contains duplicate item source-destination pair ${JSON.stringify(pairKey)}`
            );
        }
        pairKeys.add(pairKey);
        if (!sourceKeys.has(sourceKey) || !demandKeys.has(destinationKey)) continue;
        result.push({ ...candidate, sourceKey, destinationKey });
    }
    return result.sort(compareCandidate);
}

export function hasCompleteRelevantPropertyTransferEvidence(
    supplies: readonly IndexedPropertyTransferSupply[],
    demands: readonly IndexedPropertyTransferDemand[],
    candidates: readonly IndexedPropertyTransferCandidate[],
    coverage: FinishedRecipePropertyTransferEvidence['coverage']
): boolean {
    const candidateByPair = new Map(
        candidates.map((candidate) => [
            `${candidate.sourceKey}\u0000${candidate.destinationKey}`,
            candidate,
        ])
    );
    for (const supply of supplies) {
        if (supply.transferableQuantity === 0) continue;
        for (const demand of demands) {
            if (supply.itemId !== demand.itemId || supply.propertyId === demand.propertyId) continue;
            const candidate = candidateByPair.get(`${supply.key}\u0000${demand.key}`);
            if (candidate?.quantityCapacity === null) return false;
            if (candidate === undefined && coverage === 'partial') return false;
        }
    }
    return true;
}

export function propertyTransferSourceKey(propertyId: string, itemId: string): string {
    return `${propertyId}\u0000${itemId}`;
}

export function propertyTransferDestinationKey(propertyId: string, itemId: string): string {
    return `${propertyId}\u0000${itemId}`;
}

function validateUnitPrice(item: Item, unitPrice: number | null, propertyId: string): void {
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
        throw new Error(
            `Property ${JSON.stringify(propertyId)} item ${JSON.stringify(item.id)} purchase price must be non-negative`
        );
    }
    if (!samePrice(unitPrice, item.basePurchasePrice)) {
        throw new Error(
            `Property ${JSON.stringify(propertyId)} item ${JSON.stringify(item.id)} purchase price does not match normalized item price`
        );
    }
}

function samePrice(left: number | null, right: number | null): boolean {
    if (left === null || right === null) return left === right;
    return Math.abs(left - right) <= Math.max(1, Math.abs(left), Math.abs(right)) * 1e-9;
}

function requireStorableItem(
    itemsById: ReadonlyMap<string, Item>,
    itemId: string,
    label: string
): Item {
    const item = itemsById.get(itemId);
    if (item === undefined) {
        throw new Error(`Unknown property transfer ${label} item ${JSON.stringify(itemId)}`);
    }
    if (!item.isStorable) {
        throw new Error(`Property transfer ${label} item ${JSON.stringify(itemId)} is not storable`);
    }
    return item;
}

function compareSupply(
    left: IndexedPropertyTransferSupply,
    right: IndexedPropertyTransferSupply
): number {
    return left.itemId.localeCompare(right.itemId) || left.propertyId.localeCompare(right.propertyId);
}

function compareDemand(
    left: IndexedPropertyTransferDemand,
    right: IndexedPropertyTransferDemand
): number {
    return left.itemId.localeCompare(right.itemId) || left.propertyId.localeCompare(right.propertyId);
}

function compareCandidate(
    left: IndexedPropertyTransferCandidate,
    right: IndexedPropertyTransferCandidate
): number {
    return left.itemId.localeCompare(right.itemId) ||
        left.sourcePropertyId.localeCompare(right.sourcePropertyId) ||
        left.destinationPropertyId.localeCompare(right.destinationPropertyId) ||
        left.candidateId.localeCompare(right.candidateId);
}

function safeAdd(left: number, right: number, label: string): number {
    const result = left + right;
    if (!Number.isSafeInteger(result)) throw new Error(`${label} must be a safe integer`);
    return result;
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${label} must be a non-negative safe integer`);
    }
}

function requirePositiveSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${label} must be a positive safe integer`);
    }
}

function requireNonBlank(value: string, label: string): void {
    if (value.trim().length === 0) throw new Error(`${label} must not be blank`);
}
