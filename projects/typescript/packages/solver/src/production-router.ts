import type {
    CustomerRecipeSearchInput,
    MixingRuleProfile,
    RecipeSearchObjective,
    ReverseRecipeSearchInput,
} from '@neonschedule1/core';
import {
    normalizeMixingRuleProfile,
    sameMixingRuleProfile,
} from '@neonschedule1/core';

import type {
    CustomerCorpusRecommendationResult,
} from '#solver/precompute-customer';
import type { LoadedRecipeCorpusProduction } from '#solver/precompute-production';
import type { RecipeCorpusQueryResult } from '#solver/precompute-query';

export type ProductionRecipeRequest = ReverseRecipeSearchInput;

export interface NormalizedProductionRecipeRequest {
    readonly ruleProfile: MixingRuleProfile;
    readonly productIds: readonly string[];
    readonly availableIngredientIds: readonly string[];
    readonly maxIngredients: number;
    readonly limit: number;
    readonly requiredEffectIds: readonly string[];
    readonly forbiddenEffectIds: readonly string[];
    readonly requiredIngredientIds: readonly string[];
    readonly forbiddenIngredientIds: readonly string[];
    readonly minimumIngredientCount?: number;
    readonly exactIngredientCount?: number;
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
        | 'requiredIngredientIds'
        | 'forbiddenIngredientIds'
        | 'minimumIngredientCount'
        | 'exactIngredientCount'
        | 'ruleProfile'
    > {
    readonly ruleProfile: MixingRuleProfile;
    readonly productIds: readonly string[];
    readonly availableIngredientIds: readonly string[];
    readonly requiredEffectIds: readonly string[];
    readonly forbiddenEffectIds: readonly string[];
    readonly requiredIngredientIds: readonly string[];
    readonly forbiddenIngredientIds: readonly string[];
    readonly minimumIngredientCount?: number;
    readonly exactIngredientCount?: number;
}

export type ProductionCoverageIssue =
    | {
        readonly field: 'ruleProfile';
        readonly reason: 'different-value';
        readonly requested: MixingRuleProfile;
        readonly covered: MixingRuleProfile;
    }
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
    readonly #ruleProfile: MixingRuleProfile;

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
        this.#ruleProfile = production.selection.configuration.ruleProfile;
    }

    async recipe(input: ProductionRecipeRequest): Promise<ProductionRecipeRouteResult> {
        const request = normalizeRecipeRequest(input, this.#productIds, this.#ruleProfile);
        const miss = this.#coverageMiss(request);
        if (miss !== null) return { kind: 'coverage-miss', request, miss };
        const {
            productIds,
            ruleProfile: _ruleProfile,
            availableIngredientIds: _availableIngredientIds,
            maxIngredients: _maxIngredients,
            ...query
        } = request;
        return {
            kind: 'exact',
            request,
            result: await this.#production.recipes.query({
                ...query,
                ...(sameStrings(productIds, this.#productIds) ? {} : { productIds }),
            }),
        };
    }

    async customer(
        input: CustomerRecipeSearchInput
    ): Promise<ProductionCustomerRouteResult> {
        const request = normalizeCustomerRequest(input, this.#ruleProfile);
        const miss = this.#coverageMiss(request);
        if (miss !== null) return { kind: 'coverage-miss', request, miss };
        const {
            productIds,
            ruleProfile: _ruleProfile,
            availableIngredientIds: _availableIngredientIds,
            maxIngredients: _maxIngredients,
            ...query
        } = request;
        return {
            kind: 'exact',
            request,
            result: await this.#production.customers.recommend({
                ...query,
                ...(sameStrings(productIds, this.#productIds) ? {} : { productIds }),
            }),
        };
    }

    #coverageMiss(request: {
        readonly ruleProfile: MixingRuleProfile;
        readonly productIds: readonly string[];
        readonly availableIngredientIds: readonly string[];
        readonly maxIngredients: number;
    }): ProductionCoverageMiss | null {
        const issues: ProductionCoverageIssue[] = [];
        if (!sameMixingRuleProfile(request.ruleProfile, this.#ruleProfile)) {
            issues.push({
                field: 'ruleProfile',
                reason: 'different-value',
                requested: request.ruleProfile,
                covered: this.#ruleProfile,
            });
        }
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
    defaultProductIds: readonly string[],
    defaultRuleProfile: MixingRuleProfile
): NormalizedProductionRecipeRequest {
    const effects = effectConstraints(input.requiredEffectIds, input.forbiddenEffectIds);
    requireNonNegativeSafeInteger(input.maxIngredients, 'Recipe maxIngredients');
    const availableIngredientIds = canonicalIds(
        input.availableIngredientIds,
        'Recipe availableIngredientIds',
        true
    );
    const ingredients = ingredientConstraints(input, availableIngredientIds, input.maxIngredients);
    requirePositiveSafeInteger(input.limit, 'Recipe limit');
    if (input.maximumTotalCost !== undefined) {
        requireNonNegativeFinite(input.maximumTotalCost, 'Recipe maximumTotalCost');
    }
    if (input.objective !== undefined &&
        input.objective !== 'productValue' && input.objective !== 'netValue') {
        throw new Error(`Unknown recipe objective ${JSON.stringify(input.objective)}`);
    }
    return {
        ruleProfile: normalizeMixingRuleProfile(input.ruleProfile ?? defaultRuleProfile),
        productIds: input.productIds === undefined
            ? defaultProductIds
            : canonicalIds(input.productIds, 'Recipe productIds', false),
        availableIngredientIds,
        maxIngredients: input.maxIngredients,
        limit: input.limit,
        requiredEffectIds: effects.required,
        forbiddenEffectIds: effects.forbidden,
        requiredIngredientIds: ingredients.required,
        forbiddenIngredientIds: ingredients.forbidden,
        ...ingredients.counts,
        objective: input.objective ?? 'productValue',
        ...(input.maximumTotalCost === undefined
            ? {}
            : { maximumTotalCost: input.maximumTotalCost }),
    };
}

function normalizeCustomerRequest(
    input: CustomerRecipeSearchInput,
    defaultRuleProfile: MixingRuleProfile
): NormalizedProductionCustomerRequest {
    const effects = effectConstraints(input.requiredEffectIds, input.forbiddenEffectIds);
    requireNonNegativeSafeInteger(input.maxIngredients, 'Customer maxIngredients');
    const availableIngredientIds = canonicalIds(
        input.availableIngredientIds,
        'Customer availableIngredientIds',
        true
    );
    const ingredients = ingredientConstraints(input, availableIngredientIds, input.maxIngredients);
    return {
        ruleProfile: normalizeMixingRuleProfile(input.ruleProfile ?? defaultRuleProfile),
        productIds: canonicalIds(input.productIds, 'Customer productIds', false),
        availableIngredientIds,
        maxIngredients: input.maxIngredients,
        requiredEffectIds: effects.required,
        forbiddenEffectIds: effects.forbidden,
        requiredIngredientIds: ingredients.required,
        forbiddenIngredientIds: ingredients.forbidden,
        ...ingredients.counts,
        profile: input.profile,
        state: input.state,
        quality: input.quality,
        quantity: input.quantity,
        priceMultiplier: input.priceMultiplier,
        maximumProductionCost: input.maximumProductionCost,
        limit: input.limit,
    };
}

function ingredientConstraints(
    input: {
        readonly requiredIngredientIds?: readonly string[];
        readonly forbiddenIngredientIds?: readonly string[];
        readonly minimumIngredientCount?: number;
        readonly exactIngredientCount?: number;
    },
    availableIngredientIds: readonly string[],
    maxIngredients: number
): {
    readonly required: readonly string[];
    readonly forbidden: readonly string[];
    readonly counts: {
        readonly minimumIngredientCount?: number;
        readonly exactIngredientCount?: number;
    };
} {
    const required = strictCanonicalIds(
        input.requiredIngredientIds ?? [],
        'requiredIngredientIds'
    );
    const forbidden = strictCanonicalIds(
        input.forbiddenIngredientIds ?? [],
        'forbiddenIngredientIds'
    );
    const forbiddenSet = new Set(forbidden);
    const contradictory = required.find((id) => forbiddenSet.has(id));
    if (contradictory !== undefined) {
        throw new Error(
            `Ingredient ${JSON.stringify(contradictory)} cannot be required and forbidden`
        );
    }
    const available = new Set(availableIngredientIds);
    const unavailable = required.find((id) => !available.has(id));
    if (unavailable !== undefined) {
        throw new Error(
            `Required mixing ingredient ${JSON.stringify(unavailable)} is not available`
        );
    }
    const minimum = input.minimumIngredientCount;
    const exact = input.exactIngredientCount;
    if (minimum !== undefined) {
        requireNonNegativeSafeInteger(minimum, 'minimumIngredientCount');
        if (minimum > maxIngredients) {
            throw new Error('minimumIngredientCount cannot exceed maxIngredients');
        }
    }
    if (exact !== undefined) {
        requireNonNegativeSafeInteger(exact, 'exactIngredientCount');
        if (exact > maxIngredients) {
            throw new Error('exactIngredientCount cannot exceed maxIngredients');
        }
        if (minimum !== undefined && minimum > exact) {
            throw new Error('minimumIngredientCount cannot exceed exactIngredientCount');
        }
    }
    if (required.length > (exact ?? maxIngredients)) {
        throw new Error(
            'Required mixing ingredient count exceeds the final ingredient-count limit'
        );
    }
    return {
        required,
        forbidden,
        counts: {
            ...(minimum === undefined ? {} : { minimumIngredientCount: minimum }),
            ...(exact === undefined ? {} : { exactIngredientCount: exact }),
        },
    };
}

function strictCanonicalIds(values: readonly string[], label: string): readonly string[] {
    if (!Array.isArray(values)) throw new Error(`${label} must be an array`);
    const seen = new Set<string>();
    for (const value of values) {
        if (typeof value !== 'string' || value.length === 0) {
            throw new Error(`${label} must contain non-empty strings`);
        }
        if (seen.has(value)) throw new Error(`Duplicate ${label} ${JSON.stringify(value)}`);
        seen.add(value);
    }
    return Object.freeze([...seen].sort());
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
