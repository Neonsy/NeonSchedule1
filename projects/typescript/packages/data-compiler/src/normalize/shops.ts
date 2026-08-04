import { ShopSchema, type Shop, type ShopListing } from '@neonschedule1/core';

import type { RawReport } from '../acquisition/types.js';
import { indexUnique, Integrity, requireReferences } from '../integrity.js';
import {
    booleanField,
    nullableNumberField,
    nullableStringField,
    numberField,
    objectArray,
    stringField,
} from '../json.js';
import { nullableVector3, optionalVector3 } from './shared.js';

export function normalizeShops(report: RawReport, itemIds: ReadonlySet<string>, integrity: Integrity): Shop[] {
    const shops = indexUnique(report.shops, 'code', 'report.shops', integrity);
    const details = indexUnique(report.discovery.shopDetails, 'code', 'report.discovery.shopDetails', integrity);
    requireReferences(details.keys(), new Set(shops.keys()), 'shop details', integrity);
    integrity.check(
        'every shop has one detail record',
        shops.size === details.size,
        `Expected ${shops.size} shop detail records, found ${details.size}`
    );

    return [...shops.entries()]
        .map(([code, raw]) => {
            const rawPath = `report.shops[${JSON.stringify(code)}]`;
            const detail = details.get(code);
            if (detail === undefined) {
                integrity.addError(`Shop ${JSON.stringify(code)} has no detail record`);
            }
            const normalizedListings = normalizeListings(raw, rawPath, itemIds, integrity);
            const shop: Shop = {
                schema: 'neonschedule1-shop-1',
                code,
                name: detail === undefined ? code : stringField(detail, 'name', `${rawPath}.details`),
                description: detail === undefined ? '' : stringField(detail, 'description', `${rawPath}.details`),
                paymentType: detail === undefined ? '' : stringField(detail, 'paymentType', `${rawPath}.details`),
                sceneName: detail === undefined ? '' : stringField(detail, 'sceneName', `${rawPath}.details`),
                locationSource: detail === undefined ? '' : stringField(detail, 'locationSource', `${rawPath}.details`),
                position: detail === undefined ? null : nullableVector3(detail, 'position', `${rawPath}.details`),
                rotation: detail === undefined ? null : nullableVector3(detail, 'rotation', `${rawPath}.details`),
                holderPersonId:
                    detail === undefined ? null : nullableStringField(detail, 'holderPersonId', `${rawPath}.details`),
                openTime: detail === undefined ? null : nullableNumberField(detail, 'openTime', `${rawPath}.details`),
                closeTime: detail === undefined ? null : nullableNumberField(detail, 'closeTime', `${rawPath}.details`),
                deliveryBayPositions:
                    detail === undefined ? [] : optionalVector3(detail, 'deliveryBayPositions', `${rawPath}.details`),
                listings: normalizedListings,
            };
            return ShopSchema.assert(shop);
        })
        .sort((left, right) => left.code.localeCompare(right.code));
}

function normalizeListings(
    shop: Record<string, unknown>,
    shopPath: string,
    itemIds: ReadonlySet<string>,
    integrity: Integrity
): ShopListing[] {
    const rawListings = objectArray(shop.listings, `${shopPath}.listings`);
    const seen = new Set<string>();
    const listings = rawListings.map((raw, index) => {
        const path = `${shopPath}.listings[${index}]`;
        const itemId = stringField(raw, 'itemId', path);
        if (seen.has(itemId)) integrity.addError(`${shopPath} contains duplicate listing ${itemId}`);
        seen.add(itemId);
        requireReferences([itemId], itemIds, `shop ${shopPath}`, integrity);
        const limited = booleanField(raw, 'limitedStock', path);
        return {
            itemId,
            price: numberField(raw, 'resolvedPrice', path),
            defaultStock: limited ? numberField(raw, 'defaultStock', path) : null,
            canBeDelivered: booleanField(raw, 'canBeDelivered', path),
        } satisfies ShopListing;
    });
    return listings.sort((left, right) => left.itemId.localeCompare(right.itemId));
}
