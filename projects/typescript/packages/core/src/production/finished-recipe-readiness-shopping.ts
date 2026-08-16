import type {
    FinishedRecipeProductionReadinessGap,
    FinishedRecipeProductionReadinessInput,
    FinishedRecipeProductionReadinessResult,
} from '#core/production/finished-recipe-readiness-types';
import type {
    FinishedRecipeShoppingRoutePlan,
} from '#core/production/shopping-route-types';
import { validateFinishedRecipeShoppingPropertyAttributionResult } from '#core/production/shopping-property-attribution';
import { indexFinishedRecipeShoppingAllocationArrivals } from '#core/production/shopping-route-validation';

export interface ProductionReadinessShoppingSummary {
    readonly routeProof: FinishedRecipeProductionReadinessResult['shoppingRouteProof'];
    readonly routeStartMinute: number | null;
    readonly completionMinute: number | null;
    readonly arrivalByItemId: ReadonlyMap<string, number>;
    readonly propertyAttributionSupplied: boolean;
}

export function summarizeProductionReadinessShopping(
    input: FinishedRecipeProductionReadinessInput,
    gaps: FinishedRecipeProductionReadinessGap[]
): ProductionReadinessShoppingSummary {
    const route = input.shopping.route;
    if (route.kind === 'not-planned') {
        if (input.shopping.propertyAttribution !== undefined) {
            throw new Error('Shopping property attribution requires a planned shopping route');
        }
        addGap(gaps, 'shopping-route-not-planned', route.reason);
        return {
            routeProof: route.proof === 'exact' ? 'exact-not-planned' : 'incomplete-not-planned',
            routeStartMinute: null,
            completionMinute: null,
            arrivalByItemId: new Map(),
            propertyAttributionSupplied: input.shopping.propertyAttribution !== undefined,
        };
    }
    const propertyArrivalByItem = propertyArrivalByItemId(input, route.plan, gaps);
    return {
        routeProof: route.plan.proof,
        routeStartMinute: route.plan.completionMinute - route.plan.elapsedMinutes,
        completionMinute: route.plan.completionMinute,
        arrivalByItemId: propertyArrivalByItem ?? shoppingArrivalByItem(route.plan),
        propertyAttributionSupplied: propertyArrivalByItem !== null,
    };
}

function propertyArrivalByItemId(
    input: FinishedRecipeProductionReadinessInput,
    routePlan: FinishedRecipeShoppingRoutePlan,
    gaps: FinishedRecipeProductionReadinessGap[]
): ReadonlyMap<string, number> | null {
    const attribution = input.shopping.propertyAttribution;
    if (attribution === undefined) return null;
    validateFinishedRecipeShoppingPropertyAttributionResult(
        input.purchasePlan,
        routePlan,
        attribution
    );
    const quantityByItem = new Map<string, number>();
    const arrivalByItem = new Map<string, number>();
    for (const allocation of attribution.allocations) {
        if (allocation.propertyId !== input.propertyId) continue;
        const quantity = (quantityByItem.get(allocation.itemId) ?? 0) + allocation.quantity;
        if (!Number.isSafeInteger(quantity)) {
            throw new Error('Shopping property attribution quantity must be a safe integer');
        }
        quantityByItem.set(allocation.itemId, quantity);
        arrivalByItem.set(
            allocation.itemId,
            Math.max(arrivalByItem.get(allocation.itemId) ?? 0, allocation.arrivalMinute)
        );
    }
    for (const requirement of input.purchasePlan.requirements) {
        if (requirement.propertyId !== input.propertyId) continue;
        const requestedQuantity = requirePurchaseValue(
            requirement.requestedQuantity,
            requirement.itemId,
            'requested quantity'
        );
        if ((quantityByItem.get(requirement.itemId) ?? 0) !== requestedQuantity) {
            addPropertyGap(gaps, requirement.itemId, input.propertyId);
            arrivalByItem.delete(requirement.itemId);
        }
    }
    return arrivalByItem;
}

export function validateProductionReadinessShoppingAllocations(
    input: FinishedRecipeProductionReadinessInput
): void {
    const route = input.shopping.route;
    if (route.kind !== 'planned') return;
    const requestedByItem = sumByItem(
        input.purchasePlan.requirements.map((requirement) => ({
            itemId: requirement.itemId,
            quantity: requirePurchaseValue(
                requirement.requestedQuantity,
                requirement.itemId,
                'requested quantity'
            ),
        })),
        'Purchase requirement'
    );
    const itemPlanByItem = new Map<string, number>();
    for (const item of input.purchasePlan.items) {
        if (itemPlanByItem.has(item.itemId)) {
            throw new Error(`Purchase plan contains duplicate item ${JSON.stringify(item.itemId)}`);
        }
        requireNonNegativeSafeInteger(
            item.requestedQuantity,
            `Purchase item ${JSON.stringify(item.itemId)} requested quantity`
        );
        itemPlanByItem.set(item.itemId, item.requestedQuantity);
    }
    assertSameQuantities(requestedByItem, itemPlanByItem, 'Purchase item totals');
    const plannedByItem = sumByItem(route.plan.allocations, 'Shopping allocation');
    assertSameQuantities(itemPlanByItem, plannedByItem, 'Shopping allocations');
}

function shoppingArrivalByItem(
    plan: FinishedRecipeShoppingRoutePlan
): ReadonlyMap<string, number> {
    const arrivals = indexFinishedRecipeShoppingAllocationArrivals(plan);
    const arrivalByItem = new Map<string, number>();
    for (const { allocation, completionMinute } of arrivals.values()) {
        arrivalByItem.set(
            allocation.itemId,
            Math.max(arrivalByItem.get(allocation.itemId) ?? 0, completionMinute)
        );
    }
    return arrivalByItem;
}

function sumByItem(
    values: readonly { readonly itemId: string; readonly quantity: number }[],
    label: string
): ReadonlyMap<string, number> {
    const result = new Map<string, number>();
    for (const value of values) {
        requireNonBlank(value.itemId, `${label} item ID`);
        requireNonNegativeSafeInteger(value.quantity, `${label} quantity`);
        const next = (result.get(value.itemId) ?? 0) + value.quantity;
        if (!Number.isSafeInteger(next)) throw new Error(`${label} total must be a safe integer`);
        result.set(value.itemId, next);
    }
    return result;
}

function assertSameQuantities(
    expected: ReadonlyMap<string, number>,
    actual: ReadonlyMap<string, number>,
    label: string
): void {
    const keys = new Set([...expected.keys(), ...actual.keys()]);
    for (const key of keys) {
        if ((expected.get(key) ?? 0) !== (actual.get(key) ?? 0)) {
            throw new Error(`${label} do not match allocations for ${JSON.stringify(key)}`);
        }
    }
}

function addGap(
    gaps: FinishedRecipeProductionReadinessGap[],
    code: FinishedRecipeProductionReadinessGap['code'],
    shoppingReason: FinishedRecipeProductionReadinessGap['shoppingReason']
): void {
    if (gaps.some((gap) => gap.code === code && gap.shoppingReason === shoppingReason)) return;
    gaps.push({ code, itemId: null, propertyId: null, shoppingReason });
}

function addPropertyGap(
    gaps: FinishedRecipeProductionReadinessGap[],
    itemId: string,
    propertyId: string
): void {
    if (gaps.some((gap) =>
        gap.code === 'shopping-property-attribution-incomplete' &&
        gap.itemId === itemId &&
        gap.propertyId === propertyId
    )) return;
    gaps.push({
        code: 'shopping-property-attribution-incomplete',
        itemId,
        propertyId,
        shoppingReason: null,
    });
}

function requirePurchaseValue(value: number | null, itemId: string, label: string): number {
    if (value === null) {
        throw new Error(`Purchase item ${JSON.stringify(itemId)} ${label} is unavailable`);
    }
    requireNonNegativeSafeInteger(value, `Purchase item ${JSON.stringify(itemId)} ${label}`);
    return value;
}

function requireNonBlank(value: string, label: string): void {
    if (value.trim().length === 0) throw new Error(`${label} must not be blank`);
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${label} must be a non-negative safe integer`);
    }
}
