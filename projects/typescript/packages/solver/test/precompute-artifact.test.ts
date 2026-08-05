import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    buildRecipeCorpusManifest,
    describeCorpusFile,
    verifyRecipeCorpusArtifact,
} from '#solver/precompute-artifact';
import { writeRecipeCorpusIndexArtifact } from '#solver/precompute-index-artifact';
import { RecipeCorpusLookup } from '#solver/precompute-query';
import {
    partitionPath,
    type RecipeCorpusConfiguration,
    type RecipeCorpusDatasetIdentity,
    type RecipeCorpusPartition,
} from '#solver/precompute';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) =>
            rm(directory, { recursive: true, force: true })
        )
    );
});

describe('recipe corpus artifact', () => {
    it('verifies a complete hash-addressed selective artifact', async () => {
        const artifact = await writeArtifact();

        const verified = await verifyRecipeCorpusArtifact(artifact.directory);

        expect(verified.artifactSha256).toBe(artifact.artifactSha256);
        expect(verified.counts).toEqual({
            products: 1,
            ingredients: 1,
            partitions: 2,
            recipes: 2,
        });
    });

    it('rejects a partition changed after the manifest was written', async () => {
        const artifact = await writeArtifact();
        await writeFile(artifact.partitionPaths[1]!, '{}\n', 'utf8');

        await expect(verifyRecipeCorpusArtifact(artifact.directory)).rejects.toThrow(
            'failed integrity verification'
        );
    });

    it('queries indexed effects and costs without scanning corpus files', async () => {
        const artifact = await writeArtifact();
        const indexRoot = await mkdtemp(path.join(tmpdir(), 'neonschedule1-corpus-index-'));
        temporaryDirectories.push(indexRoot);
        const indexed = await writeRecipeCorpusIndexArtifact(indexRoot, artifact.directory);
        const lookup = await RecipeCorpusLookup.load(artifact.directory, indexed.directory);

        const mixed = await lookup.query({ requiredEffectIds: ['mixed-effect'], limit: 1 });
        const affordable = await lookup.query({ maximumTotalCost: 4, limit: 10 });

        expect(mixed.recipes.map((recipe) => recipe.ingredientIds)).toEqual([['ingredient']]);
        expect(affordable.recipes.map((recipe) => recipe.ingredientIds)).toEqual([[]]);
        expect(mixed.evidence.examinedRankingEntries).toBe(1);
        expect(affordable.evidence.examinedRankingEntries).toBe(1);
    });
});

async function writeArtifact(): Promise<{
    readonly directory: string;
    readonly artifactSha256: string;
    readonly partitionPaths: readonly string[];
}> {
    const directory = await mkdtemp(path.join(tmpdir(), 'neonschedule1-corpus-'));
    temporaryDirectories.push(directory);
    const partitions = [partition(0), partition(1)];
    const files = [];
    const partitionPaths: string[] = [];
    for (const value of partitions) {
        const relativePath = partitionPath(value);
        const content = Buffer.from(`${JSON.stringify(value)}\n`);
        const output = path.join(directory, ...relativePath.split('/'));
        await mkdir(path.dirname(output), { recursive: true });
        await writeFile(output, content);
        partitionPaths.push(output);
        files.push(describeCorpusFile(relativePath, content, value));
    }
    const manifest = buildRecipeCorpusManifest(dataset, configuration, '2', files);
    await writeFile(
        path.join(directory, 'manifest.json'),
        `${JSON.stringify(manifest)}\n`,
        'utf8'
    );
    return { directory, artifactSha256: manifest.artifactSha256, partitionPaths };
}

function partition(depth: number): RecipeCorpusPartition {
    const ingredientIds = depth === 0 ? [] : ['ingredient'];
    const effectIds = depth === 0 ? ['base-effect'] : ['mixed-effect'];
    const ingredientCost = depth * 2;
    const productValue = 10 + depth * 5;
    return {
        schema: 'neonschedule1-recipe-corpus-partition-1',
        algorithmVersion: '1',
        dataset,
        coverage: {
            mode: 'selective',
            semantics: 'cheapest-representative-per-ordered-effect-state',
            productId: 'product',
            drugType: 'TestDrug',
            resultDepth: depth,
            maxIngredients: 1,
            ingredientIds: ['ingredient'],
            requiredEffectIds: [],
            forbiddenEffectIds: [],
        },
        proof: {
            proofStatus: 'exact',
            stopReason: 'completed',
            exploredStates: 2,
            prunedStates: 0,
            completedDepth: 1,
        },
        recipes: [
            {
                productId: 'product',
                drugType: 'TestDrug',
                ingredientIds,
                effectIds,
                depth,
                productValue,
                costs: {
                    baseProduct: 4,
                    baseProductBasis: 'base-purchase-price',
                    ingredients: ingredientCost,
                    total: 4 + ingredientCost,
                },
                netValue: productValue - 4 - ingredientCost,
            },
        ],
    };
}

const dataset: RecipeCorpusDatasetIdentity = {
    gameVersion: 'test-game',
    datasetSha256: 'a'.repeat(64),
    normalizerVersion: 'test-normalizer',
};

const configuration: RecipeCorpusConfiguration = {
    mode: 'selective',
    productIds: ['product'],
    ingredientIds: ['ingredient'],
    maxIngredients: 1,
    maxStates: 100,
    requiredEffectIds: [],
    forbiddenEffectIds: [],
};
