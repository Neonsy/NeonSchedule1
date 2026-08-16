import type {
    FinishedRecipeShoppingAllocation,
    FinishedRecipeShoppingRoutePlan,
} from '#core/production/shopping-route-types';

export interface IndexedFinishedRecipeShoppingAllocationArrival {
    readonly allocation: FinishedRecipeShoppingAllocation;
    readonly completionMinute: number;
}

export function indexFinishedRecipeShoppingAllocationArrivals(
    plan: FinishedRecipeShoppingRoutePlan
): ReadonlyMap<string, IndexedFinishedRecipeShoppingAllocationArrival> {
    validateRouteMinutes(plan);
    const remoteCompletionByAllocation = new Map<string, {
        readonly allocation: FinishedRecipeShoppingAllocation;
        readonly completionMinute: number;
    }>();
    for (const delivery of plan.remoteDeliveries) {
        requireNonNegativeFinite(
            delivery.completionMinute,
            `Remote delivery ${JSON.stringify(delivery.shopCode)} completion minute`
        );
        for (const allocation of delivery.allocations) {
            if (allocation.access !== 'remote-delivery' || allocation.shopCode !== delivery.shopCode) {
                throw new Error('Remote delivery allocation does not match its shopping delivery');
            }
            const key = finishedRecipeShoppingAllocationKey(allocation);
            if (remoteCompletionByAllocation.has(key)) {
                throw new Error(`Duplicate remote shopping allocation ${JSON.stringify(key)}`);
            }
            validateAllocation(allocation);
            remoteCompletionByAllocation.set(key, {
                allocation,
                completionMinute: delivery.completionMinute,
            });
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
    const result = new Map<string, IndexedFinishedRecipeShoppingAllocationArrival>();
    const allocationKeys = new Set<string>();
    const physicalAllocations = new Map<string, number>();
    for (const allocation of plan.allocations) {
        validateAllocation(allocation);
        const key = finishedRecipeShoppingAllocationKey(allocation);
        if (allocationKeys.has(key)) {
            throw new Error(`Duplicate shopping allocation ${JSON.stringify(key)}`);
        }
        allocationKeys.add(key);
        const remote = remoteCompletionByAllocation.get(key);
        if (remote !== undefined && !sameAllocation(allocation, remote.allocation)) {
            throw new Error(`Remote delivery allocation does not match selected shopping allocation ${JSON.stringify(key)}`);
        }
        const arrival = allocation.access === 'physical'
            ? plan.physicalCompletionMinute
            : remote?.completionMinute;
        if (allocation.access === 'physical') physicalAllocations.set(key, allocation.quantity);
        if (arrival === undefined) {
            throw new Error(`Missing remote completion for shopping allocation ${JSON.stringify(key)}`);
        }
        result.set(key, { allocation, completionMinute: arrival });
    }
    for (const key of remoteCompletionByAllocation.keys()) {
        if (!allocationKeys.has(key)) {
            throw new Error(`Remote delivery contains unknown shopping allocation ${JSON.stringify(key)}`);
        }
    }
    validatePhysicalPickups(plan, physicalAllocations);
    const totalPurchaseCost = finiteSum(
        plan.allocations.map((allocation) => allocation.totalPrice),
        'Shopping allocation total purchase cost'
    );
    if (plan.totalPurchaseCost !== totalPurchaseCost) {
        throw new Error('Shopping total purchase cost is inconsistent');
    }
    return result;
}

function validateAllocation(allocation: FinishedRecipeShoppingAllocation): void {
    requireNonBlank(allocation.itemId, 'Shopping allocation item ID');
    requireNonBlank(allocation.shopCode, 'Shopping allocation shop code');
    if (allocation.access !== 'physical' && allocation.access !== 'remote-delivery') {
        throw new Error('Shopping allocation access is invalid');
    }
    requirePositiveSafeInteger(
        allocation.quantity,
        `Shopping allocation ${JSON.stringify(allocation.itemId)} quantity`
    );
    requireNonNegativeFinite(
        allocation.unitPrice,
        `Shopping allocation ${JSON.stringify(allocation.itemId)} unit price`
    );
    const totalPrice = finiteMultiply(
        allocation.unitPrice,
        allocation.quantity,
        `Shopping allocation ${JSON.stringify(allocation.itemId)} total price`
    );
    if (allocation.totalPrice !== totalPrice) {
        throw new Error(`Shopping allocation ${JSON.stringify(allocation.itemId)} price is inconsistent`);
    }
}

function sameAllocation(
    left: FinishedRecipeShoppingAllocation,
    right: FinishedRecipeShoppingAllocation
): boolean {
    return left.shopCode === right.shopCode &&
        left.itemId === right.itemId &&
        left.access === right.access &&
        left.quantity === right.quantity &&
        left.unitPrice === right.unitPrice &&
        left.totalPrice === right.totalPrice;
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

export function finishedRecipeShoppingAllocationKey(
    allocation: Pick<FinishedRecipeShoppingAllocation, 'shopCode' | 'itemId' | 'access'>
): string {
    return `${allocation.shopCode}\u0000${allocation.itemId}\u0000${allocation.access}`;
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
                const key = finishedRecipeShoppingAllocationKey({
                    shopCode: visit.shopCode,
                    itemId: pickup.itemId,
                    access: 'physical',
                });
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

function requireNonBlank(value: string, label: string): void {
    if (value.trim().length === 0) throw new Error(`${label} must not be blank`);
}

function requireNonNegativeFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative`);
}

function requirePositiveSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${label} must be a positive safe integer`);
    }
}

function finiteSum(values: readonly number[], label: string): number {
    let result = 0;
    for (const value of values) {
        result += value;
        if (!Number.isFinite(result)) throw new Error(`${label} must be finite`);
    }
    return result;
}

function finiteMultiply(left: number, right: number, label: string): number {
    const result = left * right;
    if (!Number.isFinite(result)) throw new Error(`${label} must be finite`);
    return result;
}
