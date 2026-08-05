import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import {
    CustomerRecipeSearch,
    MixingEngine,
    RecipeSearchLimitError,
    RecipeSearchWorkLimitError,
    ReverseRecipeSearch,
    type CustomerRecipeSearchResult,
    type RecipeSearchEvidence,
    type ReverseRecipeSearchResult,
} from '@neonschedule1/core';

import type { SolverDataset } from '#solver/dataset';
import { identity, type RecipeCorpusDatasetIdentity } from '#solver/precompute';
import type { LoadedRecipeCorpusProduction } from '#solver/precompute-production';
import type {
    NormalizedProductionCustomerRequest,
    NormalizedProductionRecipeRequest,
    ProductionCoverageMiss,
    ProductionCustomerRouteResult,
    ProductionRecipeRouteResult,
} from '#solver/production-router';

export const liveFallbackAlgorithmVersion = '4';

export interface LiveFallbackBudget {
    readonly maxStatesPerProduct: number;
    readonly maxTransitionEvaluationsPerProduct: number;
}

export interface LiveFallbackEvidence extends RecipeSearchEvidence {
    readonly source: 'live';
    readonly elapsedMs: number;
    readonly algorithmVersion: string;
    readonly dataset: RecipeCorpusDatasetIdentity;
    readonly mapProfile: readonly string[];
    readonly coverageKey: string;
    readonly maxStatesPerProduct: number;
    readonly maxTransitionEvaluationsPerProduct: number;
}

type CoverageMissRoute<Request> = {
    readonly kind: 'coverage-miss';
    readonly request: Request;
    readonly miss: ProductionCoverageMiss;
};

export type LiveFallbackResult<Request, Result> =
    | {
        readonly kind: 'completed';
        readonly request: Request;
        readonly miss: ProductionCoverageMiss;
        readonly result: Result;
        readonly evidence: LiveFallbackEvidence;
    }
    | {
        readonly kind: 'state-limit' | 'work-limit';
        readonly request: Request;
        readonly miss: ProductionCoverageMiss;
        readonly result: null;
        readonly evidence: LiveFallbackEvidence;
    };

export type LiveRecipeFallbackResult = LiveFallbackResult<
    NormalizedProductionRecipeRequest,
    ReverseRecipeSearchResult
>;

export type LiveCustomerFallbackResult = LiveFallbackResult<
    NormalizedProductionCustomerRequest,
    CustomerRecipeSearchResult
>;

export class LiveFallbackRunner {
    readonly #dataset: SolverDataset;
    readonly #itemsById: ReadonlyMap<string, SolverDataset['items'][number]>;
    readonly #engine: MixingEngine;
    readonly #productIds: ReadonlySet<string>;
    readonly #ingredientIds: ReadonlySet<string>;
    readonly #effectIds: ReadonlySet<string>;
    readonly #drugTypeByProductId: ReadonlyMap<string, string>;
    readonly #selectionSha256: string;
    readonly #coverageKey: string;

    constructor(dataset: SolverDataset, production: LoadedRecipeCorpusProduction) {
        this.#dataset = dataset;
        this.#itemsById = new Map(dataset.items.map((item) => [item.id, item]));
        this.#engine = new MixingEngine(
            dataset.mixingRules,
            new Map(dataset.effects.map((effect) => [effect.id, effect]))
        );
        const products = dataset.items.filter(
            (item) => item.product !== null && !item.isRuntimeOnly
        );
        this.#productIds = new Set(products.map((item) => item.id));
        this.#ingredientIds = new Set(
            dataset.items
                .filter(
                    (item) => item.mixingIngredient !== null &&
                        item.basePurchasePrice !== null && !item.isRuntimeOnly
                )
                .map((item) => item.id)
        );
        this.#effectIds = new Set(dataset.effects.map((effect) => effect.id));
        this.#drugTypeByProductId = new Map(
            products.map((item) => [item.id, item.product!.drugType])
        );
        this.#selectionSha256 = production.selection.selectionSha256;
        this.#coverageKey = production.selection.corpus.coverageKey;
    }

    recipe(
        route: Extract<ProductionRecipeRouteResult, { readonly kind: 'coverage-miss' }>,
        budget: LiveFallbackBudget
    ): LiveRecipeFallbackResult {
        this.#validateBudget(budget);
        this.#validateMiss(route.miss);
        this.#validateRequest(route.request);
        return this.#run(
            'recipe',
            route,
            budget,
            () => new ReverseRecipeSearch(this.#engine, this.#itemsById, {
                maxStates: budget.maxStatesPerProduct,
                maxTransitionEvaluations: budget.maxTransitionEvaluationsPerProduct,
            }).search(route.request)
        );
    }

    customer(
        route: Extract<ProductionCustomerRouteResult, { readonly kind: 'coverage-miss' }>,
        budget: LiveFallbackBudget
    ): LiveCustomerFallbackResult {
        this.#validateBudget(budget);
        this.#validateMiss(route.miss);
        this.#validateRequest(route.request);
        this.#validateEffects(
            route.request.profile.preferredEffectIds,
            'Customer preferred effect'
        );
        return this.#run(
            'customer',
            route,
            budget,
            () => new CustomerRecipeSearch(
                this.#engine,
                this.#itemsById,
                this.#dataset.customerCatalog,
                {
                    maxStates: budget.maxStatesPerProduct,
                    maxTransitionEvaluations:
                        budget.maxTransitionEvaluationsPerProduct,
                }
            ).search(route.request)
        );
    }

    #run<
        Request extends { readonly productIds: readonly string[] },
        Result extends { readonly evidence: RecipeSearchEvidence },
    >(
        kind: 'recipe' | 'customer',
        route: CoverageMissRoute<Request>,
        budget: LiveFallbackBudget,
        operation: () => Result
    ): LiveFallbackResult<Request, Result> {
        const mapProfile = this.#mapProfile(route.request.productIds);
        const coverageKey = liveCoverageKey(
            kind,
            identity(this.#dataset),
            route.request,
            budget,
            mapProfile
        );
        const startedAt = performance.now();
        try {
            const result = operation();
            return {
                kind: 'completed',
                request: route.request,
                miss: route.miss,
                result,
                evidence: evidence(
                    result.evidence,
                    performance.now() - startedAt,
                    this.#dataset,
                    mapProfile,
                    coverageKey,
                    budget
                ),
            };
        } catch (error) {
            if (!(error instanceof RecipeSearchLimitError) &&
                !(error instanceof RecipeSearchWorkLimitError)) {
                throw error;
            }
            return {
                kind: error instanceof RecipeSearchWorkLimitError
                    ? 'work-limit'
                    : 'state-limit',
                request: route.request,
                miss: route.miss,
                result: null,
                evidence: evidence(
                    error.evidence,
                    performance.now() - startedAt,
                    this.#dataset,
                    mapProfile,
                    coverageKey,
                    budget
                ),
            };
        }
    }

    #validateRequest(request: {
        readonly productIds: readonly string[];
        readonly availableIngredientIds: readonly string[];
        readonly requiredEffectIds: readonly string[];
        readonly forbiddenEffectIds: readonly string[];
    }): void {
        requireKnown(request.productIds, this.#productIds, 'live product');
        requireKnown(
            request.availableIngredientIds,
            this.#ingredientIds,
            'live mixing ingredient'
        );
        this.#validateEffects(request.requiredEffectIds, 'Required effect');
        this.#validateEffects(request.forbiddenEffectIds, 'Forbidden effect');
    }

    #validateEffects(ids: readonly string[], label: string): void {
        requireKnown(ids, this.#effectIds, label);
    }

    #validateBudget(budget: LiveFallbackBudget): void {
        if (!Number.isSafeInteger(budget.maxStatesPerProduct) ||
            budget.maxStatesPerProduct < 1) {
            throw new Error('Live fallback maxStatesPerProduct must be a positive safe integer');
        }
        if (!Number.isSafeInteger(budget.maxTransitionEvaluationsPerProduct) ||
            budget.maxTransitionEvaluationsPerProduct < 1) {
            throw new Error(
                'Live fallback maxTransitionEvaluationsPerProduct must be a positive safe integer'
            );
        }
    }

    #validateMiss(miss: ProductionCoverageMiss): void {
        if (miss.selectionSha256 !== this.#selectionSha256 ||
            miss.coverageKey !== this.#coverageKey) {
            throw new Error('Live fallback coverage miss belongs to another production selection');
        }
    }

    #mapProfile(productIds: readonly string[]): readonly string[] {
        return Object.freeze([
            ...new Set(productIds.map((id) => this.#drugTypeByProductId.get(id)!)),
        ].sort());
    }
}

function evidence(
    search: RecipeSearchEvidence,
    elapsedMs: number,
    dataset: SolverDataset,
    mapProfile: readonly string[],
    coverageKey: string,
    budget: LiveFallbackBudget
): LiveFallbackEvidence {
    return {
        source: 'live',
        ...search,
        elapsedMs,
        algorithmVersion: liveFallbackAlgorithmVersion,
        dataset: identity(dataset),
        mapProfile,
        coverageKey,
        maxStatesPerProduct: budget.maxStatesPerProduct,
        maxTransitionEvaluationsPerProduct:
            budget.maxTransitionEvaluationsPerProduct,
    };
}

function liveCoverageKey(
    kind: 'recipe' | 'customer',
    dataset: RecipeCorpusDatasetIdentity,
    request: unknown,
    budget: LiveFallbackBudget,
    mapProfile: readonly string[]
): string {
    return createHash('sha256').update(JSON.stringify({
        algorithmVersion: liveFallbackAlgorithmVersion,
        kind,
        dataset,
        mapProfile,
        request,
        budget,
    })).digest('hex');
}

function requireKnown(
    ids: readonly string[],
    known: ReadonlySet<string>,
    label: string
): void {
    const unknown = ids.find((id) => !known.has(id));
    if (unknown !== undefined) throw new Error(`Unknown ${label} ${JSON.stringify(unknown)}`);
}
