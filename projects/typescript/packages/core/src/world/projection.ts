import type { Vector2, Vector3 } from '#core/data/common';
import type { MapImage, MapProjectionCalibration } from '#core/data/world';

type MapPixelDimensions = Pick<MapImage, 'width' | 'height'>;

export function projectWorldToMapPixel(
    position: Vector3,
    calibration: MapProjectionCalibration,
    image: MapPixelDimensions
): Vector2 {
    requirePositive(calibration.mapDimensions, 'Map dimensions');
    requirePositive(calibration.conversionFactor, 'Map conversion factor');
    requirePositive(image.width, 'Map image width');
    requirePositive(image.height, 'Map image height');

    const edgeDeltaX = calibration.origin.x - calibration.edge.x;
    const edgeDeltaZ = calibration.origin.z - calibration.edge.z;
    const edgeDistance = Math.hypot(edgeDeltaX, edgeDeltaZ);
    requirePositive(edgeDistance, 'Map origin-to-edge distance');

    const verticalX = edgeDeltaX / edgeDistance;
    const verticalZ = edgeDeltaZ / edgeDistance;
    const horizontalX = verticalZ;
    const horizontalZ = -verticalX;
    const worldDeltaX = position.x - calibration.origin.x;
    const worldDeltaZ = position.z - calibration.origin.z;
    const mapX = (worldDeltaX * horizontalX + worldDeltaZ * horizontalZ) *
        calibration.conversionFactor;
    const mapY = (worldDeltaX * verticalX + worldDeltaZ * verticalZ) *
        calibration.conversionFactor;

    return {
        x: image.width / 2 + mapX * image.width / calibration.mapDimensions,
        y: image.height / 2 - mapY * image.height / calibration.mapDimensions,
    };
}

function requirePositive(value: number, label: string): void {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${label} must be a positive finite number`);
    }
}
