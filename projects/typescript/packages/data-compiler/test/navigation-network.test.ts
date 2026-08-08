import { describe, expect, it } from 'vitest';

import {
    NavigationNetwork,
    type NavigationGraph,
    type NavigationSample,
    type Vector3,
} from '@neonschedule1/core';

describe('navigation network', () => {
    it('finds an exact shortest path with deterministic equal-cost tie breaking', () => {
        const network = new NavigationNetwork(graph(
            [
                position(0, 0),
                position(1, 1),
                position(1, -1),
                position(2, 0),
            ],
            [[0, 1], [1, 3], [0, 2], [2, 3]]
        ));

        const result = network.findPath({
            start: position(0, 0),
            end: position(2, 0),
            maximumSnapDistance: 0,
        });

        expect(result.kind).toBe('found');
        if (result.kind !== 'found') throw new Error('Expected a path');
        expect(result.points.map(({ sampleIndex }) => sampleIndex)).toEqual([0, 1, 3]);
        expect(result.networkDistance).toBeCloseTo(2 * Math.SQRT2);
        expect(result.start.snapDistance).toBe(0);
        expect(result.end.snapDistance).toBe(0);
    });

    it('matches an independent Dijkstra oracle for every endpoint pair', () => {
        const input = graph(
            [
                position(0, 0),
                position(1, 0),
                position(2, 0),
                position(0, 2),
                position(1, 2),
                position(2, 2),
            ],
            [[0, 1], [1, 2], [0, 3], [1, 4], [2, 5], [3, 4], [4, 5], [1, 3], [2, 4]]
        );
        const network = new NavigationNetwork(input);
        for (let start = 0; start < input.samples.length; start++) {
            for (let end = 0; end < input.samples.length; end++) {
                const result = network.findPath({
                    start: input.samples[start]!.position,
                    end: input.samples[end]!.position,
                    maximumSnapDistance: 0,
                });
                expect(result.kind).toBe('found');
                if (result.kind !== 'found') throw new Error('Expected a connected path');
                expect(result.networkDistance).toBeCloseTo(dijkstraDistance(input, start, end), 10);
            }
        }
    });

    it('resolves the nearest three-dimensional sample and applies deterministic ties', () => {
        const network = new NavigationNetwork(graph(
            [
                { x: 0, y: 0, z: 0 },
                { x: 0, y: 10, z: 0 },
                { x: 2, y: 10, z: 0 },
            ],
            [[1, 2]]
        ));

        expect(network.nearestSample({ x: 0, y: 9, z: 0 }, 2)).toMatchObject({
            sampleIndex: 1,
            componentId: 1,
        });
        expect(network.nearestSample({ x: 1, y: 10, z: 0 }, 2)?.sampleIndex).toBe(1);
        expect(network.nearestSample({ x: 20, y: 0, z: 20 }, 2)).toBeNull();
    });

    it('distinguishes unsnappable endpoints from disconnected samples', () => {
        const network = new NavigationNetwork(graph(
            [position(0, 0), position(1, 0), position(10, 0)],
            [[0, 1]]
        ));

        expect(network.findPath({
            start: position(-10, 0),
            end: position(0, 0),
            maximumSnapDistance: 1,
        })).toMatchObject({ kind: 'unreachable', reason: 'start-outside-network' });
        expect(network.findPath({
            start: position(0, 0),
            end: position(20, 0),
            maximumSnapDistance: 1,
        })).toMatchObject({ kind: 'unreachable', reason: 'end-outside-network' });
        expect(network.findPath({
            start: position(0, 0),
            end: position(10, 0),
            maximumSnapDistance: 0,
        })).toMatchObject({
            kind: 'unreachable',
            reason: 'disconnected',
            exploredSampleCount: 0,
        });
    });

    it('can resolve an endpoint only within the start component', () => {
        const network = new NavigationNetwork(graph(
            [position(0, 0), position(5, 0), position(5, 1)],
            [[0, 1]]
        ));

        const result = network.findPathToNearestReachable({
            start: position(0, 0),
            end: position(5, 1),
            maximumStartSnapDistance: 0,
            maximumEndSnapDistance: 2,
        });

        expect(result.kind).toBe('found');
        if (result.kind !== 'found') throw new Error('Expected a reachable path');
        expect(result.end.sampleIndex).toBe(1);
        expect(result.end.snapDistance).toBe(1);
        expect(result.points.map(({ sampleIndex }) => sampleIndex)).toEqual([0, 1]);
    });
});

function graph(positions: readonly Vector3[], edges: readonly (readonly [number, number])[]): NavigationGraph {
    const samples: NavigationSample[] = positions.map((samplePosition, index) => ({
        gridX: index,
        gridZ: 0,
        position: samplePosition,
        areaMask: 1,
    }));
    return {
        schema: 'neonschedule1-navigation-graph-1',
        method: 'test',
        sampleSpacing: 2,
        queryHeight: 0,
        maxSampleDistance: 12,
        boundsMinimum: position(-20, -20),
        boundsMaximum: position(20, 20),
        gridWidth: samples.length,
        gridHeight: 1,
        samples,
        edges: edges.map(([sampleA, sampleB]) => ({ sampleA, sampleB })),
    };
}

function dijkstraDistance(input: NavigationGraph, start: number, end: number): number {
    const adjacency = Array.from({ length: input.samples.length }, () => [] as number[]);
    input.edges.forEach(({ sampleA, sampleB }) => {
        adjacency[sampleA]!.push(sampleB);
        adjacency[sampleB]!.push(sampleA);
    });
    const distances = Array<number>(input.samples.length).fill(Number.POSITIVE_INFINITY);
    const visited = new Set<number>();
    distances[start] = 0;
    while (!visited.has(end)) {
        const current = distances
            .map((distance, sampleIndex) => ({ distance, sampleIndex }))
            .filter(({ sampleIndex }) => !visited.has(sampleIndex))
            .sort((left, right) => left.distance - right.distance || left.sampleIndex - right.sampleIndex)[0];
        if (current === undefined || !Number.isFinite(current.distance)) return Number.POSITIVE_INFINITY;
        visited.add(current.sampleIndex);
        for (const neighbor of adjacency[current.sampleIndex]!) {
            const candidate = current.distance + distance(
                input.samples[current.sampleIndex]!.position,
                input.samples[neighbor]!.position
            );
            if (candidate < distances[neighbor]!) distances[neighbor] = candidate;
        }
    }
    return distances[end]!;
}

function distance(left: Vector3, right: Vector3): number {
    return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function position(x: number, z: number): Vector3 {
    return { x, y: 0, z };
}
