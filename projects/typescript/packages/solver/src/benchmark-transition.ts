import type { Customer } from '@neonschedule1/core';

import type {
    BenchmarkDefinition,
    SearchBenchmarkCase,
    SearchBenchmarkOptions,
    TransitionBudgetCandidate,
} from '#solver/benchmark';

export function transitionProbeDefinitions(
    options: SearchBenchmarkOptions,
    productIds: readonly string[],
    customers: readonly Customer[]
): BenchmarkDefinition[] {
    const definitions: BenchmarkDefinition[] = [];
    for (const depth of options.depths) {
        for (const productId of productIds) {
            definitions.push({
                phase: 'transition-probe',
                kind: 'recipe',
                depth,
                productId,
                objective: 'productValue',
            });
            for (const customer of customers) {
                for (const customerState of options.customerStates) {
                    definitions.push({
                        phase: 'transition-probe',
                        kind: 'customer',
                        depth,
                        customer,
                        customerState,
                        productId,
                    });
                }
            }
        }
    }
    return definitions;
}

export function transitionBudgetCandidates(
    percentiles: readonly number[],
    probes: readonly SearchBenchmarkCase[]
): { readonly percentile: number; readonly maxTransitionEvaluations: number }[] {
    if (percentiles.length === 0) return [];
    const counts = probes.map((probe) => {
        const sample = probe.samples[0]!;
        if (sample.status !== 'completed') {
            throw new Error(`Transition probe ${probe.id} did not complete exactly`);
        }
        const count = sample.evidence.transitionEvaluations;
        if (count === undefined) {
            throw new Error(`Transition probe ${probe.id} did not record transition work`);
        }
        return count;
    }).sort((left, right) => left - right);
    return percentiles.map((percentile) => ({
        percentile,
        maxTransitionEvaluations: Math.max(
            1,
            counts[Math.ceil(percentile * counts.length) - 1]!
        ),
    }));
}

export function summarizeTransitionBudget(
    candidate: { readonly percentile: number; readonly maxTransitionEvaluations: number },
    cases: readonly SearchBenchmarkCase[]
): TransitionBudgetCandidate {
    const statuses = cases.map((entry) => entry.samples[0]!.status);
    const durations = cases
        .map((entry) => entry.duration.medianMs)
        .sort((left, right) => left - right);
    const completedCases = statuses.filter((status) => status === 'completed').length;
    return {
        ...candidate,
        completedCases,
        workLimitedCases: statuses.filter((status) => status === 'work-limit').length,
        stateLimitedCases: statuses.filter((status) => status === 'state-limit').length,
        completionRate: completedCases / statuses.length,
        medianDurationMs: median(durations),
    };
}

export function requireTransitionBudgetPercentiles(percentiles: readonly number[]): void {
    for (const percentile of percentiles) {
        if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 1) {
            throw new Error(
                'Benchmark transition budget percentiles must be finite numbers above zero and at most one'
            );
        }
    }
    if (new Set(percentiles).size !== percentiles.length) {
        throw new Error('Benchmark transition budget percentiles must not contain duplicates');
    }
}

function median(sorted: readonly number[]): number {
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? milliseconds((sorted[middle - 1]! + sorted[middle]!) / 2)
        : sorted[middle]!;
}

function milliseconds(value: number): number {
    return Math.round(value * 10) / 10;
}
