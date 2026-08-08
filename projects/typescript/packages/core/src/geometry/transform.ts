import { type Vector3 } from '#core/data/common';
import { type Quaternion, type Transform } from '#core/data/geometry';

export function transformPoint(transform: Transform, localPoint: Vector3): Vector3 {
    return add(
        transform.worldPosition,
        rotateVectorByQuaternion(
            quaternionFromUnityEuler(transform.worldRotation),
            multiplyComponents(localPoint, transform.localScale)
        )
    );
}

export function quaternionFromUnityEuler(rotation: Vector3): Quaternion {
    const x = axisQuaternion('x', rotation.x);
    const y = axisQuaternion('y', rotation.y);
    const z = axisQuaternion('z', rotation.z);
    return multiplyQuaternions(multiplyQuaternions(y, x), z);
}

export function axisQuaternion(axis: 'x' | 'y' | 'z', degrees: number): Quaternion {
    const halfRadians = degrees * Math.PI / 360;
    const sine = Math.sin(halfRadians);
    const cosine = Math.cos(halfRadians);
    return canonicalQuaternion({
        x: axis === 'x' ? sine : 0,
        y: axis === 'y' ? sine : 0,
        z: axis === 'z' ? sine : 0,
        w: cosine,
    });
}

export function multiplyQuaternions(left: Quaternion, right: Quaternion): Quaternion {
    return canonicalQuaternion({
        x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
        y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
        z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
        w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
    });
}

export function rotateVectorByQuaternion(rotation: Quaternion, vector: Vector3): Vector3 {
    const pure = { x: vector.x, y: vector.y, z: vector.z, w: 0 };
    const inverse = { x: -rotation.x, y: -rotation.y, z: -rotation.z, w: rotation.w };
    const rotated = rawMultiply(rawMultiply(rotation, pure), inverse);
    return {
        x: normalizeZero(rotated.x),
        y: normalizeZero(rotated.y),
        z: normalizeZero(rotated.z),
    };
}

export function canonicalQuaternion(input: Quaternion): Quaternion {
    const length = Math.hypot(input.x, input.y, input.z, input.w);
    if (!Number.isFinite(length) || length === 0) {
        throw new TypeError('Quaternion must have a finite non-zero length');
    }
    const sign = input.w < 0 ? -1 : 1;
    return {
        x: normalizeZero(sign * input.x / length),
        y: normalizeZero(sign * input.y / length),
        z: normalizeZero(sign * input.z / length),
        w: normalizeZero(sign * input.w / length),
    };
}

function rawMultiply(left: Quaternion, right: Quaternion): Quaternion {
    return {
        x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
        y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
        z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
        w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
    };
}

function add(left: Vector3, right: Vector3): Vector3 {
    return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

function multiplyComponents(left: Vector3, right: Vector3): Vector3 {
    return { x: left.x * right.x, y: left.y * right.y, z: left.z * right.z };
}

function normalizeZero(value: number): number {
    return Math.abs(value) <= Number.EPSILON ? 0 : value;
}
