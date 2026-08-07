import type {
    CustomerRecipeSearchInput,
    CustomerRecipeSearchResult,
    ReverseRecipeSearchResult,
} from '@neonschedule1/core';
import { describe, expect, it, vi } from 'vitest';

import type { LiveFallbackEvidence } from '#solver/live-fallback';
import type { RecipeCorpusQueryResult } from '#solver/precompute-query';
import {
    type NormalizedProductionCustomerRequest,
    type NormalizedProductionRecipeRequest,
    type ProductionCoverageMiss,
    type ProductionCustomerRouteResult,
    type ProductionRecipeRequest,
    type ProductionRecipeRouteResult,
} from '#solver/production-router';
import { ProductionSolver } from '#solver/production-solver';

const recipeInput = {} as ProductionRecipeRequest;
const customerInput = {} as CustomerRecipeSearchInput;
const recipeRequest = { normalized: 'recipe' } as unknown as
    NormalizedProductionRecipeRequest;
const customerRequest = { normalized: 'customer' } as unknown as
    NormalizedProductionCustomerRequest;
const precomputedRecipeResult: RecipeCorpusQueryResult = {
    recipes: [],
    evidence: {
        source: 'precomputed',
        proofStatus: 'exact',
        corpusArtifactSha256: 'c'.repeat(64),
        indexArtifactSha256: 'd'.repeat(64),
        coverageKey: 'coverage',
        candidateCount: 0,
        examinedRankingEntries: 0,
    },
};
const liveRecipeResult = { result: 'live' } as unknown as ReverseRecipeSearchResult;
const liveCustomerResult = { result: 'live' } as unknown as CustomerRecipeSearchResult;

const miss: ProductionCoverageMiss = {
    source: 'production-corpus',
    selectionSha256: 'a'.repeat(64),
    coverageKey: 'coverage',
    issues: [{
        field: 'maxIngredients',
        reason: 'different-value',
        requested: 3,
        covered: 5,
    }],
};

const exactLiveEvidence: LiveFallbackEvidence = {
    source: 'live',
    mode: 'quick',
    proofStatus: 'exact',
    stopReason: 'completed',
    exploredStates: 10,
    prunedStates: 2,
    completedDepth: 3,
    elapsedMs: 5,
    algorithmVersion: '6',
    dataset: {
        gameVersion: 'test',
        datasetSha256: 'b'.repeat(64),
        normalizerVersion: 'test',
    },
    mapProfile: ['map'],
    coverageKey: 'live-coverage',
    maxStatesPerProduct: 100_000,
    maxTransitionEvaluationsPerProduct: 20_560,
    maxDurationMsPerProduct: 100,
};

describe('production solver', () => {
    it('rejects an unknown mode before routing', async () => {
        const route = vi.fn(async () => unreachable());
        const solver = new ProductionSolver(
            {
                recipe: route,
                customer: route,
            },
            {
                recipeForMode: () => unreachable(),
                customerForMode: () => unreachable(),
            }
        );

        await expect(
            solver.recipe(recipeInput, 'unknown' as 'quick')
        ).rejects.toThrow('Unknown solver search mode: unknown');
        expect(route).not.toHaveBeenCalled();
    });

    it('returns an exact corpus result without invoking live fallback', async () => {
        const fallback = vi.fn(() => {
            throw new Error('live fallback must not run');
        });
        const route: ProductionRecipeRouteResult = {
            kind: 'exact',
            request: recipeRequest,
            result: precomputedRecipeResult,
        };
        const solver = new ProductionSolver(
            {
                recipe: vi.fn(async () => route),
                customer: async () => unreachable(),
            },
            {
                recipeForMode: fallback,
                customerForMode: () => unreachable(),
            }
        );

        await expect(solver.recipe(recipeInput, 'precise')).resolves.toEqual({
            kind: 'precomputed-exact',
            mode: 'precise',
            request: recipeRequest,
            result: precomputedRecipeResult,
            evidence: precomputedRecipeResult.evidence,
        });
        expect(fallback).not.toHaveBeenCalled();
    });

    it('reports an exhaustive corpus miss without running bounded live search', async () => {
        const fallback = vi.fn(() => {
            throw new Error('live fallback must not run');
        });
        const route: ProductionRecipeRouteResult = {
            kind: 'coverage-miss',
            request: recipeRequest,
            miss,
        };
        const solver = new ProductionSolver(
            {
                recipe: async () => route,
                customer: async () => unreachable(),
            },
            {
                recipeForMode: fallback,
                customerForMode: () => unreachable(),
            }
        );

        await expect(solver.recipe(recipeInput, 'exhaustive')).resolves.toEqual({
            kind: 'coverage-miss',
            mode: 'exhaustive',
            request: recipeRequest,
            miss,
            result: null,
        });
        expect(fallback).not.toHaveBeenCalled();
    });

    it('returns an exact live result using only the requested mode', async () => {
        const route: ProductionRecipeRouteResult = {
            kind: 'coverage-miss',
            request: recipeRequest,
            miss,
        };
        const fallback = vi.fn(() => ({
            kind: 'completed' as const,
            request: recipeRequest,
            miss,
            result: liveRecipeResult,
            evidence: exactLiveEvidence,
        }));
        const solver = new ProductionSolver(
            {
                recipe: async () => route,
                customer: async () => unreachable(),
            },
            {
                recipeForMode: fallback,
                customerForMode: () => unreachable(),
            }
        );

        const response = await solver.recipe(recipeInput, 'quick');

        expect(response).toEqual({
            kind: 'live-exact',
            mode: 'quick',
            request: recipeRequest,
            miss,
            result: liveRecipeResult,
            evidence: exactLiveEvidence,
        });
        expect(fallback).toHaveBeenCalledOnce();
        expect(fallback).toHaveBeenCalledWith(route, 'quick');
    });

    it('returns a customer best-found result with its live stop reason', async () => {
        const route: ProductionCustomerRouteResult = {
            kind: 'coverage-miss',
            request: customerRequest,
            miss,
        };
        const incompleteEvidence: LiveFallbackEvidence = {
            ...exactLiveEvidence,
            mode: 'balanced',
            proofStatus: 'incomplete',
            stopReason: 'time-limit',
            completedDepth: 2,
        };
        const fallback = vi.fn(() => ({
            kind: 'time-limit' as const,
            request: customerRequest,
            miss,
            result: liveCustomerResult,
            evidence: incompleteEvidence,
        }));
        const solver = new ProductionSolver(
            {
                recipe: async () => unreachable(),
                customer: async () => route,
            },
            {
                recipeForMode: () => unreachable(),
                customerForMode: fallback,
            }
        );

        const response = await solver.customer(customerInput, 'balanced');

        expect(response).toEqual({
            kind: 'live-incomplete',
            mode: 'balanced',
            stopReason: 'time-limit',
            request: customerRequest,
            miss,
            result: liveCustomerResult,
            evidence: incompleteEvidence,
        });
        expect(fallback).toHaveBeenCalledOnce();
        expect(fallback).toHaveBeenCalledWith(route, 'balanced');
    });
});

function unreachable(): never {
    throw new Error('Unexpected test call');
}
