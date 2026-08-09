import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    readBinaryRecipeCorpusIndex,
    writeBinaryRecipeCorpusIndex,
} from '#solver/precompute-index-binary';
import { verifyRecipeCorpusIndexArtifact } from '#solver/precompute-index-artifact';
import type { RecipeCorpusIndex } from '#solver/precompute-index';

describe('recipe corpus binary index', () => {
    it('round-trips verified runtime columns', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'neonschedule1-binary-index-'));
        try {
            const output = path.join(directory, 'lookup.bin');
            const file = await writeBinaryRecipeCorpusIndex(output, index(), partitions);
            const content = await readFile(output);
            const runtime = readBinaryRecipeCorpusIndex(content);

            expect(file.path).toBe('lookup.bin');
            expect(file.byteLength).toBeGreaterThan(0);
            expect(runtime.partitionPathAt(1)).toBe('partition-b.json');
            expect(runtime.recipeIndexAt(1)).toBe(0);
            expect([...runtime.totalCosts]).toEqual([4, 12.5]);
            expect([...runtime.postings.effects.effect]).toEqual([0, 1]);
            expect(() => readBinaryRecipeCorpusIndex(
                Buffer.concat([content, Buffer.from([0])])
            )).toThrow('trailing bytes');
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it.each([
        ['manifest-1 with lookup.json', 'neonschedule1-recipe-corpus-index-manifest-1', 'lookup.json'],
        ['manifest-2 with lookup.bin', 'neonschedule1-recipe-corpus-index-manifest-2', 'lookup.bin'],
    ])('rejects stale %s artifacts clearly', async (_label, schema, fileName) => {
        const directory = await mkdtemp(path.join(tmpdir(), 'neonschedule1-stale-index-'));
        try {
            const manifest = {
                schema,
                file: { path: fileName },
            };
            await writeFile(path.join(directory, fileName), '{}\n');
            await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest)}\n`);

            await expect(verifyRecipeCorpusIndexArtifact(directory)).rejects.toThrow(
                'Recipe index artifact is stale or unsupported; expected manifest with lookup.bin'
            );
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});

const partitions = [
    { path: 'partition-a.json', recipeCount: 2 },
    { path: 'partition-b.json', recipeCount: 1 },
] as const;

function index(): RecipeCorpusIndex {
    return {
        schema: 'neonschedule1-recipe-corpus-index-1',
        algorithmVersion: '1',
        corpus: {
            artifactSha256: 'a'.repeat(64),
            coverageKey: 'b'.repeat(64),
            datasetSha256: 'c'.repeat(64),
        },
        records: [
            { partitionPath: 'partition-a.json', recipeIndex: 1, totalCost: 4 },
            { partitionPath: 'partition-b.json', recipeIndex: 0, totalCost: 12.5 },
        ],
        postings: { products: { product: [0, 1] }, effects: { effect: [0, 1] } },
        rankings: { productValue: [1, 0], netValue: [0, 1] },
        totalCostOrder: [0, 1],
    };
}
