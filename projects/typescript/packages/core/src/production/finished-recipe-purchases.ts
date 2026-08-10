import type { Item } from '#core/data/item';
import type { Shop } from '#core/data/shop';
import type {
    FinishedRecipePurchaseAllocation,
    FinishedRecipePurchaseInput,
    FinishedRecipePurchaseItemPlan,
    FinishedRecipePurchasePlan,
    FinishedRecipePurchaseRequirement,
    FinishedRecipePurchaseSellerOption,
    FinishedRecipeSellerEligibility,
} from '#core/production/finished-recipe-purchase-types';
import type { FinishedRecipePropertyTransferRequirement } from '#core/production/property-transfer-types';
import {
    ShopRoutePlanner,
    type ShopPurchaseOption,
} from '#core/world/shop-routing';
import type { NavigationNetwork } from '#core/world/navigation';

export type {
    FinishedRecipePurchaseAllocation,
    FinishedRecipePurchaseInput,
    FinishedRecipePurchaseItemPlan,
    FinishedRecipePurchasePlan,
    FinishedRecipePurchaseRequirement,
    FinishedRecipePurchaseSellerOption,
    FinishedRecipeSellerEligibility,
    FinishedRecipeItemEligibilityEvidence,
    FinishedRecipeSellerEligibilityEvidence,
} from '#core/production/finished-recipe-purchase-types';

interface ExactDemand {
    readonly item: Item;
    readonly materialQuantity: number;
    readonly equipmentQuantity: number;
    readonly requestedQuantity: number;
}

export class FinishedRecipePurchasePlanner {
    readonly #itemsById: ReadonlyMap<string, Item>;
    readonly #shopCodes: ReadonlySet<string>;
    readonly #routes: ShopRoutePlanner;

    constructor(network: NavigationNetwork, items: readonly Item[], shops: readonly Shop[]) {
        this.#itemsById = indexItems(items);
        this.#shopCodes = indexShopCodes(shops);
        this.#routes = new ShopRoutePlanner(network, shops);
    }

    plan(input: FinishedRecipePurchaseInput): FinishedRecipePurchasePlan {
        const eligibility = indexSellerEligibility(
            input.sellerEligibility,
            this.#shopCodes
        );
        const itemEligibility = indexItemEligibility(
            input.itemEligibility,
            this.#itemsById
        );
        const requirements = validateTransferRequirements(input.transferPlan.requirements);
        if (input.transferPlan.residualProof !== 'exact') {
            return incompleteDemandPlan(requirements);
        }
        const exactRequirements = exactPurchaseRequirements(requirements);
        const demands = aggregateDemands(exactRequirements, this.#itemsById);
        validateTransferTotals(input.transferPlan.totalResidualReorderQuantity, demands);
        const items = demands.map((demand) => this.#planItem(
            demand,
            input,
            itemEligibility.get(demand.item.id)!,
            eligibility
        ));
        const allocations = items.flatMap((item) => item.allocations);
        const totalRequestedQuantity = safeSum(
            items.map((item) => item.requestedQuantity),
            'Finished recipe purchase requested quantity'
        );
        const knownAllocatedQuantity = safeSum(
            items.map((item) => item.knownAllocatedQuantity),
            'Finished recipe purchase allocated quantity'
        );
        const unallocatedAfterSupportedPurchases = totalRequestedQuantity - knownAllocatedQuantity;
        const evidenceExact = items.every((item) => item.sellerEvidenceProof === 'exact');
        const fulfilled = items.every((item) => item.finalUnallocatedQuantity === 0);
        const knownAllocatedCost = finiteSum(
            items.map((item) => item.knownAllocatedCost),
            'Finished recipe purchase allocated cost'
        );

        return {
            objective: 'maximize-supported-fulfillment-then-minimize-cost-per-item',
            tieBreak: 'unit-price-then-shop-code',
            routeOptimization: 'not-evaluated',
            timingProof: input.atTime === undefined
                ? 'not-evaluated'
                : 'evaluated-at-requested-time',
            demandProof: 'exact',
            sellerEvidenceProof: evidenceExact ? 'exact' : 'incomplete',
            allocationProof: evidenceExact
                ? 'minimum-cost'
                : 'minimum-cost-among-supported-sellers',
            fulfillmentProof: evidenceExact ? 'exact' : 'seller-evidence-incomplete',
            requirements: exactRequirements,
            items,
            allocations,
            totalRequestedQuantity,
            knownAllocatedQuantity,
            unallocatedAfterSupportedPurchases,
            totalFinalUnallocatedQuantity: evidenceExact
                ? unallocatedAfterSupportedPurchases
                : null,
            knownAllocatedCost,
            minimumRequiredPurchaseCost: evidenceExact && fulfilled
                ? knownAllocatedCost
                : null,
        };
    }

    #planItem(
        demand: ExactDemand,
        input: FinishedRecipePurchaseInput,
        itemEligibility: 'eligible' | 'ineligible' | 'unknown',
        eligibleShopCodes: ReadonlyMap<string, 'accessible' | 'inaccessible' | 'unknown'>
    ): FinishedRecipePurchaseItemPlan {
        const options = this.#routes.findPurchaseOptions({
            itemId: demand.item.id,
            quantity: demand.requestedQuantity,
            start: input.start,
            maximumStartSnapDistance: input.maximumStartSnapDistance,
            maximumAccessSnapDistance: input.maximumAccessSnapDistance,
            ...(input.atTime === undefined ? {} : { atTime: input.atTime }),
        }).sort(comparePurchaseOptions);
        const sellerOptions = options.map((option, index) => ({
            priceRank: index + 1,
            option,
            eligibility: sellerEligibility(
                option,
                itemEligibility,
                eligibleShopCodes.get(option.shopCode)!,
                input.atTime !== undefined
            ),
        } satisfies FinishedRecipePurchaseSellerOption));
        const allocations = allocateDemand(demand, sellerOptions);
        const knownAllocatedQuantity = safeSum(
            allocations.map((allocation) => allocation.quantity),
            `Finished recipe ${JSON.stringify(demand.item.id)} allocated quantity`
        );
        const unallocated = demand.requestedQuantity - knownAllocatedQuantity;
        const sellerEvidenceExact = sellerOptions.every(
            (option) => option.eligibility.kind !== 'unknown'
        );
        const knownAllocatedCost = finiteSum(
            allocations.map((allocation) => allocation.totalPrice),
            `Finished recipe ${JSON.stringify(demand.item.id)} allocated cost`
        );

        return {
            itemId: demand.item.id,
            requiredRank: demand.item.requiredRank === null || demand.item.requiredRankTier === null
                ? null
                : { rank: demand.item.requiredRank, tier: demand.item.requiredRankTier },
            itemEligibility,
            materialQuantity: demand.materialQuantity,
            equipmentQuantity: demand.equipmentQuantity,
            requestedQuantity: demand.requestedQuantity,
            sellerEvidenceProof: sellerEvidenceExact ? 'exact' : 'incomplete',
            allocationProof: sellerEvidenceExact
                ? 'minimum-cost'
                : 'minimum-cost-among-supported-sellers',
            sellerOptions,
            allocations,
            knownAllocatedQuantity,
            unallocatedAfterSupportedPurchases: unallocated,
            finalUnallocatedQuantity: sellerEvidenceExact ? unallocated : null,
            knownAllocatedCost,
            minimumRequiredPurchaseCost: sellerEvidenceExact && unallocated === 0
                ? knownAllocatedCost
                : null,
        };
    }
}

function sellerEligibility(
    option: ShopPurchaseOption,
    itemEligibility: 'eligible' | 'ineligible' | 'unknown',
    shopEligibility: 'accessible' | 'inaccessible' | 'unknown',
    evaluatesTime: boolean
): FinishedRecipeSellerEligibility {
    if (itemEligibility === 'unknown') {
        return { kind: 'unknown', reason: 'item-eligibility-evidence-incomplete' };
    }
    if (itemEligibility === 'ineligible') {
        return { kind: 'unavailable', reason: 'item-inaccessible' };
    }
    if (shopEligibility === 'unknown') {
        return { kind: 'unknown', reason: 'shop-access-evidence-incomplete' };
    }
    if (shopEligibility === 'inaccessible') {
        return { kind: 'unavailable', reason: 'shop-inaccessible' };
    }
    if (evaluatesTime && option.availability.kind === 'unknown') {
        return { kind: 'unknown', reason: 'schedule-data-missing-at-requested-time' };
    }
    if (evaluatesTime && option.availability.kind === 'closed') {
        return { kind: 'unavailable', reason: 'shop-closed-at-requested-time' };
    }
    if (option.access.kind === 'unreachable') {
        return option.access.reason === 'no-physical-access-data'
            ? { kind: 'unknown', reason: 'physical-access-data-missing' }
            : { kind: 'unavailable', reason: 'no-reachable-access' };
    }
    if (option.access.kind === 'remote' && !option.purchase.canBeDelivered) {
        return { kind: 'unavailable', reason: 'remote-delivery-unavailable' };
    }
    if (option.purchase.stock.kind === 'unknown') {
        return { kind: 'unknown', reason: 'stock-quantity-unknown' };
    }
    return {
        kind: 'supported',
        quantityCapacity: option.purchase.stock.kind === 'unlimited'
            ? null
            : option.purchase.stock.defaultStock,
    };
}

function allocateDemand(
    demand: ExactDemand,
    options: readonly FinishedRecipePurchaseSellerOption[]
): FinishedRecipePurchaseAllocation[] {
    let remaining = demand.requestedQuantity;
    let remainingEquipment = demand.equipmentQuantity;
    const result: FinishedRecipePurchaseAllocation[] = [];
    for (const seller of options) {
        if (remaining === 0) break;
        if (seller.eligibility.kind !== 'supported') continue;
        const capacity = seller.eligibility.quantityCapacity ?? remaining;
        const quantity = Math.min(remaining, capacity);
        if (quantity === 0) continue;
        const equipmentQuantity = Math.min(quantity, remainingEquipment);
        const materialQuantity = quantity - equipmentQuantity;
        const totalPrice = finiteMultiply(
            seller.option.purchase.unitPrice,
            quantity,
            `Finished recipe ${JSON.stringify(demand.item.id)} purchase cost`
        );
        result.push({
            shopCode: seller.option.shopCode,
            itemId: demand.item.id,
            quantity,
            equipmentQuantity,
            materialQuantity,
            unitPrice: seller.option.purchase.unitPrice,
            totalPrice,
        });
        remaining -= quantity;
        remainingEquipment -= equipmentQuantity;
    }
    return result;
}

function validateTransferRequirements(
    input: readonly FinishedRecipePropertyTransferRequirement[]
): FinishedRecipePurchaseRequirement[] {
    const keys = new Set<string>();
    return input.map((requirement) => {
        requireNonBlank(requirement.propertyId, 'Purchase requirement property ID');
        requireNonBlank(requirement.itemId, 'Purchase requirement item ID');
        const key = `${requirement.propertyId}\u0000${requirement.itemId}`;
        if (keys.has(key)) {
            throw new Error(`Duplicate purchase requirement ${JSON.stringify(key)}`);
        }
        keys.add(key);
        const material = nullableQuantity(
            requirement.residualMaterialReorderQuantity,
            `Property ${JSON.stringify(requirement.propertyId)} residual material quantity`
        );
        const equipment = nullableQuantity(
            requirement.residualEquipmentReorderQuantity,
            `Property ${JSON.stringify(requirement.propertyId)} residual equipment quantity`
        );
        const requested = nullableQuantity(
            requirement.residualReorderQuantity,
            `Property ${JSON.stringify(requirement.propertyId)} residual purchase quantity`
        );
        if (material !== null && equipment !== null && requested !== safeAdd(
            material,
            equipment,
            `Property ${JSON.stringify(requirement.propertyId)} residual purchase quantity`
        )) {
            throw new Error(
                `Property ${JSON.stringify(requirement.propertyId)} residual purchase quantities are inconsistent`
            );
        }
        return {
            propertyId: requirement.propertyId,
            itemId: requirement.itemId,
            materialQuantity: material,
            equipmentQuantity: equipment,
            requestedQuantity: requested,
        };
    }).sort(compareRequirements);
}

function exactPurchaseRequirements(
    requirements: readonly FinishedRecipePurchaseRequirement[]
): FinishedRecipePurchaseRequirement[] {
    for (const requirement of requirements) {
        if (
            requirement.materialQuantity === null ||
            requirement.equipmentQuantity === null ||
            requirement.requestedQuantity === null
        ) {
            throw new Error('Exact transfer residual contains an unknown purchase quantity');
        }
    }
    return [...requirements];
}

function aggregateDemands(
    requirements: readonly FinishedRecipePurchaseRequirement[],
    itemsById: ReadonlyMap<string, Item>
): ExactDemand[] {
    const result = new Map<string, ExactDemand>();
    for (const requirement of requirements) {
        if (requirement.requestedQuantity === 0) continue;
        const item = itemsById.get(requirement.itemId);
        if (item === undefined) {
            throw new Error(`Unknown finished recipe purchase item ${JSON.stringify(requirement.itemId)}`);
        }
        if (!item.isStorable) {
            throw new Error(`Finished recipe purchase item ${JSON.stringify(item.id)} is not storable`);
        }
        const previous = result.get(item.id);
        result.set(item.id, {
            item,
            materialQuantity: safeAdd(
                previous?.materialQuantity ?? 0,
                requirement.materialQuantity!,
                `Finished recipe ${JSON.stringify(item.id)} material purchase quantity`
            ),
            equipmentQuantity: safeAdd(
                previous?.equipmentQuantity ?? 0,
                requirement.equipmentQuantity!,
                `Finished recipe ${JSON.stringify(item.id)} equipment purchase quantity`
            ),
            requestedQuantity: safeAdd(
                previous?.requestedQuantity ?? 0,
                requirement.requestedQuantity!,
                `Finished recipe ${JSON.stringify(item.id)} purchase quantity`
            ),
        });
    }
    return [...result.values()].sort((left, right) => left.item.id.localeCompare(right.item.id));
}

function validateTransferTotals(total: number | null, demands: readonly ExactDemand[]): void {
    if (total === null) throw new Error('Exact transfer residual has no total purchase quantity');
    requireNonNegativeSafeInteger(total, 'Transfer residual total purchase quantity');
    const calculated = safeSum(
        demands.map((demand) => demand.requestedQuantity),
        'Finished recipe purchase requested quantity'
    );
    if (calculated !== total) {
        throw new Error('Transfer residual total purchase quantity is inconsistent');
    }
}

function incompleteDemandPlan(
    requirements: readonly FinishedRecipePurchaseRequirement[]
): FinishedRecipePurchasePlan {
    return {
        objective: 'maximize-supported-fulfillment-then-minimize-cost-per-item',
        tieBreak: 'unit-price-then-shop-code',
        routeOptimization: 'not-evaluated',
        timingProof: 'not-evaluated',
        demandProof: 'transfer-residual-incomplete',
        sellerEvidenceProof: 'not-evaluated',
        allocationProof: 'not-evaluated',
        fulfillmentProof: 'transfer-residual-incomplete',
        requirements,
        items: [],
        allocations: [],
        totalRequestedQuantity: null,
        knownAllocatedQuantity: 0,
        unallocatedAfterSupportedPurchases: null,
        totalFinalUnallocatedQuantity: null,
        knownAllocatedCost: 0,
        minimumRequiredPurchaseCost: null,
    };
}

function indexItems(items: readonly Item[]): ReadonlyMap<string, Item> {
    const result = new Map<string, Item>();
    for (const item of items) {
        requireNonBlank(item.id, 'Purchase item ID');
        if (result.has(item.id)) throw new Error(`Duplicate purchase item ${JSON.stringify(item.id)}`);
        if ((item.requiredRank === null) !== (item.requiredRankTier === null)) {
            throw new Error(`Purchase item ${JSON.stringify(item.id)} has an incomplete rank requirement`);
        }
        result.set(item.id, item);
    }
    return result;
}

function indexShopCodes(shops: readonly Shop[]): ReadonlySet<string> {
    const result = new Set<string>();
    for (const shop of shops) {
        requireNonBlank(shop.code, 'Purchase shop code');
        if (result.has(shop.code)) throw new Error(`Duplicate purchase shop ${JSON.stringify(shop.code)}`);
        result.add(shop.code);
    }
    return result;
}

function indexSellerEligibility(
    evidence: FinishedRecipePurchaseInput['sellerEligibility'],
    shopCodes: ReadonlySet<string>
): ReadonlyMap<string, 'accessible' | 'inaccessible' | 'unknown'> {
    if (evidence.coverage !== 'complete' && evidence.coverage !== 'partial') {
        throw new Error('Seller eligibility coverage must be complete or partial');
    }
    const accessible = new Set<string>();
    for (const code of evidence.accessibleShopCodes) {
        if (!shopCodes.has(code)) throw new Error(`Unknown accessible shop ${JSON.stringify(code)}`);
        if (accessible.has(code)) throw new Error(`Duplicate accessible shop ${JSON.stringify(code)}`);
        accessible.add(code);
    }
    return new Map([...shopCodes].map((code) => [
        code,
        accessible.has(code)
            ? 'accessible'
            : evidence.coverage === 'complete'
                ? 'inaccessible'
                : 'unknown',
    ]));
}

function indexItemEligibility(
    evidence: FinishedRecipePurchaseInput['itemEligibility'],
    itemsById: ReadonlyMap<string, Item>
): ReadonlyMap<string, 'eligible' | 'ineligible' | 'unknown'> {
    if (evidence.coverage !== 'complete' && evidence.coverage !== 'partial') {
        throw new Error('Item eligibility coverage must be complete or partial');
    }
    const eligible = new Set<string>();
    for (const itemId of evidence.eligibleItemIds) {
        if (!itemsById.has(itemId)) throw new Error(`Unknown eligible item ${JSON.stringify(itemId)}`);
        if (eligible.has(itemId)) throw new Error(`Duplicate eligible item ${JSON.stringify(itemId)}`);
        eligible.add(itemId);
    }
    return new Map([...itemsById.keys()].map((itemId) => [
        itemId,
        eligible.has(itemId)
            ? 'eligible'
            : evidence.coverage === 'complete'
                ? 'ineligible'
                : 'unknown',
    ]));
}

function comparePurchaseOptions(left: ShopPurchaseOption, right: ShopPurchaseOption): number {
    return left.purchase.unitPrice - right.purchase.unitPrice ||
        left.shopCode.localeCompare(right.shopCode);
}

function compareRequirements(
    left: FinishedRecipePurchaseRequirement,
    right: FinishedRecipePurchaseRequirement
): number {
    return left.itemId.localeCompare(right.itemId) || left.propertyId.localeCompare(right.propertyId);
}

function nullableQuantity(value: number | null, label: string): number | null {
    if (value !== null) requireNonNegativeSafeInteger(value, label);
    return value;
}

function requireNonBlank(value: string, label: string): void {
    if (value.trim().length === 0) throw new Error(`${label} must not be blank`);
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${label} must be a non-negative safe integer`);
    }
}

function safeSum(values: readonly number[], label: string): number {
    let result = 0;
    for (const value of values) result = safeAdd(result, value, label);
    return result;
}

function safeAdd(left: number, right: number, label: string): number {
    const result = left + right;
    if (!Number.isSafeInteger(result)) throw new RangeError(`${label} must be a safe integer`);
    return result;
}

function finiteSum(values: readonly number[], label: string): number {
    let result = 0;
    for (const value of values) result = finiteAdd(result, value, label);
    return result;
}

function finiteAdd(left: number, right: number, label: string): number {
    const result = left + right;
    if (!Number.isFinite(result)) throw new RangeError(`${label} must be finite`);
    return result;
}

function finiteMultiply(left: number, right: number, label: string): number {
    const result = left * right;
    if (!Number.isFinite(result)) throw new RangeError(`${label} must be finite`);
    return result;
}
