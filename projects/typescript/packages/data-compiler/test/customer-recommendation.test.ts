import {
    CustomerRecommendationRanker,
    type CustomerCatalog,
    type CustomerOfferProfile,
    type CustomerRecommendationCandidate,
} from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

describe('customer recommendations', () => {
    const ranker = new CustomerRecommendationRanker(catalog());
    const profile: CustomerOfferProfile = {
        standards: 'Moderate',
        preferredEffectIds: ['calming', 'refreshing', 'thoughtprovoking'],
        drugAffinities: [{ drugType: 'Marijuana', affinity: 1 }],
        weeklySpend: { minimum: 600, maximum: 1_000 },
        weeklyOrders: { minimum: 3, maximum: 6 },
    };
    const state = { addiction: 0.2, relationship: 2, orderLimitMultiplier: 1.5 };

    it('ranks affordable recipes by acceptance-weighted profit', () => {
        const recommendations = ranker.rank({
            candidates: [
                candidate('small-margin', 44, 20),
                candidate('best-margin', 66, 30),
                candidate('over-budget', 100, 80),
            ],
            profile,
            state,
            quality: 'Standard',
            quantity: 1,
            priceMultiplier: 1,
            maximumProductionCost: 40,
            limit: 5,
        });

        expect(recommendations.map(({ recipe }) => recipe.productId)).toEqual([
            'best-margin',
            'small-margin',
        ]);
        expect(recommendations[0]).toMatchObject({
            askingPrice: 66,
            productionCost: 30,
            grossProfit: 36,
            acceptanceChance: 0.9438542127609253,
        });
        expect(recommendations[0]?.expectedRevenue).toBeCloseTo(62.294377);
        expect(recommendations[0]?.expectedProfit).toBeCloseTo(33.9787517);
    });

    it('applies quantity and market-relative pricing to the offer', () => {
        const [recommendation] = ranker.rank({
            candidates: [candidate('stacked', 44, 20)],
            profile,
            state,
            quality: 'Standard',
            quantity: 3,
            priceMultiplier: 1.5,
            maximumProductionCost: 60,
            limit: 1,
        });

        expect(recommendation).toMatchObject({
            askingPrice: 198,
            productionCost: 60,
            grossProfit: 138,
            acceptanceChance: 0.4369810223579407,
        });
    });

    it('rejects quantities beyond the exported game limit', () => {
        expect(() =>
            ranker.rank({
                candidates: [],
                profile,
                state,
                quality: 'Standard',
                quantity: 1_001,
                priceMultiplier: 1,
                maximumProductionCost: 100,
                limit: 1,
            })
        ).toThrow('Customer recommendation quantity cannot exceed 1000');
    });
});

function candidate(
    productId: string,
    productValue: number,
    totalCost: number
): CustomerRecommendationCandidate {
    return {
        drugTypes: ['Marijuana'],
        recipe: {
            productId,
            ingredientIds: [],
            effectIds: ['refreshing'],
            productValue,
            baseProductCost: totalCost,
            baseProductCostBasis: 'production-materials',
            ingredientCost: 0,
            totalCost,
            netValue: productValue - totalCost,
            ingredientCount: 0,
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
