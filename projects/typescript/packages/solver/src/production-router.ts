import type {
    CustomerRecipeSearchInput,
    RecipeSearchObjective,
    ReverseRecipeSearchInput,
} from '@neonschedule1/core';

import type {
    CustomerCorpusRecommendationResult,
} from '#solver/precompute-customer';
import type { LoadedRecipeCorpusProduction } from '#solver/precompute-production';
import type { RecipeCorpusQueryResult } from '#solver/precompute-query';

export type ProductionRecipeRequest = ReverseRecipeSearchInput;

export interface NormalizedProductionRecipeRequest {
    readonly productIds: readonly string[];
    readonly availableIngredientIds: readonly string[];
    readonly maxIngredients: number;
    readonly limit: number;
    readonly requiredEffectIds: readonly string[];
    readonly forbiddenEffectIds: readonly string[];
    readonly objective: RecipeSearchObjective;
    readonly maximumTotalCost?: number;
}

export interface NormalizedProductionCustomerRequest
    extends Omit<
        CustomerRecipeSearchInput,
        | 'productIds'
        | 'availableIngredientIds'
        | 'requiredEffectIds'
        | 'forbiddenEffectIds'
    > {
    readonly productIds: readonly string[];
    readonly availableIngredientIds: readonly string[];
    readonly requiredEffectIds: readonly string[];
    readonly forbiddenEffectIds: readonly string[];
}

export type ProductionCoverageIssue =
    | {
        readonly field: 'productIds';
        readonly reason: 'outside-coverage';
        readonly unsupportedIds: readonly string[];
    }
    | {
        readonly field: 'availableIngredientIds';
        readonly reason: 'different-set';
        readonly requestedIds: readonly string[];
        readonly coveredIds: readonly string[];
    }
    | {
        readonly field: 'maxIngredients';
        readonly reason: 'different-value';
        readonly requested: number;
        readonly covered: number;
    };

export interface ProductionCoverageMiss {
    readonly source: 'production-corpus';
    readonly selectionSha256: string;
    readonly coverageKey: string;
    readonly issues: readonly ProductionCoverageIssue[];
}

export type ProductionRouteResult<Request, Result> =
    | {
        readonly kind: 'exact';
        readonly request: Request;
        readonly result: Result;
    }
    | {
        readonly kind: 'coverage-miss';
        readonly request: Request;
        readonly miss: ProductionCoverageMiss;
    };

export type ProductionRecipeRouteResult = ProductionRouteResult<
    NormalizedProductionRecipeRequest,
    RecipeCorpusQueryResult
>;

export type ProductionCustomerRouteResult = ProductionRouteResult<
    NormalizedProductionCustomerRequest,
    CustomerCorpusRecommendationResult
>;

export class ProductionRequestRouter {
    readonly #production: LoadedRecipeCorpusProduction;
    readonly #productIds: readonly string[];
    readonly #ingredientIds: readonly string[];

    constructor(production: LoadedRecipeCorpusProduction) {
        this.#production = production;
        this.#productIds = canonicalIds(
            production.selection.configuration.productIds,
            'production productIds',
            false
        );
        this.#ingredientIds = canonicalIds(
            production.selection.configuration.ingredientIds,
            'production ingredientIds',
            false
        );
    }

    async recipe(input: ProductionRecipeRequest): Promise<ProductionRecipeRouteResult> {
        const request = normalizeRecipeRequest(input, this.#productIds);
        const miss = this.#coverageMiss(request);
        if (miss !== null) return { kind: 'coverage-miss', request, miss };
        const {
            availableIngredientIds: _availableIngredientIds,
            maxIngredients: _maxIngredients,
            ...query
        } = request;
        return {
            kind: 'exact',
            request,
            result: await this.#production.recipes.query(query),
        };
    }

    async customer(
        input: CustomerRecipeSearchInput
    ): Promise<ProductionCustomerRouteResult> {
        const request = normalizeCustomerRequest(input);
        const miss = this.#coverageMiss(request);
        if (miss !== null) return { kind: 'coverage-miss', request, miss };
        const {
            availableIngredientIds: _availableIngredientIds,
            maxIngredients: _maxIngredients,
            ...query
        } = request;
        return {
            kind: 'exact',
            request,
            result: await this.#production.customers.recommend(query),
        };
    }

    #coverageMiss(request: {
        readonly productIds: readonly string[];
        readonly availableIngredientIds: readonly string[];
        readonly maxIngredients: number;
    }): ProductionCoverageMiss | null {
        const issues: ProductionCoverageIssue[] = [];
        const products = new Set(this.#productIds);
        const unsupportedIds = request.productIds.filter((id) => !products.has(id));
        if (unsupportedIds.length > 0) {
            issues.push({
                field: 'productIds',
                reason: 'outside-coverage',
                unsupportedIds,
            });
        }
        if (!sameStrings(request.availableIngredientIds, this.#ingredientIds)) {
            issues.push({
                field: 'availableIngredientIds',
                reason: 'different-set',
                requestedIds: request.availableIngredientIds,
                coveredIds: this.#ingredientIds,
            });
        }
        const coveredDepth = this.#production.selection.configuration.maxIngredients;
        if (request.maxIngredients !== coveredDepth) {
            issues.push({
                field: 'maxIngredients',
                reason: 'different-value',
                requested: request.maxIngredients,
                covered: coveredDepth,
            });
        }
        if (issues.length === 0) return null;
        return {
            source: 'production-corpus',
            selectionSha256: this.#production.selection.selectionSha256,
            coverageKey: this.#production.selection.corpus.coverageKey,
            issues,
        };
    }
}

function normalizeRecipeRequest(
    input: ProductionRecipeRequest,
    defaultProductIds: readonly string[]
): NormalizedProductionRecipeRequest {
    const effects = effectConstraints(input.requiredEffectIds, input.forbiddenEffectIds);
    requireNonNegativeSafeInteger(input.maxIngredients, 'Recipe maxIngredients');
    requirePositiveSafeInteger(input.limit, 'Recipe limit');
    if (input.maximumTotalCost !== undefined) {
        requireNonNegativeFinite(input.maximumTotalCost, 'Recipe maximumTotalCost');
    }
    if (input.objective !== undefined &&
        input.objective !== 'productValue' && input.objective !== 'netValue') {
        throw new Error(`Unknown recipe objective ${JSON.stringify(input.objective)}`);
    }
    return {
        productIds: input.productIds === undefined
            ? defaultProductIds
            : canonicalIds(input.productIds, 'Recipe productIds', false),
        availableIngredientIds: canonicalIds(
            input.availableIngredientIds,
            'Recipe availableIngredientIds',
            true
        ),
        maxIngredients: input.maxIngredients,
        limit: input.limit,
        requiredEffectIds: effects.required,
        forbiddenEffectIds: effects.forbidden,
        objective: input.objective ?? 'productValue',
        ...(input.maximumTotalCost === undefined
            ? {}
            : { maximumTotalCost: input.maximumTotalCost }),
    };
}

function normalizeCustomerRequest(
    input: CustomerRecipeSearchInput
): NormalizedProductionCustomerRequest {
    const effects = effectConstraints(input.requiredEffectIds, input.forbiddenEffectIds);
    requireNonNegativeSafeInteger(input.maxIngredients, 'Customer maxIngredients');
    return {
        productIds: canonicalIds(input.productIds, 'Customer productIds', false),
        availableIngredientIds: canonicalIds(
            input.availableIngredientIds,
            'Customer availableIngredientIds',
            true
        ),
        maxIngredients: input.maxIngredients,
        requiredEffectIds: effects.required,
        forbiddenEffectIds: effects.forbidden,
        profile: input.profile,
        state: input.state,
        quality: input.quality,
        quantity: input.quantity,
        priceMultiplier: input.priceMultiplier,
        maximumProductionCost: input.maximumProductionCost,
        limit: input.limit,
    };
}

function effectConstraints(
    required: readonly string[] | undefined,
    forbidden: readonly string[] | undefined
): { readonly required: readonly string[]; readonly forbidden: readonly string[] } {
    const requiredIds = canonicalIds(required ?? [], 'requiredEffectIds', true);
    const forbiddenIds = canonicalIds(forbidden ?? [], 'forbiddenEffectIds', true);
    const forbiddenSet = new Set(forbiddenIds);
    const contradictory = requiredIds.find((id) => forbiddenSet.has(id));
    if (contradictory !== undefined) {
        throw new Error(`Effect ${JSON.stringify(contradictory)} cannot be required and forbidden`);
    }
    return { required: requiredIds, forbidden: forbiddenIds };
}

function canonicalIds(
    values: readonly string[],
    label: string,
    allowEmpty: boolean
): readonly string[] {
    const result = [...new Set(values)].sort();
    if (!allowEmpty && result.length === 0) throw new Error(`${label} cannot be empty`);
    for (const value of result) {
        if (typeof value !== 'string' || value.length === 0) {
            throw new Error(`${label} must contain non-empty strings`);
        }
    }
    return Object.freeze(result);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${label} must be a non-negative safe integer`);
    }
}

function requirePositiveSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${label} must be a positive safe integer`);
    }
}

function requireNonNegativeFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${label} must be a non-negative finite number`);
    }
}
