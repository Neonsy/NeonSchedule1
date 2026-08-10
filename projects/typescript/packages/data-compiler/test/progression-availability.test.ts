import { describe, expect, it } from 'vitest';

import {
    ProgressionAvailabilityResolver,
    withProgressionAvailability,
    type Buildable,
    type Item,
    type Property,
    type RankCatalog,
    type Shop,
} from '@neonschedule1/core';

describe('progression availability', () => {
    it('separates rank, product unlock, shop access, and property ownership facts', () => {
        const resolver = fixtureResolver();

        const streetRat = resolver.resolve({
            currentRank: { rank: 'Street_Rat', tier: 2 },
            unlockedProductIds: ['weed'],
            accessibleShopCodes: ['corner'],
            ownedPropertyCodes: ['barn'],
        });

        expect(streetRat.products.eligibleIds).toEqual(['weed']);
        expect(streetRat.mixingIngredients.eligibleIds).toEqual(['cuke']);
        expect(streetRat.equipment.eligibleIds).toEqual(['mixer']);
        expect(streetRat.equipment.ineligible).toEqual([
            { id: 'orphan', reasons: [{ code: 'no-normalized-shop-listing' }] },
        ]);
        expect(streetRat.properties.eligibleIds).toEqual(['barn', 'rv']);
        expect(streetRat.shops.eligibleIds).toEqual(['corner']);
        expect(streetRat.mixingIngredients.ineligible).toEqual([
            {
                id: 'addy',
                reasons: [
                    {
                        code: 'rank-below-requirement',
                        current: { rank: 'Street_Rat', tier: 2 },
                        required: { rank: 'Hoodlum', tier: 1 },
                    },
                    { code: 'no-accessible-shop', shopCodes: ['pharmacy'] },
                ],
            },
        ]);

        const exactBoundary = resolver.resolve({
            currentRank: { rank: 'Hoodlum', tier: 1 },
            unlockedProductIds: ['weed'],
            accessibleShopCodes: ['corner', 'pharmacy'],
            ownedPropertyCodes: [],
        });
        expect(exactBoundary.mixingIngredients.eligibleIds).toEqual(['addy', 'cuke']);
        expect(exactBoundary.properties.eligibleIds).toEqual(['rv']);
    });

    it('reports omitted facts as unknown and explicit empty facts as known unavailable', () => {
        const resolver = fixtureResolver();

        const unknown = resolver.resolve({});
        expect(unknown.products.ineligible[0]?.reasons).toEqual([
            { code: 'missing-product-unlock-fact' },
        ]);
        expect(unknown.mixingIngredients.ineligible).toEqual([
            {
                id: 'addy',
                reasons: [
                    {
                        code: 'missing-current-rank',
                        required: { rank: 'Hoodlum', tier: 1 },
                    },
                    { code: 'missing-shop-access-fact', shopCodes: ['pharmacy'] },
                ],
            },
            {
                id: 'cuke',
                reasons: [{ code: 'missing-shop-access-fact', shopCodes: ['corner'] }],
            },
        ]);
        expect(unknown.properties.eligibleIds).toEqual(['rv']);
        expect(unknown.properties.ineligible[0]?.reasons).toEqual([
            { code: 'missing-property-ownership-fact' },
        ]);

        const none = resolver.resolve({
            currentRank: { rank: 'Street_Rat', tier: 1 },
            unlockedProductIds: [],
            accessibleShopCodes: [],
            ownedPropertyCodes: [],
        });
        expect(none.products.ineligible[0]?.reasons).toEqual([
            { code: 'product-not-unlocked' },
        ]);
        expect(none.shops.ineligible[0]?.reasons).toEqual([{ code: 'shop-not-accessible' }]);
        expect(none.properties.ineligible[0]?.reasons).toEqual([{ code: 'property-not-owned' }]);
    });

    it('uses eligible products and ingredients only when request fields are omitted', () => {
        const availability = fixtureResolver().resolve({
            currentRank: { rank: 'Hoodlum', tier: 1 },
            unlockedProductIds: ['weed'],
            accessibleShopCodes: ['corner', 'pharmacy'],
            ownedPropertyCodes: [],
        });

        expect(withProgressionAvailability({ maxIngredients: 3 }, availability)).toMatchObject({
            productIds: ['weed'],
            availableIngredientIds: ['addy', 'cuke'],
            maxIngredients: 3,
        });
        expect(withProgressionAvailability({
            productIds: ['explicit-product'],
            availableIngredientIds: ['explicit-ingredient'],
        }, availability)).toEqual({
            productIds: ['explicit-product'],
            availableIngredientIds: ['explicit-ingredient'],
        });
    });

    it('rejects progression facts that are not in the normalized catalogs', () => {
        const resolver = fixtureResolver();
        expect(() => resolver.resolve({ currentRank: { rank: 'Unknown', tier: 1 } }))
            .toThrow('Current rank is not in the normalized rank catalog');
        expect(() => resolver.resolve({ accessibleShopCodes: ['missing'] }))
            .toThrow('Unknown accessible shop "missing"');
    });
});

function fixtureResolver(): ProgressionAvailabilityResolver {
    const ranks: RankCatalog = {
        schema: 'neonschedule1-rank-catalog-1',
        levels: [
            { rank: 'Street_Rat', tier: 1, totalXpRequired: 0, orderLimitMultiplier: 1 },
            { rank: 'Street_Rat', tier: 2, totalXpRequired: 200, orderLimitMultiplier: 1.06 },
            { rank: 'Hoodlum', tier: 1, totalXpRequired: 1_000, orderLimitMultiplier: 1.25 },
        ],
    };
    const weed = item('weed', null, null, 'product');
    const addy = item('addy', 'Hoodlum', 1, 'ingredient');
    const cuke = item('cuke', null, null, 'ingredient');
    const mixer = item('mixer', 'Street_Rat', 2, 'equipment');
    const orphan = item('orphan', null, null, 'equipment');
    return new ProgressionAvailabilityResolver({
        ranks,
        items: [mixer, weed, cuke, addy, orphan],
        buildables: [
            { itemId: 'mixer' } as Buildable,
            { itemId: 'orphan' } as Buildable,
        ],
        properties: [property('rv', true), property('barn', false)],
        shops: [
            shop('pharmacy', ['addy']),
            shop('corner', ['cuke', 'mixer']),
        ],
    });
}

function item(
    id: string,
    requiredRank: string | null,
    requiredRankTier: number | null,
    kind: 'product' | 'ingredient' | 'equipment'
): Item {
    return {
        id,
        requiredRank,
        requiredRankTier,
        isRuntimeOnly: false,
        basePurchasePrice: kind === 'product' ? null : 1,
        product: kind === 'product' ? { drugType: 'Weed' } : null,
        mixingIngredient: kind === 'ingredient' ? { effectIds: [] } : null,
    } as Item;
}

function property(code: string, ownedByDefault: boolean): Property {
    return { code, ownedByDefault } as Property;
}

function shop(code: string, itemIds: readonly string[]): Shop {
    return {
        code,
        listings: itemIds.map((itemId) => ({ itemId })),
    } as Shop;
}
