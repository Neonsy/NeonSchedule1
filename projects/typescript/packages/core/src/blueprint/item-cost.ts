import type { Shop } from '#core/data/shop';
import { ShopSchema } from '#core/data/shop';
import type { BlueprintValidationResult } from '#core/blueprint/validation';

export interface BlueprintItemPurchaseSource {
    readonly shopCode: string;
    readonly shopName: string;
    readonly paymentType: string;
    readonly unitPrice: number;
    readonly quantity: number;
    readonly totalPrice: number;
    readonly defaultStock: number | null;
    readonly canBeDelivered: boolean;
}

export interface BlueprintItemRequirement {
    readonly itemId: string;
    readonly quantity: number;
    readonly placementIds: readonly string[];
    readonly sources: readonly BlueprintItemPurchaseSource[];
    readonly minimumListedSource: BlueprintItemPurchaseSource | null;
}

export type BlueprintItemCostSummary =
    | {
        readonly kind: 'invalid-blueprint';
        readonly validation: BlueprintValidationResult;
    }
    | {
        readonly kind: 'summarized';
        readonly validation: BlueprintValidationResult;
        readonly pricingBasis: 'minimum-listed-price-per-item';
        readonly requirements: readonly BlueprintItemRequirement[];
        readonly pricedSubtotal: number;
        readonly minimumListedCost: number | null;
        readonly unlistedItemIds: readonly string[];
    };

interface IndexedListing {
    readonly shopCode: string;
    readonly shopName: string;
    readonly paymentType: string;
    readonly itemId: string;
    readonly unitPrice: number;
    readonly defaultStock: number | null;
    readonly canBeDelivered: boolean;
}

export class BlueprintItemCostSummarizer {
    readonly #listingsByItemId: ReadonlyMap<string, readonly IndexedListing[]>;

    constructor(input: readonly Shop[]) {
        this.#listingsByItemId = indexListings(input);
    }

    summarize(validation: BlueprintValidationResult): BlueprintItemCostSummary {
        if (!validation.valid) return { kind: 'invalid-blueprint', validation };

        const placementIdsByItemId = new Map<string, string[]>();
        for (const placement of validation.resolvedPlacements) {
            const placementIds = placementIdsByItemId.get(placement.itemId);
            if (placementIds === undefined) {
                placementIdsByItemId.set(placement.itemId, [placement.id]);
            } else {
                placementIds.push(placement.id);
            }
        }

        const requirements = [...placementIdsByItemId]
            .map(([itemId, placementIds]) => requirement(
                itemId,
                placementIds,
                this.#listingsByItemId.get(itemId) ?? []
            ))
            .sort((left, right) => left.itemId.localeCompare(right.itemId));
        const unlistedItemIds = requirements
            .filter((entry) => entry.minimumListedSource === null)
            .map((entry) => entry.itemId);
        const pricedSubtotal = requirements.reduce(
            (total, entry) => addFinite(total, entry.minimumListedSource?.totalPrice ?? 0),
            0
        );

        return {
            kind: 'summarized',
            validation,
            pricingBasis: 'minimum-listed-price-per-item',
            requirements,
            pricedSubtotal,
            minimumListedCost: unlistedItemIds.length === 0 ? pricedSubtotal : null,
            unlistedItemIds,
        };
    }
}

function indexListings(input: readonly Shop[]): ReadonlyMap<string, readonly IndexedListing[]> {
    const shopCodes = new Set<string>();
    const listingsByItemId = new Map<string, IndexedListing[]>();
    for (const shopInput of input) {
        const shop = ShopSchema.assert(shopInput);
        requireNonBlank(shop.code, 'Shop code');
        if (shopCodes.has(shop.code)) {
            throw new Error(`Duplicate shop code ${JSON.stringify(shop.code)}`);
        }
        shopCodes.add(shop.code);
        const itemIds = new Set<string>();
        for (const listing of shop.listings) {
            requireNonBlank(listing.itemId, `Shop ${JSON.stringify(shop.code)} listing item ID`);
            if (itemIds.has(listing.itemId)) {
                throw new Error(
                    `Shop ${JSON.stringify(shop.code)} has duplicate listing ` +
                        JSON.stringify(listing.itemId)
                );
            }
            itemIds.add(listing.itemId);
            requireNonNegativeFinite(listing.price, 'Shop listing price');
            if (listing.defaultStock !== null && !Number.isSafeInteger(listing.defaultStock)) {
                throw new RangeError('Shop listing default stock must be a safe integer');
            }
            const indexed = {
                shopCode: shop.code,
                shopName: shop.name,
                paymentType: shop.paymentType,
                itemId: listing.itemId,
                unitPrice: listing.price,
                defaultStock: listing.defaultStock,
                canBeDelivered: listing.canBeDelivered,
            };
            const sellers = listingsByItemId.get(listing.itemId);
            if (sellers === undefined) listingsByItemId.set(listing.itemId, [indexed]);
            else sellers.push(indexed);
        }
    }
    for (const listings of listingsByItemId.values()) listings.sort(compareListings);
    return listingsByItemId;
}

function requirement(
    itemId: string,
    placementIds: readonly string[],
    listings: readonly IndexedListing[]
): BlueprintItemRequirement {
    const quantity = placementIds.length;
    const sources = listings.map((listing) => {
        const totalPrice = listing.unitPrice * quantity;
        if (!Number.isFinite(totalPrice)) {
            throw new RangeError(`Blueprint item ${JSON.stringify(itemId)} total price must be finite`);
        }
        return {
            shopCode: listing.shopCode,
            shopName: listing.shopName,
            paymentType: listing.paymentType,
            unitPrice: listing.unitPrice,
            quantity,
            totalPrice,
            defaultStock: listing.defaultStock,
            canBeDelivered: listing.canBeDelivered,
        };
    });
    return {
        itemId,
        quantity,
        placementIds: [...placementIds],
        sources,
        minimumListedSource: sources[0] ?? null,
    };
}

function compareListings(left: IndexedListing, right: IndexedListing): number {
    return left.unitPrice - right.unitPrice || left.shopCode.localeCompare(right.shopCode);
}

function requireNonBlank(value: string, label: string): void {
    if (value.trim().length === 0) throw new TypeError(`${label} must not be blank`);
}

function requireNonNegativeFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be non-negative`);
}

function addFinite(left: number, right: number): number {
    const total = left + right;
    if (!Number.isFinite(total)) throw new RangeError('Blueprint priced subtotal must be finite');
    return total;
}
