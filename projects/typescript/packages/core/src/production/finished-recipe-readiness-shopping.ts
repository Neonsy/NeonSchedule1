import type {
    FinishedRecipeProductionReadinessGap,
    FinishedRecipeProductionReadinessInput,
    FinishedRecipeProductionReadinessResult,
} from '#core/production/finished-recipe-readiness-types';
import type {
    FinishedRecipeShoppingAllocation,
    FinishedRecipeShoppingRoutePlan,
} from '#core/production/shopping-route-types';

export interface ProductionReadinessShoppingSummary {
    readonly routeProof: FinishedRecipeProductionReadinessResult['shoppingRouteProof'];
    readonly routeStartMinute: number | null;
    readonly completionMinute: number | null;
    readonly arrivalByItemId: ReadonlyMap<string, number>;
}

export function summarizeProductionReadinessShopping(
    input: FinishedRecipeProductionReadinessInput,
    gaps: FinishedRecipeProductionReadinessGap[]
): ProductionReadinessShoppingSummary {
    const route = input.shopping.route;
    if (route.kind === 'not-planned') {
        addGap(gaps, 'shopping-route-not-planned', route.reason);
        return {
            routeProof: route.proof === 'exact' ? 'exact-not-planned' : 'incomplete-not-planned',
            routeStartMinute: null,
            completionMinute: null,
            arrivalByItemId: new Map(),
        };
    }
    validateRouteMinutes(route.plan);
    return {
        routeProof: route.plan.proof,
        routeStartMinute: route.plan.completionMinute - route.plan.elapsedMinutes,
        completionMinute: route.plan.completionMinute,
        arrivalByItemId: shoppingArrivalByItem(route.plan),
    };
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
    const remoteCompletionByAllocation = new Map<string, number>();
    for (const delivery of plan.remoteDeliveries) {
        requireNonNegativeFinite(
            delivery.completionMinute,
            `Remote delivery ${JSON.stringify(delivery.shopCode)} completion minute`
        );
        for (const allocation of delivery.allocations) {
            if (allocation.access !== 'remote-delivery' || allocation.shopCode !== delivery.shopCode) {
                throw new Error('Remote delivery allocation does not match its shopping delivery');
            }
            const key = allocationKey(allocation);
            if (remoteCompletionByAllocation.has(key)) {
                throw new Error(`Duplicate remote shopping allocation ${JSON.stringify(key)}`);
            }
            remoteCompletionByAllocation.set(key, delivery.completionMinute);
        }
    }
    const routeStartMinute = plan.completionMinute - plan.elapsedMinutes;
    const latestRemoteCompletion = plan.remoteDeliveries.reduce(
        (latest, delivery) => Math.max(latest, delivery.completionMinute),
        routeStartMinute
    );
    if (latestRemoteCompletion !== plan.remoteCompletionMinute) {
        throw new Error('Remote shopping completion minute is inconsistent');
    }
    const arrivalByItem = new Map<string, number>();
    const allocationKeys = new Set<string>();
    const physicalAllocations = new Map<string, number>();
    for (const allocation of plan.allocations) {
        requireNonBlank(allocation.itemId, 'Shopping allocation item ID');
        requireNonBlank(allocation.shopCode, 'Shopping allocation shop code');
        requirePositiveSafeInteger(
            allocation.quantity,
            `Shopping allocation ${JSON.stringify(allocation.itemId)} quantity`
        );
        const key = allocationKey(allocation);
        if (allocationKeys.has(key)) {
            throw new Error(`Duplicate shopping allocation ${JSON.stringify(key)}`);
        }
        allocationKeys.add(key);
        const arrival = allocation.access === 'physical'
            ? plan.physicalCompletionMinute
            : remoteCompletionByAllocation.get(key);
        if (allocation.access === 'physical') physicalAllocations.set(key, allocation.quantity);
        if (arrival === undefined) {
            throw new Error(`Missing remote completion for shopping allocation ${JSON.stringify(key)}`);
        }
        arrivalByItem.set(
            allocation.itemId,
            Math.max(arrivalByItem.get(allocation.itemId) ?? 0, arrival)
        );
    }
    for (const key of remoteCompletionByAllocation.keys()) {
        if (!allocationKeys.has(key)) {
            throw new Error(`Remote delivery contains unknown shopping allocation ${JSON.stringify(key)}`);
        }
    }
    validatePhysicalPickups(plan, physicalAllocations);
    return arrivalByItem;
}

function validatePhysicalPickups(
    plan: FinishedRecipeShoppingRoutePlan,
    expected: ReadonlyMap<string, number>
): void {
    const actual = new Map<string, number>();
    const routeStartMinute = plan.completionMinute - plan.elapsedMinutes;
    let latestTripEndMinute = routeStartMinute;
    for (const trip of plan.trips) {
        requireNonNegativeFinite(trip.endMinute, `Shopping trip ${trip.tripIndex} end minute`);
        if (trip.endMinute > plan.physicalCompletionMinute) {
            throw new Error(`Shopping trip ${trip.tripIndex} ends after physical completion`);
        }
        latestTripEndMinute = Math.max(latestTripEndMinute, trip.endMinute);
        for (const visit of trip.visits) {
            for (const pickup of visit.pickedUp) {
                requirePositiveSafeInteger(
                    pickup.quantity,
                    `Shopping pickup ${JSON.stringify(pickup.itemId)} quantity`
                );
                const key = `${visit.shopCode}\u0000${pickup.itemId}`;
                const next = (actual.get(key) ?? 0) + pickup.quantity;
                if (!Number.isSafeInteger(next)) {
                    throw new Error('Shopping pickup quantity must be a safe integer');
                }
                actual.set(key, next);
            }
        }
    }
    if (latestTripEndMinute !== plan.physicalCompletionMinute) {
        throw new Error('Physical shopping completion minute is inconsistent');
    }
    assertSameQuantities(expected, actual, 'Physical shopping pickups');
}

function validateRouteMinutes(plan: FinishedRecipeShoppingRoutePlan): void {
    requireNonNegativeFinite(plan.physicalCompletionMinute, 'Physical shopping completion minute');
    requireNonNegativeFinite(plan.remoteCompletionMinute, 'Remote shopping completion minute');
    requireNonNegativeFinite(plan.completionMinute, 'Shopping completion minute');
    requireNonNegativeFinite(plan.elapsedMinutes, 'Shopping elapsed minutes');
    const start = plan.completionMinute - plan.elapsedMinutes;
    if (!Number.isFinite(start) || start < 0) {
        throw new Error('Shopping route start minute must be non-negative');
    }
    if (
        plan.completionMinute !== Math.max(
            plan.physicalCompletionMinute,
            plan.remoteCompletionMinute
        )
    ) {
        throw new Error('Shopping completion minute is inconsistent');
    }
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

function allocationKey(allocation: FinishedRecipeShoppingAllocation): string {
    return `${allocation.shopCode}\u0000${allocation.itemId}`;
}

function addGap(
    gaps: FinishedRecipeProductionReadinessGap[],
    code: FinishedRecipeProductionReadinessGap['code'],
    shoppingReason: FinishedRecipeProductionReadinessGap['shoppingReason']
): void {
    if (gaps.some((gap) => gap.code === code && gap.shoppingReason === shoppingReason)) return;
    gaps.push({ code, itemId: null, propertyId: null, shoppingReason });
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
