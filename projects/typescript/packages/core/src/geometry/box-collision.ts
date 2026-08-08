import { type Vector3 } from '#core/data/common';
import { type Collider, type ColliderWorldBasis } from '#core/data/geometry';

export interface WorldBox {
    readonly center: Vector3;
    readonly halfAxes: readonly [Vector3, Vector3, Vector3];
}

type BoxColliderGeometry = Pick<
    Collider,
    'localCenter' | 'localSize' | 'shape' | 'worldBasis'
> & {
    readonly transform: { readonly worldPosition: Vector3 };
};

const axisToleranceSquared = 1e-20;
const contactTolerance = 1e-9;
const coordinateTolerance = 1e-10;

export function worldBoxFromCollider(collider: BoxColliderGeometry): WorldBox {
    if (collider.shape !== 'box' || collider.localCenter === null || collider.localSize === null) {
        throw new TypeError('World-box construction requires box-collider geometry');
    }

    const halfAxes: WorldBox['halfAxes'] = [
        scale(collider.worldBasis.right, Math.abs(collider.localSize.x) / 2),
        scale(collider.worldBasis.up, Math.abs(collider.localSize.y) / 2),
        scale(collider.worldBasis.forward, Math.abs(collider.localSize.z) / 2),
    ];
    requireVolume(halfAxes);
    return {
        center: add(
            collider.transform.worldPosition,
            transformVector(collider.worldBasis, collider.localCenter)
        ),
        halfAxes,
    };
}

export function worldBoxesOverlap(
    left: WorldBox,
    right: WorldBox,
    clearance = 0
): boolean {
    if (!Number.isFinite(clearance) || clearance < 0) {
        throw new RangeError('Box clearance must be a finite non-negative number');
    }
    requireVolume(left.halfAxes);
    requireVolume(right.halfAxes);

    const centerDelta = subtract(right.center, left.center);
    for (const axis of separatingAxes(left, right)) {
        const lengthSquared = dot(axis, axis);
        if (lengthSquared <= axisToleranceSquared) continue;
        const unitAxis = scale(axis, 1 / Math.sqrt(lengthSquared));
        const centerDistance = Math.abs(dot(centerDelta, unitAxis));
        const requiredDistance =
            projectedRadius(left, unitAxis) + projectedRadius(right, unitAxis) + clearance;
        if (centerDistance >= requiredDistance - contactTolerance) return false;
    }
    return true;
}

export function distanceFromPointToWorldBox(point: Vector3, box: WorldBox): number {
    requireFiniteVector(point, 'Point');
    requireVolume(box.halfAxes);

    const offset = subtract(point, box.center);
    let minimumSquared = Number.POSITIVE_INFINITY;
    for (let state = 0; state < 27; state++) {
        const coordinates: [number, number, number] = [0, 0, 0];
        const free: number[] = [];
        let code = state;
        let remainder = offset;
        for (let axisIndex = 0; axisIndex < 3; axisIndex++) {
            const condition = code % 3;
            code = Math.floor(code / 3);
            if (condition === 1) {
                free.push(axisIndex);
                continue;
            }
            const coordinate = condition === 0 ? -1 : 1;
            coordinates[axisIndex] = coordinate;
            remainder = subtract(remainder, scale(box.halfAxes[axisIndex]!, coordinate));
        }

        const solution = solveFreeCoordinates(box.halfAxes, free, remainder);
        if (solution === null) continue;
        let valid = true;
        free.forEach((axisIndex, index) => {
            const coordinate = solution[index]!;
            if (coordinate < -1 - coordinateTolerance || coordinate > 1 + coordinateTolerance) {
                valid = false;
                return;
            }
            coordinates[axisIndex] = Math.max(-1, Math.min(1, coordinate));
        });
        if (!valid) continue;

        const closestOffset = box.halfAxes.reduce(
            (sum, axis, axisIndex) => add(sum, scale(axis, coordinates[axisIndex]!)),
            { x: 0, y: 0, z: 0 }
        );
        minimumSquared = Math.min(
            minimumSquared,
            dot(subtract(offset, closestOffset), subtract(offset, closestOffset))
        );
    }
    return minimumSquared <= contactTolerance * contactTolerance ? 0 : Math.sqrt(minimumSquared);
}

function solveFreeCoordinates(
    axes: WorldBox['halfAxes'],
    free: readonly number[],
    target: Vector3
): number[] | null {
    if (free.length === 0) return [];
    const matrix = free.map((rowAxis) => [
        ...free.map((columnAxis) => dot(axes[rowAxis]!, axes[columnAxis]!)),
        dot(axes[rowAxis]!, target),
    ]);
    for (let pivot = 0; pivot < free.length; pivot++) {
        let best = pivot;
        for (let row = pivot + 1; row < free.length; row++) {
            if (Math.abs(matrix[row]![pivot]!) > Math.abs(matrix[best]![pivot]!)) best = row;
        }
        [matrix[pivot], matrix[best]] = [matrix[best]!, matrix[pivot]!];
        const divisor = matrix[pivot]![pivot]!;
        if (!Number.isFinite(divisor) || Math.abs(divisor) <= axisToleranceSquared) return null;
        for (let column = pivot; column <= free.length; column++) {
            matrix[pivot]![column] = matrix[pivot]![column]! / divisor;
        }
        for (let row = 0; row < free.length; row++) {
            if (row === pivot) continue;
            const factor = matrix[row]![pivot]!;
            for (let column = pivot; column <= free.length; column++) {
                matrix[row]![column] = matrix[row]![column]! - factor * matrix[pivot]![column]!;
            }
        }
    }
    return matrix.map((row) => row[free.length]!);
}

function separatingAxes(left: WorldBox, right: WorldBox): Vector3[] {
    const axes = [
        ...faceNormals(left.halfAxes),
        ...faceNormals(right.halfAxes),
    ];
    for (const leftAxis of left.halfAxes) {
        for (const rightAxis of right.halfAxes) axes.push(cross(leftAxis, rightAxis));
    }
    return axes;
}

function faceNormals(halfAxes: WorldBox['halfAxes']): Vector3[] {
    return [
        cross(halfAxes[1], halfAxes[2]),
        cross(halfAxes[2], halfAxes[0]),
        cross(halfAxes[0], halfAxes[1]),
    ];
}

function projectedRadius(box: WorldBox, axis: Vector3): number {
    return box.halfAxes.reduce((radius, halfAxis) =>
        radius + Math.abs(dot(halfAxis, axis)), 0
    );
}

function requireVolume(halfAxes: WorldBox['halfAxes']): void {
    halfAxes.forEach((axis) => requireFiniteVector(axis, 'World-box half-axis'));
    const determinant = dot(halfAxes[0], cross(halfAxes[1], halfAxes[2]));
    if (!Number.isFinite(determinant) || Math.abs(determinant) <= axisToleranceSquared) {
        throw new RangeError('World box must have three independent non-zero half-axes');
    }
}

function requireFiniteVector(vector: Vector3, label: string): void {
    if (![vector.x, vector.y, vector.z].every(Number.isFinite)) {
        throw new TypeError(`${label} must contain finite coordinates`);
    }
}

function transformVector(basis: ColliderWorldBasis, vector: Vector3): Vector3 {
    return add(
        add(scale(basis.right, vector.x), scale(basis.up, vector.y)),
        scale(basis.forward, vector.z)
    );
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

function cross(left: Vector3, right: Vector3): Vector3 {
    return {
        x: left.y * right.z - left.z * right.y,
        y: left.z * right.x - left.x * right.z,
        z: left.x * right.y - left.y * right.x,
    };
}
