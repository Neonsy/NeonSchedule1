import {
    CustomerAllocationOptimizer,
    type CustomerAllocationOption,
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

        for (let maximumProductionCost = 0; maximumProductionCost <= 10; maximumProductionCost++) {
            for (let stock = 0; stock <= 4; stock++) {
                const actual = optimizer.optimize({
                    customerIds,
                    options,
                    maximumProductionCost,
                    resourceLimits: [{ resourceId: 'stock', quantity: stock }],
                    maximumStates: 10_000,
                });
                const expected = exhaustive(options, customerIds, maximumProductionCost, stock);
                expect(actual.status).toBe('exact');
                expect(summary(actual)).toEqual(expected);
            }
        }
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

interface ExhaustiveResult {
    readonly optionIds: readonly string[];
    readonly productionCost: number;
    readonly expectedProfit: number;
    readonly stock: number;
}

function exhaustive(
    options: readonly CustomerAllocationOption[],
    customerIds: readonly string[],
    maximumProductionCost: number,
    maximumStock: number
): ExhaustiveResult {
    const grouped = customerIds.map((customerId) => [
        null,
        ...options.filter((candidate) => candidate.customerId === customerId),
    ] as const);
    let best: ExhaustiveResult = {
        optionIds: [],
        productionCost: 0,
        expectedProfit: 0,
        stock: 0,
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
        const candidate = aggregate(selected);
        if (
            candidate.productionCost <= maximumProductionCost &&
            candidate.stock <= maximumStock &&
            better(candidate, best)
        ) {
            best = candidate;
        }
    };
    visit(0, []);
    return best;
}

function aggregate(options: readonly CustomerAllocationOption[]): ExhaustiveResult {
    return {
        optionIds: options.map(({ optionId }) => optionId).sort(),
        productionCost: options.reduce((total, candidate) => total + candidate.productionCost, 0),
        expectedProfit: options.reduce((total, candidate) => total + candidate.expectedProfit, 0),
        stock: options.reduce(
            (total, candidate) => total + (candidate.resourceUsage[0]?.quantity ?? 0),
            0
        ),
    };
}

function better(candidate: ExhaustiveResult, incumbent: ExhaustiveResult): boolean {
    return candidate.expectedProfit > incumbent.expectedProfit ||
        candidate.expectedProfit === incumbent.expectedProfit &&
        (candidate.productionCost < incumbent.productionCost ||
            candidate.productionCost === incumbent.productionCost &&
            (candidate.stock < incumbent.stock ||
                candidate.stock === incumbent.stock &&
                compareIds(candidate.optionIds, incumbent.optionIds) < 0));
}

function compareIds(left: readonly string[], right: readonly string[]): number {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
        if (left[index] !== right[index]) return left[index]! < right[index]! ? -1 : 1;
    }
    return left.length - right.length;
}

function summary(result: CustomerAllocationResult): ExhaustiveResult {
    return {
        optionIds: result.allocations.map(({ optionId }) => optionId).sort(),
        productionCost: result.productionCost,
        expectedProfit: result.expectedProfit,
        stock: result.resourceUsage[0]?.quantity ?? 0,
    };
}
