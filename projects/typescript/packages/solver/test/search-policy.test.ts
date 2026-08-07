import { describe, expect, it } from 'vitest';

import {
    liveSearchPolicy,
    liveSearchPolicyForRequest,
    type LiveSearchMode,
} from '#solver/search-policy';

describe('live search policy', () => {
    it.each([
        ['quick', 3, 20_560, 5, 100],
        ['balanced', 4, 242_704, 50, 500],
        ['precise', 5, 2_657_920, 550, 4_000],
    ] as const)(
        'maps %s to its benchmark-derived limits',
        (mode, maximumIngredients, transitions, minimumMs, maximumMs) => {
            const policy = liveSearchPolicy(mode);

            expect(policy).toEqual({
                version: '1',
                mode,
                maximumIngredients,
                budget: {
                    maxStatesPerProduct: 100_000,
                    maxTransitionEvaluationsPerProduct: transitions,
                },
                advisoryDuration: {
                    minimumMs,
                    maximumMs,
                    scope: 'per-product-search',
                },
            });
            expect(Object.isFrozen(policy)).toBe(true);
            expect(Object.isFrozen(policy.budget)).toBe(true);
        }
    );

    it('rejects a request deeper than the selected mode', () => {
        expect(() => liveSearchPolicyForRequest('quick', 4)).toThrow(
            'quick mode supports at most 3 ingredients; received 4'
        );
        expect(liveSearchPolicyForRequest('balanced', 4).mode).toBe('balanced');
    });

    it('rejects an unknown mode at the runtime boundary', () => {
        expect(() => liveSearchPolicy('unknown' as LiveSearchMode)).toThrow(
            'Unknown live search mode: unknown'
        );
    });
});
