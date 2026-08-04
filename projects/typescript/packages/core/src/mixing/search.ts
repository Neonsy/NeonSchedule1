import type { Item, Product } from '#core/data/item';
import { MixingEngine } from '#core/mixing/engine';
import type { RecipeEvaluation } from '#core/mixing/recipe';

const defaultMaxStates = 100_000;

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

        for (let depth = 1; depth <= input.maxIngredients && layer.size > 0; depth++) {
            const next = new Map<string, SearchState>();
            for (const state of layer.values()) {
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
