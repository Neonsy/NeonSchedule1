import type { Item } from '#core/data/item';

import { MixingEngine } from '#core/mixing/engine';
import type { ProductionMaterialCostResolver } from '#core/production/cost';

export interface RecipeInput {
    readonly productId: string;
    readonly ingredientIds: readonly string[];
}

export interface RecipeEvaluation {
    readonly productId: string;
    readonly ingredientIds: readonly string[];
    readonly effectIds: readonly string[];
    readonly productValue: number;
    readonly baseProductCost: number;
    readonly baseProductCostBasis: 'base-purchase-price' | 'production-materials';
    readonly ingredientCost: number;
    readonly totalCost: number;
    readonly netValue: number;
    readonly ingredientCount: number;
}

export interface RecipeEvaluatorOptions {
    readonly productionCosts?: ProductionMaterialCostResolver;
}

export class RecipeEvaluator {
    readonly #engine: MixingEngine;
    readonly #itemsById: ReadonlyMap<string, Item>;
    readonly #productionCosts: ProductionMaterialCostResolver | undefined;

    constructor(
        engine: MixingEngine,
        itemsById: ReadonlyMap<string, Item>,
        options: RecipeEvaluatorOptions = {}
    ) {
        this.#engine = engine;
        this.#itemsById = itemsById;
        this.#productionCosts = options.productionCosts;
    }

    evaluate(input: RecipeInput): RecipeEvaluation {
        const product = this.#item(input.productId, 'product');
        if (product.product === null) {
            throw new Error(`Item ${JSON.stringify(product.id)} is not a product`);
        }
        const productionCost = this.#productionCosts?.unitCost(product.id);
        let baseProductCost: number;
        let baseProductCostBasis: RecipeEvaluation['baseProductCostBasis'];
        if (productionCost !== undefined) {
            baseProductCost = productionCost;
            baseProductCostBasis = 'production-materials';
        } else {
            if (product.basePurchasePrice === null) {
                throw new Error(`Product ${JSON.stringify(product.id)} has no base purchase price`);
            }
            baseProductCost = product.basePurchasePrice;
            baseProductCostBasis = 'base-purchase-price';
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

        const productValue = this.#engine.calculateProductValue(product.product.basePrice, effectIds);
        const totalCost = baseProductCost + ingredientCost;
        return {
            productId: product.id,
            ingredientIds: [...input.ingredientIds],
            effectIds,
            productValue,
            baseProductCost,
            baseProductCostBasis,
            ingredientCost,
            totalCost,
            netValue: productValue - totalCost,
            ingredientCount: input.ingredientIds.length,
        };
    }

    #item(id: string, role: string): Item {
        const item = this.#itemsById.get(id);
        if (item === undefined) throw new Error(`Unknown ${role} ${JSON.stringify(id)}`);
        return item;
    }
}
