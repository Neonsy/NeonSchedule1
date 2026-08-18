import { describe, expect, it } from 'vitest';

import type { RawReport } from '#data-compiler/acquisition/types';
import { Integrity, IntegrityError } from '#data-compiler/integrity';
import { objectArray, type JsonObject } from '#data-compiler/json';
import { normalizeVehicleNavigation } from '#data-compiler/normalize/vehicle-navigation';

describe('vehicle navigation normalization', () => {
    it('preserves separate directed layers, geometry, components, endpoint offsets, and costs', () => {
        const integrity = new Integrity();
        const normalized = normalizeVehicleNavigation(
            report(vehicleNavigation()),
            new Set(['warehouse']),
            new Set(),
            integrity
        );
        integrity.throwIfInvalid();

        expect(normalized).toMatchObject({
            schema: 'neonschedule1-vehicle-navigation-1',
            connectionDirection: 'directed',
            geometricDistanceMethod: 'node-center-euclidean-3d',
            endpointOffsetStatus: 'reported-not-traversable',
            layerCompositionStatus: 'unproven',
        });
        const general = normalized.graphs.find(({ role }) => role === 'general')!;
        expect(general).toMatchObject({
            weakComponentCount: 1,
            strongComponentCount: 2,
        });
        expect(general.nodes.map(({ index, weakComponentId, strongComponentId, vertices }) => ({
            index,
            weakComponentId,
            strongComponentId,
            vertexCount: vertices.length,
        }))).toEqual([
            { index: 0, weakComponentId: 0, strongComponentId: 0, vertexCount: 3 },
            { index: 1, weakComponentId: 0, strongComponentId: 0, vertexCount: 3 },
            { index: 2, weakComponentId: 0, strongComponentId: 1, vertexCount: 3 },
        ]);
        expect(general.connections).toEqual([
            connection(0, 1, 7, 3),
            connection(1, 0, 8, 3),
            connection(1, 2, 9, 4),
        ]);
        const road = normalized.graphs.find(({ role }) => role === 'road')!;
        expect(road).toMatchObject({ weakComponentCount: 1, strongComponentCount: 1 });
        expect(road.connections[0]).toMatchObject({
            rawCost: 0,
            geometricDistance: 5,
        });
        expect(normalized.endpointMappings).toEqual([
            expect.objectContaining({
                subjectKind: 'property-spawn',
                subjectCode: 'warehouse',
                graphRole: 'general',
                nodeIndex: 0,
                graphDistance: 0,
                weakComponentId: 0,
                strongComponentId: 0,
            }),
            expect.objectContaining({
                subjectKind: 'property-spawn',
                subjectCode: 'warehouse',
                graphRole: 'road',
                nodeIndex: 0,
                graphDistance: 0,
                weakComponentId: 0,
                strongComponentId: 0,
            }),
        ]);
    });

    it('rejects cross-layer connections instead of fabricating composition', () => {
        const raw = vehicleNavigation();
        const general = objectArray(raw.graphs, 'graphs')[0]!;
        const sourceNode = objectArray(general.nodes, 'graphs[0].nodes')[0]!;
        const edge = objectArray(sourceNode.connections, 'graphs[0].nodes[0].connections')[0]!;
        edge.targetGraphArrayIndex = 1;
        edge.targetRuntimeGraphIndex = 1;
        const integrity = new Integrity();

        normalizeVehicleNavigation(
            report(raw),
            new Set(['warehouse']),
            new Set(),
            integrity
        );

        expect(() => integrity.throwIfInvalid()).toThrow(IntegrityError);
        expect(integrity.errors).toContain(
            'Vehicle navigation connection general/0 -> road/1 crosses graph layers'
        );
    });

    it('rejects an endpoint without evidence for both graph layers', () => {
        const raw = vehicleNavigation();
        raw.endpointMappings = objectArray(raw.endpointMappings, 'endpointMappings').slice(0, 1);
        const integrity = new Integrity();

        normalizeVehicleNavigation(
            report(raw),
            new Set(['warehouse']),
            new Set(),
            integrity
        );

        expect(() => integrity.throwIfInvalid()).toThrow(IntegrityError);
        expect(integrity.errors.some((error) =>
            error.includes('does not have both graph-layer mappings')
        )).toBe(true);
    });

    it('rejects inconsistent endpoint projection distances and subject references', () => {
        const raw = vehicleNavigation();
        const mapping = objectArray(raw.endpointMappings, 'endpointMappings')[0]!;
        mapping.graphDistance = 4;
        const integrity = new Integrity();

        normalizeVehicleNavigation(
            report(raw),
            new Set(),
            new Set(),
            integrity
        );

        expect(() => integrity.throwIfInvalid()).toThrow(IntegrityError);
        expect(integrity.errors).toContain(
            'Vehicle navigation endpoint mapping 0 graph distance is inconsistent'
        );
        expect(integrity.errors.filter((error) =>
            error.includes('references missing property "warehouse"')
        )).toHaveLength(2);
    });
});

function report(vehicleNavigationValue: JsonObject): RawReport {
    return {
        discovery: { vehicleNavigation: vehicleNavigationValue },
    } as unknown as RawReport;
}

function vehicleNavigation(): JsonObject {
    return {
        method: 'native-graph-capture',
        applicability: 'static-vehicle-topology',
        limitation: 'no live driving',
        endpointMappingMethod: 'nearest-walkable-captured-node-by-graph-geometry-distance',
        error: '',
        graphs: [
            graph('general', 0, 'Pathfinding.RecastGraph', [
                triangleNode(0, point(0, 0), [rawConnection(0, 1, 0, 7)]),
                triangleNode(1, point(3, 0), [
                    rawConnection(0, 0, 0, 8),
                    rawConnection(0, 2, 0, 9),
                ]),
                triangleNode(2, point(3, 4), []),
            ]),
            graph('road', 1, 'Pathfinding.PointGraph', [
                pointNode(0, point(0, 0), [rawConnection(1, 1, 1, 0)]),
                pointNode(1, point(0, 5), [rawConnection(1, 0, 1, 0)]),
            ]),
        ],
        endpointMappings: [
            endpointMapping('general', 0, 'General', 'triangle-surface'),
            endpointMapping('road', 1, 'Road', 'node-position'),
        ],
    };
}

function graph(
    role: 'general' | 'road',
    arrayIndex: number,
    runtimeType: string,
    nodes: JsonObject[]
): JsonObject {
    return {
        role,
        arrayIndex,
        runtimeGraphIndex: arrayIndex,
        name: role === 'general' ? 'General' : 'Road',
        runtimeType,
        guid: `${role}-guid`,
        declaredNodeCount: nodes.length,
        unresolvedConnectionCount: 0,
        nodes,
        error: '',
    };
}

function triangleNode(
    index: number,
    position: JsonObject,
    connections: JsonObject[]
): JsonObject {
    return {
        index,
        runtimeType: 'Pathfinding.TriangleMeshNode',
        geometryKind: 'triangle-mesh',
        position,
        walkable: true,
        penalty: 0,
        tag: 0,
        runtimeGraphIndex: 0,
        declaredVertexCount: 3,
        vertices: [point(index, 0), point(index + 1, 0), point(index, 1)],
        connections,
        error: '',
    };
}

function pointNode(
    index: number,
    position: JsonObject,
    connections: JsonObject[]
): JsonObject {
    return {
        index,
        runtimeType: 'Pathfinding.PointNode',
        geometryKind: 'point',
        position,
        walkable: true,
        penalty: 0,
        tag: 0,
        runtimeGraphIndex: 1,
        declaredVertexCount: 0,
        vertices: [],
        connections,
        error: '',
    };
}

function rawConnection(
    targetGraphArrayIndex: number,
    targetNodeIndex: number,
    targetRuntimeGraphIndex: number,
    cost: number
): JsonObject {
    return {
        loose: false,
        targetGraphArrayIndex,
        targetNodeIndex,
        targetRuntimeGraphIndex,
        cost,
        shapeEdge: 0,
    };
}

function endpointMapping(
    graphRole: 'general' | 'road',
    graphArrayIndex: number,
    graphName: string,
    projectionMethod: string
): JsonObject {
    return {
        subjectKind: 'property-spawn',
        subjectCode: 'warehouse',
        subjectInstanceKey: '',
        endpointIndex: 0,
        position: point(0, 0),
        graphRole,
        graphName,
        graphArrayIndex,
        nearestNodeIndex: 0,
        nearestNodePosition: point(0, 0),
        nearestGraphPosition: point(0, 0),
        projectionMethod,
        nodeCenterDistance: 0,
        graphDistance: 0,
        error: '',
    };
}

function connection(
    sourceNodeIndex: number,
    targetNodeIndex: number,
    rawCost: number,
    geometricDistance: number
) {
    return {
        sourceNodeIndex,
        targetNodeIndex,
        rawCost,
        geometricDistance,
        loose: false,
        shapeEdge: 0,
    };
}

function point(x: number, z: number): JsonObject {
    return { x, y: 0, z };
}
