import {
    MixingEngine,
    normalizeMixingRuleProfile,
    RecipeOutcomeEnumerator,
    type Item,
    type MixingRuleProfile,
    type RecipeEvaluation,
    type RecipeSearchEvidence,
} from '@neonschedule1/core';

import type { SolverDataset } from '#solver/dataset';

export const recipeCorpusAlgorithmVersion = '2';

export type RecipeCorpusMode = 'exhaustive' | 'selective';

export interface SelectiveCorpusOptions {
    readonly ruleProfile?: MixingRuleProfile;
    readonly productIds?: readonly string[];
    readonly ingredientIds?: readonly string[];
    readonly maxIngredients: number;
    readonly maxStates: number;
    readonly requiredEffectIds: readonly string[];
    readonly forbiddenEffectIds: readonly string[];
}

export interface ExhaustiveCorpusOptions {
    readonly ruleProfile?: MixingRuleProfile;
    readonly maxIngredients: number;
    readonly maxStates: number;
}

export type RecipeCorpusOptions =
    | ({ readonly mode: 'exhaustive' } & ExhaustiveCorpusOptions)
    | ({ readonly mode: 'selective' } & SelectiveCorpusOptions);

export interface RecipeCorpusConfiguration {
    readonly mode: RecipeCorpusMode;
    readonly ruleProfile: MixingRuleProfile;
    readonly productIds: readonly string[];
    readonly ingredientIds: readonly string[];
    readonly maxIngredients: number;
    readonly maxStates: number;
    readonly requiredEffectIds: readonly string[];
    readonly forbiddenEffectIds: readonly string[];
}

export interface RecipeCorpusPlan {
    readonly dataset: SolverDataset;
    readonly configuration: RecipeCorpusConfiguration;
    readonly estimatedOrderedSequences: string;
}

export interface RecipeCorpusPartition {
    readonly schema: 'neonschedule1-recipe-corpus-partition-2';
    readonly algorithmVersion: string;
    readonly dataset: RecipeCorpusDatasetIdentity;
    readonly coverage: {
        readonly mode: RecipeCorpusMode;
        readonly ruleProfile: MixingRuleProfile;
        readonly semantics: 'cheapest-representative-per-ordered-effect-state';
        readonly productId: string;
        readonly drugType: string;
        readonly resultDepth: number;
        readonly maxIngredients: number;
        readonly ingredientIds: readonly string[];
        readonly requiredEffectIds: readonly string[];
        readonly forbiddenEffectIds: readonly string[];
    };
    readonly proof: RecipeSearchEvidence;
    readonly recipes: readonly RecipeCorpusEntry[];
}

export interface RecipeCorpusEntry {
    readonly productId: string;
    readonly drugType: string;
    readonly ingredientIds: readonly string[];
    readonly effectIds: readonly string[];
    readonly depth: number;
    readonly productValue: number;
    readonly costs: {
        readonly baseProduct: number;
        readonly baseProductBasis: RecipeEvaluation['baseProductCostBasis'];
        readonly ingredients: number;
        readonly total: number;
    };
    readonly netValue: number;
}

export interface RecipeCorpusDatasetIdentity {
    readonly gameVersion: string;
    readonly datasetSha256: string;
    readonly normalizerVersion: string;
}

export function defaultSelectiveCorpusOptions(): SelectiveCorpusOptions {
    return {
        maxIngredients: 3,
        maxStates: 100_000,
        requiredEffectIds: [],
        forbiddenEffectIds: [],
    };
}

export function defaultExhaustiveCorpusOptions(): ExhaustiveCorpusOptions {
    return {
        maxIngredients: 3,
        maxStates: 100_000,
    };
}

export function planSelectiveCorpus(
    dataset: SolverDataset,
    options: SelectiveCorpusOptions
): RecipeCorpusPlan {
    return planRecipeCorpus(dataset, { mode: 'selective', ...options });
}

export function planExhaustiveCorpus(
    dataset: SolverDataset,
    options: ExhaustiveCorpusOptions
): RecipeCorpusPlan {
    return planRecipeCorpus(dataset, { mode: 'exhaustive', ...options });
}

export function planRecipeCorpus(
    dataset: SolverDataset,
    options: RecipeCorpusOptions
): RecipeCorpusPlan {
    requireInteger(options.maxIngredients, 'maxIngredients', 0);
    requireInteger(options.maxStates, 'maxStates', 1);
    const itemsById = new Map(dataset.items.map((item) => [item.id, item]));
    const productIds = selection(
        options.mode === 'selective' ? options.productIds : undefined,
        dataset.items
            .filter((item) => item.product !== null && !item.isRuntimeOnly)
            .map((item) => item.id),
        (item) => item.product !== null && !item.isRuntimeOnly,
        itemsById,
        'product'
    );
    const ingredientIds = selection(
        options.mode === 'selective' ? options.ingredientIds : undefined,
        dataset.items
            .filter(
                (item) =>
                    item.mixingIngredient !== null &&
                    item.basePurchasePrice !== null &&
                    !item.isRuntimeOnly
            )
            .map((item) => item.id),
        (item) =>
            item.mixingIngredient !== null &&
            item.basePurchasePrice !== null &&
            !item.isRuntimeOnly,
        itemsById,
        'mixing ingredient'
    );
    const effectsById = new Map(dataset.effects.map((effect) => [effect.id, effect]));
    const requiredEffectIds = effectSelection(
        options.mode === 'selective' ? options.requiredEffectIds : [],
        effectsById,
        'required'
    );
    const forbiddenEffectIds = effectSelection(
        options.mode === 'selective' ? options.forbiddenEffectIds : [],
        effectsById,
        'forbidden'
    );
    for (const effectId of requiredEffectIds) {
        if (forbiddenEffectIds.includes(effectId)) {
            throw new Error(`Effect ${JSON.stringify(effectId)} cannot be required and forbidden`);
        }
    }

    return {
        dataset,
        configuration: {
            mode: options.mode,
            ruleProfile: normalizeMixingRuleProfile(options.ruleProfile),
            productIds,
            ingredientIds,
            maxIngredients: options.maxIngredients,
            maxStates: options.maxStates,
            requiredEffectIds,
            forbiddenEffectIds,
        },
        estimatedOrderedSequences: estimateOrderedSequences(
            productIds.length,
            ingredientIds.length,
            options.maxIngredients
        ).toString(),
    };
}

export function* generateRecipeCorpusPartitions(
    plan: RecipeCorpusPlan
): Generator<RecipeCorpusPartition> {
    for (const productId of plan.configuration.productIds) {
        yield* generateRecipeCorpusProductPartitions(plan, productId);
    }
}

export function* generateRecipeCorpusProductPartitions(
    plan: RecipeCorpusPlan,
    productId: string
): Generator<RecipeCorpusPartition> {
    const { dataset, configuration } = plan;
    if (!configuration.productIds.includes(productId)) {
        throw new Error(`Product ${JSON.stringify(productId)} is outside corpus coverage`);
    }
    const itemsById = new Map(dataset.items.map((item) => [item.id, item]));
    const effectsById = new Map(dataset.effects.map((effect) => [effect.id, effect]));
    const engine = new MixingEngine(
        dataset.mixingRules,
        effectsById,
        configuration.ruleProfile
    );
    const enumerator = new RecipeOutcomeEnumerator(engine, itemsById, {
        maxStates: configuration.maxStates,
    });
    const datasetIdentity = identity(dataset);

    const product = itemsById.get(productId)?.product;
    if (product === null || product === undefined) {
        throw new Error(`Corpus product ${JSON.stringify(productId)} is unavailable`);
    }
    const result = enumerator.enumerateWithEvidence({
        productId,
        availableIngredientIds: configuration.ingredientIds,
        maxIngredients: configuration.maxIngredients,
        requiredEffectIds: configuration.requiredEffectIds,
        forbiddenEffectIds: configuration.forbiddenEffectIds,
    });
    const byDepth = Array.from(
        { length: configuration.maxIngredients + 1 },
        () => [] as RecipeCorpusEntry[]
    );
    for (const recipe of result.recipes) {
        byDepth[recipe.ingredientCount]!.push(entry(recipe, product.drugType));
    }
    for (let resultDepth = 0; resultDepth <= configuration.maxIngredients; resultDepth++) {
        yield {
            schema: 'neonschedule1-recipe-corpus-partition-2',
            algorithmVersion: recipeCorpusAlgorithmVersion,
            dataset: datasetIdentity,
            coverage: {
                mode: configuration.mode,
                ruleProfile: configuration.ruleProfile,
                semantics: 'cheapest-representative-per-ordered-effect-state',
                productId,
                drugType: product.drugType,
                resultDepth,
                maxIngredients: configuration.maxIngredients,
                ingredientIds: configuration.ingredientIds,
                requiredEffectIds: configuration.requiredEffectIds,
                forbiddenEffectIds: configuration.forbiddenEffectIds,
            },
            proof: result.evidence,
            recipes: byDepth[resultDepth]!,
        };
    }
}

export function identity(dataset: SolverDataset): RecipeCorpusDatasetIdentity {
    return {
        gameVersion: dataset.manifest.gameVersion,
        datasetSha256: dataset.manifest.datasetSha256,
        normalizerVersion: dataset.manifest.normalizerVersion,
    };
}

export function partitionPath(partition: RecipeCorpusPartition): string {
    const productKey = recipeCorpusProductKey(partition.coverage.productId);
    return `recipes/product-${productKey}/depth-${partition.coverage.resultDepth}.json`;
}

export function recipeCorpusProductKey(productId: string): string {
    return Buffer.from(productId, 'utf8').toString('base64url');
}

function entry(recipe: RecipeEvaluation, drugType: string): RecipeCorpusEntry {
    return {
        productId: recipe.productId,
        drugType,
        ingredientIds: recipe.ingredientIds,
        effectIds: recipe.effectIds,
        depth: recipe.ingredientCount,
        productValue: recipe.productValue,
        costs: {
            baseProduct: recipe.baseProductCost,
            baseProductBasis: recipe.baseProductCostBasis,
            ingredients: recipe.ingredientCost,
            total: recipe.totalCost,
        },
        netValue: recipe.netValue,
    };
}

function selection(
    selectedIds: readonly string[] | undefined,
    defaults: readonly string[],
    accepts: (item: Item) => boolean,
    itemsById: ReadonlyMap<string, Item>,
    label: string
): string[] {
    const ids = [...(selectedIds ?? defaults)].sort(compareString);
    if (ids.length === 0) throw new Error(`At least one ${label} is required`);
    for (let index = 0; index < ids.length; index++) {
        const id = ids[index]!;
        if (index > 0 && ids[index - 1] === id) {
            throw new Error(`Duplicate ${label} ${JSON.stringify(id)}`);
        }
        const item = itemsById.get(id);
        if (item === undefined || !accepts(item)) {
            throw new Error(`Unknown or unavailable ${label} ${JSON.stringify(id)}`);
        }
    }
    return ids;
}

function effectSelection(
    selectedIds: readonly string[],
    effectsById: ReadonlyMap<string, unknown>,
    label: string
): string[] {
    const ids = [...selectedIds].sort(compareString);
    for (let index = 0; index < ids.length; index++) {
        const id = ids[index]!;
        if (index > 0 && ids[index - 1] === id) {
            throw new Error(`Duplicate ${label} effect ${JSON.stringify(id)}`);
        }
        if (!effectsById.has(id)) throw new Error(`Unknown ${label} effect ${JSON.stringify(id)}`);
    }
    return ids;
}

function estimateOrderedSequences(
    productCount: number,
    ingredientCount: number,
    maxIngredients: number
): bigint {
    let perProduct = 0n;
    let atDepth = 1n;
    const ingredients = BigInt(ingredientCount);
    for (let depth = 0; depth <= maxIngredients; depth++) {
        perProduct += atDepth;
        atDepth *= ingredients;
    }
    return BigInt(productCount) * perProduct;
}

function requireInteger(value: number, name: string, minimum: number): void {
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new Error(`${name} must be a safe integer greater than or equal to ${minimum}`);
    }
}

function compareString(left: string, right: string): number {
    return left === right ? 0 : left < right ? -1 : 1;
}
