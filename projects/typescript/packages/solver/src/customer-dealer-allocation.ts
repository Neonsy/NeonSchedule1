import {
    DealerCustomerAllocationOptimizer,
    TradeCatalogSchema,
    logicalDealerProfiles,
    type CustomerRecommendation,
    type DealerAssignmentDealerState,
    type DealerCustomerAllocationResult,
    type LogicalDealerProfile,
    type TradeCatalog,
} from '@neonschedule1/core';

import {
    assertCustomerAllocationDatasetIdentity,
    customerRecommendationAllocationOptionId,
    customerRecommendationStockResourceId,
    customerRecommendationStockLimits,
    type CustomerRecommendationStock,
} from '#solver/customer-allocation';
import {
    jointAllocationPolicy,
    type JointAllocationMode,
    type JointAllocationPolicy,
} from '#solver/joint-allocation-policy';

export interface CustomerDealerRecommendationSet {
    readonly customerId: string;
    readonly recommendations: readonly CustomerRecommendation[];
    readonly eligibleDealerIds?: readonly string[];
}

export interface CustomerDealerAllocationInput {
    readonly datasetSha256: string;
    readonly dealers: readonly DealerAssignmentDealerState[];
    readonly recommendationSets: readonly CustomerDealerRecommendationSet[];
    readonly maximumProductionCost: number;
    readonly stock?: readonly CustomerRecommendationStock[];
    readonly maximumDealerSubsets: number;
    readonly maximumStatesPerDealerSubset: number;
}

export interface ResolvedCustomerDealerAllocation {
    readonly customerId: string;
    readonly optionId: string;
    readonly dealerId: string;
    readonly stockResourceId: string;
    readonly recommendation: CustomerRecommendation;
}

export interface CustomerDealerAllocationResult {
    readonly result: DealerCustomerAllocationResult;
    readonly allocations: readonly ResolvedCustomerDealerAllocation[];
}

export type ModeCustomerDealerAllocationInput = Omit<
    CustomerDealerAllocationInput,
    'maximumDealerSubsets' | 'maximumStatesPerDealerSubset'
>;

export interface ModeCustomerDealerAllocationResult extends CustomerDealerAllocationResult {
    readonly mode: JointAllocationMode;
    readonly policy: JointAllocationPolicy;
}

interface IndexedRecommendation {
    readonly customerId: string;
    readonly optionId: string;
    readonly stockResourceId: string;
    readonly recommendation: CustomerRecommendation;
    readonly eligibleDealerIds?: readonly string[];
}

export class CustomerRecommendationDealerAllocator {
    readonly #profiles: ReadonlyMap<string, LogicalDealerProfile>;
    readonly #maximumCustomers: number;
    readonly #optimizer = new DealerCustomerAllocationOptimizer();

    constructor(catalogInput: TradeCatalog) {
        const catalog = TradeCatalogSchema.assert(catalogInput);
        this.#profiles = new Map(
            logicalDealerProfiles(catalog).map((profile) => [profile.personId, profile])
        );
        this.#maximumCustomers = catalog.dealerMechanics.maximumCustomers;
    }

    allocateForMode(
        input: ModeCustomerDealerAllocationInput,
        mode: JointAllocationMode
    ): ModeCustomerDealerAllocationResult {
        const policy = jointAllocationPolicy(mode);
        return {
            mode,
            policy,
            ...this.allocate({
                ...input,
                maximumDealerSubsets: policy.budget.maximumDealerConfigurations,
                maximumStatesPerDealerSubset:
                    policy.budget.maximumStatesPerDealerConfiguration,
            }),
        };
    }

    allocate(input: CustomerDealerAllocationInput): CustomerDealerAllocationResult {
        assertCustomerAllocationDatasetIdentity(input.datasetSha256);
        const dealers = this.#availableDealers(input.dealers);
        const availableDealerIds = new Set(dealers.map(({ dealerId }) => dealerId));
        const indexed = indexRecommendations(
            input.datasetSha256,
            input.recommendationSets,
            availableDealerIds
        );
        const byOptionId = new Map(indexed.map((entry) => [entry.optionId, entry]));
        if (byOptionId.size !== indexed.length) {
            throw new Error('Customer recommendations contain duplicate allocation options');
        }
        const hasStock = input.stock !== undefined;
        const resourceLimits = hasStock
            ? customerRecommendationStockLimits(
                  input.stock,
                  indexed.map(({ stockResourceId }) => stockResourceId)
              )
            : [];
        const result = this.#optimizer.optimize({
            customerIds: input.recommendationSets.map(({ customerId }) => customerId),
            dealers,
            options: indexed.map((entry) => ({
                optionId: entry.optionId,
                customerId: entry.customerId,
                productionCost: entry.recommendation.productionCost,
                expectedRevenue: entry.recommendation.expectedRevenue,
                expectedProfitBeforeDealerCut: entry.recommendation.expectedProfit,
                resourceUsage: hasStock
                    ? [{
                          resourceId: entry.stockResourceId,
                          quantity: entry.recommendation.quantity,
                      }]
                    : [],
                ...(entry.eligibleDealerIds === undefined
                    ? {}
                    : { eligibleDealerIds: entry.eligibleDealerIds }),
            })),
            maximumProductionCost: input.maximumProductionCost,
            resourceLimits,
            maximumDealerSubsets: input.maximumDealerSubsets,
            maximumStatesPerDealerSubset: input.maximumStatesPerDealerSubset,
        });
        return {
            result,
            allocations: result.allocations.map(({ customerId, optionId, dealerId }) => {
                const entry = byOptionId.get(optionId);
                if (entry === undefined || entry.customerId !== customerId) {
                    throw new Error(`Allocation option ${JSON.stringify(optionId)} cannot be resolved`);
                }
                return { ...entry, dealerId };
            }),
        };
    }

    #availableDealers(states: readonly DealerAssignmentDealerState[]) {
        const seen = new Set<string>();
        return states.map((state) => {
            requireId(state.personId, 'Available dealer');
            if (seen.has(state.personId)) {
                throw new Error(`Duplicate available dealer ${JSON.stringify(state.personId)}`);
            }
            seen.add(state.personId);
            const profile = this.#profiles.get(state.personId);
            if (profile === undefined) {
                throw new Error(`Unknown available dealer ${JSON.stringify(state.personId)}`);
            }
            if (typeof state.signingFeePaid !== 'boolean') {
                throw new Error(
                    `Dealer ${JSON.stringify(state.personId)} signing-fee state is invalid`
                );
            }
            return {
                dealerId: profile.personId,
                maximumCustomers: this.#maximumCustomers,
                salesCutPercentage: profile.salesCutPercentage,
                signingFeeCharged: state.signingFeePaid ? 0 : profile.signingFee,
            };
        });
    }
}

function indexRecommendations(
    datasetSha256: string,
    sets: readonly CustomerDealerRecommendationSet[],
    availableDealerIds: ReadonlySet<string>
): IndexedRecommendation[] {
    const customerIds = new Set<string>();
    return sets.flatMap(({ customerId, recommendations, eligibleDealerIds }) => {
        requireId(customerId, 'Customer');
        if (customerIds.has(customerId)) {
            throw new Error(`Duplicate customer recommendation set ${JSON.stringify(customerId)}`);
        }
        customerIds.add(customerId);
        const eligible = eligibleDealerIds === undefined
            ? undefined
            : uniqueIds(eligibleDealerIds, 'eligible dealer');
        for (const dealerId of eligible ?? []) {
            if (!availableDealerIds.has(dealerId)) {
                throw new Error(`Unknown eligible dealer ${JSON.stringify(dealerId)}`);
            }
        }
        return recommendations.map((recommendation): IndexedRecommendation => ({
            customerId,
            optionId: customerRecommendationAllocationOptionId(
                datasetSha256,
                customerId,
                recommendation
            ),
            stockResourceId: customerRecommendationStockResourceId(
                datasetSha256,
                recommendation
            ),
            recommendation,
            ...(eligible === undefined ? {} : { eligibleDealerIds: eligible }),
        }));
    });
}

function uniqueIds(ids: readonly string[], label: string): string[] {
    const result = new Set<string>();
    for (const id of ids) {
        requireId(id, label);
        if (result.has(id)) throw new Error(`Duplicate ${label} ${JSON.stringify(id)}`);
        result.add(id);
    }
    return [...result].sort();
}

function requireId(value: string, label: string): void {
    if (value.trim().length === 0) throw new Error(`${label} ID must not be blank`);
}
