import { describe, expect, it } from 'vitest';

import {
    compareRecipeEvaluations,
    mixingRuleProfileFromGameSeed,
    MixingEngine,
    recipeSearchObjectives,
    RecipeEvaluator,
    RecipeOutcomeEnumerator,
    ReverseRecipeSearch,
    RecipeSearch,
    RecipeSearchLimitError,
    RecipeSearchTimeLimitError,
    RecipeSearchWorkLimitError,
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

    it('rotates ingredient displacements by the normalized save-seed angle', () => {
        const effects = [
            effect('origin', 0, 0),
            effect('east', 0, 0),
            effect('north', 0, 0),
            effect('shift', 1, 1),
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
                    mapEffect2('origin', 0, 0),
                    mapEffect2('east', 1, 0),
                    mapEffect2('north', 0, 1),
                    mapEffect2('shift', -1, -1),
                ],
            }],
        };
        const indexedEffects = new Map(effects.map((entry) => [entry.id, entry]));
        const standard = new MixingEngine(rules, indexedEffects);
        const seeded = new MixingEngine(
            rules,
            indexedEffects,
            mixingRuleProfileFromGameSeed(450)
        );

        expect(standard.mixEffectIds('Test', ['origin'], 'shift')).toEqual(['east', 'shift']);
        expect(seeded.ruleProfile).toEqual({ kind: 'seeded-rotation', angleDegrees: 90 });
        expect(seeded.mixEffectIds('Test', ['origin'], 'shift')).toEqual(['north', 'shift']);
        expect(mixingRuleProfileFromGameSeed(-90)).toEqual({
            kind: 'seeded-rotation',
            angleDegrees: 270,
        });
        expect(() => new MixingEngine(rules, indexedEffects, {
            kind: 'seeded-rotation',
            angleDegrees: 360,
        })).toThrow('integer from 0 through 359');
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
            ruleProfile: { kind: 'standard' },
            productId: 'product',
            ingredientIds: ['ingredient'],
            effectIds: ['b', 'shift'],
            productValue: 35,
            baseProductCost: 5,
            baseProductCostBasis: 'base-purchase-price',
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
        const producedEvaluator = new RecipeEvaluator(engine, new Map(items.map((entry) => [entry.id, entry])), {
            productionCosts: { unitCost: () => 4 },
        });
        expect(producedEvaluator.evaluate({ productId: 'product', ingredientIds: [] })).toMatchObject({
            baseProductCost: 4,
            baseProductCostBasis: 'production-materials',
            totalCost: 4,
            netValue: 34,
        });
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
            }).recipes
        ).toEqual([
            {
                ruleProfile: { kind: 'standard' },
                productId: 'product',
                ingredientIds: ['ingredient'],
                effectIds: ['b', 'shift'],
                productValue: 46,
                baseProductCost: 0,
                baseProductCostBasis: 'base-purchase-price',
                ingredientCost: 2,
                totalCost: 2,
                netValue: 44,
                ingredientCount: 1,
            },
            {
                ruleProfile: { kind: 'standard' },
                productId: 'product',
                ingredientIds: [],
                effectIds: ['a'],
                productValue: 38,
                baseProductCost: 0,
                baseProductCostBasis: 'base-purchase-price',
                ingredientCost: 0,
                totalCost: 0,
                netValue: 38,
                ingredientCount: 0,
            },
        ]);
        const returnOnCost = search.search({
            productId: 'product',
            availableIngredientIds: ['ingredient'],
            maxIngredients: 2,
            limit: 5,
            objective: 'returnOnCost',
        });
        expect(returnOnCost.objective).toBe('returnOnCost');
        expect(returnOnCost.recipes.map((recipe) => recipe.ingredientIds)).toEqual([
            ['ingredient'],
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
        const search = new RecipeSearch(engine, new Map(items.map((entry) => [entry.id, entry])), {
            productionCosts: { unitCost: () => 4 },
        });
        const input = {
            productId: 'product',
            availableIngredientIds: ['expensive', 'cheap'],
            maxIngredients: 1,
            limit: 1,
        } as const;

        expect(search.search({ ...input, objective: 'productValue' }).recipes[0]).toMatchObject({
            ingredientIds: ['expensive'],
            productValue: 20,
            baseProductCost: 4,
            baseProductCostBasis: 'production-materials',
            ingredientCost: 15,
            totalCost: 19,
            netValue: 1,
        });
        expect(search.search({ ...input, objective: 'netValue' }).recipes[0]).toMatchObject({
            ingredientIds: ['cheap'],
            productValue: 15,
            baseProductCost: 4,
            baseProductCostBasis: 'production-materials',
            ingredientCost: 1,
            totalCost: 5,
            netValue: 10,
        });
        expect(search.search({ ...input, objective: 'fewestSteps' }).recipes[0]).toMatchObject({
            ingredientIds: [],
            ingredientCount: 0,
            totalCost: 4,
        });
        expect(search.search({ ...input, objective: 'lowestCost' }).recipes[0]).toMatchObject({
            ingredientIds: [],
            ingredientCount: 0,
            totalCost: 4,
        });
        expect(search.search({ ...input, objective: 'returnOnCost' }).recipes[0]).toMatchObject({
            ingredientIds: ['cheap'],
            productValue: 15,
            totalCost: 5,
        });

        const exhaustive = new RecipeOutcomeEnumerator(
            engine,
            new Map(items.map((entry) => [entry.id, entry])),
            { productionCosts: { unitCost: () => 4 } }
        ).enumerate({
            productId: 'product',
            availableIngredientIds: input.availableIngredientIds,
            maxIngredients: 2,
        });
        for (const objective of recipeSearchObjectives) {
            for (const maximumTotalCost of [3, 4, 5, 19]) {
                const expected = exhaustive
                    .filter((recipe) => recipe.totalCost <= maximumTotalCost)
                    .sort((left, right) => compareRecipeEvaluations(left, right, objective))
                    .slice(0, 2);
                expect(search.search({
                    ...input,
                    maxIngredients: 2,
                    limit: 2,
                    objective,
                    maximumTotalCost,
                }).recipes).toEqual(expected);
            }
        }
        expect(() => search.search({ ...input, maximumTotalCost: -1 })).toThrow(
            'maximumTotalCost must be a non-negative finite number'
        );
        expect(() => search.search({
            ...input,
            objective: 'profitOverTime' as never,
        })).toThrow(
            'Recipe profit-over-time ranking is unsupported because recipe results do not establish complete production duration'
        );
    });

    it('uses explicit cost, value, and identifier tie-breaks for new objectives', () => {
        const effects = [effect('base', 0, 0)];
        const rules: MixingRules = {
            schema: 'neonschedule1-mixing-rules-1',
            maxProperties: 1,
            maxDeltaDifference: 0.5,
            defaultProductIds: [],
            maps: [{
                drugType: 'Test',
                drugTypeValue: 0,
                radius: 1,
                effects: [mapEffect('base', 0)],
            }],
        };
        const items = [
            product('cheap', ['base'], 10, 2),
            product('valuable', ['base'], 20, 4),
        ];
        const search = new ReverseRecipeSearch(
            new MixingEngine(rules, new Map(effects.map((entry) => [entry.id, entry]))),
            new Map(items.map((entry) => [entry.id, entry]))
        );
        const input = {
            productIds: ['valuable', 'cheap'],
            availableIngredientIds: [],
            maxIngredients: 0,
            limit: 2,
        } as const;

        expect(search.search({
            ...input,
            objective: 'fewestSteps',
        }).recipes.map((recipe) => recipe.productId)).toEqual(['cheap', 'valuable']);
        expect(search.search({
            ...input,
            objective: 'lowestCost',
        }).recipes.map((recipe) => recipe.productId)).toEqual(['cheap', 'valuable']);
        expect(search.search({
            ...input,
            objective: 'returnOnCost',
        }).recipes.map((recipe) => recipe.productId)).toEqual(['valuable', 'cheap']);
    });

    it('fails explicitly before an exact search exceeds either budget', () => {
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

        let failure: unknown;
        try {
            search.search({
                productId: 'product',
                availableIngredientIds: ['ingredient'],
                maxIngredients: 1,
                limit: 1,
            });
        } catch (error) {
            failure = error;
        }

        expect(failure).toBeInstanceOf(RecipeSearchLimitError);
        expect((failure as RecipeSearchLimitError).evidence).toEqual({
            proofStatus: 'incomplete',
            stopReason: 'state-limit',
            exploredStates: 1,
            prunedStates: 0,
            completedDepth: 0,
            transitionEvaluations: 3,
            boundTransitionEvaluations: 2,
        });

        const bestFound = new RecipeSearch(
            engine,
            new Map(items.map((entry) => [entry.id, entry])),
            { maxStates: 1, limitBehavior: 'return-best-found' }
        ).search({
            productId: 'product',
            availableIngredientIds: ['ingredient'],
            maxIngredients: 1,
            limit: 1,
            objective: 'fewestSteps',
        });
        expect(bestFound.objective).toBe('fewestSteps');
        expect(bestFound.evidence).toMatchObject({
            proofStatus: 'incomplete',
            stopReason: 'state-limit',
            completedDepth: 0,
        });
        expect(bestFound.recipes.map((recipe) => recipe.ingredientIds)).toEqual([[]]);

        const workSearch = new RecipeSearch(
            engine,
            new Map(items.map((entry) => [entry.id, entry])),
            { maxStates: 10, maxTransitionEvaluations: 2 }
        );
        let workFailure: unknown;
        try {
            workSearch.search({
                productId: 'product',
                availableIngredientIds: ['ingredient'],
                maxIngredients: 1,
                limit: 1,
            });
        } catch (error) {
            workFailure = error;
        }

        expect(workFailure).toBeInstanceOf(RecipeSearchWorkLimitError);
        expect((workFailure as RecipeSearchWorkLimitError).evidence).toEqual({
            proofStatus: 'incomplete',
            stopReason: 'work-limit',
            exploredStates: 1,
            prunedStates: 0,
            completedDepth: 0,
            transitionEvaluations: 2,
            boundTransitionEvaluations: 2,
        });

        const exactWorkResult = new RecipeSearch(
            engine,
            new Map(items.map((entry) => [entry.id, entry])),
            { maxStates: 10, maxTransitionEvaluations: 3 }
        ).search({
            productId: 'product',
            availableIngredientIds: ['ingredient'],
            maxIngredients: 1,
            limit: 1,
        });
        expect(exactWorkResult.evidence).toMatchObject({
            proofStatus: 'exact',
            transitionEvaluations: 3,
        });

        let clockTime = 0;
        const timedSearch = new RecipeSearch(
            engine,
            new Map(items.map((entry) => [entry.id, entry])),
            {
                maxStates: 10,
                maxDurationMs: 1,
                clock: { now: () => clockTime++ },
            }
        );
        let timeFailure: unknown;
        try {
            timedSearch.search({
                productId: 'product',
                availableIngredientIds: ['ingredient'],
                maxIngredients: 1,
                limit: 1,
            });
        } catch (error) {
            timeFailure = error;
        }

        expect(timeFailure).toBeInstanceOf(RecipeSearchTimeLimitError);
        expect((timeFailure as RecipeSearchTimeLimitError).elapsedMs).toBe(1);
        expect((timeFailure as RecipeSearchTimeLimitError).evidence).toEqual({
            proofStatus: 'incomplete',
            stopReason: 'time-limit',
            exploredStates: 1,
            prunedStates: 0,
            completedDepth: 0,
            transitionEvaluations: 0,
            boundTransitionEvaluations: 0,
        });

        let finalClockReads = 0;
        const finalTimedSearch = new RecipeSearch(
            engine,
            new Map(items.map((entry) => [entry.id, entry])),
            {
                maxStates: 10,
                maxDurationMs: 1,
                clock: { now: () => ++finalClockReads === 5 ? 1 : 0 },
            }
        );
        let finalTimeFailure: unknown;
        try {
            finalTimedSearch.search({
                productId: 'product',
                availableIngredientIds: ['ingredient'],
                maxIngredients: 1,
                limit: 1,
            });
        } catch (error) {
            finalTimeFailure = error;
        }
        expect((finalTimeFailure as RecipeSearchTimeLimitError).evidence).toMatchObject({
            stopReason: 'time-limit',
            completedDepth: 1,
            transitionEvaluations: 3,
        });
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

        const result = search.search({
            productId: 'product',
            availableIngredientIds: ['high-ingredient', 'low-ingredient'],
            maxIngredients: 2,
            limit: 1,
        });

        expect(result.recipes).toEqual([
            {
                ruleProfile: { kind: 'standard' },
                productId: 'product',
                ingredientIds: ['high-ingredient'],
                effectIds: ['high'],
                productValue: 20,
                baseProductCost: 0,
                baseProductCostBasis: 'base-purchase-price',
                ingredientCost: 1,
                totalCost: 1,
                netValue: 19,
                ingredientCount: 1,
            },
        ]);
        expect(result.evidence).toMatchObject({
            proofStatus: 'exact',
            stopReason: 'completed',
            completedDepth: 2,
        });
        expect(result.evidence.prunedStates).toBeGreaterThan(0);
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
            }).recipes
        ).toEqual([
            {
                ruleProfile: { kind: 'standard' },
                productId: 'product',
                ingredientIds: ['step', 'step'],
                effectIds: ['required'],
                productValue: 20,
                baseProductCost: 0,
                baseProductCostBasis: 'base-purchase-price',
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

    it('applies ingredient and count constraints without losing equivalent states', () => {
        const effects = [
            effect('base', 0, 0),
            effect('mixed', 0, 0),
            effect('cheap-shift', 1, 1),
            effect('required-shift', 1, 1),
        ];
        const rules: MixingRules = {
            schema: 'neonschedule1-mixing-rules-1',
            maxProperties: 1,
            maxDeltaDifference: 0.5,
            defaultProductIds: [],
            maps: [{
                drugType: 'Test',
                drugTypeValue: 0,
                radius: 2,
                effects: [mapEffect('base', 0), mapEffect('mixed', 1)],
            }],
        };
        const items = [
            product('product', ['base'], 10),
            ingredient('cheap', 'cheap-shift', 1),
            ingredient('required', 'required-shift', 2),
        ];
        const search = new RecipeSearch(
            new MixingEngine(rules, new Map(effects.map((entry) => [entry.id, entry]))),
            new Map(items.map((entry) => [entry.id, entry]))
        );
        const input = {
            productId: 'product',
            availableIngredientIds: ['cheap', 'required'],
            maxIngredients: 2,
            limit: 10,
        } as const;

        expect(search.search({
            ...input,
            requiredIngredientIds: ['required'],
            exactIngredientCount: 1,
        }).recipes.map((recipe) => recipe.ingredientIds)).toEqual([['required']]);
        expect(search.search({
            ...input,
            exactIngredientCount: 2,
        }).recipes.map((recipe) => recipe.ingredientIds)).toEqual([['cheap', 'cheap']]);
        expect(search.search({
            ...input,
            minimumIngredientCount: 2,
            requiredIngredientIds: ['required'],
        }).recipes.map((recipe) => recipe.ingredientIds)).toEqual([
            ['cheap', 'required'],
        ]);
        expect(search.search({
            ...input,
            exactIngredientCount: 1,
            forbiddenIngredientIds: ['cheap'],
        }).recipes.map((recipe) => recipe.ingredientIds)).toEqual([['required']]);

        const interrupted = new RecipeSearch(
            new MixingEngine(rules, new Map(effects.map((entry) => [entry.id, entry]))),
            new Map(items.map((entry) => [entry.id, entry])),
            { maxStates: 1, limitBehavior: 'return-best-found' }
        ).search({
            ...input,
            exactIngredientCount: 2,
        });
        expect(interrupted.recipes).toEqual([]);
        expect(interrupted.evidence).toMatchObject({
            proofStatus: 'incomplete',
            stopReason: 'state-limit',
            completedDepth: 0,
        });
    });

    it('rejects invalid ingredient and count constraints', () => {
        const effects = [effect('base', 0, 0), effect('shift', 1, 1)];
        const rules: MixingRules = {
            schema: 'neonschedule1-mixing-rules-1',
            maxProperties: 1,
            maxDeltaDifference: 0.5,
            defaultProductIds: [],
            maps: [{
                drugType: 'Test',
                drugTypeValue: 0,
                radius: 1,
                effects: [mapEffect('base', 0)],
            }],
        };
        const items = [
            product('product', ['base'], 10),
            ingredient('ingredient', 'shift', 1),
        ];
        const search = new RecipeSearch(
            new MixingEngine(rules, new Map(effects.map((entry) => [entry.id, entry]))),
            new Map(items.map((entry) => [entry.id, entry]))
        );
        const input = {
            productId: 'product',
            availableIngredientIds: ['ingredient'],
            maxIngredients: 1,
            limit: 1,
        } as const;

        expect(() => search.search({
            ...input,
            requiredIngredientIds: ['ingredient', 'ingredient'],
        })).toThrow('Duplicate required mixing ingredient "ingredient"');
        expect(() => search.search({
            ...input,
            requiredIngredientIds: ['missing'],
        })).toThrow('Unknown required mixing ingredient "missing"');
        expect(() => search.search({
            ...input,
            requiredIngredientIds: ['ingredient'],
            forbiddenIngredientIds: ['ingredient'],
        })).toThrow('cannot be both required and forbidden');
        expect(() => search.search({
            ...input,
            requiredIngredientIds: ['ingredient'],
            availableIngredientIds: [],
        })).toThrow('is not available');
        expect(() => search.search({
            ...input,
            minimumIngredientCount: 2,
        })).toThrow('minimumIngredientCount cannot exceed maxIngredients');
        expect(() => search.search({
            ...input,
            minimumIngredientCount: 1,
            exactIngredientCount: 0,
        })).toThrow('minimumIngredientCount cannot exceed exactIngredientCount');
        expect(() => search.search({
            ...input,
            exactIngredientCount: 2,
        })).toThrow('exactIngredientCount cannot exceed maxIngredients');
    });

    it('finds an exact effect-constrained recipe across base products', () => {
        const effects = [
            effect('base', 0, 0),
            effect('temporary', 1, 1),
            effect('required', 1, 1, 1),
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
                    radius: 3,
                    effects: [
                        mapEffect('base', 0),
                        mapEffect('temporary', 1),
                        mapEffect('required', 2),
                    ],
                },
            ],
        };
        const items = [
            product('slow', ['base'], 10, 2),
            product('ready', ['required'], 10, 15),
            ingredient('step', 'temporary', 1),
        ];
        const engine = new MixingEngine(rules, new Map(effects.map((entry) => [entry.id, entry])));
        const search = new ReverseRecipeSearch(
            engine,
            new Map(items.map((entry) => [entry.id, entry]))
        );
        const input = {
            availableIngredientIds: ['step'],
            maxIngredients: 2,
            limit: 1,
            requiredEffectIds: ['required'],
            forbiddenEffectIds: ['temporary'],
            objective: 'netValue',
        } as const;

        const result = search.search({ ...input, maximumTotalCost: 4 });

        expect(result.recipes[0]).toMatchObject({
            productId: 'slow',
            ingredientIds: ['step', 'step'],
            ingredientQuantities: [{ ingredientId: 'step', quantity: 2 }],
            effectIds: ['required'],
            productValue: 20,
            totalCost: 4,
            netValue: 16,
        });
        expect(result.evidence).toMatchObject({
            proofStatus: 'exact',
            stopReason: 'completed',
            completedDepth: 2,
        });
        expect(search.search({ ...input, productIds: ['ready'] }).recipes[0]).toMatchObject({
            productId: 'ready',
            ingredientIds: [],
            ingredientQuantities: [],
        });
        expect(search.search({
            ...input,
            productIds: ['ready'],
            maximumTotalCost: 4,
        }).recipes).toEqual([]);
        expect(() => search.search({ ...input, productIds: ['ready', 'ready'] })).toThrow(
            'Duplicate available product "ready"'
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

function mapEffect2(effectId: string, x: number, y: number) {
    return { effectId, position: { x, y }, radius: 0.1 };
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
