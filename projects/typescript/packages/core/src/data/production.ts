import { type } from 'arktype';

export const HarvestProductSchema = type({ itemId: 'string', quantity: 'number' });
export type HarvestProduct = typeof HarvestProductSchema.infer;

export const SeedProductionSchema = type({
    schema: "'neonschedule1-seed-production-3'",
    seedItemId: 'string',
    soilItemIds: 'string[]',
    plantRuntimeType: 'string',
    growthTimeMinutes: 'number',
    baseYieldQuantity: 'number',
    harvestTarget: 'string',
    harvestProducts: HarvestProductSchema.array(),
});
export type SeedProduction = typeof SeedProductionSchema.infer;

export const ProductionQualityTierSchema = type({
    name: 'string',
    minimumLevelExclusive: 'number | null',
    customerScalar: 'number',
});
export type ProductionQualityTier = typeof ProductionQualityTierSchema.infer;

export const ProductionQualityRulesSchema = type({
    basePlantLevel: 'number',
    monetaryValueVariesByQuality: 'false',
    customerQualityMaxEffect: 'number',
    tiers: ProductionQualityTierSchema.array(),
});
export type ProductionQualityRules = typeof ProductionQualityRulesSchema.infer;

export const ShroomProductionSchema = type({
    schema: "'neonschedule1-shroom-production-3'",
    spawnItemId: 'string',
    soilItemIds: 'string[]',
    productItemId: 'string',
    acceptedEquipmentItemIds: 'string[]',
    growTimeMinutes: 'number',
    baseYieldQuantity: 'number',
    maximumTemperatureForGrowth: 'number',
    minimumSoilMoistureForGrowth: 'number',
});
export type ShroomProduction = typeof ShroomProductionSchema.infer;

export const StationRecipeIngredientSchema = type({
    quantity: 'number',
    acceptedItemIds: 'string[]',
});
export type StationRecipeIngredient = typeof StationRecipeIngredientSchema.infer;

export const StationRecipeSchema = type({
    schema: "'neonschedule1-station-recipe-2'",
    id: 'string',
    title: 'string',
    cookTimeMinutes: 'number',
    cookTemperature: 'number',
    cookTemperatureTolerance: 'number',
    qualityCalculationMethod: 'string',
    acceptedEquipmentItemIds: 'string[]',
    ingredients: StationRecipeIngredientSchema.array(),
    outputItemId: 'string',
    outputQuantity: 'number',
});
export type StationRecipe = typeof StationRecipeSchema.infer;

export const OvenTransformSchema = type({
    schema: "'neonschedule1-oven-transform-2'",
    inputItemId: 'string',
    cookType: 'string',
    cookTimeMinutes: 'number',
    outputItemId: 'string',
    outputQuantity: 'number',
});
export type OvenTransform = typeof OvenTransformSchema.infer;

const stationBase = {
    schema: "'neonschedule1-production-station-3'",
    itemId: 'string',
} as const;

export const GrowContainerStationSchema = type({
    ...stationBase,
    kind: "'grow-container'",
    yieldMultiplier: 'number',
    growSpeedMultiplier: 'number',
    requiresExternalGrowLight: 'boolean',
    maxTemperatureGrowthMultiplier: 'number',
    minimumTemperatureThreshold: 'number',
    maximumTemperatureThreshold: 'number',
    allowedSoilIds: 'string[]',
    allowedAdditiveIds: 'string[]',
});

export const GrowLightStationSchema = type({
    ...stationBase,
    kind: "'grow-light'",
    growSpeedMultiplier: 'number',
});

export const SprinklerStationSchema = type({
    ...stationBase,
    kind: "'sprinkler'",
    applyDelay: 'number',
    cooldown: 'number',
    minimumTargetCount: 'number',
});

export const BrickPressStationSchema = type({
    ...stationBase,
    kind: "'brick-press'",
    packagingItemId: 'string',
    packagingQuantity: 'number',
});

export const CauldronStationSchema = type({
    ...stationBase,
    kind: "'cauldron'",
    cookTimeMinutes: 'number',
    requiredPrimaryInputQuantity: 'number',
    primaryInputItemId: 'string',
    secondaryInputItemId: 'string',
    secondaryInputQuantity: 'number',
    outputItemId: 'string',
    outputQuantity: 'number',
});

export const DryingRackStationSchema = type({
    ...stationBase,
    kind: "'drying-rack'",
    capacity: 'number',
    maxProcessMultiplier: 'number',
    processMinutesPerTier: 'number',
    minimumTemperatureThreshold: 'number',
    maximumTemperatureThreshold: 'number',
});

export const LabOvenStationSchema = type({ ...stationBase, kind: "'lab-oven'" });

export const MixingStationSchema = type({
    ...stationBase,
    kind: "'mixing' | 'mixing-mk2'",
    capacity: 'number',
    timePerItem: 'number',
    requiresManualIngredientInsertion: 'boolean',
});

export const SporeSyringeTransformSchema = type({
    syringeItemId: 'string',
    syringeQuantity: 'number',
    outputSpawnItemId: 'string',
    outputSpawnQuantity: 'number',
});

export const MushroomSpawnStationSchema = type({
    ...stationBase,
    kind: "'mushroom-spawn'",
    grainBagItemId: 'string',
    grainBagQuantity: 'number',
    workTimeMinutes: 'number',
    sporeSyringes: SporeSyringeTransformSchema.array(),
});

export const PackagingStationSchema = type({
    ...stationBase,
    kind: "'packaging' | 'packaging-mk2'",
    employeeSpeedMultiplier: 'number',
});

export const ProductionStationSchema = GrowContainerStationSchema.or(GrowLightStationSchema)
    .or(SprinklerStationSchema)
    .or(BrickPressStationSchema)
    .or(CauldronStationSchema)
    .or(DryingRackStationSchema)
    .or(LabOvenStationSchema)
    .or(MixingStationSchema)
    .or(MushroomSpawnStationSchema)
    .or(PackagingStationSchema);
export type ProductionStation = typeof ProductionStationSchema.infer;

export const ProductionCatalogSchema = type({
    schema: "'neonschedule1-production-catalog-5'",
    quality: ProductionQualityRulesSchema,
    seeds: SeedProductionSchema.array(),
    shrooms: ShroomProductionSchema.array(),
    stationRecipes: StationRecipeSchema.array(),
    ovenTransforms: OvenTransformSchema.array(),
    stations: ProductionStationSchema.array(),
});
export type ProductionCatalog = typeof ProductionCatalogSchema.infer;
