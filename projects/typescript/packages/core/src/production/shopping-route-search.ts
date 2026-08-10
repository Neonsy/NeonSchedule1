import {
    legKey,
    type ShoppingRouteContext,
    type ShoppingRouteItemDemand,
    type ShoppingRouteSellerCandidate,
} from '#core/production/shopping-route-input';
import type {
    FinishedRecipeRemoteDeliveryAllocation,
    FinishedRecipeShoppingAllocation,
    FinishedRecipeShoppingRoutePlan,
    FinishedRecipeShoppingRouteVisit,
    FinishedRecipeShoppingTravelLeg,
    FinishedRecipeShoppingTrip,
    FinishedRecipeShoppingObjective,
} from '#core/production/shopping-route-types';

interface SelectedAllocation extends FinishedRecipeShoppingAllocation {
    readonly loadUnitsPerItem: number;
    readonly schedule: ShoppingRouteSellerCandidate['schedule'];
    readonly remoteDurationMinutes: number | null;
}

interface RemainingPickup {
    readonly shopCode: string;
    readonly itemId: string;
    readonly quantity: number;
    readonly loadUnitsPerItem: number;
    readonly schedule: NonNullable<ShoppingRouteSellerCandidate['schedule']>;
}

interface ActiveTrip {
    readonly startMinute: number;
    readonly visits: readonly FinishedRecipeShoppingRouteVisit[];
    readonly travelDistance: number;
    readonly peakCarriedLoadUnits: number;
}

interface RouteState {
    readonly locationId: string;
    readonly minute: number;
    readonly carriedLoadUnits: number;
    readonly remaining: readonly RemainingPickup[];
    readonly trips: readonly FinishedRecipeShoppingTrip[];
    readonly activeTrip: ActiveTrip | null;
    readonly totalTravelDistance: number;
}

interface SearchResult {
    readonly plan: FinishedRecipeShoppingRoutePlan | null;
    readonly visitedStates: number;
    readonly exhausted: boolean;
    readonly foundCompleteAllocation: boolean;
}

class SearchBudget {
    visitedStates = 0;
    exhausted = false;

    constructor(readonly maximumStates: number) {}

    enter(): boolean {
        if (this.visitedStates >= this.maximumStates) {
            this.exhausted = true;
            return false;
        }
        this.visitedStates += 1;
        return true;
    }
}

export function searchShoppingRoutes(context: ShoppingRouteContext): SearchResult {
    const budget = new SearchBudget(context.input.maximumStates);
    let best: FinishedRecipeShoppingRoutePlan | null = null;
    let foundCompleteAllocation = false;

    const enumerateItems = (
        itemIndex: number,
        selected: readonly SelectedAllocation[]
    ): void => {
        if (!budget.enter()) return;
        if (itemIndex === context.demands.length) {
            foundCompleteAllocation = true;
            searchAllocationRoutes(context, selected, budget, (candidate) => {
                if (best === null || comparePlans(candidate, best, context.input.objective) < 0) {
                    best = candidate;
                }
            });
            return;
        }
        const demand = context.demands[itemIndex]!;
        enumerateSellerQuantities(demand, budget, (allocations) => {
            enumerateItems(itemIndex + 1, [...selected, ...allocations]);
        });
    };

    enumerateItems(0, []);
    return {
        plan: best,
        visitedStates: budget.visitedStates,
        exhausted: budget.exhausted,
        foundCompleteAllocation,
    };
}

function enumerateSellerQuantities(
    demand: ShoppingRouteItemDemand,
    budget: SearchBudget,
    accept: (allocations: readonly SelectedAllocation[]) => void
): void {
    const visit = (
        sellerIndex: number,
        remaining: number,
        selected: readonly SelectedAllocation[]
    ): void => {
        if (!budget.enter()) return;
        if (sellerIndex === demand.sellers.length) {
            if (remaining === 0) accept(selected);
            return;
        }
        const seller = demand.sellers[sellerIndex]!;
        const maximum = Math.min(remaining, seller.capacity);
        for (let quantity = maximum; quantity >= 0; quantity -= 1) {
            const allocation = quantity === 0 ? [] : [selectedAllocation(demand, seller, quantity)];
            visit(sellerIndex + 1, remaining - quantity, [...selected, ...allocation]);
            if (budget.exhausted) return;
        }
    };
    visit(0, demand.quantity, []);
}

function selectedAllocation(
    demand: ShoppingRouteItemDemand,
    seller: ShoppingRouteSellerCandidate,
    quantity: number
): SelectedAllocation {
    const totalPrice = finiteMultiply(
        seller.unitPrice,
        quantity,
        `Shopping allocation ${JSON.stringify(seller.shopCode)} cost`
    );
    return {
        shopCode: seller.shopCode,
        itemId: demand.itemId,
        access: seller.access,
        quantity,
        unitPrice: seller.unitPrice,
        totalPrice,
        loadUnitsPerItem: demand.loadUnitsPerItem,
        schedule: seller.schedule,
        remoteDurationMinutes: seller.remoteDurationMinutes,
    };
}

function searchAllocationRoutes(
    context: ShoppingRouteContext,
    allocations: readonly SelectedAllocation[],
    budget: SearchBudget,
    accept: (plan: FinishedRecipeShoppingRoutePlan) => void
): void {
    const physical = allocations.filter((allocation) => allocation.access === 'physical');
    const remote = allocations.filter((allocation) => allocation.access === 'remote-delivery');
    const capacity = context.input.movement.carryingCapacity;
    if (physical.some((allocation) => allocation.loadUnitsPerItem > capacity)) return;
    const remaining: RemainingPickup[] = physical.map((allocation) => ({
        shopCode: allocation.shopCode,
        itemId: allocation.itemId,
        quantity: allocation.quantity,
        loadUnitsPerItem: allocation.loadUnitsPerItem,
        schedule: allocation.schedule!,
    })).sort(comparePickups);
    const remoteDeliveries = groupRemoteDeliveries(
        remote,
        context.input.movement.startMinute
    );
    const remoteCompletionMinute = remoteDeliveries.reduce(
        (latest, delivery) => Math.max(latest, delivery.completionMinute),
        context.input.movement.startMinute
    );
    const totalPurchaseCost = finiteSum(
        allocations.map((allocation) => allocation.totalPrice),
        'Shopping total purchase cost'
    );
    const initial: RouteState = {
        locationId: context.input.travel.depotLocationId,
        minute: context.input.movement.startMinute,
        carriedLoadUnits: 0,
        remaining,
        trips: [],
        activeTrip: null,
        totalTravelDistance: 0,
    };

    const visit = (state: RouteState): void => {
        if (!budget.enter()) return;
        if (state.remaining.length === 0) {
            if (state.locationId !== context.input.travel.depotLocationId) {
                const returned = returnToDepot(context, state);
                if (returned !== null) visit(returned);
                return;
            }
            const physicalCompletionMinute = state.minute;
            const completionMinute = Math.max(physicalCompletionMinute, remoteCompletionMinute);
            accept({
                objective: context.input.objective,
                tieBreak: 'remaining-metrics-then-trip-count-then-canonical-shop-item-identity-order',
                movementModelId: context.input.movement.modelId,
                carryingModel: 'caller-supplied-load-units',
                tripModel: 'each-trip-starts-and-returns-to-depot',
                scheduleModel: 'service-start-must-be-within-recurring-shop-window',
                remoteDeliveryModel: 'caller-supplied-concurrent-duration-from-route-start',
                proof: 'best-known-feasible',
                evidenceProof: context.evidenceComplete ? 'complete' : 'incomplete',
                searchProof: 'state-limit-reached',
                evidenceGaps: context.evidenceGaps,
                visitedStates: 0,
                maximumStates: context.input.maximumStates,
                allocations: allocations.map(publicAllocation),
                trips: state.trips,
                remoteDeliveries,
                totalPurchaseCost,
                totalTravelDistance: state.totalTravelDistance,
                physicalCompletionMinute,
                remoteCompletionMinute,
                completionMinute,
                elapsedMinutes: completionMinute - context.input.movement.startMinute,
            });
            return;
        }

        const availableLoad = capacity - state.carriedLoadUnits;
        const shopCodes = [...new Set(state.remaining.map((pickup) => pickup.shopCode))].sort();
        for (const shopCode of shopCodes) {
            if (shopCode === state.locationId) continue;
            const leg = context.legs.get(legKey(state.locationId, shopCode));
            if (leg === undefined) continue;
            const shopPickups = state.remaining.filter((pickup) => pickup.shopCode === shopCode);
            const schedule = shopPickups[0]!.schedule;
            enumeratePickupChoices(shopPickups, availableLoad, budget, (pickedUp) => {
                const next = travelAndPickup(context, state, shopCode, leg, schedule, pickedUp);
                if (next !== null) visit(next);
            });
            if (budget.exhausted) return;
        }
        if (state.locationId !== context.input.travel.depotLocationId) {
            const returned = returnToDepot(context, state);
            if (returned !== null) visit(returned);
        }
    };

    visit(initial);
}

function enumeratePickupChoices(
    pickups: readonly RemainingPickup[],
    availableLoad: number,
    budget: SearchBudget,
    accept: (pickedUp: readonly { readonly itemId: string; readonly quantity: number; readonly loadUnits: number }[]) => void
): void {
    const visit = (
        index: number,
        loadLeft: number,
        selected: readonly { readonly itemId: string; readonly quantity: number; readonly loadUnits: number }[]
    ): void => {
        if (!budget.enter()) return;
        if (index === pickups.length) {
            if (selected.length > 0) accept(selected);
            return;
        }
        const pickup = pickups[index]!;
        const maximum = Math.min(pickup.quantity, Math.floor(loadLeft / pickup.loadUnitsPerItem));
        for (let quantity = maximum; quantity >= 0; quantity -= 1) {
            const loadUnits = quantity * pickup.loadUnitsPerItem;
            visit(
                index + 1,
                loadLeft - loadUnits,
                quantity === 0
                    ? selected
                    : [...selected, { itemId: pickup.itemId, quantity, loadUnits }]
            );
            if (budget.exhausted) return;
        }
    };
    visit(0, availableLoad, []);
}

function travelAndPickup(
    context: ShoppingRouteContext,
    state: RouteState,
    shopCode: string,
    leg: FinishedRecipeShoppingTravelLeg,
    schedule: NonNullable<ShoppingRouteSellerCandidate['schedule']>,
    pickedUp: readonly { readonly itemId: string; readonly quantity: number; readonly loadUnits: number }[]
): RouteState | null {
    const arrivalMinute = finiteAdd(state.minute, leg.durationMinutes, 'Shopping arrival minute');
    const serviceStartMinute = nextOpenMinute(arrivalMinute, schedule);
    if (serviceStartMinute === null) return null;
    const departureMinute = finiteAdd(
        serviceStartMinute,
        context.input.movement.serviceMinutesPerVisit,
        'Shopping departure minute'
    );
    const addedLoad = safeSum(pickedUp.map((pickup) => pickup.loadUnits), 'Shopping picked-up load');
    const carriedLoadUnitsAfterVisit = safeAdd(
        state.carriedLoadUnits,
        addedLoad,
        'Shopping carried load'
    );
    const visit: FinishedRecipeShoppingRouteVisit = {
        shopCode,
        leg: { ...leg },
        arrivalMinute,
        waitingMinutes: serviceStartMinute - arrivalMinute,
        serviceStartMinute,
        departureMinute,
        pickedUp: [...pickedUp].sort((left, right) => left.itemId.localeCompare(right.itemId)),
        carriedLoadUnitsAfterVisit,
    };
    const activeTrip = state.activeTrip ?? {
        startMinute: state.minute,
        visits: [],
        travelDistance: 0,
        peakCarriedLoadUnits: 0,
    };
    return {
        locationId: shopCode,
        minute: departureMinute,
        carriedLoadUnits: carriedLoadUnitsAfterVisit,
        remaining: subtractPickups(state.remaining, shopCode, pickedUp),
        trips: state.trips,
        activeTrip: {
            startMinute: activeTrip.startMinute,
            visits: [...activeTrip.visits, visit],
            travelDistance: finiteAdd(activeTrip.travelDistance, leg.distance, 'Shopping trip distance'),
            peakCarriedLoadUnits: Math.max(activeTrip.peakCarriedLoadUnits, carriedLoadUnitsAfterVisit),
        },
        totalTravelDistance: finiteAdd(state.totalTravelDistance, leg.distance, 'Shopping distance'),
    };
}

function returnToDepot(context: ShoppingRouteContext, state: RouteState): RouteState | null {
    const depot = context.input.travel.depotLocationId;
    const leg = context.legs.get(legKey(state.locationId, depot));
    if (leg === undefined || state.activeTrip === null) return null;
    const endMinute = finiteAdd(state.minute, leg.durationMinutes, 'Shopping trip end minute');
    const travelDistance = finiteAdd(
        state.activeTrip.travelDistance,
        leg.distance,
        'Shopping trip distance'
    );
    const trip: FinishedRecipeShoppingTrip = {
        tripIndex: state.trips.length,
        startMinute: state.activeTrip.startMinute,
        endMinute,
        elapsedMinutes: endMinute - state.activeTrip.startMinute,
        travelDistance,
        peakCarriedLoadUnits: state.activeTrip.peakCarriedLoadUnits,
        visits: state.activeTrip.visits,
        returnLeg: { ...leg },
    };
    return {
        locationId: depot,
        minute: endMinute,
        carriedLoadUnits: 0,
        remaining: state.remaining,
        trips: [...state.trips, trip],
        activeTrip: null,
        totalTravelDistance: finiteAdd(state.totalTravelDistance, leg.distance, 'Shopping distance'),
    };
}

function subtractPickups(
    remaining: readonly RemainingPickup[],
    shopCode: string,
    pickedUp: readonly { readonly itemId: string; readonly quantity: number }[]
): RemainingPickup[] {
    const quantities = new Map(pickedUp.map((pickup) => [pickup.itemId, pickup.quantity]));
    return remaining.flatMap((pickup) => {
        if (pickup.shopCode !== shopCode) return [pickup];
        const quantity = pickup.quantity - (quantities.get(pickup.itemId) ?? 0);
        if (quantity < 0) throw new Error('Shopping pickup exceeds remaining quantity');
        return quantity === 0 ? [] : [{ ...pickup, quantity }];
    });
}

function groupRemoteDeliveries(
    allocations: readonly SelectedAllocation[],
    startMinute: number
): FinishedRecipeRemoteDeliveryAllocation[] {
    const byShop = new Map<string, SelectedAllocation[]>();
    for (const allocation of allocations) {
        const values = byShop.get(allocation.shopCode) ?? [];
        values.push(allocation);
        byShop.set(allocation.shopCode, values);
    }
    return [...byShop].sort(([left], [right]) => left.localeCompare(right)).map(([shopCode, values]) => ({
        shopCode,
        completionMinute: finiteAdd(
            startMinute,
            values[0]!.remoteDurationMinutes!,
            `Remote delivery ${JSON.stringify(shopCode)} completion minute`
        ),
        allocations: values.map(publicAllocation).sort(compareAllocations),
    }));
}

function publicAllocation(allocation: SelectedAllocation): FinishedRecipeShoppingAllocation {
    return {
        shopCode: allocation.shopCode,
        itemId: allocation.itemId,
        access: allocation.access,
        quantity: allocation.quantity,
        unitPrice: allocation.unitPrice,
        totalPrice: allocation.totalPrice,
    };
}

function nextOpenMinute(minute: number, schedule: { readonly openTime: number; readonly closeTime: number }): number | null {
    const open = hhmmMinutes(schedule.openTime);
    const close = hhmmMinutes(schedule.closeTime);
    if (open === close) return null;
    const dayStart = Math.floor(minute / 1440) * 1440;
    const withinDay = minute - dayStart;
    if (open < close) {
        if (withinDay < open) return dayStart + open;
        if (withinDay < close) return minute;
        return dayStart + 1440 + open;
    }
    if (withinDay >= open || withinDay < close) return minute;
    return dayStart + open;
}

function hhmmMinutes(value: number): number {
    return Math.floor(value / 100) * 60 + value % 100;
}

function comparePlans(
    left: FinishedRecipeShoppingRoutePlan,
    right: FinishedRecipeShoppingRoutePlan,
    objective: FinishedRecipeShoppingObjective
): number {
    const primary = objective === 'minimum-purchase-cost'
        ? left.totalPurchaseCost - right.totalPurchaseCost
        : objective === 'minimum-elapsed-minutes'
            ? left.elapsedMinutes - right.elapsedMinutes
            : left.totalTravelDistance - right.totalTravelDistance;
    if (primary !== 0) return primary;
    const remaining = objective === 'minimum-purchase-cost'
        ? left.elapsedMinutes - right.elapsedMinutes || left.totalTravelDistance - right.totalTravelDistance
        : objective === 'minimum-elapsed-minutes'
            ? left.totalPurchaseCost - right.totalPurchaseCost || left.totalTravelDistance - right.totalTravelDistance
            : left.totalPurchaseCost - right.totalPurchaseCost || left.elapsedMinutes - right.elapsedMinutes;
    return remaining || left.trips.length - right.trips.length || planSignature(left).localeCompare(planSignature(right));
}

function planSignature(plan: FinishedRecipeShoppingRoutePlan): string {
    return [
        ...plan.allocations.map((entry) => `${entry.itemId}:${entry.shopCode}:${entry.quantity}`),
        ...plan.trips.flatMap((trip) => trip.visits.map((visit) =>
            `${trip.tripIndex}:${visit.shopCode}:${visit.pickedUp.map((entry) => `${entry.itemId}:${entry.quantity}`).join(',')}`
        )),
    ].join('|');
}

function comparePickups(left: RemainingPickup, right: RemainingPickup): number {
    return left.shopCode.localeCompare(right.shopCode) || left.itemId.localeCompare(right.itemId);
}

function compareAllocations(
    left: FinishedRecipeShoppingAllocation,
    right: FinishedRecipeShoppingAllocation
): number {
    return left.itemId.localeCompare(right.itemId) || left.shopCode.localeCompare(right.shopCode);
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
