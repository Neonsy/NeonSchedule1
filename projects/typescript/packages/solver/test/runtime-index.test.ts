import { describe, expect, it } from 'vitest';

import type { RecipeCorpusIndex } from '#solver/precompute-index';
import { RuntimeRecipeCorpusIndex } from '#solver/runtime-index';

describe('runtime recipe corpus index', () => {
    it('preserves record and ordinal data beyond the byte-sized partition range', () => {
        const partitions = Array.from({ length: 257 }, (_, index) => ({
            path: `partition-${index}.json`,
            recipeCount: 2,
        }));
        const source = index([
            { partitionPath: partitions[0]!.path, recipeIndex: 1, totalCost: 12.5 },
            { partitionPath: partitions[256]!.path, recipeIndex: 0, totalCost: 20 },
        ]);

        const runtime = RuntimeRecipeCorpusIndex.consume(source, partitions);

        expect(runtime.recordCount).toBe(2);
        expect(runtime.partitionPathAt(0)).toBe(partitions[0]!.path);
        expect(runtime.partitionPathAt(1)).toBe(partitions[256]!.path);
        expect(runtime.recipeIndexAt(0)).toBe(1);
        expect([...runtime.totalCosts]).toEqual([12.5, 20]);
        expect(runtime.postings.products.product).toBeInstanceOf(Uint32Array);
        expect(runtime.rankings.productValue).toBeInstanceOf(Uint32Array);
        expect(source.records).toEqual([]);
    });

    it('rejects records that typed columns would otherwise coerce', () => {
        const source = index([
            { partitionPath: 'partition.json', recipeIndex: 2, totalCost: 10 },
        ]);

        expect(() => RuntimeRecipeCorpusIndex.consume(source, [
            { path: 'partition.json', recipeCount: 2 },
        ])).toThrow('invalid recipe index');
    });
});

function index(records: RecipeCorpusIndex['records']): RecipeCorpusIndex {
    const ordinals = records.map((_, ordinal) => ordinal);
    return {
        schema: 'neonschedule1-recipe-corpus-index-2',
        algorithmVersion: '2',
        corpus: {
            artifactSha256: 'a'.repeat(64),
            coverageKey: 'b'.repeat(64),
            datasetSha256: 'c'.repeat(64),
            ruleProfile: { kind: 'standard' },
        },
        records,
        postings: {
            products: { product: ordinals },
            effects: { effect: ordinals },
        },
        rankings: {
            productValue: ordinals,
            netValue: [...ordinals].reverse(),
        },
        totalCostOrder: ordinals,
    };
}
