import {
    CustomerDemandEvaluator,
    type CustomerCatalog,
    type CustomerDemandProfile,
} from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

describe('customer demand', () => {
    const evaluator = new CustomerDemandEvaluator({
        constants: { maximumRelationship: 5 } as CustomerCatalog['constants'],
    });
    const profile: CustomerDemandProfile = {
        weeklySpend: { minimum: 600, maximum: 1_000 },
        weeklyOrders: { minimum: 3, maximum: 6 },
    };

    it('derives the game affordability budget from customer state', () => {
        expect(
            evaluator.evaluate(profile, {
                addiction: 0.2,
                relationship: 2,
                orderLimitMultiplier: 1.5,
            })
        ).toEqual({
            normalizedRelationship: 0.4000000059604645,
            weeklyBudget: 1_140,
            intendedOrdersPerWeek: 4,
            orderDaysPerWeek: 4,
            budgetPerOrder: 285,
        });
    });

    it('uses the game fallback divisor when no weekly orders are intended', () => {
        expect(
            evaluator.evaluate(
                {
                    weeklySpend: { minimum: 700, maximum: 700 },
                    weeklyOrders: { minimum: 0, maximum: 0 },
                },
                { addiction: 0, relationship: 0, orderLimitMultiplier: 1 }
            )
        ).toEqual({
            normalizedRelationship: 0,
            weeklyBudget: 700,
            intendedOrdersPerWeek: 0,
            orderDaysPerWeek: 7,
            budgetPerOrder: 100,
        });
    });

    it('uses round-to-even for a halfway weekly order count', () => {
        expect(
            evaluator.evaluate(profile, {
                addiction: 0,
                relationship: 2.5,
                orderLimitMultiplier: 1,
            }).intendedOrdersPerWeek
        ).toBe(4);
    });

    it('rejects invalid dynamic state before producing a forecast', () => {
        expect(() =>
            evaluator.evaluate(profile, {
                addiction: 1.1,
                relationship: 0,
                orderLimitMultiplier: 1,
            })
        ).toThrow('Customer addiction must be between zero and one');
    });
});
