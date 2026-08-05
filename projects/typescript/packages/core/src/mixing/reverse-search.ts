import type { Item } from '#core/data/item';
import type { MixingEngine } from '#core/mixing/engine';
import {
    compareRecipeEvaluations,
    type RecipeSearchObjective,
} from '#core/mixing/recipe-ranking';
import type { RecipeEvaluation } from '#core/mixing/recipe';
import { exactSearchEvidence, type RecipeSearchEvidence } from '#core/mixing/search-evidence';
import { RecipeSearch, type RecipeSearchOptions } from '#core/mixing/search';

export interface ReverseRecipeSearchInput {
    /** Omit to search every product definition in the supplied item collection. */
    readonly productIds?: readonly string[];
    readonly availableIngredientIds: readonly string[];
    readonly maxIngredients: number;
    readonly limit: number;
    readonly requiredEffectIds?: readonly string[];
    readonly forbiddenEffectIds?: readonly string[];
    readonly objective?: RecipeSearchObjective;
    readonly maximumTotalCost?: number;
}

export interface IngredientQuantity {
    readonly ingredientId: string;
    readonly quantity: number;
}

export interface ReverseRecipeEvaluation extends RecipeEvaluation {
    readonly ingredientQuantities: readonly IngredientQuantity[];
}

export interface ReverseRecipeSearchResult {
    readonly recipes: readonly ReverseRecipeEvaluation[];
    readonly evidence: RecipeSearchEvidence;
}

export class ReverseRecipeSearch {
    readonly #itemsById: ReadonlyMap<string, Item>;
    readonly #search: RecipeSearch;

    constructor(
        engine: MixingEngine,
        itemsById: ReadonlyMap<string, Item>,
        options: RecipeSearchOptions = {}
    ) {
        this.#itemsById = itemsById;
        this.#search = new RecipeSearch(engine, itemsById, options);
    }

    search(input: ReverseRecipeSearchInput): ReverseRecipeSearchResult {
        const productIds = this.#productIds(input.productIds);
        const objective = input.objective ?? 'productValue';
        const recipes: RecipeEvaluation[] = [];
        let exploredStates = 0;
        let prunedStates = 0;

        // A recipe below one base's top limit already has enough same-base recipes ahead of it
        // to exclude it from the combined top limit.
        for (const productId of productIds) {
            const result = this.#search.search({
                productId,
                availableIngredientIds: input.availableIngredientIds,
                maxIngredients: input.maxIngredients,
                limit: input.limit,
                ...(input.requiredEffectIds === undefined
                    ? {}
                    : { requiredEffectIds: input.requiredEffectIds }),
                ...(input.forbiddenEffectIds === undefined
                    ? {}
                    : { forbiddenEffectIds: input.forbiddenEffectIds }),
                ...(input.maximumTotalCost === undefined
                    ? {}
                    : { maximumTotalCost: input.maximumTotalCost }),
                objective,
            });
            recipes.push(...result.recipes);
            exploredStates += result.evidence.exploredStates;
            prunedStates += result.evidence.prunedStates;
        }

        return {
            recipes: recipes
                .sort((left, right) => compareRecipeEvaluations(left, right, objective))
                .slice(0, input.limit)
                .map((recipe) => ({
                    ...recipe,
                    ingredientQuantities: groupIngredients(recipe.ingredientIds),
                })),
            evidence: exactSearchEvidence(exploredStates, prunedStates, input.maxIngredients),
        };
    }

    #productIds(selectedIds: readonly string[] | undefined): string[] {
        const productIds = selectedIds ?? [
            ...this.#itemsById.values(),
        ].filter((item) => item.product !== null).map((item) => item.id);
        const seen = new Set<string>();
        for (const productId of productIds) {
            if (seen.has(productId)) {
                throw new Error(`Duplicate available product ${JSON.stringify(productId)}`);
            }
            seen.add(productId);
        }
        if (productIds.length === 0) throw new Error('At least one product is required');
        return [...productIds].sort();
    }
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
