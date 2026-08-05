import type { Item } from '#core/data/item';
import type { MixingEngine } from '#core/mixing/engine';
import {
    RecipeEvaluator,
    type RecipeEvaluation,
    type RecipeEvaluatorOptions,
} from '#core/mixing/recipe';
import { RecipeSearchLimitError } from '#core/mixing/search';

const defaultMaxStates = 100_000;

export interface RecipeEnumerationInput {
    readonly productId: string;
    readonly availableIngredientIds: readonly string[];
    readonly maxIngredients: number;
    readonly requiredEffectIds?: readonly string[];
    readonly forbiddenEffectIds?: readonly string[];
}

export interface RecipeOutcomeEnumeratorOptions extends RecipeEvaluatorOptions {
    readonly maxStates?: number;
}

interface IngredientAction {
    readonly id: string;
    readonly effectId: string;
    readonly cost: number;
}

interface EnumerationState {
    readonly effectIds: readonly string[];
    readonly ingredientIds: readonly string[];
    readonly ingredientCost: number;
}

export class RecipeOutcomeEnumerator {
    readonly #engine: MixingEngine;
    readonly #itemsById: ReadonlyMap<string, Item>;
    readonly #evaluator: RecipeEvaluator;
    readonly #maxStates: number;

    constructor(
        engine: MixingEngine,
        itemsById: ReadonlyMap<string, Item>,
        options: RecipeOutcomeEnumeratorOptions = {}
    ) {
        this.#engine = engine;
        this.#itemsById = itemsById;
        this.#evaluator = new RecipeEvaluator(engine, itemsById, options);
        this.#maxStates = options.maxStates ?? defaultMaxStates;
        requirePositiveSafeInteger(this.#maxStates, 'maxStates');
    }

    enumerate(input: RecipeEnumerationInput): RecipeEvaluation[] {
        requireNonNegativeSafeInteger(input.maxIngredients, 'maxIngredients');
        const product = this.#product(input.productId);
        const actions = this.#ingredients(input.availableIngredientIds);
        const constraints = new EffectConstraints(
            this.#engine,
            input.requiredEffectIds ?? [],
            input.forbiddenEffectIds ?? []
        );
        const base: EnumerationState = {
            effectIds: [...product.effectIds],
            ingredientIds: [],
            ingredientCost: 0,
        };
        let exploredStates = 1;
        let layer = new Map([[stateKey(base.effectIds), base]]);
        const outcomes = new Map(layer);

        for (let depth = 1; depth <= input.maxIngredients && layer.size > 0; depth++) {
            const next = new Map<string, EnumerationState>();
            for (const state of layer.values()) {
                for (const action of actions) {
                    const candidate: EnumerationState = {
                        effectIds: this.#engine.mixEffectIds(
                            product.drugType,
                            state.effectIds,
                            action.effectId
                        ),
                        ingredientIds: [...state.ingredientIds, action.id],
                        ingredientCost: state.ingredientCost + action.cost,
                    };
                    const key = stateKey(candidate.effectIds);
                    const prior = outcomes.get(key);
                    if (prior !== undefined && comparePaths(prior, candidate) <= 0) continue;
                    const current = next.get(key);
                    if (current !== undefined && comparePaths(current, candidate) <= 0) continue;
                    if (current === undefined && exploredStates + next.size >= this.#maxStates) {
                        throw new RecipeSearchLimitError(depth, this.#maxStates);
                    }
                    next.set(key, candidate);
                }
            }

            exploredStates += next.size;
            for (const [key, state] of next) {
                const current = outcomes.get(key);
                if (current === undefined || comparePaths(current, state) > 0) {
                    outcomes.set(key, state);
                }
            }
            layer = next;
        }

        return [...outcomes.values()]
            .filter((state) => constraints.matches(state.effectIds))
            .sort(comparePaths)
            .map((state) =>
                this.#evaluator.evaluate({
                    productId: input.productId,
                    ingredientIds: state.ingredientIds,
                })
            );
    }

    #product(id: string): NonNullable<Item['product']> {
        const item = this.#itemsById.get(id);
        if (item === undefined) throw new Error(`Unknown product ${JSON.stringify(id)}`);
        if (item.product === null) throw new Error(`Item ${JSON.stringify(id)} is not a product`);
        return item.product;
    }

    #ingredients(ids: readonly string[]): IngredientAction[] {
        const seen = new Set<string>();
        return ids.map((id) => {
            if (seen.has(id)) {
                throw new Error(`Duplicate available mixing ingredient ${JSON.stringify(id)}`);
            }
            seen.add(id);
            const item = this.#itemsById.get(id);
            if (item === undefined) throw new Error(`Unknown mixing ingredient ${JSON.stringify(id)}`);
            const effectId = item.mixingIngredient?.effectIds[0];
            if (effectId === undefined) {
                throw new Error(`Item ${JSON.stringify(id)} is not a mixing ingredient`);
            }
            if (item.basePurchasePrice === null) {
                throw new Error(`Mixing ingredient ${JSON.stringify(id)} has no purchase price`);
            }
            if (!Number.isFinite(item.basePurchasePrice) || item.basePurchasePrice < 0) {
                throw new Error(`Mixing ingredient ${JSON.stringify(id)} has an invalid purchase price`);
            }
            return { id, effectId, cost: item.basePurchasePrice };
        });
    }
}

class EffectConstraints {
    readonly #required: ReadonlySet<string>;
    readonly #forbidden: ReadonlySet<string>;

    constructor(
        engine: MixingEngine,
        requiredEffectIds: readonly string[],
        forbiddenEffectIds: readonly string[]
    ) {
        this.#required = effectIdSet(engine, requiredEffectIds, 'required');
        this.#forbidden = effectIdSet(engine, forbiddenEffectIds, 'forbidden');
        for (const effectId of this.#required) {
            if (this.#forbidden.has(effectId)) {
                throw new Error(
                    `Mixing effect ${JSON.stringify(effectId)} cannot be both required and forbidden`
                );
            }
        }
    }

    matches(effectIds: readonly string[]): boolean {
        for (const effectId of this.#required) {
            if (!effectIds.includes(effectId)) return false;
        }
        for (const effectId of this.#forbidden) {
            if (effectIds.includes(effectId)) return false;
        }
        return true;
    }
}

function effectIdSet(
    engine: MixingEngine,
    effectIds: readonly string[],
    kind: 'required' | 'forbidden'
): ReadonlySet<string> {
    const result = new Set<string>();
    for (const effectId of effectIds) {
        if (result.has(effectId)) {
            throw new Error(`Duplicate ${kind} mixing effect ${JSON.stringify(effectId)}`);
        }
        if (!engine.effectsById.has(effectId)) {
            throw new Error(`Unknown ${kind} mixing effect ${JSON.stringify(effectId)}`);
        }
        result.add(effectId);
    }
    return result;
}

function comparePaths(left: EnumerationState, right: EnumerationState): number {
    return (
        left.ingredientCost - right.ingredientCost ||
        left.ingredientIds.length - right.ingredientIds.length ||
        compareStrings(left.ingredientIds, right.ingredientIds) ||
        compareStrings(left.effectIds, right.effectIds)
    );
}

function compareStrings(left: readonly string[], right: readonly string[]): number {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
        const leftValue = left[index]!;
        const rightValue = right[index]!;
        if (leftValue === rightValue) continue;
        return leftValue < rightValue ? -1 : 1;
    }
    return left.length - right.length;
}

function stateKey(effectIds: readonly string[]): string {
    return JSON.stringify(effectIds);
}

function requireNonNegativeSafeInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${name} must be a non-negative safe integer`);
    }
}

function requirePositiveSafeInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive safe integer`);
    }
}
