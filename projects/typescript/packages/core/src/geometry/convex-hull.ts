import type { Vector3 } from '#core/data/common';
import type {
    ColliderWorldBasis,
    Transform,
    TriangleMesh,
} from '#core/data/geometry';
import {
    localPointFromBasis,
    worldNormalFromBasis,
} from '#core/geometry/triangle-mesh';
import {
    adjacentFaceIndex,
    compactFaces,
    directedEdgeIndex,
    faceDistance,
    hasRedundantNeighbour,
    mergeAdjacentFaces,
    mergedVertexIndices,
    polygonFace,
    removeCookedBevels,
    validateClosedHull,
    type ConvexHullFace,
    type HullTolerances,
} from '#core/geometry/convex-hull-merge';

export type { ConvexHullFace } from '#core/geometry/convex-hull-merge';

export interface ConvexHull {
    readonly meshId: string;
    readonly vertices: readonly Vector3[];
    readonly faces: readonly ConvexHullFace[];
    readonly bounds: TriangleMesh['bounds'];
}

interface Edge {
    readonly from: number;
    readonly to: number;
}

const floatEpsilon = 2 ** -23;
const physxPlaneTolerance = 7e-4;

export function convexHullFromTriangleMesh(source: TriangleMesh): ConvexHull {
    const points = uniqueFinitePoints(source.vertices);
    if (points.length < 4) throw new RangeError('Convex hull requires four distinct points');

    const tolerance = hullTolerances(points);
    const tetrahedron = initialTetrahedron(points, tolerance.face);
    const interior = average(tetrahedron.map((index) => points[index]!));
    const faces: (ConvexHullFace | null)[] = tetrahedronFaces(points, tetrahedron).map((indices) =>
        face(points, indices, interior, tolerance.face)
    );

    while (true) {
        const activeFaces = compactFaces(faces);
        const pointIndex = farthestOutsidePoint(points, activeFaces, tolerance.plane);
        if (pointIndex === null) break;
        const point = points[pointIndex]!;
        const visibleIndices = faces.flatMap((candidate, index) =>
            candidate !== null && faceDistance(candidate, point) > tolerance.face ? [index] : []
        );
        if (visibleIndices.length === 0) throw new Error('Convex hull selected an occluded point');

        const visible = visibleIndices.map((index) => faces[index]!);
        const horizon = horizonEdges(visible);
        for (const index of visibleIndices) faces[index] = null;
        const newFaceIndices: number[] = [];
        for (const edge of horizon) {
            newFaceIndices.push(faces.length);
            faces.push(face(
                points,
                [edge.from, edge.to, pointIndex],
                interior,
                tolerance.face
            ));
        }
        validateClosedHull(compactFaces(faces));
        mergeConstructionFaces(points, faces, newFaceIndices, tolerance.face);
    }

    let cookedFaces = compactFaces(faces);
    if (cookedFaces.some((candidate) =>
        points.some((point) => faceDistance(candidate, point) > tolerance.plane * 1.01)
    )) {
        throw new Error('Convex hull does not enclose every source point');
    }
    validateClosedHull(cookedFaces);
    cookedFaces = mergeAdjacentFaces(points, cookedFaces, tolerance);
    validateClosedHull(cookedFaces);
    cookedFaces = removeCookedBevels(cookedFaces, tolerance.plane);

    const sourceIndices = [...new Set(cookedFaces.flatMap((candidate) => candidate.vertexIndices))]
        .sort((left, right) => left - right);
    const hullIndex = new Map(sourceIndices.map((sourceIndex, index) => [sourceIndex, index]));
    const vertices = sourceIndices.map((index) => points[index]!);
    return {
        meshId: source.meshId,
        vertices,
        faces: cookedFaces.map((candidate) => ({
            ...candidate,
            vertexIndices: candidate.vertexIndices.map((index) => hullIndex.get(index)!),
        })),
        bounds: bounds(vertices),
    };
}

export function signedDistancesToConvexHullFaces(
    point: Vector3,
    transform: Pick<Transform, 'worldPosition'>,
    basis: ColliderWorldBasis,
    hull: ConvexHull
): readonly number[] {
    const localPoint = localPointFromBasis(transform, basis, point);
    return hull.faces.map((face) => {
        const worldNormal = worldNormalFromBasis(basis, face.normal);
        const transformedLocalNormal = add(
            add(scale(basis.right, face.normal.x), scale(basis.up, face.normal.y)),
            scale(basis.forward, face.normal.z)
        );
        const worldDistancePerLocalUnit = dot(worldNormal, transformedLocalNormal);
        if (!Number.isFinite(worldDistancePerLocalUnit) || worldDistancePerLocalUnit <= 0) {
            throw new RangeError('Convex hull transform is degenerate');
        }
        return (dot(face.normal, localPoint) - face.offset) * worldDistancePerLocalUnit;
    });
}

function uniqueFinitePoints(source: readonly Vector3[]): Vector3[] {
    const unique = new Map<string, Vector3>();
    for (const point of source) {
        if (![point.x, point.y, point.z].every(Number.isFinite)) {
            throw new RangeError('Convex hull points must be finite');
        }
        const normalized = {
            x: normalizeZero(point.x),
            y: normalizeZero(point.y),
            z: normalizeZero(point.z),
        };
        unique.set(`${normalized.x}|${normalized.y}|${normalized.z}`, normalized);
    }
    return [...unique.values()];
}

function hullTolerances(points: readonly Vector3[]): HullTolerances {
    const box = bounds(points);
    const size = (box.size.x + box.size.y + box.size.z) * 0.5;
    if (!Number.isFinite(size) || size === 0) {
        throw new RangeError('Convex hull points have zero extent');
    }
    return {
        face: Math.max(3 * floatEpsilon * size, 3 * floatEpsilon),
        plane: Math.max(physxPlaneTolerance * size, physxPlaneTolerance),
    };
}

function initialTetrahedron(
    points: readonly Vector3[],
    tolerance: number
): readonly [number, number, number, number] {
    let axis: keyof Vector3 = 'x';
    let extent = 0;
    for (const candidate of ['x', 'y', 'z'] as const) {
        const measured = points[extreme(points, candidate, 1)]![candidate] -
            points[extreme(points, candidate, -1)]![candidate];
        if (measured > extent) {
            axis = candidate;
            extent = measured;
        }
    }
    if (extent <= tolerance) {
        throw new RangeError('Convex hull points are coincident');
    }

    const a = extreme(points, axis, 1);
    const b = extreme(points, axis, -1);
    const ab = subtract(points[b]!, points[a]!);
    const lineLength = length(ab);
    const c = farthest(points, new Set([a, b]), (point) =>
        length(cross(scale(ab, 1 / lineLength), subtract(point, points[a]!)))
    );
    if (c.distance <= tolerance) throw new RangeError('Convex hull points are collinear');

    const normal = normalize(cross(ab, subtract(points[c.index]!, points[a]!)));
    const d = farthest(points, new Set([a, b, c.index]), (point) =>
        Math.abs(dot(normal, subtract(point, points[a]!)))
    );
    if (d.distance <= tolerance) throw new RangeError('Convex hull points are coplanar');
    return [a, b, c.index, d.index];
}

function tetrahedronFaces(
    points: readonly Vector3[],
    tetrahedron: readonly [number, number, number, number]
): readonly (readonly [number, number, number])[] {
    const [a, b, c, d] = tetrahedron;
    const normal = cross(subtract(points[b]!, points[a]!), subtract(points[c]!, points[a]!));
    const flip = dot(subtract(points[d]!, points[c]!), normal) < 0;
    return flip
        ? [[a, b, c], [d, b, a], [d, c, b], [d, a, c]]
        : [[a, c, b], [d, a, b], [d, b, c], [d, c, a]];
}

function face(
    points: readonly Vector3[],
    indices: readonly [number, number, number],
    interior: Vector3,
    tolerance: number
): ConvexHullFace {
    const [a, b, c] = indices.map((index) => points[index]!) as [Vector3, Vector3, Vector3];
    const rawNormal = cross(subtract(b, a), subtract(c, a));
    if (length(rawNormal) <= tolerance * tolerance) {
        throw new RangeError('Convex hull contains a degenerate face');
    }
    const normal = normalize(rawNormal);
    const oriented = dot(normal, subtract(interior, a)) > 0
        ? [indices[0], indices[2], indices[1]] as const
        : indices;
    return polygonFace(points, oriented);
}

function horizonEdges(visible: readonly ConvexHullFace[]): Edge[] {
    const edges = new Map<string, Edge>();
    for (const candidate of visible) {
        for (let index = 0; index < candidate.vertexIndices.length; index++) {
            const edge = {
                from: candidate.vertexIndices[index]!,
                to: candidate.vertexIndices[(index + 1) % candidate.vertexIndices.length]!,
            };
            const key = edge.from < edge.to
                ? `${edge.from}:${edge.to}`
                : `${edge.to}:${edge.from}`;
            if (edges.has(key)) edges.delete(key);
            else edges.set(key, edge);
        }
    }
    if (edges.size < 3) throw new Error('Convex hull horizon is not closed');
    const remaining = [...edges.values()];
    const ordered = [remaining.shift()!];
    while (remaining.length > 0) {
        const tail = ordered[ordered.length - 1]!.to;
        const next = remaining.findIndex((edge) => edge.from === tail);
        if (next < 0) throw new Error('Convex hull horizon edges are not contiguous');
        ordered.push(remaining.splice(next, 1)[0]!);
    }
    if (ordered[ordered.length - 1]!.to !== ordered[0]!.from) {
        throw new Error('Convex hull horizon is not closed');
    }
    return ordered;
}

function farthestOutsidePoint(
    points: readonly Vector3[],
    faces: readonly ConvexHullFace[],
    tolerance: number
): number | null {
    let selected: number | null = null;
    let maximum = tolerance;
    for (const candidate of faces) {
        for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
            const point = points[pointIndex]!;
            const measured = faceDistance(candidate, point);
            if (measured > maximum) {
                selected = pointIndex;
                maximum = measured;
            }
        }
    }
    return selected;
}

function mergeConstructionFaces(
    points: readonly Vector3[],
    faces: (ConvexHullFace | null)[],
    newFaceIndices: readonly number[],
    tolerance: number
): void {
    const nonConvex = new Set<number>();
    for (const faceIndex of newFaceIndices) {
        while (constructionMerge(points, faces, faceIndex, tolerance, true, nonConvex));
    }
    for (const faceIndex of newFaceIndices) {
        if (!nonConvex.has(faceIndex)) continue;
        while (constructionMerge(points, faces, faceIndex, tolerance, false, nonConvex));
    }
}

function constructionMerge(
    points: readonly Vector3[],
    faces: (ConvexHullFace | null)[],
    faceIndex: number,
    tolerance: number,
    relativeToLargerFace: boolean,
    nonConvex: Set<number>
): boolean {
    const candidate = faces[faceIndex];
    if (candidate === null || candidate === undefined) return false;
    let convex = true;
    for (let edgeIndex = 0; edgeIndex < candidate.vertexIndices.length; edgeIndex++) {
        const from = candidate.vertexIndices[edgeIndex]!;
        const to = candidate.vertexIndices[(edgeIndex + 1) % candidate.vertexIndices.length]!;
        const adjacentIndex = adjacentFaceIndex(faces, candidate, to, from);
        if (adjacentIndex < 0) throw new Error('Convex hull has an open edge');
        const adjacent = faces[adjacentIndex]!;
        const candidateDistance = faceDistance(candidate, adjacent.centroid);
        const adjacentDistance = faceDistance(adjacent, candidate.centroid);
        let merge = false;
        if (relativeToLargerFace) {
            if (candidate.area > adjacent.area) {
                merge = candidateDistance > -tolerance;
                if (!merge && adjacentDistance > -tolerance) convex = false;
            } else {
                merge = adjacentDistance > -tolerance;
                if (!merge && candidateDistance > -tolerance) convex = false;
            }
        } else {
            merge = candidateDistance > -tolerance || adjacentDistance > -tolerance;
        }
        if (!merge) continue;
        const adjacentEdge = directedEdgeIndex(adjacent, to, from);
        if (hasRedundantNeighbour(faces, candidate, edgeIndex, adjacent, adjacentEdge)) {
            continue;
        }
        faces[faceIndex] = polygonFace(
            points,
            mergedVertexIndices(candidate, edgeIndex, adjacent, adjacentEdge)
        );
        faces[adjacentIndex] = null;
        return true;
    }
    if (!convex) nonConvex.add(faceIndex);
    return false;
}


function extreme(
    points: readonly Vector3[],
    axis: keyof Vector3,
    direction: -1 | 1
): number {
    let selected = 0;
    for (let index = 1; index < points.length; index++) {
        if (direction * points[index]![axis] > direction * points[selected]![axis]) selected = index;
    }
    return selected;
}

function farthest(
    points: readonly Vector3[],
    excluded: ReadonlySet<number>,
    measure: (point: Vector3) => number
): { readonly index: number; readonly distance: number } {
    let index = -1;
    let distance = -1;
    for (let candidate = 0; candidate < points.length; candidate++) {
        if (excluded.has(candidate)) continue;
        const measured = measure(points[candidate]!);
        if (measured > distance) {
            index = candidate;
            distance = measured;
        }
    }
    if (index < 0) throw new RangeError('Convex hull has too few points');
    return { index, distance };
}

function bounds(points: readonly Vector3[]): TriangleMesh['bounds'] {
    if (points.length === 0) throw new RangeError('Bounds require at least one point');
    const minimum = { ...points[0]! };
    const maximum = { ...points[0]! };
    for (const point of points) {
        for (const axis of ['x', 'y', 'z'] as const) {
            minimum[axis] = Math.min(minimum[axis], point[axis]);
            maximum[axis] = Math.max(maximum[axis], point[axis]);
        }
    }
    return {
        center: scale(add(minimum, maximum), 0.5),
        size: subtract(maximum, minimum),
    };
}

function average(points: readonly Vector3[]): Vector3 {
    return scale(points.reduce(add, { x: 0, y: 0, z: 0 }), 1 / points.length);
}

function normalize(vector: Vector3): Vector3 {
    const magnitude = length(vector);
    if (!Number.isFinite(magnitude) || magnitude === 0) {
        throw new RangeError('Cannot normalize a zero-length vector');
    }
    return scale(vector, 1 / magnitude);
}

function normalizeZero(value: number): number {
    return Object.is(value, -0) ? 0 : value;
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
