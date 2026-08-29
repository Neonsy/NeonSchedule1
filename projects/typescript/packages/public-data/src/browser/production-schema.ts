import { type } from 'arktype';

import { PublicKeySchema, SlugSchema } from '#public-data/browser/common-schema';

const TileCoordinateSchema = type({ x: 'number', y: 'number' });

const PublicProductionQualitySchema = type({
    basePlantLevel: 'number',
    customerQualityMaxEffect: 'number',
    monetaryValueVariesByQuality: 'boolean',
    tiers: type({
        label: 'string',
        minimumLevelExclusive: 'number | null',
        customerScalar: 'number',
    }).array(),
});

const PublicDryingRulesSchema = type({
    requiresUnpackagedProduct: 'boolean',
    acceptedDrugTypes: 'string[]',
    specialQualityItemKeys: PublicKeySchema.array(),
    specialItemRequiresQuality: 'boolean',
    maximumQualityTier: 'string',
    preservesItem: 'boolean',
    preservesQuantity: 'boolean',
    qualityTierIncrement: 'number',
});

const PublicPackagingRulesSchema = type({
    requiresUnpackagedProduct: 'boolean',
    packagingMaterialQuantityPerOperation: 'number',
    packagedItemQuantityPerOperation: 'number',
    productQuantitySource: "'packaging-definition'",
    preservesItem: 'boolean',
    outputState: "'packaged'",
    insufficientProductRemainder: "'left-unpackaged'",
    employeeTiming: {
        baseSeconds: 'number',
        usesEmployeePackagingSpeed: 'boolean',
        usesStationSpeed: 'boolean',
        usesEmployeeCurrentWorkSpeed: 'boolean',
        completionOverheadSeconds: 'number',
    },
    manualTiming: "'interactive'",
});

const PublicBrickPressingRulesSchema = type({
    requiresUnpackagedProduct: 'boolean',
    consumesSeparatePackagingMaterial: 'boolean',
    packagedItemQuantityPerOperation: 'number',
    productQuantitySource: "'station-packaging-quantity'",
    preservesItem: 'boolean',
    outputState: "'packaged'",
    insufficientProductRemainder: "'left-unpackaged'",
    employeeTiming: {
        baseSeconds: 'number',
        usesEmployeePackagingSpeed: 'boolean',
        usesStationSpeed: 'boolean',
        usesEmployeeCurrentWorkSpeed: 'boolean',
        completionOverheadSeconds: 'number',
    },
    manualTiming: "'interactive'",
});

const PublicSeedProductionSchema = type({
    seedItemKey: PublicKeySchema,
    soilItemKeys: PublicKeySchema.array(),
    growthTimeMinutes: 'number',
    baseYieldQuantity: 'number',
    harvestTarget: "'buds' | 'leaves'",
    harvestProducts: type({ itemKey: PublicKeySchema, quantity: 'number' }).array(),
});

const PublicShroomProductionSchema = type({
    spawnItemKey: PublicKeySchema,
    soilItemKeys: PublicKeySchema.array(),
    productItemKey: PublicKeySchema,
    equipmentItemKeys: PublicKeySchema.array(),
    growTimeMinutes: 'number',
    baseYieldQuantity: 'number',
    maximumTemperatureForGrowth: 'number',
    minimumSoilMoistureForGrowth: 'number',
});

const PublicStationRecipeSchema = type({
    key: PublicKeySchema,
    slug: SlugSchema,
    label: 'string',
    cookTimeMinutes: 'number',
    cookTemperature: 'number',
    cookTemperatureTolerance: 'number',
    qualityCalculation: "'additive'",
    equipmentItemKeys: PublicKeySchema.array(),
    ingredients: type({ quantity: 'number', acceptedItemKeys: PublicKeySchema.array() }).array(),
    outputItemKey: PublicKeySchema,
    outputQuantity: 'number',
});

const PublicOvenTransformSchema = type({
    inputItemKey: PublicKeySchema,
    cookType: "'solid' | 'liquid'",
    cookTimeMinutes: 'number',
    outputItemKey: PublicKeySchema,
    outputQuantity: 'number',
});

const PublicGrowContainerStationSchema = type({
    itemKey: PublicKeySchema,
    kind: "'grow-container'",
    yieldMultiplier: 'number',
    growSpeedMultiplier: 'number',
    requiresExternalGrowLight: 'boolean',
    maxTemperatureGrowthMultiplier: 'number',
    minimumTemperatureThreshold: 'number',
    maximumTemperatureThreshold: 'number',
    allowedSoilItemKeys: PublicKeySchema.array(),
    allowedAdditiveItemKeys: PublicKeySchema.array(),
});

const PublicGrowLightStationSchema = type({
    itemKey: PublicKeySchema,
    kind: "'grow-light'",
    growSpeedMultiplier: 'number',
});

const PublicSprinklerStationSchema = type({
    itemKey: PublicKeySchema,
    kind: "'sprinkler'",
    applyDelay: 'number',
    particleStopDelay: 'number | null',
    cooldown: 'number',
    minimumTargetCount: 'number',
    targetTiles: TileCoordinateSchema.array().or('null'),
});

const PublicBrickPressStationSchema = type({
    itemKey: PublicKeySchema,
    kind: "'brick-press'",
    packagingItemKey: PublicKeySchema,
    packagingQuantity: 'number',
});

const PublicCauldronStationSchema = type({
    itemKey: PublicKeySchema,
    kind: "'cauldron'",
    cookTimeMinutes: 'number',
    primaryInputItemKey: PublicKeySchema,
    primaryInputQuantity: 'number',
    secondaryInputItemKey: PublicKeySchema,
    secondaryInputQuantity: 'number',
    outputItemKey: PublicKeySchema,
    outputQuantity: 'number',
});

const PublicDryingRackStationSchema = type({
    itemKey: PublicKeySchema,
    kind: "'drying-rack'",
    capacity: 'number',
    maxProcessMultiplier: 'number',
    processMinutesPerTier: 'number',
    minimumTemperatureThreshold: 'number',
    maximumTemperatureThreshold: 'number',
});

const PublicLabOvenStationSchema = type({
    itemKey: PublicKeySchema,
    kind: "'lab-oven'",
});

const PublicMixingStationSchema = type({
    itemKey: PublicKeySchema,
    kind: "'mixing' | 'mixing-mk2'",
    capacity: 'number',
    timePerItem: 'number',
    requiresManualIngredientInsertion: 'boolean',
});

const PublicMushroomSpawnStationSchema = type({
    itemKey: PublicKeySchema,
    kind: "'mushroom-spawn'",
    grainBagItemKey: PublicKeySchema,
    grainBagQuantity: 'number',
    workTimeMinutes: 'number',
    sporeSyringes: type({
        syringeItemKey: PublicKeySchema,
        syringeQuantity: 'number',
        outputSpawnItemKey: PublicKeySchema,
        outputSpawnQuantity: 'number',
    }).array(),
});

const PublicPackagingStationSchema = type({
    itemKey: PublicKeySchema,
    kind: "'packaging' | 'packaging-mk2'",
    employeeSpeedMultiplier: 'number',
});

export const PublicProductionStationSchema = PublicGrowContainerStationSchema
    .or(PublicGrowLightStationSchema)
    .or(PublicSprinklerStationSchema)
    .or(PublicBrickPressStationSchema)
    .or(PublicCauldronStationSchema)
    .or(PublicDryingRackStationSchema)
    .or(PublicLabOvenStationSchema)
    .or(PublicMixingStationSchema)
    .or(PublicMushroomSpawnStationSchema)
    .or(PublicPackagingStationSchema);
export type PublicProductionStation = typeof PublicProductionStationSchema.infer;

export const PublicProductionCatalogSchema = type({
    quality: PublicProductionQualitySchema,
    drying: PublicDryingRulesSchema,
    packaging: PublicPackagingRulesSchema,
    brickPressing: PublicBrickPressingRulesSchema,
    seeds: PublicSeedProductionSchema.array(),
    shrooms: PublicShroomProductionSchema.array(),
    stationRecipes: PublicStationRecipeSchema.array(),
    ovenTransforms: PublicOvenTransformSchema.array(),
    stations: PublicProductionStationSchema.array(),
});
export type PublicProductionCatalog = typeof PublicProductionCatalogSchema.infer;

const PublicLogisticsTaskSchema = type({ key: PublicKeySchema, label: 'string' });
const PublicMovementLegSchema = type({ key: PublicKeySchema, label: 'string' });

const PublicEmployeeRoleSchema = type({
    key: SlugSchema,
    label: 'string',
    dailyWage: 'number',
    baseWorkSpeed: 'number',
    walkSpeed: 'number | null',
    inventorySlotCount: 'number',
    assignmentKind: "'pots' | 'stations' | 'bins'",
    assignmentLimit: 'number',
    configuredRouteLimit: 'number | null',
    movementKinds:
        "('station-task' | 'station-supply' | 'configured-route' | 'trash-collection')[]",
});

const PublicSlotFilterSchema = type({
    kind:
        "'unpackaged-product' | 'item-list' | 'dryable-product' | 'mixing-ingredient' | 'item-category' | 'packaged-product'",
    mode: "'required' | 'whitelist' | 'blacklist'",
    itemKeys: PublicKeySchema.array(),
    categories: 'string[]',
});

const PublicLogisticsSlotSchema = type({
    index: 'number',
    filters: PublicSlotFilterSchema.array(),
});

const PublicLogisticsStationSchema = type({
    itemKey: PublicKeySchema,
    kind:
        "'grow-container' | 'brick-press' | 'cauldron' | 'drying-rack' | 'lab-oven' | 'mixing' | 'mixing-mk2' | 'mushroom-spawn' | 'packaging' | 'packaging-mk2'",
    inputSlots: PublicLogisticsSlotSchema.array(),
    outputSlots: PublicLogisticsSlotSchema.array(),
});

const PublicCleanerRulesSchema = type({
    assignedBinSelection: "'nearest-current-position'",
    trashBagSelection: "'first-stored'",
    looseTrashSelection: "'first-reachable-stored'",
    trashGrabberCapacity: 'number',
    looseTrashReachabilityDistance: 'number',
    nonFullBinThreshold: 'number',
    baggingThreshold: 'number',
    disposalDestination: "'assigned-property-disposal-area'",
    binAccessPointSelection: "'reachable-by-employee'",
    actionMaximumDistance: 'number',
    dynamicTrashState: "'not-published'",
});

const PublicMovementGroupSchema = type({
    taskKeys: PublicKeySchema.array(),
    legKeys: PublicKeySchema.array(),
});

const PublicEmployeeMovementSchema = type({
    taskOrigin: "'current-employee-position'",
    completionPosition: "'task-endpoint'",
    taskChaining: "'sequential-from-previous-endpoint'",
    growContainerItemSource: "'employee-inventory-then-assigned-supplies'",
    growContainer: PublicMovementGroupSchema,
    station: PublicMovementGroupSchema,
    moveItem: PublicMovementGroupSchema,
    legFrequency: "'once-per-task-when-movement-is-required'",
});

const PublicEmployeeSchedulingSchema = type({
    authority: "'authoritative-game-state'",
    prerequisite: "'available-and-idle'",
    taskSelection: "'first-ready-in-listed-order'",
    taskReadiness: "'live-state-not-published'",
    workAvailability: {
        employeeHomeRequired: 'boolean',
        dailyPaymentRequired: 'boolean',
        automaticPaymentSource: "'employee-home-cash'",
        noFixedShift: 'boolean',
        endOfDayTime: 'number',
        consumingProductBlocksWork: 'boolean',
    },
    movement: PublicEmployeeMovementSchema,
    botanistTaskPriority: PublicKeySchema.array(),
    chemistTaskPriority: PublicKeySchema.array(),
    cleanerTaskPriority: PublicKeySchema.array(),
    cleanerRules: PublicCleanerRulesSchema,
});

export const PublicProductionLogisticsSchema = type({
    taskCatalog: PublicLogisticsTaskSchema.array(),
    movementLegCatalog: PublicMovementLegSchema.array(),
    routeRules: {
        filterModes: "('whitelist' | 'blacklist')[]",
        selection: "'first-ready-in-stored-order'",
        movedQuantityLimits:
            "('available-at-source' | 'requested-maximum' | 'destination-input-capacity')[]",
        accessPointSelection: "'reachable-by-employee'",
    },
    handlerTaskPriority: PublicKeySchema.array(),
    employeeScheduling: PublicEmployeeSchedulingSchema,
    employeeRoles: PublicEmployeeRoleSchema.array(),
    stations: PublicLogisticsStationSchema.array(),
});
export type PublicProductionLogistics = typeof PublicProductionLogisticsSchema.infer;

export const PublicProductionBundleSchema = type({
    catalog: PublicProductionCatalogSchema,
    logistics: PublicProductionLogisticsSchema,
});
export type PublicProductionBundle = typeof PublicProductionBundleSchema.infer;
