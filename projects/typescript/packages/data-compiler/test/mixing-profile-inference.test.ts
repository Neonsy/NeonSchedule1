import { describe, expect, it } from 'vitest';

import {
    SeededMixingProfileInference,
    type Effect,
    type Item,
    type MixingRules,
} from '@neonschedule1/core';

describe('seeded mixing profile inference', () => {
    it('identifies the only seeded angle consistent with an observation', () => {
        const inference = fixture();

        expect(inference.infer({
            observations: [{
                productId: 'product',
                ingredientIds: ['ingredient'],
                observedEffectIds: ['north', 'shift'],
            }],
        })).toEqual({
            status: 'identified',
            candidates: [{ kind: 'seeded-rotation', angleDegrees: 90 }],
            evidence: {
                proofStatus: 'exact',
                candidateSpace: 'all-seeded-rotation-angles',
                profileCount: 360,
                rejectedProfileCount: 359,
                observationCount: 1,
                recipeEvaluationCount: 360,
                candidateCountsAfterObservation: [1],
            },
        });
    });

    it('returns every consistent angle in deterministic order when evidence is ambiguous', () => {
        const result = fixture().infer({
            observations: [{
                productId: 'product',
                ingredientIds: [],
                observedEffectIds: ['origin'],
            }],
        });

        expect(result.status).toBe('ambiguous');
        expect(result.candidates).toHaveLength(360);
        expect(result.candidates[0]).toEqual({
            kind: 'seeded-rotation',
            angleDegrees: 0,
        });
        expect(result.candidates[359]).toEqual({
            kind: 'seeded-rotation',
            angleDegrees: 359,
        });
        expect(result.evidence).toMatchObject({
            proofStatus: 'exact',
            rejectedProfileCount: 0,
            recipeEvaluationCount: 360,
            candidateCountsAfterObservation: [360],
        });
    });

    it('reports contradictory observations and the exact filtering work', () => {
        const result = fixture().infer({
            observations: [
                {
                    productId: 'product',
                    ingredientIds: ['ingredient'],
                    observedEffectIds: ['north', 'shift'],
                },
                {
                    productId: 'product',
                    ingredientIds: ['ingredient'],
                    observedEffectIds: ['origin', 'shift'],
                },
            ],
        });

        expect(result).toEqual({
            status: 'contradictory',
            candidates: [],
            evidence: {
                proofStatus: 'exact',
                candidateSpace: 'all-seeded-rotation-angles',
                profileCount: 360,
                rejectedProfileCount: 360,
                observationCount: 2,
                recipeEvaluationCount: 361,
                candidateCountsAfterObservation: [1, 0],
            },
        });
    });

    it('evaluates repeated ingredients in the observed recipe', () => {
        const result = fixture().infer({
            observations: [{
                productId: 'product',
                ingredientIds: ['ingredient', 'ingredient'],
                observedEffectIds: ['north', 'shift'],
            }],
        });

        expect(result.status).toBe('identified');
        expect(result.candidates).toEqual([
            { kind: 'seeded-rotation', angleDegrees: 90 },
        ]);
    });

    it('preserves ingredient order when matching an observation', () => {
        const inference = fixture();
        const observedEffectIds = ['origin', 'shift', 'still'];

        expect(inference.infer({
            observations: [{
                productId: 'product',
                ingredientIds: ['ingredient', 'still-ingredient'],
                observedEffectIds,
            }],
        }).candidates).toHaveLength(359);
        expect(inference.infer({
            observations: [{
                productId: 'product',
                ingredientIds: ['still-ingredient', 'ingredient'],
                observedEffectIds,
            }],
        }).status).toBe('contradictory');
    });

    it('rejects missing or malformed observations and unknown observed effects', () => {
        const inference = fixture();

        expect(() => inference.infer({ observations: [] })).toThrow(
            'at least one observation'
        );
        expect(() => inference.infer(null as never)).toThrow('input must be an object');
        expect(() => inference.infer({
            observations: [{
                productId: 'product',
                ingredientIds: 'ingredient' as never,
                observedEffectIds: ['origin'],
            }],
        })).toThrow('ingredientIds must be an array');
        expect(() => inference.infer({
            observations: [{
                productId: 'product',
                ingredientIds: [],
                observedEffectIds: ['missing'],
            }],
        })).toThrow('Unknown observed mixing effect "missing"');
    });
});

function fixture(): SeededMixingProfileInference {
    const effects = [
        effect('origin', 0, 0),
        effect('north', 0, 0),
        effect('shift', 1, 1),
        effect('still', 0, 0),
    ];
    const rules: MixingRules = {
        schema: 'neonschedule1-mixing-rules-1',
        maxProperties: 8,
        maxDeltaDifference: 0.5,
        defaultProductIds: [],
        maps: [{
            drugType: 'Test',
            drugTypeValue: 0,
            radius: 2,
            effects: [
                mapEffect('origin', 0, 0),
                mapEffect('north', 0, 1),
                mapEffect('shift', 3, 3),
                mapEffect('still', 4, 4),
            ],
        }],
    };
    const items = [
        product('product', ['origin']),
        ingredient('ingredient', 'shift'),
        ingredient('still-ingredient', 'still'),
    ];
    return new SeededMixingProfileInference(
        rules,
        new Map(effects.map((entry) => [entry.id, entry])),
        new Map(items.map((entry) => [entry.id, entry]))
    );
}

function effect(id: string, directionX: number, magnitude: number): Effect {
    return {
        schema: 'neonschedule1-effect-1',
        id,
        name: id,
        tier: 0,
        addictiveness: 0,
        implementedPriorMixingRework: false,
        value: { change: 0, multiplier: 1, addBaseValueMultiple: 0 },
        mixing: { direction: { x: directionX, y: 0 }, magnitude },
        presentation: {
            description: '',
            productColor: color(),
            labelColor: color(),
        },
    };
}

function mapEffect(effectId: string, x: number, y: number) {
    return { effectId, position: { x, y }, radius: 0.008 };
}

function product(id: string, effectIds: string[]): Item {
    return {
        ...item(id, {
            drugType: 'Test',
            basePrice: 10,
            marketValue: 10,
            baseAddictiveness: 0,
            effectIds,
            validPackagingIds: [],
        }),
        basePurchasePrice: 0,
    };
}

function ingredient(id: string, effectId: string): Item {
    return {
        ...item(id),
        basePurchasePrice: 1,
        mixingIngredient: { effectIds: [effectId] },
    };
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

function color() {
    return { r: 0, g: 0, b: 0, a: 1, htmlRgba: '#000000FF' };
}
