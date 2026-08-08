import { describe, expect, it } from 'vitest';

import {
    jointAllocationPolicy,
    type JointAllocationMode,
} from '#solver/joint-allocation-policy';

describe('joint allocation policy', () => {
    it.each([
        ['quick', 50_000, 750],
        ['balanced', 250_000, 3_500],
        ['precise', 1_000_000, 9_000],
    ] as const)('maps %s to its measured work limit', (mode, states, maximumMs) => {
        const policy = jointAllocationPolicy(mode);

        expect(policy).toEqual({
            version: '1',
            mode,
            budget: {
                maximumDealerConfigurations: 64,
                maximumStatesPerDealerConfiguration: states,
            },
            advisoryDuration: {
                minimumMs: 1,
                maximumMs,
                scope: 'allocation-only',
            },
        });
        expect(Object.isFrozen(policy)).toBe(true);
        expect(Object.isFrozen(policy.budget)).toBe(true);
        expect(Object.isFrozen(policy.advisoryDuration)).toBe(true);
    });

    it('rejects an unknown mode at the runtime boundary', () => {
        expect(() => jointAllocationPolicy('unknown' as JointAllocationMode)).toThrow(
            'Unknown joint allocation mode: unknown'
        );
    });
});
