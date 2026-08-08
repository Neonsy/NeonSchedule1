import { describe, expect, it } from 'vitest';

import {
    worldBoxFromCollider,
    worldBoxesOverlap,
    type Collider,
    type Vector3,
    type WorldBox,
} from '@neonschedule1/core';

describe('world box collision', () => {
    it('constructs a box from the collider basis and local center', () => {
        const box = worldBoxFromCollider(collider({
            position: vector(10, 2, 20),
            center: vector(1, 0.5, -1),
            size: vector(4, 2, 6),
            right: vector(0, 0, -2),
            up: vector(0, 3, 0),
            forward: vector(0.5, 0, 0),
        }));

        expect(box).toEqual({
            center: vector(9.5, 3.5, 18),
            halfAxes: [vector(0, 0, -4), vector(0, 3, 0), vector(1.5, 0, 0)],
        });
    });

    it('distinguishes overlap, contact, clearance, and separation', () => {
        const left = axisAlignedBox(vector(0, 0, 0), vector(1, 1, 1));

        expect(worldBoxesOverlap(left, axisAlignedBox(vector(1.5, 0, 0), vector(1, 1, 1))))
            .toBe(true);
        expect(worldBoxesOverlap(left, axisAlignedBox(vector(2, 0, 0), vector(1, 1, 1))))
            .toBe(false);
        expect(worldBoxesOverlap(
            left,
            axisAlignedBox(vector(2.25, 0, 0), vector(1, 1, 1)),
            0.5
        )).toBe(true);
        expect(worldBoxesOverlap(left, axisAlignedBox(vector(2.5, 0, 0), vector(1, 1, 1)), 0.5))
            .toBe(false);
    });

    it('checks rotated and skewed boxes using their full basis', () => {
        const skewed: WorldBox = {
            center: vector(0, 0, 0),
            halfAxes: [vector(1, 0, 0), vector(0.5, 1, 0), vector(0, 0, 1)],
        };
        const rotated: WorldBox = {
            center: vector(1.8, 0, 0),
            halfAxes: [vector(Math.SQRT1_2, 0, -Math.SQRT1_2), vector(0, 1, 0),
                vector(Math.SQRT1_2, 0, Math.SQRT1_2)],
        };

        expect(worldBoxesOverlap(skewed, rotated)).toBe(true);
        expect(worldBoxesOverlap(skewed, { ...rotated, center: vector(4, 0, 0) })).toBe(false);
    });

    it('rejects unsupported, degenerate, and invalid-clearance inputs', () => {
        expect(() => worldBoxFromCollider({ ...collider({}), shape: 'sphere' }))
            .toThrow('requires box-collider geometry');
        expect(() => worldBoxesOverlap(
            axisAlignedBox(vector(0, 0, 0), vector(1, 1, 1)),
            { center: vector(0, 0, 0), halfAxes: [vector(0, 0, 0), vector(0, 1, 0),
                vector(0, 0, 1)] }
        )).toThrow('three independent non-zero half-axes');
        expect(() => worldBoxesOverlap(
            axisAlignedBox(vector(0, 0, 0), vector(1, 1, 1)),
            axisAlignedBox(vector(0, 0, 0), vector(1, 1, 1)),
            -1
        )).toThrow('finite non-negative');
    });
});

function axisAlignedBox(center: Vector3, halfSize: Vector3): WorldBox {
    return {
        center,
        halfAxes: [
            vector(halfSize.x, 0, 0),
            vector(0, halfSize.y, 0),
            vector(0, 0, halfSize.z),
        ],
    };
}

function collider(input: {
    readonly position?: Vector3;
    readonly center?: Vector3;
    readonly size?: Vector3;
    readonly right?: Vector3;
    readonly up?: Vector3;
    readonly forward?: Vector3;
}): Collider {
    const position = input.position ?? vector(0, 0, 0);
    return {
        source: 'fixture',
        runtimeType: 'UnityEngine.BoxCollider',
        shape: 'box',
        enabled: true,
        isTrigger: false,
        layer: 0,
        layerName: 'Default',
        tag: 'Untagged',
        transform: {
            name: 'Box',
            path: 'Box',
            worldPosition: position,
            localPosition: position,
            worldRotation: vector(0, 0, 0),
            localScale: vector(1, 1, 1),
        },
        worldScale: vector(1, 1, 1),
        worldBasis: {
            right: input.right ?? vector(1, 0, 0),
            up: input.up ?? vector(0, 1, 0),
            forward: input.forward ?? vector(0, 0, 1),
        },
        worldBounds: { center: position, size: input.size ?? vector(2, 2, 2) },
        localCenter: input.center ?? vector(0, 0, 0),
        localSize: input.size ?? vector(2, 2, 2),
        radius: null,
        height: null,
        direction: null,
        meshName: null,
        meshId: null,
        meshIsReadable: null,
        isConvex: null,
    };
}

function vector(x: number, y: number, z: number): Vector3 {
    return { x, y, z };
}
