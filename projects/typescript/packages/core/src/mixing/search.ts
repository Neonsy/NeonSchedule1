import type { Item, Product } from '#core/data/item';
import { MixingEngine } from '#core/mixing/engine';
import type { RecipeEvaluation } from '#core/mixing/recipe';

const defaultMaxStates = 100_000;
const maxValueBoundDepth = 32;

export interface RecipeSearchInput {
    readonly productId: string;
    readonly availableIngredientIds: readonly string[];
    readonly maxIngredients: number;
    readonly limit: number;
}

export interface RecipeSearchOptions {
    readonly maxStates?: number;
}

interface IngredientAction {
    readonly id: string;
    readonly effectId: string;
    readonly cost: number;
}

interface SearchState {
    readonly effectIds: readonly string[];
    readonly ingredientIds: readonly string[];
    readonly ingredientCost: number;
}

export class RecipeSearchLimitError extends Error {
    readonly depth: number;
    readonly maxStates: number;

    constructor(depth: number, maxStates: number) {
        super(`Recipe search exceeded the ${maxStates}-state limit while building depth ${depth}`);
        this.name = 'RecipeSearchLimitError';
        this.depth = depth;
        this.maxStates = maxStates;
    }
}

export class RecipeSearch {
    readonly #engine: MixingEngine;
    readonly #itemsById: ReadonlyMap<string, Item>;
    readonly #maxStates: number;

    constructor(
        engine: MixingEngine,
        itemsById: ReadonlyMap<string, Item>,
        options: RecipeSearchOptions = {}
    ) {
        this.#engine = engine;
        this.#itemsById = itemsById;
        this.#maxStates = options.maxStates ?? defaultMaxStates;
        requirePositiveInteger(this.#maxStates, 'maxStates');
    }

    search(input: RecipeSearchInput): RecipeEvaluation[] {
        requireNonNegativeInteger(input.maxIngredients, 'maxIngredients');
        requirePositiveInteger(input.limit, 'limit');

        const product = this.#product(input.productId);
        const actions = this.#ingredients(input.availableIngredientIds);
        const base: SearchState = {
            effectIds: [...product.effectIds],
            ingredientIds: [],
            ingredientCost: 0,
        };
        let exploredStates = 1;
        let layer = new Map([[stateKey(base.effectIds), base]]);
        const outcomes = new Map([[stateKey(base.effectIds), evaluateState(input.productId, product, base, this.#engine)]]);
        const valueBound = new RecipeValueBound(this.#engine, product, actions);

        for (let depth = 1; depth <= input.maxIngredients && layer.size > 0; depth++) {
            const next = new Map<string, SearchState>();
            const cutoff = new ProductValueCutoff(outcomes, input.limit);
            const remainingIngredients = input.maxIngredients - depth + 1;
            const rankedStates = [...layer.values()]
                .map((state) => ({
                    state,
                    upperValue: valueBound.relaxedUpperValue(state.effectIds, remainingIngredients),
                }))
                .sort(
                    (left, right) =>
                        right.upperValue - left.upperValue ||
                        compareStrings(left.state.effectIds, right.state.effectIds)
                );
            for (const ranked of rankedStates) {
                const { state } = ranked;
                let { upperValue } = ranked;
                if (cutoff.value !== null && upperValue < cutoff.value) continue;
                if (remainingIngredients <= 2) {
                    const exact = valueBound.exactShortHorizon(state.effectIds, remainingIngredients);
                    cutoff.add(exact.key, exact.value);
                    upperValue = exact.value;
                    if (cutoff.value !== null && upperValue < cutoff.value) continue;
                }
                for (const action of actions) {
                    const candidate: SearchState = {
                        effectIds: this.#engine.mixEffectIds(product.drugType, state.effectIds, action.effectId),
                        ingredientIds: [...state.ingredientIds, action.id],
                        ingredientCost: state.ingredientCost + action.cost,
                    };
                    const key = stateKey(candidate.effectIds);
                    const prior = outcomes.get(key);
                    if (prior !== undefined && prior.ingredientCost <= candidate.ingredientCost) continue;
                    const current = next.get(key);
                    if (current !== undefined && comparePaths(current, candidate) <= 0) continue;
                    if (current === undefined && exploredStates + next.size >= this.#maxStates) {
                        throw new RecipeSearchLimitError(depth, this.#maxStates);
                    }
                    next.set(key, candidate);
                    if (current === undefined && !outcomes.has(key)) {
                        cutoff.add(key, this.#engine.calculateProductValue(product.basePrice, candidate.effectIds));
                    }
                }
            }

            exploredStates += next.size;
            for (const [key, state] of next) {
                const candidate = evaluateState(input.productId, product, state, this.#engine);
                const current = outcomes.get(key);
                if (current === undefined || comparePaths(current, candidate) > 0) outcomes.set(key, candidate);
            }
            layer = next;
        }

        return [...outcomes.values()].sort(compareRecipes).slice(0, input.limit);
    }

    #product(id: string): Product {
        const item = this.#itemsById.get(id);
        if (item === undefined) throw new Error(`Unknown product ${JSON.stringify(id)}`);
        if (item.product === null) throw new Error(`Item ${JSON.stringify(id)} is not a product`);
        return item.product;
    }

    #ingredients(ids: readonly string[]): IngredientAction[] {
        const seen = new Set<string>();
        return ids.map((id) => {
            if (seen.has(id)) throw new Error(`Duplicate available mixing ingredient ${JSON.stringify(id)}`);
            seen.add(id);
            const item = this.#itemsById.get(id);
            if (item === undefined) throw new Error(`Unknown mixing ingredient ${JSON.stringify(id)}`);
            const effectId = item.mixingIngredient?.effectIds[0];
            if (effectId === undefined) throw new Error(`Item ${JSON.stringify(id)} is not a mixing ingredient`);
            if (item.basePurchasePrice === null) {
                throw new Error(`Mixing ingredient ${JSON.stringify(id)} has no purchase price`);
            }
            return { id, effectId, cost: item.basePurchasePrice };
        });
    }
}

class ProductValueCutoff {
    readonly #limit: number;
    readonly #keys = new Set<string>();
    readonly #values: number[] = [];

    constructor(recipes: Iterable<readonly [string, RecipeEvaluation]>, limit: number) {
        this.#limit = limit;
        for (const [key, recipe] of recipes) this.add(key, recipe.productValue);
    }

    get value(): number | null {
        return this.#values.length < this.#limit ? null : (this.#values[this.#limit - 1] ?? null);
    }

    add(key: string, value: number): void {
        if (this.#keys.has(key)) return;
        this.#keys.add(key);
        const index = this.#values.findIndex((current) => value > current);
        if (index === -1) this.#values.push(value);
        else this.#values.splice(index, 0, value);
        if (this.#values.length > this.#limit) this.#values.pop();
    }
}

class RecipeValueBound {
    readonly #engine: MixingEngine;
    readonly #product: Product;
    readonly #actions: readonly IngredientAction[];
    readonly #bestEffectCache = new Map<string, string>();
    readonly #bestNewEffectCache = new Map<number, string | null>();

    constructor(engine: MixingEngine, product: Product, actions: readonly IngredientAction[]) {
        this.#engine = engine;
        this.#product = product;
        this.#actions = actions;
    }

    relaxedUpperValue(effectIds: readonly string[], remainingIngredients: number): number {
        if (this.#product.basePrice < 0 || remainingIngredients > maxValueBoundDepth) {
            return Number.POSITIVE_INFINITY;
        }

        const upperEffectIds = effectIds.map((effectId) => this.#bestEffect(effectId, remainingIngredients));
        const newEffectCount = Math.min(
            remainingIngredients,
            Math.max(0, this.#engine.rules.maxProperties - effectIds.length)
        );
        for (let index = 0; index < newEffectCount; index++) {
            const effectId = this.#bestNewEffect(remainingIngredients - index - 1);
            if (effectId !== null && this.#effectMultiple(effectId) > 0) upperEffectIds.push(effectId);
        }
        return this.#engine.calculateProductValue(this.#product.basePrice, upperEffectIds);
    }

    exactShortHorizon(
        effectIds: readonly string[],
        remainingIngredients: number
    ): { readonly key: string; readonly value: number } {
        let bestKey = stateKey(effectIds);
        let bestValue = this.#engine.calculateProductValue(this.#product.basePrice, effectIds);
        let layer = new Map([[stateKey(effectIds), effectIds]]);
        for (let depth = 0; depth < remainingIngredients; depth++) {
            const next = new Map<string, readonly string[]>();
            for (const current of layer.values()) {
                for (const action of this.#actions) {
                    const result = this.#engine.mixEffectIds(this.#product.drugType, current, action.effectId);
                    next.set(stateKey(result), result);
                }
            }
            for (const result of next.values()) {
                const key = stateKey(result);
                const value = this.#engine.calculateProductValue(this.#product.basePrice, result);
                if (value > bestValue || (value === bestValue && key < bestKey)) {
                    bestKey = key;
                    bestValue = value;
                }
            }
            layer = next;
        }
        return { key: bestKey, value: bestValue };
    }

    #bestEffect(effectId: string, remainingIngredients: number): string {
        const key = `${remainingIngredients}:${effectId}`;
        const cached = this.#bestEffectCache.get(key);
        if (cached !== undefined) return cached;

        let best = effectId;
        if (remainingIngredients > 0) {
            for (const action of this.#actions) {
                const transitioned = this.#engine.mixEffectIds(this.#product.drugType, [effectId], action.effectId)[0];
                if (transitioned === undefined) continue;
                const candidate = this.#bestEffect(transitioned, remainingIngredients - 1);
                if (this.#compareEffects(candidate, best) < 0) best = candidate;
            }
        }
        this.#bestEffectCache.set(key, best);
        return best;
    }

    #bestNewEffect(remainingIngredients: number): string | null {
        const cached = this.#bestNewEffectCache.get(remainingIngredients);
        if (cached !== undefined) return cached;

        let best: string | null = null;
        for (const action of this.#actions) {
            const candidate = this.#bestEffect(action.effectId, remainingIngredients);
            if (best === null || this.#compareEffects(candidate, best) < 0) best = candidate;
        }
        this.#bestNewEffectCache.set(remainingIngredients, best);
        return best;
    }

    #compareEffects(leftId: string, rightId: string): number {
        if (leftId === rightId) return 0;
        return this.#effectMultiple(rightId) - this.#effectMultiple(leftId) || (leftId < rightId ? -1 : 1);
    }

    #effectMultiple(effectId: string): number {
        const effect = this.#engine.effectsById.get(effectId);
        if (effect === undefined) throw new Error(`Unknown mixing effect ${JSON.stringify(effectId)}`);
        return effect.value.addBaseValueMultiple;
    }
}

function evaluateState(
    productId: string,
    product: Product,
    state: SearchState,
    engine: MixingEngine
): RecipeEvaluation {
    return {
        productId,
        ingredientIds: state.ingredientIds,
        effectIds: state.effectIds,
        productValue: engine.calculateProductValue(product.basePrice, state.effectIds),
        ingredientCost: state.ingredientCost,
        ingredientCount: state.ingredientIds.length,
    };
}

function compareRecipes(left: RecipeEvaluation, right: RecipeEvaluation): number {
    return (
        right.productValue - left.productValue ||
        comparePaths(left, right) ||
        compareStrings(left.effectIds, right.effectIds)
    );
}

function comparePaths(
    left: Pick<SearchState, 'ingredientCost' | 'ingredientIds'>,
    right: Pick<SearchState, 'ingredientCost' | 'ingredientIds'>
): number {
    return (
        left.ingredientCost - right.ingredientCost ||
        left.ingredientIds.length - right.ingredientIds.length ||
        compareStrings(left.ingredientIds, right.ingredientIds)
    );
}

function compareStrings(left: readonly string[], right: readonly string[]): number {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
        const leftValue = left[index];
        const rightValue = right[index];
        if (leftValue === undefined || rightValue === undefined || leftValue === rightValue) continue;
        return leftValue < rightValue ? -1 : 1;
    }
    return left.length - right.length;
}

function stateKey(effectIds: readonly string[]): string {
    return JSON.stringify(effectIds);
}

function requireNonNegativeInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
}

function requirePositiveInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`);
}
