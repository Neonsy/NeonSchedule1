import {
    CustomerOfferEvaluator,
    type CustomerCatalog,
    type CustomerOfferProfile,
    type CustomerOfferProduct,
} from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

describe('customer offer acceptance', () => {
    const evaluator = new CustomerOfferEvaluator(catalog());
    const customer: CustomerOfferProfile = {
        standards: 'Moderate',
        preferredEffectIds: ['calming', 'refreshing', 'thoughtprovoking'],
        drugAffinities: [{ drugType: 'Marijuana', affinity: 1 }],
        weeklySpend: { minimum: 600, maximum: 1_000 },
        weeklyOrders: { minimum: 3, maximum: 6 },
    };
    const product: CustomerOfferProduct = {
        drugTypes: ['Marijuana'],
        effectIds: ['refreshing'],
        marketValue: 44,
    };
    const state = { addiction: 0.2, relationship: 2, orderLimitMultiplier: 1.5 };

    it('combines product enjoyment, price value, and the customer budget', () => {
        expect(
            evaluator.evaluate(customer, product, state, {
                quality: 'Standard',
                quantity: 1,
                askingPrice: 44,
            })
        ).toBe(0.9438542127609253);
        expect(
            evaluator.evaluate(customer, product, state, {
                quality: 'Standard',
                quantity: 1,
                askingPrice: 66,
            })
        ).toBe(0.4369810223579407);
    });

    it('rejects an offer above three times the daily budget', () => {
        expect(
            evaluator.evaluate(customer, product, state, {
                quality: 'Standard',
                quantity: 1,
                askingPrice: 1_000,
            })
        ).toBe(0);
    });

    it('uses all seven budget days when a customer has no scheduled weekly orders', () => {
        expect(
            evaluator.evaluate(
                {
                    standards: 'Moderate',
                    preferredEffectIds: ['brighteyed', 'cyclopean', 'sedating'],
                    drugAffinities: [
                        { drugType: 'Cocaine', affinity: 0.45 },
                        { drugType: 'Marijuana', affinity: 0.72 },
                        { drugType: 'Methamphetamine', affinity: -0.3 },
                        { drugType: 'Shrooms', affinity: 0.65831065 },
                    ],
                    weeklySpend: { minimum: 600, maximum: 1_000 },
                    weeklyOrders: { minimum: 0, maximum: 0 },
                },
                { drugTypes: ['Cocaine'], effectIds: [], marketValue: 150 },
                { addiction: 0, relationship: 2, orderLimitMultiplier: 1 },
                { quality: 'Standard', quantity: 1, askingPrice: 150 }
            )
        ).toBe(0.7496165037155151);
    });

    it('preserves the game aggregation order for stacked products', () => {
        expect(
            evaluator.evaluate(
                {
                    standards: 'Low',
                    preferredEffectIds: ['Euphoric', 'caloriedense', 'munchies'],
                    drugAffinities: [
                        { drugType: 'Cocaine', affinity: 0.15 },
                        { drugType: 'Marijuana', affinity: 0.78 },
                        { drugType: 'Methamphetamine', affinity: -0.66 },
                        { drugType: 'Shrooms', affinity: 0.3931125 },
                    ],
                    weeklySpend: { minimum: 400, maximum: 800 },
                    weeklyOrders: { minimum: 3, maximum: 6 },
                },
                { drugTypes: ['Marijuana'], effectIds: ['sedating'], marketValue: 44 },
                { addiction: 0.2, relationship: 3, orderLimitMultiplier: 1 },
                { quality: 'Standard', quantity: 3, askingPrice: 132 }
            )
        ).toBe(0.7706018090248108);
    });
});

function catalog(): Pick<CustomerCatalog, 'constants' | 'qualityTiers'> {
    return {
        constants: {
            affinityMaxEffect: 0.3,
            propertyMaxEffect: 0.4,
            qualityMaxEffect: 0.3,
            maximumRelationship: 5,
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
