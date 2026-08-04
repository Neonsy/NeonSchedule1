import type { Item } from '#core/data/item';

import { MixingEngine } from '#core/mixing/engine';

export interface RecipeInput {
    readonly productId: string;
    readonly ingredientIds: readonly string[];
}

export interface RecipeEvaluation {
    readonly productId: string;
    readonly ingredientIds: readonly string[];
    readonly effectIds: readonly string[];
    readonly productValue: number;
    readonly ingredientCost: number;
    readonly ingredientCount: number;
}

export class RecipeEvaluator {
    readonly #engine: MixingEngine;
    readonly #itemsById: ReadonlyMap<string, Item>;

    constructor(engine: MixingEngine, itemsById: ReadonlyMap<string, Item>) {
        this.#engine = engine;
        this.#itemsById = itemsById;
    }

    evaluate(input: RecipeInput): RecipeEvaluation {
        const product = this.#item(input.productId, 'product');
        if (product.product === null) {
            throw new Error(`Item ${JSON.stringify(product.id)} is not a product`);
        }

        let effectIds = [...product.product.effectIds];
        let ingredientCost = 0;

        for (const ingredientId of input.ingredientIds) {
            const ingredient = this.#item(ingredientId, 'mixing ingredient');
            const addedEffectId = ingredient.mixingIngredient?.effectIds[0];
            if (addedEffectId === undefined) {
                throw new Error(`Item ${JSON.stringify(ingredient.id)} is not a mixing ingredient`);
            }
            if (ingredient.basePurchasePrice === null) {
                throw new Error(`Mixing ingredient ${JSON.stringify(ingredient.id)} has no purchase price`);
            }

            effectIds = this.#engine.mixEffectIds(product.product.drugType, effectIds, addedEffectId);
            ingredientCost += ingredient.basePurchasePrice;
        }

        return {
            productId: product.id,
            ingredientIds: [...input.ingredientIds],
            effectIds,
            productValue: this.#engine.calculateProductValue(product.product.basePrice, effectIds),
            ingredientCost,
            ingredientCount: input.ingredientIds.length,
        };
    }

    #item(id: string, role: string): Item {
        const item = this.#itemsById.get(id);
        if (item === undefined) throw new Error(`Unknown ${role} ${JSON.stringify(id)}`);
        return item;
    }
}
