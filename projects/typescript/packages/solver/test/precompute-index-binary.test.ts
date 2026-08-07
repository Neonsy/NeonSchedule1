import { createHash } from 'node:crypto';
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
import { RuntimeRecipeCorpusIndex } from '#solver/runtime-index';

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

    it('loads the previous JSON artifact contract for rollback', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'neonschedule1-json-index-'));
        try {
            const source = index();
            const lookup = Buffer.from(`${JSON.stringify(source)}\n`, 'utf8');
            const file = {
                path: 'lookup.json' as const,
                sha256: sha256(lookup),
                byteLength: lookup.byteLength,
            };
            const body = {
                algorithmVersion: '1',
                corpus: source.corpus,
                counts: { recipes: 2, products: 1, effects: 1 },
                file,
            };
            const manifest = {
                schema: 'neonschedule1-recipe-corpus-index-manifest-1',
                artifactSha256: sha256(Buffer.from(JSON.stringify(body), 'utf8')),
                ...body,
            };
            await writeFile(path.join(directory, file.path), lookup);
            await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest)}\n`);

            const verified = await verifyRecipeCorpusIndexArtifact(directory);

            expect(verified.manifest.schema).toBe(manifest.schema);
            expect(verified.index).not.toBeInstanceOf(RuntimeRecipeCorpusIndex);
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

function sha256(content: Uint8Array): string {
    return createHash('sha256').update(content).digest('hex');
}
