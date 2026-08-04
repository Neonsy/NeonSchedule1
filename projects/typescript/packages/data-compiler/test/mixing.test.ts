import { describe, expect, it } from 'vitest';

import {
    MixingEngine,
    RecipeEvaluator,
    RecipeSearch,
    RecipeSearchLimitError,
    type Effect,
    type Item,
    type MixingRules,
} from '@neonschedule1/core';

describe('mixing engine', () => {
    it('applies map replacements in game order and preserves occupied effects', () => {
        const effects = [
            effect('a', 0, 0, 0.1),
            effect('b', 0, 0),
            effect('c', 0, 0),
            effect('shift', 1, 1),
        ];
        const rules: MixingRules = {
            schema: 'neonschedule1-mixing-rules-1',
            maxProperties: 8,
            maxDeltaDifference: 0.5,
            defaultProductIds: [],
            maps: [
                {
                    drugType: 'Test',
                    drugTypeValue: 0,
                    radius: 4,
                    effects: [
                        mapEffect('a', 0),
                        mapEffect('b', 1),
                        mapEffect('c', 2),
                        mapEffect('shift', 3),
                    ],
                },
            ],
        };
        const engine = new MixingEngine(rules, new Map(effects.map((entry) => [entry.id, entry])));

        expect(engine.mixEffectIds('Test', ['a', 'b'], 'shift')).toEqual(['a', 'c', 'shift']);
        expect(engine.calculateProductValue(35, ['a'])).toBe(38);
    });

    it('evaluates an ordered recipe against normalized items', () => {
        const effects = [effect('a', 0, 0, 0.1), effect('b', 0, 0), effect('shift', 1, 1)];
        const rules: MixingRules = {
            schema: 'neonschedule1-mixing-rules-1',
            maxProperties: 8,
            maxDeltaDifference: 0.5,
            defaultProductIds: [],
            maps: [
                {
                    drugType: 'Test',
                    drugTypeValue: 0,
                    radius: 4,
                    effects: [mapEffect('a', 0), mapEffect('b', 1), mapEffect('shift', 2)],
                },
            ],
        };
        const items = [product('product', ['a'], 35, 5), ingredient('ingredient', 'shift', 2)];
        const engine = new MixingEngine(rules, new Map(effects.map((entry) => [entry.id, entry])));
        const evaluator = new RecipeEvaluator(engine, new Map(items.map((entry) => [entry.id, entry])));

        expect(evaluator.evaluate({ productId: 'product', ingredientIds: ['ingredient'] })).toEqual({
            productId: 'product',
            ingredientIds: ['ingredient'],
            effectIds: ['b', 'shift'],
            productValue: 35,
            baseProductCost: 5,
            ingredientCost: 2,
            totalCost: 7,
            netValue: 28,
            ingredientCount: 1,
        });
        expect(() => evaluator.evaluate({ productId: 'product', ingredientIds: ['missing'] })).toThrow(
            'Unknown mixing ingredient "missing"'
        );
        const unpricedProduct = { ...items[0]!, basePurchasePrice: null };
        const unpricedEvaluator = new RecipeEvaluator(engine, new Map([['product', unpricedProduct]]));
        expect(() => unpricedEvaluator.evaluate({ productId: 'product', ingredientIds: [] })).toThrow(
            'Product "product" has no base purchase price'
        );
    });

    it('finds exact recipes and keeps the cheapest path to each outcome', () => {
        const effects = [effect('a', 0, 0, 0.1), effect('b', 0, 0, 0.2), effect('shift', 1, 1, 0.1)];
        const rules: MixingRules = {
            schema: 'neonschedule1-mixing-rules-1',
            maxProperties: 8,
            maxDeltaDifference: 0.5,
            defaultProductIds: [],
            maps: [
                {
                    drugType: 'Test',
                    drugTypeValue: 0,
                    radius: 4,
                    effects: [mapEffect('a', 0), mapEffect('b', 1), mapEffect('shift', 2)],
                },
            ],
        };
        const items = [product('product', ['a'], 35), ingredient('ingredient', 'shift', 2)];
        const engine = new MixingEngine(rules, new Map(effects.map((entry) => [entry.id, entry])));
        const search = new RecipeSearch(engine, new Map(items.map((entry) => [entry.id, entry])));

        expect(
            search.search({
                productId: 'product',
                availableIngredientIds: ['ingredient'],
                maxIngredients: 2,
                limit: 5,
            })
        ).toEqual([
            {
                productId: 'product',
                ingredientIds: ['ingredient'],
                effectIds: ['b', 'shift'],
                productValue: 46,
                baseProductCost: 0,
                ingredientCost: 2,
                totalCost: 2,
                netValue: 44,
                ingredientCount: 1,
            },
            {
                productId: 'product',
                ingredientIds: [],
                effectIds: ['a'],
                productValue: 38,
                baseProductCost: 0,
                ingredientCost: 0,
                totalCost: 0,
                netValue: 38,
                ingredientCount: 0,
            },
        ]);
    });

    it('ranks recipes by product value or value after ingredient cost', () => {
        const effects = [
            effect('base', 0, 0),
            effect('valuable', 1, 1, 1),
            effect('efficient', 2, 1, 0.5),
        ];
        const rules: MixingRules = {
            schema: 'neonschedule1-mixing-rules-1',
            maxProperties: 1,
            maxDeltaDifference: 0.5,
            defaultProductIds: [],
            maps: [
                {
                    drugType: 'Test',
                    drugTypeValue: 0,
                    radius: 2,
                    effects: [mapEffect('base', 0), mapEffect('valuable', 1), mapEffect('efficient', 2)],
                },
            ],
        };
        const items = [
            product('product', ['base'], 10, 3),
            ingredient('expensive', 'valuable', 15),
            ingredient('cheap', 'efficient', 1),
        ];
        const engine = new MixingEngine(rules, new Map(effects.map((entry) => [entry.id, entry])));
        const search = new RecipeSearch(engine, new Map(items.map((entry) => [entry.id, entry])));
        const input = {
            productId: 'product',
            availableIngredientIds: ['expensive', 'cheap'],
            maxIngredients: 1,
            limit: 1,
        } as const;

        expect(search.search({ ...input, objective: 'productValue' })[0]).toMatchObject({
            ingredientIds: ['expensive'],
            productValue: 20,
            baseProductCost: 3,
            ingredientCost: 15,
            totalCost: 18,
            netValue: 2,
        });
        expect(search.search({ ...input, objective: 'netValue' })[0]).toMatchObject({
            ingredientIds: ['cheap'],
            productValue: 15,
            baseProductCost: 3,
            ingredientCost: 1,
            totalCost: 4,
            netValue: 11,
        });
    });

    it('fails explicitly before an exact search exceeds its state budget', () => {
        const effects = [effect('a', 0, 0), effect('shift', 1, 1)];
        const rules: MixingRules = {
            schema: 'neonschedule1-mixing-rules-1',
            maxProperties: 8,
            maxDeltaDifference: 0.5,
            defaultProductIds: [],
            maps: [
                {
                    drugType: 'Test',
                    drugTypeValue: 0,
                    radius: 4,
                    effects: [mapEffect('a', 0), mapEffect('shift', 1)],
                },
            ],
        };
        const items = [product('product', ['a'], 35), ingredient('ingredient', 'shift', 2)];
        const engine = new MixingEngine(rules, new Map(effects.map((entry) => [entry.id, entry])));
        const search = new RecipeSearch(engine, new Map(items.map((entry) => [entry.id, entry])), {
            maxStates: 1,
        });

        expect(() =>
            search.search({
                productId: 'product',
                availableIngredientIds: ['ingredient'],
                maxIngredients: 1,
                limit: 1,
            })
        ).toThrow(RecipeSearchLimitError);
    });

    it('prunes states whose best possible value cannot reach the result cutoff', () => {
        const effects = [
            effect('base', 0, 0),
            effect('high', 1, 10, 1),
            effect('low', 1, 1),
            effect('lower', 0, 0),
        ];
        const rules: MixingRules = {
            schema: 'neonschedule1-mixing-rules-1',
            maxProperties: 1,
            maxDeltaDifference: 0.5,
            defaultProductIds: [],
            maps: [
                {
                    drugType: 'Test',
                    drugTypeValue: 0,
                    radius: 10,
                    effects: [
                        mapEffect('base', 0),
                        mapEffect('low', 1),
                        mapEffect('lower', 2),
                        mapEffect('high', 10),
                    ],
                },
            ],
        };
        const items = [
            product('product', ['base'], 10),
            ingredient('high-ingredient', 'high', 1),
            ingredient('low-ingredient', 'low', 1),
        ];
        const engine = new MixingEngine(rules, new Map(effects.map((entry) => [entry.id, entry])));
        const search = new RecipeSearch(engine, new Map(items.map((entry) => [entry.id, entry])), {
            maxStates: 3,
        });

        expect(
            search.search({
                productId: 'product',
                availableIngredientIds: ['high-ingredient', 'low-ingredient'],
                maxIngredients: 2,
                limit: 1,
            })
        ).toEqual([
            {
                productId: 'product',
                ingredientIds: ['high-ingredient'],
                effectIds: ['high'],
                productValue: 20,
                baseProductCost: 0,
                ingredientCost: 1,
                totalCost: 1,
                netValue: 19,
                ingredientCount: 1,
            },
        ]);
    });

    it('applies effect constraints only to final results without corrupting the value cutoff', () => {
        const effects = [
            effect('base', 0, 0),
            effect('temporary', 1, 1),
            effect('required', 1, 1, 1),
            effect('high', 10, 1, 10),
        ];
        const rules: MixingRules = {
            schema: 'neonschedule1-mixing-rules-1',
            maxProperties: 1,
            maxDeltaDifference: 0.5,
            defaultProductIds: [],
            maps: [
                {
                    drugType: 'Test',
                    drugTypeValue: 0,
                    radius: 10,
                    effects: [
                        mapEffect('base', 0),
                        mapEffect('temporary', 1),
                        mapEffect('required', 2),
                        mapEffect('high', 10),
                    ],
                },
            ],
        };
        const items = [
            product('product', ['base'], 10),
            ingredient('step', 'temporary', 1),
            ingredient('high', 'high', 1),
        ];
        const engine = new MixingEngine(rules, new Map(effects.map((entry) => [entry.id, entry])));
        const search = new RecipeSearch(engine, new Map(items.map((entry) => [entry.id, entry])));

        expect(
            search.search({
                productId: 'product',
                availableIngredientIds: ['step', 'high'],
                maxIngredients: 2,
                limit: 1,
                requiredEffectIds: ['required'],
                forbiddenEffectIds: ['temporary'],
            })
        ).toEqual([
            {
                productId: 'product',
                ingredientIds: ['step', 'step'],
                effectIds: ['required'],
                productValue: 20,
                baseProductCost: 0,
                ingredientCost: 2,
                totalCost: 2,
                netValue: 18,
                ingredientCount: 2,
            },
        ]);
    });

    it('rejects invalid effect constraints', () => {
        const effects = [effect('base', 0, 0)];
        const rules: MixingRules = {
            schema: 'neonschedule1-mixing-rules-1',
            maxProperties: 8,
            maxDeltaDifference: 0.5,
            defaultProductIds: [],
            maps: [
                {
                    drugType: 'Test',
                    drugTypeValue: 0,
                    radius: 1,
                    effects: [mapEffect('base', 0)],
                },
            ],
        };
        const items = [product('product', ['base'], 10)];
        const engine = new MixingEngine(rules, new Map(effects.map((entry) => [entry.id, entry])));
        const search = new RecipeSearch(engine, new Map(items.map((entry) => [entry.id, entry])));

        expect(() =>
            search.search({
                productId: 'product',
                availableIngredientIds: [],
                maxIngredients: 0,
                limit: 1,
                requiredEffectIds: ['missing'],
            })
        ).toThrow('Unknown required mixing effect "missing"');
        expect(() =>
            search.search({
                productId: 'product',
                availableIngredientIds: [],
                maxIngredients: 0,
                limit: 1,
                requiredEffectIds: ['base'],
                forbiddenEffectIds: ['base'],
            })
        ).toThrow('Mixing effect "base" cannot be both required and forbidden');
    });
});

function effect(id: string, directionX: number, magnitude: number, addBaseValueMultiple = 0): Effect {
    return {
        schema: 'neonschedule1-effect-1',
        id,
        name: id,
        tier: 0,
        addictiveness: 0,
        implementedPriorMixingRework: false,
        value: { change: 0, multiplier: 1, addBaseValueMultiple },
        mixing: { direction: { x: directionX, y: 0 }, magnitude },
        presentation: {
            description: '',
            productColor: color(),
            labelColor: color(),
        },
    };
}

function mapEffect(effectId: string, x: number) {
    return { effectId, position: { x, y: 0 }, radius: 0.01 };
}

function color() {
    return { r: 0, g: 0, b: 0, a: 1, htmlRgba: '#000000FF' };
}

function product(id: string, effectIds: string[], basePrice: number, baseProductCost = 0): Item {
    return {
        ...item(id, {
            drugType: 'Test',
            basePrice,
            marketValue: basePrice,
            baseAddictiveness: 0,
            effectIds,
            validPackagingIds: [],
        }),
        basePurchasePrice: baseProductCost,
    };
}

function ingredient(id: string, effectId: string, basePurchasePrice: number): Item {
    return { ...item(id), basePurchasePrice, mixingIngredient: { effectIds: [effectId] } };
}

function item(id: string, product: Item['product'] = null): Item {
    return {
        schema: 'neonschedule1-item-3',
        id,
        name: id,
        category: 'Test',
        isRuntimeOnly: false,
        stackLimit: 20,
        isStorable: true,
        basePurchasePrice: null,
        resellMultiplier: 1,
        requiredRank: null,
        requiredRankTier: null,
        product,
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
    };
}
