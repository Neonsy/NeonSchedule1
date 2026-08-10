import {
    isRecipeRankable,
    requireRecipeSearchObjective,
    type MixingRuleProfile,
    type RecipeSearchObjective,
} from '@neonschedule1/core';

import {
    readRecipeCorpusPartition,
    verifyRecipeCorpusArtifact,
    verifyRecipeCorpusArtifactIntegrity,
    type RecipeCorpusFile,
    type RecipeCorpusManifest,
} from '#solver/precompute-artifact';
import {
    verifyRecipeCorpusIndexArtifact,
    type RecipeCorpusIndexManifest,
} from '#solver/precompute-index-artifact';
import type { RecipeCorpusIndex } from '#solver/precompute-index';
import type { RecipeCorpusEntry, RecipeCorpusPartition } from '#solver/precompute';
import { RuntimeRecipeCorpusIndex } from '#solver/runtime-index';

export interface RecipeCorpusFilter {
    readonly productIds?: readonly string[];
    readonly requiredEffectIds?: readonly string[];
    readonly forbiddenEffectIds?: readonly string[];
    readonly requiredIngredientIds?: readonly string[];
    readonly forbiddenIngredientIds?: readonly string[];
    readonly minimumIngredientCount?: number;
    readonly exactIngredientCount?: number;
    readonly maximumTotalCost?: number;
}

export interface RecipeCorpusQuery extends RecipeCorpusFilter {
    readonly objective?: RecipeSearchObjective;
    readonly limit: number;
}

export interface RecipeCorpusLookupLoadOptions {
    readonly corpusVerification?: 'semantic' | 'integrity';
}

export interface RecipeCorpusSelectionResult {
    readonly recipes: readonly RecipeCorpusEntry[];
    readonly evidence: {
        readonly source: 'precomputed';
        readonly proofStatus: 'exact';
        readonly corpusArtifactSha256: string;
        readonly indexArtifactSha256: string;
        readonly coverageKey: string;
        readonly ruleProfile: MixingRuleProfile;
        readonly candidateCount: number;
    };
}

export interface RecipeCorpusQueryResult {
    readonly objective: RecipeSearchObjective;
    readonly recipes: readonly RecipeCorpusEntry[];
    readonly evidence: {
        readonly source: 'precomputed';
        readonly proofStatus: 'exact';
        readonly corpusArtifactSha256: string;
        readonly indexArtifactSha256: string;
        readonly coverageKey: string;
        readonly ruleProfile: MixingRuleProfile;
        readonly candidateCount: number;
        readonly examinedRankingEntries: number;
    };
}

export class RecipeCorpusLookup {
    readonly #corpusDirectory: string;
    readonly #corpusManifest: RecipeCorpusManifest;
    readonly #indexManifest: RecipeCorpusIndexManifest;
    readonly #index: RuntimeRecipeCorpusIndex;
    readonly #filesByPath: ReadonlyMap<string, RecipeCorpusFile>;
    readonly #rankPositions: Readonly<Record<RecipeSearchObjective, Uint32Array>>;
    readonly #minimumCostTrees: Partial<Record<RecipeSearchObjective, MinimumCostTree>> = {};
    readonly #partitionCache = new Map<string, RecipeCorpusPartition>();

    private constructor(
        corpusDirectory: string,
        corpusManifest: RecipeCorpusManifest,
        indexManifest: RecipeCorpusIndexManifest,
        index: RecipeCorpusIndex | RuntimeRecipeCorpusIndex
    ) {
        this.#corpusDirectory = corpusDirectory;
        this.#corpusManifest = corpusManifest;
        this.#indexManifest = indexManifest;
        if (index instanceof RuntimeRecipeCorpusIndex) {
            index.assertPartitions(corpusManifest.files);
            this.#index = index;
        } else {
            this.#index = RuntimeRecipeCorpusIndex.consume(index, corpusManifest.files);
        }
        this.#filesByPath = new Map(corpusManifest.files.map((file) => [file.path, file]));
        this.#rankPositions = {
            productValue: rankPositions(this.#index.rankings.productValue),
            netValue: rankPositions(this.#index.rankings.netValue),
            fewestSteps: rankPositions(this.#index.rankings.fewestSteps),
            lowestCost: rankPositions(this.#index.rankings.lowestCost),
            returnOnCost: rankPositions(this.#index.rankings.returnOnCost),
        };
    }

    static async load(
        corpusDirectory: string,
        indexDirectory: string,
        options: RecipeCorpusLookupLoadOptions = {}
    ): Promise<RecipeCorpusLookup> {
        const corpusVerification = options.corpusVerification ?? 'semantic';
        if (corpusVerification !== 'semantic' && corpusVerification !== 'integrity') {
            throw new Error(
                `Unknown recipe corpus verification mode ${JSON.stringify(corpusVerification)}`
            );
        }
        const [corpusManifest, indexArtifact] = await Promise.all([
            corpusVerification === 'semantic'
                ? verifyRecipeCorpusArtifact(corpusDirectory)
                : verifyRecipeCorpusArtifactIntegrity(corpusDirectory),
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
        const objective = requireRecipeSearchObjective(input.objective ?? 'productValue');
        const { allowed, forbidden, candidateCount } = filterState(
            input,
            this.#index,
            objective
        );

        let examinedRankingEntries: number;
        let selectedOrdinals: readonly number[];
        if (allowed !== null) {
            const candidates = [...allowed].filter(
                (ordinal) =>
                    !forbidden.has(ordinal) &&
                    isRecipeRankable(this.#index.totalCosts[ordinal]!, objective) &&
                    (input.maximumTotalCost === undefined ||
                        this.#index.totalCosts[ordinal]! <= input.maximumTotalCost)
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
                this.#minimumCostTree(objective),
                input.maximumTotalCost,
                forbidden,
                objective,
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
                if (!isRecipeRankable(this.#index.totalCosts[ordinal]!, objective)) continue;
                selected.push(ordinal);
                if (selected.length === input.limit) break;
            }
            selectedOrdinals = selected;
        }
        const recipes: RecipeCorpusEntry[] = [];
        for (const ordinal of selectedOrdinals) {
            recipes.push(await this.#recipe(ordinal));
        }
        return {
            objective,
            recipes,
            evidence: {
                source: 'precomputed',
                proofStatus: 'exact',
                corpusArtifactSha256: this.#corpusManifest.artifactSha256,
                indexArtifactSha256: this.#indexManifest.artifactSha256,
                coverageKey: this.#corpusManifest.coverageKey,
                ruleProfile: this.#corpusManifest.configuration.ruleProfile,
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
            this.#index.recordCount,
            this.#index.totalCosts,
            this.#index.totalCostOrder
        );
        const recipes: RecipeCorpusEntry[] = [];
        for (const ordinal of ordinals) {
            recipes.push(await this.#recipe(ordinal));
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
                ruleProfile: this.#corpusManifest.configuration.ruleProfile,
                candidateCount,
            },
        };
    }

    #minimumCostTree(objective: RecipeSearchObjective): MinimumCostTree {
        const existing = this.#minimumCostTrees[objective];
        if (existing !== undefined) return existing;
        const tree = minimumCostTree(
            this.#index.rankings[objective],
            this.#index.totalCosts
        );
        this.#minimumCostTrees[objective] = tree;
        return tree;
    }

    async #recipe(ordinal: number): Promise<RecipeCorpusEntry> {
        const partitionPath = this.#index.partitionPathAt(ordinal);
        let partition = this.#partitionCache.get(partitionPath);
        if (partition === undefined) {
            const file = this.#filesByPath.get(partitionPath);
            if (file === undefined) {
                throw new Error(`Recipe index references unknown partition ${partitionPath}`);
            }
            partition = await readRecipeCorpusPartition(this.#corpusDirectory, file);
            this.#partitionCache.set(partitionPath, partition);
        }
        const recipeIndex = this.#index.recipeIndexAt(ordinal);
        const recipe = partition.recipes[recipeIndex];
        if (recipe === undefined || recipe.costs.total !== this.#index.totalCosts[ordinal]) {
            throw new Error(
                `Recipe index contains an invalid reference ${partitionPath}:${recipeIndex}`
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
    ranking: Uint32Array,
    totalCosts: Float64Array
): MinimumCostTree {
    let leafOffset = 1;
    while (leafOffset < ranking.length) leafOffset *= 2;
    const values = new Float64Array(leafOffset * 2);
    values.fill(Number.POSITIVE_INFINITY);
    ranking.forEach((ordinal, position) => {
        values[leafOffset + position] = totalCosts[ordinal]!;
    });
    for (let index = leafOffset - 1; index > 0; index--) {
        values[index] = Math.min(values[index * 2]!, values[index * 2 + 1]!);
    }
    return { leafOffset, values };
}

function selectAffordable(
    ranking: Uint32Array,
    tree: MinimumCostTree,
    maximumTotalCost: number,
    forbidden: ReadonlySet<number>,
    objective: RecipeSearchObjective,
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
            if (!forbidden.has(ordinal) &&
                isRecipeRankable(tree.values[tree.leafOffset + left]!, objective)) {
                ordinals.push(ordinal);
            }
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
    recordCount: number,
    totalCosts: Float64Array,
    totalCostOrder: Uint32Array,
    objective?: RecipeSearchObjective
): number {
    if (objective === 'returnOnCost') {
        let count = 0;
        for (let ordinal = 0; ordinal < recordCount; ordinal++) {
            if ((allowed === null || allowed.has(ordinal)) &&
                !forbidden.has(ordinal) && totalCosts[ordinal]! > 0 &&
                (maximumTotalCost === undefined ||
                    totalCosts[ordinal]! <= maximumTotalCost)) {
                count++;
            }
        }
        return count;
    }
    if (allowed !== null) {
        let count = 0;
        for (const ordinal of allowed) {
            if (!forbidden.has(ordinal) &&
                (maximumTotalCost === undefined ||
                    totalCosts[ordinal]! <= maximumTotalCost)) {
                count++;
            }
        }
        return count;
    }
    if (maximumTotalCost === undefined) return recordCount - forbidden.size;
    let lower = 0;
    let upper = totalCostOrder.length;
    while (lower < upper) {
        const middle = lower + Math.floor((upper - lower) / 2);
        if (totalCosts[totalCostOrder[middle]!]! <= maximumTotalCost) {
            lower = middle + 1;
        } else {
            upper = middle;
        }
    }
    let count = lower;
    for (const ordinal of forbidden) {
        if (totalCosts[ordinal]! <= maximumTotalCost) count--;
    }
    return count;
}

function candidateOrdinals(
    allowed: ReadonlySet<number> | null,
    forbidden: ReadonlySet<number>,
    maximumTotalCost: number | undefined,
    recordCount: number,
    totalCosts: Float64Array,
    totalCostOrder: Uint32Array
): number[] {
    if (allowed !== null) {
        return [...allowed].filter(
            (ordinal) =>
                !forbidden.has(ordinal) &&
                (maximumTotalCost === undefined ||
                    totalCosts[ordinal]! <= maximumTotalCost)
        );
    }
    if (maximumTotalCost === undefined) {
        const ordinals: number[] = [];
        for (let ordinal = 0; ordinal < recordCount; ordinal++) {
            if (!forbidden.has(ordinal)) ordinals.push(ordinal);
        }
        return ordinals;
    }
    const ordinals: number[] = [];
    for (const ordinal of totalCostOrder) {
        if (totalCosts[ordinal]! > maximumTotalCost) break;
        if (!forbidden.has(ordinal)) ordinals.push(ordinal);
    }
    return ordinals;
}

interface FilterState {
    readonly allowed: Set<number> | null;
    readonly forbidden: ReadonlySet<number>;
    readonly candidateCount: number;
}

function filterState(
    input: RecipeCorpusFilter,
    index: RuntimeRecipeCorpusIndex,
    objective?: RecipeSearchObjective
): FilterState {
    validateFilter(input);
    const products = unique(input.productIds ?? [], 'product');
    const requiredEffects = unique(input.requiredEffectIds ?? [], 'required effect');
    const forbiddenEffects = unique(input.forbiddenEffectIds ?? [], 'forbidden effect');
    const requiredIngredients = unique(
        input.requiredIngredientIds ?? [],
        'required ingredient'
    );
    const forbiddenIngredients = unique(
        input.forbiddenIngredientIds ?? [],
        'forbidden ingredient'
    );
    for (const effectId of requiredEffects) {
        if (forbiddenEffects.includes(effectId)) {
            throw new Error(`Effect ${JSON.stringify(effectId)} cannot be required and forbidden`);
        }
    }
    for (const ingredientId of requiredIngredients) {
        if (forbiddenIngredients.includes(ingredientId)) {
            throw new Error(
                `Ingredient ${JSON.stringify(ingredientId)} cannot be required and forbidden`
            );
        }
    }
    if (input.exactIngredientCount !== undefined &&
        requiredIngredients.length > input.exactIngredientCount) {
        throw new Error(
            'Required ingredient count cannot exceed exactIngredientCount'
        );
    }

    let allowed: Set<number> | null = null;
    if (products.length > 0) {
        allowed = postingSet(products, index.postings.products);
    }
    const requiredPostings = requiredEffects
        .map((effectId) => index.postings.effects[effectId] ?? [])
        .sort((left, right) => left.length - right.length);
    for (const posting of requiredPostings) allowed = intersect(allowed, posting);
    const requiredIngredientPostings = requiredIngredients
        .map((ingredientId) => index.postings.ingredients[ingredientId] ?? [])
        .sort((left, right) => left.length - right.length);
    for (const posting of requiredIngredientPostings) allowed = intersect(allowed, posting);
    if (input.minimumIngredientCount !== undefined ||
        input.exactIngredientCount !== undefined) {
        const countMatches: number[] = [];
        for (let ordinal = 0; ordinal < index.recordCount; ordinal++) {
            const count = index.ingredientCounts[ordinal]!;
            if ((input.minimumIngredientCount === undefined ||
                    count >= input.minimumIngredientCount) &&
                (input.exactIngredientCount === undefined ||
                    count === input.exactIngredientCount)) {
                countMatches.push(ordinal);
            }
        }
        allowed = intersect(allowed, countMatches);
    }
    const forbidden = union(
        postingSet(forbiddenEffects, index.postings.effects),
        postingSet(forbiddenIngredients, index.postings.ingredients)
    );
    return {
        allowed,
        forbidden,
        candidateCount: countCandidates(
            allowed,
            forbidden,
            input.maximumTotalCost,
            index.recordCount,
            index.totalCosts,
            index.totalCostOrder,
            objective
        ),
    };
}

function postingSet(
    keys: readonly string[],
    postings: Readonly<Record<string, Uint32Array>>
): Set<number> {
    const result = new Set<number>();
    for (const key of keys) {
        for (const ordinal of postings[key] ?? []) result.add(ordinal);
    }
    return result;
}

function union(left: ReadonlySet<number>, right: ReadonlySet<number>): Set<number> {
    return new Set([...left, ...right]);
}

function rankPositions(ranking: Uint32Array): Uint32Array {
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

function intersect(
    current: Set<number> | null,
    values: readonly number[] | Uint32Array
): Set<number> {
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
    if (input.objective !== undefined) requireRecipeSearchObjective(input.objective);
}

function validateFilter(input: RecipeCorpusFilter): void {
    if (input.maximumTotalCost !== undefined &&
        (!Number.isFinite(input.maximumTotalCost) || input.maximumTotalCost < 0)) {
        throw new Error('Recipe corpus maximumTotalCost must be a non-negative number');
    }
    if (input.minimumIngredientCount !== undefined) {
        requireNonNegativeSafeInteger(
            input.minimumIngredientCount,
            'Recipe corpus minimumIngredientCount'
        );
    }
    if (input.exactIngredientCount !== undefined) {
        requireNonNegativeSafeInteger(
            input.exactIngredientCount,
            'Recipe corpus exactIngredientCount'
        );
        if (input.minimumIngredientCount !== undefined &&
            input.minimumIngredientCount > input.exactIngredientCount) {
            throw new Error(
                'Recipe corpus minimumIngredientCount cannot exceed exactIngredientCount'
            );
        }
    }
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${label} must be a non-negative safe integer`);
    }
}
