import { type } from 'arktype';

import { PublicKeySchema, SlugSchema } from '#public-data/browser/common-schema';
import { PublicBlueprintGeometrySchema } from '#public-data/browser/geometry-schema';
import { PublicProductionBundleSchema } from '#public-data/browser/production-schema';

const Sha256Schema = type(/^[0-9a-f]{64}$/u);
const HtmlRgbaSchema = type(/^#[0-9A-F]{8}$/u);

const Vector2Schema = type({ x: 'number', y: 'number' });

const PublicRangeSchema = type({ minimum: 'number', maximum: 'number' });

export const PublicEffectSchema = type({
    key: PublicKeySchema,
    slug: SlugSchema,
    label: 'string',
    description: 'string | null',
    tier: 'number',
    addictiveness: 'number',
    predatesMixingRework: 'boolean',
    value: {
        change: 'number',
        multiplier: 'number',
        addBaseValueMultiple: 'number',
    },
    mixing: {
        direction: Vector2Schema,
        magnitude: 'number',
    },
    colors: {
        product: HtmlRgbaSchema,
        label: HtmlRgbaSchema,
    },
});
export type PublicEffect = typeof PublicEffectSchema.infer;

const PublicItemProductSchema = type({
    drugType: 'string',
    basePrice: 'number',
    marketValue: 'number',
    baseAddictiveness: 'number',
    effectKeys: PublicKeySchema.array(),
    packagingKeys: PublicKeySchema.array(),
});

export const PublicItemSchema = type({
    key: PublicKeySchema,
    slug: SlugSchema.or('null'),
    label: 'string | null',
    access: "'player-facing' | 'calculation-only'",
    category: 'string',
    description: 'string | null',
    stackLimit: 'number',
    storable: 'boolean',
    basePurchasePrice: 'number | null',
    resellMultiplier: 'number',
    requiredRank: type({ label: 'string', tier: 'number' }).or('null'),
    product: PublicItemProductSchema.or('null'),
    packaging: type({ quantity: 'number', basePurchasePrice: 'number' }).or('null'),
    additive: type({
        qualityChange: 'number',
        yieldMultiplier: 'number',
        instantGrowth: 'number',
    }).or('null'),
    soil: type({ quality: 'string', uses: 'number' }).or('null'),
    mixingIngredient: type({ effectKeys: PublicKeySchema.array() }).or('null'),
    visualStatus: "'not-published'",
});
export type PublicItem = typeof PublicItemSchema.infer;

const PublicMixingEffectSchema = type({
    effectKey: PublicKeySchema,
    position: Vector2Schema,
    radius: 'number',
});

export const PublicMixingRulesSchema = type({
    maxProperties: 'number',
    maxDeltaDifference: 'number',
    defaultProductKeys: PublicKeySchema.array(),
    maps: type({
        drugType: 'string',
        drugTypeValue: 'number',
        radius: 'number',
        effects: PublicMixingEffectSchema.array(),
    }).array(),
});
export type PublicMixingRules = typeof PublicMixingRulesSchema.infer;

const PublicCustomerConstantsSchema = type({
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

export const PublicCustomerModelSchema = type({
    constants: PublicCustomerConstantsSchema,
    qualityTiers: type({ name: 'string', value: 'number', scalar: 'number' }).array(),
    productEvaluationInputs: type({
        productKey: PublicKeySchema,
        quantity: 'number',
        price: 'number',
        valueProposition: 'number',
    }).array(),
});
export type PublicCustomerModel = typeof PublicCustomerModelSchema.infer;

export const PublicCustomerSchema = type({
    key: PublicKeySchema,
    personKey: PublicKeySchema,
    slug: SlugSchema,
    label: 'string',
    regionKey: SlugSchema,
    standards: 'string',
    preferredEffectKeys: PublicKeySchema.array(),
    drugAffinities: type({ drugType: 'string', affinity: 'number' }).array(),
    baseAddiction: 'number',
    dependenceMultiplier: 'number',
    callPoliceChance: 'number',
    canBeDirectlyApproached: 'boolean',
    guaranteeFirstSampleSuccess: 'boolean',
    weeklySpend: PublicRangeSchema,
    weeklyOrders: PublicRangeSchema,
    preferredOrderDay: 'string',
    orderTime: 'number',
    mutualRelationshipRequirement: PublicRangeSchema,
    evaluation: type({
        productKey: PublicKeySchema,
        productEnjoyment: 'number',
        qualityEnjoyment: type({ quality: 'string', enjoyment: 'number' }).array(),
    }).array(),
});
export type PublicCustomer = typeof PublicCustomerSchema.infer;

export const PublicPersonSchema = type({
    key: PublicKeySchema,
    slug: SlugSchema,
    label: 'string',
    regionKeys: SlugSchema.array(),
    roles: "('customer' | 'dealer' | 'supplier')[]",
    defaultRelationship: 'number | null',
    displayRelationship: 'boolean | null',
    scheduleStatus: "'not-published'",
});
export type PublicPerson = typeof PublicPersonSchema.infer;

export const PublicRelationshipSchema = type({
    sourceKey: PublicKeySchema,
    targetKey: PublicKeySchema,
    bidirectional: 'boolean',
});
export type PublicRelationship = typeof PublicRelationshipSchema.infer;

const PublicDealerMechanicsSchema = type({
    maximumCustomers: 'number',
    dealArrivalDelay: 'number',
    travelTime: PublicRangeSchema,
    overflowSlotCount: 'number',
    cashReminderThreshold: 'number',
    relationshipChangePerDeal: 'number',
});

const PublicDealerSchema = type({
    personKey: PublicKeySchema,
    homeLabel: 'string',
    walkSpeed: 'number',
    salesCutPercentage: 'number',
    signingFee: 'number',
    qualityTolerance: type({ negative: 'number', positive: 'number' }),
});

const PublicSupplierSchema = type({
    personKey: PublicKeySchema,
    deadDropOrderLimit: PublicRangeSchema,
    deliveryRelationshipRequirement: 'number',
    meetupRelationshipRequirement: 'number',
    deadDropItemLimit: 'number',
    deadDropWaitPerItem: 'number',
    deadDropMaximumWait: 'number',
    meetupDuration: 'number',
    meetupCooldown: 'number',
    meetingEndDistance: 'number',
    shopKeys: PublicKeySchema.array(),
    deliveryListings: type({ itemKey: PublicKeySchema, price: 'number' }).array(),
});

export const PublicTradeSchema = type({
    dealerMechanics: PublicDealerMechanicsSchema,
    dealers: PublicDealerSchema.array(),
    suppliers: PublicSupplierSchema.array(),
});
export type PublicTrade = typeof PublicTradeSchema.infer;

export const PublicRankLevelSchema = type({
    label: 'string',
    tier: 'number',
    totalXpRequired: 'number',
    orderLimitMultiplier: 'number',
});
export type PublicRankLevel = typeof PublicRankLevelSchema.infer;

export const PublicPropertySchema = type({
    key: PublicKeySchema,
    slug: SlugSchema,
    label: 'string',
    price: 'number',
    employeeCapacity: 'number',
    loadingDockCount: 'number',
    gridCount: 'number',
    ambientTemperature: 'number',
    ownedByDefault: 'boolean',
    business: type({ launderCapacity: 'number', minimumLaunderAmount: 'number' }).or('null'),
    layoutStatus: "'calculation-geometry-published'",
});
export type PublicProperty = typeof PublicPropertySchema.infer;

export const PublicShopSchema = type({
    key: PublicKeySchema,
    slug: SlugSchema,
    label: 'string',
    description: 'string | null',
    payment: "'cash' | 'online'",
    holderPersonKey: PublicKeySchema.or('null'),
    openTime: 'number | null',
    closeTime: 'number | null',
    listings: type({
        itemKey: PublicKeySchema,
        price: 'number',
        defaultStock: 'number | null',
        deliverable: 'boolean',
    }).array(),
});
export type PublicShop = typeof PublicShopSchema.infer;

const PublicMapPointSchema = type({ x: 'number', y: 'number' });
const PublicWorldPointSchema = type({ x: 'number', z: 'number' });

const PublicMapSchema = type({
    key: "'hyland-point' | 'tutorial-area'",
    label: 'string',
    markerCoverage: "'mapped' | 'none'",
    asset: {
        path: 'string',
        sha256: Sha256Schema,
        width: 'number',
        height: 'number',
        treatmentKey: 'string',
    },
});

const PublicMapRegionSchema = type({
    mapKey: "'hyland-point'",
    key: SlugSchema,
    label: 'string',
    unlockedByDefault: 'boolean',
    rankRequirement: 'string | null',
    polygon: PublicMapPointSchema.array(),
});

const PublicMapMarkerPositionSchema = type({
    state: "'default' | 'potential-dealer' | 'dealer'",
    label: 'string | null',
    regionKey: SlugSchema.or('null'),
    position: PublicMapPointSchema,
    worldPosition: PublicWorldPointSchema,
});

const PublicMapMarkerSchema = type({
    mapKey: "'hyland-point'",
    key: type(/^marker-[0-9a-f]{20}$/u),
    kind: 'string',
    label: 'string',
    description: 'string | null',
    positions: PublicMapMarkerPositionSchema.array(),
});

export const BrowserMapSchema = type({
    maps: PublicMapSchema.array(),
    canvas: { width: 'number', height: 'number' },
    projection: {
        mapKey: "'hyland-point'",
        origin: PublicWorldPointSchema,
        edge: PublicWorldPointSchema,
        mapDimensions: 'number',
        conversionFactor: 'number',
    },
    regions: PublicMapRegionSchema.array(),
    markerKinds: type({ kind: 'string', label: 'string' }).array(),
    markers: PublicMapMarkerSchema.array(),
    limitations: type({ code: SlugSchema, count: 'number', reason: 'string' }).array(),
});
export type BrowserMap = typeof BrowserMapSchema.infer;

export const PublicFeatureCoverageSchema = type({
    key: SlugSchema,
    label: 'string',
    artifactStatus: "'included' | 'partial' | 'not-included' | 'not-game-data'",
    note: 'string',
});
export type PublicFeatureCoverage = typeof PublicFeatureCoverageSchema.infer;

export const BrowserDataArtifactSchema = type({
    schema: "'neonschedule1-browser-data-1'",
    compatibility: {
        gameVersion: 'string',
        normalizerVersion: 'string',
        datasetSha256: Sha256Schema,
        status: "'supported'",
        unsupportedVersionMessage: 'string',
    },
    coverage: PublicFeatureCoverageSchema.array(),
    effects: PublicEffectSchema.array(),
    items: PublicItemSchema.array(),
    mixing: PublicMixingRulesSchema,
    customerModel: PublicCustomerModelSchema,
    customers: PublicCustomerSchema.array(),
    people: PublicPersonSchema.array(),
    relationships: PublicRelationshipSchema.array(),
    trade: PublicTradeSchema,
    ranks: PublicRankLevelSchema.array(),
    production: PublicProductionBundleSchema,
    blueprintGeometry: PublicBlueprintGeometrySchema,
    properties: PublicPropertySchema.array(),
    shops: PublicShopSchema.array(),
    map: BrowserMapSchema,
    counts: {
        effects: 'number',
        items: 'number',
        playerFacingItems: 'number',
        calculationOnlyItems: 'number',
        customers: 'number',
        people: 'number',
        relationships: 'number',
        dealers: 'number',
        suppliers: 'number',
        rankLevels: 'number',
        seeds: 'number',
        stationRecipes: 'number',
        productionStations: 'number',
        logisticsStations: 'number',
        employeeRoles: 'number',
        buildables: 'number',
        propertyLayouts: 'number',
        properties: 'number',
        shops: 'number',
        mapMarkers: 'number',
    },
}).onDeepUndeclaredKey('reject');
export type BrowserDataArtifact = typeof BrowserDataArtifactSchema.infer;
