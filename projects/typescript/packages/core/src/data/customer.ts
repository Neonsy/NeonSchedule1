import { type } from 'arktype';

export const CustomerStandardsSchema = type("'VeryLow' | 'Low' | 'Moderate' | 'High'");
export type CustomerStandards = typeof CustomerStandardsSchema.infer;

export const CustomerDrugTypeSchema = type(
    "'Cocaine' | 'Heroin' | 'MDMA' | 'Marijuana' | 'Methamphetamine' | 'Shrooms'"
);
export type CustomerDrugType = typeof CustomerDrugTypeSchema.infer;

export const CustomerQualitySchema = type("'Trash' | 'Poor' | 'Standard' | 'Premium' | 'Heavenly'");
export type CustomerQuality = typeof CustomerQualitySchema.infer;

export const CustomerOrderDaySchema = type(
    "'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday'"
);
export type CustomerOrderDay = typeof CustomerOrderDaySchema.infer;

export const CustomerNameSchema = type({
    first: 'string',
    last: 'string',
    full: 'string',
});
export type CustomerName = typeof CustomerNameSchema.infer;

export const CustomerDrugAffinitySchema = type({
    drugType: CustomerDrugTypeSchema,
    affinity: 'number',
});
export type CustomerDrugAffinity = typeof CustomerDrugAffinitySchema.infer;

export const CustomerQualityEnjoymentSchema = type({
    quality: CustomerQualitySchema,
    enjoyment: 'number',
});
export type CustomerQualityEnjoyment = typeof CustomerQualityEnjoymentSchema.infer;

export const CustomerProductEvaluationOracleSchema = type({
    productId: 'string',
    productEnjoyment: 'number',
    qualityEnjoyment: CustomerQualityEnjoymentSchema.array(),
});
export type CustomerProductEvaluationOracle =
    typeof CustomerProductEvaluationOracleSchema.infer;

export const CustomerSchema = type({
    schema: "'neonschedule1-customer-1'",
    id: 'string',
    name: CustomerNameSchema,
    region: 'string',
    standards: CustomerStandardsSchema,
    preferredEffectIds: 'string[]',
    drugAffinities: CustomerDrugAffinitySchema.array(),
    baseAddiction: 'number',
    dependenceMultiplier: 'number',
    callPoliceChance: 'number',
    canBeDirectlyApproached: 'boolean',
    guaranteeFirstSampleSuccess: 'boolean',
    weeklySpend: { minimum: 'number', maximum: 'number' },
    weeklyOrders: { minimum: 'number', maximum: 'number' },
    preferredOrderDay: CustomerOrderDaySchema,
    orderTime: 'number',
    mutualRelationshipRequirement: { minimum: 'number', maximum: 'number' },
    evaluationOracle: CustomerProductEvaluationOracleSchema.array(),
});
export type Customer = typeof CustomerSchema.infer;

export const CustomerQualityTierSchema = type({
    name: CustomerQualitySchema,
    value: 'number',
});
export type CustomerQualityTier = typeof CustomerQualityTierSchema.infer;

export const CustomerProductEvaluationInputSchema = type({
    productId: 'string',
    quantity: 'number',
    price: 'number',
    valueProposition: 'number',
});
export type CustomerProductEvaluationInput =
    typeof CustomerProductEvaluationInputSchema.infer;

export const CustomerConstantsSchema = type({
    addictionDrainPerDay: 'number',
    affinityMaxEffect: 'number',
    approachChancePerDayMax: 'number',
    approachMinimumAddiction: 'number',
    approachMinimumCooldown: 'number',
    approachMaximumCooldown: 'number',
    dealCooldown: 'number',
    minimumTravelTime: 'number',
    maximumTravelTime: 'number',
    minimumNormalizedRelationshipForRecommendation: 'number',
    minimumOrderAppeal: 'number',
    propertyMaxEffect: 'number',
    qualityMaxEffect: 'number',
    guaranteedDealerRecommendationRelationship: 'number',
    guaranteedSupplierRecommendationRelationship: 'number',
    minimumRelationship: 'number',
    maximumRelationship: 'number',
    maximumOrderQuantityPerProduct: 'number',
    qualityTierTolerance: 'number',
    sampleRequiresRecommendation: 'boolean',
    attackDealCooldown: 'number',
    customerUnlockedCartelInfluenceChange: 'number',
    dealAttendanceTolerance: 'number',
    dealRejectedRelationshipChange: 'number',
    offerExpiryTimeMinutes: 'number',
    relationshipThresholdToGiveDealToCartel: 'number',
});
export type CustomerConstants = typeof CustomerConstantsSchema.infer;

export const CustomerCatalogSchema = type({
    schema: "'neonschedule1-customer-catalog-1'",
    constants: CustomerConstantsSchema,
    qualityTiers: CustomerQualityTierSchema.array(),
    productEvaluationInputs: CustomerProductEvaluationInputSchema.array(),
    customerIds: 'string[]',
});
export type CustomerCatalog = typeof CustomerCatalogSchema.infer;
