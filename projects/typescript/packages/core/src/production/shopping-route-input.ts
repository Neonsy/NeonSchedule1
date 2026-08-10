import type { ShopSchedule } from '#core/world/shop-routing';
import type {
    FinishedRecipeShoppingEvidenceGap,
    FinishedRecipeShoppingRouteInput,
    FinishedRecipeShoppingTravelLeg,
} from '#core/production/shopping-route-types';

export interface ShoppingRouteSellerCandidate {
    readonly shopCode: string;
    readonly itemId: string;
    readonly access: 'physical' | 'remote-delivery';
    readonly capacity: number;
    readonly unitPrice: number;
    readonly schedule: ShopSchedule | null;
    readonly remoteDurationMinutes: number | null;
}

export interface ShoppingRouteItemDemand {
    readonly itemId: string;
    readonly quantity: number;
    readonly loadUnitsPerItem: number;
    readonly sellers: readonly ShoppingRouteSellerCandidate[];
}

export interface ShoppingRouteContext {
    readonly input: FinishedRecipeShoppingRouteInput;
    readonly demands: readonly ShoppingRouteItemDemand[];
    readonly legs: ReadonlyMap<string, FinishedRecipeShoppingTravelLeg>;
    readonly evidenceComplete: boolean;
    readonly evidenceGaps: readonly FinishedRecipeShoppingEvidenceGap[];
}

export function shoppingRouteContext(input: FinishedRecipeShoppingRouteInput):
    | ShoppingRouteContext
    | 'purchase-demand-incomplete' {
    validateTopLevel(input);
    if (
        input.purchasePlan.demandProof !== 'exact' ||
        input.purchasePlan.totalRequestedQuantity === null
    ) {
        return 'purchase-demand-incomplete';
    }

    const loadByItem = indexItemLoads(input);
    const remoteDurations = indexRemoteDeliveries(input);
    const evidenceGaps: FinishedRecipeShoppingEvidenceGap[] = [];
    if (input.purchasePlan.sellerEvidenceProof !== 'exact') {
        addGap(evidenceGaps, 'purchase-seller-evidence-incomplete');
    }
    if (input.purchasePlan.timingProof !== 'not-evaluated') {
        addGap(evidenceGaps, 'purchase-time-filtered-before-route');
    }
    if (input.travel.coverage === 'partial') addGap(evidenceGaps, 'travel-evidence-partial');
    if (input.remoteDelivery.coverage === 'partial') {
        addGap(evidenceGaps, 'remote-delivery-evidence-partial');
    }
    const itemIds = new Set<string>();
    let totalRequestedQuantity = 0;
    const extracted = input.purchasePlan.items.map((item) => {
        requireNonBlank(item.itemId, 'Shopping item ID');
        if (itemIds.has(item.itemId)) {
            throw new Error(`Duplicate shopping item ${JSON.stringify(item.itemId)}`);
        }
        itemIds.add(item.itemId);
        requirePositiveSafeInteger(item.requestedQuantity, `Shopping item ${JSON.stringify(item.itemId)} quantity`);
        totalRequestedQuantity = safeAdd(
            totalRequestedQuantity,
            item.requestedQuantity,
            'Shopping requested quantity'
        );
        const loadUnitsPerItem = loadByItem.get(item.itemId);
        if (loadUnitsPerItem === undefined) {
            throw new Error(`Missing shopping load units for ${JSON.stringify(item.itemId)}`);
        }
        let itemEvidenceComplete = item.sellerEvidenceProof === 'exact';
        if (!itemEvidenceComplete) {
            addGap(evidenceGaps, 'purchase-seller-evidence-incomplete', item.itemId);
        }
        const sellers: ShoppingRouteSellerCandidate[] = [];
        const shopCodes = new Set<string>();
        for (const seller of item.sellerOptions) {
            const option = seller.option;
            if (shopCodes.has(option.shopCode)) {
                throw new Error(
                    `Shopping item ${JSON.stringify(item.itemId)} has duplicate seller ${JSON.stringify(option.shopCode)}`
                );
            }
            shopCodes.add(option.shopCode);
            if (option.purchase.itemId !== item.itemId) {
                throw new Error(`Shopping seller item does not match ${JSON.stringify(item.itemId)}`);
            }
            if (option.purchase.stock.kind === 'unknown') {
                itemEvidenceComplete = false;
                addGap(evidenceGaps, 'seller-stock-unknown', item.itemId, option.shopCode);
                continue;
            }
            const capacity = option.purchase.stock.kind === 'unlimited'
                ? item.requestedQuantity
                : Math.min(item.requestedQuantity, option.purchase.stock.defaultStock);
            requireNonNegativeSafeInteger(
                capacity,
                `Shopping seller ${JSON.stringify(option.shopCode)} capacity`
            );
            if (capacity === 0) continue;
            requireNonNegativeFinite(
                option.purchase.unitPrice,
                `Shopping seller ${JSON.stringify(option.shopCode)} unit price`
            );

            if (option.access.kind === 'remote') {
                if (!option.purchase.canBeDelivered) continue;
                if (seller.eligibility.kind === 'unknown') {
                    itemEvidenceComplete = false;
                    addGap(evidenceGaps, 'seller-eligibility-unknown', item.itemId, option.shopCode);
                    continue;
                }
                if (seller.eligibility.kind === 'unavailable') continue;
                const duration = remoteDurations.get(option.shopCode);
                if (duration === undefined) {
                    if (input.remoteDelivery.coverage === 'partial') {
                        itemEvidenceComplete = false;
                        addGap(
                            evidenceGaps,
                            'remote-delivery-duration-missing',
                            item.itemId,
                            option.shopCode
                        );
                    }
                    continue;
                }
                sellers.push({
                    shopCode: option.shopCode,
                    itemId: item.itemId,
                    access: 'remote-delivery',
                    capacity,
                    unitPrice: option.purchase.unitPrice,
                    schedule: null,
                    remoteDurationMinutes: duration,
                });
                continue;
            }

            const mayUseExplicitTravel = seller.eligibility.kind === 'supported' ||
                seller.eligibility.kind === 'unavailable' &&
                seller.eligibility.reason === 'no-reachable-access' &&
                option.access.kind === 'unreachable' &&
                option.access.candidates.length > 0;
            if (!mayUseExplicitTravel) {
                if (seller.eligibility.kind === 'unknown') {
                    itemEvidenceComplete = false;
                    addGap(evidenceGaps, 'seller-eligibility-unknown', item.itemId, option.shopCode);
                }
                continue;
            }
            const schedule = availabilitySchedule(option.availability);
            if (schedule === null) {
                itemEvidenceComplete = false;
                addGap(evidenceGaps, 'physical-shop-schedule-missing', item.itemId, option.shopCode);
                continue;
            }
            sellers.push({
                shopCode: option.shopCode,
                itemId: item.itemId,
                access: 'physical',
                capacity,
                unitPrice: option.purchase.unitPrice,
                schedule,
                remoteDurationMinutes: null,
            });
        }
        sellers.sort(compareSellers);
        return {
            demand: {
                itemId: item.itemId,
                quantity: item.requestedQuantity,
                loadUnitsPerItem,
                sellers,
            } satisfies ShoppingRouteItemDemand,
            evidenceComplete: itemEvidenceComplete,
        };
    });
    if (totalRequestedQuantity !== input.purchasePlan.totalRequestedQuantity) {
        throw new Error('Shopping purchase-plan total requested quantity is inconsistent');
    }
    const normalizedRemoteShopCodes = new Set(
        input.purchasePlan.items.flatMap((item) => item.sellerOptions)
            .filter((seller) => seller.option.access.kind === 'remote')
            .map((seller) => seller.option.shopCode)
    );
    for (const shopCode of remoteDurations.keys()) {
        if (!normalizedRemoteShopCodes.has(shopCode)) {
            throw new Error(`Remote delivery references unknown supplier ${JSON.stringify(shopCode)}`);
        }
    }
    validateConsistentShopSchedules(extracted.map((entry) => entry.demand));
    const physicalShopCodes = new Set(
        extracted.flatMap(({ demand }) => demand.sellers)
            .filter((seller) => seller.access === 'physical')
            .map((seller) => seller.shopCode)
    );
    const legs = indexTravelLegs(input, physicalShopCodes);
    const evidenceComplete =
        input.purchasePlan.sellerEvidenceProof === 'exact' &&
        input.purchasePlan.timingProof === 'not-evaluated' &&
        input.travel.coverage === 'complete' &&
        input.remoteDelivery.coverage === 'complete' &&
        extracted.every((entry) => entry.evidenceComplete);

    return {
        input,
        demands: extracted.map((entry) => entry.demand)
            .sort((left, right) => left.itemId.localeCompare(right.itemId)),
        legs,
        evidenceComplete,
        evidenceGaps,
    };
}

function addGap(
    gaps: FinishedRecipeShoppingEvidenceGap[],
    code: FinishedRecipeShoppingEvidenceGap['code'],
    itemId: string | null = null,
    shopCode: string | null = null
): void {
    if (gaps.some((gap) => gap.code === code && gap.itemId === itemId && gap.shopCode === shopCode)) {
        return;
    }
    gaps.push({ code, itemId, shopCode });
}

function validateTopLevel(input: FinishedRecipeShoppingRouteInput): void {
    if (![
        'minimum-purchase-cost',
        'minimum-elapsed-minutes',
        'minimum-travel-distance',
    ].includes(input.objective)) {
        throw new Error('Unknown finished recipe shopping objective');
    }
    requireNonBlank(input.movement.modelId, 'Shopping movement model ID');
    requirePositiveSafeInteger(input.movement.carryingCapacity, 'Shopping carrying capacity');
    requireNonNegativeSafeInteger(input.movement.startMinute, 'Shopping start minute');
    requireNonNegativeFinite(
        input.movement.serviceMinutesPerVisit,
        'Shopping service minutes per visit'
    );
    requirePositiveSafeInteger(input.maximumStates, 'Shopping maximum states');
    requireNonBlank(input.travel.depotLocationId, 'Shopping depot location ID');
    if (input.travel.coverage !== 'complete' && input.travel.coverage !== 'partial') {
        throw new Error('Shopping travel evidence coverage must be complete or partial');
    }
    if (
        input.remoteDelivery.coverage !== 'complete' &&
        input.remoteDelivery.coverage !== 'partial'
    ) {
        throw new Error('Remote delivery evidence coverage must be complete or partial');
    }
}

function indexItemLoads(input: FinishedRecipeShoppingRouteInput): ReadonlyMap<string, number> {
    const result = new Map<string, number>();
    for (const entry of input.movement.itemLoadUnits) {
        requireNonBlank(entry.itemId, 'Shopping load item ID');
        requirePositiveSafeInteger(
            entry.loadUnitsPerItem,
            `Shopping item ${JSON.stringify(entry.itemId)} load units`
        );
        if (result.has(entry.itemId)) {
            throw new Error(`Duplicate shopping load item ${JSON.stringify(entry.itemId)}`);
        }
        result.set(entry.itemId, entry.loadUnitsPerItem);
    }
    const demanded = new Set(input.purchasePlan.items.map((item) => item.itemId));
    for (const itemId of result.keys()) {
        if (!demanded.has(itemId)) {
            throw new Error(`Shopping load references undemanded item ${JSON.stringify(itemId)}`);
        }
    }
    return result;
}

function indexRemoteDeliveries(input: FinishedRecipeShoppingRouteInput): ReadonlyMap<string, number> {
    const result = new Map<string, number>();
    for (const delivery of input.remoteDelivery.deliveries) {
        requireNonBlank(delivery.shopCode, 'Remote delivery shop code');
        requireNonNegativeFinite(
            delivery.durationMinutes,
            `Remote delivery ${JSON.stringify(delivery.shopCode)} duration`
        );
        if (result.has(delivery.shopCode)) {
            throw new Error(`Duplicate remote delivery ${JSON.stringify(delivery.shopCode)}`);
        }
        result.set(delivery.shopCode, delivery.durationMinutes);
    }
    return result;
}

function indexTravelLegs(
    input: FinishedRecipeShoppingRouteInput,
    physicalShopCodes: ReadonlySet<string>
): ReadonlyMap<string, FinishedRecipeShoppingTravelLeg> {
    const locations = new Set([input.travel.depotLocationId, ...physicalShopCodes]);
    const ids = new Set<string>();
    const result = new Map<string, FinishedRecipeShoppingTravelLeg>();
    for (const leg of input.travel.legs) {
        requireNonBlank(leg.legId, 'Shopping travel leg ID');
        requireNonBlank(leg.fromLocationId, 'Shopping travel leg origin');
        requireNonBlank(leg.toLocationId, 'Shopping travel leg destination');
        if (ids.has(leg.legId)) {
            throw new Error(`Duplicate shopping travel leg ${JSON.stringify(leg.legId)}`);
        }
        ids.add(leg.legId);
        if (!locations.has(leg.fromLocationId) || !locations.has(leg.toLocationId)) {
            throw new Error(`Shopping travel leg ${JSON.stringify(leg.legId)} has unknown location`);
        }
        if (leg.fromLocationId === leg.toLocationId) {
            throw new Error(`Shopping travel leg ${JSON.stringify(leg.legId)} is a self leg`);
        }
        requireNonNegativeFinite(leg.distance, `Shopping travel leg ${JSON.stringify(leg.legId)} distance`);
        requireNonNegativeFinite(
            leg.durationMinutes,
            `Shopping travel leg ${JSON.stringify(leg.legId)} duration`
        );
        const key = legKey(leg.fromLocationId, leg.toLocationId);
        if (result.has(key)) {
            throw new Error(`Duplicate directed shopping travel pair ${JSON.stringify(key)}`);
        }
        result.set(key, { ...leg });
    }
    return result;
}

function availabilitySchedule(
    availability: import('#core/world/shop-routing').ShopAvailability
): ShopSchedule | null {
    if (availability.kind === 'unknown') return null;
    requireGameTime(availability.schedule.openTime, 'Shopping seller opening time');
    requireGameTime(availability.schedule.closeTime, 'Shopping seller closing time');
    return availability.schedule;
}

function validateConsistentShopSchedules(demands: readonly ShoppingRouteItemDemand[]): void {
    const schedules = new Map<string, string>();
    for (const seller of demands.flatMap((demand) => demand.sellers)) {
        if (seller.access !== 'physical') continue;
        const key = `${seller.schedule!.openTime}-${seller.schedule!.closeTime}`;
        const previous = schedules.get(seller.shopCode);
        if (previous !== undefined && previous !== key) {
            throw new Error(`Shopping seller ${JSON.stringify(seller.shopCode)} has inconsistent schedules`);
        }
        schedules.set(seller.shopCode, key);
    }
}

function compareSellers(
    left: ShoppingRouteSellerCandidate,
    right: ShoppingRouteSellerCandidate
): number {
    return left.unitPrice - right.unitPrice ||
        left.shopCode.localeCompare(right.shopCode) ||
        left.access.localeCompare(right.access);
}

export function legKey(from: string, to: string): string {
    return `${from}\u0000${to}`;
}

function requireNonBlank(value: string, label: string): void {
    if (value.trim().length === 0) throw new Error(`${label} must not be blank`);
}

function requirePositiveSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new RangeError(`${label} must be a positive safe integer`);
    }
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${label} must be a non-negative safe integer`);
    }
}

function requireNonNegativeFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${label} must be non-negative and finite`);
    }
}

function requireGameTime(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 2359 || value % 100 >= 60) {
        throw new RangeError(`${label} must be a valid HHMM game time`);
    }
}

function safeAdd(left: number, right: number, label: string): number {
    const result = left + right;
    if (!Number.isSafeInteger(result)) throw new RangeError(`${label} must be a safe integer`);
    return result;
}
