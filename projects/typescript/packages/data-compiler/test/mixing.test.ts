import { describe, expect, it } from 'vitest';

import { MixingEngine, RecipeEvaluator, type Effect, type Item, type MixingRules } from '@neonschedule1/core';

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
        const items = [product('product', ['a'], 35), ingredient('ingredient', 'shift', 2)];
        const engine = new MixingEngine(rules, new Map(effects.map((entry) => [entry.id, entry])));
        const evaluator = new RecipeEvaluator(engine, new Map(items.map((entry) => [entry.id, entry])));

        expect(evaluator.evaluate({ productId: 'product', ingredientIds: ['ingredient'] })).toEqual({
            productId: 'product',
            ingredientIds: ['ingredient'],
            effectIds: ['b', 'shift'],
            productValue: 35,
            ingredientCost: 2,
            ingredientCount: 1,
        });
        expect(() => evaluator.evaluate({ productId: 'product', ingredientIds: ['missing'] })).toThrow(
            'Unknown mixing ingredient "missing"'
        );
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

function product(id: string, effectIds: string[], basePrice: number): Item {
    return item(id, {
        drugType: 'Test',
        basePrice,
        marketValue: basePrice,
        baseAddictiveness: 0,
        effectIds,
        validPackagingIds: [],
    });
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
