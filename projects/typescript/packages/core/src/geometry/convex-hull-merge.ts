import type { Vector3 } from '#core/data/common';

export interface ConvexHullFace {
    readonly vertexIndices: readonly number[];
    readonly normal: Vector3;
    readonly offset: number;
    readonly centroid: Vector3;
    readonly area: number;
}

export interface HullTolerances {
    readonly face: number;
    readonly plane: number;
}

const minimumAdjacentAngle = 3 * Math.PI / 180;

export function mergeAdjacentFaces(
    points: readonly Vector3[],
    input: readonly ConvexHullFace[],
    tolerance: HullTolerances
): ConvexHullFace[] {
    const faces: (ConvexHullFace | null)[] = [...input];
    const minimumNormalDot = Math.cos(minimumAdjacentAngle);
    for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
        let candidate = faces[faceIndex];
        if (candidate === null || candidate === undefined) continue;
        while (true) {
            const merge = adjacentMerge(
                points,
                faces,
                candidate,
                tolerance,
                minimumNormalDot
            );
            if (merge === null) break;
            candidate = merge.face;
            faces[faceIndex] = candidate;
            faces[merge.discardedIndex] = null;
        }
    }
    return compactFaces(faces);
}

export function removeCookedBevels(
    input: readonly ConvexHullFace[],
    planeTolerance: number
): ConvexHullFace[] {
    const faces = [...input];
    const minimumNormalDot = Math.cos(minimumAdjacentAngle);
    for (let candidateIndex = faces.length - 1; candidateIndex >= 0; candidateIndex--) {
        const candidate = faces[candidateIndex]!;
        const replacement = faces.find((face) =>
            face !== candidate &&
            face.area >= candidate.area &&
            dot(face.normal, candidate.normal) > minimumNormalDot &&
            shareEdge(face, candidate) &&
            faceDistance(face, candidate.centroid) <= 0 &&
            faceDistance(face, candidate.centroid) >= -planeTolerance
        );
        if (replacement !== undefined) faces.splice(candidateIndex, 1);
    }
    return faces;
}

export function compactFaces(
    faces: readonly (ConvexHullFace | null)[]
): ConvexHullFace[] {
    return faces.filter((candidate): candidate is ConvexHullFace => candidate !== null);
}

export function hasRedundantNeighbour(
    faces: readonly (ConvexHullFace | null)[],
    face: ConvexHullFace,
    edgeIndex: number,
    adjacent: ConvexHullFace,
    adjacentEdgeIndex: number
): boolean {
    const facePrevious = neighbourAt(faces, face, edgeIndex - 1);
    const faceNext = neighbourAt(faces, face, edgeIndex + 1);
    const adjacentPrevious = neighbourAt(faces, adjacent, adjacentEdgeIndex - 1);
    const adjacentNext = neighbourAt(faces, adjacent, adjacentEdgeIndex + 1);
    return adjacentPrevious === faceNext || facePrevious === adjacentNext;
}

export function adjacentFaceIndex(
    faces: readonly (ConvexHullFace | null)[],
    face: ConvexHullFace,
    from: number,
    to: number
): number {
    return faces.findIndex((candidate) =>
        candidate !== null && candidate !== face && directedEdgeIndex(candidate, from, to) >= 0
    );
}

export function directedEdgeIndex(face: ConvexHullFace, from: number, to: number): number {
    return face.vertexIndices.findIndex((vertex, index) =>
        vertex === from && face.vertexIndices[(index + 1) % face.vertexIndices.length] === to
    );
}

export function mergedVertexIndices(
    face: ConvexHullFace,
    edgeIndex: number,
    adjacent: ConvexHullFace,
    adjacentEdgeIndex: number
): number[] {
    const merged: number[] = [];
    for (let step = 1; step <= face.vertexIndices.length; step++) {
        merged.push(face.vertexIndices[(edgeIndex + step) % face.vertexIndices.length]!);
    }
    for (let step = 2; step < adjacent.vertexIndices.length; step++) {
        merged.push(
            adjacent.vertexIndices[(adjacentEdgeIndex + step) % adjacent.vertexIndices.length]!
        );
    }
    return merged;
}

export function polygonFace(
    points: readonly Vector3[],
    vertexIndices: readonly number[]
): ConvexHullFace {
    if (vertexIndices.length < 3) throw new RangeError('Convex hull face requires three vertices');
    let start = 0;
    let maximumEdgeLength = 0;
    for (let index = 0; index < 3; index++) {
        const measured = squaredLength(subtract(
            points[vertexIndices[index]!]!,
            points[vertexIndices[(index + 1) % vertexIndices.length]!]!
        ));
        if (measured > maximumEdgeLength) {
            maximumEdgeLength = measured;
            start = index;
        }
    }
    const origin = points[vertexIndices[start]!]!;
    const direction = subtract(
        points[vertexIndices[(start + 1) % vertexIndices.length]!]!,
        origin
    );
    let rawNormal = { x: 0, y: 0, z: 0 };
    for (let step = 1; step < vertexIndices.length; step++) {
        const next = points[vertexIndices[(start + step + 1) % vertexIndices.length]!]!;
        rawNormal = add(rawNormal, cross(direction, subtract(next, origin)));
    }
    const area = length(rawNormal);
    if (!Number.isFinite(area) || area === 0) {
        throw new RangeError('Convex hull contains a degenerate face');
    }
    const normal = scale(rawNormal, 1 / area);
    const centroid = average(vertexIndices.map((index) => points[index]!));
    return {
        vertexIndices: [...vertexIndices],
        normal,
        offset: dot(normal, centroid),
        centroid,
        area,
    };
}

export function validateClosedHull(faces: readonly ConvexHullFace[]): void {
    const counts = new Map<string, number>();
    for (const candidate of faces) {
        for (let index = 0; index < candidate.vertexIndices.length; index++) {
            const left = candidate.vertexIndices[index]!;
            const right = candidate.vertexIndices[(index + 1) % candidate.vertexIndices.length]!;
            const key = left < right ? `${left}:${right}` : `${right}:${left}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
    }
    if (counts.size === 0 || [...counts.values()].some((count) => count !== 2)) {
        throw new Error('Convex hull is not a closed manifold');
    }
}

export function faceDistance(candidate: ConvexHullFace, point: Vector3): number {
    return dot(candidate.normal, point) - candidate.offset;
}

function adjacentMerge(
    points: readonly Vector3[],
    faces: readonly (ConvexHullFace | null)[],
    face: ConvexHullFace,
    tolerance: HullTolerances,
    minimumNormalDot: number
): { readonly face: ConvexHullFace; readonly discardedIndex: number } | null {
    for (let edgeIndex = 0; edgeIndex < face.vertexIndices.length; edgeIndex++) {
        const from = face.vertexIndices[edgeIndex]!;
        const to = face.vertexIndices[(edgeIndex + 1) % face.vertexIndices.length]!;
        const adjacentIndex = adjacentFaceIndex(faces, face, to, from);
        if (adjacentIndex < 0) throw new Error('Convex hull has an open edge');
        const adjacent = faces[adjacentIndex]!;
        if (
            dot(face.normal, adjacent.normal) <= minimumNormalDot ||
            face.area < adjacent.area
        ) continue;
        const adjacentEdge = directedEdgeIndex(adjacent, to, from);
        if (hasRedundantNeighbour(faces, face, edgeIndex, adjacent, adjacentEdge)) continue;
        const vertexIndices = mergedVertexIndices(face, edgeIndex, adjacent, adjacentEdge);
        const merged = polygonFace(points, vertexIndices);
        if (!canMerge(points, merged, tolerance)) continue;
        return { face: merged, discardedIndex: adjacentIndex };
    }
    return null;
}

function canMerge(
    points: readonly Vector3[],
    merged: ConvexHullFace,
    tolerance: HullTolerances
): boolean {
    if (points.some((point) => faceDistance(merged, point) > tolerance.plane)) return false;
    for (let edgeIndex = 0; edgeIndex < merged.vertexIndices.length; edgeIndex++) {
        const vertex = points[merged.vertexIndices[edgeIndex]!]!;
        const next = points[
            merged.vertexIndices[(edgeIndex + 1) % merged.vertexIndices.length]!
        ]!;
        const edge = normalize(subtract(next, vertex));
        const outward = scale(cross(merged.normal, edge), -1);
        if (merged.vertexIndices.some((index) =>
            dot(subtract(points[index]!, vertex), outward) > tolerance.face
        )) return false;
    }
    return true;
}

function shareEdge(left: ConvexHullFace, right: ConvexHullFace): boolean {
    return left.vertexIndices.some((from, index) => {
        const to = left.vertexIndices[(index + 1) % left.vertexIndices.length]!;
        return directedEdgeIndex(right, to, from) >= 0;
    });
}

function neighbourAt(
    faces: readonly (ConvexHullFace | null)[],
    face: ConvexHullFace,
    edgeIndex: number
): ConvexHullFace {
    const normalized = (edgeIndex + face.vertexIndices.length) % face.vertexIndices.length;
    const from = face.vertexIndices[normalized]!;
    const to = face.vertexIndices[(normalized + 1) % face.vertexIndices.length]!;
    const index = adjacentFaceIndex(faces, face, to, from);
    if (index < 0) throw new Error('Convex hull has an open edge');
    return faces[index]!;
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

function length(vector: Vector3): number {
    return Math.hypot(vector.x, vector.y, vector.z);
}

function squaredLength(vector: Vector3): number {
    return dot(vector, vector);
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
