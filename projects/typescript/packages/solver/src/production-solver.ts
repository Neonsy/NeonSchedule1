import type {
    CustomerRecipeSearchInput,
    CustomerRecipeSearchResult,
    ReverseRecipeSearchResult,
} from '@neonschedule1/core';

import {
    type LiveFallbackEvidence,
    type LiveFallbackRunner,
} from '#solver/live-fallback';
import type { CustomerCorpusRecommendationResult } from '#solver/precompute-customer';
import type { RecipeCorpusQueryResult } from '#solver/precompute-query';
import {
    type NormalizedProductionCustomerRequest,
    type NormalizedProductionRecipeRequest,
    type ProductionCoverageMiss,
    type ProductionCustomerRouteResult,
    type ProductionRecipeRequest,
    type ProductionRecipeRouteResult,
    type ProductionRequestRouter,
    type ProductionRouteResult,
} from '#solver/production-router';
import type { LiveSearchMode, SolverSearchMode } from '#solver/search-policy';

type ProductionRouter = Pick<ProductionRequestRouter, 'recipe' | 'customer'>;
type LiveFallback = Pick<LiveFallbackRunner, 'recipeForMode' | 'customerForMode'>;

type PrecomputedExactResponse<
    Mode extends SolverSearchMode,
    Request,
    Result extends { readonly evidence: unknown },
> = {
    readonly kind: 'precomputed-exact';
    readonly mode: Mode;
    readonly request: Request;
    readonly result: Result;
    readonly evidence: Result['evidence'];
};

type LiveExactResponse<Request, Result> = {
    readonly kind: 'live-exact';
    readonly mode: LiveSearchMode;
    readonly request: Request;
    readonly miss: ProductionCoverageMiss;
    readonly result: Result;
    readonly evidence: LiveFallbackEvidence;
};

type LiveIncompleteResponse<Request, Result> = {
    readonly kind: 'live-incomplete';
    readonly mode: LiveSearchMode;
    readonly stopReason: 'state-limit' | 'work-limit' | 'time-limit';
    readonly request: Request;
    readonly miss: ProductionCoverageMiss;
    readonly result: Result;
    readonly evidence: LiveFallbackEvidence;
};

type ExhaustiveCoverageMissResponse<Request> = {
    readonly kind: 'coverage-miss';
    readonly mode: 'exhaustive';
    readonly request: Request;
    readonly miss: ProductionCoverageMiss;
    readonly result: null;
};

export type ProductionSolverResponse<
    Mode extends SolverSearchMode,
    Request,
    PrecomputedResult extends { readonly evidence: unknown },
    LiveResult,
> =
    | PrecomputedExactResponse<Mode, Request, PrecomputedResult>
    | LiveExactResponse<Request, LiveResult>
    | LiveIncompleteResponse<Request, LiveResult>
    | ExhaustiveCoverageMissResponse<Request>;

export type ProductionRecipeResponse = ProductionSolverResponse<
    SolverSearchMode,
    NormalizedProductionRecipeRequest,
    RecipeCorpusQueryResult,
    ReverseRecipeSearchResult
>;

export type ProductionCustomerResponse = ProductionSolverResponse<
    SolverSearchMode,
    NormalizedProductionCustomerRequest,
    CustomerCorpusRecommendationResult,
    CustomerRecipeSearchResult
>;

export class ProductionSolver {
    readonly #router: ProductionRouter;
    readonly #fallback: LiveFallback;

    constructor(router: ProductionRouter, fallback: LiveFallback) {
        this.#router = router;
        this.#fallback = fallback;
    }

    async recipe(
        input: ProductionRecipeRequest,
        mode: SolverSearchMode
    ): Promise<ProductionRecipeResponse> {
        requireSolverMode(mode);
        const route = await this.#router.recipe(input);
        return solve(
            route,
            mode,
            (miss, liveMode) => this.#fallback.recipeForMode(miss, liveMode)
        );
    }

    async customer(
        input: CustomerRecipeSearchInput,
        mode: SolverSearchMode
    ): Promise<ProductionCustomerResponse> {
        requireSolverMode(mode);
        const route = await this.#router.customer(input);
        return solve(
            route,
            mode,
            (miss, liveMode) => this.#fallback.customerForMode(miss, liveMode)
        );
    }
}

function solve<
    Request,
    PrecomputedResult extends { readonly evidence: unknown },
    LiveResult,
>(
    route: ProductionRouteResult<Request, PrecomputedResult>,
    mode: SolverSearchMode,
    fallback: (
        route: Extract<ProductionRouteResult<Request, PrecomputedResult>, {
            readonly kind: 'coverage-miss';
        }>,
        mode: LiveSearchMode
    ) => LiveFallbackResult<Request, LiveResult>
): ProductionSolverResponse<SolverSearchMode, Request, PrecomputedResult, LiveResult> {
    if (route.kind === 'exact') {
        return {
            kind: 'precomputed-exact',
            mode,
            request: route.request,
            result: route.result,
            evidence: route.result.evidence,
        };
    }
    if (mode === 'exhaustive') {
        return {
            kind: 'coverage-miss',
            mode,
            request: route.request,
            miss: route.miss,
            result: null,
        };
    }
    const result = fallback(route, mode);
    if (result.kind === 'completed') {
        return {
            kind: 'live-exact',
            mode,
            request: result.request,
            miss: result.miss,
            result: result.result,
            evidence: result.evidence,
        };
    }
    return {
        kind: 'live-incomplete',
        mode,
        stopReason: result.kind,
        request: result.request,
        miss: result.miss,
        result: result.result,
        evidence: result.evidence,
    };
}

type LiveFallbackResult<Request, Result> = {
    readonly kind: 'completed' | 'state-limit' | 'work-limit' | 'time-limit';
    readonly request: Request;
    readonly miss: ProductionCoverageMiss;
    readonly result: Result;
    readonly evidence: LiveFallbackEvidence;
};

function requireSolverMode(mode: SolverSearchMode): void {
    if (mode !== 'quick' && mode !== 'balanced' && mode !== 'precise' &&
        mode !== 'exhaustive') {
        throw new Error(`Unknown solver search mode: ${String(mode)}`);
    }
}
