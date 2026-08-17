import type { Vector3 } from '#core/data/common';
import type { Collider } from '#core/data/geometry';
import type { ProjectedBlueprintPlacement } from '#core/blueprint/projection';
import type { WorldBox } from '#core/geometry/box-collision';
import { rotateVectorByQuaternion } from '#core/geometry/transform';

interface Point2 {
    readonly x: number;
    readonly y: number;
}

interface UprightBox {
    readonly center: Vector3;
    readonly horizontalAxes: readonly [
        { readonly direction: Vector3; readonly halfLength: number },
        { readonly direction: Vector3; readonly halfLength: number },
    ];
    readonly bottom: number;
    readonly top: number;
}

const orientationTolerance = 1e-6;
const contactTolerance = 1e-5;

export function sweptUprightAgentEnvelope(
    start: Vector3,
    end: Vector3,
    radius: number,
    height: number
): WorldBox {
    requireAgentSweep(start, end, radius, height);
    const horizontal = { x: end.x - start.x, y: 0, z: end.z - start.z };
    const horizontalDistance = Math.hypot(horizontal.x, horizontal.z);
    const forward = horizontalDistance === 0
        ? { x: 1, y: 0, z: 0 }
        : scale(horizontal, 1 / horizontalDistance);
    const right = { x: -forward.z, y: 0, z: forward.x };
    return {
        center: {
            x: (start.x + end.x) / 2,
            y: (start.y + end.y + height) / 2,
            z: (start.z + end.z) / 2,
        },
        halfAxes: [
            scale(forward, horizontalDistance / 2 + radius),
            { x: 0, y: (Math.abs(end.y - start.y) + height) / 2, z: 0 },
            scale(right, radius),
        ],
    };
}

export function sweptUprightCylinderOverlapsBox(
    start: Vector3,
    end: Vector3,
    radius: number,
    height: number,
    box: WorldBox
): boolean | null {
    requireAgentSweep(start, end, radius, height);
    const upright = asUprightBox(box);
    if (upright === null) return null;

    const verticalInterval = verticalOverlapInterval(start.y, end.y, height, upright);
    if (verticalInterval === null) return false;
    const horizontalStart = boxCoordinates(
        interpolate(start, end, verticalInterval.start),
        upright
    );
    const horizontalEnd = boxCoordinates(
        interpolate(start, end, verticalInterval.end),
        upright
    );
    const distance = distanceFromSegmentToRectangle(
        horizontalStart,
        horizontalEnd,
        upright.horizontalAxes[0].halfLength,
        upright.horizontalAxes[1].halfLength
    );
    return distance < radius - contactTolerance;
}

export function isWorldBoxSupportContact(envelope: WorldBox, obstacle: WorldBox): boolean {
    const envelopeBottom = envelope.center.y - projectedWorldYRadius(envelope);
    const obstacleTop = obstacle.center.y + projectedWorldYRadius(obstacle);
    return obstacleTop <= envelopeBottom + contactTolerance;
}

export function projectSourceBounds(
    bounds: Collider['worldBounds'],
    root: ProjectedBlueprintPlacement['root']
): WorldBox | null {
    const halfSize = validHalfSize(bounds);
    if (halfSize === null) return null;
    return {
        center: add(root.worldPosition, rotateVectorByQuaternion(root.worldRotation, bounds.center)),
        halfAxes: [
            rotateVectorByQuaternion(root.worldRotation, { x: halfSize.x, y: 0, z: 0 }),
            rotateVectorByQuaternion(root.worldRotation, { x: 0, y: halfSize.y, z: 0 }),
            rotateVectorByQuaternion(root.worldRotation, { x: 0, y: 0, z: halfSize.z }),
        ],
    };
}

export function axisAlignedBoundsBox(bounds: Collider['worldBounds']): WorldBox | null {
    const halfSize = validHalfSize(bounds);
    if (halfSize === null) return null;
    return {
        center: copy(bounds.center),
        halfAxes: [
            { x: halfSize.x, y: 0, z: 0 },
            { x: 0, y: halfSize.y, z: 0 },
            { x: 0, y: 0, z: halfSize.z },
        ],
    };
}

function asUprightBox(box: WorldBox): UprightBox | null {
    const axes = box.halfAxes.map((axis) => {
        const length = Math.hypot(axis.x, axis.y, axis.z);
        return {
            direction: scale(axis, 1 / length),
            halfLength: length,
        };
    });
    if (axes.some((axis) =>
        !Number.isFinite(axis.halfLength) || axis.halfLength <= 0 ||
        !isFinitePosition(axis.direction)
    )) return null;
    const verticalIndexes = axes.flatMap((axis, index) =>
        Math.abs(Math.abs(axis.direction.y) - 1) <= orientationTolerance ? [index] : []
    );
    if (verticalIndexes.length !== 1) return null;
    const verticalIndex = verticalIndexes[0]!;
    const horizontalAxes = axes.filter((_, index) => index !== verticalIndex);
    if (horizontalAxes.length !== 2 || horizontalAxes.some((axis) =>
        Math.abs(axis.direction.y) > orientationTolerance
    )) return null;
    if (Math.abs(dot(horizontalAxes[0]!.direction, horizontalAxes[1]!.direction)) >
        orientationTolerance) return null;
    const verticalHalfLength = axes[verticalIndex]!.halfLength;
    return {
        center: copy(box.center),
        horizontalAxes: [horizontalAxes[0]!, horizontalAxes[1]!],
        bottom: box.center.y - verticalHalfLength,
        top: box.center.y + verticalHalfLength,
    };
}

function verticalOverlapInterval(
    startY: number,
    endY: number,
    height: number,
    box: UprightBox
): { readonly start: number; readonly end: number } | null {
    const minimumBottom = box.bottom - height + contactTolerance;
    const maximumBottom = box.top - contactTolerance;
    const delta = endY - startY;
    if (Math.abs(delta) <= contactTolerance) {
        return startY > minimumBottom && startY < maximumBottom
            ? { start: 0, end: 1 }
            : null;
    }
    const first = (minimumBottom - startY) / delta;
    const second = (maximumBottom - startY) / delta;
    const intervalStart = Math.max(0, Math.min(first, second));
    const intervalEnd = Math.min(1, Math.max(first, second));
    return intervalStart < intervalEnd
        ? { start: intervalStart, end: intervalEnd }
        : null;
}

function boxCoordinates(point: Vector3, box: UprightBox): Point2 {
    const offset = subtract(point, box.center);
    return {
        x: dot(offset, box.horizontalAxes[0].direction),
        y: dot(offset, box.horizontalAxes[1].direction),
    };
}

function distanceFromSegmentToRectangle(
    start: Point2,
    end: Point2,
    halfWidth: number,
    halfHeight: number
): number {
    if (pointInsideRectangle(start, halfWidth, halfHeight) ||
        pointInsideRectangle(end, halfWidth, halfHeight)) return 0;
    const corners: readonly [Point2, Point2, Point2, Point2] = [
        { x: -halfWidth, y: -halfHeight },
        { x: halfWidth, y: -halfHeight },
        { x: halfWidth, y: halfHeight },
        { x: -halfWidth, y: halfHeight },
    ];
    return Math.min(
        distanceFromPointToRectangle(start, halfWidth, halfHeight),
        distanceFromPointToRectangle(end, halfWidth, halfHeight),
        ...corners.map((corner, index) =>
            distanceBetweenSegments(start, end, corner, corners[(index + 1) % corners.length]!)
        )
    );
}

function pointInsideRectangle(point: Point2, halfWidth: number, halfHeight: number): boolean {
    return Math.abs(point.x) < halfWidth && Math.abs(point.y) < halfHeight;
}

function distanceFromPointToRectangle(
    point: Point2,
    halfWidth: number,
    halfHeight: number
): number {
    return Math.hypot(
        Math.max(Math.abs(point.x) - halfWidth, 0),
        Math.max(Math.abs(point.y) - halfHeight, 0)
    );
}

function distanceBetweenSegments(
    firstStart: Point2,
    firstEnd: Point2,
    secondStart: Point2,
    secondEnd: Point2
): number {
    if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) return 0;
    return Math.min(
        distanceFromPointToSegment(firstStart, secondStart, secondEnd),
        distanceFromPointToSegment(firstEnd, secondStart, secondEnd),
        distanceFromPointToSegment(secondStart, firstStart, firstEnd),
        distanceFromPointToSegment(secondEnd, firstStart, firstEnd)
    );
}

function segmentsIntersect(
    firstStart: Point2,
    firstEnd: Point2,
    secondStart: Point2,
    secondEnd: Point2
): boolean {
    const firstDirection = subtract2(firstEnd, firstStart);
    const secondDirection = subtract2(secondEnd, secondStart);
    const denominator = cross2(firstDirection, secondDirection);
    const offset = subtract2(secondStart, firstStart);
    if (Math.abs(denominator) <= contactTolerance) {
        if (Math.abs(cross2(offset, firstDirection)) > contactTolerance) return false;
        const firstLengthSquared = dot2(firstDirection, firstDirection);
        if (firstLengthSquared <= contactTolerance * contactTolerance) {
            return distanceFromPointToSegment(firstStart, secondStart, secondEnd) <=
                contactTolerance;
        }
        const startParameter = dot2(offset, firstDirection) / firstLengthSquared;
        const endParameter = startParameter +
            dot2(secondDirection, firstDirection) / firstLengthSquared;
        return Math.max(Math.min(startParameter, endParameter), 0) <=
            Math.min(Math.max(startParameter, endParameter), 1) + contactTolerance;
    }
    const firstParameter = cross2(offset, secondDirection) / denominator;
    const secondParameter = cross2(offset, firstDirection) / denominator;
    return firstParameter >= -contactTolerance && firstParameter <= 1 + contactTolerance &&
        secondParameter >= -contactTolerance && secondParameter <= 1 + contactTolerance;
}

function distanceFromPointToSegment(point: Point2, start: Point2, end: Point2): number {
    const segment = subtract2(end, start);
    const lengthSquared = dot2(segment, segment);
    if (lengthSquared <= contactTolerance * contactTolerance) {
        return Math.hypot(point.x - start.x, point.y - start.y);
    }
    const parameter = Math.max(0, Math.min(1,
        dot2(subtract2(point, start), segment) / lengthSquared
    ));
    const closest = {
        x: start.x + segment.x * parameter,
        y: start.y + segment.y * parameter,
    };
    return Math.hypot(point.x - closest.x, point.y - closest.y);
}

function validHalfSize(bounds: Collider['worldBounds']): Vector3 | null {
    const halfSize = {
        x: Math.abs(bounds.size.x) / 2,
        y: Math.abs(bounds.size.y) / 2,
        z: Math.abs(bounds.size.z) / 2,
    };
    return [halfSize.x, halfSize.y, halfSize.z].every((value) =>
        Number.isFinite(value) && value > 0
    ) ? halfSize : null;
}

function projectedWorldYRadius(box: WorldBox): number {
    return box.halfAxes.reduce((sum, axis) => sum + Math.abs(axis.y), 0);
}

function requireAgentSweep(
    start: Vector3,
    end: Vector3,
    radius: number,
    height: number
): void {
    if (!isFinitePosition(start) || !isFinitePosition(end)) {
        throw new TypeError('Movement feasibility segment coordinates must be finite');
    }
    if (!Number.isFinite(radius) || radius <= 0) {
        throw new RangeError('Movement feasibility employee radius must be positive and finite');
    }
    if (!Number.isFinite(height) || height <= 0) {
        throw new RangeError('Movement feasibility employee height must be positive and finite');
    }
}

function isFinitePosition(position: Vector3): boolean {
    return [position.x, position.y, position.z].every(Number.isFinite);
}

function interpolate(start: Vector3, end: Vector3, parameter: number): Vector3 {
    return {
        x: start.x + (end.x - start.x) * parameter,
        y: start.y + (end.y - start.y) * parameter,
        z: start.z + (end.z - start.z) * parameter,
    };
}

function copy(position: Vector3): Vector3 {
    return { x: position.x, y: position.y, z: position.z };
}

function add(left: Vector3, right: Vector3): Vector3 {
    return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

function subtract(left: Vector3, right: Vector3): Vector3 {
    return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function scale(vector: Vector3, factor: number): Vector3 {
    return { x: vector.x * factor, y: vector.y * factor, z: vector.z * factor };
}

function dot(left: Vector3, right: Vector3): number {
    return left.x * right.x + left.y * right.y + left.z * right.z;
}

function subtract2(left: Point2, right: Point2): Point2 {
    return { x: left.x - right.x, y: left.y - right.y };
}

function dot2(left: Point2, right: Point2): number {
    return left.x * right.x + left.y * right.y;
}

function cross2(left: Point2, right: Point2): number {
    return left.x * right.y - left.y * right.x;
}
