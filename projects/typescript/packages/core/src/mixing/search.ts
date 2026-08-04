import type { Item, Product } from '#core/data/item';
import { MixingEngine } from '#core/mixing/engine';
import type { RecipeEvaluation } from '#core/mixing/recipe';

const defaultMaxStates = 100_000;
const maxValueBoundDepth = 32;

export type RecipeSearchObjective = 'productValue' | 'netValue';

export interface RecipeSearchInput {
    readonly productId: string;
    readonly availableIngredientIds: readonly string[];
    readonly maxIngredients: number;
    readonly limit: number;
    readonly requiredEffectIds?: readonly string[];
    readonly forbiddenEffectIds?: readonly string[];
    readonly objective?: RecipeSearchObjective;
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

type CostedProduct = Product & { readonly baseProductCost: number };

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
        const objective = requireObjective(input.objective ?? 'productValue');
        const constraints = new FinalEffectConstraints(
            this.#engine,
            input.requiredEffectIds ?? [],
            input.forbiddenEffectIds ?? []
        );
        const base: SearchState = {
            effectIds: [...product.effectIds],
            ingredientIds: [],
            ingredientCost: 0,
        };
        let exploredStates = 1;
        let layer = new Map([[stateKey(base.effectIds), base]]);
        const outcomes = new Map([[stateKey(base.effectIds), evaluateState(input.productId, product, base, this.#engine)]]);
        const valueBound = new RecipeValueBound(this.#engine, product, actions, objective);

        for (let depth = 1; depth <= input.maxIngredients && layer.size > 0; depth++) {
            const next = new Map<string, SearchState>();
            const cutoff = new RecipeScoreCutoff(outcomes, input.limit, constraints, objective);
            const remainingIngredients = input.maxIngredients - depth + 1;
            const rankedStates = [...layer.values()]
                .map((state) => ({
                    state,
                    upperScore: valueBound.relaxedUpperScore(
                        state.effectIds,
                        state.ingredientCost,
                        remainingIngredients
                    ),
                }))
                .sort(
                    (left, right) =>
                        right.upperScore - left.upperScore ||
                        compareStrings(left.state.effectIds, right.state.effectIds)
                );
            for (const ranked of rankedStates) {
                const { state } = ranked;
                let { upperScore } = ranked;
                if (cutoff.value !== null && upperScore < cutoff.value) continue;
                if (remainingIngredients <= 2) {
                    const exact = valueBound.exactShortHorizon(
                        state.effectIds,
                        state.ingredientCost,
                        remainingIngredients,
                        constraints
                    );
                    if (exact === null) continue;
                    cutoff.add(exact.key, exact.value);
                    upperScore = exact.value;
                    if (cutoff.value !== null && upperScore < cutoff.value) continue;
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
                    if (constraints.matches(candidate.effectIds)) {
                        cutoff.add(
                            key,
                            recipeScore(
                                this.#engine.calculateProductValue(product.basePrice, candidate.effectIds),
                                product.baseProductCost,
                                candidate.ingredientCost,
                                objective
                            )
                        );
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

        return [...outcomes.values()]
            .filter((recipe) => constraints.matches(recipe.effectIds))
            .sort((left, right) => compareRecipes(left, right, objective))
            .slice(0, input.limit);
    }

    #product(id: string): CostedProduct {
        const item = this.#itemsById.get(id);
        if (item === undefined) throw new Error(`Unknown product ${JSON.stringify(id)}`);
        if (item.product === null) throw new Error(`Item ${JSON.stringify(id)} is not a product`);
        if (item.basePurchasePrice === null) {
            throw new Error(`Product ${JSON.stringify(id)} has no base purchase price`);
        }
        return { ...item.product, baseProductCost: item.basePurchasePrice };
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

class RecipeScoreCutoff {
    readonly #limit: number;
    readonly #scoresByKey = new Map<string, number>();
    readonly #values: number[] = [];

    constructor(
        recipes: Iterable<readonly [string, RecipeEvaluation]>,
        limit: number,
        constraints: FinalEffectConstraints,
        objective: RecipeSearchObjective
    ) {
        this.#limit = limit;
        for (const [key, recipe] of recipes) {
            if (constraints.matches(recipe.effectIds)) {
                this.add(
                    key,
                    recipeScore(
                        recipe.productValue,
                        recipe.baseProductCost,
                        recipe.ingredientCost,
                        objective
                    )
                );
            }
        }
    }

    get value(): number | null {
        return this.#values.length < this.#limit ? null : (this.#values[this.#limit - 1] ?? null);
    }

    add(key: string, value: number): void {
        const prior = this.#scoresByKey.get(key);
        if (prior !== undefined && prior >= value) return;
        this.#scoresByKey.set(key, value);
        if (prior !== undefined) {
            const priorIndex = this.#values.indexOf(prior);
            if (priorIndex !== -1) this.#values.splice(priorIndex, 1);
        }
        const index = this.#values.findIndex((current) => value > current);
        if (index === -1) this.#values.push(value);
        else this.#values.splice(index, 0, value);
        if (this.#values.length > this.#limit) this.#values.pop();
    }
}

class RecipeValueBound {
    readonly #engine: MixingEngine;
    readonly #product: CostedProduct;
    readonly #actions: readonly IngredientAction[];
    readonly #objective: RecipeSearchObjective;
    readonly #minimumActionCost: number;
    readonly #bestEffectCache = new Map<string, string>();
    readonly #bestNewEffectCache = new Map<number, string | null>();

    constructor(
        engine: MixingEngine,
        product: CostedProduct,
        actions: readonly IngredientAction[],
        objective: RecipeSearchObjective
    ) {
        this.#engine = engine;
        this.#product = product;
        this.#actions = actions;
        this.#objective = objective;
        this.#minimumActionCost = Math.min(0, ...actions.map((action) => action.cost));
    }

    relaxedUpperScore(
        effectIds: readonly string[],
        ingredientCost: number,
        remainingIngredients: number
    ): number {
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
        const upperValue = this.#engine.calculateProductValue(this.#product.basePrice, upperEffectIds);
        const lowerCost = ingredientCost + this.#minimumActionCost * remainingIngredients;
        return recipeScore(upperValue, this.#product.baseProductCost, lowerCost, this.#objective);
    }

    exactShortHorizon(
        effectIds: readonly string[],
        ingredientCost: number,
        remainingIngredients: number,
        constraints: FinalEffectConstraints
    ): { readonly key: string; readonly value: number } | null {
        let best: { readonly key: string; readonly value: number } | null = null;
        if (constraints.matches(effectIds)) {
            best = {
                key: stateKey(effectIds),
                value: recipeScore(
                    this.#engine.calculateProductValue(this.#product.basePrice, effectIds),
                    this.#product.baseProductCost,
                    ingredientCost,
                    this.#objective
                ),
            };
        }
        let layer = new Map([
            [stateKey(effectIds), { effectIds, additionalIngredientCost: 0 }],
        ]);
        for (let depth = 0; depth < remainingIngredients; depth++) {
            const next = new Map<
                string,
                { readonly effectIds: readonly string[]; readonly additionalIngredientCost: number }
            >();
            for (const current of layer.values()) {
                for (const action of this.#actions) {
                    const result = this.#engine.mixEffectIds(
                        this.#product.drugType,
                        current.effectIds,
                        action.effectId
                    );
                    const key = stateKey(result);
                    const additionalIngredientCost = current.additionalIngredientCost + action.cost;
                    const existing = next.get(key);
                    if (
                        existing === undefined ||
                        additionalIngredientCost < existing.additionalIngredientCost
                    ) {
                        next.set(key, { effectIds: result, additionalIngredientCost });
                    }
                }
            }
            for (const result of next.values()) {
                if (!constraints.matches(result.effectIds)) continue;
                const key = stateKey(result.effectIds);
                const value = recipeScore(
                    this.#engine.calculateProductValue(this.#product.basePrice, result.effectIds),
                    this.#product.baseProductCost,
                    ingredientCost + result.additionalIngredientCost,
                    this.#objective
                );
                if (best === null || value > best.value || (value === best.value && key < best.key)) {
                    best = { key, value };
                }
            }
            layer = next;
        }
        return best;
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

class FinalEffectConstraints {
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
                throw new Error(`Mixing effect ${JSON.stringify(effectId)} cannot be both required and forbidden`);
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

function evaluateState(
    productId: string,
    product: CostedProduct,
    state: SearchState,
    engine: MixingEngine
): RecipeEvaluation {
    const productValue = engine.calculateProductValue(product.basePrice, state.effectIds);
    const totalCost = product.baseProductCost + state.ingredientCost;
    return {
        productId,
        ingredientIds: state.ingredientIds,
        effectIds: state.effectIds,
        productValue,
        baseProductCost: product.baseProductCost,
        ingredientCost: state.ingredientCost,
        totalCost,
        netValue: productValue - totalCost,
        ingredientCount: state.ingredientIds.length,
    };
}

function compareRecipes(
    left: RecipeEvaluation,
    right: RecipeEvaluation,
    objective: RecipeSearchObjective
): number {
    return (
        recipeScore(right.productValue, right.baseProductCost, right.ingredientCost, objective) -
            recipeScore(left.productValue, left.baseProductCost, left.ingredientCost, objective) ||
        comparePaths(left, right) ||
        compareStrings(left.effectIds, right.effectIds)
    );
}

function recipeScore(
    productValue: number,
    baseProductCost: number,
    ingredientCost: number,
    objective: RecipeSearchObjective
): number {
    return objective === 'productValue'
        ? productValue
        : productValue - baseProductCost - ingredientCost;
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

function requireObjective(objective: string): RecipeSearchObjective {
    if (objective !== 'productValue' && objective !== 'netValue') {
        throw new Error(`Unknown recipe search objective ${JSON.stringify(objective)}`);
    }
    return objective;
}

function requireNonNegativeInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
}

function requirePositiveInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`);
}
