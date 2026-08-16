import type { BlueprintDocument, BlueprintGridCoordinate } from '#core/data/blueprint';
import {
    ProductionCatalogSchema,
    type ProductionCatalog,
    type SprinklerStation,
} from '#core/data/production';
import { rotateGridOffset } from '#core/blueprint/grid-footprint';
import {
    BlueprintValidator,
    type BlueprintDataset,
    type BlueprintValidationResult,
    type ResolvedBlueprintGridPlacement,
} from '#core/blueprint/validation';

export interface BlueprintSprinklerDataset extends BlueprintDataset {
    readonly production: ProductionCatalog;
}

export interface BlueprintSprinklerGridTile extends BlueprintGridCoordinate {
    readonly gridId: string;
}

export interface BlueprintSprinklerPotCoverage {
    readonly placementId: string;
    readonly itemId: string;
    readonly coveredTileCount: number;
    readonly qualifiesForWatering: boolean;
}

export type BlueprintSprinklerCoverage =
    | {
        readonly kind: 'exact';
        readonly proof: 'native-rotated-target-tiles-and-pot-tile-count';
        readonly minimumTargetCount: number;
        readonly resolvedTargetTiles: readonly BlueprintSprinklerGridTile[];
        readonly intersectingPots: readonly BlueprintSprinklerPotCoverage[];
        readonly wateredPotPlacementIds: readonly string[];
    }
    | {
        readonly kind: 'not-evaluated';
        readonly reason: 'target-tile-coordinates-not-recorded' | 'placement-not-on-property-grid';
        readonly minimumTargetCount: number;
        readonly resolvedTargetTiles: readonly [];
        readonly intersectingPots: readonly [];
        readonly wateredPotPlacementIds: readonly [];
    };

export type BlueprintSprinklerTiming =
    | {
        readonly kind: 'exact';
        readonly applyDelaySeconds: number;
        readonly particleStopDelaySeconds: number;
        readonly cooldownSeconds: number;
        readonly fullCycleSeconds: number;
    }
    | {
        readonly kind: 'not-evaluated';
        readonly reason: 'particle-stop-delay-not-recorded';
        readonly applyDelaySeconds: number;
        readonly particleStopDelaySeconds: null;
        readonly cooldownSeconds: number;
        readonly fullCycleSeconds: null;
    };

export interface BlueprintSprinklerPlacementAnalysis {
    readonly placementId: string;
    readonly itemId: string;
    readonly coverage: BlueprintSprinklerCoverage;
    readonly timing: BlueprintSprinklerTiming;
}

export type BlueprintSprinklerAnalysisResult =
    | {
        readonly kind: 'rejected';
        readonly validation: BlueprintValidationResult;
        readonly sprinklers: readonly [];
    }
    | {
        readonly kind: 'analyzed';
        readonly validation: BlueprintValidationResult;
        readonly coverageScope: 'installed-sprinklers-over-installed-pot-grid-tiles';
        readonly potTargetType: 'grow-container-production-stations';
        readonly applicationSegmentCount: 5;
        readonly requestedWaterCapacityFractionPerSegment: 0.2;
        readonly requestedWaterCapacityFractionPerApplication: 1;
        readonly movingPotsDuringApplication: 'not-evaluated';
        readonly sprinklers: readonly BlueprintSprinklerPlacementAnalysis[];
    };

export class BlueprintSprinklerAnalyzer {
    readonly #validator: BlueprintValidator;
    readonly #stationByItemId: ReadonlyMap<string, ProductionCatalog['stations'][number]>;
    readonly #potItemIds: ReadonlySet<string>;
    readonly #availableTileKeysByPropertyCode: ReadonlyMap<
        string,
        ReadonlyMap<string, ReadonlySet<string>>
    >;

    constructor(dataset: BlueprintSprinklerDataset) {
        this.#validator = new BlueprintValidator(dataset);
        const production = ProductionCatalogSchema.assert(dataset.production);
        this.#stationByItemId = indexUnique(
            production.stations,
            (station) => station.itemId,
            'production station item ID'
        );
        this.#potItemIds = new Set(
            production.stations
                .filter((station) => station.kind === 'grow-container')
                .map((station) => station.itemId)
        );
        this.#availableTileKeysByPropertyCode = indexAvailableTiles(dataset);
    }

    analyze(input: BlueprintDocument): BlueprintSprinklerAnalysisResult {
        const validation = this.#validator.validate(input);
        if (!validation.valid) return { kind: 'rejected', validation, sprinklers: [] };

        const inputById = new Map(validation.document.placements.map((placement) => [
            placement.id,
            placement,
        ]));
        const pots = validation.resolvedPlacements.filter(
            (placement): placement is ResolvedBlueprintGridPlacement =>
                placement.kind === 'grid' && this.#potItemIds.has(placement.itemId)
        );
        const availableTileKeysByGridId = this.#availableTileKeysByPropertyCode.get(
            validation.document.propertyCode
        );
        if (availableTileKeysByGridId === undefined) {
            throw new Error('Validated blueprint references unavailable property grid data');
        }
        const sprinklers = validation.resolvedPlacements.flatMap((placement) => {
            const station = this.#stationByItemId.get(placement.itemId);
            if (station?.kind !== 'sprinkler') return [];
            const source = inputById.get(placement.id);
            return [analyzeSprinkler(
                station,
                placement,
                source?.kind === 'grid' ? source.anchor : null,
                pots,
                availableTileKeysByGridId
            )];
        }).sort((left, right) => left.placementId.localeCompare(right.placementId));

        return {
            kind: 'analyzed',
            validation,
            coverageScope: 'installed-sprinklers-over-installed-pot-grid-tiles',
            potTargetType: 'grow-container-production-stations',
            applicationSegmentCount: 5,
            requestedWaterCapacityFractionPerSegment: 0.2,
            requestedWaterCapacityFractionPerApplication: 1,
            movingPotsDuringApplication: 'not-evaluated',
            sprinklers,
        };
    }
}

function analyzeSprinkler(
    station: SprinklerStation,
    placement: BlueprintValidationResult['resolvedPlacements'][number],
    anchor: BlueprintGridCoordinate | null,
    pots: readonly ResolvedBlueprintGridPlacement[],
    availableTileKeysByGridId: ReadonlyMap<string, ReadonlySet<string>>
): BlueprintSprinklerPlacementAnalysis {
    return {
        placementId: placement.id,
        itemId: placement.itemId,
        coverage: sprinklerCoverage(
            station,
            placement,
            anchor,
            pots,
            availableTileKeysByGridId
        ),
        timing: station.particleStopDelay === null
            ? {
                kind: 'not-evaluated',
                reason: 'particle-stop-delay-not-recorded',
                applyDelaySeconds: station.applyDelay,
                particleStopDelaySeconds: null,
                cooldownSeconds: station.cooldown,
                fullCycleSeconds: null,
            }
            : {
                kind: 'exact',
                applyDelaySeconds: station.applyDelay,
                particleStopDelaySeconds: station.particleStopDelay,
                cooldownSeconds: station.cooldown,
                fullCycleSeconds:
                    station.applyDelay + station.particleStopDelay + station.cooldown,
            },
    };
}

function sprinklerCoverage(
    station: SprinklerStation,
    placement: BlueprintValidationResult['resolvedPlacements'][number],
    anchor: BlueprintGridCoordinate | null,
    pots: readonly ResolvedBlueprintGridPlacement[],
    availableTileKeysByGridId: ReadonlyMap<string, ReadonlySet<string>>
): BlueprintSprinklerCoverage {
    if (placement.kind !== 'grid' || anchor === null) {
        return unavailableCoverage('placement-not-on-property-grid', station.minimumTargetCount);
    }
    if (station.targetTileCoordinates === null) {
        return unavailableCoverage('target-tile-coordinates-not-recorded', station.minimumTargetCount);
    }
    const availableTileKeys = availableTileKeysByGridId.get(placement.gridId) ?? new Set<string>();
    const targetTilesByKey = new Map<string, BlueprintSprinklerGridTile>();
    for (const offset of station.targetTileCoordinates) {
        const rotated = rotateGridOffset(offset, placement.rotation);
        const tile = {
            gridId: placement.gridId,
            x: anchor.x + rotated.x,
            y: anchor.y + rotated.y,
        };
        const key = coordinateKey(tile.x, tile.y);
        if (availableTileKeys.has(key)) targetTilesByKey.set(key, tile);
    }
    const resolvedTargetTiles = [...targetTilesByKey.values()].sort(compareTiles);
    const targetTileKeys = new Set(targetTilesByKey.keys());
    const intersectingPots = pots
        .filter((pot) => pot.gridId === placement.gridId)
        .map((pot) => ({
            placementId: pot.id,
            itemId: pot.itemId,
            coveredTileCount: pot.occupiedTiles.filter((tile) =>
                targetTileKeys.has(coordinateKey(tile.x, tile.y))
            ).length,
        }))
        .filter((pot) => pot.coveredTileCount > 0)
        .map((pot) => ({
            ...pot,
            qualifiesForWatering: pot.coveredTileCount >= station.minimumTargetCount,
        }))
        .sort((left, right) => left.placementId.localeCompare(right.placementId));
    return {
        kind: 'exact',
        proof: 'native-rotated-target-tiles-and-pot-tile-count',
        minimumTargetCount: station.minimumTargetCount,
        resolvedTargetTiles,
        intersectingPots,
        wateredPotPlacementIds: intersectingPots
            .filter((pot) => pot.qualifiesForWatering)
            .map((pot) => pot.placementId),
    };
}

function unavailableCoverage(
    reason: Extract<BlueprintSprinklerCoverage, { readonly kind: 'not-evaluated' }>['reason'],
    minimumTargetCount: number
): BlueprintSprinklerCoverage {
    return {
        kind: 'not-evaluated',
        reason,
        minimumTargetCount,
        resolvedTargetTiles: [],
        intersectingPots: [],
        wateredPotPlacementIds: [],
    };
}

function indexAvailableTiles(
    dataset: BlueprintDataset
): ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>> {
    const result = new Map<string, Map<string, Set<string>>>();
    for (const property of dataset.propertyLayouts) {
        if (result.has(property.propertyCode)) {
            throw new Error(
                `Dataset contains duplicate property layout ${JSON.stringify(property.propertyCode)}`
            );
        }
        const grids = new Map<string, Set<string>>();
        for (const grid of property.grids) {
            if (grids.has(grid.id)) {
                throw new Error(`Dataset contains duplicate property grid ID ${JSON.stringify(grid.id)}`);
            }
            grids.set(grid.id, new Set(grid.tiles.map((tile) => coordinateKey(tile.x, tile.y))));
        }
        result.set(property.propertyCode, grids);
    }
    return result;
}

function coordinateKey(x: number, y: number): string {
    return `${x},${y}`;
}

function compareTiles(left: BlueprintSprinklerGridTile, right: BlueprintSprinklerGridTile): number {
    return left.gridId.localeCompare(right.gridId) || left.x - right.x || left.y - right.y;
}

function indexUnique<T>(
    values: readonly T[],
    keyFor: (value: T) => string,
    label: string
): ReadonlyMap<string, T> {
    const result = new Map<string, T>();
    for (const value of values) {
        const key = keyFor(value);
        if (result.has(key)) throw new Error(`Dataset contains duplicate ${label} ${JSON.stringify(key)}`);
        result.set(key, value);
    }
    return result;
}
