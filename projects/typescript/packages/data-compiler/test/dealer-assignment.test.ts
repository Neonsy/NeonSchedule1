import {
    DealerAssignmentOptimizer,
    logicalDealerProfiles,
    type DealerAssignmentCustomer,
    type DealerAssignmentDealerState,
    type TradeCatalog,
} from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

describe('dealer assignment', () => {
    it('collapses physical instances and applies capacity, cuts, and one signing fee', () => {
        const catalog = tradeCatalog(2, [
            dealer('cheap', 'cheap:one', 0.1, 20),
            dealer('cheap', 'cheap:two', 0.1, 20),
            dealer('costly', 'costly:one', 0.3, 0),
        ]);
        const logical = logicalDealerProfiles(catalog);
        expect(logical).toHaveLength(2);
        expect(logical[0]).toMatchObject({
            personId: 'cheap',
            instanceKeys: ['cheap:one', 'cheap:two'],
        });

        const result = new DealerAssignmentOptimizer(catalog).assign({
            dealers: [
                { personId: 'cheap', signingFeePaid: false },
                { personId: 'costly', signingFeePaid: true },
            ],
            customers: [
                customer('alice', 100, 50),
                customer('bob', 50, 30),
                customer('carol', 20, 10),
            ],
            maximumDealerSubsets: 4,
        });

        expect(result).toMatchObject({
            status: 'exact',
            expectedRevenue: 170,
            expectedProfitBeforeDealerCosts: 90,
            dealerCut: 21,
            signingFees: 20,
            expectedProfit: 49,
            evidence: {
                logicalDealerCount: 2,
                collapsedInstanceCount: 1,
                evaluatedDealerSubsets: 4,
            },
        });
        expect(result.groups.map(({ dealerId, assignments }) => ({
            dealerId,
            customers: assignments.map(({ customerId }) => customerId),
        }))).toEqual([
            { dealerId: 'cheap', customers: ['alice', 'bob'] },
            { dealerId: 'costly', customers: ['carol'] },
        ]);
    });

    it('matches exhaustive assignment with eligibility and activation fees', () => {
        const catalog = tradeCatalog(2, [
            dealer('d1', 'd1:one', 0.1, 5),
            dealer('d2', 'd2:one', 0.2, 0),
            dealer('d3', 'd3:one', 0.05, 20),
        ]);
        const dealers: DealerAssignmentDealerState[] = [
            { personId: 'd1', signingFeePaid: false },
            { personId: 'd2', signingFeePaid: true },
            { personId: 'd3', signingFeePaid: false },
        ];
        const customers = [
            customer('a', 100, 60),
            customer('b', 60, 40, ['d1', 'd2']),
            customer('c', 40, 18, ['d2', 'd3']),
            customer('d', 10, 5),
        ];
        const actual = new DealerAssignmentOptimizer(catalog).assign({
            dealers,
            customers,
            maximumDealerSubsets: 8,
        });
        const expected = exhaustive(catalog, dealers, customers);

        expect(actual.status).toBe('exact');
        expect({
            expectedProfit: actual.expectedProfit,
            dealerCut: actual.dealerCut,
            signingFees: actual.signingFees,
        }).toEqual(expected);
    });

    it('reports an incomplete result when not every dealer subset is evaluated', () => {
        const result = new DealerAssignmentOptimizer(tradeCatalog(1, [
            dealer('dealer', 'dealer:one', 0, 0),
        ])).assign({
            dealers: [{ personId: 'dealer', signingFeePaid: true }],
            customers: [customer('customer', 10, 10)],
            maximumDealerSubsets: 1,
        });

        expect(result).toMatchObject({
            status: 'subset-limit',
            groups: [],
            unassignedCustomerIds: ['customer'],
            evidence: { evaluatedDealerSubsets: 1, possibleDealerSubsets: 2 },
        });
    });

    it('rejects inconsistent physical profiles for one logical dealer', () => {
        expect(() => logicalDealerProfiles(tradeCatalog(2, [
            dealer('dealer', 'dealer:one', 0.1, 20),
            dealer('dealer', 'dealer:two', 0.2, 20),
        ]))).toThrow('inconsistent physical instance profiles');
    });

    it('rejects invalid dealer economics at the core boundary', () => {
        expect(() => new DealerAssignmentOptimizer(tradeCatalog(2, [
            dealer('dealer', 'dealer:one', 1.01, 20),
        ]))).toThrow('sales cut must be between zero and one');
    });
});

function exhaustive(
    catalog: TradeCatalog,
    dealerStates: readonly DealerAssignmentDealerState[],
    customers: readonly DealerAssignmentCustomer[]
): { readonly expectedProfit: number; readonly dealerCut: number; readonly signingFees: number } {
    const profiles = new Map(logicalDealerProfiles(catalog).map((profile) => [profile.personId, profile]));
    const states = new Map(dealerStates.map((state) => [state.personId, state]));
    const counts = new Map<string, number>();
    let best = { expectedProfit: 0, dealerCut: 0, signingFees: 0 };

    const visit = (
        index: number,
        expectedProfitBeforeCosts: number,
        dealerCut: number,
        usedDealerIds: ReadonlySet<string>
    ): void => {
        if (index === customers.length) {
            const signingFees = [...usedDealerIds].reduce((total, dealerId) => {
                return total + (states.get(dealerId)!.signingFeePaid
                    ? 0
                    : profiles.get(dealerId)!.signingFee);
            }, 0);
            const candidate = {
                expectedProfit: expectedProfitBeforeCosts - dealerCut - signingFees,
                dealerCut,
                signingFees,
            };
            if (candidate.expectedProfit > best.expectedProfit) best = candidate;
            return;
        }
        visit(index + 1, expectedProfitBeforeCosts, dealerCut, usedDealerIds);
        const customer = customers[index]!;
        for (const dealerId of customer.eligibleDealerIds ?? dealerStates.map(({ personId }) => personId)) {
            if ((counts.get(dealerId) ?? 0) >= catalog.dealerMechanics.maximumCustomers) continue;
            counts.set(dealerId, (counts.get(dealerId) ?? 0) + 1);
            visit(
                index + 1,
                expectedProfitBeforeCosts + customer.expectedProfit,
                dealerCut + customer.expectedRevenue * profiles.get(dealerId)!.salesCutPercentage,
                new Set([...usedDealerIds, dealerId])
            );
            counts.set(dealerId, counts.get(dealerId)! - 1);
        }
    };
    visit(0, 0, 0, new Set());
    return best;
}

function customer(
    customerId: string,
    expectedRevenue: number,
    expectedProfit: number,
    eligibleDealerIds?: readonly string[]
): DealerAssignmentCustomer {
    return {
        customerId,
        expectedRevenue,
        expectedProfit,
        ...(eligibleDealerIds === undefined ? {} : { eligibleDealerIds }),
    };
}

function dealer(
    personId: string,
    instanceKey: string,
    salesCutPercentage: number,
    signingFee: number
): TradeCatalog['dealers'][number] {
    return {
        personId,
        instanceKey,
        type: 'PlayerDealer',
        homeName: `${personId} home`,
        walkSpeed: 4,
        salesCutPercentage,
        signingFee,
        qualityTolerance: { negative: -2, positive: 5 },
    };
}

function tradeCatalog(
    maximumCustomers: number,
    dealers: TradeCatalog['dealers']
): TradeCatalog {
    return {
        schema: 'neonschedule1-trade-catalog-2',
        dealerMechanics: {
            maximumCustomers,
            dealArrivalDelay: 30,
            travelTime: { minimum: 15, maximum: 360 },
            overflowSlotCount: 10,
            cashReminderThreshold: 500,
            relationshipChangePerDeal: 0.05,
        },
        dealers,
        suppliers: [],
    };
}
