import { createHash } from 'node:crypto';

import {
    MixingEngine,
    normalizeMixingRuleProfile,
    RecipeEvaluator,
    ReverseRecipeSearch,
    sameMixingRuleProfile,
    type Item,
    type MixingRuleProfile,
    type RecipeEvaluation,
    type RecipeSearchObjective,
} from '@neonschedule1/core';

import type { SolverDataset } from '#solver/dataset';

export const nativeValidationRequestFileName = 'native-recipe-validation-request.json';
export const nativeValidationResponseFileName = 'native-recipe-validation-response.json';
export const maximumNativeValidationCases = 64;

export interface NativeValidationOptions {
    readonly maxCases: number;
    readonly maxStates: number;
    readonly ruleProfile?: MixingRuleProfile;
}

export interface NativeValidationRequest {
    readonly schema: 'neonschedule1-native-recipe-validation-request-2';
    readonly createdAt: string;
    readonly ruleProfile: MixingRuleProfile;
    readonly dataset: {
        readonly gameVersion: string;
        readonly datasetSha256: string;
        readonly normalizerVersion: string;
    };
    readonly cases: readonly NativeValidationCase[];
}

export interface NativeValidationCase {
    readonly id: string;
    readonly reasons: NativeValidationReason[];
    readonly productId: string;
    readonly ingredientIds: readonly string[];
    readonly expected: {
        readonly effectIds: readonly string[];
        readonly calculatedValue: number;
    };
}

export type NativeValidationReason =
    | 'solver-winner'
    | 'depth-coverage'
    | 'repeated-ingredient'
    | 'order-sensitive'
    | 'effect-capacity';

export interface NativeValidationResponse {
    readonly schema: 'neonschedule1-native-recipe-validation-response-2';
    readonly exporterVersion: string;
    readonly evaluatedAtUtc: string;
    readonly gameVersion: string;
    readonly requestSha256: string;
    readonly ruleProfile: MixingRuleProfile;
    readonly cases: readonly NativeValidationResult[];
}

export interface NativeValidationResult {
    readonly id: string;
    readonly productId: string;
    readonly ingredientIds: readonly string[];
    readonly effectIds: readonly string[];
    readonly calculatedValue: number;
}

export interface NativeValidationReport {
    readonly schema: 'neonschedule1-native-recipe-validation-report-2';
    readonly comparedAt: string;
    readonly gameVersion: string;
    readonly datasetSha256: string;
    readonly exporterVersion: string;
    readonly requestSha256: string;
    readonly responseSha256: string;
    readonly ruleProfile: MixingRuleProfile;
    readonly caseCount: number;
    readonly ingredientDepths: readonly number[];
    readonly reasons: Readonly<Record<NativeValidationReason, number>>;
}

interface Candidate {
    readonly reason: NativeValidationReason;
    readonly recipe: RecipeEvaluation;
}

export function defaultNativeValidationOptions(): NativeValidationOptions {
    return { maxCases: 48, maxStates: 100_000 };
}

export function createNativeValidationRequest(
    dataset: SolverDataset,
    options: NativeValidationOptions
): NativeValidationRequest {
    validateOptions(options);
    const itemsById = new Map(dataset.items.map((item) => [item.id, item]));
    const effectsById = new Map(dataset.effects.map((effect) => [effect.id, effect]));
    const ruleProfile = normalizeMixingRuleProfile(options.ruleProfile);
    const engine = new MixingEngine(dataset.mixingRules, effectsById, ruleProfile);
    const evaluator = new RecipeEvaluator(engine, itemsById);
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
    if (productIds.length === 0 || ingredientIds.length === 0) {
        throw new Error('Native validation needs products and mixing ingredients');
    }

    const buckets: Candidate[][] = [
        solverWinners(engine, itemsById, productIds, ingredientIds, options.maxStates),
        depthCoverage(evaluator, productIds, ingredientIds),
        repeatedIngredients(evaluator, productIds, ingredientIds),
        orderSensitive(evaluator, productIds, ingredientIds),
        effectCapacity(evaluator, productIds, ingredientIds),
    ];
    const selected = selectCases(buckets, options.maxCases);
    if (selected.length === 0) throw new Error('Native validation selected no recipes');

    return {
        schema: 'neonschedule1-native-recipe-validation-request-2',
        createdAt: new Date().toISOString(),
        ruleProfile,
        dataset: {
            gameVersion: dataset.manifest.gameVersion,
            datasetSha256: dataset.manifest.datasetSha256,
            normalizerVersion: dataset.manifest.normalizerVersion,
        },
        cases: selected,
    };
}

export function parseNativeValidationRequest(value: unknown): NativeValidationRequest {
    const record = object(value, 'request');
    if (record.schema !== 'neonschedule1-native-recipe-validation-request-2') {
        throw new Error('Native validation request has an unsupported schema');
    }
    const dataset = object(record.dataset, 'request.dataset');
    const cases = array(record.cases, 'request.cases').map((entry, index) => {
        const item = object(entry, `request.cases[${index}]`);
        const expected = object(item.expected, `request.cases[${index}].expected`);
        return {
            id: string(item.id, `request.cases[${index}].id`),
            reasons: stringArray(item.reasons, `request.cases[${index}].reasons`).map(reason),
            productId: string(item.productId, `request.cases[${index}].productId`),
            ingredientIds: stringArray(
                item.ingredientIds,
                `request.cases[${index}].ingredientIds`
            ),
            expected: {
                effectIds: stringArray(
                    expected.effectIds,
                    `request.cases[${index}].expected.effectIds`
                ),
                calculatedValue: number(
                    expected.calculatedValue,
                    `request.cases[${index}].expected.calculatedValue`
                ),
            },
        };
    });
    return {
        schema: record.schema,
        createdAt: string(record.createdAt, 'request.createdAt'),
        ruleProfile: normalizeMixingRuleProfile(record.ruleProfile),
        dataset: {
            gameVersion: string(dataset.gameVersion, 'request.dataset.gameVersion'),
            datasetSha256: sha256(dataset.datasetSha256, 'request.dataset.datasetSha256'),
            normalizerVersion: string(
                dataset.normalizerVersion,
                'request.dataset.normalizerVersion'
            ),
        },
        cases,
    };
}

export function parseNativeValidationResponse(value: unknown): NativeValidationResponse {
    const record = object(value, 'response');
    if (record.schema !== 'neonschedule1-native-recipe-validation-response-2') {
        throw new Error('Native validation response has an unsupported schema');
    }
    const cases = array(record.cases, 'response.cases').map((entry, index) => {
        const item = object(entry, `response.cases[${index}]`);
        return {
            id: string(item.id, `response.cases[${index}].id`),
            productId: string(item.productId, `response.cases[${index}].productId`),
            ingredientIds: stringArray(
                item.ingredientIds,
                `response.cases[${index}].ingredientIds`
            ),
            effectIds: stringArray(item.effectIds, `response.cases[${index}].effectIds`),
            calculatedValue: number(
                item.calculatedValue,
                `response.cases[${index}].calculatedValue`
            ),
        };
    });
    return {
        schema: record.schema,
        exporterVersion: string(record.exporterVersion, 'response.exporterVersion'),
        evaluatedAtUtc: string(record.evaluatedAtUtc, 'response.evaluatedAtUtc'),
        gameVersion: string(record.gameVersion, 'response.gameVersion'),
        requestSha256: sha256(record.requestSha256, 'response.requestSha256'),
        ruleProfile: normalizeMixingRuleProfile(record.ruleProfile),
        cases,
    };
}

export function compareNativeValidation(
    request: NativeValidationRequest,
    response: NativeValidationResponse,
    requestSha256: string,
    responseSha256: string
): NativeValidationReport {
    if (response.requestSha256 !== requestSha256) {
        throw new Error('Native response belongs to a different request');
    }
    if (response.gameVersion !== request.dataset.gameVersion) {
        throw new Error(
            `Native response game ${response.gameVersion} differs from dataset ${request.dataset.gameVersion}`
        );
    }
    if (!sameMixingRuleProfile(response.ruleProfile, request.ruleProfile)) {
        throw new Error('Native response mixing rule profile differs from the request');
    }
    if (response.cases.length !== request.cases.length) {
        throw new Error(
            `Native response contains ${response.cases.length} cases, expected ${request.cases.length}`
        );
    }

    request.cases.forEach((expected, index) => {
        const actual = response.cases[index]!;
        assertEqual(actual.id, expected.id, `${expected.id} case ID`);
        assertEqual(actual.productId, expected.productId, `${expected.id} product`);
        assertEqual(actual.ingredientIds, expected.ingredientIds, `${expected.id} ingredients`);
        assertEqual(actual.effectIds, expected.expected.effectIds, `${expected.id} effects`);
        assertEqual(
            actual.calculatedValue,
            expected.expected.calculatedValue,
            `${expected.id} value`
        );
    });

    return {
        schema: 'neonschedule1-native-recipe-validation-report-2',
        comparedAt: new Date().toISOString(),
        gameVersion: response.gameVersion,
        datasetSha256: request.dataset.datasetSha256,
        exporterVersion: response.exporterVersion,
        requestSha256,
        responseSha256,
        ruleProfile: request.ruleProfile,
        caseCount: request.cases.length,
        ingredientDepths: [...new Set(request.cases.map((item) => item.ingredientIds.length))]
            .sort((left, right) => left - right),
        reasons: countReasons(request.cases),
    };
}

export function contentSha256(content: Uint8Array): string {
    return createHash('sha256').update(content).digest('hex');
}

function solverWinners(
    engine: MixingEngine,
    itemsById: ReadonlyMap<string, Item>,
    productIds: readonly string[],
    ingredientIds: readonly string[],
    maxStates: number
): Candidate[] {
    const search = new ReverseRecipeSearch(engine, itemsById, { maxStates });
    const objectives: readonly RecipeSearchObjective[] = ['productValue', 'netValue'];
    return objectives.flatMap((objective) =>
        search.search({
            productIds,
            availableIngredientIds: ingredientIds,
            maxIngredients: 5,
            limit: 8,
            objective,
        }).recipes
            .filter((recipe) => recipe.ingredientCount >= 3)
            .map((recipe) => ({ reason: 'solver-winner' as const, recipe }))
    );
}

function depthCoverage(
    evaluator: RecipeEvaluator,
    productIds: readonly string[],
    ingredientIds: readonly string[]
): Candidate[] {
    return Array.from({ length: productIds.length * 3 }, (_, index) => {
        const productId = productIds[index % productIds.length]!;
        const depth = 3 + (index % 3);
        const offset = Math.floor(index / productIds.length) * 3 + index;
        const selected = Array.from(
            { length: depth },
            (_, step) => ingredientIds[(offset + step * 5) % ingredientIds.length]!
        );
        return {
            reason: 'depth-coverage' as const,
            recipe: evaluator.evaluate({ productId, ingredientIds: selected }),
        };
    });
}

function repeatedIngredients(
    evaluator: RecipeEvaluator,
    productIds: readonly string[],
    ingredientIds: readonly string[]
): Candidate[] {
    return productIds.map((productId, index) => {
        const ingredientId = ingredientIds[(index * 5) % ingredientIds.length]!;
        return {
            reason: 'repeated-ingredient' as const,
            recipe: evaluator.evaluate({
                productId,
                ingredientIds: Array.from({ length: 5 }, () => ingredientId),
            }),
        };
    });
}

function orderSensitive(
    evaluator: RecipeEvaluator,
    productIds: readonly string[],
    ingredientIds: readonly string[]
): Candidate[] {
    const result: Candidate[] = [];
    for (const productId of productIds) {
        findPair: for (let left = 0; left < ingredientIds.length; left++) {
            for (let right = left + 1; right < ingredientIds.length; right++) {
                const first = ingredientIds[left]!;
                const second = ingredientIds[right]!;
                const forward = evaluator.evaluate({
                    productId,
                    ingredientIds: [first, second, first, first, second],
                });
                const reverse = evaluator.evaluate({
                    productId,
                    ingredientIds: [second, first, first, second, first],
                });
                if (sameOutcome(forward, reverse)) continue;
                result.push(
                    { reason: 'order-sensitive', recipe: forward },
                    { reason: 'order-sensitive', recipe: reverse }
                );
                break findPair;
            }
        }
    }
    return result;
}

function effectCapacity(
    evaluator: RecipeEvaluator,
    productIds: readonly string[],
    ingredientIds: readonly string[]
): Candidate[] {
    return productIds.map((productId) => {
        let selected: string[] = [];
        for (let depth = 0; depth < 5; depth++) {
            const candidates = ingredientIds.map((ingredientId) =>
                evaluator.evaluate({ productId, ingredientIds: [...selected, ingredientId] })
            );
            candidates.sort(
                (left, right) =>
                    right.effectIds.length - left.effectIds.length ||
                    right.productValue - left.productValue ||
                    compareStrings(left.ingredientIds, right.ingredientIds)
            );
            selected = [...candidates[0]!.ingredientIds];
        }
        return {
            reason: 'effect-capacity' as const,
            recipe: evaluator.evaluate({ productId, ingredientIds: selected }),
        };
    });
}

function selectCases(buckets: readonly Candidate[][], limit: number): NativeValidationCase[] {
    const result: NativeValidationCase[] = [];
    const byRecipe = new Map<string, NativeValidationCase>();
    for (let row = 0; result.length < limit; row++) {
        let visited = false;
        for (const bucket of buckets) {
            const candidate = bucket[row];
            if (candidate === undefined) continue;
            visited = true;
            const key = JSON.stringify([candidate.recipe.productId, candidate.recipe.ingredientIds]);
            const existing = byRecipe.get(key);
            if (existing !== undefined) {
                if (!existing.reasons.includes(candidate.reason)) {
                    existing.reasons.push(candidate.reason);
                }
                continue;
            }
            const id = `recipe-${contentSha256(Buffer.from(key)).slice(0, 12)}`;
            const selected: NativeValidationCase = {
                id,
                reasons: [candidate.reason],
                productId: candidate.recipe.productId,
                ingredientIds: candidate.recipe.ingredientIds,
                expected: {
                    effectIds: candidate.recipe.effectIds,
                    calculatedValue: candidate.recipe.productValue,
                },
            };
            byRecipe.set(key, selected);
            result.push(selected);
            if (result.length === limit) break;
        }
        if (!visited) break;
    }
    return result;
}

function sameOutcome(left: RecipeEvaluation, right: RecipeEvaluation): boolean {
    return left.productValue === right.productValue &&
        compareStrings(left.effectIds, right.effectIds) === 0;
}

function countReasons(
    cases: readonly NativeValidationCase[]
): Record<NativeValidationReason, number> {
    const counts: Record<NativeValidationReason, number> = {
        'solver-winner': 0,
        'depth-coverage': 0,
        'repeated-ingredient': 0,
        'order-sensitive': 0,
        'effect-capacity': 0,
    };
    for (const testCase of cases) {
        for (const item of testCase.reasons) counts[item]++;
    }
    return counts;
}

function validateOptions(options: NativeValidationOptions): void {
    if (!Number.isSafeInteger(options.maxCases) ||
        options.maxCases < 1 ||
        options.maxCases > maximumNativeValidationCases) {
        throw new Error(`maxCases must be an integer from 1 to ${maximumNativeValidationCases}`);
    }
    if (!Number.isSafeInteger(options.maxStates) || options.maxStates < 1) {
        throw new Error('maxStates must be a positive integer');
    }
}

function reason(value: string): NativeValidationReason {
    const allowed: readonly NativeValidationReason[] = [
        'solver-winner',
        'depth-coverage',
        'repeated-ingredient',
        'order-sensitive',
        'effect-capacity',
    ];
    if (!allowed.includes(value as NativeValidationReason)) {
        throw new Error(`Unknown native validation reason ${JSON.stringify(value)}`);
    }
    return value as NativeValidationReason;
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(
            `Native validation mismatch for ${label}\n` +
            `Expected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`
        );
    }
}

function object(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
    if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
    return value;
}

function string(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a string`);
    return value;
}

function number(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a number`);
    return value;
}

function stringArray(value: unknown, label: string): string[] {
    return array(value, label).map((entry, index) => string(entry, `${label}[${index}]`));
}

function sha256(value: unknown, label: string): string {
    const result = string(value, label);
    if (!/^[a-f0-9]{64}$/u.test(result)) throw new Error(`${label} must be a lowercase SHA-256`);
    return result;
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
