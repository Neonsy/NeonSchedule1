import type { Buildable } from '#core/data/buildable';
import type { Item } from '#core/data/item';
import type { RankCatalog, RankReference } from '#core/data/progression';
import type { Property } from '#core/data/property';
import type { Shop } from '#core/data/shop';

export interface PlayerProgressionFacts {
    readonly currentRank?: RankReference;
    readonly unlockedProductIds?: readonly string[];
    readonly accessibleShopCodes?: readonly string[];
    readonly ownedPropertyCodes?: readonly string[];
}

export type AvailabilityReason =
    | { readonly code: 'missing-current-rank'; readonly required: RankReference }
    | {
        readonly code: 'rank-below-requirement';
        readonly current: RankReference;
        readonly required: RankReference;
    }
    | { readonly code: 'missing-product-unlock-fact' }
    | { readonly code: 'product-not-unlocked' }
    | { readonly code: 'missing-shop-access-fact'; readonly shopCodes: readonly string[] }
    | { readonly code: 'no-accessible-shop'; readonly shopCodes: readonly string[] }
    | { readonly code: 'no-normalized-shop-listing' }
    | { readonly code: 'shop-not-accessible' }
    | { readonly code: 'missing-property-ownership-fact' }
    | { readonly code: 'property-not-owned' };

export interface AvailabilityRejection {
    readonly id: string;
    readonly reasons: readonly AvailabilityReason[];
}

export interface AvailabilitySet {
    readonly eligibleIds: readonly string[];
    readonly ineligible: readonly AvailabilityRejection[];
}

export interface ProgressionAvailability {
    readonly products: AvailabilitySet;
    readonly mixingIngredients: AvailabilitySet;
    readonly equipment: AvailabilitySet;
    readonly properties: AvailabilitySet;
    readonly shops: AvailabilitySet;
}

export interface ProgressionAvailabilityData {
    readonly ranks: RankCatalog;
    readonly items: readonly Item[];
    readonly buildables: readonly Buildable[];
    readonly properties: readonly Property[];
    readonly shops: readonly Shop[];
}

export class ProgressionAvailabilityResolver {
    readonly #rankIndex: ReadonlyMap<string, number>;
    readonly #products: readonly Item[];
    readonly #ingredients: readonly Item[];
    readonly #equipment: readonly Item[];
    readonly #properties: readonly Property[];
    readonly #shops: readonly Shop[];
    readonly #shopCodesByItemId: ReadonlyMap<string, readonly string[]>;

    constructor(data: ProgressionAvailabilityData) {
        this.#rankIndex = rankIndex(data.ranks);
        const itemsById = uniqueIndex(data.items, (item) => item.id, 'item');
        this.#products = data.items
            .filter((item) => item.product !== null && !item.isRuntimeOnly)
            .sort(byItemId);
        this.#ingredients = data.items
            .filter(
                (item) => item.mixingIngredient !== null &&
                    item.basePurchasePrice !== null && !item.isRuntimeOnly
            )
            .sort(byItemId);
        this.#equipment = data.buildables
            .map((buildable) => {
                const item = itemsById.get(buildable.itemId);
                if (item === undefined) {
                    throw new Error(`Buildable ${JSON.stringify(buildable.itemId)} has no item`);
                }
                return item;
            })
            .filter((item) => !item.isRuntimeOnly)
            .sort(byItemId);
        this.#properties = [...data.properties].sort((left, right) => left.code.localeCompare(right.code));
        this.#shops = [...data.shops].sort((left, right) => left.code.localeCompare(right.code));
        uniqueIndex(this.#products, (item) => item.id, 'product');
        uniqueIndex(this.#ingredients, (item) => item.id, 'mixing ingredient');
        uniqueIndex(this.#equipment, (item) => item.id, 'equipment item');
        uniqueIndex(this.#properties, (property) => property.code, 'property');
        uniqueIndex(this.#shops, (shop) => shop.code, 'shop');
        this.#shopCodesByItemId = shopCodesByItemId(this.#shops);
        for (const item of data.items) this.#requireKnownRank(item);
    }

    resolve(facts: PlayerProgressionFacts): ProgressionAvailability {
        const currentRank = facts.currentRank;
        if (currentRank !== undefined) this.#requireRank(currentRank, 'Current rank');
        const unlockedProducts = optionalKnownSet(
            facts.unlockedProductIds,
            this.#products.map((item) => item.id),
            'unlocked product'
        );
        const accessibleShops = optionalKnownSet(
            facts.accessibleShopCodes,
            this.#shops.map((shop) => shop.code),
            'accessible shop'
        );
        const ownedProperties = optionalKnownSet(
            facts.ownedPropertyCodes,
            this.#properties.map((property) => property.code),
            'owned property'
        );

        return {
            products: decide(this.#products, (item) => item.id, (item) => [
                ...this.#rankReasons(item, currentRank),
                ...(unlockedProducts === undefined
                    ? [{ code: 'missing-product-unlock-fact' } as const]
                    : unlockedProducts.has(item.id)
                        ? []
                        : [{ code: 'product-not-unlocked' } as const]),
            ]),
            mixingIngredients: decide(this.#ingredients, (item) => item.id, (item) => [
                ...this.#rankReasons(item, currentRank),
                ...shopReasons(item.id, this.#shopCodesByItemId, accessibleShops),
            ]),
            equipment: decide(this.#equipment, (item) => item.id, (item) => [
                ...this.#rankReasons(item, currentRank),
                ...shopReasons(item.id, this.#shopCodesByItemId, accessibleShops),
            ]),
            properties: decide(this.#properties, (property) => property.code, (property) =>
                property.ownedByDefault || ownedProperties?.has(property.code)
                    ? []
                    : ownedProperties === undefined
                        ? [{ code: 'missing-property-ownership-fact' }]
                        : [{ code: 'property-not-owned' }]
            ),
            shops: decide(this.#shops, (shop) => shop.code, (shop) =>
                accessibleShops === undefined
                    ? [{ code: 'missing-shop-access-fact', shopCodes: [shop.code] }]
                    : accessibleShops.has(shop.code)
                        ? []
                        : [{ code: 'shop-not-accessible' }]
            ),
        };
    }

    #rankReasons(item: Item, current: RankReference | undefined): AvailabilityReason[] {
        if (item.requiredRank === null || item.requiredRankTier === null) return [];
        const required = { rank: item.requiredRank, tier: item.requiredRankTier };
        if (current === undefined) return [{ code: 'missing-current-rank', required }];
        return this.#rankPosition(current) >= this.#rankPosition(required)
            ? []
            : [{ code: 'rank-below-requirement', current, required }];
    }

    #rankPosition(rank: RankReference): number {
        return this.#rankIndex.get(rankKey(rank))!;
    }

    #requireKnownRank(item: Item): void {
        if ((item.requiredRank === null) !== (item.requiredRankTier === null)) {
            throw new Error(`Item ${JSON.stringify(item.id)} has an incomplete rank requirement`);
        }
        if (item.requiredRank !== null && item.requiredRankTier !== null) {
            this.#requireRank(
                { rank: item.requiredRank, tier: item.requiredRankTier },
                `Item ${JSON.stringify(item.id)} required rank`
            );
        }
    }

    #requireRank(rank: RankReference, label: string): void {
        if (!this.#rankIndex.has(rankKey(rank))) {
            throw new Error(`${label} is not in the normalized rank catalog: ${formatRank(rank)}`);
        }
    }
}

export interface AvailabilityBackedRecipeSelection {
    readonly productIds?: readonly string[];
    readonly availableIngredientIds?: readonly string[];
}

export function withProgressionAvailability<T extends object>(
    input: T & AvailabilityBackedRecipeSelection,
    availability: ProgressionAvailability
): T & { readonly productIds: readonly string[]; readonly availableIngredientIds: readonly string[] } {
    return {
        ...input,
        productIds: input.productIds ?? availability.products.eligibleIds,
        availableIngredientIds:
            input.availableIngredientIds ?? availability.mixingIngredients.eligibleIds,
    };
}

function rankIndex(catalog: RankCatalog): ReadonlyMap<string, number> {
    const index = new Map<string, number>();
    let previousXp = -1;
    for (const [position, level] of catalog.levels.entries()) {
        const key = rankKey(level);
        if (index.has(key)) throw new Error(`Duplicate normalized rank ${formatRank(level)}`);
        if (!Number.isSafeInteger(level.tier) || level.tier < 1) {
            throw new Error(`Normalized rank ${formatRank(level)} has an invalid tier`);
        }
        if (!Number.isSafeInteger(level.totalXpRequired) || level.totalXpRequired < 0) {
            throw new Error(`Normalized rank ${formatRank(level)} has invalid required XP`);
        }
        if (level.totalXpRequired <= previousXp) {
            throw new Error('Normalized rank catalog must be strictly ordered by required XP');
        }
        previousXp = level.totalXpRequired;
        index.set(key, position);
    }
    if (index.size === 0) throw new Error('Normalized rank catalog cannot be empty');
    return index;
}

function shopCodesByItemId(shops: readonly Shop[]): ReadonlyMap<string, readonly string[]> {
    const result = new Map<string, string[]>();
    for (const shop of shops) {
        for (const listing of shop.listings) {
            const codes = result.get(listing.itemId) ?? [];
            codes.push(shop.code);
            result.set(listing.itemId, codes);
        }
    }
    return new Map(
        [...result].map(([itemId, codes]) => [itemId, [...new Set(codes)].sort()] as const)
    );
}

function shopReasons(
    itemId: string,
    shopsByItemId: ReadonlyMap<string, readonly string[]>,
    accessibleShops: ReadonlySet<string> | undefined
): AvailabilityReason[] {
    const shopCodes = shopsByItemId.get(itemId) ?? [];
    if (shopCodes.length === 0) return [{ code: 'no-normalized-shop-listing' }];
    if (accessibleShops === undefined) {
        return [{ code: 'missing-shop-access-fact', shopCodes }];
    }
    return shopCodes.some((code) => accessibleShops.has(code))
        ? []
        : [{ code: 'no-accessible-shop', shopCodes }];
}

function decide<T>(
    values: readonly T[],
    id: (value: T) => string,
    reasons: (value: T) => readonly AvailabilityReason[]
): AvailabilitySet {
    const eligibleIds: string[] = [];
    const ineligible: AvailabilityRejection[] = [];
    for (const value of values) {
        const valueReasons = reasons(value);
        if (valueReasons.length === 0) eligibleIds.push(id(value));
        else ineligible.push({ id: id(value), reasons: valueReasons });
    }
    return { eligibleIds, ineligible };
}

function optionalKnownSet(
    values: readonly string[] | undefined,
    knownValues: readonly string[],
    label: string
): ReadonlySet<string> | undefined {
    if (values === undefined) return undefined;
    const known = new Set(knownValues);
    const result = new Set<string>();
    for (const value of values) {
        if (!known.has(value)) throw new Error(`Unknown ${label} ${JSON.stringify(value)}`);
        if (result.has(value)) throw new Error(`Duplicate ${label} ${JSON.stringify(value)}`);
        result.add(value);
    }
    return result;
}

function uniqueIndex<T>(
    values: readonly T[],
    key: (value: T) => string,
    label: string
): ReadonlyMap<string, T> {
    const result = new Map<string, T>();
    for (const value of values) {
        const id = key(value);
        if (result.has(id)) throw new Error(`Duplicate ${label} ${JSON.stringify(id)}`);
        result.set(id, value);
    }
    return result;
}

function rankKey(rank: RankReference): string {
    return `${rank.rank}\u0000${rank.tier}`;
}

function formatRank(rank: RankReference): string {
    return `${JSON.stringify(rank.rank)} tier ${rank.tier}`;
}

function byItemId(left: Item, right: Item): number {
    return left.id.localeCompare(right.id);
}
