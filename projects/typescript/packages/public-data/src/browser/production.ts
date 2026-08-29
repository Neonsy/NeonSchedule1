import type {
    ProductionCatalog,
    ProductionLogisticsCatalog,
    ProductionLogisticsSlotFilter,
    ProductionStation,
} from '@neonschedule1/core';

import {
    createPublicKeyResolver,
    requireUnique,
} from '#public-data/browser/public-key';
import {
    PublicProductionBundleSchema,
    type PublicProductionBundle,
    type PublicProductionStation,
} from '#public-data/browser/production-schema';

type ItemKeyResolver = (sourceKey: string) => string;

export function compilePublicProductionBundle(
    production: ProductionCatalog,
    logistics: ProductionLogisticsCatalog,
    itemKey: ItemKeyResolver
): PublicProductionBundle {
    requireUnique(
        production.stations.map((station) => station.itemId),
        'production station item keys'
    );
    requireUnique(production.seeds.map((seed) => seed.seedItemId), 'production seed item keys');
    requireUnique(
        production.shrooms.map((shroom) => shroom.spawnItemId),
        'shroom spawn item keys'
    );
    requireUnique(
        logistics.stations.map((station) => station.itemId),
        'logistics station item keys'
    );
    requireSameSet(
        'employee role mappings',
        logistics.employeeRoles.map((role) => role.employeeType),
        Object.keys(employeeRoleForms)
    );
    requireUnique(Object.values(taskLabels), 'logistics task labels');
    requireUnique(Object.values(movementLegLabels), 'movement leg labels');
    const stations = production.stations.map((station) => compileStation(station, itemKey));
    const productionStationByItem = new Map(
        production.stations.map((station) => [station.itemId, station.kind])
    );

    const recipeKey = createPublicKeyResolver(
        'recipe',
        production.stationRecipes.map((recipe) => recipe.id)
    );
    const sourceTasks = [
        ...logistics.handlerTaskPriority,
        ...(logistics.employeeScheduling?.botanistTaskPriority ?? []),
        ...(logistics.employeeScheduling?.chemistTaskPriority ?? []),
        ...(logistics.employeeScheduling?.cleanerTaskPriority ?? []),
        ...(logistics.employeeScheduling?.movement?.growContainerTaskKinds ?? []),
        ...(logistics.employeeScheduling?.movement?.stationTaskKinds ?? []),
        ...(logistics.employeeScheduling?.movement?.moveItemTaskKinds ?? []),
    ];
    const uniqueSourceTasks = [...new Set(sourceTasks)].sort();
    requireSameSet('logistics task mappings', uniqueSourceTasks, Object.keys(taskLabels));
    const taskKey = createPublicKeyResolver('task', uniqueSourceTasks);

    const scheduling = requireScheduling(logistics);
    const movement = requireMovement(scheduling);
    const sourceLegs = [
        ...movement.growContainerTaskLegs,
        ...movement.stationTaskLegs,
        ...movement.moveItemTaskLegs,
    ];
    const uniqueSourceLegs = [...new Set(sourceLegs)].sort();
    requireSameSet('movement leg mappings', uniqueSourceLegs, Object.keys(movementLegLabels));
    const legKey = createPublicKeyResolver('leg', uniqueSourceLegs);

    const stationRecipes = production.stationRecipes.map((recipe) => ({
        key: recipeKey(recipe.id),
        slug: slugify(recipe.title),
        label: requirePublicText(recipe.title, `${recipe.id} recipe title`),
        cookTimeMinutes: recipe.cookTimeMinutes,
        cookTemperature: recipe.cookTemperature,
        cookTemperatureTolerance: recipe.cookTemperatureTolerance,
        qualityCalculation: qualityCalculation(recipe.qualityCalculationMethod),
        equipmentItemKeys: recipe.acceptedEquipmentItemIds.map(itemKey),
        ingredients: recipe.ingredients.map((ingredient) => ({
            quantity: ingredient.quantity,
            acceptedItemKeys: ingredient.acceptedItemIds.map(itemKey),
        })),
        outputItemKey: itemKey(recipe.outputItemId),
        outputQuantity: recipe.outputQuantity,
    }));
    requireUnique(stationRecipes.map((recipe) => recipe.slug), 'station recipe slugs');

    for (const station of logistics.stations) {
        const productionKind = productionStationByItem.get(station.itemId);
        if (productionKind === undefined || productionKind !== station.kind) {
            throw new Error(
                `Logistics station ${station.itemId} does not match a production station`
            );
        }
        requireUnique(
            station.inputSlots.map((slot) => String(slot.index)),
            `${station.itemId} logistics input slot indexes`
        );
        requireUnique(
            station.outputSlots.map((slot) => String(slot.index)),
            `${station.itemId} logistics output slot indexes`
        );
    }

    const result = {
        catalog: {
            quality: {
                basePlantLevel: production.quality.basePlantLevel,
                customerQualityMaxEffect: production.quality.customerQualityMaxEffect,
                monetaryValueVariesByQuality: production.quality.monetaryValueVariesByQuality,
                tiers: production.quality.tiers.map((tier) => ({
                    label: tier.name,
                    minimumLevelExclusive: tier.minimumLevelExclusive,
                    customerScalar: tier.customerScalar,
                })),
            },
            drying: compileDryingRules(production, itemKey),
            packaging: {
                requiresUnpackagedProduct: production.packaging.requiresUnpackagedProduct,
                packagingMaterialQuantityPerOperation:
                    production.packaging.packagingMaterialQuantityPerOperation,
                packagedItemQuantityPerOperation:
                    production.packaging.packagedItemQuantityPerOperation,
                productQuantitySource: 'packaging-definition' as const,
                preservesItem: production.packaging.itemIdTransformation === 'preserved',
                outputState: 'packaged' as const,
                insufficientProductRemainder:
                    production.packaging.insufficientProductRemainder,
                employeeTiming: {
                    baseSeconds: production.packaging.employeeBaseSecondsPerOperation,
                    usesEmployeePackagingSpeed: true,
                    usesStationSpeed: true,
                    usesEmployeeCurrentWorkSpeed: true,
                    completionOverheadSeconds: 0,
                },
                manualTiming: 'interactive' as const,
            },
            brickPressing: {
                requiresUnpackagedProduct: production.brickPressing.requiresUnpackagedProduct,
                consumesSeparatePackagingMaterial:
                    production.brickPressing.packagingMaterialConsumption !== 'none',
                packagedItemQuantityPerOperation:
                    production.brickPressing.packagedItemQuantityPerOperation,
                productQuantitySource: production.brickPressing.productQuantitySource,
                preservesItem: production.brickPressing.itemIdTransformation === 'preserved',
                outputState: 'packaged' as const,
                insufficientProductRemainder:
                    production.brickPressing.insufficientProductRemainder,
                employeeTiming: {
                    baseSeconds: production.brickPressing.employeeBaseSecondsPerOperation,
                    usesEmployeePackagingSpeed: true,
                    usesStationSpeed: false,
                    usesEmployeeCurrentWorkSpeed: true,
                    completionOverheadSeconds:
                        production.brickPressing.employeeCompletionOverheadSecondsPerOperation,
                },
                manualTiming: 'interactive' as const,
            },
            seeds: production.seeds.map((seed) => ({
                seedItemKey: itemKey(seed.seedItemId),
                soilItemKeys: seed.soilItemIds.map(itemKey),
                growthTimeMinutes: seed.growthTimeMinutes,
                baseYieldQuantity: seed.baseYieldQuantity,
                harvestTarget: harvestTarget(seed.harvestTarget),
                harvestProducts: seed.harvestProducts.map((product) => ({
                    itemKey: itemKey(product.itemId),
                    quantity: product.quantity,
                })),
            })),
            shrooms: production.shrooms.map((shroom) => ({
                spawnItemKey: itemKey(shroom.spawnItemId),
                soilItemKeys: shroom.soilItemIds.map(itemKey),
                productItemKey: itemKey(shroom.productItemId),
                equipmentItemKeys: shroom.acceptedEquipmentItemIds.map(itemKey),
                growTimeMinutes: shroom.growTimeMinutes,
                baseYieldQuantity: shroom.baseYieldQuantity,
                maximumTemperatureForGrowth: shroom.maximumTemperatureForGrowth,
                minimumSoilMoistureForGrowth: shroom.minimumSoilMoistureForGrowth,
            })),
            stationRecipes,
            ovenTransforms: production.ovenTransforms.map((transform) => ({
                inputItemKey: itemKey(transform.inputItemId),
                cookType: cookType(transform.cookType),
                cookTimeMinutes: transform.cookTimeMinutes,
                outputItemKey: itemKey(transform.outputItemId),
                outputQuantity: transform.outputQuantity,
            })),
            stations,
        },
        logistics: {
            taskCatalog: uniqueSourceTasks
                .map((sourceKey) => ({ key: taskKey(sourceKey), label: taskLabels[sourceKey]! }))
                .sort((left, right) => left.label.localeCompare(right.label)),
            movementLegCatalog: uniqueSourceLegs
                .map((sourceKey) => ({
                    key: legKey(sourceKey),
                    label: movementLegLabels[sourceKey]!,
                }))
                .sort((left, right) => left.label.localeCompare(right.label)),
            routeRules: compileRouteRules(logistics),
            handlerTaskPriority: logistics.handlerTaskPriority.map(taskKey),
            employeeScheduling: compileScheduling(scheduling, movement, taskKey, legKey),
            employeeRoles: logistics.employeeRoles
                .map(compileEmployeeRole)
                .sort((left, right) => left.label.localeCompare(right.label)),
            stations: logistics.stations
                .map((station) => ({
                    itemKey: itemKey(station.itemId),
                    kind: logisticsStationKind(station.kind),
                    inputSlots: station.inputSlots.map((slot) => ({
                        index: slot.index,
                        filters: slot.filters.map((filter) => compileSlotFilter(filter, itemKey)),
                    })),
                    outputSlots: station.outputSlots.map((slot) => ({
                        index: slot.index,
                        filters: slot.filters.map((filter) => compileSlotFilter(filter, itemKey)),
                    })),
                }))
                .sort((left, right) => left.itemKey.localeCompare(right.itemKey)),
        },
    };
    return PublicProductionBundleSchema.assert(result);
}

function compileDryingRules(
    production: ProductionCatalog,
    itemKey: ItemKeyResolver
): PublicProductionBundle['catalog']['drying'] {
    const sourceSubstring = production.drying.specialQualityItemIdSubstring;
    if (sourceSubstring !== 'cocaleaf') {
        throw new Error(`Missing special drying item mapping for ${sourceSubstring}`);
    }
    return {
        requiresUnpackagedProduct: production.drying.requiresUnpackagedProduct,
        acceptedDrugTypes: production.drying.acceptedProductDrugTypes,
        specialQualityItemKeys: [itemKey('cocaleaf')],
        specialItemRequiresQuality: production.drying.specialItemRequiresQualityInstance,
        maximumQualityTier: production.drying.maximumQualityTier,
        preservesItem: production.drying.itemIdTransformation === 'preserved',
        preservesQuantity: production.drying.quantityTransformation === 'preserved',
        qualityTierIncrement: production.drying.qualityTierIncrement,
    };
}

function compileStation(
    station: ProductionStation,
    itemKey: ItemKeyResolver
): PublicProductionStation {
    const base = { itemKey: itemKey(station.itemId) };
    switch (station.kind) {
        case 'grow-container': return {
            ...base,
            kind: station.kind,
            yieldMultiplier: station.yieldMultiplier,
            growSpeedMultiplier: station.growSpeedMultiplier,
            requiresExternalGrowLight: station.requiresExternalGrowLight,
            maxTemperatureGrowthMultiplier: station.maxTemperatureGrowthMultiplier,
            minimumTemperatureThreshold: station.minimumTemperatureThreshold,
            maximumTemperatureThreshold: station.maximumTemperatureThreshold,
            allowedSoilItemKeys: station.allowedSoilIds.map(itemKey),
            allowedAdditiveItemKeys: station.allowedAdditiveIds.map(itemKey),
        };
        case 'grow-light': return {
            ...base,
            kind: station.kind,
            growSpeedMultiplier: station.growSpeedMultiplier,
        };
        case 'sprinkler': return {
            ...base,
            kind: station.kind,
            applyDelay: station.applyDelay,
            particleStopDelay: station.particleStopDelay,
            cooldown: station.cooldown,
            minimumTargetCount: station.minimumTargetCount,
            targetTiles: station.targetTileCoordinates,
        };
        case 'brick-press': return {
            ...base,
            kind: station.kind,
            packagingItemKey: itemKey(station.packagingItemId),
            packagingQuantity: station.packagingQuantity,
        };
        case 'cauldron': return {
            ...base,
            kind: station.kind,
            cookTimeMinutes: station.cookTimeMinutes,
            primaryInputItemKey: itemKey(station.primaryInputItemId),
            primaryInputQuantity: station.requiredPrimaryInputQuantity,
            secondaryInputItemKey: itemKey(station.secondaryInputItemId),
            secondaryInputQuantity: station.secondaryInputQuantity,
            outputItemKey: itemKey(station.outputItemId),
            outputQuantity: station.outputQuantity,
        };
        case 'drying-rack': return {
            ...base,
            kind: station.kind,
            capacity: station.capacity,
            maxProcessMultiplier: station.maxProcessMultiplier,
            processMinutesPerTier: station.processMinutesPerTier,
            minimumTemperatureThreshold: station.minimumTemperatureThreshold,
            maximumTemperatureThreshold: station.maximumTemperatureThreshold,
        };
        case 'lab-oven': return { ...base, kind: station.kind };
        case 'mixing':
        case 'mixing-mk2': return {
            ...base,
            kind: station.kind,
            capacity: station.capacity,
            timePerItem: station.timePerItem,
            requiresManualIngredientInsertion: station.requiresManualIngredientInsertion,
        };
        case 'mushroom-spawn': return {
            ...base,
            kind: station.kind,
            grainBagItemKey: itemKey(station.grainBagItemId),
            grainBagQuantity: station.grainBagQuantity,
            workTimeMinutes: station.workTimeMinutes,
            sporeSyringes: station.sporeSyringes.map((syringe) => ({
                syringeItemKey: itemKey(syringe.syringeItemId),
                syringeQuantity: syringe.syringeQuantity,
                outputSpawnItemKey: itemKey(syringe.outputSpawnItemId),
                outputSpawnQuantity: syringe.outputSpawnQuantity,
            })),
        };
        case 'packaging':
        case 'packaging-mk2': return {
            ...base,
            kind: station.kind,
            employeeSpeedMultiplier: station.employeeSpeedMultiplier,
        };
        default: return assertNever(station);
    }
}

function compileRouteRules(
    logistics: ProductionLogisticsCatalog
): PublicProductionBundle['logistics']['routeRules'] {
    requireSameSet('route filter modes', logistics.routeRules.filterModes, [
        'whitelist',
        'blacklist',
    ]);
    requireEqual(logistics.routeRules.selection, 'stored-order-first-ready', 'route selection');
    requireEqual(
        logistics.routeRules.accessPointSelection,
        'npc-reachable',
        'route access point selection'
    );
    const quantityLimitMappings: Readonly<Record<string,
        'available-at-source' | 'requested-maximum' | 'destination-input-capacity'>> = {
        'source-quantity': 'available-at-source',
        'requested-maximum': 'requested-maximum',
        'destination-input-capacity': 'destination-input-capacity',
    };
    requireSameSet(
        'route quantity limits',
        logistics.routeRules.movedQuantityLimits,
        Object.keys(quantityLimitMappings)
    );
    return {
        filterModes: ['whitelist', 'blacklist'],
        selection: 'first-ready-in-stored-order',
        movedQuantityLimits: logistics.routeRules.movedQuantityLimits.map((limit) =>
            quantityLimitMappings[limit]!
        ),
        accessPointSelection: 'reachable-by-employee',
    };
}

function compileEmployeeRole(role: ProductionLogisticsCatalog['employeeRoles'][number]) {
    const form = employeeRoleForms[role.employeeType];
    if (form.runtimeType !== role.runtimeType) {
        throw new Error(`Employee runtime type changed for ${role.employeeType}`);
    }
    return {
        key: form.key,
        label: form.label,
        dailyWage: role.dailyWage,
        baseWorkSpeed: role.baseWorkSpeed,
        walkSpeed: role.walkSpeed ?? null,
        inventorySlotCount: role.inventorySlotCount,
        assignmentKind: role.assignmentKind,
        assignmentLimit: role.assignmentLimit,
        configuredRouteLimit: role.configuredRouteLimit,
        movementKinds: role.movementKinds.map(publicMovementKind),
    };
}

function compileSlotFilter(
    filter: ProductionLogisticsSlotFilter,
    itemKey: ItemKeyResolver
) {
    requireUnique(filter.itemIds, `${filter.nativeType} logistics filter item keys`);
    requireUnique(filter.categories, `${filter.nativeType} logistics filter categories`);
    const emptyItems = filter.itemIds.length === 0;
    const emptyCategories = filter.categories.length === 0;
    switch (filter.nativeType) {
        case 'ScheduleOne.ItemFramework.ItemFilter_ID':
            if (filter.isWhitelist === null || emptyItems || !emptyCategories) {
                throw new Error('Item-list logistics filter has inconsistent fields');
            }
            return {
                kind: 'item-list' as const,
                mode: filter.isWhitelist ? 'whitelist' as const : 'blacklist' as const,
                itemKeys: filter.itemIds.map(itemKey),
                categories: [],
            };
        case 'ScheduleOne.ItemFramework.ItemFilter_Category':
            if (filter.isWhitelist !== null || !emptyItems || emptyCategories) {
                throw new Error('Item-category logistics filter has inconsistent fields');
            }
            return {
                kind: 'item-category' as const,
                mode: 'required' as const,
                itemKeys: [],
                categories: filter.categories,
            };
        case 'ScheduleOne.ItemFramework.ItemFilter_UnpackagedProduct':
            return semanticFilter('unpackaged-product', filter);
        case 'ScheduleOne.ItemFramework.ItemFilter_Dryable':
            return semanticFilter('dryable-product', filter);
        case 'ScheduleOne.ItemFramework.ItemFilter_MixingIngredient':
            return semanticFilter('mixing-ingredient', filter);
        case 'ScheduleOne.ItemFramework.ItemFilter_PackagedProduct':
            return semanticFilter('packaged-product', filter);
        default: throw new Error(`Missing public logistics filter mapping for ${filter.nativeType}`);
    }
}

function semanticFilter(
    kind: 'unpackaged-product' | 'dryable-product' | 'mixing-ingredient' | 'packaged-product',
    filter: ProductionLogisticsSlotFilter
) {
    if (
        filter.isWhitelist !== null ||
        filter.itemIds.length !== 0 ||
        filter.categories.length !== 0
    ) {
        throw new Error(`${kind} logistics filter has inconsistent fields`);
    }
    return { kind, mode: 'required' as const, itemKeys: [], categories: [] };
}

function compileScheduling(
    scheduling: NonNullable<ProductionLogisticsCatalog['employeeScheduling']>,
    movement: NonNullable<NonNullable<
        ProductionLogisticsCatalog['employeeScheduling']
    >['movement']>,
    taskKey: (sourceKey: string) => string,
    legKey: (sourceKey: string) => string
) {
    requireEqual(scheduling.dispatchAuthority, 'server', 'scheduling authority');
    requireEqual(
        scheduling.dispatchPrerequisite,
        'can-work-and-no-active-behaviour',
        'scheduling prerequisite'
    );
    requireEqual(
        scheduling.taskSelection,
        'first-ready-in-native-priority-order',
        'task selection'
    );
    requireEqual(
        scheduling.taskReadiness,
        'native-mutable-runtime-state-not-recorded',
        'task readiness'
    );
    const work = scheduling.workAvailability;
    requireEqual(work.employeeHome, 'required', 'employee home requirement');
    requireEqual(
        work.dailyPayment,
        'paid-for-today-required-auto-from-employee-home-cash',
        'daily payment rule'
    );
    requireEqual(work.shiftSchedule, 'no-fixed-shift', 'shift schedule');
    requireEqual(work.consumeProduct, 'blocks-work', 'consume product rule');
    requireEqual(movement.taskOrigin, 'current-npc-position', 'task origin');
    requireEqual(
        movement.completionPosition,
        'task-endpoint-until-subsequent-behaviour',
        'task completion position'
    );
    requireEqual(
        movement.taskChaining,
        'each-selected-task-starts-from-then-current-npc-position',
        'task chaining'
    );
    requireEqual(
        movement.growContainerItemSource,
        'employee-inventory-otherwise-assigned-supplies',
        'grow-container item source'
    );
    requireEqual(
        movement.legFrequency,
        'once-per-selected-task-activation-if-not-already-at-endpoint',
        'movement leg frequency'
    );
    const cleaner = scheduling.cleanerRules;
    requireEqual(
        cleaner.assignedBinSelection,
        'nearest-current-position-first',
        'assigned bin selection'
    );
    requireEqual(cleaner.trashBagSelection, 'first-in-bin-stored-order', 'trash bag selection');
    requireEqual(
        cleaner.looseTrashSelection,
        'first-npc-reachable-in-bin-stored-order',
        'loose trash selection'
    );
    requireEqual(
        cleaner.trashBagDisposalDestination,
        'assigned-property-disposal-area-required',
        'trash disposal destination'
    );
    requireEqual(
        cleaner.binAccessPointSelection,
        'npc-reachable',
        'bin access point selection'
    );
    requireEqual(cleaner.dynamicTrashState, 'not-recorded', 'dynamic trash state');
    return {
        authority: 'authoritative-game-state' as const,
        prerequisite: 'available-and-idle' as const,
        taskSelection: 'first-ready-in-listed-order' as const,
        taskReadiness: 'live-state-not-published' as const,
        workAvailability: {
            employeeHomeRequired: true,
            dailyPaymentRequired: true,
            automaticPaymentSource: 'employee-home-cash' as const,
            noFixedShift: true,
            endOfDayTime: work.endOfDayTime,
            consumingProductBlocksWork: true,
        },
        movement: {
            taskOrigin: 'current-employee-position' as const,
            completionPosition: 'task-endpoint' as const,
            taskChaining: 'sequential-from-previous-endpoint' as const,
            growContainerItemSource: 'employee-inventory-then-assigned-supplies' as const,
            growContainer: {
                taskKeys: movement.growContainerTaskKinds.map(taskKey),
                legKeys: movement.growContainerTaskLegs.map(legKey),
            },
            station: {
                taskKeys: movement.stationTaskKinds.map(taskKey),
                legKeys: movement.stationTaskLegs.map(legKey),
            },
            moveItem: {
                taskKeys: movement.moveItemTaskKinds.map(taskKey),
                legKeys: movement.moveItemTaskLegs.map(legKey),
            },
            legFrequency: 'once-per-task-when-movement-is-required' as const,
        },
        botanistTaskPriority: scheduling.botanistTaskPriority.map(taskKey),
        chemistTaskPriority: scheduling.chemistTaskPriority.map(taskKey),
        cleanerTaskPriority: scheduling.cleanerTaskPriority.map(taskKey),
        cleanerRules: {
            assignedBinSelection: 'nearest-current-position' as const,
            trashBagSelection: 'first-stored' as const,
            looseTrashSelection: 'first-reachable-stored' as const,
            trashGrabberCapacity: cleaner.trashGrabberCapacity,
            looseTrashReachabilityDistance: cleaner.looseTrashReachabilityDistance,
            nonFullBinThreshold: cleaner.nonFullBinThreshold,
            baggingThreshold: cleaner.baggingThreshold,
            disposalDestination: 'assigned-property-disposal-area' as const,
            binAccessPointSelection: 'reachable-by-employee' as const,
            actionMaximumDistance: cleaner.actionMaximumDistance,
            dynamicTrashState: 'not-published' as const,
        },
    };
}

function requireScheduling(
    logistics: ProductionLogisticsCatalog
): NonNullable<ProductionLogisticsCatalog['employeeScheduling']> {
    if (logistics.employeeScheduling === null || logistics.employeeScheduling === undefined) {
        throw new Error('Production logistics employee scheduling is not available');
    }
    return logistics.employeeScheduling;
}

function requireMovement(
    scheduling: NonNullable<ProductionLogisticsCatalog['employeeScheduling']>
): NonNullable<NonNullable<ProductionLogisticsCatalog['employeeScheduling']>['movement']> {
    if (scheduling.movement === null || scheduling.movement === undefined) {
        throw new Error('Production logistics movement evidence is not available');
    }
    return scheduling.movement;
}

function publicMovementKind(sourceKind: string) {
    switch (sourceKind) {
        case 'station-specific': return 'station-task' as const;
        case 'assigned-station-supply': return 'station-supply' as const;
        case 'configured-route': return 'configured-route' as const;
        case 'trash-collection': return 'trash-collection' as const;
        default: throw new Error(`Missing public employee movement mapping for ${sourceKind}`);
    }
}

function logisticsStationKind(sourceKind: string) {
    switch (sourceKind) {
        case 'grow-container':
        case 'brick-press':
        case 'cauldron':
        case 'drying-rack':
        case 'lab-oven':
        case 'mixing':
        case 'mixing-mk2':
        case 'mushroom-spawn':
        case 'packaging':
        case 'packaging-mk2': return sourceKind;
        default: throw new Error(`Missing public logistics station mapping for ${sourceKind}`);
    }
}

function harvestTarget(sourceTarget: string): 'buds' | 'leaves' {
    if (sourceTarget === 'buds' || sourceTarget === 'leaves') return sourceTarget;
    throw new Error(`Missing public harvest target mapping for ${sourceTarget}`);
}

function qualityCalculation(sourceMethod: string): 'additive' {
    if (sourceMethod === 'Additive') return 'additive';
    throw new Error(`Missing public quality calculation mapping for ${sourceMethod}`);
}

function cookType(sourceType: string): 'solid' | 'liquid' {
    if (sourceType === 'Solid') return 'solid';
    if (sourceType === 'Liquid') return 'liquid';
    throw new Error(`Missing public oven cook type mapping for ${sourceType}`);
}

function slugify(label: string): string {
    const slug = label
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, '-')
        .replace(/^-|-$/gu, '');
    if (slug.length === 0) throw new Error(`Cannot create a public slug for ${label}`);
    return slug;
}

function requirePublicText(value: string, label: string): string {
    const result = value.trim();
    if (result.length === 0) throw new Error(`${label} has no approved public text`);
    return result;
}

function requireSameSet(
    label: string,
    actual: readonly string[],
    expected: readonly string[]
): void {
    const actualValues = [...new Set(actual)].sort();
    const expectedValues = [...new Set(expected)].sort();
    if (
        actualValues.length !== actual.length ||
        expectedValues.length !== expected.length ||
        actualValues.length !== expectedValues.length ||
        actualValues.some((value, index) => value !== expectedValues[index])
    ) {
        throw new Error(`${label} do not match the approved set`);
    }
}

function requireEqual(actual: string, expected: string, label: string): void {
    if (actual !== expected) throw new Error(`${label} changed from ${expected} to ${actual}`);
}

function assertNever(value: never): never {
    throw new Error(`Unhandled production station: ${JSON.stringify(value)}`);
}

const employeeRoleForms = {
    Botanist: {
        key: 'botanist',
        label: 'Botanist',
        runtimeType: 'ScheduleOne.Employees.Botanist',
    },
    Chemist: {
        key: 'chemist',
        label: 'Chemist',
        runtimeType: 'ScheduleOne.Employees.Chemist',
    },
    Cleaner: {
        key: 'cleaner',
        label: 'Cleaner',
        runtimeType: 'ScheduleOne.Employees.Cleaner',
    },
    Handler: {
        key: 'handler',
        label: 'Handler',
        runtimeType: 'ScheduleOne.Employees.Packager',
    },
} as const;

const taskLabels: Readonly<Record<string, string>> = {
    'packaging-station-work': 'Run packaging station',
    'brick-press-work': 'Run brick press',
    'packaging-station-supply-move': 'Supply packaging station',
    'brick-press-supply-move': 'Supply brick press',
    'configured-transit-route': 'Run configured transit route',
    'grow-container-watering-below-0.2': 'Water grow container below 20% moisture',
    'mushroom-bed-misting-below-0.2': 'Mist mushroom bed below 20% moisture',
    'grow-container-additive': 'Apply grow additive',
    'grow-container-soil-pour': 'Add soil to grow container',
    'pot-sow-seed': 'Sow seed in pot',
    'mushroom-bed-apply-spawn': 'Apply mushroom spawn',
    'pot-harvest': 'Harvest pot',
    'mushroom-bed-harvest': 'Harvest mushroom bed',
    'drying-rack-stop': 'Stop drying rack',
    'drying-rack-output-move': 'Move drying rack output',
    'mushroom-spawn-station-work': 'Run mushroom spawn station',
    'mushroom-spawn-station-output-move': 'Move mushroom spawn station output',
    'grow-container-watering-below-0.3': 'Water grow container below 30% moisture',
    'mushroom-bed-misting-below-0.3': 'Mist mushroom bed below 30% moisture',
    'drying-rack-input-move': 'Supply drying rack',
    'lab-oven-finish': 'Finish lab oven cycle',
    'lab-oven-start': 'Start lab oven cycle',
    'chemistry-station-start': 'Start chemistry station',
    'cauldron-start': 'Start cauldron',
    'mixing-station-start': 'Start mixing station',
    'lab-oven-output-move': 'Move lab oven output',
    'chemistry-station-output-move': 'Move chemistry station output',
    'cauldron-output-move': 'Move cauldron output',
    'mixing-station-output-move': 'Move mixing station output',
    'dispose-nearby-trash-bag': 'Dispose nearby trash bag',
    'pick-up-reachable-loose-trash': 'Pick up reachable loose trash',
    'empty-full-trash-grabber': 'Empty full trash grabber',
    'bag-trash-can-at-or-above-threshold': 'Bag trash can at threshold',
};

const movementLegLabels: Readonly<Record<string, string>> = {
    'current-to-supplies-if-required-item-missing':
        'Current position to supplies when an item is missing',
    'supplies-to-grow-container-if-supplies-visited':
        'Supplies to grow container after collecting supplies',
    'current-to-grow-container-otherwise': 'Current position to grow container otherwise',
    'current-to-station-access-point': 'Current position to station access point',
    'current-to-source-access-point': 'Current position to source access point',
    'source-to-destination-access-point': 'Source to destination access point',
};
