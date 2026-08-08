import type { CustomerRecommendation } from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

import {
    CustomerRecommendationAllocator,
    customerRecommendationStockResourceId,
} from '#solver/customer-allocation';

describe('customer recommendation allocation', () => {
    const datasetSha256 = 'a'.repeat(64);
    const allocator = new CustomerRecommendationAllocator();
    const sharedMixForAlice = recommendation('weed', ['cuke'], 2, 10, 20);
    const sharedMixForBob = recommendation('weed', ['cuke'], 1, 5, 12);

    it('composes and resolves real recommendation records', () => {
        const allocation = allocator.allocate({
            datasetSha256,
            recommendationSets: [
                { customerId: 'alice', recommendations: [sharedMixForAlice] },
                { customerId: 'bob', recommendations: [sharedMixForBob] },
            ],
            maximumProductionCost: 15,
            maximumStates: 100,
        });

        expect(allocation.result).toMatchObject({
            status: 'exact',
            productionCost: 15,
            expectedProfit: 32,
        });
        expect(allocation.allocations.map(({ customerId, recommendation: value }) => ({
            customerId,
            recommendation: value,
        }))).toEqual([
            { customerId: 'alice', recommendation: sharedMixForAlice },
            { customerId: 'bob', recommendation: sharedMixForBob },
        ]);
    });

    it('makes omitted mixes unavailable when finished stock is supplied', () => {
        const resourceId = customerRecommendationStockResourceId(
            datasetSha256,
            sharedMixForAlice
        );
        const allocation = allocator.allocate({
            datasetSha256,
            recommendationSets: [
                { customerId: 'alice', recommendations: [sharedMixForAlice] },
                { customerId: 'bob', recommendations: [sharedMixForBob] },
            ],
            maximumProductionCost: 15,
            stock: [{ resourceId, quantity: 2 }],
            maximumStates: 100,
        });

        expect(allocation.result.allocations).toHaveLength(1);
        expect(allocation.allocations[0]).toMatchObject({ customerId: 'alice' });
        expect(allocation.result.resourceUsage).toEqual([{ resourceId, quantity: 2 }]);
    });

    it('rejects stock identities from another recommendation set', () => {
        expect(() => allocator.allocate({
            datasetSha256,
            recommendationSets: [
                { customerId: 'alice', recommendations: [sharedMixForAlice] },
            ],
            maximumProductionCost: 10,
            stock: [{ resourceId: `mix:${'b'.repeat(64)}`, quantity: 1 }],
            maximumStates: 100,
        })).toThrow('Unknown recommendation stock resource');
    });
});

function recommendation(
    productId: string,
    ingredientIds: readonly string[],
    quantity: number,
    productionCost: number,
    expectedProfit: number
): CustomerRecommendation {
    return {
        recipe: {
            productId,
            ingredientIds,
            effectIds: ['refreshing'],
            productValue: 40,
            baseProductCost: 5,
            baseProductCostBasis: 'purchase-price',
            ingredientCost: 0,
            totalCost: productionCost / quantity,
            netValue: 35,
            ingredientCount: ingredientIds.length,
        },
        drugTypes: ['Marijuana'],
        quality: 'Standard',
        quantity,
        askingPrice: 40 * quantity,
        productionCost,
        grossProfit: 40 * quantity - productionCost,
        acceptanceChance: 1,
        expectedRevenue: 40 * quantity,
        expectedProfit,
    };
}
