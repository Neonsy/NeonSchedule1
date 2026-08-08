import { describe, expect, it } from 'vitest';

import {
    convexHullFromTriangleMesh,
    signedDistancesToConvexHullFaces,
    type TriangleMesh,
    type Vector3,
} from '@neonschedule1/core';

describe('convex hull geometry', () => {
    it('encloses a concave point set without retaining interior points', () => {
        const source = mesh([
            vector(-1, -1, -1),
            vector(-1, -1, 1),
            vector(-1, 1, -1),
            vector(-1, 1, 1),
            vector(1, -1, -1),
            vector(1, -1, 1),
            vector(1, 1, -1),
            vector(1, 1, 1),
            vector(0, 0, 0),
            vector(0, 0, 0),
        ]);

        const hull = convexHullFromTriangleMesh(source);

        expect(hull.vertices).toHaveLength(8);
        expect(hull.faces).toHaveLength(6);
        expect(hull.faces.every((face) => face.vertexIndices.length === 4)).toBe(true);
        expect(hull.bounds).toEqual(source.bounds);
        const distances = signedDistancesToConvexHullFaces(
            vector(1, 0, 0),
            { worldPosition: vector(0, 0, 0) },
            {
                right: vector(1, 0, 0),
                up: vector(0, 1, 0),
                forward: vector(0, 0, 1),
            },
            hull
        );
        expect(distances.every((distance) => distance <= 0)).toBe(true);
        expect(distances.some((distance) => Math.abs(distance) < 1e-12)).toBe(true);
    });

    it('rejects geometry that cannot define a three-dimensional collider', () => {
        const source = mesh([
            vector(-1, 0, -1),
            vector(1, 0, -1),
            vector(1, 0, 1),
            vector(-1, 0, 1),
        ]);

        expect(() => convexHullFromTriangleMesh(source)).toThrow('coplanar');
    });

    it('retains the cooked face merge verified for the Docks Warehouse rear wall', () => {
        const source = mesh([
            vector(7.250000953674316, -0.04500000178813934, 2.6198291778564453),
            vector(7.250000953674316, 0.04500000178813934, 2.6198291778564453),
            vector(7.250000953674316, 0.04500000178813934, -3.19435715675354),
            vector(7.250000953674316, -0.04500000178813934, -3.19435715675354),
            vector(-7.250000953674316, -0.04500000178813934, 2.6198291778564453),
            vector(-7.250000953674316, -0.04500000178813934, -3.19435715675354),
            vector(-7.250000953674316, 0.04500000178813934, 2.6198291778564453),
            vector(-7.250000953674316, 0.04500000178813934, -3.19435715675354),
            vector(7.036445617675781, 0.04500000178813934, -3.1943576335906982),
            vector(-6.826404094696045, -0.08500000089406967, -3.1943576335906982),
            vector(6.826404571533203, -0.08500000089406967, -3.1943576335906982),
            vector(6.826404094696045, -0.08500000089406967, 2.733358383178711),
            vector(0.3151140511035919, 0.04500000178813934, 4.493059158325195),
            vector(0.10507243126630783, -0.08500000089406967, 4.549823760986328),
            vector(0.10507243126630783, 0.005000002682209015, 4.549823760986328),
            vector(-0.10507246851921082, 0.005000002682209015, 4.549823760986328),
            vector(-0.10507246851921082, -0.08500000089406967, 4.549823760986328),
            vector(-0.31511399149894714, 0.04500000178813934, 4.493059158325195),
            vector(-6.826404571533203, -0.08500000089406967, 2.73335862159729),
            vector(7.098313808441162, -0.11205195635557175, 1.4862995147705078),
            vector(-7.098313808441162, -0.11204501986503601, 1.4862995147705078),
            vector(7.098313808441162, -0.11205195635557175, -1.9466471672058105),
            vector(-7.098313808441162, -0.11204501986503601, -1.9466471672058105),
        ]);

        const hull = convexHullFromTriangleMesh(source);
        const merged = hull.faces.find((face) =>
            face.vertexIndices.length === 5 && face.normal.y < -0.99 && face.normal.z > 0
        );

        expect(hull.faces).toHaveLength(17);
        expect(merged).toBeDefined();
        expect(merged!.normal.x).toBeCloseTo(-4.885717104471177e-7, 10);
        expect(merged!.normal.y).toBeCloseTo(-0.9999394652997888, 10);
        expect(merged!.normal.z).toBeCloseTo(0.011002987582184435, 10);
        expect(merged!.offset).toBeCloseTo(0.12839544039309367, 10);
    });
});

function mesh(vertices: Vector3[]): TriangleMesh {
    const minimum = {
        x: Math.min(...vertices.map((point) => point.x)),
        y: Math.min(...vertices.map((point) => point.y)),
        z: Math.min(...vertices.map((point) => point.z)),
    };
    const maximum = {
        x: Math.max(...vertices.map((point) => point.x)),
        y: Math.max(...vertices.map((point) => point.y)),
        z: Math.max(...vertices.map((point) => point.z)),
    };
    return {
        meshId: 'mesh:test',
        vertices,
        triangles: [0, 1, 2],
        bounds: {
            center: vector(
                (minimum.x + maximum.x) / 2,
                (minimum.y + maximum.y) / 2,
                (minimum.z + maximum.z) / 2
            ),
            size: vector(
                maximum.x - minimum.x,
                maximum.y - minimum.y,
                maximum.z - minimum.z
            ),
        },
    };
}

function vector(x: number, y: number, z: number): Vector3 {
    return { x, y, z };
}
