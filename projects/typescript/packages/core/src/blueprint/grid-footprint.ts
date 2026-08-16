import type { BlueprintGridRotation } from '#core/data/blueprint';
import type { Buildable } from '#core/data/buildable';

export interface RotatedCornerDirection {
    readonly x: -1 | 1;
    readonly y: -1 | 1;
}

export interface RotatedFootprintTile {
    readonly x: number;
    readonly y: number;
    readonly requiredOffset: number;
    readonly cornerDirections: readonly RotatedCornerDirection[];
}

export function rotateGridOffset(
    coordinate: { readonly x: number; readonly y: number },
    rotation: BlueprintGridRotation
): { readonly x: number; readonly y: number } {
    if (rotation === 0) return coordinate;
    if (rotation === 90) return { x: coordinate.y, y: -coordinate.x };
    if (rotation === 180) return { x: -coordinate.x, y: -coordinate.y };
    return { x: -coordinate.y, y: coordinate.x };
}

export function rotateFootprint(
    footprint: readonly Buildable['placement']['footprintTiles'][number][],
    rotation: BlueprintGridRotation
): readonly RotatedFootprintTile[] {
    const maximumX = Math.max(...footprint.map((tile) => tile.x));
    const maximumY = Math.max(...footprint.map((tile) => tile.y));
    return footprint.map((tile) => {
        const coordinate = rotateCoordinate(tile.x, tile.y, maximumX, maximumY, rotation);
        return {
            ...coordinate,
            requiredOffset: tile.requiredOffset,
            cornerDirections: tile.cornerObstacles
                .filter((corner) => corner.enabled)
                .map((corner) => rotateDirection(
                    axisDirection(corner.transform.localPosition.x, corner.transform.path, 'X'),
                    axisDirection(corner.transform.localPosition.z, corner.transform.path, 'Z'),
                    rotation
                )),
        };
    });
}

function rotateCoordinate(
    x: number,
    y: number,
    maximumX: number,
    maximumY: number,
    rotation: BlueprintGridRotation
): { readonly x: number; readonly y: number } {
    if (rotation === 0) return { x, y };
    if (rotation === 90) return { x: maximumY - y, y: x };
    if (rotation === 180) return { x: maximumX - x, y: maximumY - y };
    return { x: y, y: maximumX - x };
}

function rotateDirection(
    x: -1 | 1,
    y: -1 | 1,
    rotation: BlueprintGridRotation
): RotatedCornerDirection {
    if (rotation === 0) return { x, y };
    if (rotation === 90) return { x: negate(y), y: x };
    if (rotation === 180) return { x: negate(x), y: negate(y) };
    return { x: y, y: negate(x) };
}

function axisDirection(value: number, path: string, axis: string): -1 | 1 {
    if (!Number.isFinite(value) || value === 0) {
        throw new Error(`Corner obstacle ${JSON.stringify(path)} has no finite local ${axis} direction`);
    }
    return value < 0 ? -1 : 1;
}

function negate(value: -1 | 1): -1 | 1 {
    return value === 1 ? -1 : 1;
}
