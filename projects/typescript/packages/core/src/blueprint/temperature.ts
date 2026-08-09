import { type BlueprintDocument } from '#core/data/blueprint';
import { PropertySchema, type Property } from '#core/data/property';
import { type PropertyGridTile, type PropertyLayout } from '#core/data/property-layout';
import {
    BlueprintProjector,
    type BlueprintProjectionResult,
    type ProjectedBlueprintPlacement,
} from '#core/blueprint/projection';
import { type BlueprintDataset } from '#core/blueprint/validation';
import { type Vector3 } from '#core/data/common';

export interface BlueprintTemperatureDataset extends BlueprintDataset {
    readonly properties: readonly Property[];
}

export interface BlueprintTemperatureEmitterCoverage {
    readonly placementId: string;
    readonly emitterIndex: number;
    readonly temperature: number;
    readonly range: number;
    readonly worldPosition: Vector3;
}

export interface BlueprintTemperatureTileSource {
    readonly placementId: string;
    readonly emitterIndex: number;
    readonly temperature: number;
    readonly distance: number;
}

export interface BlueprintTemperatureTileCoverage {
    readonly gridId: string;
    readonly x: number;
    readonly y: number;
    readonly worldPosition: Vector3;
    readonly sources: readonly BlueprintTemperatureTileSource[];
}

export type BlueprintTemperatureCoverageResult =
    | {
        readonly kind: 'rejected';
        readonly projection: Extract<BlueprintProjectionResult, { readonly kind: 'rejected' }>;
        readonly coverageProofStatus: 'not-applicable';
        readonly coverageScope: 'not-applicable';
        readonly temperatureCombination: 'not-applicable';
        readonly propertyCode: null;
        readonly ambientTemperature: null;
        readonly emitters: readonly [];
        readonly tiles: readonly [];
    }
    | {
        readonly kind: 'analyzed';
        readonly projection: Extract<BlueprintProjectionResult, { readonly kind: 'projected' }>;
        readonly coverageProofStatus: 'exact';
        readonly coverageScope: 'blueprint-emitters-over-property-grid-tiles';
        readonly temperatureCombination: 'not-evaluated';
        readonly propertyCode: string;
        readonly ambientTemperature: number;
        readonly emitters: readonly BlueprintTemperatureEmitterCoverage[];
        readonly tiles: readonly BlueprintTemperatureTileCoverage[];
    };

export class BlueprintTemperatureCoverageAnalyzer {
    readonly #projector: BlueprintProjector;
    readonly #propertyByCode: ReadonlyMap<string, Property>;
    readonly #layoutByPropertyCode: ReadonlyMap<string, PropertyLayout>;

    constructor(dataset: BlueprintTemperatureDataset) {
        this.#projector = new BlueprintProjector(dataset);
        this.#propertyByCode = indexUnique(
            dataset.properties.map((property) => PropertySchema.assert(property)),
            (property) => property.code,
            'property code'
        );
        this.#layoutByPropertyCode = indexUnique(
            dataset.propertyLayouts,
            (layout) => layout.propertyCode,
            'property layout code'
        );
    }

    analyze(input: BlueprintDocument): BlueprintTemperatureCoverageResult {
        const projection = this.#projector.project(input);
        if (projection.kind === 'rejected') {
            return {
                kind: 'rejected',
                projection,
                coverageProofStatus: 'not-applicable',
                coverageScope: 'not-applicable',
                temperatureCombination: 'not-applicable',
                propertyCode: null,
                ambientTemperature: null,
                emitters: [],
                tiles: [],
            };
        }

        const propertyCode = projection.validation.document.propertyCode;
        const property = this.#propertyByCode.get(propertyCode);
        const layout = this.#layoutByPropertyCode.get(propertyCode);
        if (property === undefined || layout === undefined) {
            throw new Error(
                `Projected blueprint references unavailable property temperature data ${JSON.stringify(propertyCode)}`
            );
        }
        if (!Number.isFinite(property.ambientTemperature)) {
            throw new RangeError(
                `Property ${JSON.stringify(propertyCode)} ambient temperature must be finite`
            );
        }

        const emitters = projectedEmitters(projection.placements);
        return {
            kind: 'analyzed',
            projection,
            coverageProofStatus: 'exact',
            coverageScope: 'blueprint-emitters-over-property-grid-tiles',
            temperatureCombination: 'not-evaluated',
            propertyCode,
            ambientTemperature: property.ambientTemperature,
            emitters,
            tiles: layout.grids.flatMap((grid) =>
                grid.tiles.map((tile) => tileCoverage(grid.id, tile, emitters))
            ).sort(compareTiles),
        };
    }
}

function projectedEmitters(
    placements: readonly ProjectedBlueprintPlacement[]
): BlueprintTemperatureEmitterCoverage[] {
    return placements.flatMap((placement) =>
        placement.temperatureEmitters.map((emitter, emitterIndex) => ({
            placementId: placement.id,
            emitterIndex,
            temperature: emitter.temperature,
            range: emitter.range,
            worldPosition: emitter.worldPosition,
        }))
    ).sort(compareEmitters);
}

function tileCoverage(
    gridId: string,
    tile: PropertyGridTile,
    emitters: readonly BlueprintTemperatureEmitterCoverage[]
): BlueprintTemperatureTileCoverage {
    return {
        gridId,
        x: tile.x,
        y: tile.y,
        worldPosition: tile.worldPosition,
        sources: emitters.flatMap((emitter) => {
            const distance = distanceBetween(tile.worldPosition, emitter.worldPosition);
            if (distance > emitter.range) return [];
            return [{
                placementId: emitter.placementId,
                emitterIndex: emitter.emitterIndex,
                temperature: emitter.temperature,
                distance,
            }];
        }),
    };
}

function distanceBetween(left: Vector3, right: Vector3): number {
    return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function indexUnique<T>(
    values: readonly T[],
    keyFor: (value: T) => string,
    label: string
): ReadonlyMap<string, T> {
    const index = new Map<string, T>();
    for (const value of values) {
        const key = keyFor(value);
        if (key.trim().length === 0) throw new TypeError(`${label} must not be blank`);
        if (index.has(key)) {
            throw new Error(`Dataset contains duplicate ${label} ${JSON.stringify(key)}`);
        }
        index.set(key, value);
    }
    return index;
}

function compareEmitters(
    left: BlueprintTemperatureEmitterCoverage,
    right: BlueprintTemperatureEmitterCoverage
): number {
    return left.placementId.localeCompare(right.placementId) ||
        left.emitterIndex - right.emitterIndex;
}

function compareTiles(
    left: BlueprintTemperatureTileCoverage,
    right: BlueprintTemperatureTileCoverage
): number {
    return left.gridId.localeCompare(right.gridId) || left.x - right.x || left.y - right.y;
}
