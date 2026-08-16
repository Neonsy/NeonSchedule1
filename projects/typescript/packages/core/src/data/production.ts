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

export const DryingOperationRulesSchema = type({
    schema: "'neonschedule1-drying-operation-rules-1'",
    requiresUnpackagedProduct: 'true',
    acceptedProductDrugTypes: 'string[]',
    specialQualityItemIdSubstring: 'string',
    specialItemRequiresQualityInstance: 'true',
    maximumQualityTier: 'string',
    itemIdTransformation: "'preserved'",
    quantityTransformation: "'preserved'",
    qualityTierIncrement: '1',
});
export type DryingOperationRules = typeof DryingOperationRulesSchema.infer;

export const PackagingOperationRulesSchema = type({
    schema: "'neonschedule1-packaging-operation-rules-1'",
    requiresUnpackagedProduct: 'true',
    packagingMaterialQuantityPerOperation: '1',
    packagedItemQuantityPerOperation: '1',
    productQuantitySource: "'packaging-definition-quantity'",
    itemIdTransformation: "'preserved'",
    productStateTransformation: "'unpackaged-to-packaged'",
    insufficientProductRemainder: "'left-unpackaged'",
    employeeBaseSecondsPerOperation: '5',
    employeeDurationFormula:
        "'base-seconds / employee-packaging-speed-multiplier / station-employee-speed-multiplier / employee-current-work-speed'",
    manualDuration: "'interactive-not-fixed'",
});
export type PackagingOperationRules = typeof PackagingOperationRulesSchema.infer;

export const BrickPressOperationRulesSchema = type({
    schema: "'neonschedule1-brick-press-operation-rules-1'",
    requiresUnpackagedProduct: 'true',
    packagingMaterialConsumption: "'none'",
    packagedItemQuantityPerOperation: '1',
    productQuantitySource: "'station-packaging-quantity'",
    itemIdTransformation: "'preserved'",
    productStateTransformation: "'unpackaged-to-packaged'",
    insufficientProductRemainder: "'left-unpackaged'",
    employeeBaseSecondsPerOperation: '15',
    employeeCompletionOverheadSecondsPerOperation: '1.2',
    employeeDurationFormula:
        "'base-seconds / employee-packaging-speed-multiplier / employee-current-work-speed + completion-overhead-seconds'",
    manualDuration: "'interactive-not-fixed'",
});
export type BrickPressOperationRules = typeof BrickPressOperationRulesSchema.infer;

// Current native PackagingStation.PackSingleInstance consumes one packaging definition and its
// contained product quantity. The employee behaviour waits five real seconds divided by the
// employee proficiency, station multiplier, and current work-speed multipliers.
export const PACKAGING_OPERATION_RULES = {
    schema: 'neonschedule1-packaging-operation-rules-1',
    requiresUnpackagedProduct: true,
    packagingMaterialQuantityPerOperation: 1,
    packagedItemQuantityPerOperation: 1,
    productQuantitySource: 'packaging-definition-quantity',
    itemIdTransformation: 'preserved',
    productStateTransformation: 'unpackaged-to-packaged',
    insufficientProductRemainder: 'left-unpackaged',
    employeeBaseSecondsPerOperation: 5,
    employeeDurationFormula:
        'base-seconds / employee-packaging-speed-multiplier / station-employee-speed-multiplier / employee-current-work-speed',
    manualDuration: 'interactive-not-fixed',
} as const satisfies PackagingOperationRules;

// Current native BrickPress.CompletePress consumes the station packaging quantity of one
// compatible unpackaged product, applies the brick packaging definition to one output instance,
// and consumes no separate packaging material. Employee work takes 15 divided real seconds plus
// 0.2 and 1 second completion waits; manual interaction has no fixed native duration.
export const BRICK_PRESS_OPERATION_RULES = {
    schema: 'neonschedule1-brick-press-operation-rules-1',
    requiresUnpackagedProduct: true,
    packagingMaterialConsumption: 'none',
    packagedItemQuantityPerOperation: 1,
    productQuantitySource: 'station-packaging-quantity',
    itemIdTransformation: 'preserved',
    productStateTransformation: 'unpackaged-to-packaged',
    insufficientProductRemainder: 'left-unpackaged',
    employeeBaseSecondsPerOperation: 15,
    employeeCompletionOverheadSecondsPerOperation: 1.2,
    employeeDurationFormula:
        'base-seconds / employee-packaging-speed-multiplier / employee-current-work-speed + completion-overhead-seconds',
    manualDuration: 'interactive-not-fixed',
} as const satisfies BrickPressOperationRules;

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
    schema: "'neonschedule1-production-station-4'",
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
    particleStopDelay: 'number | null',
    cooldown: 'number',
    minimumTargetCount: 'number',
    targetTileCoordinates: type({ x: 'number', y: 'number' }).array().or('null'),
});
export type SprinklerStation = typeof SprinklerStationSchema.infer;

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
    schema: "'neonschedule1-production-catalog-9'",
    quality: ProductionQualityRulesSchema,
    drying: DryingOperationRulesSchema,
    packaging: PackagingOperationRulesSchema,
    brickPressing: BrickPressOperationRulesSchema,
    seeds: SeedProductionSchema.array(),
    shrooms: ShroomProductionSchema.array(),
    stationRecipes: StationRecipeSchema.array(),
    ovenTransforms: OvenTransformSchema.array(),
    stations: ProductionStationSchema.array(),
});
export type ProductionCatalog = typeof ProductionCatalogSchema.infer;
