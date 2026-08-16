import {
    BRICK_PRESS_OPERATION_RULES,
    PACKAGING_OPERATION_RULES,
    ProductionCatalogSchema,
    type HarvestProduct,
    type OvenTransform,
    type ProductionCatalog,
    type ProductionStation,
    type SeedProduction,
    type ShroomProduction,
    type StationRecipe,
    type StationRecipeIngredient,
} from '@neonschedule1/core';

import type { RawReport } from '#data-compiler/acquisition/types';
import { indexUnique, Integrity, requireReferences } from '#data-compiler/integrity';
import { normalizeProductionQuality } from '#data-compiler/normalize/quality';
import {
    booleanField,
    nullableNumberField,
    numberField,
    objectArray,
    stringArrayField,
    stringField,
    type JsonObject,
} from '#data-compiler/json';

// These literals come from the current game's production methods because the raw collector does
// not expose some quantities, manual work duration, or equipment associations.
const cauldronSecondaryInputQuantity = 1;
const cauldronOutputQuantity = 10;
const chemistryStationItemId = 'chemistrystation';
const mushroomBedItemId = 'mushroombed';
const growTentItemId = 'growtent';
const mushroomSpawnInputQuantity = 1;
const mushroomSpawnOutputQuantity = 1;
const mushroomSpawnWorkTimeMinutes = 6;
const minutesPerHour = 60;

// ItemFilter_Dryable accepts unpackaged, sub-Heavenly products for drug-type enum values other
// than None and Shrooms. Its separate quality-item branch accepts sub-Heavenly coca-leaf IDs.
// DryingOperation preserves item identity and quantity and advances one EQuality tier at a time.
const dryingAcceptedProductDrugTypes = ['Cocaine', 'Marijuana', 'Methamphetamine'];
const dryingSpecialQualityItemIdSubstring = 'cocaleaf';
const dryingMaximumQualityTier = 'Heavenly';

// PackagingStation.PackSingleInstance applies the selected PackagingDefinition to a one-item
// product copy, consumes one packaging item and PackagingDefinition.Quantity loose products, and
// leaves a smaller remainder in the product slot. PackagingStationBehaviour performs that generic
// operation after 5 / packager proficiency / station speed / current work speed real seconds.

export function normalizeProduction(
    report: RawReport,
    itemIds: ReadonlySet<string>,
    additiveItemIds: ReadonlySet<string>,
    integrity: Integrity
): ProductionCatalog {
    const seeds = indexUnique(report.seeds, 'itemId', 'report.seeds', integrity);
    const shroomSpawns = indexUnique(report.shroomSpawns, 'itemId', 'report.shroomSpawns', integrity);
    const recipes = indexUnique(report.recipes, 'id', 'report.recipes', integrity);
    const stations = indexUnique(
        report.productionStations,
        'itemId',
        'report.productionStations',
        integrity
    );
    const normalizedStations = [...stations.entries()]
        .map(([itemId, raw]) =>
            normalizeStation(itemId, raw, itemIds, additiveItemIds, integrity)
        )
        .filter((station): station is ProductionStation => station !== null)
        .sort((left, right) => left.itemId.localeCompare(right.itemId));
    const soils = productionSoils(report, normalizedStations, itemIds, integrity);
    const chemistryStationItemIds = requiredEquipment(
        chemistryStationItemId,
        report.recipes.length,
        itemIds,
        integrity
    );
    const mushroomBedItemIds = requiredEquipment(
        mushroomBedItemId,
        report.shroomSpawns.length,
        itemIds,
        integrity
    );

    const catalog: ProductionCatalog = {
        schema: 'neonschedule1-production-catalog-9',
        quality: normalizeProductionQuality(report, itemIds, integrity),
        drying: {
            schema: 'neonschedule1-drying-operation-rules-1',
            requiresUnpackagedProduct: true,
            acceptedProductDrugTypes: [...dryingAcceptedProductDrugTypes],
            specialQualityItemIdSubstring: dryingSpecialQualityItemIdSubstring,
            specialItemRequiresQualityInstance: true,
            maximumQualityTier: dryingMaximumQualityTier,
            itemIdTransformation: 'preserved',
            quantityTransformation: 'preserved',
            qualityTierIncrement: 1,
        },
        packaging: { ...PACKAGING_OPERATION_RULES },
        brickPressing: { ...BRICK_PRESS_OPERATION_RULES },
        seeds: [...seeds.entries()]
            .map(([itemId, raw]) => normalizeSeed(itemId, raw, soils.plant, itemIds, integrity))
            .sort((left, right) => left.seedItemId.localeCompare(right.seedItemId)),
        shrooms: [...shroomSpawns.entries()]
            .map(([itemId, raw]) =>
                normalizeShroom(
                    itemId,
                    raw,
                    soils.shroom,
                    mushroomBedItemIds,
                    itemIds,
                    integrity
                )
            )
            .sort((left, right) => left.spawnItemId.localeCompare(right.spawnItemId)),
        stationRecipes: [...recipes.entries()]
            .map(([id, raw]) =>
                normalizeRecipe(id, raw, chemistryStationItemIds, itemIds, integrity)
            )
            .sort((left, right) => left.id.localeCompare(right.id)),
        ovenTransforms: normalizeOvenTransforms(report.ovenTransforms, itemIds, integrity),
        stations: normalizedStations,
    };

    integrity.check(
        'every production station kind is supported',
        catalog.stations.length === stations.size,
        `Expected ${stations.size} production stations, normalized ${catalog.stations.length}`
    );
    return ProductionCatalogSchema.assert(catalog);
}

function productionSoils(
    report: RawReport,
    stations: readonly ProductionStation[],
    itemIds: ReadonlySet<string>,
    integrity: Integrity
): { readonly plant: readonly string[]; readonly shroom: readonly string[] } {
    const all = uniqueIds(
        report.soils.map((soil, index) => stringField(soil, 'itemId', `report.soils[${index}]`)),
        'report.soils',
        integrity
    );
    requireReferences(all, itemIds, 'soil', integrity);

    const plant = [
        ...new Set(
            stations
                .filter((station) => station.kind === 'grow-container')
                .flatMap((station) => station.allowedSoilIds)
        ),
    ].sort();
    requireReferences(plant, new Set(all), 'grow-container soil', integrity);

    // The current game has one dedicated soil definition that regular plant containers reject.
    // Treating that set difference as shroom soil keeps the normalized relationship explicit and
    // makes a future ambiguous export fail integrity validation instead of changing costs silently.
    const plantSet = new Set(plant);
    const shroom = all.filter((itemId) => !plantSet.has(itemId));
    integrity.check(
        'seed production has an accepted soil',
        report.seeds.length === 0 || plant.length > 0,
        'Seed production requires at least one soil accepted by a grow container'
    );
    integrity.check(
        'shroom production has one dedicated soil',
        report.shroomSpawns.length === 0 || shroom.length === 1,
        `Expected one shroom-only soil definition, found ${shroom.length}`
    );
    return { plant, shroom };
}

function normalizeSeed(
    seedItemId: string,
    raw: JsonObject,
    soilItemIds: readonly string[],
    itemIds: ReadonlySet<string>,
    integrity: Integrity
): SeedProduction {
    const path = `report.seeds[${JSON.stringify(seedItemId)}]`;
    requireItem(seedItemId, itemIds, `${path}.itemId`, integrity);
    const harvestProducts = objectArray(raw.harvestables, `${path}.harvestables`).map(
        (harvestable, index): HarvestProduct => {
            const harvestPath = `${path}.harvestables[${index}]`;
            const itemId = stringField(harvestable, 'productId', harvestPath);
            requireItem(itemId, itemIds, `${harvestPath}.productId`, integrity);
            return {
                itemId,
                quantity: positiveNumber(harvestable, 'quantity', harvestPath, integrity),
            };
        }
    );
    integrity.check(
        `${path} has at least one harvest product`,
        harvestProducts.length > 0,
        `${path}.harvestables must not be empty`
    );
    return {
        schema: 'neonschedule1-seed-production-3',
        seedItemId,
        soilItemIds: [...soilItemIds],
        plantRuntimeType: stringField(raw, 'plantRuntimeType', path),
        growthTimeMinutes: positiveNumber(raw, 'growthTime', path, integrity) * minutesPerHour,
        baseYieldQuantity: positiveNumber(raw, 'baseYieldQuantity', path, integrity),
        harvestTarget: stringField(raw, 'harvestTarget', path),
        harvestProducts,
    };
}

function normalizeShroom(
    spawnItemId: string,
    raw: JsonObject,
    soilItemIds: readonly string[],
    acceptedEquipmentItemIds: readonly string[],
    itemIds: ReadonlySet<string>,
    integrity: Integrity
): ShroomProduction {
    const path = `report.shroomSpawns[${JSON.stringify(spawnItemId)}]`;
    const productItemId = stringField(raw, 'productId', path);
    requireItem(spawnItemId, itemIds, `${path}.itemId`, integrity);
    requireItem(productItemId, itemIds, `${path}.productId`, integrity);
    return {
        schema: 'neonschedule1-shroom-production-3',
        spawnItemId,
        soilItemIds: [...soilItemIds],
        productItemId,
        acceptedEquipmentItemIds: [...acceptedEquipmentItemIds],
        growTimeMinutes: positiveNumber(raw, 'growTime', path, integrity) * minutesPerHour,
        baseYieldQuantity: positiveNumber(raw, 'baseYieldQuantity', path, integrity),
        maximumTemperatureForGrowth: numberField(raw, 'maximumTemperatureForGrowth', path),
        minimumSoilMoistureForGrowth: numberField(raw, 'minimumSoilMoistureForGrowth', path),
    };
}

function normalizeRecipe(
    id: string,
    raw: JsonObject,
    acceptedEquipmentItemIds: readonly string[],
    itemIds: ReadonlySet<string>,
    integrity: Integrity
): StationRecipe {
    const path = `report.recipes[${JSON.stringify(id)}]`;
    const ingredients = objectArray(raw.ingredients, `${path}.ingredients`).map(
        (ingredient, index): StationRecipeIngredient => {
            const ingredientPath = `${path}.ingredients[${index}]`;
            const acceptedItemIds = uniqueIds(
                stringArrayField(ingredient, 'acceptedItemIds', ingredientPath),
                `${ingredientPath}.acceptedItemIds`,
                integrity
            );
            requireReferences(acceptedItemIds, itemIds, ingredientPath, integrity);
            integrity.check(
                `${ingredientPath} accepts at least one item`,
                acceptedItemIds.length > 0,
                `${ingredientPath}.acceptedItemIds must not be empty`
            );
            return {
                quantity: positiveNumber(ingredient, 'quantity', ingredientPath, integrity),
                acceptedItemIds,
            };
        }
    );
    const outputItemId = stringField(raw, 'outputItemId', path);
    requireItem(outputItemId, itemIds, `${path}.outputItemId`, integrity);
    return {
        schema: 'neonschedule1-station-recipe-2',
        id,
        title: stringField(raw, 'title', path),
        cookTimeMinutes: positiveNumber(raw, 'cookTimeMinutes', path, integrity),
        cookTemperature: numberField(raw, 'cookTemperature', path),
        cookTemperatureTolerance: nonNegativeNumber(raw, 'cookTemperatureTolerance', path, integrity),
        qualityCalculationMethod: stringField(raw, 'qualityCalculationMethod', path),
        acceptedEquipmentItemIds: [...acceptedEquipmentItemIds],
        ingredients,
        outputItemId,
        outputQuantity: positiveNumber(raw, 'outputQuantity', path, integrity),
    };
}

function normalizeOvenTransforms(
    records: readonly JsonObject[],
    itemIds: ReadonlySet<string>,
    integrity: Integrity
): OvenTransform[] {
    const seen = new Set<string>();
    return records
        .map((raw, index): OvenTransform => {
            const path = `report.ovenTransforms[${index}]`;
            const inputItemId = stringField(raw, 'inputItemId', path);
            const outputItemId = stringField(raw, 'outputItemId', path);
            const key = `${inputItemId}\u001f${outputItemId}`;
            if (seen.has(key)) integrity.addError(`${path} duplicates transform ${JSON.stringify(key)}`);
            seen.add(key);
            requireItem(inputItemId, itemIds, `${path}.inputItemId`, integrity);
            requireItem(outputItemId, itemIds, `${path}.outputItemId`, integrity);
            return {
                schema: 'neonschedule1-oven-transform-2',
                inputItemId,
                cookType: stringField(raw, 'cookType', path),
                cookTimeMinutes: positiveNumber(raw, 'cookTime', path, integrity),
                outputItemId,
                outputQuantity: positiveNumber(raw, 'outputQuantity', path, integrity),
            };
        })
        .sort(
            (left, right) =>
                left.inputItemId.localeCompare(right.inputItemId) ||
                left.outputItemId.localeCompare(right.outputItemId)
        );
}

function normalizeStation(
    itemId: string,
    raw: JsonObject,
    itemIds: ReadonlySet<string>,
    additiveItemIds: ReadonlySet<string>,
    integrity: Integrity
): ProductionStation | null {
    const path = `report.productionStations[${JSON.stringify(itemId)}]`;
    const kind = stringField(raw, 'kind', path);
    requireItem(itemId, itemIds, `${path}.itemId`, integrity);
    const base = { schema: 'neonschedule1-production-station-4' as const, itemId };

    switch (kind) {
        case 'grow-container': {
            const allowedSoilIds = referencedIds(raw, 'allowedSoilIds', path, itemIds, integrity);
            const allowedAdditiveIds = referencedIds(raw, 'allowedAdditiveIds', path, itemIds, integrity);
            for (const additiveItemId of allowedAdditiveIds) {
                integrity.check(
                    `${path}.allowedAdditiveIds ${additiveItemId} has an additive definition`,
                    additiveItemIds.has(additiveItemId),
                    `${path}.allowedAdditiveIds references non-additive item ${JSON.stringify(additiveItemId)}`
                );
            }
            return {
                ...base,
                kind,
                yieldMultiplier: positiveNumber(raw, 'yieldMultiplier', path, integrity),
                growSpeedMultiplier: positiveNumber(raw, 'growSpeedMultiplier', path, integrity),
                requiresExternalGrowLight: itemId !== growTentItemId,
                maxTemperatureGrowthMultiplier: positiveNumber(
                    raw,
                    'maxTemperatureGrowthMultiplier',
                    path,
                    integrity
                ),
                minimumTemperatureThreshold: numberField(raw, 'minimumTemperatureThreshold', path),
                maximumTemperatureThreshold: numberField(raw, 'maximumTemperatureThreshold', path),
                allowedSoilIds,
                allowedAdditiveIds,
            };
        }
        case 'grow-light':
            return {
                ...base,
                kind,
                growSpeedMultiplier: positiveNumber(raw, 'growSpeedMultiplier', path, integrity),
            };
        case 'sprinkler': {
            const particleStopDelay = nullableNumberField(raw, 'particleStopDelay', path);
            if (particleStopDelay !== null) {
                integrity.check(
                    `${path}.particleStopDelay is non-negative`,
                    particleStopDelay >= 0,
                    `${path}.particleStopDelay must be non-negative`
                );
            }
            return {
                ...base,
                kind,
                applyDelay: nonNegativeNumber(raw, 'applyDelay', path, integrity),
                particleStopDelay,
                cooldown: nonNegativeNumber(raw, 'cooldown', path, integrity),
                minimumTargetCount: positiveNumber(raw, 'minimumTargetCount', path, integrity),
                targetTileCoordinates: normalizeSprinklerCoordinates(raw, path, integrity),
            };
        }
        case 'brick-press': {
            const packagingItemId = referencedId(raw, 'packagingItemId', path, itemIds, integrity);
            return {
                ...base,
                kind,
                packagingItemId,
                packagingQuantity: positiveNumber(raw, 'packagingQuantity', path, integrity),
            };
        }
        case 'cauldron': {
            const primaryInputItemId = referencedId(raw, 'primaryInputItemId', path, itemIds, integrity);
            const secondaryInputItemId = referencedId(raw, 'secondaryInputItemId', path, itemIds, integrity);
            const outputItemId = referencedId(raw, 'outputItemId', path, itemIds, integrity);
            return {
                ...base,
                kind,
                cookTimeMinutes: positiveNumber(raw, 'cookTime', path, integrity),
                requiredPrimaryInputQuantity: positiveNumber(
                    raw,
                    'requiredPrimaryInputQuantity',
                    path,
                    integrity
                ),
                primaryInputItemId,
                secondaryInputItemId,
                secondaryInputQuantity: cauldronSecondaryInputQuantity,
                outputItemId,
                outputQuantity: cauldronOutputQuantity,
            };
        }
        case 'drying-rack':
            return {
                ...base,
                kind,
                capacity: positiveNumber(raw, 'capacity', path, integrity),
                maxProcessMultiplier: positiveNumber(raw, 'maxProcessMultiplier', path, integrity),
                processMinutesPerTier: positiveNumber(raw, 'processMinutesPerTier', path, integrity),
                minimumTemperatureThreshold: numberField(raw, 'minimumTemperatureThreshold', path),
                maximumTemperatureThreshold: numberField(raw, 'maximumTemperatureThreshold', path),
            };
        case 'lab-oven':
            return { ...base, kind };
        case 'mixing':
        case 'mixing-mk2':
            return {
                ...base,
                kind,
                capacity: positiveNumber(raw, 'capacity', path, integrity),
                timePerItem: positiveNumber(raw, 'timePerItem', path, integrity),
                requiresManualIngredientInsertion: booleanField(
                    raw,
                    'requiresManualIngredientInsertion',
                    path
                ),
            };
        case 'mushroom-spawn': {
            const grainBagItemId = referencedId(raw, 'grainBagItemId', path, itemIds, integrity);
            const sporeSyringes = objectArray(raw.sporeSyringes, `${path}.sporeSyringes`).map(
                (transform, index) => {
                    const transformPath = `${path}.sporeSyringes[${index}]`;
                    return {
                        syringeItemId: referencedId(transform, 'itemId', transformPath, itemIds, integrity),
                        syringeQuantity: mushroomSpawnInputQuantity,
                        outputSpawnItemId: referencedId(
                            transform,
                            'outputSpawnItemId',
                            transformPath,
                            itemIds,
                            integrity
                        ),
                        outputSpawnQuantity: mushroomSpawnOutputQuantity,
                    };
                }
            );
            return {
                ...base,
                kind,
                grainBagItemId,
                grainBagQuantity: mushroomSpawnInputQuantity,
                workTimeMinutes: mushroomSpawnWorkTimeMinutes,
                sporeSyringes,
            };
        }
        case 'packaging':
        case 'packaging-mk2':
            return {
                ...base,
                kind,
                employeeSpeedMultiplier: positiveNumber(raw, 'employeeSpeedMultiplier', path, integrity),
            };
        default:
            integrity.addError(`${path} has unsupported kind ${JSON.stringify(kind)}`);
            return null;
    }
}

function normalizeSprinklerCoordinates(
    raw: JsonObject,
    path: string,
    integrity: Integrity
): { readonly x: number; readonly y: number }[] | null {
    if (raw.targetTileCoordinates === null || raw.targetTileCoordinates === undefined) return null;
    const coordinates = objectArray(
        raw.targetTileCoordinates,
        `${path}.targetTileCoordinates`
    ).map((coordinate, index) => {
        const coordinatePath = `${path}.targetTileCoordinates[${index}]`;
        const x = numberField(coordinate, 'x', coordinatePath);
        const y = numberField(coordinate, 'y', coordinatePath);
        integrity.check(
            `${coordinatePath} contains integer coordinates`,
            Number.isSafeInteger(x) && Number.isSafeInteger(y),
            `${coordinatePath} must contain safe integer coordinates`
        );
        return { x, y };
    });
    const unique = new Map(coordinates.map((coordinate) => [
        `${coordinate.x},${coordinate.y}`,
        coordinate,
    ]));
    integrity.check(
        `${path}.targetTileCoordinates contains unique coordinates`,
        unique.size === coordinates.length,
        `${path}.targetTileCoordinates contains duplicate coordinates`
    );
    return [...unique.values()].sort((left, right) => left.x - right.x || left.y - right.y);
}

function referencedId(
    raw: JsonObject,
    key: string,
    path: string,
    itemIds: ReadonlySet<string>,
    integrity: Integrity
): string {
    const id = stringField(raw, key, path);
    requireItem(id, itemIds, `${path}.${key}`, integrity);
    return id;
}

function referencedIds(
    raw: JsonObject,
    key: string,
    path: string,
    itemIds: ReadonlySet<string>,
    integrity: Integrity
): string[] {
    const ids = uniqueIds(stringArrayField(raw, key, path), `${path}.${key}`, integrity);
    requireReferences(ids, itemIds, `${path}.${key}`, integrity);
    return ids;
}

function requireItem(
    itemId: string,
    itemIds: ReadonlySet<string>,
    label: string,
    integrity: Integrity
): void {
    requireReferences([itemId], itemIds, label, integrity);
}

function requiredEquipment(
    itemId: string,
    definitionCount: number,
    itemIds: ReadonlySet<string>,
    integrity: Integrity
): string[] {
    if (definitionCount === 0) return [];
    requireItem(itemId, itemIds, `production equipment ${JSON.stringify(itemId)}`, integrity);
    return [itemId];
}

function uniqueIds(ids: readonly string[], path: string, integrity: Integrity): string[] {
    const unique = new Set(ids);
    if (unique.size !== ids.length) integrity.addError(`${path} contains duplicate item IDs`);
    return [...unique].sort();
}

function positiveNumber(raw: JsonObject, key: string, path: string, integrity: Integrity): number {
    const value = numberField(raw, key, path);
    integrity.check(`${path}.${key} is positive`, value > 0, `${path}.${key} must be positive`);
    return value;
}

function nonNegativeNumber(raw: JsonObject, key: string, path: string, integrity: Integrity): number {
    const value = numberField(raw, key, path);
    integrity.check(`${path}.${key} is non-negative`, value >= 0, `${path}.${key} must be non-negative`);
    return value;
}
