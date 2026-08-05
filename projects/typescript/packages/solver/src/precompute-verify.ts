import { performance } from 'node:perf_hooks';

import {
    compareRecipeEvaluations,
    MixingEngine,
    RecipeOutcomeEnumerator,
    ReverseRecipeSearch,
    type RecipeEvaluation,
    type RecipeSearchObjective,
} from '@neonschedule1/core';

import type { SolverDataset } from '#solver/dataset';
import {
    RecipeCorpusLookup,
    type RecipeCorpusQuery,
} from '#solver/precompute-query';
import type { RecipeCorpusEntry } from '#solver/precompute';

export interface RecipeIndexVerificationReport {
    readonly schema: 'neonschedule1-recipe-index-verification-1';
    readonly createdAt: string;
    readonly dataset: {
        readonly gameVersion: string;
        readonly datasetSha256: string;
        readonly normalizerVersion: string;
    };
    readonly corpusArtifactSha256: string;
    readonly indexArtifactSha256: string;
    readonly configuration: {
        readonly limit: number;
        readonly caseCount: number;
    };
    readonly cases: readonly RecipeIndexVerificationCase[];
}

export interface RecipeIndexVerificationCase {
    readonly id: string;
    readonly oracle: 'reverse-search' | 'exhaustive-outcomes';
    readonly objective: RecipeSearchObjective;
    readonly resultCount: number;
    readonly candidateCount: number;
    readonly examinedRankingEntries: number;
    readonly durationMs: number;
}

interface VerificationDefinition {
    readonly id: string;
    readonly oracle: RecipeIndexVerificationCase['oracle'];
    readonly productIds?: readonly string[];
    readonly requiredEffectIds?: readonly string[];
    readonly forbiddenEffectIds?: readonly string[];
    readonly maximumTotalCost?: number;
}

export async function runRecipeIndexVerification(
    dataset: SolverDataset,
    lookup: RecipeCorpusLookup,
    limit = 10,
    onCaseCompleted: (
        completed: number,
        total: number,
        result: RecipeIndexVerificationCase
    ) => void = () => undefined
): Promise<RecipeIndexVerificationReport> {
    if (!Number.isSafeInteger(limit) || limit < 1) {
        throw new Error('Recipe index verification limit must be positive');
    }
    const corpus = lookup.corpusManifest;
    if (corpus.dataset.datasetSha256 !== dataset.manifest.datasetSha256) {
        throw new Error('Recipe corpus and verification dataset differ');
    }
    const itemsById = new Map(dataset.items.map((item) => [item.id, item]));
    const effectsById = new Map(dataset.effects.map((effect) => [effect.id, effect]));
    const engine = new MixingEngine(dataset.mixingRules, effectsById);
    const enumerator = new RecipeOutcomeEnumerator(engine, itemsById, {
        maxStates: corpus.configuration.maxStates,
    });
    const exhaustive = corpus.configuration.productIds.flatMap((productId) =>
        enumerator.enumerate({
            productId,
            availableIngredientIds: corpus.configuration.ingredientIds,
            maxIngredients: corpus.configuration.maxIngredients,
            requiredEffectIds: corpus.configuration.requiredEffectIds,
            forbiddenEffectIds: corpus.configuration.forbiddenEffectIds,
        })
    );
    if (exhaustive.length !== corpus.counts.recipes) {
        throw new Error(
            `Exhaustive verifier found ${exhaustive.length} outcomes, corpus has ${corpus.counts.recipes}`
        );
    }
    const search = new ReverseRecipeSearch(engine, itemsById, {
        maxStates: corpus.configuration.maxStates,
    });
    const definitions = verificationDefinitions(corpus.configuration.productIds, exhaustive);
    const cases: RecipeIndexVerificationCase[] = [];

    for (const definition of definitions) {
        for (const objective of ['productValue', 'netValue'] as const) {
            const query = queryFor(definition, objective, limit);
            const startedAt = performance.now();
            const actual = await lookup.query(query);
            const durationMs = performance.now() - startedAt;
            const expected = definition.oracle === 'reverse-search'
                ? search.search({
                    productIds: definition.productIds ?? corpus.configuration.productIds,
                    availableIngredientIds: corpus.configuration.ingredientIds,
                    maxIngredients: corpus.configuration.maxIngredients,
                    limit,
                    requiredEffectIds: mergeEffects(
                        corpus.configuration.requiredEffectIds,
                        definition.requiredEffectIds ?? []
                    ),
                    forbiddenEffectIds: mergeEffects(
                        corpus.configuration.forbiddenEffectIds,
                        definition.forbiddenEffectIds ?? []
                    ),
                    objective,
                }).recipes
                : exhaustiveResult(exhaustive, query, objective, limit);
            assertSameRecipes(
                `${definition.id}:${objective}`,
                expected.map(comparableEvaluation),
                actual.recipes.map(comparableEntry)
            );
            const result: RecipeIndexVerificationCase = {
                id: `${definition.id}:${objective}`,
                oracle: definition.oracle,
                objective,
                resultCount: actual.recipes.length,
                candidateCount: actual.evidence.candidateCount,
                examinedRankingEntries: actual.evidence.examinedRankingEntries,
                durationMs,
            };
            cases.push(result);
            onCaseCompleted(cases.length, definitions.length * 2, result);
        }
    }

    return {
        schema: 'neonschedule1-recipe-index-verification-1',
        createdAt: new Date().toISOString(),
        dataset: {
            gameVersion: dataset.manifest.gameVersion,
            datasetSha256: dataset.manifest.datasetSha256,
            normalizerVersion: dataset.manifest.normalizerVersion,
        },
        corpusArtifactSha256: corpus.artifactSha256,
        indexArtifactSha256: lookup.indexManifest.artifactSha256,
        configuration: { limit, caseCount: cases.length },
        cases,
    };
}

function verificationDefinitions(
    productIds: readonly string[],
    exhaustive: readonly RecipeEvaluation[]
): VerificationDefinition[] {
    const effectIds = [...new Set(exhaustive.flatMap((recipe) => recipe.effectIds))].sort();
    const required = selectEvenly(effectIds, Math.min(4, effectIds.length)).map((effectId) => ({
        id: `required:${effectId}`,
        oracle: 'reverse-search' as const,
        requiredEffectIds: [effectId],
    }));
    const forbidden = selectEvenly(effectIds, Math.min(4, effectIds.length)).map((effectId) => ({
        id: `forbidden:${effectId}`,
        oracle: 'reverse-search' as const,
        forbiddenEffectIds: [effectId],
    }));
    const costs = [...new Set(exhaustive.map((recipe) => recipe.totalCost))]
        .sort((left, right) => left - right);
    const budgets = selectEvenly(costs, Math.min(4, costs.length)).map((maximumTotalCost) => ({
        id: `budget:${maximumTotalCost}`,
        oracle: 'exhaustive-outcomes' as const,
        maximumTotalCost,
    }));
    return [
        { id: 'all', oracle: 'reverse-search' },
        ...productIds.map((productId) => ({
            id: `product:${productId}`,
            oracle: 'reverse-search' as const,
            productIds: [productId],
        })),
        ...required,
        ...forbidden,
        ...budgets,
    ];
}

function queryFor(
    definition: VerificationDefinition,
    objective: RecipeSearchObjective,
    limit: number
): RecipeCorpusQuery {
    return {
        ...(definition.productIds === undefined ? {} : { productIds: definition.productIds }),
        ...(definition.requiredEffectIds === undefined
            ? {}
            : { requiredEffectIds: definition.requiredEffectIds }),
        ...(definition.forbiddenEffectIds === undefined
            ? {}
            : { forbiddenEffectIds: definition.forbiddenEffectIds }),
        ...(definition.maximumTotalCost === undefined
            ? {}
            : { maximumTotalCost: definition.maximumTotalCost }),
        objective,
        limit,
    };
}

function exhaustiveResult(
    recipes: readonly RecipeEvaluation[],
    query: RecipeCorpusQuery,
    objective: RecipeSearchObjective,
    limit: number
): RecipeEvaluation[] {
    return recipes
        .filter((recipe) =>
            (query.productIds === undefined || query.productIds.includes(recipe.productId)) &&
            (query.requiredEffectIds ?? []).every((effectId) => recipe.effectIds.includes(effectId)) &&
            (query.forbiddenEffectIds ?? []).every((effectId) => !recipe.effectIds.includes(effectId)) &&
            (query.maximumTotalCost === undefined || recipe.totalCost <= query.maximumTotalCost)
        )
        .sort((left, right) => compareRecipeEvaluations(left, right, objective))
        .slice(0, limit);
}

function comparableEvaluation(recipe: RecipeEvaluation): unknown {
    return {
        productId: recipe.productId,
        ingredientIds: recipe.ingredientIds,
        effectIds: recipe.effectIds,
        productValue: recipe.productValue,
        baseProductCost: recipe.baseProductCost,
        baseProductCostBasis: recipe.baseProductCostBasis,
        ingredientCost: recipe.ingredientCost,
        totalCost: recipe.totalCost,
        netValue: recipe.netValue,
        ingredientCount: recipe.ingredientCount,
    };
}

function comparableEntry(recipe: RecipeCorpusEntry): unknown {
    return {
        productId: recipe.productId,
        ingredientIds: recipe.ingredientIds,
        effectIds: recipe.effectIds,
        productValue: recipe.productValue,
        baseProductCost: recipe.costs.baseProduct,
        baseProductCostBasis: recipe.costs.baseProductBasis,
        ingredientCost: recipe.costs.ingredients,
        totalCost: recipe.costs.total,
        netValue: recipe.netValue,
        ingredientCount: recipe.depth,
    };
}

function mergeEffects(left: readonly string[], right: readonly string[]): string[] {
    return [...new Set([...left, ...right])].sort();
}

function assertSameRecipes(id: string, expected: readonly unknown[], actual: readonly unknown[]): void {
    if (JSON.stringify(expected) === JSON.stringify(actual)) return;
    const difference = Math.max(expected.length, actual.length);
    for (let index = 0; index < difference; index++) {
        if (JSON.stringify(expected[index]) === JSON.stringify(actual[index])) continue;
        throw new Error(
            `Recipe index verification ${id} differs at result ${index + 1}\n` +
            `Expected: ${JSON.stringify(expected[index] ?? null)}\n` +
            `Actual: ${JSON.stringify(actual[index] ?? null)}`
        );
    }
    throw new Error(`Recipe index verification ${id} differs`);
}

function selectEvenly<T>(values: readonly T[], count: number): T[] {
    if (count <= 0) return [];
    if (count >= values.length) return [...values];
    if (count === 1) return [values[Math.floor((values.length - 1) / 2)]!];
    return Array.from({ length: count }, (_, index) =>
        values[Math.round((index * (values.length - 1)) / (count - 1))]!
    );
}
