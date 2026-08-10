import type { BlueprintDocument } from '#core/data/blueprint';
import {
    ProductionCatalogSchema,
    type ProductionCatalog,
    type ProductionStation,
} from '#core/data/production';
import {
    BlueprintTemperatureCoverageAnalyzer,
    type BlueprintTemperatureDataset,
    type BlueprintTemperatureTileSource,
    type BlueprintTemperatureCoverageResult,
} from '#core/blueprint/temperature';
import type {
    ResolvedBlueprintPlacement,
} from '#core/blueprint/validation';

export interface BlueprintProductionCapacityDataset extends BlueprintTemperatureDataset {
    readonly production: ProductionCatalog;
}

export type BlueprintProductionTemperatureRule =
    | {
        readonly kind: 'environmental-performance-range';
        readonly minimumTemperature: number;
        readonly maximumTemperature: number;
        readonly maximumMultiplier: number;
    }
    | {
        readonly kind: 'environmental-maximum';
        readonly maximumTemperature: number;
    }
    | {
        readonly kind: 'internal-cook-setpoint';
        readonly temperature: number;
        readonly tolerance: number;
    };

export type BlueprintProductionDuration =
    | { readonly kind: 'fixed'; readonly minutes: number }
    | { readonly kind: 'per-item'; readonly minutes: number }
    | { readonly kind: 'per-tier'; readonly minutes: number }
    | { readonly kind: 'not-recorded' };

export interface BlueprintProductionProcessCapacity {
    readonly id: string;
    readonly kind:
        | 'seed-harvest'
        | 'shroom-harvest'
        | 'station-recipe'
        | 'oven-transform'
        | 'cauldron'
        | 'mushroom-spawn'
        | 'drying-rack'
        | 'mixing'
        | 'packaging'
        | 'brick-press';
    readonly inputItemIds: readonly string[];
    readonly outputItemId: string | null;
    readonly recordedOutputQuantity: number | null;
    readonly recordedItemLimit: number | null;
    readonly recordedDuration: BlueprintProductionDuration;
    readonly temperatureRule: BlueprintProductionTemperatureRule | null;
}

export interface BlueprintProductionTemperatureTileEvidence {
    readonly gridId: string;
    readonly x: number;
    readonly y: number;
    readonly ambientTemperature: number;
    readonly sources: readonly BlueprintTemperatureTileSource[];
}

export type BlueprintProductionPlacementTemperature =
    | {
        readonly kind: 'property-grid-tiles';
        readonly coverageProofStatus: 'exact';
        readonly temperatureCombination: 'not-evaluated';
        readonly tiles: readonly BlueprintProductionTemperatureTileEvidence[];
    }
    | {
        readonly kind: 'not-evaluated';
        readonly reason: 'placement-not-on-property-grid';
        readonly tiles: readonly [];
    };

export interface BlueprintProductionPlacementCapacity {
    readonly placementId: string;
    readonly placementKind: ResolvedBlueprintPlacement['kind'];
    readonly temperature: BlueprintProductionPlacementTemperature;
}

export interface BlueprintProductionEquipmentCapacity {
    readonly itemId: string;
    readonly station: ProductionStation | null;
    readonly installedUnitCount: number;
    readonly itemLimitPerUnit: number | null;
    readonly installedItemLimit: number | null;
    readonly placements: readonly BlueprintProductionPlacementCapacity[];
    readonly processes: readonly BlueprintProductionProcessCapacity[];
}

export type BlueprintProductionCapacityResult =
    | {
        readonly kind: 'rejected';
        readonly temperature: Extract<BlueprintTemperatureCoverageResult, { readonly kind: 'rejected' }>;
        readonly equipment: readonly [];
    }
    | {
        readonly kind: 'analyzed';
        readonly temperature: Extract<BlueprintTemperatureCoverageResult, { readonly kind: 'analyzed' }>;
        readonly capacityScope: 'installed-production-equipment';
        readonly processValues: 'normalized-records';
        readonly parallelScheduling: 'not-evaluated';
        readonly effectiveTemperature: 'not-evaluated';
        readonly equipment: readonly BlueprintProductionEquipmentCapacity[];
    };

export class BlueprintProductionCapacityAnalyzer {
    readonly #temperature: BlueprintTemperatureCoverageAnalyzer;
    readonly #stationByItemId: ReadonlyMap<string, ProductionStation>;
    readonly #processesByItemId: ReadonlyMap<string, readonly BlueprintProductionProcessCapacity[]>;

    constructor(dataset: BlueprintProductionCapacityDataset) {
        this.#temperature = new BlueprintTemperatureCoverageAnalyzer(dataset);
        const production = ProductionCatalogSchema.assert(dataset.production);
        this.#stationByItemId = indexUnique(
            production.stations,
            (station) => station.itemId,
            'production station item ID'
        );
        this.#processesByItemId = indexProcesses(production, this.#stationByItemId);
    }

    analyze(input: BlueprintDocument): BlueprintProductionCapacityResult {
        const temperature = this.#temperature.analyze(input);
        if (temperature.kind === 'rejected') {
            return { kind: 'rejected', temperature, equipment: [] };
        }

        const resolvedById = new Map(
            temperature.projection.validation.resolvedPlacements.map((placement) => [
                placement.id,
                placement,
            ])
        );
        const temperatureTileByCoordinate = new Map(
            temperature.tiles.map((tile) => [tileKey(tile.gridId, tile.x, tile.y), tile])
        );
        const placementsByItemId = new Map<string, BlueprintProductionPlacementCapacity[]>();
        for (const projected of temperature.projection.placements) {
            const station = this.#stationByItemId.get(projected.itemId);
            const processes = this.#processesByItemId.get(projected.itemId) ?? [];
            if (station === undefined && processes.length === 0) continue;
            const resolved = resolvedById.get(projected.id);
            if (resolved === undefined) {
                throw new Error('Projected blueprint references unavailable capacity placement data');
            }
            const placement = {
                placementId: projected.id,
                placementKind: projected.kind,
                temperature: placementTemperature(
                    resolved,
                    temperature.ambientTemperature,
                    temperatureTileByCoordinate
                ),
            };
            const placements = placementsByItemId.get(projected.itemId);
            if (placements === undefined) placementsByItemId.set(projected.itemId, [placement]);
            else placements.push(placement);
        }

        const equipment = [...placementsByItemId]
            .map(([itemId, placements]) => {
                const station = this.#stationByItemId.get(itemId) ?? null;
                const itemLimitPerUnit = explicitItemLimit(station);
                const installedItemLimit = itemLimitPerUnit === null
                    ? null
                    : multiplyFinite(itemLimitPerUnit, placements.length, itemId);
                return {
                    itemId,
                    station,
                    installedUnitCount: placements.length,
                    itemLimitPerUnit,
                    installedItemLimit,
                    placements,
                    processes: this.#processesByItemId.get(itemId) ?? [],
                };
            })
            .sort((left, right) => left.itemId.localeCompare(right.itemId));

        return {
            kind: 'analyzed',
            temperature,
            capacityScope: 'installed-production-equipment',
            processValues: 'normalized-records',
            parallelScheduling: 'not-evaluated',
            effectiveTemperature: 'not-evaluated',
            equipment,
        };
    }
}

function indexProcesses(
    catalog: ProductionCatalog,
    stationByItemId: ReadonlyMap<string, ProductionStation>
): ReadonlyMap<string, readonly BlueprintProductionProcessCapacity[]> {
    const result = new Map<string, BlueprintProductionProcessCapacity[]>();
    const add = (itemId: string, process: BlueprintProductionProcessCapacity): void => {
        requireNonBlank(itemId, 'Production process equipment item ID');
        const processes = result.get(itemId);
        if (processes === undefined) result.set(itemId, [process]);
        else processes.push(process);
    };

    for (const station of catalog.stations) {
        for (const process of stationProcesses(station, catalog)) add(station.itemId, process);
    }
    for (const shroom of catalog.shrooms) {
        const process: BlueprintProductionProcessCapacity = {
            id: `shroom:${shroom.spawnItemId}:${shroom.productItemId}`,
            kind: 'shroom-harvest',
            inputItemIds: [shroom.spawnItemId, ...shroom.soilItemIds],
            outputItemId: shroom.productItemId,
            recordedOutputQuantity: positive(shroom.baseYieldQuantity, 'Shroom base yield'),
            recordedItemLimit: null,
            recordedDuration: fixedDuration(shroom.growTimeMinutes, 'Shroom growth time'),
            temperatureRule: {
                kind: 'environmental-maximum',
                maximumTemperature: finite(
                    shroom.maximumTemperatureForGrowth,
                    'Shroom maximum growth temperature'
                ),
            },
        };
        for (const itemId of uniqueSorted(shroom.acceptedEquipmentItemIds)) add(itemId, process);
    }
    for (const recipe of catalog.stationRecipes) {
        const process: BlueprintProductionProcessCapacity = {
            id: `recipe:${recipe.id}`,
            kind: 'station-recipe',
            inputItemIds: uniqueSorted(recipe.ingredients.flatMap((input) => input.acceptedItemIds)),
            outputItemId: recipe.outputItemId,
            recordedOutputQuantity: positive(recipe.outputQuantity, 'Station recipe output quantity'),
            recordedItemLimit: null,
            recordedDuration: fixedDuration(recipe.cookTimeMinutes, 'Station recipe cook time'),
            temperatureRule: {
                kind: 'internal-cook-setpoint',
                temperature: finite(recipe.cookTemperature, 'Station recipe cook temperature'),
                tolerance: nonNegative(
                    recipe.cookTemperatureTolerance,
                    'Station recipe cook temperature tolerance'
                ),
            },
        };
        for (const itemId of uniqueSorted(recipe.acceptedEquipmentItemIds)) add(itemId, process);
    }
    const labOvenItemIds = [...stationByItemId.values()]
        .filter((station) => station.kind === 'lab-oven')
        .map((station) => station.itemId);
    for (const transform of catalog.ovenTransforms) {
        const process: BlueprintProductionProcessCapacity = {
            id: `oven:${transform.inputItemId}:${transform.outputItemId}`,
            kind: 'oven-transform',
            inputItemIds: [transform.inputItemId],
            outputItemId: transform.outputItemId,
            recordedOutputQuantity: positive(transform.outputQuantity, 'Oven output quantity'),
            recordedItemLimit: null,
            recordedDuration: fixedDuration(transform.cookTimeMinutes, 'Oven cook time'),
            temperatureRule: null,
        };
        for (const itemId of labOvenItemIds) add(itemId, process);
    }
    for (const processes of result.values()) {
        const ids = new Set<string>();
        for (const process of processes) {
            requireNonBlank(process.id, 'Production process ID');
            if (ids.has(process.id)) {
                throw new Error(`Production equipment has duplicate process ${JSON.stringify(process.id)}`);
            }
            ids.add(process.id);
        }
        processes.sort((left, right) => left.id.localeCompare(right.id));
    }
    return result;
}

function stationProcesses(
    station: ProductionStation,
    catalog: ProductionCatalog
): BlueprintProductionProcessCapacity[] {
    switch (station.kind) {
        case 'grow-container':
            return catalog.seeds.flatMap((seed) => {
                const compatibleSoilItemIds = seed.soilItemIds.filter((itemId) =>
                    station.allowedSoilIds.includes(itemId)
                );
                if (compatibleSoilItemIds.length === 0) return [];
                return seed.harvestProducts.map((product) => ({
                    id: `seed:${seed.seedItemId}:${product.itemId}`,
                    kind: 'seed-harvest' as const,
                    inputItemIds: uniqueSorted([seed.seedItemId, ...compatibleSoilItemIds]),
                    outputItemId: product.itemId,
                    recordedOutputQuantity: positive(
                        seed.baseYieldQuantity * product.quantity,
                        'Seed harvest output quantity'
                    ),
                    recordedItemLimit: null,
                    recordedDuration: fixedDuration(seed.growthTimeMinutes, 'Seed growth time'),
                    temperatureRule: performanceTemperatureRule(
                        station.minimumTemperatureThreshold,
                        station.maximumTemperatureThreshold,
                        station.maxTemperatureGrowthMultiplier,
                        'Grow-container'
                    ),
                }));
            });
        case 'drying-rack':
            return [{
                id: `drying-rack:${station.itemId}`,
                kind: 'drying-rack',
                inputItemIds: [],
                outputItemId: null,
                recordedOutputQuantity: null,
                recordedItemLimit: positive(station.capacity, 'Drying-rack capacity'),
                recordedDuration: perTierDuration(
                    station.processMinutesPerTier,
                    'Drying-rack process time per tier'
                ),
                temperatureRule: performanceTemperatureRule(
                    station.minimumTemperatureThreshold,
                    station.maximumTemperatureThreshold,
                    station.maxProcessMultiplier,
                    'Drying-rack'
                ),
            }];
        case 'mixing':
        case 'mixing-mk2':
            return [{
                id: `mixing:${station.itemId}`,
                kind: 'mixing',
                inputItemIds: [],
                outputItemId: null,
                recordedOutputQuantity: null,
                recordedItemLimit: positive(station.capacity, 'Mixing-station capacity'),
                recordedDuration: perItemDuration(station.timePerItem, 'Mixing-station time per item'),
                temperatureRule: null,
            }];
        case 'cauldron':
            return [{
                id: `cauldron:${station.itemId}`,
                kind: 'cauldron',
                inputItemIds: [station.primaryInputItemId, station.secondaryInputItemId],
                outputItemId: station.outputItemId,
                recordedOutputQuantity: positive(station.outputQuantity, 'Cauldron output quantity'),
                recordedItemLimit: null,
                recordedDuration: fixedDuration(station.cookTimeMinutes, 'Cauldron cook time'),
                temperatureRule: null,
            }];
        case 'mushroom-spawn':
            return station.sporeSyringes.map((transform) => ({
                id: `mushroom-spawn:${station.itemId}:${transform.syringeItemId}`,
                kind: 'mushroom-spawn',
                inputItemIds: [station.grainBagItemId, transform.syringeItemId],
                outputItemId: transform.outputSpawnItemId,
                recordedOutputQuantity: positive(
                    transform.outputSpawnQuantity,
                    'Mushroom-spawn output quantity'
                ),
                recordedItemLimit: null,
                recordedDuration: fixedDuration(station.workTimeMinutes, 'Mushroom-spawn work time'),
                temperatureRule: null,
            }));
        case 'packaging':
        case 'packaging-mk2':
            return [{
                id: `packaging:${station.itemId}`,
                kind: 'packaging',
                inputItemIds: [],
                outputItemId: null,
                recordedOutputQuantity: null,
                recordedItemLimit: null,
                recordedDuration: { kind: 'not-recorded' },
                temperatureRule: null,
            }];
        case 'brick-press':
            return [{
                id: `brick-press:${station.itemId}`,
                kind: 'brick-press',
                inputItemIds: [],
                outputItemId: null,
                recordedOutputQuantity: catalog.brickPressing.packagedItemQuantityPerOperation,
                recordedItemLimit: null,
                recordedDuration: { kind: 'not-recorded' },
                temperatureRule: null,
            }];
        case 'lab-oven':
        case 'grow-light':
        case 'sprinkler':
            return [];
    }
}

function placementTemperature(
    placement: ResolvedBlueprintPlacement,
    ambientTemperature: number,
    tileByCoordinate: ReadonlyMap<string, {
        readonly gridId: string;
        readonly x: number;
        readonly y: number;
        readonly sources: readonly BlueprintTemperatureTileSource[];
    }>
): BlueprintProductionPlacementTemperature {
    if (placement.kind !== 'grid') {
        return {
            kind: 'not-evaluated',
            reason: 'placement-not-on-property-grid',
            tiles: [],
        };
    }
    return {
        kind: 'property-grid-tiles',
        coverageProofStatus: 'exact',
        temperatureCombination: 'not-evaluated',
        tiles: placement.occupiedTiles.map((tile) => {
            const coverage = tileByCoordinate.get(tileKey(placement.gridId, tile.x, tile.y));
            if (coverage === undefined) {
                throw new Error('Production placement references unavailable temperature tile data');
            }
            return {
                gridId: placement.gridId,
                x: tile.x,
                y: tile.y,
                ambientTemperature,
                sources: coverage.sources,
            };
        }),
    };
}

function explicitItemLimit(station: ProductionStation | null): number | null {
    if (station?.kind !== 'drying-rack' && station?.kind !== 'mixing' && station?.kind !== 'mixing-mk2') {
        return null;
    }
    return positive(station.capacity, 'Production station capacity');
}

function fixedDuration(minutes: number, label: string): BlueprintProductionDuration {
    return { kind: 'fixed', minutes: positive(minutes, label) };
}

function perItemDuration(minutes: number, label: string): BlueprintProductionDuration {
    return { kind: 'per-item', minutes: positive(minutes, label) };
}

function perTierDuration(minutes: number, label: string): BlueprintProductionDuration {
    return { kind: 'per-tier', minutes: positive(minutes, label) };
}

function performanceTemperatureRule(
    minimumTemperature: number,
    maximumTemperature: number,
    maximumMultiplier: number,
    label: string
): Extract<BlueprintProductionTemperatureRule, {
    readonly kind: 'environmental-performance-range';
}> {
    const minimum = finite(minimumTemperature, `${label} minimum temperature`);
    const maximum = finite(maximumTemperature, `${label} maximum temperature`);
    if (minimum > maximum) {
        throw new RangeError(`${label} minimum temperature must not exceed its maximum`);
    }
    return {
        kind: 'environmental-performance-range',
        minimumTemperature: minimum,
        maximumTemperature: maximum,
        maximumMultiplier: positive(maximumMultiplier, `${label} maximum temperature multiplier`),
    };
}

function indexUnique<T>(
    values: readonly T[],
    keyFor: (value: T) => string,
    label: string
): ReadonlyMap<string, T> {
    const result = new Map<string, T>();
    for (const value of values) {
        const key = keyFor(value);
        requireNonBlank(key, label);
        if (result.has(key)) throw new Error(`Dataset contains duplicate ${label} ${JSON.stringify(key)}`);
        result.set(key, value);
    }
    return result;
}

function uniqueSorted(values: readonly string[]): string[] {
    for (const value of values) requireNonBlank(value, 'Production item ID');
    return [...new Set(values)].sort();
}

function tileKey(gridId: string, x: number, y: number): string {
    return `${gridId}\u001f${x}\u001f${y}`;
}

function requireNonBlank(value: string, label: string): void {
    if (value.trim().length === 0) throw new TypeError(`${label} must not be blank`);
}

function finite(value: number, label: string): number {
    if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
    return value;
}

function positive(value: number, label: string): number {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`);
    return value;
}

function nonNegative(value: number, label: string): number {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be non-negative`);
    return value;
}

function multiplyFinite(value: number, count: number, itemId: string): number {
    const result = value * count;
    if (!Number.isFinite(result)) {
        throw new RangeError(`Production equipment ${JSON.stringify(itemId)} installed capacity must be finite`);
    }
    return result;
}
