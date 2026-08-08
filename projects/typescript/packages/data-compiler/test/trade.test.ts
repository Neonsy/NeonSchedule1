import type { Person, Shop } from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

import type { RawReport } from '#data-compiler/acquisition/types';
import { Integrity } from '#data-compiler/integrity';
import { normalizeTrade } from '#data-compiler/normalize/trade';

const people: Person[] = [
    person('dealer', ['dealer'], ['dealer:one']),
    person('supplier', ['supplier'], ['supplier:one']),
];
const shops: Shop[] = [shop()];
const itemIds = new Set(['seed', 'hat']);

describe('dealer and supplier normalization', () => {
    it('keeps stable mechanics and listings while joining person instances and shops', () => {
        const integrity = new Integrity();
        const normalized = normalizeTrade(report(), people, shops, itemIds, integrity);

        integrity.throwIfInvalid();
        expect(normalized).toEqual({
            schema: 'neonschedule1-trade-catalog-1',
            dealerMechanics: {
                maximumCustomers: 10,
                dealArrivalDelay: 30,
                travelTime: { minimum: 15, maximum: 360 },
                overflowSlotCount: 10,
                cashReminderThreshold: 500,
                relationshipChangePerDeal: 0.05,
            },
            dealers: [{
                personId: 'dealer',
                instanceKey: 'dealer:one',
                type: 'PlayerDealer',
                homeName: 'Dealer home',
                salesCutPercentage: 0.2,
                signingFee: 500,
                qualityTolerance: { negative: -2, positive: 5 },
            }],
            suppliers: [{
                personId: 'supplier',
                deadDropOrderLimit: { minimum: 50, maximum: 500 },
                deliveryRelationshipRequirement: 5,
                meetupRelationshipRequirement: 4,
                deadDropItemLimit: 10,
                deadDropWaitPerItem: 30,
                deadDropMaximumWait: 360,
                meetupDuration: 360,
                meetupCooldown: 720,
                meetingEndDistance: 20,
                shopCodes: ['supplier-shop'],
                deliveryListings: [{ itemId: 'seed', price: 30 }],
            }],
        });
        expect(normalized.dealers[0]).not.toHaveProperty('runtimeInstanceId');
        expect(normalized.suppliers[0]).not.toHaveProperty('currentDeadDropItemsInLoadedSave');
    });

    it('rejects a supplier listing that disagrees with its normalized shop', () => {
        const source = report();
        source.world.suppliers[0]!.deliveryListings = [{ itemId: 'seed', price: 31 }];
        const integrity = new Integrity();

        normalizeTrade(source, people, shops, itemIds, integrity);

        expect(integrity.errors).toContain(
            'report.world.suppliers["supplier"].deliveryListings["seed"] ' +
            'does not match a deliverable normalized shop listing'
        );
    });
});

function report(): RawReport {
    return {
        world: {
            dealerMechanics: {
                maximumCustomers: 10,
                dealArrivalDelay: 30,
                minimumTravelTime: 15,
                maximumTravelTime: 360,
                overflowSlotCount: 10,
                cashReminderThreshold: 500,
                relationshipChangePerDeal: 0.05,
            },
            dealers: [{
                personId: 'dealer',
                instanceKey: 'dealer:one',
                runtimeInstanceId: 123,
                objectPath: 'one',
                dealerType: 'PlayerDealer',
                homeName: 'Dealer home',
                salesCutPercentage: 0.2,
                signingFee: 500,
                negativeQualityTolerance: -2,
                positiveQualityTolerance: 5,
            }],
            suppliers: [{
                personId: 'supplier',
                minimumDeadDropOrderLimit: 50,
                maximumDeadDropOrderLimit: 500,
                deliveryRelationshipRequirement: 5,
                meetupRelationshipRequirement: 4,
                deadDropItemLimit: 10,
                deadDropWaitPerItem: 30,
                deadDropMaximumWait: 360,
                meetupDuration: 360,
                meetupCooldown: 720,
                meetingEndDistance: 20,
                deliveryListings: [{ itemId: 'seed', price: 30 }],
                currentDeadDropItemsInLoadedSave: [{ itemId: 'seed', quantity: 2 }],
            }],
        },
    } as unknown as RawReport;
}

function person(id: string, roles: string[], instanceKeys: string[]): Person {
    return {
        schema: 'neonschedule1-person-1',
        id,
        name: { first: id, last: '', full: id },
        regions: ['Test'],
        roles,
        defaultRelationship: 0.4,
        displayRelationship: true,
        instances: instanceKeys.map((key) => ({
            key,
            objectPath: key.slice(key.indexOf(':') + 1),
            presentation: {
                mugshotFileId: 'file',
                modelMeshIds: [],
                modelMaterialIds: [],
            },
            schedule: [],
        })),
    };
}

function shop(): Shop {
    return {
        schema: 'neonschedule1-shop-1',
        code: 'supplier-shop',
        name: 'Supplier',
        description: '',
        paymentType: 'Cash',
        sceneName: 'Test',
        locationSource: 'supplier',
        position: null,
        rotation: null,
        holderPersonId: 'supplier',
        openTime: null,
        closeTime: null,
        deliveryBayPositions: [],
        listings: [
            { itemId: 'seed', price: 30, defaultStock: null, canBeDelivered: true },
            { itemId: 'hat', price: 75, defaultStock: null, canBeDelivered: true },
        ],
    };
}
