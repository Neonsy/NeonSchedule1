import { describe, expect, it } from 'vitest';

import type { RawReport } from '#data-compiler/acquisition/types';
import { Integrity } from '#data-compiler/integrity';
import { normalizeCustomers } from '#data-compiler/normalize/customers';

describe('customer normalization', () => {
    it('separates shared evaluation inputs from customer data and omits loaded-save observations', () => {
        const report = customerReport();
        const integrity = new Integrity();

        const normalized = normalizeCustomers(
            report,
            new Set(['calming']),
            new Set(['ogkush']),
            integrity
        );

        expect(integrity.errors).toEqual([]);
        expect(normalized.catalog).toMatchObject({
            schema: 'neonschedule1-customer-catalog-2',
            customerIds: ['customer'],
            qualityTiers: [
                { name: 'Trash', value: 0, scalar: 0 },
                { name: 'Poor', value: 1, scalar: 0.25 },
                { name: 'Standard', value: 2, scalar: 0.5 },
                { name: 'Premium', value: 3, scalar: 0.75 },
                { name: 'Heavenly', value: 4, scalar: 1 },
            ],
            productEvaluationInputs: [
                { productId: 'ogkush', quantity: 1, price: 38, valueProposition: 1 },
            ],
        });
        expect(normalized.customers[0]).toMatchObject({
            id: 'customer',
            name: { first: 'Test', last: 'Customer', full: 'Test Customer' },
            region: 'Downtown',
            preferredEffectIds: ['calming'],
            weeklySpend: { minimum: 200, maximum: 500 },
            evaluationOracle: [
                {
                    productId: 'ogkush',
                    productEnjoyment: 0.6,
                    qualityEnjoyment: [
                        { quality: 'Trash', enjoyment: 0.2 },
                        { quality: 'Poor', enjoyment: 0.3 },
                        { quality: 'Standard', enjoyment: 0.4 },
                        { quality: 'Premium', enjoyment: 0.5 },
                        { quality: 'Heavenly', enjoyment: 0.6 },
                    ],
                },
            ],
        });
        expect(normalized.customers[0]).not.toHaveProperty('sampleRequestSuccessChanceInLoadedSave');
        expect(normalized.customers[0]?.evaluationOracle[0]).not.toHaveProperty('offerSuccessChance');
        expect(normalized.customers[0]?.evaluationOracle[0]).not.toHaveProperty('sampleSuccessChance');
        expect(normalized.customers[0]).not.toHaveProperty('relationshipInLoadedSave');
    });

    it('reports missing references, incomplete coverage, and exporter evaluation errors', () => {
        const report = customerReport();
        report.customers[0]!.preferredEffectIds = ['missing-effect'];
        report.customers[0]!.productEvaluationErrors = ['ogkush:enjoyment:failed'];
        report.customers[0]!.productEvaluationBaseline = [];
        const integrity = new Integrity();

        normalizeCustomers(
            report,
            new Set(['calming']),
            new Set(['ogkush']),
            integrity
        );

        expect(integrity.errors).toContain(
            'customer customer preferred effect references missing id "missing-effect"'
        );
        expect(integrity.errors).toContain(
            'report.customers["customer"].productEvaluationErrors contains 1 error(s)'
        );
        expect(integrity.errors).toContain(
            'report.customers["customer"] evaluates 0 of 1 base products'
        );
    });
});

function customerReport(): RawReport {
    return {
        peopleSources: { uniqueCustomerCount: 1 },
        people: [
            {
                id: 'customer',
                firstName: 'Test',
                lastName: 'Customer',
                fullName: 'Test Customer',
                region: 'Downtown',
                relationshipInLoadedSave: 4,
                unlockedInLoadedSave: true,
            },
        ],
        customers: [
            {
                personId: 'customer',
                standards: 'Moderate',
                preferredEffectIds: ['calming'],
                drugAffinities: [{ drugType: 'Marijuana', affinity: 0.5 }],
                baseAddiction: 0.2,
                dependenceMultiplier: 1,
                callPoliceChance: 0.1,
                canBeDirectlyApproached: true,
                guaranteeFirstSampleSuccess: false,
                minimumWeeklySpend: 200,
                maximumWeeklySpend: 500,
                minimumOrdersPerWeek: 1,
                maximumOrdersPerWeek: 5,
                preferredOrderDay: 'Monday',
                orderTime: 1230,
                minimumMutualRelationshipRequirement: 2,
                maximumMutualRelationshipRequirement: 5,
                sampleRequestSuccessChanceInLoadedSave: 0.75,
                productEvaluationErrors: [],
                productEvaluationBaseline: [
                    {
                        productId: 'ogkush',
                        quantity: 1,
                        price: 38,
                        offerSuccessChance: 0,
                        sampleSuccessChance: 0.75,
                        productEnjoyment: 0.6,
                        valueProposition: 1,
                        errors: [],
                        qualityEnjoyment: [
                            quality('Trash', 0, 0.2),
                            quality('Poor', 1, 0.3),
                            quality('Standard', 2, 0.4),
                            quality('Premium', 3, 0.5),
                            quality('Heavenly', 4, 0.6),
                        ],
                    },
                ],
            },
        ],
        qualityMechanics: {
            qualityScalars: [
                { quality: 'Trash', scalar: 0 },
                { quality: 'Poor', scalar: 0.25 },
                { quality: 'Standard', scalar: 0.5 },
                { quality: 'Premium', scalar: 0.75 },
                { quality: 'Heavenly', scalar: 1 },
            ],
        },
        customerConstants: customerConstants(),
    } as unknown as RawReport;
}

function quality(qualityName: string, qualityValue: number, enjoyment: number) {
    return { quality: qualityName, qualityValue, enjoyment };
}

function customerConstants() {
    return {
        addictionDrainPerDay: 0.0625,
        affinityMaxEffect: 0.3,
        approachChancePerDayMax: 0.5,
        approachMinimumAddiction: 0.33,
        approachMinimumCooldown: 2160,
        approachMaximumCooldown: 4320,
        dealCooldown: 600,
        minimumTravelTime: 15,
        maximumTravelTime: 360,
        minimumNormalizedRelationshipForRecommendation: 0.5,
        minimumOrderAppeal: 0.05,
        propertyMaxEffect: 0.4,
        qualityMaxEffect: 0.3,
        guaranteedDealerRecommendationRelationship: 0.6,
        guaranteedSupplierRecommendationRelationship: 0.6,
        minimumRelationship: 0,
        maximumRelationship: 5,
        maximumOrderQuantityPerProduct: 1000,
        qualityTierTolerance: 2,
        sampleRequiresRecommendation: false,
        attackDealCooldown: 48,
        customerUnlockedCartelInfluenceChange: -0.075,
        dealAttendanceTolerance: 10,
        dealRejectedRelationshipChange: -0.5,
        offerExpiryTimeMinutes: 600,
        relationshipThresholdToGiveDealToCartel: 0.25,
    };
}
