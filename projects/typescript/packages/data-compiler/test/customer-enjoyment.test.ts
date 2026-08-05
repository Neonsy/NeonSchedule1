import {
    CustomerEnjoymentEvaluator,
    type CustomerCatalog,
    type CustomerEnjoymentProfile,
    type CustomerEnjoymentProduct,
} from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

describe('customer enjoyment', () => {
    it('reproduces the exported base-product and quality values', () => {
        const evaluator = new CustomerEnjoymentEvaluator(catalog());
        const customer: CustomerEnjoymentProfile = {
            standards: 'Moderate',
            preferredEffectIds: ['calming', 'refreshing', 'thoughtprovoking'],
            drugAffinities: [{ drugType: 'Marijuana', affinity: 1 }],
        };
        const product: CustomerEnjoymentProduct = {
            drugTypes: ['Marijuana'],
            effectIds: ['refreshing'],
        };

        expect(evaluator.evaluate(customer, product)).toBe(0.7948717474937439);
        expect(evaluator.evaluateAtQuality(customer, product, 'Trash')).toBe(
            0.4583333432674408
        );
        expect(evaluator.evaluateAtQuality(customer, product, 'Poor')).toBe(
            0.5520833134651184
        );
        expect(evaluator.evaluateAtQuality(customer, product, 'Standard')).toBe(
            0.7395833730697632
        );
        expect(evaluator.evaluateAtQuality(customer, product, 'Premium')).toBe(
            0.8333333730697632
        );
        expect(evaluator.evaluateAtQuality(customer, product, 'Heavenly')).toBe(
            0.8333333730697632
        );
    });

    it('uses zero for an affinity the customer does not define', () => {
        const evaluator = new CustomerEnjoymentEvaluator(catalog());
        const customer: CustomerEnjoymentProfile = {
            standards: 'VeryHigh',
            preferredEffectIds: [],
            drugAffinities: [],
        };

        expect(
            evaluator.evaluate(customer, { drugTypes: ['Shrooms'], effectIds: [] })
        ).toBe(0.4615384638309479);
        expect(
            evaluator.evaluateAtQuality(
                customer,
                { drugTypes: ['Shrooms'], effectIds: [] },
                'Heavenly'
            )
        ).toBe(0.46875);
    });
});

function catalog(): Pick<CustomerCatalog, 'constants' | 'qualityTiers'> {
    return {
        constants: {
            affinityMaxEffect: 0.3,
            propertyMaxEffect: 0.4,
            qualityMaxEffect: 0.3,
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
