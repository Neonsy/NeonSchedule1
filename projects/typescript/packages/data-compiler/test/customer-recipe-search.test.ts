import {
    CustomerRecommendationRanker,
    CustomerRecipeSearch,
    MixingEngine,
    RecipeOutcomeEnumerator,
    RecipeSearch,
    RecipeSearchLimitError,
    RecipeSearchWorkLimitError,
    type CustomerCatalog,
    type CustomerRecipeSearchInput,
    type Effect,
    type Item,
    type MixingRules,
} from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

describe('customer recipe search', () => {
    const effects = [
        effect('base', 0, 0),
        effect('valuable', 1, 1, 1),
        effect('preferred', 1, 2),
    ];
    const rules: MixingRules = {
        schema: 'neonschedule1-mixing-rules-1',
        maxProperties: 1,
        maxDeltaDifference: 0.5,
        defaultProductIds: [],
        maps: [
            {
                drugType: 'Marijuana',
                drugTypeValue: 0,
                radius: 3,
                effects: [
                    mapEffect('base', 0),
                    mapEffect('valuable', 1),
                    mapEffect('preferred', 2),
                ],
            },
        ],
    };
    const items = [
        product('product', ['base'], 10),
        ingredient('valuable-ingredient', 'valuable', 19),
        ingredient('preferred-ingredient', 'preferred', 0),
    ];
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const engine = new MixingEngine(rules, new Map(effects.map((entry) => [entry.id, entry])));

    it('enumerates every unique outcome without a top-result cutoff', () => {
        const outcomes = new RecipeOutcomeEnumerator(engine, itemsById, {
            maxStates: 3,
        }).enumerate({
            productId: 'product',
            availableIngredientIds: ['valuable-ingredient', 'preferred-ingredient'],
            maxIngredients: 1,
        });

        expect(outcomes.map(({ ingredientIds, effectIds, totalCost }) => ({
            ingredientIds,
            effectIds,
            totalCost,
        }))).toEqual([
            { ingredientIds: [], effectIds: ['base'], totalCost: 0 },
            { ingredientIds: ['preferred-ingredient'], effectIds: ['preferred'], totalCost: 0 },
            { ingredientIds: ['valuable-ingredient'], effectIds: ['valuable'], totalCost: 19 },
        ]);
    });

    it('finds a customer-preferred recipe outside the normal top-value result', () => {
        const ordinary = new RecipeSearch(engine, itemsById).search({
            productId: 'product',
            availableIngredientIds: ['valuable-ingredient', 'preferred-ingredient'],
            maxIngredients: 1,
            limit: 1,
        });
        const customer = new CustomerRecipeSearch(engine, itemsById, catalog()).search({
            productIds: ['product'],
            availableIngredientIds: ['valuable-ingredient', 'preferred-ingredient'],
            maxIngredients: 1,
            profile: {
                standards: 'Moderate',
                preferredEffectIds: ['preferred'],
                drugAffinities: [{ drugType: 'Marijuana', affinity: 0 }],
                weeklySpend: { minimum: 100, maximum: 100 },
                weeklyOrders: { minimum: 1, maximum: 1 },
            },
            state: { addiction: 0, relationship: 0, orderLimitMultiplier: 1 },
            quality: 'Standard',
            quantity: 1,
            priceMultiplier: 1,
            maximumProductionCost: 100,
            limit: 1,
        });

        expect(ordinary.recipes[0]?.ingredientIds).toEqual(['valuable-ingredient']);
        expect(customer.recommendations[0]?.recipe.ingredientIds).toEqual([
            'preferred-ingredient',
        ]);
        expect(customer.recommendations[0]?.recipe.productValue).toBe(10);
        expect(customer.evidence).toMatchObject({
            proofStatus: 'exact',
            stopReason: 'completed',
            completedDepth: 1,
        });
    });

    it('matches exhaustive customer ranking before relying on pruning', () => {
        const input = customerSearchInput(3);
        const exhaustiveCandidates = new RecipeOutcomeEnumerator(engine, itemsById)
            .enumerate({
                productId: 'product',
                availableIngredientIds: input.availableIngredientIds,
                maxIngredients: input.maxIngredients,
            })
            .map((recipe) => ({ recipe, drugTypes: ['Marijuana'] }));
        const exhaustive = new CustomerRecommendationRanker(catalog()).rank({
            ...input,
            candidates: exhaustiveCandidates,
        });
        const optimized = new CustomerRecipeSearch(engine, itemsById, catalog()).search({
            ...input,
            productIds: ['product'],
        });

        expect(optimized.recommendations).toEqual(exhaustive);
    });

    it('accepts drug types supplied by a future normalized dataset', () => {
        const futureDrugType = 'FutureBuildDrug';
        const futureItems = [
            {
                ...items[0]!,
                product: { ...items[0]!.product!, drugType: futureDrugType },
            },
            ...items.slice(1),
        ];
        const futureEngine = new MixingEngine(
            {
                ...rules,
                maps: rules.maps.map((map) => ({ ...map, drugType: futureDrugType })),
            },
            new Map(effects.map((entry) => [entry.id, entry]))
        );
        const result = new CustomerRecipeSearch(
            futureEngine,
            new Map(futureItems.map((item) => [item.id, item])),
            catalog()
        ).search({
            ...customerSearchInput(1),
            productIds: ['product'],
            profile: {
                ...customerSearchInput(1).profile,
                drugAffinities: [{ drugType: futureDrugType, affinity: 0 }],
            },
        });

        expect(result.recommendations[0]?.recipe.ingredientIds).toEqual([
            'preferred-ingredient',
        ]);
    });

    it('fails instead of returning an incomplete ranking at either limit', () => {
        const input: CustomerRecipeSearchInput = {
            productIds: ['product'],
            availableIngredientIds: ['valuable-ingredient', 'preferred-ingredient'],
            maxIngredients: 1,
            profile: {
                standards: 'Moderate',
                preferredEffectIds: ['preferred'],
                drugAffinities: [{ drugType: 'Marijuana', affinity: 0 }],
                weeklySpend: { minimum: 100, maximum: 100 },
                weeklyOrders: { minimum: 1, maximum: 1 },
            },
            state: { addiction: 0, relationship: 0, orderLimitMultiplier: 1 },
            quality: 'Standard',
            quantity: 1,
            priceMultiplier: 1,
            maximumProductionCost: 100,
            limit: 1,
        };
        const search = new CustomerRecipeSearch(engine, itemsById, catalog(), { maxStates: 1 });

        let failure: unknown;
        try {
            search.search(input);
        } catch (error) {
            failure = error;
        }

        expect(failure).toBeInstanceOf(RecipeSearchLimitError);
        expect((failure as RecipeSearchLimitError).evidence).toEqual({
            proofStatus: 'incomplete',
            stopReason: 'state-limit',
            exploredStates: 1,
            prunedStates: 1,
            completedDepth: 0,
            transitionEvaluations: 4,
            boundTransitionEvaluations: 2,
        });

        const workSearch = new CustomerRecipeSearch(engine, itemsById, catalog(), {
            maxStates: 10,
            maxTransitionEvaluations: 2,
        });
        let workFailure: unknown;
        try {
            workSearch.search(input);
        } catch (error) {
            workFailure = error;
        }

        expect(workFailure).toBeInstanceOf(RecipeSearchWorkLimitError);
        expect((workFailure as RecipeSearchWorkLimitError).evidence).toEqual({
            proofStatus: 'incomplete',
            stopReason: 'work-limit',
            exploredStates: 1,
            prunedStates: 0,
            completedDepth: 0,
            transitionEvaluations: 2,
            boundTransitionEvaluations: 2,
        });
    });
});

function customerSearchInput(
    maxIngredients: number
): Omit<CustomerRecipeSearchInput, 'productIds'> {
    return {
        availableIngredientIds: ['valuable-ingredient', 'preferred-ingredient'],
        maxIngredients,
        profile: {
            standards: 'Moderate',
            preferredEffectIds: ['preferred'],
            drugAffinities: [{ drugType: 'Marijuana', affinity: 0 }],
            weeklySpend: { minimum: 100, maximum: 100 },
            weeklyOrders: { minimum: 1, maximum: 1 },
        },
        state: { addiction: 0, relationship: 0, orderLimitMultiplier: 1 },
        quality: 'Standard',
        quantity: 1,
        priceMultiplier: 1,
        maximumProductionCost: 100,
        limit: 1,
    };
}

function effect(
    id: string,
    directionX: number,
    magnitude: number,
    addBaseValueMultiple = 0
): Effect {
    return {
        schema: 'neonschedule1-effect-1',
        id,
        name: id,
        tier: 0,
        addictiveness: 0,
        implementedPriorMixingRework: false,
        value: { change: 0, multiplier: 1, addBaseValueMultiple },
        mixing: { direction: { x: directionX, y: 0 }, magnitude },
        presentation: {
            description: '',
            productColor: color(),
            labelColor: color(),
        },
    };
}

function mapEffect(effectId: string, x: number) {
    return { effectId, position: { x, y: 0 }, radius: 0.01 };
}

function product(id: string, effectIds: string[], basePrice: number): Item {
    return {
        ...item(id),
        basePurchasePrice: 0,
        product: {
            drugType: 'Marijuana',
            basePrice,
            marketValue: basePrice,
            baseAddictiveness: 0,
            effectIds,
            validPackagingIds: [],
        },
    };
}

function ingredient(id: string, effectId: string, basePurchasePrice: number): Item {
    return { ...item(id), basePurchasePrice, mixingIngredient: { effectIds: [effectId] } };
}

function item(id: string): Item {
    return {
        schema: 'neonschedule1-item-3',
        id,
        name: id,
        category: 'Test',
        isRuntimeOnly: false,
        stackLimit: 20,
        isStorable: true,
        basePurchasePrice: null,
        resellMultiplier: 1,
        requiredRank: null,
        requiredRankTier: null,
        product: null,
        packaging: null,
        additive: null,
        soil: null,
        mixingIngredient: null,
        presentation: {
            description: '',
            iconFileId: null,
            visualKind: 'none',
            fallbackMeshIds: [],
            fallbackMaterialIds: [],
        },
    };
}

function catalog(): Pick<CustomerCatalog, 'constants' | 'qualityTiers'> {
    return {
        constants: {
            affinityMaxEffect: 0.3,
            propertyMaxEffect: 0.4,
            qualityMaxEffect: 0.3,
            maximumRelationship: 5,
            maximumOrderQuantityPerProduct: 1_000,
        } as CustomerCatalog['constants'],
        qualityTiers: [
            { name: 'Trash', value: 0, scalar: 0 },
            { name: 'Poor', value: 1, scalar: 0.25 },
            { name: 'Standard', value: 2, scalar: 0.5 },
            { name: 'Premium', value: 3, scalar: 0.75 },
            { name: 'Heavenly', value: 4, scalar: 1 },
        ],
    };
}

function color() {
    return { r: 0, g: 0, b: 0, a: 1, htmlRgba: '#000000FF' };
}
