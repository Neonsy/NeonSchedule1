import type { Item } from '#core/data/item';
import type { ProductionBatchPlan } from '#core/production/plan';

export type FinishedRecipeEquipmentRole =
    | 'base-production'
    | 'grow-light'
    | 'mixing'
    | 'drying'
    | 'packaging'
    | 'brick-pressing';

export interface FinishedRecipeOwnedEquipment {
    readonly itemId: string;
    readonly quantity: number;
}

export interface FinishedRecipeEquipmentSelections {
    readonly mixingStationItemId: string | null;
    readonly dryingStationItemId: string | null;
    readonly packagingStationItemId: string | null;
    readonly brickPressItemId: string | null;
}

export interface FinishedRecipeEquipmentRequirement {
    readonly itemId: string;
    readonly roles: readonly FinishedRecipeEquipmentRole[];
    readonly requiredQuantity: 1;
    readonly ownedQuantity: number | null;
    readonly missingQuantity: number | null;
    readonly unitPurchasePrice: number | null;
    readonly missingPurchaseCost: number | null;
}

export interface FinishedRecipeEquipmentPlan {
    readonly quantityBasis: 'minimum-one-per-selected-item-for-serial-plan';
    readonly selectionProof: 'exact' | 'partial';
    readonly unresolvedProductionRouteIds: readonly string[];
    readonly ownershipProof: 'supplied' | 'not-supplied' | 'not-required';
    readonly purchaseCostProof:
        | 'exact'
        | 'production-equipment-selection-missing'
        | 'equipment-ownership-not-supplied'
        | 'equipment-price-not-recorded';
    readonly requirements: readonly FinishedRecipeEquipmentRequirement[];
    readonly totalMissingPurchaseCost: number | null;
}

const roleOrder: readonly FinishedRecipeEquipmentRole[] = [
    'base-production',
    'grow-light',
    'mixing',
    'drying',
    'packaging',
    'brick-pressing',
];

export function planFinishedRecipeEquipment(
    itemsById: ReadonlyMap<string, Item>,
    baseProductPlan: ProductionBatchPlan,
    selections: FinishedRecipeEquipmentSelections,
    ownedEquipment: readonly FinishedRecipeOwnedEquipment[] | undefined
): FinishedRecipeEquipmentPlan {
    const rolesByItemId = new Map<string, Set<FinishedRecipeEquipmentRole>>();
    const unresolvedProductionRouteIds: string[] = [];
    for (const step of baseProductPlan.productionSteps) {
        if (step.equipmentItemId === null) unresolvedProductionRouteIds.push(step.routeId);
        else addRole(rolesByItemId, step.equipmentItemId, 'base-production');
        if (step.growLightItemId !== null) {
            addRole(rolesByItemId, step.growLightItemId, 'grow-light');
        }
    }
    addSelectedRole(rolesByItemId, selections.mixingStationItemId, 'mixing');
    addSelectedRole(rolesByItemId, selections.dryingStationItemId, 'drying');
    addSelectedRole(rolesByItemId, selections.packagingStationItemId, 'packaging');
    addSelectedRole(rolesByItemId, selections.brickPressItemId, 'brick-pressing');

    const ownedByItemId = ownedEquipment === undefined
        ? null
        : indexOwnedEquipment(itemsById, ownedEquipment);
    const requirements = [...rolesByItemId]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([itemId, roles]): FinishedRecipeEquipmentRequirement => {
            const item = itemsById.get(itemId);
            if (item === undefined) {
                throw new Error(`Unknown required equipment ${JSON.stringify(itemId)}`);
            }
            const unitPurchasePrice = item.basePurchasePrice;
            if (
                unitPurchasePrice !== null &&
                (!Number.isFinite(unitPurchasePrice) || unitPurchasePrice < 0)
            ) {
                throw new Error(
                    `Equipment ${JSON.stringify(itemId)} purchase price must be non-negative`
                );
            }
            const ownedQuantity = ownedByItemId?.get(itemId) ?? (ownedByItemId === null ? null : 0);
            const missingQuantity = ownedQuantity === null ? null : Math.max(0, 1 - ownedQuantity);
            return {
                itemId,
                roles: roleOrder.filter((role) => roles.has(role)),
                requiredQuantity: 1,
                ownedQuantity,
                missingQuantity,
                unitPurchasePrice,
                missingPurchaseCost:
                    missingQuantity === null || (missingQuantity > 0 && unitPurchasePrice === null)
                        ? null
                        : missingQuantity * (unitPurchasePrice ?? 0),
            };
        });
    const selectionProof = unresolvedProductionRouteIds.length === 0 ? 'exact' : 'partial';
    const ownershipProof = requirements.length === 0
        ? 'not-required'
        : ownedByItemId === null
          ? 'not-supplied'
          : 'supplied';
    const priceMissing = requirements.some(
        (requirement) =>
            requirement.missingQuantity !== null &&
            requirement.missingQuantity > 0 &&
            requirement.unitPurchasePrice === null
    );
    const purchaseCostProof = selectionProof === 'partial'
        ? 'production-equipment-selection-missing'
        : ownershipProof === 'not-supplied'
          ? 'equipment-ownership-not-supplied'
          : priceMissing
            ? 'equipment-price-not-recorded'
            : 'exact';
    const missingPurchaseCost = requirements.reduce(
        (total, requirement) => total + (requirement.missingPurchaseCost ?? 0),
        0
    );
    return {
        quantityBasis: 'minimum-one-per-selected-item-for-serial-plan',
        selectionProof,
        unresolvedProductionRouteIds: [...new Set(unresolvedProductionRouteIds)].sort(),
        ownershipProof,
        purchaseCostProof,
        requirements,
        totalMissingPurchaseCost:
            purchaseCostProof === 'exact' ? missingPurchaseCost : null,
    };
}

function addSelectedRole(
    rolesByItemId: Map<string, Set<FinishedRecipeEquipmentRole>>,
    itemId: string | null,
    role: FinishedRecipeEquipmentRole
): void {
    if (itemId !== null) addRole(rolesByItemId, itemId, role);
}

function addRole(
    rolesByItemId: Map<string, Set<FinishedRecipeEquipmentRole>>,
    itemId: string,
    role: FinishedRecipeEquipmentRole
): void {
    const roles = rolesByItemId.get(itemId);
    if (roles === undefined) rolesByItemId.set(itemId, new Set([role]));
    else roles.add(role);
}

function indexOwnedEquipment(
    itemsById: ReadonlyMap<string, Item>,
    ownedEquipment: readonly FinishedRecipeOwnedEquipment[]
): ReadonlyMap<string, number> {
    const result = new Map<string, number>();
    for (const entry of ownedEquipment) {
        if (!itemsById.has(entry.itemId)) {
            throw new Error(`Unknown owned equipment ${JSON.stringify(entry.itemId)}`);
        }
        if (result.has(entry.itemId)) {
            throw new Error(`Owned equipment contains duplicate item ${JSON.stringify(entry.itemId)}`);
        }
        if (!Number.isInteger(entry.quantity) || entry.quantity < 0) {
            throw new Error(
                `Owned equipment ${JSON.stringify(entry.itemId)} quantity must be a non-negative integer`
            );
        }
        result.set(entry.itemId, entry.quantity);
    }
    return result;
}
