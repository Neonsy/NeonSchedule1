import {
    CustomerAllocationOptimizer,
    type CustomerAllocationOption,
    type CustomerAllocationResourceLimit,
    type CustomerAllocationResult,
} from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

describe('customer allocation', () => {
    const optimizer = new CustomerAllocationOptimizer();

    it('finds the best combined allocation instead of taking the best single offer first', () => {
        const result = optimizer.optimize({
            customerIds: ['alice', 'bob'],
            options: [
                option('alice-high', 'alice', 6, 10, 2),
                option('alice-low', 'alice', 3, 6, 1),
                option('bob-only', 'bob', 4, 8, 1),
            ],
            maximumProductionCost: 7,
            resourceLimits: [{ resourceId: 'stock', quantity: 2 }],
            maximumStates: 100,
        });

        expect(result).toMatchObject({
            status: 'exact',
            allocations: [
                { customerId: 'alice', optionId: 'alice-low' },
                { customerId: 'bob', optionId: 'bob-only' },
            ],
            unallocatedCustomerIds: [],
            productionCost: 7,
            expectedProfit: 14,
            resourceUsage: [{ resourceId: 'stock', quantity: 2 }],
        });
    });

    it('uses stable option IDs to resolve otherwise identical plans', () => {
        const result = optimizer.optimize({
            customerIds: ['alice'],
            options: [
                option('later', 'alice', 2, 5, 1),
                option('earlier', 'alice', 2, 5, 1),
            ],
            maximumProductionCost: 2,
            resourceLimits: [{ resourceId: 'stock', quantity: 1 }],
            maximumStates: 10,
        });

        expect(result.allocations).toEqual([
            { customerId: 'alice', optionId: 'earlier' },
        ]);
        expect(result.evidence.discardedDominatedOptions).toBe(1);
    });

    it('forgets expired resources without changing result tie-breaking', () => {
        const result = optimizer.optimize({
            customerIds: ['alice', 'bob'],
            options: [
                resourceOption('alice-a', 'alice', 1, 5, 'a'),
                resourceOption('alice-b', 'alice', 1, 5, 'b'),
                resourceOption('bob', 'bob', 1, 4, 'shared'),
            ],
            maximumProductionCost: 2,
            resourceLimits: [
                { resourceId: 'a', quantity: 1 },
                { resourceId: 'b', quantity: 1 },
                { resourceId: 'shared', quantity: 1 },
            ],
            maximumStates: 100,
        });

        expect(result).toMatchObject({
            status: 'exact',
            allocations: [
                { customerId: 'alice', optionId: 'alice-b' },
                { customerId: 'bob', optionId: 'bob' },
            ],
            resourceUsage: [
                { resourceId: 'b', quantity: 1 },
                { resourceId: 'shared', quantity: 1 },
            ],
        });
        expect(result.evidence.prunedByEquivalentState).toBeGreaterThan(0);
    });

    it('labels a feasible incumbent as incomplete when its state limit is reached', () => {
        const result = optimizer.optimize({
            customerIds: ['alice'],
            options: [option('offer', 'alice', 1, 2, 1)],
            maximumProductionCost: 1,
            resourceLimits: [{ resourceId: 'stock', quantity: 1 }],
            maximumStates: 1,
        });

        expect(result).toMatchObject({
            status: 'state-limit',
            allocations: [],
            productionCost: 0,
            expectedProfit: 0,
            evidence: { visitedStates: 1, maximumStates: 1 },
        });
    });

    it('matches exhaustive enumeration across cash and stock limits', () => {
        const customerIds = ['alice', 'bob', 'carol'];
        const options = [
            option('a-compact', 'alice', 2, 5, 1),
            option('a-premium', 'alice', 3, 7, 2),
            option('b-compact', 'bob', 4, 9, 1),
            option('b-cheap', 'bob', 1, 2, 0),
            option('c-premium', 'carol', 5, 11, 2),
            option('c-compact', 'carol', 2, 4, 1),
        ];
        let equivalentStatePrunes = 0;

        for (let maximumProductionCost = 0; maximumProductionCost <= 10; maximumProductionCost++) {
            for (let stock = 0; stock <= 4; stock++) {
                const resourceLimits = [{ resourceId: 'stock', quantity: stock }];
                const actual = optimizer.optimize({
                    customerIds,
                    options,
                    maximumProductionCost,
                    resourceLimits,
                    maximumStates: 10_000,
                });
                const expected = exhaustive(
                    options,
                    customerIds,
                    maximumProductionCost,
                    resourceLimits
                );
                expect(actual.status).toBe('exact');
                expect(summary(actual, resourceLimits)).toEqual(expected);
                equivalentStatePrunes += actual.evidence.prunedByEquivalentState;
            }
        }
        expect(equivalentStatePrunes).toBeGreaterThan(0);
    });

    it('matches exhaustive enumeration as independent resource frontiers expire', () => {
        const customerIds = ['alice', 'bob', 'carol', 'dave'];
        const options = [
            resourceOption('alice-red', 'alice', 2, 7, 'red'),
            resourceOption('alice-blue', 'alice', 1, 5, 'blue'),
            resourceOption('bob-red', 'bob', 1, 6, 'red'),
            resourceOption('bob-green', 'bob', 2, 8, 'green'),
            resourceOption('carol-blue', 'carol', 2, 6, 'blue'),
            resourceOption('carol-green', 'carol', 1, 4, 'green'),
            resourceOption('dave-green', 'dave', 1, 3, 'green'),
        ];
        let equivalentStatePrunes = 0;

        for (let maximumProductionCost = 0; maximumProductionCost <= 7; maximumProductionCost++) {
            for (let mask = 0; mask < 8; mask++) {
                const resourceLimits = ['blue', 'green', 'red'].map((resourceId, index) => ({
                    resourceId,
                    quantity: mask >> index & 1,
                }));
                const actual = optimizer.optimize({
                    customerIds,
                    options,
                    maximumProductionCost,
                    resourceLimits,
                    maximumStates: 10_000,
                });
                const expected = exhaustive(
                    options,
                    customerIds,
                    maximumProductionCost,
                    resourceLimits
                );
                expect(actual.status).toBe('exact');
                expect(summary(actual, resourceLimits)).toEqual(expected);
                equivalentStatePrunes += actual.evidence.prunedByEquivalentState;
            }
        }
        expect(equivalentStatePrunes).toBeGreaterThan(0);
    });

    it('rejects resource use without a declared limit', () => {
        expect(() =>
            optimizer.optimize({
                customerIds: ['alice'],
                options: [option('offer', 'alice', 1, 2, 1)],
                maximumProductionCost: 1,
                resourceLimits: [],
                maximumStates: 10,
            })
        ).toThrow('Unknown allocation resource "stock"');
    });
});

function option(
    optionId: string,
    customerId: string,
    productionCost: number,
    expectedProfit: number,
    stock: number
): CustomerAllocationOption {
    return {
        optionId,
        customerId,
        productionCost,
        expectedProfit,
        resourceUsage: stock === 0 ? [] : [{ resourceId: 'stock', quantity: stock }],
    };
}

function resourceOption(
    optionId: string,
    customerId: string,
    productionCost: number,
    expectedProfit: number,
    resourceId: string
): CustomerAllocationOption {
    return {
        optionId,
        customerId,
        productionCost,
        expectedProfit,
        resourceUsage: [{ resourceId, quantity: 1 }],
    };
}

interface ExhaustiveResult {
    readonly optionIds: readonly string[];
    readonly productionCost: number;
    readonly expectedProfit: number;
    readonly resourceUsage: readonly number[];
}

function exhaustive(
    options: readonly CustomerAllocationOption[],
    customerIds: readonly string[],
    maximumProductionCost: number,
    resourceLimits: readonly CustomerAllocationResourceLimit[]
): ExhaustiveResult {
    const orderedLimits = [...resourceLimits].sort((left, right) =>
        left.resourceId.localeCompare(right.resourceId)
    );
    const grouped = customerIds.map((customerId) => [
        null,
        ...options.filter((candidate) => candidate.customerId === customerId),
    ] as const);
    let best: ExhaustiveResult = {
        optionIds: [],
        productionCost: 0,
        expectedProfit: 0,
        resourceUsage: orderedLimits.map(() => 0),
    };

    const visit = (customerIndex: number, selected: readonly CustomerAllocationOption[]): void => {
        if (customerIndex < grouped.length) {
            for (const candidate of grouped[customerIndex]!) {
                visit(
                    customerIndex + 1,
                    candidate === null ? selected : [...selected, candidate]
                );
            }
            return;
        }
        const candidate = aggregate(selected, orderedLimits.map(({ resourceId }) => resourceId));
        if (
            candidate.productionCost <= maximumProductionCost &&
            candidate.resourceUsage.every(
                (quantity, index) => quantity <= orderedLimits[index]!.quantity
            ) &&
            better(candidate, best)
        ) {
            best = candidate;
        }
    };
    visit(0, []);
    return best;
}

function aggregate(
    options: readonly CustomerAllocationOption[],
    resourceIds: readonly string[]
): ExhaustiveResult {
    return {
        optionIds: options.map(({ optionId }) => optionId).sort(),
        productionCost: options.reduce((total, candidate) => total + candidate.productionCost, 0),
        expectedProfit: options.reduce((total, candidate) => total + candidate.expectedProfit, 0),
        resourceUsage: resourceIds.map((resourceId) => options.reduce(
            (total, candidate) => total + (
                candidate.resourceUsage.find((usage) => usage.resourceId === resourceId)?.quantity ?? 0
            ),
            0
        )),
    };
}

function better(candidate: ExhaustiveResult, incumbent: ExhaustiveResult): boolean {
    return candidate.expectedProfit > incumbent.expectedProfit ||
        candidate.expectedProfit === incumbent.expectedProfit &&
        (candidate.productionCost < incumbent.productionCost ||
            candidate.productionCost === incumbent.productionCost &&
            (compareNumbers(candidate.resourceUsage, incumbent.resourceUsage) < 0 ||
                compareNumbers(candidate.resourceUsage, incumbent.resourceUsage) === 0 &&
                compareIds(candidate.optionIds, incumbent.optionIds) < 0));
}

function compareNumbers(left: readonly number[], right: readonly number[]): number {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
        if (left[index] !== right[index]) return left[index]! - right[index]!;
    }
    return left.length - right.length;
}

function compareIds(left: readonly string[], right: readonly string[]): number {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
        if (left[index] !== right[index]) return left[index]! < right[index]! ? -1 : 1;
    }
    return left.length - right.length;
}

function summary(
    result: CustomerAllocationResult,
    resourceLimits: readonly CustomerAllocationResourceLimit[]
): ExhaustiveResult {
    const usage = new Map(result.resourceUsage.map((entry) => [entry.resourceId, entry.quantity]));
    return {
        optionIds: result.allocations.map(({ optionId }) => optionId).sort(),
        productionCost: result.productionCost,
        expectedProfit: result.expectedProfit,
        resourceUsage: [...resourceLimits]
            .sort((left, right) => left.resourceId.localeCompare(right.resourceId))
            .map(({ resourceId }) => usage.get(resourceId) ?? 0),
    };
}
