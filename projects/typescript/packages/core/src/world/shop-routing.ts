import { ShopSchema, type Shop, type ShopListing } from '#core/data/shop';
import type { Vector3 } from '#core/data/common';
import {
    NavigationNetwork,
    type FoundNavigationPath,
} from '#core/world/navigation';

export interface ShopRouteInput {
    readonly itemId: string;
    readonly quantity: number;
    readonly start: Vector3;
    readonly maximumStartSnapDistance: number;
    readonly maximumAccessSnapDistance: number;
    readonly atTime?: number;
}

export interface ShopSchedule {
    readonly openTime: number;
    readonly closeTime: number;
}

export type ShopAvailability =
    | { readonly kind: 'unknown'; readonly reason: 'no-schedule-data' }
    | { readonly kind: 'not-evaluated'; readonly schedule: ShopSchedule }
    | {
        readonly kind: 'open' | 'closed';
        readonly atTime: number;
        readonly schedule: ShopSchedule;
    };

export type ShopAccessCandidate =
    | {
        readonly kind: 'shop-position';
        readonly locationSource: string;
        readonly position: Vector3;
    }
    | {
        readonly kind: 'delivery-bay';
        readonly index: number;
        readonly position: Vector3;
    };

export interface ShopAccessRoute {
    readonly candidate: ShopAccessCandidate;
    readonly path: FoundNavigationPath;
}

export type ShopAccessResult =
    | {
        readonly kind: 'route';
        readonly selected: ShopAccessRoute;
        readonly alternatives: readonly ShopAccessRoute[];
    }
    | {
        readonly kind: 'remote';
        readonly source: 'supplier-phone-interface';
    }
    | {
        readonly kind: 'unreachable';
        readonly reason:
            | 'no-physical-access-data'
            | 'start-outside-network'
            | 'no-reachable-access';
        readonly candidates: readonly ShopAccessCandidate[];
    };

export interface ShopPurchaseTerms {
    readonly itemId: string;
    readonly quantity: number;
    readonly unitPrice: number;
    readonly totalPrice: number;
    readonly stock: ShopPurchaseStock;
    readonly canBeDelivered: boolean;
}

export type ShopPurchaseStock =
    | { readonly kind: 'unlimited' }
    | {
        readonly kind: 'limited';
        readonly defaultStock: number;
        readonly sufficient: boolean;
    }
    | {
        readonly kind: 'unknown';
        readonly defaultStock: number;
    };

export interface ShopPurchaseOption {
    readonly shopCode: string;
    readonly shopName: string;
    readonly paymentType: string;
    readonly availability: ShopAvailability;
    readonly purchase: ShopPurchaseTerms;
    readonly access: ShopAccessResult;
}

export interface ShopAccessInput {
    readonly start: Vector3;
    readonly maximumStartSnapDistance: number;
    readonly maximumAccessSnapDistance: number;
}

export class ShopRoutePlanner {
    readonly #network: NavigationNetwork;
    readonly #shopsByItem: ReadonlyMap<string, readonly Shop[]>;

    constructor(network: NavigationNetwork, input: readonly Shop[]) {
        this.#network = network;
        const shops = validateShops(input);
        const shopsByItem = new Map<string, Shop[]>();
        for (const shop of shops) {
            for (const listing of shop.listings) {
                const sellers = shopsByItem.get(listing.itemId);
                if (sellers === undefined) shopsByItem.set(listing.itemId, [shop]);
                else sellers.push(shop);
            }
        }
        this.#shopsByItem = shopsByItem;
    }

    findPurchaseOptions(input: ShopRouteInput): ShopPurchaseOption[] {
        requireId(input.itemId, 'Purchase item');
        requirePositiveSafeInteger(input.quantity, 'Purchase quantity');
        if (input.atTime !== undefined) requireGameTime(input.atTime, 'Purchase time');
        const context: ShopAccessInput = {
            start: copyPosition(input.start),
            maximumStartSnapDistance: requireNonNegativeFinite(
                input.maximumStartSnapDistance,
                'Maximum start snap distance'
            ),
            maximumAccessSnapDistance: requireNonNegativeFinite(
                input.maximumAccessSnapDistance,
                'Maximum shop access snap distance'
            ),
        };
        const shops = this.#shopsByItem.get(input.itemId) ?? [];
        return shops.map((shop) => {
            const listing = shop.listings.find(({ itemId }) => itemId === input.itemId)!;
            return {
                shopCode: shop.code,
                shopName: shop.name,
                paymentType: shop.paymentType,
                availability: shopAvailability(shop, input.atTime),
                purchase: purchaseTerms(listing, input.quantity),
                access: resolveShopAccess(this.#network, shop, context),
            };
        });
    }
}

export function shopAvailability(shopInput: Shop, atTime?: number): ShopAvailability {
    const shop = ShopSchema.assert(shopInput);
    const schedule = shopSchedule(shop);
    if (schedule === null) {
        return { kind: 'unknown', reason: 'no-schedule-data' };
    }
    if (atTime === undefined) return { kind: 'not-evaluated', schedule };
    requireGameTime(atTime, 'Shop availability time');
    return {
        kind: isWithinSchedule(atTime, schedule) ? 'open' : 'closed',
        atTime,
        schedule,
    };
}

export function resolveShopAccess(
    network: NavigationNetwork,
    shopInput: Shop,
    input: ShopAccessInput
): ShopAccessResult {
    const shop = ShopSchema.assert(shopInput);
    const start = copyPosition(input.start);
    const maximumStartSnapDistance = requireNonNegativeFinite(
        input.maximumStartSnapDistance,
        'Maximum start snap distance'
    );
    const maximumAccessSnapDistance = requireNonNegativeFinite(
        input.maximumAccessSnapDistance,
        'Maximum shop access snap distance'
    );
    const candidates = accessCandidates(shop);
    if (candidates.length === 0) {
        if (shop.locationSource === 'supplier-phone-interface') {
            return { kind: 'remote', source: 'supplier-phone-interface' };
        }
        return { kind: 'unreachable', reason: 'no-physical-access-data', candidates };
    }

    const routes: ShopAccessRoute[] = [];
    for (const candidate of candidates) {
        const path = network.findPathToNearestReachable({
            start,
            end: candidate.position,
            maximumStartSnapDistance,
            maximumEndSnapDistance: maximumAccessSnapDistance,
        });
        if (path.kind === 'found') routes.push({ candidate, path });
        else if (path.reason === 'start-outside-network') {
            return { kind: 'unreachable', reason: 'start-outside-network', candidates };
        }
    }
    routes.sort(compareAccessRoutes);
    const selected = routes[0];
    if (selected === undefined) {
        return { kind: 'unreachable', reason: 'no-reachable-access', candidates };
    }
    return { kind: 'route', selected, alternatives: routes };
}

function validateShops(input: readonly Shop[]): Shop[] {
    const codes = new Set<string>();
    return input.map((shopInput) => {
        const shop = ShopSchema.assert(shopInput);
        requireId(shop.code, 'Shop');
        if (codes.has(shop.code)) throw new Error(`Duplicate shop ${JSON.stringify(shop.code)}`);
        codes.add(shop.code);
        shopSchedule(shop);
        const itemIds = new Set<string>();
        for (const listing of shop.listings) {
            requireId(listing.itemId, `Shop ${JSON.stringify(shop.code)} listing`);
            if (itemIds.has(listing.itemId)) {
                throw new Error(
                    `Shop ${JSON.stringify(shop.code)} has duplicate listing ${JSON.stringify(listing.itemId)}`
                );
            }
            itemIds.add(listing.itemId);
            requireNonNegativeFinite(listing.price, 'Shop listing price');
            if (listing.defaultStock !== null) {
                requireSafeInteger(listing.defaultStock, 'Shop listing default stock');
            }
        }
        return copyShop(shop);
    }).sort((left, right) => left.code.localeCompare(right.code));
}

function purchaseTerms(listing: ShopListing, quantity: number): ShopPurchaseTerms {
    const totalPrice = listing.price * quantity;
    if (!Number.isFinite(totalPrice)) throw new RangeError('Shop purchase total must be finite');
    return {
        itemId: listing.itemId,
        quantity,
        unitPrice: listing.price,
        totalPrice,
        stock: purchaseStock(listing.defaultStock, quantity),
        canBeDelivered: listing.canBeDelivered,
    };
}

function purchaseStock(defaultStock: number | null, quantity: number): ShopPurchaseStock {
    if (defaultStock === null) return { kind: 'unlimited' };
    if (defaultStock < 0) return { kind: 'unknown', defaultStock };
    return { kind: 'limited', defaultStock, sufficient: defaultStock >= quantity };
}

function accessCandidates(shop: Shop): ShopAccessCandidate[] {
    const candidates: ShopAccessCandidate[] = [];
    const positions = new Set<string>();
    if (shop.position !== null) {
        positions.add(positionKey(shop.position));
        candidates.push({
            kind: 'shop-position',
            locationSource: shop.locationSource,
            position: copyPosition(shop.position),
        });
    }
    shop.deliveryBayPositions.forEach((position, index) => {
        const key = positionKey(position);
        if (positions.has(key)) return;
        positions.add(key);
        candidates.push({
            kind: 'delivery-bay',
            index,
            position: copyPosition(position),
        });
    });
    return candidates;
}

function positionKey(position: Vector3): string {
    return `${position.x},${position.y},${position.z}`;
}

function compareAccessRoutes(left: ShopAccessRoute, right: ShopAccessRoute): number {
    return left.path.networkDistance - right.path.networkDistance ||
        left.path.end.snapDistance - right.path.end.snapDistance ||
        accessSourceRank(left.candidate) - accessSourceRank(right.candidate) ||
        accessIndex(left.candidate) - accessIndex(right.candidate);
}

function accessSourceRank(candidate: ShopAccessCandidate): number {
    return candidate.kind === 'shop-position' ? 0 : 1;
}

function accessIndex(candidate: ShopAccessCandidate): number {
    return candidate.kind === 'shop-position' ? -1 : candidate.index;
}

function isWithinSchedule(atTime: number, schedule: ShopSchedule): boolean {
    if (schedule.openTime === schedule.closeTime) return false;
    if (schedule.openTime < schedule.closeTime) {
        return atTime >= schedule.openTime && atTime < schedule.closeTime;
    }
    return atTime >= schedule.openTime || atTime < schedule.closeTime;
}

function shopSchedule(shop: Shop): ShopSchedule | null {
    if (shop.openTime === null && shop.closeTime === null) return null;
    if (shop.openTime === null || shop.closeTime === null) {
        throw new Error(`Shop ${JSON.stringify(shop.code)} has an incomplete opening schedule`);
    }
    return {
        openTime: requireGameTime(shop.openTime, `Shop ${JSON.stringify(shop.code)} opening time`),
        closeTime: requireGameTime(shop.closeTime, `Shop ${JSON.stringify(shop.code)} closing time`),
    };
}

function requireGameTime(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > 2359 || value % 100 >= 60) {
        throw new RangeError(`${label} must be a valid HHMM game time`);
    }
    return value;
}

function requireId(value: string, label: string): void {
    if (value.trim().length === 0) throw new Error(`${label} ID must not be blank`);
}

function requirePositiveSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new RangeError(`${label} must be a positive safe integer`);
    }
}

function requireSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value)) {
        throw new RangeError(`${label} must be a safe integer`);
    }
}

function requireNonNegativeFinite(value: number, label: string): number {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${label} must be non-negative`);
    }
    return value;
}

function copyShop(shop: Shop): Shop {
    return {
        ...shop,
        position: shop.position === null ? null : copyPosition(shop.position),
        rotation: shop.rotation === null ? null : copyPosition(shop.rotation),
        deliveryBayPositions: shop.deliveryBayPositions.map(copyPosition),
        listings: shop.listings.map((listing) => ({ ...listing })),
    };
}

function copyPosition(position: Vector3): Vector3 {
    if (![position.x, position.y, position.z].every(Number.isFinite)) {
        throw new RangeError('Shop route position must contain finite coordinates');
    }
    return { x: position.x, y: position.y, z: position.z };
}
