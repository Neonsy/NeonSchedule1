import {
    compareRecipeEvaluations,
    isRecipeRankable,
    MixingEngine,
    recipeSearchObjectives,
    RecipeOutcomeEnumerator,
    ReverseRecipeSearch,
    type IngredientQuantity,
    type RecipeEvaluation,
    type RecipeSearchEvidence,
    type RecipeSearchObjective,
    type ReverseRecipeEvaluation,
} from '@neonschedule1/core';

import type { SolverDataset } from '#solver/dataset';

export const reverseSearchAlgorithmVersion = '3';
const maximumVerifiedRequiredEffects = 4;

export interface ReverseSearchVerificationOptions {
    readonly depth: number;
    readonly limit: number;
    readonly maxStates: number;
    readonly constraintCases: number;
    readonly maxRequiredEffects: number;
}

export interface ReverseSearchVerificationReport {
    readonly schema: 'neonschedule1-reverse-search-verification-1';
    readonly createdAt: string;
    readonly algorithmVersion: string;
    readonly dataset: {
        readonly gameVersion: string;
        readonly datasetSha256: string;
        readonly normalizerVersion: string;
    };
    readonly configuration: ReverseSearchVerificationOptions;
    readonly selection: {
        readonly productIds: readonly string[];
        readonly ingredientIds: readonly string[];
        readonly exhaustiveRecipeCount: number;
        readonly constraintCount: number;
    };
    readonly cases: readonly ReverseSearchVerificationCase[];
}

export interface ReverseSearchVerificationCase {
    readonly id: string;
    readonly constraintKind: VerificationConstraint['kind'];
    readonly requiredEffectIds: readonly string[];
    readonly forbiddenEffectIds: readonly string[];
    readonly objective: RecipeSearchObjective;
    readonly resultCount: number;
    readonly evidence: RecipeSearchEvidence;
}

interface VerificationConstraint {
    readonly id: string;
    readonly kind: 'unconstrained' | 'reachable' | 'unreachable' | 'forbidden';
    readonly requiredEffectIds: readonly string[];
    readonly forbiddenEffectIds: readonly string[];
}

export function defaultReverseSearchVerificationOptions(): ReverseSearchVerificationOptions {
    return {
        depth: 3,
        limit: 10,
        maxStates: 100_000,
        constraintCases: 24,
        maxRequiredEffects: 4,
    };
}

export function runReverseSearchVerification(
    dataset: SolverDataset,
    options: ReverseSearchVerificationOptions,
    onCaseCompleted: (
        completed: number,
        total: number,
        result: ReverseSearchVerificationCase
    ) => void = () => undefined
): ReverseSearchVerificationReport {
    validateOptions(options);
    const itemsById = new Map(dataset.items.map((item) => [item.id, item]));
    const effectsById = new Map(dataset.effects.map((effect) => [effect.id, effect]));
    const engine = new MixingEngine(dataset.mixingRules, effectsById);
    const productIds = dataset.items
        .filter((item) => item.product !== null && !item.isRuntimeOnly)
        .map((item) => item.id)
        .sort(compareString);
    const ingredientIds = dataset.items
        .filter(
            (item) =>
                item.mixingIngredient !== null &&
                item.basePurchasePrice !== null &&
                !item.isRuntimeOnly
        )
        .map((item) => item.id)
        .sort(compareString);
    if (productIds.length === 0) throw new Error('Verification dataset contains no user-facing products');
    if (ingredientIds.length === 0) throw new Error('Verification dataset contains no mixing ingredients');

    const enumerator = new RecipeOutcomeEnumerator(engine, itemsById, {
        maxStates: options.maxStates,
    });
    const corpus = productIds.flatMap((productId) =>
        enumerator.enumerate({
            productId,
            availableIngredientIds: ingredientIds,
            maxIngredients: options.depth,
        })
    );
    const constraints = buildConstraints(
        corpus,
        [...effectsById.keys()].sort(compareString),
        options
    );
    const search = new ReverseRecipeSearch(engine, itemsById, {
        maxStates: options.maxStates,
    });
    const definitions = constraints.flatMap((constraint) =>
        recipeSearchObjectives.map((objective) => ({ constraint, objective }))
    );
    const cases: ReverseSearchVerificationCase[] = [];

    for (const { constraint, objective } of definitions) {
        const expected = exhaustiveResult(corpus, constraint, objective, options.limit);
        const actual = search.search({
            productIds,
            availableIngredientIds: ingredientIds,
            maxIngredients: options.depth,
            limit: options.limit,
            requiredEffectIds: constraint.requiredEffectIds,
            forbiddenEffectIds: constraint.forbiddenEffectIds,
            objective,
        });
        if (actual.evidence.proofStatus !== 'exact') {
            throw new Error(`Verification case ${constraint.id}:${objective} did not complete exactly`);
        }
        assertSameRecipes(`${constraint.id}:${objective}`, expected, actual.recipes);
        const result: ReverseSearchVerificationCase = {
            id: `${constraint.id}:${objective}`,
            constraintKind: constraint.kind,
            requiredEffectIds: constraint.requiredEffectIds,
            forbiddenEffectIds: constraint.forbiddenEffectIds,
            objective,
            resultCount: actual.recipes.length,
            evidence: actual.evidence,
        };
        cases.push(result);
        onCaseCompleted(cases.length, definitions.length, result);
    }

    return {
        schema: 'neonschedule1-reverse-search-verification-1',
        createdAt: new Date().toISOString(),
        algorithmVersion: reverseSearchAlgorithmVersion,
        dataset: {
            gameVersion: dataset.manifest.gameVersion,
            datasetSha256: dataset.manifest.datasetSha256,
            normalizerVersion: dataset.manifest.normalizerVersion,
        },
        configuration: options,
        selection: {
            productIds,
            ingredientIds,
            exhaustiveRecipeCount: corpus.length,
            constraintCount: constraints.length,
        },
        cases,
    };
}

function buildConstraints(
    corpus: readonly RecipeEvaluation[],
    effectIds: readonly string[],
    options: ReverseSearchVerificationOptions
): VerificationConstraint[] {
    const reachable = new Map<string, readonly string[]>();
    for (const recipe of corpus) {
        const effects = [...new Set(recipe.effectIds)].sort(compareString);
        for (let size = 1; size <= Math.min(effects.length, options.maxRequiredEffects); size++) {
            for (const combination of combinations(effects, size)) {
                reachable.set(effectSetKey(combination), combination);
            }
        }
    }
    const unreachable = new Map<string, readonly string[]>();
    for (let size = 1; size <= options.maxRequiredEffects; size++) {
        for (const combination of combinations(effectIds, size)) {
            const key = effectSetKey(combination);
            if (!reachable.has(key)) unreachable.set(key, combination);
        }
    }

    const remaining = options.constraintCases - 1;
    const baseCount = Math.floor(remaining / 3);
    const extra = remaining % 3;
    const reachableCount = baseCount + (extra > 0 ? 1 : 0);
    const unreachableCount = baseCount + (extra > 1 ? 1 : 0);
    const forbiddenCount = baseCount;
    const constraints: VerificationConstraint[] = [
        {
            id: 'unconstrained',
            kind: 'unconstrained',
            requiredEffectIds: [],
            forbiddenEffectIds: [],
        },
        ...selectAcrossCardinalities([...reachable.values()], reachableCount).map((ids) =>
            effectConstraint('reachable', ids)
        ),
        ...selectAcrossCardinalities([...unreachable.values()], unreachableCount).map((ids) =>
            effectConstraint('unreachable', ids)
        ),
        ...selectEvenly(effectIds, forbiddenCount).map((effectId) => ({
            id: `forbidden:${effectId}`,
            kind: 'forbidden' as const,
            requiredEffectIds: [],
            forbiddenEffectIds: [effectId],
        })),
    ];
    if (constraints.length !== options.constraintCases) {
        throw new Error(
            `Could only build ${constraints.length} of ${options.constraintCases} verification constraints`
        );
    }
    return constraints;
}

function effectConstraint(
    kind: 'reachable' | 'unreachable',
    effectIds: readonly string[]
): VerificationConstraint {
    return {
        id: `${kind}:${effectIds.join('+')}`,
        kind,
        requiredEffectIds: effectIds,
        forbiddenEffectIds: [],
    };
}

function exhaustiveResult(
    corpus: readonly RecipeEvaluation[],
    constraint: VerificationConstraint,
    objective: RecipeSearchObjective,
    limit: number
): ReverseRecipeEvaluation[] {
    return corpus
        .filter((recipe) =>
            isRecipeRankable(recipe.totalCost, objective) &&
            matches(recipe.effectIds, constraint)
        )
        .sort((left, right) => compareRecipes(left, right, objective))
        .slice(0, limit)
        .map((recipe) => ({
            ...recipe,
            ingredientQuantities: groupIngredients(recipe.ingredientIds),
        }));
}

function matches(effectIds: readonly string[], constraint: VerificationConstraint): boolean {
    return (
        constraint.requiredEffectIds.every((effectId) => effectIds.includes(effectId)) &&
        constraint.forbiddenEffectIds.every((effectId) => !effectIds.includes(effectId))
    );
}

function compareRecipes(
    left: RecipeEvaluation,
    right: RecipeEvaluation,
    objective: RecipeSearchObjective
): number {
    return compareRecipeEvaluations(left, right, objective);
}

function groupIngredients(ingredientIds: readonly string[]): IngredientQuantity[] {
    const quantities = new Map<string, IngredientQuantity>();
    for (const ingredientId of ingredientIds) {
        const current = quantities.get(ingredientId);
        quantities.set(ingredientId, {
            ingredientId,
            quantity: (current?.quantity ?? 0) + 1,
        });
    }
    return [...quantities.values()];
}

function assertSameRecipes(
    caseId: string,
    expected: readonly ReverseRecipeEvaluation[],
    actual: readonly ReverseRecipeEvaluation[]
): void {
    if (JSON.stringify(actual) === JSON.stringify(expected)) return;
    const difference = Math.max(expected.length, actual.length);
    for (let index = 0; index < difference; index++) {
        if (JSON.stringify(expected[index]) === JSON.stringify(actual[index])) continue;
        throw new Error(
            `Verification case ${caseId} differs at result ${index + 1}\n` +
                `Expected: ${JSON.stringify(expected[index] ?? null)}\n` +
                `Actual: ${JSON.stringify(actual[index] ?? null)}`
        );
    }
    throw new Error(`Verification case ${caseId} produced a different result`);
}

function selectAcrossCardinalities(
    effectSets: readonly (readonly string[])[],
    count: number
): readonly (readonly string[])[] {
    const groups = new Map<number, (readonly string[])[]>();
    for (const effectSet of effectSets) {
        const group = groups.get(effectSet.length) ?? [];
        group.push(effectSet);
        groups.set(effectSet.length, group);
    }
    const orderedGroups = [...groups.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, group]) => group.sort((left, right) => compareStrings(left, right)));
    if (orderedGroups.length === 0 || count === 0) return [];
    const quotas = orderedGroups.map(() => 0);
    let allocated = 0;
    while (allocated < count) {
        let added = false;
        for (let index = 0; index < orderedGroups.length && allocated < count; index++) {
            const group = orderedGroups[index]!;
            if (quotas[index]! >= group.length) continue;
            quotas[index] = quotas[index]! + 1;
            allocated++;
            added = true;
        }
        if (!added) break;
    }
    const selected = orderedGroups.map((group, index) =>
        selectEvenly(group, quotas[index]!)
    );
    const result: (readonly string[])[] = [];
    for (let index = 0; result.length < count; index++) {
        let added = false;
        for (const group of selected) {
            const effectSet = group[index];
            if (effectSet === undefined) continue;
            result.push(effectSet);
            added = true;
            if (result.length === count) break;
        }
        if (!added) break;
    }
    return result;
}

function selectEvenly<T>(values: readonly T[], count: number): T[] {
    if (count <= 0) return [];
    if (count >= values.length) return [...values];
    if (count === 1) return [values[Math.floor((values.length - 1) / 2)]!];
    return Array.from({ length: count }, (_, index) =>
        values[Math.round((index * (values.length - 1)) / (count - 1))]!
    );
}

function* combinations(values: readonly string[], size: number): Generator<readonly string[]> {
    const selected: string[] = [];
    function* visit(start: number): Generator<readonly string[]> {
        if (selected.length === size) {
            yield [...selected];
            return;
        }
        for (let index = start; index <= values.length - (size - selected.length); index++) {
            selected.push(values[index]!);
            yield* visit(index + 1);
            selected.pop();
        }
    }
    yield* visit(0);
}

function effectSetKey(effectIds: readonly string[]): string {
    return JSON.stringify(effectIds);
}

function compareStrings(left: readonly string[], right: readonly string[]): number {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
        const comparison = compareString(left[index]!, right[index]!);
        if (comparison !== 0) return comparison;
    }
    return left.length - right.length;
}

function compareString(left: string, right: string): number {
    return left === right ? 0 : left < right ? -1 : 1;
}

function validateOptions(options: ReverseSearchVerificationOptions): void {
    requireInteger(options.depth, 'depth', 0);
    requireInteger(options.limit, 'limit', 1);
    requireInteger(options.maxStates, 'maxStates', 1);
    requireInteger(options.constraintCases, 'constraintCases', 4);
    requireInteger(options.maxRequiredEffects, 'maxRequiredEffects', 1);
    if (options.maxRequiredEffects > maximumVerifiedRequiredEffects) {
        throw new Error(
            `maxRequiredEffects must not exceed ${maximumVerifiedRequiredEffects}`
        );
    }
}

function requireInteger(value: number, name: string, minimum: number): void {
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new Error(`${name} must be a safe integer greater than or equal to ${minimum}`);
    }
}
