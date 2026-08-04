import { type } from 'arktype';

import { Vector3Schema } from '#core/data/common';

export const ShopListingSchema = type({
    itemId: 'string',
    price: 'number',
    defaultStock: 'number | null',
    canBeDelivered: 'boolean',
});
export type ShopListing = typeof ShopListingSchema.infer;

export const ShopSchema = type({
    schema: "'neonschedule1-shop-1'",
    code: 'string',
    name: 'string',
    description: 'string',
    paymentType: 'string',
    sceneName: 'string',
    locationSource: 'string',
    position: Vector3Schema.or('null'),
    rotation: Vector3Schema.or('null'),
    holderPersonId: 'string | null',
    openTime: 'number | null',
    closeTime: 'number | null',
    deliveryBayPositions: Vector3Schema.array(),
    listings: ShopListingSchema.array(),
});
export type Shop = typeof ShopSchema.infer;
