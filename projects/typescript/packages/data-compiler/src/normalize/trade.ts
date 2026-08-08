import {
    TradeCatalogSchema,
    type DealerMechanics,
    type DealerProfile,
    type Person,
    type Shop,
    type SupplierListing,
    type SupplierProfile,
    type TradeCatalog,
} from '@neonschedule1/core';

import type { RawReport } from '#data-compiler/acquisition/types';
import { indexUnique, Integrity, requireReferences } from '#data-compiler/integrity';
import { numberField, objectArray, stringField, type JsonObject } from '#data-compiler/json';

export function normalizeTrade(
    report: RawReport,
    people: readonly Person[],
    shops: readonly Shop[],
    itemIds: ReadonlySet<string>,
    integrity: Integrity
): TradeCatalog {
    const peopleById = new Map(people.map((person) => [person.id, person]));
    const instancesByKey = new Map(
        people.flatMap((person) => person.instances.map((instance) => [instance.key, instance] as const))
    );
    const dealerSources = indexUnique(
        report.world.dealers,
        'instanceKey',
        'report.world.dealers',
        integrity
    );
    const supplierSources = indexUnique(
        report.world.suppliers,
        'personId',
        'report.world.suppliers',
        integrity
    );
    const expectedDealerKeys = new Set(
        people
            .filter((person) => person.roles.includes('dealer'))
            .flatMap((person) => person.instances.map((instance) => instance.key))
    );
    const expectedSupplierIds = new Set(
        people.filter((person) => person.roles.includes('supplier')).map((person) => person.id)
    );

    requireReferences(dealerSources.keys(), new Set(instancesByKey.keys()), 'dealer instance', integrity);
    requireReferences(expectedDealerKeys, new Set(dealerSources.keys()), 'dealer role instance', integrity);
    requireReferences(supplierSources.keys(), new Set(peopleById.keys()), 'supplier person', integrity);
    requireReferences(expectedSupplierIds, new Set(supplierSources.keys()), 'supplier role person', integrity);
    integrity.check(
        'every dealer-role instance has one dealer profile',
        dealerSources.size === expectedDealerKeys.size,
        `Expected ${expectedDealerKeys.size} dealer profiles, found ${dealerSources.size}`
    );
    integrity.check(
        'every supplier-role person has one supplier profile',
        supplierSources.size === expectedSupplierIds.size,
        `Expected ${expectedSupplierIds.size} supplier profiles, found ${supplierSources.size}`
    );

    const dealers = [...dealerSources.entries()]
        .map(([instanceKey, raw]) =>
            normalizeDealer(instanceKey, raw, peopleById, instancesByKey, integrity)
        )
        .sort(
            (left, right) =>
                left.personId.localeCompare(right.personId) ||
                left.instanceKey.localeCompare(right.instanceKey)
        );
    const suppliers = [...supplierSources.entries()]
        .map(([personId, raw]) =>
            normalizeSupplier(personId, raw, peopleById, shops, itemIds, integrity)
        )
        .sort((left, right) => left.personId.localeCompare(right.personId));
    return TradeCatalogSchema.assert({
        schema: 'neonschedule1-trade-catalog-1',
        dealerMechanics: normalizeDealerMechanics(report.world.dealerMechanics, integrity),
        dealers,
        suppliers,
    } satisfies TradeCatalog);
}

function normalizeDealerMechanics(raw: JsonObject, integrity: Integrity): DealerMechanics {
    const path = 'report.world.dealerMechanics';
    const maximumCustomers = numberField(raw, 'maximumCustomers', path);
    const dealArrivalDelay = numberField(raw, 'dealArrivalDelay', path);
    const minimumTravelTime = numberField(raw, 'minimumTravelTime', path);
    const maximumTravelTime = numberField(raw, 'maximumTravelTime', path);
    const overflowSlotCount = numberField(raw, 'overflowSlotCount', path);
    const cashReminderThreshold = numberField(raw, 'cashReminderThreshold', path);
    const relationshipChangePerDeal = numberField(raw, 'relationshipChangePerDeal', path);
    requireNonNegativeInteger(maximumCustomers, `${path}.maximumCustomers`, integrity);
    requireNonNegativeInteger(dealArrivalDelay, `${path}.dealArrivalDelay`, integrity);
    requireNonNegativeInteger(minimumTravelTime, `${path}.minimumTravelTime`, integrity);
    requireNonNegativeInteger(maximumTravelTime, `${path}.maximumTravelTime`, integrity);
    requireNonNegativeInteger(overflowSlotCount, `${path}.overflowSlotCount`, integrity);
    requireNonNegative(cashReminderThreshold, `${path}.cashReminderThreshold`, integrity);
    requireNonNegative(relationshipChangePerDeal, `${path}.relationshipChangePerDeal`, integrity);
    if (minimumTravelTime > maximumTravelTime) {
        integrity.addError(`${path}.minimumTravelTime exceeds maximumTravelTime`);
    }
    return {
        maximumCustomers,
        dealArrivalDelay,
        travelTime: { minimum: minimumTravelTime, maximum: maximumTravelTime },
        overflowSlotCount,
        cashReminderThreshold,
        relationshipChangePerDeal,
    };
}

function normalizeDealer(
    instanceKey: string,
    raw: JsonObject,
    peopleById: ReadonlyMap<string, Person>,
    instancesByKey: ReadonlyMap<string, Person['instances'][number]>,
    integrity: Integrity
): DealerProfile {
    const path = `report.world.dealers[${JSON.stringify(instanceKey)}]`;
    const personId = stringField(raw, 'personId', path);
    const person = peopleById.get(personId);
    const instance = instancesByKey.get(instanceKey);
    if (person === undefined || !person.roles.includes('dealer')) {
        integrity.addError(`${path}.personId does not identify a dealer-role person`);
    }
    if (instance === undefined || instance.objectPath !== stringField(raw, 'objectPath', path)) {
        integrity.addError(`${path}.objectPath differs from its person instance`);
    }

    const salesCutPercentage = numberField(raw, 'salesCutPercentage', path);
    const signingFee = numberField(raw, 'signingFee', path);
    const negativeTolerance = numberField(raw, 'negativeQualityTolerance', path);
    const positiveTolerance = numberField(raw, 'positiveQualityTolerance', path);
    if (salesCutPercentage < 0 || salesCutPercentage > 1) {
        integrity.addError(`${path}.salesCutPercentage must be between 0 and 1`);
    }
    requireNonNegative(signingFee, `${path}.signingFee`, integrity);
    if (!Number.isInteger(negativeTolerance) || negativeTolerance > 0) {
        integrity.addError(`${path}.negativeQualityTolerance must be a non-positive integer`);
    }
    if (!Number.isInteger(positiveTolerance) || positiveTolerance < 0) {
        integrity.addError(`${path}.positiveQualityTolerance must be a non-negative integer`);
    }
    return {
        personId,
        instanceKey,
        type: stringField(raw, 'dealerType', path),
        homeName: stringField(raw, 'homeName', path),
        salesCutPercentage,
        signingFee,
        qualityTolerance: { negative: negativeTolerance, positive: positiveTolerance },
    };
}

function normalizeSupplier(
    personId: string,
    raw: JsonObject,
    peopleById: ReadonlyMap<string, Person>,
    shops: readonly Shop[],
    itemIds: ReadonlySet<string>,
    integrity: Integrity
): SupplierProfile {
    const path = `report.world.suppliers[${JSON.stringify(personId)}]`;
    const person = peopleById.get(personId);
    if (person === undefined || !person.roles.includes('supplier')) {
        integrity.addError(`${path}.personId does not identify a supplier-role person`);
    }
    const minimumOrder = numberField(raw, 'minimumDeadDropOrderLimit', path);
    const maximumOrder = numberField(raw, 'maximumDeadDropOrderLimit', path);
    const deliveryRequirement = numberField(raw, 'deliveryRelationshipRequirement', path);
    const meetupRequirement = numberField(raw, 'meetupRelationshipRequirement', path);
    const deadDropItemLimit = numberField(raw, 'deadDropItemLimit', path);
    const deadDropWaitPerItem = numberField(raw, 'deadDropWaitPerItem', path);
    const deadDropMaximumWait = numberField(raw, 'deadDropMaximumWait', path);
    const meetupDuration = numberField(raw, 'meetupDuration', path);
    const meetupCooldown = numberField(raw, 'meetupCooldown', path);
    const meetingEndDistance = numberField(raw, 'meetingEndDistance', path);
    requireNonNegative(minimumOrder, `${path}.minimumDeadDropOrderLimit`, integrity);
    requireNonNegative(maximumOrder, `${path}.maximumDeadDropOrderLimit`, integrity);
    requireNonNegative(
        deliveryRequirement,
        `${path}.deliveryRelationshipRequirement`,
        integrity
    );
    requireNonNegative(
        meetupRequirement,
        `${path}.meetupRelationshipRequirement`,
        integrity
    );
    requireNonNegative(meetingEndDistance, `${path}.meetingEndDistance`, integrity);
    requireNonNegativeInteger(deadDropItemLimit, `${path}.deadDropItemLimit`, integrity);
    requireNonNegativeInteger(deadDropWaitPerItem, `${path}.deadDropWaitPerItem`, integrity);
    requireNonNegativeInteger(deadDropMaximumWait, `${path}.deadDropMaximumWait`, integrity);
    requireNonNegativeInteger(meetupDuration, `${path}.meetupDuration`, integrity);
    requireNonNegativeInteger(meetupCooldown, `${path}.meetupCooldown`, integrity);
    if (minimumOrder > maximumOrder) {
        integrity.addError(`${path}.minimumDeadDropOrderLimit exceeds maximumDeadDropOrderLimit`);
    }

    const supplierShops = shops.filter((shop) => shop.holderPersonId === personId);
    if (supplierShops.length === 0) integrity.addError(`${path} has no normalized shop`);
    const rawListings = indexUnique(
        objectArray(raw.deliveryListings, `${path}.deliveryListings`),
        'itemId',
        `${path}.deliveryListings`,
        integrity
    );
    requireReferences(rawListings.keys(), itemIds, `supplier ${personId} listing`, integrity);
    const deliveryListings = [...rawListings.entries()]
        .map(([itemId, listing]) =>
            normalizeSupplierListing(itemId, listing, path, supplierShops, integrity)
        )
        .sort((left, right) => left.itemId.localeCompare(right.itemId));
    objectArray(raw.currentDeadDropItemsInLoadedSave, `${path}.currentDeadDropItemsInLoadedSave`);
    return {
        personId,
        deadDropOrderLimit: { minimum: minimumOrder, maximum: maximumOrder },
        deliveryRelationshipRequirement: deliveryRequirement,
        meetupRelationshipRequirement: meetupRequirement,
        deadDropItemLimit,
        deadDropWaitPerItem,
        deadDropMaximumWait,
        meetupDuration,
        meetupCooldown,
        meetingEndDistance,
        shopCodes: supplierShops.map((shop) => shop.code).sort(),
        deliveryListings,
    };
}

function normalizeSupplierListing(
    itemId: string,
    raw: JsonObject,
    supplierPath: string,
    shops: readonly Shop[],
    integrity: Integrity
): SupplierListing {
    const path = `${supplierPath}.deliveryListings[${JSON.stringify(itemId)}]`;
    const price = numberField(raw, 'price', path);
    requireNonNegative(price, `${path}.price`, integrity);
    if (!shops.some((shop) =>
        shop.listings.some((listing) =>
            listing.itemId === itemId && listing.canBeDelivered && listing.price === price
        )
    )) {
        integrity.addError(`${path} does not match a deliverable normalized shop listing`);
    }
    return { itemId, price };
}

function requireNonNegative(value: number, path: string, integrity: Integrity): void {
    if (value < 0) integrity.addError(`${path} must not be negative`);
}

function requireNonNegativeInteger(value: number, path: string, integrity: Integrity): void {
    if (!Number.isInteger(value) || value < 0) {
        integrity.addError(`${path} must be a non-negative integer`);
    }
}
