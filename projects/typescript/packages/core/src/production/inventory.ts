import type { Item } from '#core/data/item';
import type { FinishedRecipeEquipmentPlan } from '#core/production/equipment';
import type { ProductionPurchase } from '#core/production/plan';

export interface FinishedRecipeInventoryItem {
    readonly itemId: string;
    readonly quantity: number;
}

export interface FinishedRecipeInventoryMaterialRequirement {
    readonly requiredQuantity: number;
    readonly purchaseQuantityBeforeInventory: number;
    readonly stockAppliedQuantity: number | null;
    readonly shortageQuantity: number | null;
    readonly reorderQuantity: number | null;
    readonly reorderCost: number | null;
}

export interface FinishedRecipeInventoryEquipmentRequirement {
    readonly requiredQuantity: number;
    readonly stockAppliedQuantity: number | null;
    readonly shortageQuantity: number | null;
    readonly reorderQuantity: number | null;
    readonly reorderCost: number | null;
}

export interface FinishedRecipeInventoryStackRequirement {
    readonly itemStackLimit: number;
    readonly requiredStackCount: number;
    readonly currentStackCount: number | null;
    readonly reorderStackCount: number | null;
    readonly postReorderStackCount: number | null;
    readonly additionalStackCount: number | null;
    readonly postReorderCapacity: number | null;
    readonly unusedPostReorderCapacity: number | null;
}

export interface FinishedRecipeInventoryRequirement {
    readonly itemId: string;
    readonly unitPurchasePrice: number | null;
    readonly currentQuantity: number | null;
    readonly material: FinishedRecipeInventoryMaterialRequirement;
    readonly equipment: FinishedRecipeInventoryEquipmentRequirement;
    readonly shortageQuantity: number | null;
    readonly reorderQuantity: number | null;
    readonly reorderCost: number | null;
    readonly postReorderSurplusQuantity: number | null;
    readonly stacks: FinishedRecipeInventoryStackRequirement;
}

export interface FinishedRecipeInventoryPlan {
    readonly allocationOrder: 'reserve-equipment-before-recurring-materials';
    readonly demandProof: 'exact' | 'production-equipment-selection-missing';
    readonly inventoryProof: 'supplied' | 'not-supplied' | 'not-required';
    readonly quantityProof:
        | 'exact'
        | 'production-equipment-selection-missing'
        | 'inventory-not-supplied';
    readonly costProof: 'exact' | 'reorder-quantity-not-exact' | 'item-price-not-recorded';
    readonly requirements: readonly FinishedRecipeInventoryRequirement[];
    readonly totalMaterialReorderCost: number | null;
    readonly totalEquipmentReorderCost: number | null;
    readonly totalReorderCost: number | null;
    readonly requiredStackCount: number | null;
    readonly currentStackCount: number | null;
    readonly reorderStackCount: number | null;
    readonly postReorderStackCount: number | null;
    readonly additionalStackCount: number | null;
}

export function planFinishedRecipeInventory(
    itemsById: ReadonlyMap<string, Item>,
    materialPurchases: readonly ProductionPurchase[],
    equipmentPlan: FinishedRecipeEquipmentPlan,
    inventory: readonly FinishedRecipeInventoryItem[] | undefined
): FinishedRecipeInventoryPlan {
    const materialByItemId = indexMaterialPurchases(itemsById, materialPurchases);
    const equipmentByItemId = indexEquipmentRequirements(itemsById, equipmentPlan);
    const requiredItemIds = [...new Set([
        ...materialByItemId.keys(),
        ...equipmentByItemId.keys(),
    ])].sort();
    const inventoryByItemId = inventory === undefined
        ? null
        : indexInventory(itemsById, inventory);
    const demandProof = equipmentPlan.selectionProof === 'exact'
        ? 'exact'
        : 'production-equipment-selection-missing';
    const inventoryProof = requiredItemIds.length === 0 && demandProof === 'exact'
        ? 'not-required'
        : inventoryByItemId === null
          ? 'not-supplied'
          : 'supplied';
    const quantityProof = demandProof !== 'exact'
        ? 'production-equipment-selection-missing'
        : inventoryProof === 'not-supplied'
          ? 'inventory-not-supplied'
          : 'exact';

    const requirements = requiredItemIds.map((itemId) => {
        const item = itemsById.get(itemId);
        if (item === undefined) {
            throw new Error(`Unknown required inventory item ${JSON.stringify(itemId)}`);
        }
        if (!item.isStorable) {
            throw new Error(`Required inventory item ${JSON.stringify(itemId)} is not storable`);
        }
        requirePositiveSafeInteger(
            item.stackLimit,
            `Inventory item ${JSON.stringify(itemId)} stack limit`
        );
        const material = materialByItemId.get(itemId) ?? null;
        const equipment = equipmentByItemId.get(itemId) ?? null;
        const unitPurchasePrice = purchasePrice(
            item,
            material?.unitCost,
            equipment?.unitPurchasePrice
        );
        const materialRequiredQuantity = material?.requiredQuantity ?? 0;
        const materialPurchaseQuantity = material?.purchaseQuantity ?? 0;
        const equipmentRequiredQuantity = equipment?.requiredQuantity ?? 0;
        const requiredInventoryQuantity = safeAdd(
            materialPurchaseQuantity,
            equipmentRequiredQuantity,
            `Inventory item ${JSON.stringify(itemId)} required quantity`
        );
        const currentQuantity = inventoryByItemId === null
            ? null
            : (inventoryByItemId.get(itemId) ?? 0);
        const equipmentStockQuantity = currentQuantity === null
            ? null
            : Math.min(currentQuantity, equipmentRequiredQuantity);
        const equipmentShortageQuantity = equipmentStockQuantity === null
            ? null
            : equipmentRequiredQuantity - equipmentStockQuantity;
        const materialAvailableQuantity = currentQuantity === null
            ? null
            : Math.max(0, currentQuantity - (equipmentStockQuantity ?? 0));
        const materialStockQuantity = materialAvailableQuantity === null
            ? null
            : Math.min(materialAvailableQuantity, materialRequiredQuantity);
        const materialShortageQuantity = materialStockQuantity === null
            ? null
            : cleanZero(materialRequiredQuantity - materialStockQuantity);
        const materialReorderQuantity = materialShortageQuantity === null
            ? null
            : ceilWhole(materialShortageQuantity);
        const equipmentReorderQuantity = equipmentShortageQuantity;
        const reorderQuantity =
            materialReorderQuantity === null || equipmentReorderQuantity === null
                ? null
                : safeAdd(
                      materialReorderQuantity,
                      equipmentReorderQuantity,
                      `Inventory item ${JSON.stringify(itemId)} reorder quantity`
                  );
        const materialReorderCost = reorderCost(
            materialReorderQuantity,
            material?.unitCost ?? null,
            itemId
        );
        const equipmentReorderCost = reorderCost(
            equipmentReorderQuantity,
            equipment?.unitPurchasePrice ?? null,
            itemId
        );
        const combinedReorderCost =
            materialReorderCost === null || equipmentReorderCost === null
                ? null
                : finiteAdd(
                      materialReorderCost,
                      equipmentReorderCost,
                      `Inventory item ${JSON.stringify(itemId)} reorder cost`
                  );
        const currentStackCount = currentQuantity === null
            ? null
            : stackCount(currentQuantity, item.stackLimit);
        const reorderStackCount = reorderQuantity === null
            ? null
            : stackCount(reorderQuantity, item.stackLimit);
        const postReorderQuantity =
            currentQuantity === null || reorderQuantity === null
                ? null
                : safeAdd(
                      currentQuantity,
                      reorderQuantity,
                      `Inventory item ${JSON.stringify(itemId)} post-reorder quantity`
                  );
        const postReorderStackCount = postReorderQuantity === null
            ? null
            : stackCount(postReorderQuantity, item.stackLimit);
        const postReorderCapacity = postReorderStackCount === null
            ? null
            : safeMultiply(
                  postReorderStackCount,
                  item.stackLimit,
                  `Inventory item ${JSON.stringify(itemId)} post-reorder capacity`
              );
        return {
            itemId,
            unitPurchasePrice,
            currentQuantity,
            material: {
                requiredQuantity: materialRequiredQuantity,
                purchaseQuantityBeforeInventory: materialPurchaseQuantity,
                stockAppliedQuantity: materialStockQuantity,
                shortageQuantity: materialShortageQuantity,
                reorderQuantity: materialReorderQuantity,
                reorderCost: materialReorderCost,
            },
            equipment: {
                requiredQuantity: equipmentRequiredQuantity,
                stockAppliedQuantity: equipmentStockQuantity,
                shortageQuantity: equipmentShortageQuantity,
                reorderQuantity: equipmentReorderQuantity,
                reorderCost: equipmentReorderCost,
            },
            shortageQuantity:
                materialShortageQuantity === null || equipmentShortageQuantity === null
                    ? null
                    : materialShortageQuantity + equipmentShortageQuantity,
            reorderQuantity,
            reorderCost: combinedReorderCost,
            postReorderSurplusQuantity:
                postReorderQuantity === null
                    ? null
                    : cleanZero(
                          postReorderQuantity -
                              equipmentRequiredQuantity -
                              materialRequiredQuantity
                      ),
            stacks: {
                itemStackLimit: item.stackLimit,
                requiredStackCount: stackCount(requiredInventoryQuantity, item.stackLimit),
                currentStackCount,
                reorderStackCount,
                postReorderStackCount,
                additionalStackCount:
                    currentStackCount === null || postReorderStackCount === null
                        ? null
                        : Math.max(0, postReorderStackCount - currentStackCount),
                postReorderCapacity,
                unusedPostReorderCapacity:
                    postReorderCapacity === null || postReorderQuantity === null
                        ? null
                        : cleanZero(postReorderCapacity - postReorderQuantity),
            },
        } satisfies FinishedRecipeInventoryRequirement;
    });
    const priceMissing = requirements.some(
        (requirement) => requirement.reorderQuantity !== null && requirement.reorderCost === null
    );
    const costProof = quantityProof !== 'exact'
        ? 'reorder-quantity-not-exact'
        : priceMissing
          ? 'item-price-not-recorded'
          : 'exact';
    return {
        allocationOrder: 'reserve-equipment-before-recurring-materials',
        demandProof,
        inventoryProof,
        quantityProof,
        costProof,
        requirements,
        totalMaterialReorderCost: exactCost(
            quantityProof,
            requirements.map((requirement) => requirement.material.reorderCost)
        ),
        totalEquipmentReorderCost: exactCost(
            quantityProof,
            requirements.map((requirement) => requirement.equipment.reorderCost)
        ),
        totalReorderCost: exactCost(
            quantityProof,
            requirements.map((requirement) => requirement.reorderCost)
        ),
        requiredStackCount:
            demandProof === 'exact'
                ? safeSum(
                      requirements.map((requirement) => requirement.stacks.requiredStackCount),
                      'Finished recipe required stack count'
                  )
                : null,
        currentStackCount: exactQuantity(
            quantityProof,
            requirements.map((requirement) => requirement.stacks.currentStackCount)
        ),
        reorderStackCount: exactQuantity(
            quantityProof,
            requirements.map((requirement) => requirement.stacks.reorderStackCount)
        ),
        postReorderStackCount: exactQuantity(
            quantityProof,
            requirements.map((requirement) => requirement.stacks.postReorderStackCount)
        ),
        additionalStackCount: exactQuantity(
            quantityProof,
            requirements.map((requirement) => requirement.stacks.additionalStackCount)
        ),
    };
}

function indexMaterialPurchases(
    itemsById: ReadonlyMap<string, Item>,
    purchases: readonly ProductionPurchase[]
): ReadonlyMap<string, ProductionPurchase> {
    const result = new Map<string, ProductionPurchase>();
    for (const purchase of purchases) {
        if (!itemsById.has(purchase.itemId)) {
            throw new Error(`Unknown material purchase item ${JSON.stringify(purchase.itemId)}`);
        }
        if (result.has(purchase.itemId)) {
            throw new Error(`Material purchases contain duplicate item ${JSON.stringify(purchase.itemId)}`);
        }
        requireNonNegativeFinite(
            purchase.requiredQuantity,
            `Material ${JSON.stringify(purchase.itemId)} required quantity`
        );
        requireNonNegativeSafeInteger(
            purchase.purchaseQuantity,
            `Material ${JSON.stringify(purchase.itemId)} purchase quantity`
        );
        if (purchase.purchaseQuantity < purchase.requiredQuantity) {
            throw new Error(
                `Material ${JSON.stringify(purchase.itemId)} purchase quantity is below its requirement`
            );
        }
        if (purchase.purchaseQuantity !== ceilWhole(purchase.requiredQuantity)) {
            throw new Error(
                `Material ${JSON.stringify(purchase.itemId)} purchase quantity is not the smallest whole requirement`
            );
        }
        requireNonNegativeFinite(
            purchase.unitCost,
            `Material ${JSON.stringify(purchase.itemId)} unit cost`
        );
        result.set(purchase.itemId, purchase);
    }
    return result;
}

function indexEquipmentRequirements(
    itemsById: ReadonlyMap<string, Item>,
    equipmentPlan: FinishedRecipeEquipmentPlan
): ReadonlyMap<string, FinishedRecipeEquipmentPlan['requirements'][number]> {
    const result = new Map<string, FinishedRecipeEquipmentPlan['requirements'][number]>();
    for (const requirement of equipmentPlan.requirements) {
        if (!itemsById.has(requirement.itemId)) {
            throw new Error(`Unknown equipment requirement ${JSON.stringify(requirement.itemId)}`);
        }
        if (result.has(requirement.itemId)) {
            throw new Error(
                `Equipment requirements contain duplicate item ${JSON.stringify(requirement.itemId)}`
            );
        }
        if (requirement.requiredQuantity !== 1) {
            throw new Error(
                `Equipment ${JSON.stringify(requirement.itemId)} required quantity must be one`
            );
        }
        if (
            requirement.unitPurchasePrice !== null &&
            (!Number.isFinite(requirement.unitPurchasePrice) ||
                requirement.unitPurchasePrice < 0)
        ) {
            throw new Error(
                `Equipment ${JSON.stringify(requirement.itemId)} purchase price must be non-negative`
            );
        }
        result.set(requirement.itemId, requirement);
    }
    return result;
}

function indexInventory(
    itemsById: ReadonlyMap<string, Item>,
    inventory: readonly FinishedRecipeInventoryItem[]
): ReadonlyMap<string, number> {
    const result = new Map<string, number>();
    for (const entry of inventory) {
        if (!itemsById.has(entry.itemId)) {
            throw new Error(`Unknown inventory item ${JSON.stringify(entry.itemId)}`);
        }
        if (result.has(entry.itemId)) {
            throw new Error(`Inventory contains duplicate item ${JSON.stringify(entry.itemId)}`);
        }
        requireNonNegativeSafeInteger(
            entry.quantity,
            `Inventory item ${JSON.stringify(entry.itemId)} quantity`
        );
        result.set(entry.itemId, entry.quantity);
    }
    return result;
}

function purchasePrice(
    item: Item,
    materialPrice: number | undefined,
    equipmentPrice: number | null | undefined
): number | null {
    if (materialPrice !== undefined && !close(materialPrice, item.basePurchasePrice)) {
        throw new Error(`Material ${JSON.stringify(item.id)} price does not match its item price`);
    }
    if (
        equipmentPrice !== undefined &&
        equipmentPrice !== null &&
        !close(equipmentPrice, item.basePurchasePrice)
    ) {
        throw new Error(`Equipment ${JSON.stringify(item.id)} price does not match its item price`);
    }
    return materialPrice ?? equipmentPrice ?? item.basePurchasePrice;
}

function reorderCost(
    quantity: number | null,
    unitPrice: number | null,
    itemId: string
): number | null {
    if (quantity === null) return null;
    if (quantity === 0) return 0;
    if (unitPrice === null) return null;
    const cost = quantity * unitPrice;
    if (!Number.isFinite(cost)) {
        throw new Error(`Inventory item ${JSON.stringify(itemId)} reorder cost must be finite`);
    }
    return cost;
}

function exactCost(
    proof: FinishedRecipeInventoryPlan['quantityProof'],
    values: readonly (number | null)[]
): number | null {
    return proof === 'exact' && values.every((value) => value !== null)
        ? finiteSum(values as readonly number[], 'Finished recipe reorder cost')
        : null;
}

function exactQuantity(
    proof: FinishedRecipeInventoryPlan['quantityProof'],
    values: readonly (number | null)[]
): number | null {
    return proof === 'exact' && values.every((value) => value !== null)
        ? safeSum(values as readonly number[], 'Finished recipe stack count')
        : null;
}

function safeSum(values: readonly number[], label: string): number {
    let total = 0;
    for (const value of values) total = safeAdd(total, value, label);
    return total;
}

function finiteSum(values: readonly number[], label: string): number {
    let total = 0;
    for (const value of values) total = finiteAdd(total, value, label);
    return total;
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

function safeMultiply(left: number, right: number, label: string): number {
    const result = left * right;
    if (!Number.isSafeInteger(result)) throw new Error(`${label} must be a safe integer`);
    return result;
}

function stackCount(quantity: number, stackLimit: number): number {
    return quantity === 0 ? 0 : Math.ceil(quantity / stackLimit);
}

function ceilWhole(value: number): number {
    const nearest = Math.round(value);
    return Math.abs(value - nearest) <= 1e-9 ? nearest : Math.ceil(value);
}

function cleanZero(value: number): number {
    return Math.abs(value) <= 1e-9 ? 0 : value;
}

function close(left: number, right: number | null): boolean {
    return (
        right !== null &&
        Math.abs(left - right) <= Math.max(1, Math.abs(left), Math.abs(right)) * 1e-9
    );
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
