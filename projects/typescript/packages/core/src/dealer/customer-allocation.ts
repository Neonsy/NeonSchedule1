import {
    CustomerAllocationOptimizer,
    type CustomerAllocationResourceLimit,
    type CustomerAllocationResourceUsage,
} from '#core/customer/allocation';

export interface DealerCustomerAllocationDealer {
    readonly dealerId: string;
    readonly maximumCustomers: number;
    readonly salesCutPercentage: number;
    readonly signingFeeCharged: number;
}

export interface DealerCustomerAllocationOption {
    readonly optionId: string;
    readonly customerId: string;
    readonly productionCost: number;
    readonly expectedRevenue: number;
    readonly expectedProfitBeforeDealerCut: number;
    readonly resourceUsage: readonly CustomerAllocationResourceUsage[];
    readonly eligibleDealerIds?: readonly string[];
}

export interface DealerCustomerAllocationInput {
    readonly customerIds: readonly string[];
    readonly dealers: readonly DealerCustomerAllocationDealer[];
    readonly options: readonly DealerCustomerAllocationOption[];
    readonly maximumProductionCost: number;
    readonly resourceLimits: readonly CustomerAllocationResourceLimit[];
    readonly maximumDealerSubsets: number;
    readonly maximumStatesPerDealerSubset: number;
}

export interface DealerCustomerAllocation {
    readonly customerId: string;
    readonly optionId: string;
    readonly dealerId: string;
    readonly productionCost: number;
    readonly expectedRevenue: number;
    readonly expectedProfitBeforeDealerCut: number;
    readonly dealerCut: number;
    readonly expectedProfitAfterDealerCut: number;
    readonly resourceUsage: readonly CustomerAllocationResourceUsage[];
}

export type DealerCustomerAllocationStopReason =
    | 'dealer-subset-limit'
    | 'allocation-state-limit';

export interface DealerCustomerAllocationEvidence {
    readonly possibleDealerSubsets: number | null;
    readonly evaluatedDealerSubsets: number;
    readonly maximumDealerSubsets: number;
    readonly allocationVisitedStates: number;
    readonly maximumStatesPerDealerSubset: number;
    readonly stateLimitedDealerSubsets: number;
    readonly stopReasons: readonly DealerCustomerAllocationStopReason[];
}

export interface DealerCustomerAllocationResult {
    readonly status: 'exact' | 'incomplete';
    readonly allocations: readonly DealerCustomerAllocation[];
    readonly unallocatedCustomerIds: readonly string[];
    readonly productionCost: number;
    readonly expectedRevenue: number;
    readonly expectedProfitBeforeDealerCosts: number;
    readonly dealerCut: number;
    readonly signingFees: number;
    readonly expectedProfit: number;
    readonly resourceUsage: readonly CustomerAllocationResourceUsage[];
    readonly evidence: DealerCustomerAllocationEvidence;
}

interface NormalizedInput extends Omit<DealerCustomerAllocationInput, 'customerIds'> {
    readonly customerIds: readonly string[];
    readonly resourceIds: ReadonlySet<string>;
}

interface IndexedChoice {
    readonly internalOptionId: string;
    readonly option: DealerCustomerAllocationOption;
    readonly dealer: DealerCustomerAllocationDealer;
    readonly dealerCut: number;
    readonly expectedProfitAfterDealerCut: number;
}

interface Candidate {
    readonly allocations: readonly DealerCustomerAllocation[];
    readonly productionCost: number;
    readonly expectedRevenue: number;
    readonly expectedProfitBeforeDealerCosts: number;
    readonly dealerCut: number;
    readonly signingFees: number;
    readonly expectedProfit: number;
    readonly resourceUsage: readonly CustomerAllocationResourceUsage[];
}

export class DealerCustomerAllocationOptimizer {
    readonly #allocator = new CustomerAllocationOptimizer();

    optimize(input: DealerCustomerAllocationInput): DealerCustomerAllocationResult {
        const normalized = normalize(input);
        const possibleDealerSubsets = normalized.dealers.length < 53
            ? 2 ** normalized.dealers.length
            : null;
        const selected = Array<boolean>(normalized.dealers.length).fill(false);
        let best = emptyCandidate();
        let evaluatedDealerSubsets = 0;
        let allocationVisitedStates = 0;
        let stateLimitedDealerSubsets = 0;
        let dealerSubsetLimitReached = false;

        const evaluate = (active: readonly DealerCustomerAllocationDealer[]): void => {
            if (evaluatedDealerSubsets >= normalized.maximumDealerSubsets) {
                dealerSubsetLimitReached = true;
                return;
            }
            evaluatedDealerSubsets++;
            if (active.length === 0) return;
            const choices = allocationChoices(normalized.options, active);
            if (choices.length === 0) return;
            const capacityPrefix = unusedResourcePrefix(normalized.resourceIds);
            const byInternalOptionId = new Map(
                choices.map((choice) => [choice.internalOptionId, choice])
            );
            const result = this.#allocator.optimize({
                customerIds: normalized.customerIds,
                options: choices.map((choice) => ({
                    optionId: choice.internalOptionId,
                    customerId: choice.option.customerId,
                    productionCost: choice.option.productionCost,
                    expectedProfit: choice.expectedProfitAfterDealerCut,
                    resourceUsage: [
                        ...choice.option.resourceUsage,
                        { resourceId: `${capacityPrefix}${choice.dealer.dealerId}`, quantity: 1 },
                    ],
                })),
                maximumProductionCost: normalized.maximumProductionCost,
                resourceLimits: [
                    ...normalized.resourceLimits,
                    ...active.map((dealer) => ({
                        resourceId: `${capacityPrefix}${dealer.dealerId}`,
                        quantity: dealer.maximumCustomers,
                    })),
                ],
                maximumStates: normalized.maximumStatesPerDealerSubset,
            });
            allocationVisitedStates += result.evidence.visitedStates;
            if (result.status === 'state-limit') stateLimitedDealerSubsets++;
            const allocations = result.allocations.map(({ optionId }) => {
                const choice = byInternalOptionId.get(optionId);
                if (choice === undefined) throw new Error('Joint allocation choice cannot be resolved');
                return resolvedAllocation(choice);
            }).sort(compareAllocations);
            const usedDealerIds = new Set(allocations.map(({ dealerId }) => dealerId));
            if (active.some(({ dealerId }) => !usedDealerIds.has(dealerId))) return;
            const candidate = summarizeCandidate(allocations, active, normalized.resourceIds);
            if (betterCandidate(candidate, best)) best = candidate;
        };

        do {
            evaluate(normalized.dealers.filter((_, index) => selected[index]));
        } while (!dealerSubsetLimitReached && advanceSubset(selected));

        const stopReasons: DealerCustomerAllocationStopReason[] = [];
        if (dealerSubsetLimitReached) stopReasons.push('dealer-subset-limit');
        if (stateLimitedDealerSubsets > 0) stopReasons.push('allocation-state-limit');
        const allocatedCustomerIds = new Set(best.allocations.map(({ customerId }) => customerId));
        return {
            status: stopReasons.length === 0 ? 'exact' : 'incomplete',
            ...best,
            unallocatedCustomerIds: normalized.customerIds.filter(
                (customerId) => !allocatedCustomerIds.has(customerId)
            ),
            evidence: {
                possibleDealerSubsets,
                evaluatedDealerSubsets,
                maximumDealerSubsets: normalized.maximumDealerSubsets,
                allocationVisitedStates,
                maximumStatesPerDealerSubset: normalized.maximumStatesPerDealerSubset,
                stateLimitedDealerSubsets,
                stopReasons,
            },
        };
    }
}

function normalize(input: DealerCustomerAllocationInput): NormalizedInput {
    requireNonNegativeFinite(input.maximumProductionCost, 'Maximum production cost');
    requirePositiveSafeInteger(input.maximumDealerSubsets, 'Maximum dealer subsets');
    requirePositiveSafeInteger(
        input.maximumStatesPerDealerSubset,
        'Maximum states per dealer subset'
    );
    const customerIds = uniqueIds(input.customerIds, 'customer');
    const customerIdSet = new Set(customerIds);
    const dealerIds = new Set<string>();
    const dealers = input.dealers.map((dealer) => {
        requireId(dealer.dealerId, 'Dealer');
        if (dealerIds.has(dealer.dealerId)) {
            throw new Error(`Duplicate dealer ${JSON.stringify(dealer.dealerId)}`);
        }
        dealerIds.add(dealer.dealerId);
        requirePositiveSafeInteger(dealer.maximumCustomers, 'Dealer maximum customers');
        requirePercentage(dealer.salesCutPercentage, 'Dealer sales cut');
        requireNonNegativeFinite(dealer.signingFeeCharged, 'Dealer signing fee');
        return dealer;
    }).sort((left, right) => compareString(left.dealerId, right.dealerId));
    const resourceIds = new Set<string>();
    for (const limit of input.resourceLimits) {
        requireId(limit.resourceId, 'Allocation resource');
        if (resourceIds.has(limit.resourceId)) {
            throw new Error(`Duplicate allocation resource ${JSON.stringify(limit.resourceId)}`);
        }
        resourceIds.add(limit.resourceId);
        requireNonNegativeSafeInteger(limit.quantity, 'Allocation resource limit');
    }
    const optionIds = new Set<string>();
    const options = input.options.map((option) => normalizeOption(
        option,
        customerIdSet,
        dealerIds,
        resourceIds,
        optionIds
    ));
    return { ...input, customerIds, dealers, options, resourceIds };
}

function normalizeOption(
    option: DealerCustomerAllocationOption,
    customerIds: ReadonlySet<string>,
    dealerIds: ReadonlySet<string>,
    resourceIds: ReadonlySet<string>,
    optionIds: Set<string>
): DealerCustomerAllocationOption {
    requireId(option.optionId, 'Allocation option');
    if (optionIds.has(option.optionId)) {
        throw new Error(`Duplicate allocation option ${JSON.stringify(option.optionId)}`);
    }
    optionIds.add(option.optionId);
    requireId(option.customerId, 'Allocation option customer');
    if (!customerIds.has(option.customerId)) {
        throw new Error(`Unknown allocation customer ${JSON.stringify(option.customerId)}`);
    }
    requireNonNegativeFinite(option.productionCost, 'Allocation option production cost');
    requireNonNegativeFinite(option.expectedRevenue, 'Allocation option expected revenue');
    requireFinite(option.expectedProfitBeforeDealerCut, 'Allocation option expected profit');
    const usageIds = new Set<string>();
    for (const usage of option.resourceUsage) {
        requireId(usage.resourceId, 'Allocation resource usage');
        if (!resourceIds.has(usage.resourceId)) {
            throw new Error(`Unknown allocation resource ${JSON.stringify(usage.resourceId)}`);
        }
        if (usageIds.has(usage.resourceId)) {
            throw new Error(`Duplicate option resource ${JSON.stringify(usage.resourceId)}`);
        }
        usageIds.add(usage.resourceId);
        requirePositiveSafeInteger(usage.quantity, 'Allocation resource usage');
    }
    const eligibleDealerIds = option.eligibleDealerIds === undefined
        ? undefined
        : uniqueIds(option.eligibleDealerIds, 'eligible dealer');
    for (const dealerId of eligibleDealerIds ?? []) {
        if (!dealerIds.has(dealerId)) {
            throw new Error(`Unknown eligible dealer ${JSON.stringify(dealerId)}`);
        }
    }
    return { ...option, ...(eligibleDealerIds === undefined ? {} : { eligibleDealerIds }) };
}

function allocationChoices(
    options: readonly DealerCustomerAllocationOption[],
    dealers: readonly DealerCustomerAllocationDealer[]
): IndexedChoice[] {
    const choices: IndexedChoice[] = [];
    for (const option of options) {
        const eligible = option.eligibleDealerIds === undefined
            ? undefined
            : new Set(option.eligibleDealerIds);
        for (const dealer of dealers) {
            if (eligible !== undefined && !eligible.has(dealer.dealerId)) continue;
            const dealerCut = option.expectedRevenue * dealer.salesCutPercentage;
            const expectedProfitAfterDealerCut = option.expectedProfitBeforeDealerCut - dealerCut;
            choices.push({
                internalOptionId: `choice:${JSON.stringify([
                    option.optionId,
                    dealer.dealerId,
                ])}`,
                option,
                dealer,
                dealerCut,
                expectedProfitAfterDealerCut,
            });
        }
    }
    return choices;
}

function resolvedAllocation(choice: IndexedChoice): DealerCustomerAllocation {
    return {
        customerId: choice.option.customerId,
        optionId: choice.option.optionId,
        dealerId: choice.dealer.dealerId,
        productionCost: choice.option.productionCost,
        expectedRevenue: choice.option.expectedRevenue,
        expectedProfitBeforeDealerCut: choice.option.expectedProfitBeforeDealerCut,
        dealerCut: choice.dealerCut,
        expectedProfitAfterDealerCut: choice.expectedProfitAfterDealerCut,
        resourceUsage: choice.option.resourceUsage,
    };
}

function summarizeCandidate(
    allocations: readonly DealerCustomerAllocation[],
    active: readonly DealerCustomerAllocationDealer[],
    resourceIds: ReadonlySet<string>
): Candidate {
    const productionCost = sum(allocations, ({ productionCost: value }) => value);
    const expectedRevenue = sum(allocations, ({ expectedRevenue: value }) => value);
    const expectedProfitBeforeDealerCosts = sum(
        allocations,
        ({ expectedProfitBeforeDealerCut: value }) => value
    );
    const dealerCut = sum(allocations, ({ dealerCut: value }) => value);
    const signingFees = sum(active, ({ signingFeeCharged: value }) => value);
    return {
        allocations,
        productionCost,
        expectedRevenue,
        expectedProfitBeforeDealerCosts,
        dealerCut,
        signingFees,
        expectedProfit: expectedProfitBeforeDealerCosts - dealerCut - signingFees,
        resourceUsage: [...resourceIds].sort().flatMap((resourceId) => {
            const quantity = sum(allocations, ({ resourceUsage }) =>
                resourceUsage.find((usage) => usage.resourceId === resourceId)?.quantity ?? 0
            );
            return quantity === 0 ? [] : [{ resourceId, quantity }];
        }),
    };
}

function betterCandidate(left: Candidate, right: Candidate): boolean {
    if (left.expectedProfit !== right.expectedProfit) return left.expectedProfit > right.expectedProfit;
    if (left.productionCost !== right.productionCost) return left.productionCost < right.productionCost;
    if (left.dealerCut !== right.dealerCut) return left.dealerCut < right.dealerCut;
    if (left.signingFees !== right.signingFees) return left.signingFees < right.signingFees;
    return compareAllocationLists(left.allocations, right.allocations) < 0;
}

function compareAllocationLists(
    left: readonly DealerCustomerAllocation[],
    right: readonly DealerCustomerAllocation[]
): number {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
        const comparison = compareAllocations(left[index]!, right[index]!);
        if (comparison !== 0) return comparison;
    }
    return left.length - right.length;
}

function compareAllocations(left: DealerCustomerAllocation, right: DealerCustomerAllocation): number {
    return compareString(left.customerId, right.customerId) ||
        compareString(left.optionId, right.optionId) ||
        compareString(left.dealerId, right.dealerId);
}

function emptyCandidate(): Candidate {
    return {
        allocations: [],
        productionCost: 0,
        expectedRevenue: 0,
        expectedProfitBeforeDealerCosts: 0,
        dealerCut: 0,
        signingFees: 0,
        expectedProfit: 0,
        resourceUsage: [],
    };
}

function unusedResourcePrefix(resourceIds: ReadonlySet<string>): string {
    let prefix = '#dealer-capacity:';
    while ([...resourceIds].some((resourceId) => resourceId.startsWith(prefix))) prefix = `#${prefix}`;
    return prefix;
}

function advanceSubset(selected: boolean[]): boolean {
    for (let index = selected.length - 1; index >= 0; index--) {
        if (!selected[index]) {
            selected[index] = true;
            return true;
        }
        selected[index] = false;
    }
    return false;
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

function sum<T>(values: readonly T[], select: (value: T) => number): number {
    return values.reduce((total, value) => total + select(value), 0);
}

function compareString(left: string, right: string): number {
    if (left === right) return 0;
    return left < right ? -1 : 1;
}

function requireId(value: string, label: string): void {
    if (value.trim().length === 0) throw new Error(`${label} ID must not be blank`);
}

function requireFinite(value: number, label: string): void {
    if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function requireNonNegativeFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative`);
}

function requirePercentage(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`${label} must be between zero and one`);
    }
}

function requirePositiveSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${label} must be a positive safe integer`);
    }
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${label} must be a non-negative safe integer`);
    }
}
