import { type } from 'arktype';

export const RankLevelSchema = type({
    rank: 'string',
    tier: 'number',
    totalXpRequired: 'number',
    orderLimitMultiplier: 'number',
});
export type RankLevel = typeof RankLevelSchema.infer;

export const RankCatalogSchema = type({
    schema: "'neonschedule1-rank-catalog-1'",
    levels: RankLevelSchema.array(),
});
export type RankCatalog = typeof RankCatalogSchema.infer;

export interface RankReference {
    readonly rank: string;
    readonly tier: number;
}
