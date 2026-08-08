export interface CustomerAllocationResourceLimit {
    readonly resourceId: string;
    readonly quantity: number;
}

export interface CustomerAllocationResourceUsage {
    readonly resourceId: string;
    readonly quantity: number;
}

export interface CustomerAllocationOption {
    readonly optionId: string;
    readonly customerId: string;
    readonly productionCost: number;
    readonly expectedProfit: number;
    readonly resourceUsage: readonly CustomerAllocationResourceUsage[];
}

export interface CustomerAllocationInput {
    readonly customerIds: readonly string[];
    readonly options: Iterable<CustomerAllocationOption>;
    readonly maximumProductionCost: number;
    readonly resourceLimits: readonly CustomerAllocationResourceLimit[];
    readonly maximumStates: number;
}

export interface CustomerAllocation {
    readonly customerId: string;
    readonly optionId: string;
}

export interface CustomerAllocationEvidence {
    readonly visitedStates: number;
    readonly maximumStates: number;
    readonly discardedInfeasibleOptions: number;
    readonly discardedNonPositiveOptions: number;
    readonly discardedDominatedOptions: number;
    readonly prunedByProductionCost: number;
    readonly prunedByResources: number;
    readonly prunedByProfitBound: number;
    readonly prunedByEquivalentState: number;
}

export interface CustomerAllocationResult {
    readonly status: 'exact' | 'state-limit';
    readonly allocations: readonly CustomerAllocation[];
    readonly unallocatedCustomerIds: readonly string[];
    readonly productionCost: number;
    readonly expectedProfit: number;
    readonly resourceUsage: readonly CustomerAllocationResourceUsage[];
    readonly evidence: CustomerAllocationEvidence;
}

interface IndexedOption extends CustomerAllocationOption {
    readonly usage: readonly number[];
}

interface OptionGroup {
    readonly customerId: string;
    readonly options: readonly IndexedOption[];
    readonly maximumProfit: number;
}

interface Selection {
    readonly options: readonly IndexedOption[];
    readonly productionCost: number;
    readonly expectedProfit: number;
    readonly usage: readonly number[];
}

interface MutableEvidence {
    visitedStates: number;
    discardedInfeasibleOptions: number;
    discardedNonPositiveOptions: number;
    discardedDominatedOptions: number;
    prunedByProductionCost: number;
    prunedByResources: number;
    prunedByProfitBound: number;
    prunedByEquivalentState: number;
}

interface MemoizedSelection {
    readonly expectedProfit: number;
    readonly options: readonly IndexedOption[];
}

export class CustomerAllocationOptimizer {
    optimize(input: CustomerAllocationInput): CustomerAllocationResult {
        const normalized = normalize(input);
        const groups = orderGroups(normalized.groups);
        const suffixProfit = maximumRemainingProfit(groups);
        const evidence = normalized.evidence;
        const memo = new Map<string, MemoizedSelection>();
        let best = emptySelection(normalized.resourceIds.length);
        let stateLimitReached = false;

        const visit = (
            groupIndex: number,
            selected: readonly IndexedOption[],
            productionCost: number,
            expectedProfit: number,
            usage: readonly number[]
        ): void => {
            if (evidence.visitedStates >= input.maximumStates) {
                stateLimitReached = true;
                return;
            }
            evidence.visitedStates++;

            const stateKey = allocationStateKey(groupIndex, productionCost, usage);
            const previous = memo.get(stateKey);
            if (
                previous !== undefined &&
                (previous.expectedProfit > expectedProfit ||
                    previous.expectedProfit === expectedProfit &&
                    compareAllocationKeys(previous.options, selected) <= 0)
            ) {
                evidence.prunedByEquivalentState++;
                return;
            }
            memo.set(stateKey, { expectedProfit, options: selected });

            const candidate = { options: selected, productionCost, expectedProfit, usage };
            if (isBetter(candidate, best)) best = candidate;
            if (groupIndex === groups.length) return;
            if (safelyBelow(expectedProfit + suffixProfit[groupIndex]!, best.expectedProfit, groups.length)) {
                evidence.prunedByProfitBound++;
                return;
            }

            const group = groups[groupIndex]!;
            for (const option of group.options) {
                const nextCost = productionCost + option.productionCost;
                if (nextCost > input.maximumProductionCost) {
                    evidence.prunedByProductionCost++;
                    continue;
                }
                const nextUsage = addUsage(usage, option.usage);
                if (exceeds(nextUsage, normalized.resourceLimits)) {
                    evidence.prunedByResources++;
                    continue;
                }
                visit(
                    groupIndex + 1,
                    [...selected, option],
                    nextCost,
                    expectedProfit + option.expectedProfit,
                    nextUsage
                );
                if (stateLimitReached) return;
            }
            visit(groupIndex + 1, selected, productionCost, expectedProfit, usage);
        };

        visit(0, [], 0, 0, normalized.resourceIds.map(() => 0));
        const allocations = canonicalOptions(best.options).map(({ customerId, optionId }) => ({
            customerId,
            optionId,
        }));
        const allocatedCustomerIds = new Set(allocations.map(({ customerId }) => customerId));

        return {
            status: stateLimitReached ? 'state-limit' : 'exact',
            allocations,
            unallocatedCustomerIds: normalized.customerIds.filter(
                (customerId) => !allocatedCustomerIds.has(customerId)
            ),
            productionCost: best.productionCost,
            expectedProfit: best.expectedProfit,
            resourceUsage: normalized.resourceIds.flatMap((resourceId, index) => {
                const quantity = best.usage[index]!;
                return quantity === 0 ? [] : [{ resourceId, quantity }];
            }),
            evidence: {
                ...evidence,
                maximumStates: input.maximumStates,
            },
        };
    }
}

function normalize(input: CustomerAllocationInput): {
    readonly customerIds: readonly string[];
    readonly resourceIds: readonly string[];
    readonly resourceLimits: readonly number[];
    readonly groups: readonly OptionGroup[];
    readonly evidence: MutableEvidence;
} {
    requireNonNegativeFinite(input.maximumProductionCost, 'Maximum production cost');
    requirePositiveSafeInteger(input.maximumStates, 'Maximum allocation states');
    const customerIds = uniqueIds(input.customerIds, 'customer');
    const customerSet = new Set(customerIds);
    const limits = new Map<string, number>();
    for (const limit of input.resourceLimits) {
        requireId(limit.resourceId, 'Allocation resource');
        requireNonNegativeSafeInteger(limit.quantity, `Resource ${JSON.stringify(limit.resourceId)} limit`);
        if (limits.has(limit.resourceId)) {
            throw new Error(`Duplicate allocation resource ${JSON.stringify(limit.resourceId)}`);
        }
        limits.set(limit.resourceId, limit.quantity);
    }
    const resourceIds = [...limits.keys()].sort();
    const resourceLimits = resourceIds.map((resourceId) => limits.get(resourceId)!);
    const resourceIndexes = new Map(resourceIds.map((resourceId, index) => [resourceId, index]));
    const evidence = emptyEvidence();
    const optionIds = new Set<string>();
    const grouped = new Map(customerIds.map((customerId) => [customerId, [] as IndexedOption[]]));

    for (const option of input.options) {
        validateOption(option, customerSet, optionIds);
        const usage = indexUsage(option, resourceIndexes);
        const indexed = { ...option, usage };
        if (
            option.productionCost > input.maximumProductionCost ||
            exceeds(usage, resourceLimits)
        ) {
            evidence.discardedInfeasibleOptions++;
        } else if (option.expectedProfit <= 0) {
            evidence.discardedNonPositiveOptions++;
        } else {
            grouped.get(option.customerId)!.push(indexed);
        }
    }

    const groups = customerIds.map((customerId): OptionGroup => {
        const options = removeDominated(grouped.get(customerId)!, evidence);
        return {
            customerId,
            options,
            maximumProfit: options[0]?.expectedProfit ?? 0,
        };
    });
    return {
        customerIds,
        resourceIds,
        resourceLimits,
        groups,
        evidence,
    };
}

function validateOption(
    option: CustomerAllocationOption,
    customerIds: ReadonlySet<string>,
    optionIds: Set<string>
): void {
    requireId(option.optionId, 'Allocation option');
    requireId(option.customerId, 'Allocation option customer');
    if (!customerIds.has(option.customerId)) {
        throw new Error(`Unknown allocation customer ${JSON.stringify(option.customerId)}`);
    }
    if (optionIds.has(option.optionId)) {
        throw new Error(`Duplicate allocation option ${JSON.stringify(option.optionId)}`);
    }
    optionIds.add(option.optionId);
    requireNonNegativeFinite(option.productionCost, `Option ${JSON.stringify(option.optionId)} production cost`);
    if (!Number.isFinite(option.expectedProfit)) {
        throw new Error(`Option ${JSON.stringify(option.optionId)} expected profit must be finite`);
    }
}

function indexUsage(
    option: CustomerAllocationOption,
    resourceIndexes: ReadonlyMap<string, number>
): number[] {
    const result = [...resourceIndexes].map(() => 0);
    const seen = new Set<string>();
    for (const usage of option.resourceUsage) {
        requireId(usage.resourceId, 'Allocation resource usage');
        const index = resourceIndexes.get(usage.resourceId);
        if (index === undefined) {
            throw new Error(`Unknown allocation resource ${JSON.stringify(usage.resourceId)}`);
        }
        if (seen.has(usage.resourceId)) {
            throw new Error(
                `Duplicate resource ${JSON.stringify(usage.resourceId)} in option ${JSON.stringify(option.optionId)}`
            );
        }
        seen.add(usage.resourceId);
        requirePositiveSafeInteger(
            usage.quantity,
            `Option ${JSON.stringify(option.optionId)} resource ${JSON.stringify(usage.resourceId)} quantity`
        );
        result[index] = usage.quantity;
    }
    return result;
}

function removeDominated(
    options: readonly IndexedOption[],
    evidence: MutableEvidence
): IndexedOption[] {
    const ordered = [...options].sort(compareOptions);
    return ordered.filter((candidate, index) => {
        const dominated = ordered.some(
            (other, otherIndex) => otherIndex !== index && dominates(other, candidate)
        );
        if (dominated) evidence.discardedDominatedOptions++;
        return !dominated;
    });
}

function dominates(left: IndexedOption, right: IndexedOption): boolean {
    if (left.expectedProfit < right.expectedProfit || left.productionCost > right.productionCost) {
        return false;
    }
    if (left.usage.some((quantity, index) => quantity > right.usage[index]!)) return false;
    return left.expectedProfit > right.expectedProfit ||
        left.productionCost < right.productionCost ||
        left.usage.some((quantity, index) => quantity < right.usage[index]!) ||
        left.optionId < right.optionId;
}

function orderGroups(groups: readonly OptionGroup[]): OptionGroup[] {
    return [...groups].sort((left, right) =>
        right.maximumProfit - left.maximumProfit ||
        left.options.length - right.options.length ||
        compareString(left.customerId, right.customerId)
    );
}

function maximumRemainingProfit(groups: readonly OptionGroup[]): number[] {
    const result = Array<number>(groups.length + 1).fill(0);
    for (let index = groups.length - 1; index >= 0; index--) {
        result[index] = result[index + 1]! + groups[index]!.maximumProfit;
        if (!Number.isFinite(result[index])) {
            throw new Error('Maximum customer allocation profit must be finite');
        }
    }
    return result;
}

function isBetter(candidate: Selection, incumbent: Selection): boolean {
    if (candidate.expectedProfit !== incumbent.expectedProfit) {
        return candidate.expectedProfit > incumbent.expectedProfit;
    }
    if (candidate.productionCost !== incumbent.productionCost) {
        return candidate.productionCost < incumbent.productionCost;
    }
    const usageComparison = compareNumbers(candidate.usage, incumbent.usage);
    if (usageComparison !== 0) return usageComparison < 0;
    return compareAllocationKeys(candidate.options, incumbent.options) < 0;
}

function compareOptions(left: IndexedOption, right: IndexedOption): number {
    return right.expectedProfit - left.expectedProfit ||
        left.productionCost - right.productionCost ||
        compareNumbers(left.usage, right.usage) ||
        compareString(left.optionId, right.optionId);
}

function compareAllocationKeys(
    left: readonly IndexedOption[],
    right: readonly IndexedOption[]
): number {
    const leftCanonical = canonicalOptions(left);
    const rightCanonical = canonicalOptions(right);
    for (let index = 0; index < Math.min(leftCanonical.length, rightCanonical.length); index++) {
        const leftOption = leftCanonical[index]!;
        const rightOption = rightCanonical[index]!;
        const comparison = compareString(leftOption.customerId, rightOption.customerId) ||
            compareString(leftOption.optionId, rightOption.optionId);
        if (comparison !== 0) return comparison;
    }
    return leftCanonical.length - rightCanonical.length;
}

function canonicalOptions(options: readonly IndexedOption[]): IndexedOption[] {
    return [...options].sort((left, right) =>
        compareString(left.customerId, right.customerId) ||
        compareString(left.optionId, right.optionId)
    );
}

function addUsage(left: readonly number[], right: readonly number[]): number[] {
    return left.map((quantity, index) => quantity + right[index]!);
}

function exceeds(usage: readonly number[], limits: readonly number[]): boolean {
    return usage.some((quantity, index) => quantity > limits[index]!);
}

function safelyBelow(upperBound: number, incumbent: number, groupCount: number): boolean {
    const scale = Math.max(1, Math.abs(upperBound), Math.abs(incumbent));
    const slack = Number.EPSILON * scale * (groupCount + 1) * 4;
    return upperBound < incumbent - slack;
}

function allocationStateKey(
    groupIndex: number,
    productionCost: number,
    usage: readonly number[]
): string {
    return `${groupIndex}|${productionCost}|${usage.join(',')}`;
}

function compareNumbers(left: readonly number[], right: readonly number[]): number {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
        const comparison = left[index]! - right[index]!;
        if (comparison !== 0) return comparison;
    }
    return left.length - right.length;
}

function uniqueIds(ids: readonly string[], kind: string): string[] {
    const unique = new Set<string>();
    for (const id of ids) {
        requireId(id, `Allocation ${kind}`);
        if (unique.has(id)) throw new Error(`Duplicate allocation ${kind} ${JSON.stringify(id)}`);
        unique.add(id);
    }
    return [...unique].sort();
}

function emptySelection(resourceCount: number): Selection {
    return { options: [], productionCost: 0, expectedProfit: 0, usage: Array(resourceCount).fill(0) };
}

function emptyEvidence(): MutableEvidence {
    return {
        visitedStates: 0,
        discardedInfeasibleOptions: 0,
        discardedNonPositiveOptions: 0,
        discardedDominatedOptions: 0,
        prunedByProductionCost: 0,
        prunedByResources: 0,
        prunedByProfitBound: 0,
        prunedByEquivalentState: 0,
    };
}

function requireId(value: string, label: string): void {
    if (value.length === 0) throw new Error(`${label} ID must not be empty`);
}

function requireNonNegativeFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative`);
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

function compareString(left: string, right: string): number {
    if (left === right) return 0;
    return left < right ? -1 : 1;
}
