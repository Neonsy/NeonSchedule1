import type {
    BlueprintProceduralGridPlacement,
    BlueprintProceduralTileReference,
} from '#core/data/blueprint';
import type { Buildable, ProceduralTile } from '#core/data/buildable';
import type { Vector3 } from '#core/data/common';
import type { Quaternion } from '#core/data/geometry';
import {
    multiplyQuaternions,
    quaternionFromUnityEuler,
    rotateVectorByQuaternion,
} from '#core/geometry/transform';
import type {
    BlueprintValidationIssue,
    ResolvedBlueprintProceduralGridPlacement,
} from '#core/blueprint/validation';

type ProceduralResolution =
    | {
        readonly placement: ResolvedBlueprintProceduralGridPlacement;
        readonly issues: readonly [];
    }
    | { readonly placement: null; readonly issues: readonly BlueprintValidationIssue[] };

export type ProceduralPlacementFrame =
    | {
        readonly space: 'world';
        readonly position: Vector3;
        readonly rotation: Quaternion;
    }
    | {
        readonly space: 'parent';
        readonly position: Vector3;
        readonly rotation: Quaternion;
    };

const positionTolerance = 1e-3;
const minimumRotationDot = 1 - 1e-8;

export function indexProceduralTiles(
    tiles: readonly ProceduralTile[],
    label: string
): ReadonlyMap<string, ProceduralTile> {
    const index = new Map<string, ProceduralTile>();
    for (const tile of tiles) {
        if (tile.id.trim().length === 0) throw new TypeError(`${label} contains a blank tile ID`);
        if (index.has(tile.id)) {
            throw new Error(`${label} contains duplicate tile ID ${JSON.stringify(tile.id)}`);
        }
        index.set(tile.id, tile);
    }
    return index;
}

export function resolveProceduralGridPlacement(
    placement: BlueprintProceduralGridPlacement,
    buildableByItemId: ReadonlyMap<string, Buildable>,
    tileById: ReadonlyMap<string, ProceduralTile>,
    frameSpace: 'world' | 'parent'
): ProceduralResolution {
    const buildable = buildableByItemId.get(placement.itemId);
    if (buildable === undefined) {
        return failed(
            'buildable-unavailable',
            `Placement ${JSON.stringify(placement.id)} references unavailable buildable ` +
                JSON.stringify(placement.itemId),
            placement
        );
    }
    if (buildable.placement.kind !== 'procedural-grid') {
        return failed(
            'placement-kind-incompatible',
            `Buildable ${JSON.stringify(placement.itemId)} uses ` +
                `${JSON.stringify(buildable.placement.kind)} placement, not procedural-grid placement`,
            placement
        );
    }
    const tileType = buildable.placement.proceduralTileType;
    if (tileType === null || tileType.trim().length === 0) {
        return failed(
            'procedural-tile-type-incompatible',
            `Buildable ${JSON.stringify(placement.itemId)} has no procedural tile type`,
            placement
        );
    }

    const unavailable = placement.tiles
        .filter((reference) => !tileById.has(reference.tileId))
        .map((reference) => reference.tileId)
        .sort();
    if (unavailable.length > 0) {
        return failed(
            'procedural-tile-unavailable',
            `Placement ${JSON.stringify(placement.id)} references unavailable procedural tiles`,
            placement,
            unavailable
        );
    }
    const incompatible = placement.tiles
        .filter((reference) => tileById.get(reference.tileId)!.type !== tileType)
        .map((reference) => reference.tileId)
        .sort();
    if (incompatible.length > 0) {
        return failed(
            'procedural-tile-type-incompatible',
            `Placement ${JSON.stringify(placement.id)} requires procedural tile type ` +
                JSON.stringify(tileType),
            placement,
            incompatible
        );
    }

    const footprint = indexedFootprint(buildable);
    if (!matchesFootprint(placement.tiles, footprint)) {
        return failed(
            'procedural-footprint-incompatible',
            `Placement ${JSON.stringify(placement.id)} does not map its complete footprint`,
            placement
        );
    }
    const frame = placementFrame(placement.tiles, footprint, tileById, frameSpace);
    if (frame === null) {
        return failed(
            'procedural-footprint-incompatible',
            `Placement ${JSON.stringify(placement.id)} does not map to one rigid procedural-grid transform`,
            placement,
            placement.tiles.map((reference) => reference.tileId).sort()
        );
    }
    return {
        placement: {
            id: placement.id,
            kind: 'procedural-grid',
            itemId: placement.itemId,
            parentPlacementId: placement.parentPlacementId,
            tileType,
            tiles: sortedReferences(placement.tiles),
            frame,
        },
        issues: [],
    };
}

export function proceduralTileSharingIssues(
    placements: readonly ResolvedBlueprintProceduralGridPlacement[]
): BlueprintValidationIssue[] {
    const occupants = new Map<string, {
        readonly tileId: string;
        readonly placementIds: string[];
    }>();
    for (const placement of placements) {
        const source = placement.parentPlacementId === null
            ? ['property']
            : ['placement', placement.parentPlacementId];
        for (const tile of placement.tiles) {
            const key = JSON.stringify([...source, tile.tileId]);
            const entry = occupants.get(key);
            if (entry === undefined) {
                occupants.set(key, { tileId: tile.tileId, placementIds: [placement.id] });
            } else {
                entry.placementIds.push(placement.id);
            }
        }
    }
    return [...occupants.values()]
        .filter((entry) => entry.placementIds.length > 1)
        .map((entry) => ({
            code: 'procedural-tile-sharing-incompatible' as const,
            message: `Placements ${entry.placementIds.map((id) => JSON.stringify(id)).join(', ')} ` +
                `cannot share procedural tile ${JSON.stringify(entry.tileId)}`,
            placementIds: entry.placementIds.sort(),
            gridId: null,
            tiles: [],
            proceduralTileIds: [entry.tileId],
        }))
        .sort((left, right) =>
            left.proceduralTileIds[0]!.localeCompare(right.proceduralTileIds[0]!) ||
            left.placementIds[0]!.localeCompare(right.placementIds[0]!)
        );
}

function indexedFootprint(
    buildable: Buildable
): ReadonlyMap<string, Buildable['placement']['footprintTiles'][number]> {
    const width = buildable.placement.footprintWidth;
    const height = buildable.placement.footprintHeight;
    if (
        width === null || height === null || !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) || width < 1 || height < 1
    ) {
        throw new RangeError(
            `Procedural-grid buildable ${JSON.stringify(buildable.itemId)} has invalid footprint dimensions`
        );
    }
    const index = new Map<string, Buildable['placement']['footprintTiles'][number]>();
    for (const tile of buildable.placement.footprintTiles) {
        if (
            !Number.isSafeInteger(tile.x) || !Number.isSafeInteger(tile.y) ||
            tile.x < 0 || tile.y < 0 || tile.x >= width || tile.y >= height
        ) {
            throw new RangeError(
                `Procedural-grid buildable ${JSON.stringify(buildable.itemId)} has an invalid footprint tile`
            );
        }
        const key = coordinateKey(tile);
        if (index.has(key)) {
            throw new Error(
                `Procedural-grid buildable ${JSON.stringify(buildable.itemId)} has duplicate footprint tiles`
            );
        }
        index.set(key, tile);
    }
    if (index.size !== width * height) {
        throw new Error(
            `Procedural-grid buildable ${JSON.stringify(buildable.itemId)} footprint is incomplete`
        );
    }
    return index;
}

function matchesFootprint(
    references: readonly BlueprintProceduralTileReference[],
    footprint: ReadonlyMap<string, Buildable['placement']['footprintTiles'][number]>
): boolean {
    return references.length === footprint.size &&
        references.every((reference) => footprint.has(coordinateKey(reference)));
}

function placementFrame(
    references: readonly BlueprintProceduralTileReference[],
    footprint: ReadonlyMap<string, Buildable['placement']['footprintTiles'][number]>,
    tileById: ReadonlyMap<string, ProceduralTile>,
    frameSpace: 'world' | 'parent'
): ProceduralPlacementFrame | null {
    const frames = references.map((reference) => {
        const source = footprint.get(coordinateKey(reference))!.transform;
        const target = tileById.get(reference.tileId)!.transform;
        const sourceRotation = quaternionFromUnityEuler(source.worldRotation);
        const targetRotation = quaternionFromUnityEuler(target.worldRotation);
        const rotation = multiplyQuaternions(targetRotation, inverse(sourceRotation));
        const position = subtract(
            target.worldPosition,
            rotateVectorByQuaternion(rotation, source.worldPosition)
        );
        return {
            position,
            rotation,
            scaleCompatible: distance(source.localScale, target.localScale) <= positionTolerance,
        };
    });
    const first = frames[0];
    if (first === undefined || frames.some((candidate) =>
        !candidate.scaleCompatible ||
        distance(candidate.position, first.position) > positionTolerance ||
        Math.abs(quaternionDot(candidate.rotation, first.rotation)) < minimumRotationDot
    )) return null;
    const frame = { position: first.position, rotation: first.rotation };
    return frameSpace === 'world'
        ? { space: 'world', ...frame }
        : { space: 'parent', ...frame };
}

function failed(
    code: BlueprintValidationIssue['code'],
    message: string,
    placement: BlueprintProceduralGridPlacement,
    proceduralTileIds: readonly string[] = []
): ProceduralResolution {
    return {
        placement: null,
        issues: [{
            code,
            message,
            placementIds: [placement.id],
            gridId: null,
            tiles: [],
            ...(proceduralTileIds.length === 0 ? {} : { proceduralTileIds }),
        }],
    };
}

function sortedReferences(
    references: readonly BlueprintProceduralTileReference[]
): BlueprintProceduralTileReference[] {
    return [...references].sort((left, right) =>
        left.x - right.x || left.y - right.y || left.tileId.localeCompare(right.tileId)
    );
}

function coordinateKey(coordinate: { readonly x: number; readonly y: number }): string {
    return `${coordinate.x},${coordinate.y}`;
}

function inverse(rotation: Quaternion): Quaternion {
    return { x: -rotation.x, y: -rotation.y, z: -rotation.z, w: rotation.w };
}

function quaternionDot(left: Quaternion, right: Quaternion): number {
    return left.x * right.x + left.y * right.y + left.z * right.z + left.w * right.w;
}

function distance(left: Vector3, right: Vector3): number {
    return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function subtract(left: Vector3, right: Vector3): Vector3 {
    return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}
