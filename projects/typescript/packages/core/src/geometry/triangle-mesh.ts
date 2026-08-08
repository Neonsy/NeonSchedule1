import type { Vector3 } from '#core/data/common';
import type { ColliderWorldBasis, Transform, TriangleMesh } from '#core/data/geometry';

type WorldTransform = Pick<Transform, 'worldPosition'>;

const degeneracyToleranceSquared = 1e-20;

export function distanceFromPointToTriangleMesh(
    point: Vector3,
    transform: WorldTransform,
    basis: ColliderWorldBasis,
    mesh: TriangleMesh
): number {
    validateMesh(mesh);
    const worldVertices = mesh.vertices.map((vertex) =>
        worldPointFromBasis(transform, basis, vertex)
    );
    let minimum = Number.POSITIVE_INFINITY;
    for (let index = 0; index < mesh.triangles.length; index += 3) {
        const a = worldVertices[mesh.triangles[index]!]!;
        const b = worldVertices[mesh.triangles[index + 1]!]!;
        const c = worldVertices[mesh.triangles[index + 2]!]!;
        if (dot(cross(subtract(b, a), subtract(c, a)), cross(subtract(b, a), subtract(c, a))) <=
            degeneracyToleranceSquared) continue;
        minimum = Math.min(minimum, distanceFromPointToTriangle(point, a, b, c));
    }
    if (!Number.isFinite(minimum)) throw new RangeError('Triangle mesh has no non-degenerate triangles');
    return minimum;
}

export function worldPointFromBasis(
    transform: WorldTransform,
    basis: ColliderWorldBasis,
    localPoint: Vector3
): Vector3 {
    return add(
        transform.worldPosition,
        add(
            add(scale(basis.right, localPoint.x), scale(basis.up, localPoint.y)),
            scale(basis.forward, localPoint.z)
        )
    );
}

export function localPointFromBasis(
    transform: WorldTransform,
    basis: ColliderWorldBasis,
    worldPoint: Vector3
): Vector3 {
    const delta = subtract(worldPoint, transform.worldPosition);
    const determinant = dot(basis.right, cross(basis.up, basis.forward));
    if (!Number.isFinite(determinant) || Math.abs(determinant) <= Number.EPSILON) {
        throw new RangeError('Transform basis is degenerate');
    }
    return {
        x: dot(delta, cross(basis.up, basis.forward)) / determinant,
        y: dot(basis.right, cross(delta, basis.forward)) / determinant,
        z: dot(basis.right, cross(basis.up, delta)) / determinant,
    };
}

function distanceFromPointToTriangle(
    point: Vector3,
    a: Vector3,
    b: Vector3,
    c: Vector3
): number {
    const ab = subtract(b, a);
    const ac = subtract(c, a);
    const ap = subtract(point, a);
    const d1 = dot(ab, ap);
    const d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return length(ap);

    const bp = subtract(point, b);
    const d3 = dot(ab, bp);
    const d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return length(bp);

    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        return length(subtract(point, add(a, scale(ab, d1 / (d1 - d3)))));
    }

    const cp = subtract(point, c);
    const d5 = dot(ab, cp);
    const d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return length(cp);

    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        return length(subtract(point, add(a, scale(ac, d2 / (d2 - d6)))));
    }

    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
        const edge = subtract(c, b);
        const factor = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        return length(subtract(point, add(b, scale(edge, factor))));
    }

    const normal = cross(ab, ac);
    return Math.abs(dot(ap, normal)) / length(normal);
}

function validateMesh(mesh: TriangleMesh): void {
    if (mesh.vertices.length === 0 || mesh.triangles.length === 0 || mesh.triangles.length % 3 !== 0) {
        throw new TypeError('Triangle mesh must contain vertices and complete triangles');
    }
    if (mesh.triangles.some((index) =>
        !Number.isSafeInteger(index) || index < 0 || index >= mesh.vertices.length
    )) {
        throw new RangeError('Triangle mesh contains an invalid vertex index');
    }
}

function length(vector: Vector3): number {
    return Math.hypot(vector.x, vector.y, vector.z);
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
