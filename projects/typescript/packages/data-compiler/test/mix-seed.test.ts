import {
    decodeMixSeed,
    encodeMixSeed,
    validateMixSeedForDataset,
    type Item,
    type MixSeedDataset,
    type MixSeedDocument,
} from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

const seed: MixSeedDocument = {
    schema: 'neonschedule1-mix-seed-2',
    gameVersion: '0.4.6f11',
    datasetSha256: 'a'.repeat(64),
    ruleProfile: { kind: 'seeded-rotation', angleDegrees: 17 },
    productId: 'ogkush',
    ingredientIds: ['banana', 'cuke', 'banana'],
};

const dataset: MixSeedDataset = {
    manifest: {
        gameVersion: seed.gameVersion,
        datasetSha256: seed.datasetSha256,
    },
    items: [
        item('ogkush', { basePurchasePrice: null, product: product('Weed') }),
        item('banana', { mixingIngredient: { effectIds: ['gingeritis'] } }),
        item('cuke', { mixingIngredient: { effectIds: ['energizing'] } }),
        item('plain'),
        item('runtime', {
            isRuntimeOnly: true,
            mixingIngredient: { effectIds: ['runtime-effect'] },
        }),
        item('unpriced', {
            basePurchasePrice: null,
            mixingIngredient: { effectIds: ['unpriced-effect'] },
        }),
        item('unmapped-product', { product: product('Unknown') }),
        item('runtime-product', { isRuntimeOnly: true, product: product('Weed') }),
    ],
    mixingRules: {
        schema: 'neonschedule1-mixing-rules-1',
        maxProperties: 8,
        maxDeltaDifference: 0,
        defaultProductIds: [],
        maps: [{ drugType: 'Weed', drugTypeValue: 0, radius: 1, effects: [] }],
    },
};

describe('mix seed codec', () => {
    it('round-trips a deterministic self-contained recipe', () => {
        const first = encodeMixSeed(seed);
        const second = encodeMixSeed({
            ingredientIds: [...seed.ingredientIds],
            productId: seed.productId,
            datasetSha256: seed.datasetSha256,
            gameVersion: seed.gameVersion,
            ruleProfile: seed.ruleProfile,
            schema: seed.schema,
        });

        expect(first).toBe(second);
        expect(first).toMatch(/^n1m2\./u);
        expect(decodeMixSeed(first)).toEqual(seed);
    });

    it('decodes legacy links as the standard rule profile', () => {
        const legacy = `n1m1.${encodeURIComponent(JSON.stringify([
            seed.gameVersion,
            seed.datasetSha256,
            seed.productId,
            seed.ingredientIds,
        ]))}`;

        expect(decodeMixSeed(legacy)).toEqual({
            ...seed,
            ruleProfile: { kind: 'standard' },
        });
    });

    it.each([
        ['unsupported version', 'n1m3.payload', 'unsupported version'],
        ['malformed URI encoding', 'n1m2.%', 'payload is malformed'],
        ['malformed JSON', 'n1m2.not-json', 'payload is malformed'],
        [
            'wrong tuple shape',
            `n1m2.${encodeURIComponent(JSON.stringify(['game', 'hash']))}`,
            'invalid structure',
        ],
        [
            'invalid dataset identity',
            `n1m2.${encodeURIComponent(JSON.stringify(['game', 'hash', null, 'product', []]))}`,
            'lowercase SHA-256',
        ],
        [
            'blank ingredient ID',
            `n1m2.${encodeURIComponent(JSON.stringify([
                'game',
                'a'.repeat(64),
                null,
                'product',
                [' '],
            ]))}`,
            'ingredient ID at index 0 must not be blank',
        ],
    ])('rejects %s', (_name, token, message) => {
        expect(() => decodeMixSeed(token)).toThrow(message);
    });

    it('rejects tokens that exceed the share-link boundary', () => {
        expect(() => decodeMixSeed(`n1m2.${'a'.repeat(4_092)}`)).toThrow(
            'exceeds 4096 characters'
        );
        expect(() => encodeMixSeed({
            ...seed,
            ingredientIds: ['a'.repeat(4_096)],
        })).toThrow('exceeds 4096 characters');
    });

    it('accepts an exact loaded dataset and preserves repeated ingredient order', () => {
        expect(validateMixSeedForDataset(decodeMixSeed(encodeMixSeed(seed)), dataset))
            .toEqual(seed);
    });

    it.each([
        [
            'different game version',
            { ...seed, gameVersion: 'other-game' },
            'game version',
        ],
        [
            'different dataset identity',
            { ...seed, datasetSha256: 'b'.repeat(64) },
            'dataset identity',
        ],
        ['unknown product', { ...seed, productId: 'missing' }, 'product "missing" is unavailable'],
        ['non-product item', { ...seed, productId: 'plain' }, 'product "plain" is unavailable'],
        [
            'runtime product',
            { ...seed, productId: 'runtime-product' },
            'product "runtime-product" is unavailable',
        ],
        [
            'product without a mixing map',
            { ...seed, productId: 'unmapped-product' },
            'has no mixing map',
        ],
        [
            'unknown ingredient',
            { ...seed, ingredientIds: ['missing'] },
            'ingredient "missing" at index 0 is unavailable',
        ],
        [
            'non-ingredient item',
            { ...seed, ingredientIds: ['plain'] },
            'ingredient "plain" at index 0 is unavailable',
        ],
        [
            'runtime ingredient',
            { ...seed, ingredientIds: ['runtime'] },
            'ingredient "runtime" at index 0 is unavailable',
        ],
        [
            'unpriced ingredient',
            { ...seed, ingredientIds: ['unpriced'] },
            'ingredient "unpriced" at index 0 is unavailable',
        ],
    ] satisfies readonly (readonly [string, MixSeedDocument, string])[])(
        'rejects a %s',
        (_name, candidate, message) => {
            expect(() => validateMixSeedForDataset(candidate, dataset)).toThrow(message);
        }
    );
});

function item(id: string, overrides: Partial<Item> = {}): Item {
    return {
        schema: 'neonschedule1-item-3',
        id,
        name: id,
        category: 'Test',
        isRuntimeOnly: false,
        stackLimit: 20,
        isStorable: true,
        basePurchasePrice: 1,
        resellMultiplier: 1,
        requiredRank: null,
        requiredRankTier: null,
        product: null,
        packaging: null,
        additive: null,
        soil: null,
        mixingIngredient: null,
        presentation: {
            description: '',
            iconFileId: null,
            visualKind: 'none',
            fallbackMeshIds: [],
            fallbackMaterialIds: [],
        },
        ...overrides,
    };
}

function product(drugType: string): NonNullable<Item['product']> {
    return {
        drugType,
        basePrice: 10,
        marketValue: 10,
        baseAddictiveness: 0,
        effectIds: [],
        validPackagingIds: [],
    };
}
