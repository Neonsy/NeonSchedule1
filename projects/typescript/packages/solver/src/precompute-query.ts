import type { RecipeSearchObjective } from '@neonschedule1/core';

import {
    readRecipeCorpusPartition,
    verifyRecipeCorpusArtifact,
    type RecipeCorpusFile,
    type RecipeCorpusManifest,
} from '#solver/precompute-artifact';
import {
    verifyRecipeCorpusIndexArtifact,
    type RecipeCorpusIndexManifest,
} from '#solver/precompute-index-artifact';
import type {
    RecipeCorpusIndex,
    RecipeCorpusIndexRecord,
} from '#solver/precompute-index';
import type { RecipeCorpusEntry, RecipeCorpusPartition } from '#solver/precompute';

export interface RecipeCorpusFilter {
    readonly productIds?: readonly string[];
    readonly requiredEffectIds?: readonly string[];
    readonly forbiddenEffectIds?: readonly string[];
    readonly maximumTotalCost?: number;
}

export interface RecipeCorpusQuery extends RecipeCorpusFilter {
    readonly objective?: RecipeSearchObjective;
    readonly limit: number;
}

export interface RecipeCorpusSelectionResult {
    readonly recipes: readonly RecipeCorpusEntry[];
    readonly evidence: {
        readonly source: 'precomputed';
        readonly proofStatus: 'exact';
        readonly corpusArtifactSha256: string;
        readonly indexArtifactSha256: string;
        readonly coverageKey: string;
        readonly candidateCount: number;
    };
}

export interface RecipeCorpusQueryResult {
    readonly recipes: readonly RecipeCorpusEntry[];
    readonly evidence: {
        readonly source: 'precomputed';
        readonly proofStatus: 'exact';
        readonly corpusArtifactSha256: string;
        readonly indexArtifactSha256: string;
        readonly coverageKey: string;
        readonly candidateCount: number;
        readonly examinedRankingEntries: number;
    };
}

export class RecipeCorpusLookup {
    readonly #corpusDirectory: string;
    readonly #corpusManifest: RecipeCorpusManifest;
    readonly #indexManifest: RecipeCorpusIndexManifest;
    readonly #index: RecipeCorpusIndex;
    readonly #filesByPath: ReadonlyMap<string, RecipeCorpusFile>;
    readonly #rankPositions: Readonly<Record<RecipeSearchObjective, Uint32Array>>;
    readonly #minimumCostTrees: Readonly<Record<RecipeSearchObjective, MinimumCostTree>>;
    readonly #partitionCache = new Map<string, RecipeCorpusPartition>();

    private constructor(
        corpusDirectory: string,
        corpusManifest: RecipeCorpusManifest,
        indexManifest: RecipeCorpusIndexManifest,
        index: RecipeCorpusIndex
    ) {
        this.#corpusDirectory = corpusDirectory;
        this.#corpusManifest = corpusManifest;
        this.#indexManifest = indexManifest;
        this.#index = index;
        this.#filesByPath = new Map(corpusManifest.files.map((file) => [file.path, file]));
        this.#rankPositions = {
            productValue: rankPositions(index.rankings.productValue),
            netValue: rankPositions(index.rankings.netValue),
        };
        this.#minimumCostTrees = {
            productValue: minimumCostTree(index.rankings.productValue, index.records),
            netValue: minimumCostTree(index.rankings.netValue, index.records),
        };
    }

    static async load(
        corpusDirectory: string,
        indexDirectory: string
    ): Promise<RecipeCorpusLookup> {
        const [corpusManifest, indexArtifact] = await Promise.all([
            verifyRecipeCorpusArtifact(corpusDirectory),
            verifyRecipeCorpusIndexArtifact(indexDirectory),
        ]);
        if (indexArtifact.manifest.corpus.artifactSha256 !== corpusManifest.artifactSha256 ||
            indexArtifact.manifest.corpus.coverageKey !== corpusManifest.coverageKey ||
            indexArtifact.manifest.corpus.datasetSha256 !== corpusManifest.dataset.datasetSha256) {
            throw new Error('Recipe index belongs to a different corpus');
        }
        return new RecipeCorpusLookup(
            corpusDirectory,
            corpusManifest,
            indexArtifact.manifest,
            indexArtifact.index
        );
    }

    get corpusManifest(): RecipeCorpusManifest {
        return this.#corpusManifest;
    }

    get indexManifest(): RecipeCorpusIndexManifest {
        return this.#indexManifest;
    }

    async query(input: RecipeCorpusQuery): Promise<RecipeCorpusQueryResult> {
        validateQuery(input);
        const objective = input.objective ?? 'productValue';
        const { allowed, forbidden, candidateCount } = filterState(input, this.#index);

        let examinedRankingEntries: number;
        let selectedOrdinals: readonly number[];
        if (allowed !== null) {
            const candidates = [...allowed].filter(
                (ordinal) =>
                    !forbidden.has(ordinal) &&
                    (input.maximumTotalCost === undefined ||
                        this.#index.records[ordinal]!.totalCost <= input.maximumTotalCost)
            );
            examinedRankingEntries = candidates.length;
            selectedOrdinals = selectTopRanked(
                candidates,
                this.#rankPositions[objective],
                input.limit
            );
        } else if (input.maximumTotalCost !== undefined) {
            const selected = selectAffordable(
                this.#index.rankings[objective],
                this.#minimumCostTrees[objective],
                input.maximumTotalCost,
                forbidden,
                input.limit
            );
            selectedOrdinals = selected.ordinals;
            examinedRankingEntries = selected.examinedRankingEntries;
        } else {
            const selected: number[] = [];
            examinedRankingEntries = 0;
            for (const ordinal of this.#index.rankings[objective]) {
                examinedRankingEntries++;
                if (forbidden.has(ordinal)) continue;
                selected.push(ordinal);
                if (selected.length === input.limit) break;
            }
            selectedOrdinals = selected;
        }
        const recipes: RecipeCorpusEntry[] = [];
        for (const ordinal of selectedOrdinals) {
            recipes.push(await this.#recipe(this.#index.records[ordinal]!));
        }
        return {
            recipes,
            evidence: {
                source: 'precomputed',
                proofStatus: 'exact',
                corpusArtifactSha256: this.#corpusManifest.artifactSha256,
                indexArtifactSha256: this.#indexManifest.artifactSha256,
                coverageKey: this.#corpusManifest.coverageKey,
                candidateCount,
                examinedRankingEntries,
            },
        };
    }

    async select(input: RecipeCorpusFilter): Promise<RecipeCorpusSelectionResult> {
        const { allowed, forbidden, candidateCount } = filterState(input, this.#index);
        const ordinals = candidateOrdinals(
            allowed,
            forbidden,
            input.maximumTotalCost,
            this.#index.records,
            this.#index.totalCostOrder
        );
        const recipes: RecipeCorpusEntry[] = [];
        for (const ordinal of ordinals) {
            recipes.push(await this.#recipe(this.#index.records[ordinal]!));
        }
        if (recipes.length !== candidateCount) {
            throw new Error('Recipe corpus selection differs from its index count');
        }
        return {
            recipes,
            evidence: {
                source: 'precomputed',
                proofStatus: 'exact',
                corpusArtifactSha256: this.#corpusManifest.artifactSha256,
                indexArtifactSha256: this.#indexManifest.artifactSha256,
                coverageKey: this.#corpusManifest.coverageKey,
                candidateCount,
            },
        };
    }

    async #recipe(record: RecipeCorpusIndexRecord): Promise<RecipeCorpusEntry> {
        let partition = this.#partitionCache.get(record.partitionPath);
        if (partition === undefined) {
            const file = this.#filesByPath.get(record.partitionPath);
            if (file === undefined) {
                throw new Error(`Recipe index references unknown partition ${record.partitionPath}`);
            }
            partition = await readRecipeCorpusPartition(this.#corpusDirectory, file);
            this.#partitionCache.set(record.partitionPath, partition);
        }
        const recipe = partition.recipes[record.recipeIndex];
        if (recipe === undefined || recipe.costs.total !== record.totalCost) {
            throw new Error(
                `Recipe index contains an invalid reference ${record.partitionPath}:${record.recipeIndex}`
            );
        }
        return recipe;
    }
}

interface MinimumCostTree {
    readonly leafOffset: number;
    readonly values: Float64Array;
}

function minimumCostTree(
    ranking: readonly number[],
    records: readonly RecipeCorpusIndexRecord[]
): MinimumCostTree {
    let leafOffset = 1;
    while (leafOffset < ranking.length) leafOffset *= 2;
    const values = new Float64Array(leafOffset * 2);
    values.fill(Number.POSITIVE_INFINITY);
    ranking.forEach((ordinal, position) => {
        values[leafOffset + position] = records[ordinal]!.totalCost;
    });
    for (let index = leafOffset - 1; index > 0; index--) {
        values[index] = Math.min(values[index * 2]!, values[index * 2 + 1]!);
    }
    return { leafOffset, values };
}

function selectAffordable(
    ranking: readonly number[],
    tree: MinimumCostTree,
    maximumTotalCost: number,
    forbidden: ReadonlySet<number>,
    limit: number
): { readonly ordinals: readonly number[]; readonly examinedRankingEntries: number } {
    const ordinals: number[] = [];
    let examinedRankingEntries = 0;
    const visit = (node: number, left: number, right: number): void => {
        if (ordinals.length === limit || tree.values[node]! > maximumTotalCost || left >= ranking.length) {
            return;
        }
        if (right - left === 1) {
            examinedRankingEntries++;
            const ordinal = ranking[left]!;
            if (!forbidden.has(ordinal)) ordinals.push(ordinal);
            return;
        }
        const middle = left + (right - left) / 2;
        visit(node * 2, left, middle);
        visit(node * 2 + 1, middle, right);
    };
    visit(1, 0, tree.leafOffset);
    return { ordinals, examinedRankingEntries };
}

function countCandidates(
    allowed: ReadonlySet<number> | null,
    forbidden: ReadonlySet<number>,
    maximumTotalCost: number | undefined,
    records: readonly RecipeCorpusIndexRecord[],
    totalCostOrder: readonly number[]
): number {
    if (allowed !== null) {
        let count = 0;
        for (const ordinal of allowed) {
            if (!forbidden.has(ordinal) &&
                (maximumTotalCost === undefined ||
                    records[ordinal]!.totalCost <= maximumTotalCost)) {
                count++;
            }
        }
        return count;
    }
    if (maximumTotalCost === undefined) return records.length - forbidden.size;
    let lower = 0;
    let upper = totalCostOrder.length;
    while (lower < upper) {
        const middle = lower + Math.floor((upper - lower) / 2);
        if (records[totalCostOrder[middle]!]!.totalCost <= maximumTotalCost) {
            lower = middle + 1;
        } else {
            upper = middle;
        }
    }
    let count = lower;
    for (const ordinal of forbidden) {
        if (records[ordinal]!.totalCost <= maximumTotalCost) count--;
    }
    return count;
}

function candidateOrdinals(
    allowed: ReadonlySet<number> | null,
    forbidden: ReadonlySet<number>,
    maximumTotalCost: number | undefined,
    records: readonly RecipeCorpusIndexRecord[],
    totalCostOrder: readonly number[]
): number[] {
    if (allowed !== null) {
        return [...allowed].filter(
            (ordinal) =>
                !forbidden.has(ordinal) &&
                (maximumTotalCost === undefined ||
                    records[ordinal]!.totalCost <= maximumTotalCost)
        );
    }
    if (maximumTotalCost === undefined) {
        return records.flatMap((_, ordinal) => forbidden.has(ordinal) ? [] : [ordinal]);
    }
    const ordinals: number[] = [];
    for (const ordinal of totalCostOrder) {
        if (records[ordinal]!.totalCost > maximumTotalCost) break;
        if (!forbidden.has(ordinal)) ordinals.push(ordinal);
    }
    return ordinals;
}

interface FilterState {
    readonly allowed: Set<number> | null;
    readonly forbidden: ReadonlySet<number>;
    readonly candidateCount: number;
}

function filterState(input: RecipeCorpusFilter, index: RecipeCorpusIndex): FilterState {
    validateFilter(input);
    const products = unique(input.productIds ?? [], 'product');
    const requiredEffects = unique(input.requiredEffectIds ?? [], 'required effect');
    const forbiddenEffects = unique(input.forbiddenEffectIds ?? [], 'forbidden effect');
    for (const effectId of requiredEffects) {
        if (forbiddenEffects.includes(effectId)) {
            throw new Error(`Effect ${JSON.stringify(effectId)} cannot be required and forbidden`);
        }
    }

    let allowed: Set<number> | null = null;
    if (products.length > 0) {
        allowed = new Set(
            products.flatMap((productId) => index.postings.products[productId] ?? [])
        );
    }
    const requiredPostings = requiredEffects
        .map((effectId) => index.postings.effects[effectId] ?? [])
        .sort((left, right) => left.length - right.length);
    for (const posting of requiredPostings) allowed = intersect(allowed, posting);
    const forbidden = new Set(
        forbiddenEffects.flatMap((effectId) => index.postings.effects[effectId] ?? [])
    );
    return {
        allowed,
        forbidden,
        candidateCount: countCandidates(
            allowed,
            forbidden,
            input.maximumTotalCost,
            index.records,
            index.totalCostOrder
        ),
    };
}

function rankPositions(ranking: readonly number[]): Uint32Array {
    const positions = new Uint32Array(ranking.length);
    ranking.forEach((ordinal, position) => {
        positions[ordinal] = position;
    });
    return positions;
}

function selectTopRanked(
    candidates: readonly number[],
    positions: Uint32Array,
    limit: number
): number[] {
    const selected: number[] = [];
    for (const ordinal of candidates) {
        const position = positions[ordinal]!;
        let insertion = selected.findIndex(
            (selectedOrdinal) => positions[selectedOrdinal]! > position
        );
        if (insertion < 0) insertion = selected.length;
        if (insertion >= limit) continue;
        selected.splice(insertion, 0, ordinal);
        if (selected.length > limit) selected.pop();
    }
    return selected;
}

function intersect(current: Set<number> | null, values: readonly number[]): Set<number> {
    if (current === null) return new Set(values);
    const next = new Set<number>();
    for (const value of values) {
        if (current.has(value)) next.add(value);
    }
    return next;
}

function unique(values: readonly string[], label: string): string[] {
    const result = [...values].sort();
    for (let index = 1; index < result.length; index++) {
        if (result[index - 1] === result[index]) {
            throw new Error(`Duplicate ${label} ${JSON.stringify(result[index])}`);
        }
    }
    return result;
}

function validateQuery(input: RecipeCorpusQuery): void {
    validateFilter(input);
    if (!Number.isSafeInteger(input.limit) || input.limit < 1) {
        throw new Error('Recipe corpus query limit must be a positive safe integer');
    }
    if (input.objective !== undefined &&
        input.objective !== 'productValue' && input.objective !== 'netValue') {
        throw new Error(`Unknown recipe corpus objective ${JSON.stringify(input.objective)}`);
    }
}

function validateFilter(input: RecipeCorpusFilter): void {
    if (input.maximumTotalCost !== undefined &&
        (!Number.isFinite(input.maximumTotalCost) || input.maximumTotalCost < 0)) {
        throw new Error('Recipe corpus maximumTotalCost must be a non-negative number');
    }
}
