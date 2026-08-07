export const liveSearchPolicyVersion = '1';

export type LiveSearchMode = 'quick' | 'balanced' | 'precise';
export type SolverSearchMode = LiveSearchMode | 'exhaustive';

export interface LiveFallbackBudget {
    readonly maxStatesPerProduct: number;
    readonly maxTransitionEvaluationsPerProduct: number;
}

export interface AdvisorySearchDuration {
    readonly minimumMs: number;
    readonly maximumMs: number;
    readonly scope: 'per-product-search';
}

export interface LiveSearchPolicy {
    readonly version: typeof liveSearchPolicyVersion;
    readonly mode: LiveSearchMode;
    readonly maximumIngredients: number;
    readonly budget: LiveFallbackBudget;
    readonly advisoryDuration: AdvisorySearchDuration;
}

function definePolicy(
    mode: LiveSearchMode,
    maximumIngredients: number,
    maxTransitionEvaluationsPerProduct: number,
    minimumMs: number,
    maximumMs: number
): LiveSearchPolicy {
    return Object.freeze({
        version: liveSearchPolicyVersion,
        mode,
        maximumIngredients,
        budget: Object.freeze({
            maxStatesPerProduct: 100_000,
            maxTransitionEvaluationsPerProduct,
        }),
        advisoryDuration: Object.freeze({
            minimumMs,
            maximumMs,
            scope: 'per-product-search' as const,
        }),
    });
}

const liveSearchPolicies = Object.freeze({
    quick: definePolicy('quick', 3, 20_560, 5, 100),
    balanced: definePolicy('balanced', 4, 242_704, 50, 500),
    precise: definePolicy('precise', 5, 2_657_920, 550, 4_000),
} satisfies Record<LiveSearchMode, LiveSearchPolicy>);

export function liveSearchPolicy(mode: LiveSearchMode): LiveSearchPolicy {
    const policy = (liveSearchPolicies as Partial<Record<string, LiveSearchPolicy>>)[mode];
    if (policy === undefined) {
        throw new RangeError(`Unknown live search mode: ${String(mode)}`);
    }

    return policy;
}

export function liveSearchPolicyForRequest(
    mode: LiveSearchMode,
    maxIngredients: number
): LiveSearchPolicy {
    if (!Number.isSafeInteger(maxIngredients) || maxIngredients < 0) {
        throw new RangeError('maxIngredients must be a non-negative safe integer');
    }

    const policy = liveSearchPolicy(mode);
    if (maxIngredients > policy.maximumIngredients) {
        throw new RangeError(
            `${mode} mode supports at most ${policy.maximumIngredients} ingredients; received ${maxIngredients}`
        );
    }

    return policy;
}
