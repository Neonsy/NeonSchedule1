import { type } from 'arktype';

export const DealerMechanicsSchema = type({
    maximumCustomers: 'number',
    dealArrivalDelay: 'number',
    travelTime: {
        minimum: 'number',
        maximum: 'number',
    },
    overflowSlotCount: 'number',
    cashReminderThreshold: 'number',
    relationshipChangePerDeal: 'number',
});
export type DealerMechanics = typeof DealerMechanicsSchema.infer;

export const DealerProfileSchema = type({
    personId: 'string',
    instanceKey: 'string',
    type: 'string',
    homeName: 'string',
    salesCutPercentage: 'number',
    signingFee: 'number',
    qualityTolerance: {
        negative: 'number',
        positive: 'number',
    },
});
export type DealerProfile = typeof DealerProfileSchema.infer;

export const SupplierListingSchema = type({
    itemId: 'string',
    price: 'number',
});
export type SupplierListing = typeof SupplierListingSchema.infer;

export const SupplierProfileSchema = type({
    personId: 'string',
    deadDropOrderLimit: {
        minimum: 'number',
        maximum: 'number',
    },
    deliveryRelationshipRequirement: 'number',
    meetupRelationshipRequirement: 'number',
    deadDropItemLimit: 'number',
    deadDropWaitPerItem: 'number',
    deadDropMaximumWait: 'number',
    meetupDuration: 'number',
    meetupCooldown: 'number',
    meetingEndDistance: 'number',
    shopCodes: 'string[]',
    deliveryListings: SupplierListingSchema.array(),
});
export type SupplierProfile = typeof SupplierProfileSchema.infer;

export const TradeCatalogSchema = type({
    schema: "'neonschedule1-trade-catalog-1'",
    dealerMechanics: DealerMechanicsSchema,
    dealers: DealerProfileSchema.array(),
    suppliers: SupplierProfileSchema.array(),
});
export type TradeCatalog = typeof TradeCatalogSchema.infer;
