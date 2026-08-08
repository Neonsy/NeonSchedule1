import {
    BuildableSchema,
    type Buildable,
    type BuildableStorage,
    type InteractionPoint,
    type TemperatureEmitter,
} from '@neonschedule1/core';

import type { VerifiedAssets } from '#data-compiler/acquisition/assets';
import type { RawReport } from '#data-compiler/acquisition/types';
import { indexUnique, Integrity, requireReferences } from '#data-compiler/integrity';
import {
    asObject,
    booleanField,
    nullableNumberField,
    nullableStringField,
    numberField,
    objectArray,
    stringArrayField,
    stringField,
    vector3,
    type JsonObject,
} from '#data-compiler/json';
import {
    normalizeCollider,
    normalizeSceneVisuals,
    normalizeTransform,
} from '#data-compiler/normalize/geometry';

export function normalizeBuildables(
    report: BuildableReport,
    assets: VerifiedAssets,
    itemIds: ReadonlySet<string>,
    integrity: Integrity
): Buildable[] {
    const index = indexUnique(
        report.discovery.buildables,
        'itemId',
        'report.discovery.buildables',
        integrity
    );
    requireReferences(index.keys(), itemIds, 'buildable', integrity);
    return [...index.entries()]
        .map(([itemId, raw]) => normalizeBuildable(itemId, raw, assets, integrity))
        .sort((left, right) => left.itemId.localeCompare(right.itemId));
}

type BuildableReport = {
    readonly discovery: Pick<RawReport['discovery'], 'buildables'>;
};

function normalizeBuildable(
    itemId: string,
    raw: JsonObject,
    assets: VerifiedAssets,
    integrity: Integrity
): Buildable {
    const path = `report.discovery.buildables[${JSON.stringify(itemId)}]`;
    const width = nullableNumberField(raw, 'footprintWidth', path);
    const height = nullableNumberField(raw, 'footprintHeight', path);
    const rawFootprintTiles = objectArray(raw.footprintTiles, `${path}.footprintTiles`).map(
        (tile, index) => {
            const tilePath = `${path}.footprintTiles[${index}]`;
            return {
                x: numberField(tile, 'x', tilePath),
                y: numberField(tile, 'y', tilePath),
                requiredOffset: numberField(tile, 'requiredOffset', tilePath),
                transform: normalizeTransform(tile.transform, `${tilePath}.transform`),
            };
        }
    );
    const footprintTiles = normalizeFootprintCoordinates(itemId, rawFootprintTiles, width, height, integrity);
    validateFootprint(itemId, width, height, footprintTiles, integrity);
    const storageRaw = raw.storage;
    const buildable: Buildable = {
        schema: 'neonschedule1-buildable-1',
        itemId,
        runtimeType: stringField(raw, 'runtimeType', path),
        placement: {
            kind: stringField(raw, 'placementKind', path),
            holdDistance: numberField(raw, 'holdDistance', path),
            footprintWidth: width,
            footprintHeight: height,
            proceduralTileType: nullableStringField(raw, 'proceduralTileType', path),
            allowRotation: nullableBoolean(raw, 'allowRotation', path),
            rotationIncrement: nullableNumberField(raw, 'rotationIncrement', path),
            validSurfaceTypes: stringArrayField(raw, 'validSurfaceTypes', path),
            buildPoint: normalizeTransform(raw.buildPoint, `${path}.buildPoint`),
            midAirCenterPoint:
                raw.midAirCenterPoint === undefined || raw.midAirCenterPoint === null
                    ? null
                    : normalizeTransform(raw.midAirCenterPoint, `${path}.midAirCenterPoint`),
            boundingCollider: normalizeCollider(raw.boundingCollider, `${path}.boundingCollider`),
            footprintTiles,
        },
        componentTypes: [...new Set(stringArrayField(raw, 'componentTypes', path))].sort(),
        colliders: objectArray(raw.colliders, `${path}.colliders`).map((collider, index) =>
            normalizeCollider(collider, `${path}.colliders[${index}]`)
        ),
        storage:
            storageRaw === undefined || storageRaw === null
                ? null
                : normalizeStorage(asObject(storageRaw, `${path}.storage`), `${path}.storage`),
        temperatureEmitters: objectArray(raw.temperatureEmitters, `${path}.temperatureEmitters`).map(
            (emitter, index) => normalizeEmitter(emitter, `${path}.temperatureEmitters[${index}]`)
        ),
        interactionPoints: objectArray(raw.interactionPoints, `${path}.interactionPoints`).map(
            (point, index) => normalizeInteractionPoint(point, `${path}.interactionPoints[${index}]`)
        ),
        visuals: normalizeSceneVisuals(raw.visuals, `${path}.visuals`, assets, integrity),
    };
    return BuildableSchema.assert(buildable);
}

function normalizeStorage(raw: JsonObject, path: string): BuildableStorage {
    return {
        name: stringField(raw, 'name', path),
        subtitle: stringField(raw, 'subtitle', path),
        slotCount: numberField(raw, 'slotCount', path),
        displayRowCount: numberField(raw, 'displayRowCount', path),
        slotsAreFilterable: booleanField(raw, 'slotsAreFilterable', path),
        maxAccessDistance: numberField(raw, 'maxAccessDistance', path),
        transform: normalizeTransform(raw.transform, `${path}.transform`),
    };
}

function normalizeEmitter(raw: JsonObject, path: string): TemperatureEmitter {
    return {
        temperature: numberField(raw, 'temperature', path),
        range: numberField(raw, 'range', path),
        emissionPoint: vector3(raw.emissionPoint, `${path}.emissionPoint`),
    };
}

function normalizeInteractionPoint(raw: JsonObject, path: string): InteractionPoint {
    return {
        componentType: stringField(raw, 'componentType', path),
        member: stringField(raw, 'member', path),
        role: stringField(raw, 'role', path),
        transform: normalizeTransform(raw.transform, `${path}.transform`),
    };
}

function validateFootprint(
    itemId: string,
    width: number | null,
    height: number | null,
    tiles: readonly { readonly x: number; readonly y: number }[],
    integrity: Integrity
): void {
    if ((width === null) !== (height === null)) {
        integrity.addError(`Buildable ${JSON.stringify(itemId)} has an incomplete footprint size`);
    }
    if (width !== null && height !== null) {
        integrity.check(
            `buildable ${itemId} has positive footprint dimensions`,
            width > 0 && height > 0,
            `Buildable ${JSON.stringify(itemId)} has non-positive footprint dimensions`
        );
        integrity.check(
            `buildable ${itemId} footprint dimensions match its tiles`,
            tiles.length === width * height,
            `Buildable ${JSON.stringify(itemId)} footprint dimensions do not match its ${tiles.length} tiles`
        );
        integrity.check(
            `buildable ${itemId} footprint tiles are within its dimensions`,
            tiles.every((tile) => tile.x >= 0 && tile.y >= 0 && tile.x < width && tile.y < height),
            `Buildable ${JSON.stringify(itemId)} has footprint tiles outside its dimensions`
        );
    }
    const coordinates = new Set(tiles.map((tile) => `${tile.x},${tile.y}`));
    integrity.check(
        `buildable ${itemId} footprint coordinates are unique`,
        coordinates.size === tiles.length,
        `Buildable ${JSON.stringify(itemId)} has duplicate footprint coordinates`
    );
}

function normalizeFootprintCoordinates<
    T extends {
        readonly x: number;
        readonly y: number;
        readonly transform: { readonly path: string };
    },
>(
    itemId: string,
    tiles: readonly T[],
    width: number | null,
    height: number | null,
    integrity: Integrity
): T[] {
    const exported = new Set(tiles.map((tile) => `${tile.x},${tile.y}`));
    if (exported.size === tiles.length) return [...tiles];
    if (width === null || height === null) return [...tiles];
    const recovered = tiles.map((tile) => {
        const match = /\[(\d+),(\d+)\]$/.exec(tile.transform.path);
        return match === null ? null : { ...tile, x: Number(match[1]), y: Number(match[2]) };
    });
    const valid =
        recovered.every((tile) => tile !== null) &&
        recovered.every(
            (tile) => tile !== null && tile.x >= 0 && tile.y >= 0 && tile.x < width && tile.y < height
        );
    if (!valid) {
        integrity.addError(
            `Buildable ${JSON.stringify(itemId)} has duplicate footprint coordinates that cannot be recovered from transform paths`
        );
        return [...tiles];
    }
    return recovered as T[];
}

function nullableBoolean(raw: JsonObject, key: string, path: string): boolean | null {
    const value = raw[key];
    if (value === undefined || value === null) return null;
    if (typeof value !== 'boolean') throw new TypeError(`${path}.${key} must be a boolean or null`);
    return value;
}
