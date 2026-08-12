import { describe, expect, it } from 'vitest';

import {
    PersonEligibilityResolver,
    type Customer,
    type CustomerCatalog,
    type Person,
    type PersonEligibilityData,
    type RankCatalog,
    type RelationshipCatalog,
    type TradeCatalog,
    type WorldMap,
} from '@neonschedule1/core';

describe('person eligibility', () => {
    it('composes exact customer, recruited-dealer, and recruitable-dealer state', () => {
        const result = resolver().resolve({
            currentRank: { rank: 'Hoodlum', tier: 1 },
            unlockedPersonIds: ['customer', 'friend'],
            relationships: [{ personId: 'customer', relationship: 3.5 }],
            recommendedDealerIds: ['recruitable'],
            recruitedDealerIds: ['recruited'],
        });

        expect(result.customers).toEqual([{
            customerId: 'customer',
            status: 'eligible',
            currentRelationship: 3.5,
            reasons: [],
        }]);
        expect(result.dealers).toEqual([
            {
                dealerId: 'cartel',
                instanceKeys: ['cartel:docks', 'cartel:west'],
                dealerType: 'CartelDealer',
                status: 'ineligible',
                signingFeePaid: null,
                connectionIds: [],
                reasons: [{ code: 'unsupported-dealer-type', dealerType: 'CartelDealer' }],
            },
            {
                dealerId: 'recruitable',
                instanceKeys: ['recruitable:one'],
                dealerType: 'PlayerDealer',
                status: 'eligible',
                signingFeePaid: false,
                connectionIds: ['friend'],
                reasons: [],
            },
            {
                dealerId: 'recruited',
                instanceKeys: ['recruited:one'],
                dealerType: 'PlayerDealer',
                status: 'eligible',
                signingFeePaid: true,
                connectionIds: [],
                reasons: [],
            },
        ]);
        expect(result.eligibleCustomerIds).toEqual(['customer']);
        expect(result.dealerAssignmentStates).toEqual([
            { personId: 'recruitable', signingFeePaid: false },
            { personId: 'recruited', signingFeePaid: true },
        ]);
    });

    it('reports omitted live facts as unknown without using normalized defaults as save state', () => {
        const result = resolver().resolve({});

        expect(result.customers[0]).toEqual({
            customerId: 'customer',
            status: 'unknown',
            currentRelationship: null,
            reasons: [
                {
                    code: 'missing-current-rank',
                    regionId: 'Westville',
                    required: { rank: 'Hoodlum', tier: 1 },
                },
                { code: 'missing-person-unlock-fact' },
                { code: 'missing-current-relationship' },
            ],
        });
        expect(result.dealers.find(({ dealerId }) => dealerId === 'recruitable')).toMatchObject({
            status: 'unknown',
            signingFeePaid: null,
            reasons: [
                {
                    code: 'missing-current-rank',
                    regionId: 'Westville',
                    required: { rank: 'Hoodlum', tier: 1 },
                },
                { code: 'missing-dealer-recruitment-fact' },
            ],
        });
        expect(result.eligibleCustomerIds).toEqual([]);
        expect(result.dealerAssignmentStates).toEqual([]);
    });

    it('lets known negative evidence dominate missing facts and preserves every reason', () => {
        const result = resolver().resolve({
            currentRank: { rank: 'Street_Rat', tier: 1 },
            unlockedPersonIds: [],
            recommendedDealerIds: [],
            recruitedDealerIds: [],
        });

        expect(result.customers[0]).toMatchObject({
            status: 'ineligible',
            currentRelationship: null,
            reasons: [
                {
                    code: 'rank-below-region-requirement',
                    regionId: 'Westville',
                    current: { rank: 'Street_Rat', tier: 1 },
                    required: { rank: 'Hoodlum', tier: 1 },
                },
                { code: 'person-not-unlocked' },
                { code: 'missing-current-relationship' },
            ],
        });
        expect(result.dealers.find(({ dealerId }) => dealerId === 'recruitable')).toMatchObject({
            status: 'ineligible',
            signingFeePaid: false,
            reasons: [
                {
                    code: 'rank-below-region-requirement',
                    regionId: 'Westville',
                    current: { rank: 'Street_Rat', tier: 1 },
                    required: { rank: 'Hoodlum', tier: 1 },
                },
                { code: 'dealer-not-recommended' },
                { code: 'dealer-not-mutually-known', connectionIds: ['friend'] },
            ],
        });
    });

    it('uses the dealer outgoing connection list and does not require recruitment evidence again', () => {
        const result = resolver().resolve({
            currentRank: { rank: 'Hoodlum', tier: 1 },
            unlockedPersonIds: ['customer'],
            relationships: [{ personId: 'customer', relationship: 1 }],
            recommendedDealerIds: ['recruitable'],
            recruitedDealerIds: ['recruited'],
        });

        expect(result.dealers.find(({ dealerId }) => dealerId === 'recruitable')).toMatchObject({
            status: 'ineligible',
            reasons: [{ code: 'dealer-not-mutually-known', connectionIds: ['friend'] }],
        });
        expect(result.dealers.find(({ dealerId }) => dealerId === 'recruited')).toMatchObject({
            status: 'eligible',
            reasons: [],
        });
    });

    it('rejects unknown, duplicate, and out-of-range live facts', () => {
        const subject = resolver();
        expect(() => subject.resolve({ unlockedPersonIds: ['missing'] }))
            .toThrow('Unknown unlocked person "missing"');
        expect(() => subject.resolve({ recommendedDealerIds: ['recruited', 'recruited'] }))
            .toThrow('Duplicate recommended dealer "recruited"');
        expect(() => subject.resolve({
            relationships: [{ personId: 'customer', relationship: 6 }],
        })).toThrow('Relationship for "customer" must be between 0 and 5');
    });
});

function resolver(): PersonEligibilityResolver {
    return new PersonEligibilityResolver(fixture());
}

function fixture(): PersonEligibilityData {
    const ranks: RankCatalog = {
        schema: 'neonschedule1-rank-catalog-1',
        levels: [
            { rank: 'Street_Rat', tier: 1, totalXpRequired: 0, orderLimitMultiplier: 1 },
            { rank: 'Hoodlum', tier: 1, totalXpRequired: 1_000, orderLimitMultiplier: 1.25 },
        ],
    };
    const people = [
        person('customer', ['customer'], ['Westville'], ['customer:one']),
        person('friend', [], ['Northtown'], ['friend:one']),
        person('recruitable', ['dealer'], ['Westville'], ['recruitable:one']),
        person('recruited', ['dealer'], ['Northtown'], ['recruited:one']),
        person('cartel', ['dealer'], ['Docks', 'Westville'], ['cartel:docks', 'cartel:west']),
    ];
    const customer = { id: 'customer', region: 'Westville' } as Customer;
    const customerCatalog = {
        customerIds: ['customer'],
        constants: { minimumRelationship: 0, maximumRelationship: 5 },
    } as CustomerCatalog;
    const relationships: RelationshipCatalog = {
        schema: 'neonschedule1-relationship-catalog-1',
        personIds: people.map(({ id }) => id),
        edges: [{ sourceId: 'recruitable', targetId: 'friend', bidirectional: false }],
    };
    const world = {
        regions: [
            region('Northtown', true, 'Street Rat I'),
            region('Westville', false, 'Hoodlum I'),
            region('Docks', false, 'Hoodlum I'),
        ],
    } as WorldMap;
    const trade = {
        schema: 'neonschedule1-trade-catalog-2',
        dealerMechanics: {
            maximumCustomers: 8,
            dealArrivalDelay: 30,
            travelTime: { minimum: 15, maximum: 360 },
            overflowSlotCount: 1,
            cashReminderThreshold: 1_000,
            relationshipChangePerDeal: 0.01,
        },
        dealers: [
            dealer('recruitable', 'recruitable:one', 'PlayerDealer'),
            dealer('recruited', 'recruited:one', 'PlayerDealer'),
            dealer('cartel', 'cartel:docks', 'CartelDealer'),
            dealer('cartel', 'cartel:west', 'CartelDealer'),
        ],
        suppliers: [],
    } as TradeCatalog;
    return { ranks, world, people, customers: [customer], customerCatalog, relationships, trade };
}

function person(
    id: string,
    roles: readonly string[],
    regions: readonly string[],
    instanceKeys: readonly string[]
): Person {
    return {
        id,
        roles: [...roles],
        regions: [...regions],
        instances: instanceKeys.map((key) => ({ key })),
    } as Person;
}

function region(id: string, unlockedByDefault: boolean, rankRequirement: string) {
    return { id, unlockedByDefault, rankRequirement };
}

function dealer(personId: string, instanceKey: string, type: string) {
    return {
        personId,
        instanceKey,
        type,
        homeName: 'Home',
        walkSpeed: 4,
        salesCutPercentage: 0.2,
        signingFee: 100,
        qualityTolerance: { negative: 1, positive: 1 },
    };
}
