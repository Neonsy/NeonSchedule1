import { performance } from 'node:perf_hooks';

import {
    CustomerRecipeSearch,
    RecipeSearch,
    RecipeSearchLimitError,
    RecipeSearchWorkLimitError,
    type CustomerCatalog,
    type CustomerOfferState,
    type Item,
    type MixingEngine,
} from '@neonschedule1/core';

import type {
    BenchmarkDefinition,
    SearchBenchmarkOptions,
    SearchBenchmarkSample,
} from '#solver/benchmark';

export function benchmarkOperation(
    engine: MixingEngine,
    itemsById: ReadonlyMap<string, Item>,
    catalog: Pick<CustomerCatalog, 'constants' | 'qualityTiers'>,
    definition: BenchmarkDefinition,
    productIds: readonly string[],
    ingredientIds: readonly string[],
    options: SearchBenchmarkOptions
): () => SearchBenchmarkSample {
    const searchOptions = {
        maxStates: options.maxStates,
        ...(definition.maxTransitionEvaluations === undefined
            ? {}
            : { maxTransitionEvaluations: definition.maxTransitionEvaluations }),
    };
    if (definition.kind === 'recipe') {
        const search = new RecipeSearch(engine, itemsById, searchOptions);
        return () => measure(() => {
            const result = search.search({
                productId: definition.productId,
                availableIngredientIds: ingredientIds,
                maxIngredients: definition.depth,
                limit: options.limit,
                objective: definition.objective,
                ...(definition.maximumTotalCost === undefined
                    ? {}
                    : { maximumTotalCost: definition.maximumTotalCost }),
            });
            return { resultCount: result.recipes.length, evidence: result.evidence };
        });
    }

    const search = new CustomerRecipeSearch(engine, itemsById, catalog, searchOptions);
    const selectedProductIds = definition.productId === undefined
        ? productIds
        : [definition.productId];
    return () => measure(() => {
        const result = search.search({
            productIds: selectedProductIds,
            availableIngredientIds: ingredientIds,
            maxIngredients: definition.depth,
            profile: definition.customer,
            state: benchmarkCustomerState(
                definition.customerState,
                definition.customer.baseAddiction,
                catalog.constants.maximumRelationship
            ),
            quality: options.quality,
            quantity: options.quantity,
            priceMultiplier: options.priceMultiplier,
            maximumProductionCost: options.maximumProductionCost,
            limit: options.limit,
        });
        return {
            resultCount: result.recommendations.length,
            evidence: result.evidence,
        };
    });
}

function measure(
    operation: () => {
        readonly resultCount: number;
        readonly evidence: SearchBenchmarkSample['evidence'];
    }
): SearchBenchmarkSample {
    const startedAt = performance.now();
    try {
        const result = operation();
        return {
            durationMs: milliseconds(performance.now() - startedAt),
            status: 'completed',
            resultCount: result.resultCount,
            evidence: result.evidence,
        };
    } catch (error) {
        if (!(error instanceof RecipeSearchLimitError) &&
            !(error instanceof RecipeSearchWorkLimitError)) {
            throw error;
        }
        return {
            durationMs: milliseconds(performance.now() - startedAt),
            status: error instanceof RecipeSearchWorkLimitError
                ? 'work-limit'
                : 'state-limit',
            resultCount: 0,
            evidence: error.evidence,
        };
    }
}

function benchmarkCustomerState(
    name: Extract<BenchmarkDefinition, { readonly kind: 'customer' }>['customerState'],
    baseAddiction: number,
    maximumRelationship: number
): CustomerOfferState {
    switch (name) {
        case 'baseline':
            return { addiction: baseAddiction, relationship: 0, orderLimitMultiplier: 1 };
        case 'maximum-addiction':
            return { addiction: 1, relationship: 0, orderLimitMultiplier: 1 };
        case 'maximum-relationship':
            return {
                addiction: baseAddiction,
                relationship: maximumRelationship,
                orderLimitMultiplier: 1,
            };
    }
}

function milliseconds(value: number): number {
    return Math.round(value * 10) / 10;
}
