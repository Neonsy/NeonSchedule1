import type { Item } from '#core/data/item';
import type { ProductionBatchPlan } from '#core/production/plan';

export type FinishedRecipeEquipmentRole =
    | 'base-production'
    | 'grow-light'
    | 'mixing'
    | 'drying'
    | 'packaging'
    | 'brick-pressing';

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
    readonly unitPurchasePrice: number | null;
    readonly requiredPurchaseCost: number | null;
}

export interface FinishedRecipeEquipmentPlan {
    readonly quantityBasis: 'minimum-one-per-selected-item-for-serial-plan';
    readonly selectionProof: 'exact' | 'partial';
    readonly unresolvedProductionRouteIds: readonly string[];
    readonly purchaseCostProof:
        | 'exact'
        | 'production-equipment-selection-missing'
        | 'equipment-price-not-recorded';
    readonly requirements: readonly FinishedRecipeEquipmentRequirement[];
    readonly totalRequiredPurchaseCost: number | null;
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
    selections: FinishedRecipeEquipmentSelections
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
            return {
                itemId,
                roles: roleOrder.filter((role) => roles.has(role)),
                requiredQuantity: 1,
                unitPurchasePrice,
                requiredPurchaseCost: unitPurchasePrice,
            };
        });
    const selectionProof = unresolvedProductionRouteIds.length === 0 ? 'exact' : 'partial';
    const priceMissing = requirements.some((requirement) => requirement.unitPurchasePrice === null);
    const purchaseCostProof = selectionProof === 'partial'
        ? 'production-equipment-selection-missing'
        : priceMissing
          ? 'equipment-price-not-recorded'
          : 'exact';
    const requiredPurchaseCost = requirements.reduce(
        (total, requirement) => total + (requirement.requiredPurchaseCost ?? 0),
        0
    );
    return {
        quantityBasis: 'minimum-one-per-selected-item-for-serial-plan',
        selectionProof,
        unresolvedProductionRouteIds: [...new Set(unresolvedProductionRouteIds)].sort(),
        purchaseCostProof,
        requirements,
        totalRequiredPurchaseCost:
            purchaseCostProof === 'exact' ? requiredPurchaseCost : null,
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
