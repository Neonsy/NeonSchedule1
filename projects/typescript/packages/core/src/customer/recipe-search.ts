import {
    CustomerRecommendationRanker,
    type CustomerRecommendation,
    type CustomerRecommendationCandidate,
    type CustomerRecommendationInput,
} from '#core/customer/recommendation';
import type {
    CustomerCatalog,
    CustomerDrugType,
    CustomerQuality,
} from '#core/data/customer';
import type { Item } from '#core/data/item';
import {
    RecipeOutcomeEnumerator,
    type RecipeOutcomeEnumeratorOptions,
} from '#core/mixing/enumerate';
import type { MixingEngine } from '#core/mixing/engine';

export interface CustomerRecipeSearchInput {
    readonly productIds: readonly string[];
    readonly availableIngredientIds: readonly string[];
    readonly maxIngredients: number;
    readonly requiredEffectIds?: readonly string[];
    readonly forbiddenEffectIds?: readonly string[];
    readonly profile: CustomerRecommendationInput['profile'];
    readonly state: CustomerRecommendationInput['state'];
    readonly quality: CustomerQuality;
    readonly quantity: number;
    readonly priceMultiplier: number;
    readonly maximumProductionCost: number;
    readonly limit: number;
}

export type CustomerRecipeSearchOptions = RecipeOutcomeEnumeratorOptions;

export class CustomerRecipeSearch {
    readonly #itemsById: ReadonlyMap<string, Item>;
    readonly #recipes: RecipeOutcomeEnumerator;
    readonly #recommendations: CustomerRecommendationRanker;

    constructor(
        engine: MixingEngine,
        itemsById: ReadonlyMap<string, Item>,
        catalog: Pick<CustomerCatalog, 'constants' | 'qualityTiers'>,
        options: CustomerRecipeSearchOptions = {}
    ) {
        this.#itemsById = itemsById;
        this.#recipes = new RecipeOutcomeEnumerator(engine, itemsById, options);
        this.#recommendations = new CustomerRecommendationRanker(catalog);
    }

    search(input: CustomerRecipeSearchInput): CustomerRecommendation[] {
        const candidates: CustomerRecommendationCandidate[] = [];
        const seenProductIds = new Set<string>();

        for (const productId of input.productIds) {
            if (seenProductIds.has(productId)) {
                throw new Error(`Duplicate customer recommendation product ${JSON.stringify(productId)}`);
            }
            seenProductIds.add(productId);
            const drugType = this.#drugType(productId);
            const recipes = this.#recipes.enumerate({
                productId,
                availableIngredientIds: input.availableIngredientIds,
                maxIngredients: input.maxIngredients,
                ...(input.requiredEffectIds === undefined
                    ? {}
                    : { requiredEffectIds: input.requiredEffectIds }),
                ...(input.forbiddenEffectIds === undefined
                    ? {}
                    : { forbiddenEffectIds: input.forbiddenEffectIds }),
            });
            candidates.push(
                ...recipes.map((recipe): CustomerRecommendationCandidate => ({
                    recipe,
                    drugTypes: [drugType],
                }))
            );
        }

        return this.#recommendations.rank({
            candidates,
            profile: input.profile,
            state: input.state,
            quality: input.quality,
            quantity: input.quantity,
            priceMultiplier: input.priceMultiplier,
            maximumProductionCost: input.maximumProductionCost,
            limit: input.limit,
        });
    }

    #drugType(productId: string): CustomerDrugType {
        const item = this.#itemsById.get(productId);
        if (item === undefined) throw new Error(`Unknown product ${JSON.stringify(productId)}`);
        if (item.product === null) throw new Error(`Item ${JSON.stringify(productId)} is not a product`);
        return customerDrugType(item.product.drugType, productId);
    }
}

function customerDrugType(value: string, productId: string): CustomerDrugType {
    switch (value) {
        case 'Cocaine':
        case 'Heroin':
        case 'MDMA':
        case 'Marijuana':
        case 'Methamphetamine':
        case 'Shrooms':
            return value;
        default:
            throw new Error(
                `Product ${JSON.stringify(productId)} has unsupported customer drug type ${JSON.stringify(value)}`
            );
    }
}
