import {
    compareRecipeEvaluations,
    type RecipeEvaluation,
    type RecipeSearchObjective,
} from '@neonschedule1/core';

import {
    verifyRecipeCorpusArtifact,
    type RecipeCorpusManifest,
} from '#solver/precompute-artifact';
import type { RecipeCorpusEntry } from '#solver/precompute';

export const recipeCorpusIndexAlgorithmVersion = '1';

export interface RecipeCorpusIndex {
    readonly schema: 'neonschedule1-recipe-corpus-index-1';
    readonly algorithmVersion: string;
    readonly corpus: {
        readonly artifactSha256: string;
        readonly coverageKey: string;
        readonly datasetSha256: string;
    };
    readonly records: readonly RecipeCorpusIndexRecord[];
    readonly postings: {
        readonly products: Readonly<Record<string, readonly number[]>>;
        readonly effects: Readonly<Record<string, readonly number[]>>;
    };
    readonly rankings: Readonly<Record<RecipeSearchObjective, readonly number[]>>;
    readonly totalCostOrder: readonly number[];
}

export interface RecipeCorpusIndexRecord {
    readonly partitionPath: string;
    readonly recipeIndex: number;
    readonly totalCost: number;
}

interface IndexedRecipe {
    readonly ordinal: number;
    readonly entry: RecipeCorpusEntry;
}

export async function buildRecipeCorpusIndex(
    corpusDirectory: string
): Promise<{ readonly manifest: RecipeCorpusManifest; readonly index: RecipeCorpusIndex }> {
    const indexedRecipes: IndexedRecipe[] = [];
    const records: RecipeCorpusIndexRecord[] = [];
    const products = new Map<string, number[]>();
    const effects = new Map<string, number[]>();
    const manifest = await verifyRecipeCorpusArtifact(
        corpusDirectory,
        (partition, file) => {
            partition.recipes.forEach((entry, recipeIndex) => {
                const ordinal = records.length;
                indexedRecipes.push({ ordinal, entry });
                records.push({
                    partitionPath: file.path,
                    recipeIndex,
                    totalCost: entry.costs.total,
                });
                addPosting(products, entry.productId, ordinal);
                for (const effectId of entry.effectIds) addPosting(effects, effectId, ordinal);
            });
        }
    );
    if (records.length !== manifest.counts.recipes) {
        throw new Error(
            `Indexed ${records.length} recipes, corpus declares ${manifest.counts.recipes}`
        );
    }

    return {
        manifest,
        index: {
            schema: 'neonschedule1-recipe-corpus-index-1',
            algorithmVersion: recipeCorpusIndexAlgorithmVersion,
            corpus: {
                artifactSha256: manifest.artifactSha256,
                coverageKey: manifest.coverageKey,
                datasetSha256: manifest.dataset.datasetSha256,
            },
            records,
            postings: {
                products: postingRecord(products),
                effects: postingRecord(effects),
            },
            rankings: {
                productValue: ranking(indexedRecipes, 'productValue'),
                netValue: ranking(indexedRecipes, 'netValue'),
            },
            totalCostOrder: [...indexedRecipes]
                .sort(
                    (left, right) =>
                        left.entry.costs.total - right.entry.costs.total ||
                        left.ordinal - right.ordinal
                )
                .map((value) => value.ordinal),
        },
    };
}

function ranking(
    recipes: readonly IndexedRecipe[],
    objective: RecipeSearchObjective
): number[] {
    return [...recipes]
        .sort(
            (left, right) =>
                compareRecipeEvaluations(
                    evaluation(left.entry),
                    evaluation(right.entry),
                    objective
                ) || left.ordinal - right.ordinal
        )
        .map((value) => value.ordinal);
}

function evaluation(entry: RecipeCorpusEntry): RecipeEvaluation {
    return {
        productId: entry.productId,
        ingredientIds: entry.ingredientIds,
        effectIds: entry.effectIds,
        productValue: entry.productValue,
        baseProductCost: entry.costs.baseProduct,
        baseProductCostBasis: entry.costs.baseProductBasis,
        ingredientCost: entry.costs.ingredients,
        totalCost: entry.costs.total,
        netValue: entry.netValue,
        ingredientCount: entry.depth,
    };
}

function addPosting(postings: Map<string, number[]>, key: string, ordinal: number): void {
    const values = postings.get(key) ?? [];
    values.push(ordinal);
    postings.set(key, values);
}

function postingRecord(
    postings: ReadonlyMap<string, readonly number[]>
): Record<string, readonly number[]> {
    return Object.fromEntries(
        [...postings.entries()].sort(([left], [right]) => left.localeCompare(right))
    );
}
