import type { FinishedRecipeInventoryRequirement } from '#core/production/inventory';
import type { FinishedRecipePurchaseRequirement } from '#core/production/finished-recipe-purchase-types';
import type { FinishedRecipePropertyTransferRequirement } from '#core/production/property-transfer-types';
import type {
    FinishedRecipeProductionInputReadiness,
    FinishedRecipeProductionReadinessGap,
    FinishedRecipeProductionReadinessInput,
    FinishedRecipeProductionReadinessResult,
} from '#core/production/finished-recipe-readiness-types';
import {
    summarizeProductionReadinessShopping,
    validateProductionReadinessShoppingAllocations,
    type ProductionReadinessShoppingSummary,
} from '#core/production/finished-recipe-readiness-shopping';

export type {
    FinishedRecipeProductionInputReadiness,
    FinishedRecipeProductionReadinessGap,
    FinishedRecipeProductionReadinessInput,
    FinishedRecipeProductionReadinessResult,
    FinishedRecipeShoppingArrivalDestination,
    FinishedRecipeShoppingNotPlannedReason,
} from '#core/production/finished-recipe-readiness-types';

export function composeFinishedRecipeProductionReadiness(
    input: FinishedRecipeProductionReadinessInput
): FinishedRecipeProductionReadinessResult {
    requireNonBlank(input.propertyId, 'Production readiness property ID');
    validateDataset(input);

    const gaps: FinishedRecipeProductionReadinessGap[] = [];
    const shopping = summarizeProductionReadinessShopping(input, gaps);
    if (input.productionPlan.inventory.quantityProof !== 'exact') {
        addGap(gaps, 'production-inventory-incomplete');
        return result(input, shopping, [], gaps, false);
    }

    const productionRequirements = indexProductionRequirements(input);
    if (
        input.transferPlan.demandProof !== 'exact' ||
        input.transferPlan.residualProof !== 'exact'
    ) {
        addGap(gaps, 'property-transfer-residual-incomplete');
        return result(input, shopping, [], gaps, false);
    }

    const transferRequirements = indexTransferRequirements(input, productionRequirements);
    const purchaseRequirements = indexPurchaseRequirements(
        input,
        transferRequirements,
        gaps
    );
    validateProductionReadinessShoppingAllocations(input);
    const purchaseComplete = purchaseFulfillmentComplete(input);
    if (!purchaseComplete) addGap(gaps, 'purchase-fulfillment-incomplete');

    const propertyAllocationKnown = !gaps.some(
        (gap) => gap.code === 'purchase-allocation-by-property-unavailable'
    );
    const hasPurchases = [...purchaseRequirements.values()].some(
        (requirement) => (requirement.requestedQuantity ?? 0) > 0
    );
    const arrivalAtProperty = !hasPurchases || input.shopping.route.kind !== 'planned'
        ? false
        : shoppingArrivesAtProperty(input, gaps) && propertyAllocationKnown;
    const inputs = productionRequirements.map((requirement) => inputReadiness(
        requirement,
        transferRequirements.get(requirement.itemId) ?? null,
        purchaseRequirements.get(requirement.itemId) ?? null,
        shopping,
        purchaseComplete,
        arrivalAtProperty,
        gaps,
        input.propertyId
    ));

    return result(input, shopping, inputs, gaps, exactNotReady(input));
}

function validateDataset(input: FinishedRecipeProductionReadinessInput): void {
    requireNonBlank(input.productionPlan.dataset.gameVersion, 'Production dataset game version');
    requireSha256(input.productionPlan.dataset.datasetSha256, 'Production dataset identity');
    requireNonBlank(input.shopping.dataset.gameVersion, 'Shopping dataset game version');
    requireSha256(input.shopping.dataset.datasetSha256, 'Shopping dataset identity');
    if (
        input.productionPlan.dataset.gameVersion !== input.shopping.dataset.gameVersion ||
        input.productionPlan.dataset.datasetSha256 !== input.shopping.dataset.datasetSha256
    ) {
        throw new Error('Shopping evidence belongs to a different production dataset');
    }
}

function indexProductionRequirements(
    input: FinishedRecipeProductionReadinessInput
): readonly FinishedRecipeInventoryRequirement[] {
    const result = new Map<string, FinishedRecipeInventoryRequirement>();
    for (const requirement of input.productionPlan.inventory.requirements) {
        requireNonBlank(requirement.itemId, 'Production readiness item ID');
        if (result.has(requirement.itemId)) {
            throw new Error(
                `Production inventory contains duplicate item ${JSON.stringify(requirement.itemId)}`
            );
        }
        requireNonNegativeFinite(
            requireValue(requirement.material.stockAppliedQuantity, requirement.itemId, 'material stock'),
            `Production item ${JSON.stringify(requirement.itemId)} material stock`
        );
        requireNonNegativeSafeInteger(
            requireValue(requirement.equipment.stockAppliedQuantity, requirement.itemId, 'equipment stock'),
            `Production item ${JSON.stringify(requirement.itemId)} equipment stock`
        );
        requireNonNegativeSafeInteger(
            requireValue(requirement.material.reorderQuantity, requirement.itemId, 'material reorder'),
            `Production item ${JSON.stringify(requirement.itemId)} material reorder`
        );
        requireNonNegativeSafeInteger(
            requireValue(requirement.equipment.reorderQuantity, requirement.itemId, 'equipment reorder'),
            `Production item ${JSON.stringify(requirement.itemId)} equipment reorder`
        );
        result.set(requirement.itemId, requirement);
    }
    return [...result.values()].sort((left, right) => left.itemId.localeCompare(right.itemId));
}

function indexTransferRequirements(
    input: FinishedRecipeProductionReadinessInput,
    productionRequirements: readonly FinishedRecipeInventoryRequirement[]
): ReadonlyMap<string, FinishedRecipePropertyTransferRequirement> {
    const expected = new Map(productionRequirements.map((requirement) => [
        requirement.itemId,
        requirement,
    ]));
    const result = new Map<string, FinishedRecipePropertyTransferRequirement>();
    for (const requirement of input.transferPlan.requirements) {
        if (requirement.propertyId !== input.propertyId) continue;
        const production = expected.get(requirement.itemId);
        if (production === undefined) {
            throw new Error(
                `Property transfer contains unknown production item ${JSON.stringify(requirement.itemId)}`
            );
        }
        if (result.has(requirement.itemId)) {
            throw new Error(
                `Property transfer contains duplicate production item ${JSON.stringify(requirement.itemId)}`
            );
        }
        const materialReorder = requireValue(
            production.material.reorderQuantity,
            production.itemId,
            'material reorder'
        );
        const equipmentReorder = requireValue(
            production.equipment.reorderQuantity,
            production.itemId,
            'equipment reorder'
        );
        if (
            requirement.materialReorderQuantity !== materialReorder ||
            requirement.equipmentReorderQuantity !== equipmentReorder
        ) {
            throw new Error(
                `Property transfer demand does not match production item ${JSON.stringify(requirement.itemId)}`
            );
        }
        validateTransferRequirement(requirement);
        result.set(requirement.itemId, requirement);
    }
    for (const production of productionRequirements) {
        const reorderQuantity = requireValue(
            production.reorderQuantity,
            production.itemId,
            'reorder quantity'
        );
        if (reorderQuantity > 0 && !result.has(production.itemId)) {
            throw new Error(
                `Property transfer is missing production item ${JSON.stringify(production.itemId)}`
            );
        }
    }
    validateTransferAllocations(input, result);
    return result;
}

function validateTransferAllocations(
    input: FinishedRecipeProductionReadinessInput,
    requirements: ReadonlyMap<string, FinishedRecipePropertyTransferRequirement>
): void {
    const allocatedByItem = new Map<string, number>();
    for (const allocation of input.transferPlan.allocations) {
        if (allocation.destinationPropertyId !== input.propertyId) continue;
        requirePositiveSafeInteger(
            allocation.quantity,
            `Property transfer allocation ${JSON.stringify(allocation.candidateId)} quantity`
        );
        const next = (allocatedByItem.get(allocation.itemId) ?? 0) + allocation.quantity;
        if (!Number.isSafeInteger(next)) {
            throw new Error('Property transfer allocated quantity must be a safe integer');
        }
        allocatedByItem.set(allocation.itemId, next);
    }
    const itemIds = new Set([...requirements.keys(), ...allocatedByItem.keys()]);
    for (const itemId of itemIds) {
        if ((requirements.get(itemId)?.allocatedQuantity ?? 0) !== (allocatedByItem.get(itemId) ?? 0)) {
            throw new Error(
                `Property transfer allocations do not match production item ${JSON.stringify(itemId)}`
            );
        }
    }
}

function validateTransferRequirement(requirement: FinishedRecipePropertyTransferRequirement): void {
    if (
        requirement.residualMaterialReorderQuantity === null ||
        requirement.residualEquipmentReorderQuantity === null ||
        requirement.residualReorderQuantity === null
    ) {
        throw new Error(
            `Property transfer residual is unavailable for ${JSON.stringify(requirement.itemId)}`
        );
    }
    const quantities = [
        requirement.materialReorderQuantity,
        requirement.equipmentReorderQuantity,
        requirement.requestedReorderQuantity,
        requirement.allocatedMaterialQuantity,
        requirement.allocatedEquipmentQuantity,
        requirement.allocatedQuantity,
        requirement.residualMaterialReorderQuantity,
        requirement.residualEquipmentReorderQuantity,
        requirement.residualReorderQuantity,
    ];
    for (const quantity of quantities) {
        requireNonNegativeSafeInteger(
            quantity,
            `Property transfer ${JSON.stringify(requirement.itemId)} quantity`
        );
    }
    if (
        requirement.materialReorderQuantity + requirement.equipmentReorderQuantity !==
            requirement.requestedReorderQuantity ||
        requirement.allocatedMaterialQuantity + requirement.allocatedEquipmentQuantity !==
            requirement.allocatedQuantity ||
        requirement.residualMaterialReorderQuantity +
            requirement.residualEquipmentReorderQuantity !==
            requirement.residualReorderQuantity ||
        requirement.allocatedMaterialQuantity + requirement.residualMaterialReorderQuantity !==
            requirement.materialReorderQuantity ||
        requirement.allocatedEquipmentQuantity + requirement.residualEquipmentReorderQuantity !==
            requirement.equipmentReorderQuantity ||
        requirement.allocatedQuantity + requirement.residualReorderQuantity !==
            requirement.requestedReorderQuantity
    ) {
        throw new Error(
            `Property transfer allocation is inconsistent for ${JSON.stringify(requirement.itemId)}`
        );
    }
}

function indexPurchaseRequirements(
    input: FinishedRecipeProductionReadinessInput,
    transfers: ReadonlyMap<string, FinishedRecipePropertyTransferRequirement>,
    gaps: FinishedRecipeProductionReadinessGap[]
): ReadonlyMap<string, FinishedRecipePurchaseRequirement> {
    const result = new Map<string, FinishedRecipePurchaseRequirement>();
    for (const requirement of input.purchasePlan.requirements) {
        if (requirement.propertyId !== input.propertyId) {
            if (requirement.requestedQuantity === null || requirement.requestedQuantity > 0) {
                addGap(
                    gaps,
                    'purchase-allocation-by-property-unavailable',
                    requirement.itemId,
                    requirement.propertyId
                );
            }
            continue;
        }
        const transfer = transfers.get(requirement.itemId);
        if (transfer === undefined) {
            throw new Error(
                `Purchase plan contains unknown production item ${JSON.stringify(requirement.itemId)}`
            );
        }
        if (result.has(requirement.itemId)) {
            throw new Error(
                `Purchase plan contains duplicate production item ${JSON.stringify(requirement.itemId)}`
            );
        }
        const materialQuantity = requirePurchaseValue(
            requirement.materialQuantity,
            requirement.itemId,
            'material quantity'
        );
        const equipmentQuantity = requirePurchaseValue(
            requirement.equipmentQuantity,
            requirement.itemId,
            'equipment quantity'
        );
        const requestedQuantity = requirePurchaseValue(
            requirement.requestedQuantity,
            requirement.itemId,
            'requested quantity'
        );
        if (
            materialQuantity !== transfer.residualMaterialReorderQuantity ||
            equipmentQuantity !== transfer.residualEquipmentReorderQuantity ||
            requestedQuantity !== transfer.residualReorderQuantity
        ) {
            throw new Error(
                `Purchase demand does not match property transfer residual for ${JSON.stringify(requirement.itemId)}`
            );
        }
        result.set(requirement.itemId, requirement);
    }
    for (const transfer of transfers.values()) {
        if ((transfer.residualReorderQuantity ?? 0) > 0 && !result.has(transfer.itemId)) {
            throw new Error(
                `Purchase plan is missing production item ${JSON.stringify(transfer.itemId)}`
            );
        }
    }
    return result;
}

function purchaseFulfillmentComplete(input: FinishedRecipeProductionReadinessInput): boolean {
    return input.purchasePlan.demandProof === 'exact' && input.shopping.route.kind === 'planned';
}

function shoppingArrivesAtProperty(
    input: FinishedRecipeProductionReadinessInput,
    gaps: FinishedRecipeProductionReadinessGap[]
): boolean {
    const destination = input.shopping.arrivalDestination;
    if (destination.kind === 'not-established') {
        addGap(gaps, 'shopping-arrival-destination-not-established');
        return false;
    }
    requireNonBlank(destination.propertyId, 'Shopping arrival property ID');
    if (destination.propertyId !== input.propertyId) {
        addGap(gaps, 'shopping-arrival-at-other-property', null, destination.propertyId);
        return false;
    }
    return true;
}

function inputReadiness(
    requirement: FinishedRecipeInventoryRequirement,
    transfer: FinishedRecipePropertyTransferRequirement | null,
    purchase: FinishedRecipePurchaseRequirement | null,
    shopping: ProductionReadinessShoppingSummary,
    purchaseComplete: boolean,
    arrivalAtProperty: boolean,
    gaps: FinishedRecipeProductionReadinessGap[],
    propertyId: string
): FinishedRecipeProductionInputReadiness {
    const transferredQuantity = transfer?.allocatedQuantity ?? 0;
    const purchasedQuantity = purchase === null
        ? 0
        : requirePurchaseValue(
              purchase.requestedQuantity,
              purchase.itemId,
              'requested quantity'
          );
    const currentAppliedQuantity =
        requireValue(requirement.material.stockAppliedQuantity, requirement.itemId, 'material stock') +
        requireValue(requirement.equipment.stockAppliedQuantity, requirement.itemId, 'equipment stock');
    const purchaseArrivalMinute = purchasedQuantity === 0
        ? shopping.routeStartMinute
        : (shopping.arrivalByItemId.get(requirement.itemId) ?? null);

    let readinessProof: FinishedRecipeProductionInputReadiness['readinessProof'] = 'exact';
    let readyMinute = purchaseArrivalMinute;
    if (purchasedQuantity > 0 && (!purchaseComplete || purchaseArrivalMinute === null)) {
        readinessProof = 'purchase-not-fulfilled';
        readyMinute = null;
    } else if (purchasedQuantity > 0 && !arrivalAtProperty) {
        readinessProof = 'shopping-arrival-unavailable';
        readyMinute = null;
    } else if (transferredQuantity > 0) {
        readinessProof = 'property-transfer-arrival-unavailable';
        readyMinute = null;
        addGap(
            gaps,
            'property-transfer-arrival-not-evaluated',
            requirement.itemId,
            propertyId
        );
    }

    return {
        itemId: requirement.itemId,
        requiredMaterialQuantity: requirement.material.requiredQuantity,
        requiredEquipmentQuantity: requirement.equipment.requiredQuantity,
        currentAppliedQuantity,
        transferredQuantity,
        purchasedQuantity,
        purchaseArrivalMinute,
        readyMinute,
        readinessProof,
    };
}

function result(
    input: FinishedRecipeProductionReadinessInput,
    shopping: ProductionReadinessShoppingSummary,
    inputs: readonly FinishedRecipeProductionInputReadiness[],
    gaps: readonly FinishedRecipeProductionReadinessGap[],
    exactFailure: boolean
): FinishedRecipeProductionReadinessResult {
    const complete = gaps.length === 0 && inputs.every((entry) => entry.readyMinute !== null);
    const productionInputsReadyMinute = complete
        ? Math.max(shopping.routeStartMinute ?? 0, ...inputs.map((entry) => entry.readyMinute ?? 0))
        : null;
    return {
        scope: 'one-property-production-input-availability',
        persistence: 'not-modeled',
        livePurchaseInteraction: 'not-modeled',
        dataset: { ...input.productionPlan.dataset },
        propertyId: input.propertyId,
        status: complete
            ? 'ready'
            : exactFailure && gaps.every(isExactFailureGap)
              ? 'not-ready'
              : 'unavailable',
        readinessProof:
            complete || (exactFailure && gaps.every(isExactFailureGap)) ? 'exact' : 'incomplete',
        shoppingRouteProof: shopping.routeProof,
        routeStartMinute: shopping.routeStartMinute,
        shoppingCompletionMinute: shopping.completionMinute,
        productionInputsReadyMinute,
        inputs,
        gaps,
    };
}

function isExactFailureGap(gap: FinishedRecipeProductionReadinessGap): boolean {
    return gap.code === 'purchase-fulfillment-incomplete' ||
        gap.code === 'shopping-route-not-planned';
}

function exactNotReady(input: FinishedRecipeProductionReadinessInput): boolean {
    const route = input.shopping.route;
    return route.kind === 'not-planned' && route.proof === 'exact';
}

function addGap(
    gaps: FinishedRecipeProductionReadinessGap[],
    code: FinishedRecipeProductionReadinessGap['code'],
    itemId: string | null = null,
    propertyId: string | null = null,
    shoppingReason: FinishedRecipeProductionReadinessGap['shoppingReason'] = null
): void {
    if (gaps.some((gap) =>
        gap.code === code &&
        gap.itemId === itemId &&
        gap.propertyId === propertyId &&
        gap.shoppingReason === shoppingReason
    )) return;
    gaps.push({ code, itemId, propertyId, shoppingReason });
}

function requireValue(
    value: number | null,
    itemId: string,
    label: string
): number {
    if (value === null) {
        throw new Error(`Production item ${JSON.stringify(itemId)} ${label} is unavailable`);
    }
    return value;
}

function requirePurchaseValue(
    value: number | null,
    itemId: string,
    label: string
): number {
    if (value === null) {
        throw new Error(`Purchase item ${JSON.stringify(itemId)} ${label} is unavailable`);
    }
    requireNonNegativeSafeInteger(
        value,
        `Purchase item ${JSON.stringify(itemId)} ${label}`
    );
    return value;
}

function requireNonBlank(value: string, label: string): void {
    if (value.trim().length === 0) throw new Error(`${label} must not be blank`);
}

function requireSha256(value: string, label: string): void {
    if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error(`${label} must be a lowercase SHA-256`);
}

function requireNonNegativeFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative`);
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
