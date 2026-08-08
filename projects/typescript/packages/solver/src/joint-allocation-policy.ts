import type { LiveSearchMode } from '#solver/search-policy';

export const jointAllocationPolicyVersion = '1';

export type JointAllocationMode = LiveSearchMode;

export interface JointAllocationBudget {
    readonly maximumDealerConfigurations: number;
    readonly maximumStatesPerDealerConfiguration: number;
}

export interface JointAllocationPolicy {
    readonly version: typeof jointAllocationPolicyVersion;
    readonly mode: JointAllocationMode;
    readonly budget: JointAllocationBudget;
    readonly advisoryDuration: {
        readonly minimumMs: number;
        readonly maximumMs: number;
        readonly scope: 'allocation-only';
    };
}

function definePolicy(
    mode: JointAllocationMode,
    maximumStatesPerDealerConfiguration: number,
    maximumDurationMs: number
): JointAllocationPolicy {
    return Object.freeze({
        version: jointAllocationPolicyVersion,
        mode,
        budget: Object.freeze({
            maximumDealerConfigurations: 64,
            maximumStatesPerDealerConfiguration,
        }),
        advisoryDuration: Object.freeze({
            minimumMs: 1,
            maximumMs: maximumDurationMs,
            scope: 'allocation-only' as const,
        }),
    });
}

const policies = Object.freeze({
    quick: definePolicy('quick', 50_000, 750),
    balanced: definePolicy('balanced', 250_000, 3_500),
    precise: definePolicy('precise', 1_000_000, 9_000),
} satisfies Record<JointAllocationMode, JointAllocationPolicy>);

export function jointAllocationPolicy(mode: JointAllocationMode): JointAllocationPolicy {
    const policy = (policies as Partial<Record<string, JointAllocationPolicy>>)[mode];
    if (policy === undefined) {
        throw new RangeError(`Unknown joint allocation mode: ${String(mode)}`);
    }
    return policy;
}
