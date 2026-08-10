import { performance } from 'node:perf_hooks';

import {
    compareRecipeEvaluations,
    CustomerRecipeSearch,
    MixingEngine,
    RecipeOutcomeEnumerator,
    isRecipeRankable,
    recipeSearchObjectives,
    ReverseRecipeSearch,
    type Customer,
    type CustomerQuality,
    type CustomerRecommendation,
    type RecipeEvaluation,
    type RecipeSearchObjective,
} from '@neonschedule1/core';

import type { SolverDataset } from '#solver/dataset';
import {
    CustomerCorpusRecommendationLookup,
    type CustomerCorpusRecommendationQuery,
} from '#solver/precompute-customer';
import {
    RecipeCorpusLookup,
    type RecipeCorpusQuery,
} from '#solver/precompute-query';
import type {
    RecipeCorpusConfiguration,
    RecipeCorpusEntry,
} from '#solver/precompute';

export interface RecipeIndexVerificationReport {
    readonly schema: 'neonschedule1-recipe-index-verification-2';
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
        readonly recipeCaseCount: number;
        readonly customerCaseCount: number;
    };
    readonly recipeCases: readonly RecipeIndexVerificationCase[];
    readonly customerCases: readonly CustomerIndexVerificationCase[];
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

export interface CustomerIndexVerificationCase {
    readonly id: string;
    readonly oracle: 'customer-recipe-search';
    readonly customerId: string;
    readonly quality: CustomerQuality;
    readonly quantity: number;
    readonly priceMultiplier: number;
    readonly maximumProductionCost: number;
    readonly relationship: number;
    readonly resultCount: number;
    readonly evaluatedCandidateCount: number;
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

interface CustomerVerificationDefinition {
    readonly id: string;
    readonly customer: Customer;
    readonly quality: CustomerQuality;
    readonly quantity: number;
    readonly priceMultiplier: number;
    readonly maximumProductionCost: number;
    readonly relationship: number;
}

export async function runRecipeIndexVerification(
    dataset: SolverDataset,
    lookup: RecipeCorpusLookup,
    limit = 10,
    onCaseCompleted: (
        completed: number,
        total: number,
        result: RecipeIndexVerificationCase
    ) => void = () => undefined,
    onCustomerCaseCompleted: (
        completed: number,
        total: number,
        result: CustomerIndexVerificationCase
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
    let exhaustive = corpus.configuration.productIds.flatMap((productId) =>
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
    const recipeCases: RecipeIndexVerificationCase[] = [];

    for (const definition of definitions) {
        for (const objective of recipeSearchObjectives) {
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
            recipeCases.push(result);
            onCaseCompleted(recipeCases.length, definitions.length * 2, result);
        }
    }

    const customerLookup = new CustomerCorpusRecommendationLookup(
        lookup,
        dataset.customerCatalog
    );
    const customerSearch = new CustomerRecipeSearch(
        engine,
        itemsById,
        dataset.customerCatalog,
        { maxStates: corpus.configuration.maxStates }
    );
    const customerDefinitions = customerVerificationDefinitions(dataset, exhaustive);
    exhaustive = [];
    const customerCases: CustomerIndexVerificationCase[] = [];
    for (const definition of customerDefinitions) {
        const input = customerQuery(definition, corpus.configuration, limit);
        const startedAt = performance.now();
        const actual = await customerLookup.recommend(input);
        const durationMs = performance.now() - startedAt;
        const expected = customerSearch.search({
            ...input,
            productIds: corpus.configuration.productIds,
            availableIngredientIds: corpus.configuration.ingredientIds,
            maxIngredients: corpus.configuration.maxIngredients,
            requiredEffectIds: corpus.configuration.requiredEffectIds,
            forbiddenEffectIds: corpus.configuration.forbiddenEffectIds,
        });
        assertSameRecommendations(
            definition.id,
            expected.recommendations,
            actual.recommendations
        );
        const result: CustomerIndexVerificationCase = {
            id: definition.id,
            oracle: 'customer-recipe-search',
            customerId: definition.customer.id,
            quality: definition.quality,
            quantity: definition.quantity,
            priceMultiplier: definition.priceMultiplier,
            maximumProductionCost: definition.maximumProductionCost,
            relationship: definition.relationship,
            resultCount: actual.recommendations.length,
            evaluatedCandidateCount: actual.evidence.evaluatedCandidateCount,
            durationMs,
        };
        customerCases.push(result);
        onCustomerCaseCompleted(customerCases.length, customerDefinitions.length, result);
    }

    return {
        schema: 'neonschedule1-recipe-index-verification-2',
        createdAt: new Date().toISOString(),
        dataset: {
            gameVersion: dataset.manifest.gameVersion,
            datasetSha256: dataset.manifest.datasetSha256,
            normalizerVersion: dataset.manifest.normalizerVersion,
        },
        corpusArtifactSha256: corpus.artifactSha256,
        indexArtifactSha256: lookup.indexManifest.artifactSha256,
        configuration: {
            limit,
            recipeCaseCount: recipeCases.length,
            customerCaseCount: customerCases.length,
        },
        recipeCases,
        customerCases,
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

function customerVerificationDefinitions(
    dataset: SolverDataset,
    exhaustive: readonly RecipeEvaluation[]
): CustomerVerificationDefinition[] {
    if (dataset.customers.length === 0) {
        throw new Error('Customer corpus verification requires at least one customer');
    }
    if (dataset.customerCatalog.qualityTiers.length === 0) {
        throw new Error('Customer corpus verification requires at least one quality tier');
    }
    if (exhaustive.length === 0) {
        throw new Error('Customer corpus verification requires at least one recipe');
    }
    const customers = selectEvenly(
        [...dataset.customers].sort(
            (left, right) =>
                averageSpend(left) - averageSpend(right) || left.id.localeCompare(right.id)
        ),
        Math.min(3, dataset.customers.length)
    );
    const qualities = selectEvenly(
        [...dataset.customerCatalog.qualityTiers].sort(
            (left, right) => left.value - right.value || left.name.localeCompare(right.name)
        ),
        customers.length
    );
    const costs = selectEvenly(
        [...new Set(exhaustive.map((recipe) => recipe.totalCost))]
            .sort((left, right) => left - right),
        customers.length
    );
    const maximumQuantity = dataset.customerCatalog.constants.maximumOrderQuantityPerProduct;
    const maximumRelationship = dataset.customerCatalog.constants.maximumRelationship;
    return customers.map((customer, index) => {
        const ratio = customers.length === 1 ? 0 : index / (customers.length - 1);
        const quantity = 1 + Math.round((maximumQuantity - 1) * ratio);
        return {
            id: `customer:${customer.id}:scenario-${index + 1}`,
            customer,
            quality: qualities[index]!.name,
            quantity,
            priceMultiplier: 0.8 + ratio * 0.4,
            maximumProductionCost: costs[index]! * quantity,
            relationship: maximumRelationship * ratio,
        };
    });
}

function customerQuery(
    definition: CustomerVerificationDefinition,
    configuration: RecipeCorpusConfiguration,
    limit: number
): CustomerCorpusRecommendationQuery {
    return {
        productIds: configuration.productIds,
        requiredEffectIds: configuration.requiredEffectIds,
        forbiddenEffectIds: configuration.forbiddenEffectIds,
        profile: definition.customer,
        state: {
            addiction: definition.customer.baseAddiction,
            relationship: definition.relationship,
            orderLimitMultiplier: 1,
        },
        quality: definition.quality,
        quantity: definition.quantity,
        priceMultiplier: definition.priceMultiplier,
        maximumProductionCost: definition.maximumProductionCost,
        limit,
    };
}

function averageSpend(customer: Customer): number {
    return (customer.weeklySpend.minimum + customer.weeklySpend.maximum) / 2;
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
            isRecipeRankable(recipe.totalCost, objective) &&
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

function comparableRecommendation(recommendation: CustomerRecommendation): unknown {
    return {
        recipe: comparableEvaluation(recommendation.recipe),
        drugTypes: recommendation.drugTypes,
        quality: recommendation.quality,
        quantity: recommendation.quantity,
        askingPrice: recommendation.askingPrice,
        productionCost: recommendation.productionCost,
        grossProfit: recommendation.grossProfit,
        acceptanceChance: recommendation.acceptanceChance,
        expectedRevenue: recommendation.expectedRevenue,
        expectedProfit: recommendation.expectedProfit,
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

function assertSameRecommendations(
    id: string,
    expected: readonly CustomerRecommendation[],
    actual: readonly CustomerRecommendation[]
): void {
    const expectedValues = expected.map(comparableRecommendation);
    const actualValues = actual.map(comparableRecommendation);
    if (JSON.stringify(expectedValues) === JSON.stringify(actualValues)) return;
    const difference = Math.max(expectedValues.length, actualValues.length);
    for (let index = 0; index < difference; index++) {
        if (JSON.stringify(expectedValues[index]) === JSON.stringify(actualValues[index])) continue;
        throw new Error(
            `Customer corpus verification ${id} differs at result ${index + 1}\n` +
            `Expected: ${JSON.stringify(expectedValues[index] ?? null)}\n` +
            `Actual: ${JSON.stringify(actualValues[index] ?? null)}`
        );
    }
    throw new Error(`Customer corpus verification ${id} differs`);
}

function selectEvenly<T>(values: readonly T[], count: number): T[] {
    if (count <= 0) return [];
    if (count >= values.length) return [...values];
    if (count === 1) return [values[Math.floor((values.length - 1) / 2)]!];
    return Array.from({ length: count }, (_, index) =>
        values[Math.round((index * (values.length - 1)) / (count - 1))]!
    );
}
