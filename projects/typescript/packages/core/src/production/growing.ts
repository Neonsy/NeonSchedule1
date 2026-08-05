import type { Item } from '#core/data/item';
import type { ProductionQualityRules } from '#core/data/production';

export interface SelectedGrowAdditive {
    readonly itemId: string;
    readonly qualityChange: number;
    readonly yieldMultiplier: number;
    readonly instantGrowth: number;
}

export interface HarvestQuality {
    readonly level: number;
    readonly tier: string;
    readonly customerScalar: number;
}

export function selectGrowAdditives(
    itemsById: ReadonlyMap<string, Item>,
    containerItemId: string | null,
    allowedItemIds: readonly string[],
    itemIds: readonly string[]
): readonly SelectedGrowAdditive[] {
    if (itemIds.length === 0) return [];
    if (containerItemId === null) throw new Error('Additives cannot be selected without a grow container');

    const uniqueItemIds = new Set(itemIds);
    if (uniqueItemIds.size !== itemIds.length) throw new Error('A grow additive can only be selected once');

    return [...uniqueItemIds].sort().map((itemId) => {
        const additive = itemsById.get(itemId)?.additive;
        if (additive === null || additive === undefined) {
            throw new Error(`Unknown grow additive ${JSON.stringify(itemId)}`);
        }
        if (!allowedItemIds.includes(itemId)) {
            throw new Error(
                `Grow container ${JSON.stringify(containerItemId)} does not accept additive ${JSON.stringify(itemId)}`
            );
        }
        return { itemId, ...additive };
    });
}

export function stackedYieldMultiplier(
    initial: number,
    additives: readonly SelectedGrowAdditive[]
): number {
    return additives.reduce(
        (result, additive) =>
            additive.yieldMultiplier === 0
                ? result
                : Math.max(0, result * additive.yieldMultiplier),
        initial
    );
}

export function harvestQuality(
    rules: ProductionQualityRules,
    additives: readonly SelectedGrowAdditive[]
): HarvestQuality {
    const level = additives.reduce(
        (result, additive) => Math.fround(result + Math.fround(additive.qualityChange)),
        Math.fround(rules.basePlantLevel)
    );
    const tier = rules.tiers
        .filter(
            (candidate) =>
                candidate.minimumLevelExclusive === null || level > candidate.minimumLevelExclusive
        )
        .sort(
            (left, right) =>
                (right.minimumLevelExclusive ?? Number.NEGATIVE_INFINITY) -
                (left.minimumLevelExclusive ?? Number.NEGATIVE_INFINITY)
        )[0];
    if (tier === undefined) throw new Error('Production quality rules have no matching tier');
    return { level, tier: tier.name, customerScalar: tier.customerScalar };
}

export function harvestCount(baseYieldQuantity: number, yieldMultiplier = 1): number {
    return Math.max(1, Math.round(baseYieldQuantity * yieldMultiplier));
}

export function adjustedGrowthMinutes(
    growthTimeMinutes: number,
    containerSpeedMultiplier = 1,
    lightSpeedMultiplier = 1,
    instantGrowth = 0
): number {
    const remainingGrowth = Math.max(0, 1 - Math.max(0, instantGrowth));
    const duration =
        (growthTimeMinutes * remainingGrowth) / (containerSpeedMultiplier * lightSpeedMultiplier);
    const nearestMinute = Math.round(duration);
    return Math.abs(duration - nearestMinute) <= 1e-3 ? nearestMinute : Math.ceil(duration);
}
