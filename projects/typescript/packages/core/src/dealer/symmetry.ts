import type {
    DealerCustomerAllocationDealer,
    DealerCustomerAllocationOption,
} from '#core/dealer/customer-allocation';

export interface EquivalentDealerClass {
    readonly classId: string;
    readonly dealers: readonly DealerCustomerAllocationDealer[];
    readonly maximumCustomers: number;
    readonly salesCutPercentage: number;
}

export interface ActiveDealerClass extends EquivalentDealerClass {
    readonly selectedDealers: readonly DealerCustomerAllocationDealer[];
    readonly totalCapacity: number;
}

export function equivalentDealerClasses(
    dealers: readonly DealerCustomerAllocationDealer[],
    options: readonly DealerCustomerAllocationOption[]
): EquivalentDealerClass[] {
    const grouped = new Map<string, DealerCustomerAllocationDealer[]>();
    for (const dealer of dealers) {
        const eligibleOptionIds = options
            .filter((option) => option.eligibleDealerIds === undefined ||
                option.eligibleDealerIds.includes(dealer.dealerId))
            .map(({ optionId }) => optionId)
            .sort();
        const key = JSON.stringify([
            dealer.maximumCustomers,
            dealer.salesCutPercentage,
            eligibleOptionIds,
        ]);
        const group = grouped.get(key);
        if (group === undefined) grouped.set(key, [dealer]);
        else group.push(dealer);
    }
    return [...grouped.entries()]
        .sort(([left], [right]) => compareString(left, right))
        .map(([, group], index) => ({
            classId: `dealer-class:${index}`,
            dealers: [...group].sort(compareDealerActivation),
            maximumCustomers: group[0]!.maximumCustomers,
            salesCutPercentage: group[0]!.salesCutPercentage,
        }));
}

export function activeDealerClasses(
    classes: readonly EquivalentDealerClass[],
    selectedCounts: readonly number[]
): ActiveDealerClass[] {
    return classes.flatMap((dealerClass, index) => {
        const count = selectedCounts[index]!;
        if (count === 0) return [];
        return [{
            ...dealerClass,
            selectedDealers: dealerClass.dealers.slice(0, count),
            totalCapacity: count * dealerClass.maximumCustomers,
        }];
    });
}

export function advanceDealerClassCounts(
    selectedCounts: number[],
    classes: readonly EquivalentDealerClass[]
): boolean {
    for (let index = selectedCounts.length - 1; index >= 0; index--) {
        if (selectedCounts[index]! < classes[index]!.dealers.length) {
            selectedCounts[index] = selectedCounts[index]! + 1;
            return true;
        }
        selectedCounts[index] = 0;
    }
    return false;
}

export function possibleDealerClassSelections(
    classes: readonly EquivalentDealerClass[]
): number | null {
    let result = 1;
    for (const dealerClass of classes) {
        result *= dealerClass.dealers.length + 1;
        if (!Number.isSafeInteger(result)) return null;
    }
    return result;
}

function compareDealerActivation(
    left: DealerCustomerAllocationDealer,
    right: DealerCustomerAllocationDealer
): number {
    return left.signingFeeCharged - right.signingFeeCharged ||
        compareString(left.dealerId, right.dealerId);
}

function compareString(left: string, right: string): number {
    if (left === right) return 0;
    return left < right ? -1 : 1;
}
