import {
    RankCatalogSchema,
    type Item,
    type RankCatalog,
    type RankLevel,
} from '@neonschedule1/core';

import type { RawReport } from '#data-compiler/acquisition/types';
import { Integrity } from '#data-compiler/integrity';
import { numberField, stringField } from '#data-compiler/json';

export function normalizeRanks(report: RawReport, integrity: Integrity): RankCatalog {
    const levels = report.world.ranks
        .map((raw, index) => {
            const path = `report.world.ranks[${index}]`;
            return {
                rank: stringField(raw, 'rank', path),
                tier: numberField(raw, 'tier', path),
                totalXpRequired: numberField(raw, 'totalXpRequired', path),
                orderLimitMultiplier: numberField(raw, 'orderLimitMultiplier', path),
            } satisfies RankLevel;
        })
        .sort(
            (left, right) => left.totalXpRequired - right.totalXpRequired ||
                left.rank.localeCompare(right.rank) || left.tier - right.tier
        );
    const seen = new Set<string>();
    let previousXp = -1;
    for (const level of levels) {
        const label = `${level.rank} tier ${level.tier}`;
        const key = `${level.rank}\u0000${level.tier}`;
        integrity.check(
            `rank ${label} is unique`,
            !seen.has(key),
            `Rank ${JSON.stringify(level.rank)} tier ${level.tier} is duplicated`
        );
        seen.add(key);
        integrity.check(
            `rank ${label} tier is a positive safe integer`,
            Number.isSafeInteger(level.tier) && level.tier > 0,
            `Rank ${JSON.stringify(level.rank)} has invalid tier ${level.tier}`
        );
        integrity.check(
            `rank ${label} required XP is a non-negative safe integer`,
            Number.isSafeInteger(level.totalXpRequired) && level.totalXpRequired >= 0,
            `Rank ${JSON.stringify(level.rank)} tier ${level.tier} has invalid required XP`
        );
        integrity.check(
            `rank ${label} follows the prior required-XP boundary`,
            level.totalXpRequired > previousXp,
            `Rank ${JSON.stringify(level.rank)} tier ${level.tier} does not have strictly increasing required XP`
        );
        previousXp = level.totalXpRequired;
        integrity.check(
            `rank ${label} order-limit multiplier is positive`,
            Number.isFinite(level.orderLimitMultiplier) && level.orderLimitMultiplier > 0,
            `Rank ${JSON.stringify(level.rank)} tier ${level.tier} has invalid order-limit multiplier`
        );
    }
    integrity.check(
        'rank catalog is not empty',
        levels.length > 0,
        'The exported rank catalog is empty'
    );
    return RankCatalogSchema.assert({ schema: 'neonschedule1-rank-catalog-1', levels });
}

export function validateItemRankRequirements(
    items: readonly Item[],
    ranks: RankCatalog,
    integrity: Integrity
): void {
    const known = new Set(ranks.levels.map((level) => `${level.rank}\u0000${level.tier}`));
    for (const item of items) {
        if ((item.requiredRank === null) !== (item.requiredRankTier === null)) {
            integrity.addError(`Item ${JSON.stringify(item.id)} has an incomplete rank requirement`);
            continue;
        }
        if (item.requiredRank === null || item.requiredRankTier === null) continue;
        integrity.check(
            `item ${item.id} rank requirement exists`,
            known.has(`${item.requiredRank}\u0000${item.requiredRankTier}`),
            `Item ${JSON.stringify(item.id)} references unknown rank ${JSON.stringify(item.requiredRank)} tier ${item.requiredRankTier}`
        );
    }
}
