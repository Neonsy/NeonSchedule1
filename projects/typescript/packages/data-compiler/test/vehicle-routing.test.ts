import { describe, expect, it } from 'vitest';

import {
    analyzeVehiclePropertyShopRoutes,
    type VehicleNavigation,
    type VehicleNavigationConnection,
    type VehicleNavigationEndpointMapping,
    type VehicleNavigationGraph,
    type VehicleNavigationGraphRole,
    type VehicleNavigationNode,
} from '@neonschedule1/core';

describe('vehicle property-to-shop route analysis', () => {
    it('finds deterministic directed candidates using geometric distance instead of raw cost', () => {
        const input = navigation();
        const source = input.endpointMappings.find((mapping) =>
            mapping.graphRole === 'general' && mapping.subjectKind === 'property-spawn'
        )!;
        source.position = { x: -3, y: 0, z: 0 };
        source.nodeCenterDistance = 3;
        source.graphDistance = 3;
        const destination = input.endpointMappings.find((mapping) =>
            mapping.graphRole === 'general' && mapping.subjectKind === 'shop-position'
        )!;
        destination.position = { x: 6, y: 0, z: 0 };
        destination.nodeCenterDistance = 4;
        destination.graphDistance = 4;

        const report = analyzeVehiclePropertyShopRoutes(input);

        expect(report).toMatchObject({
            schema: 'neonschedule1-vehicle-property-shop-routes-1',
            pairBasis: 'every-mapped-property-by-every-mapped-shop',
            pathDirection: 'directed',
            pathSelection: 'minimum-geometric-distance-per-endpoint-pair-within-layer',
            rawCostStatus: 'preserved-not-used',
            nativePathChoiceStatus: 'unproven',
            endpointAccessStatus: 'unproven',
            layerCompositionStatus: 'unproven',
            routeProofStatus: 'incomplete',
            propertyCodes: ['barn'],
            shopCodes: ['hardware'],
        });
        expect(report.pairs).toHaveLength(1);
        expect(report.pairs[0]).toMatchObject({
            propertyCode: 'barn',
            shopCode: 'hardware',
            graphCandidateStatus: 'available',
            routeProofStatus: 'incomplete',
            limitations: ['endpoint-access-unproven', 'layer-composition-unproven'],
        });
        const general = report.pairs[0]!.layers[0]!;
        expect(general).toMatchObject({
            graphRole: 'general',
            graphCandidateStatus: 'available',
            reason: 'route-candidates-found',
            sourceEndpointCount: 1,
            destinationEndpointCount: 2,
        });
        expect(general.candidates).toHaveLength(2);
        expect(general.candidates[0]).toMatchObject({
            points: [
                { nodeIndex: 0, position: { x: 0, y: 0, z: 0 } },
                { nodeIndex: 1, position: { x: 1, y: 0, z: 0 } },
                { nodeIndex: 2, position: { x: 2, y: 0, z: 0 } },
            ],
            networkDistance: 2,
            rawCostStatus: 'preserved-not-used',
            nativePathChoiceStatus: 'unproven',
            source: { graphDistance: 3 },
            destination: {
                subjectKind: 'shop-position',
                endpointIndex: 0,
                graphDistance: 4,
            },
        });
        expect(general.candidates[1]).toMatchObject({
            points: [
                { nodeIndex: 0 },
                { nodeIndex: 3 },
            ],
            networkDistance: 4,
            destination: { subjectKind: 'delivery-bay', endpointIndex: 0 },
        });
    });

    it('does not reverse directed edges or combine graph layers', () => {
        const input = navigation();
        input.endpointMappings = input.endpointMappings.map((mapping) =>
            mapping.subjectKind === 'property-spawn'
                ? { ...mapping, nodeIndex: mapping.graphRole === 'general' ? 4 : 1 }
                : mapping
        );

        const pair = analyzeVehiclePropertyShopRoutes(input).pairs[0]!;

        expect(pair.layers).toEqual([
            expect.objectContaining({
                graphRole: 'general',
                graphCandidateStatus: 'unavailable',
                reason: 'directed-disconnection',
                candidates: [],
            }),
            expect.objectContaining({
                graphRole: 'road',
                graphCandidateStatus: 'unavailable',
                reason: 'directed-disconnection',
                candidates: [],
            }),
        ]);
        expect(pair).toMatchObject({
            graphCandidateStatus: 'unavailable',
            routeProofStatus: 'incomplete',
        });
    });

    it('analyzes the Cartesian product of mapped property and shop identities', () => {
        const input = navigation();
        input.endpointMappings.push(
            ...pairedEndpoints('property-spawn', 'warehouse', 0),
            ...pairedEndpoints('shop-position', 'gas-mart', 2)
        );

        const report = analyzeVehiclePropertyShopRoutes(input);

        expect(report.propertyCodes).toEqual(['barn', 'warehouse']);
        expect(report.shopCodes).toEqual(['gas-mart', 'hardware']);
        expect(report.pairs.map(({ propertyCode, shopCode }) =>
            `${propertyCode}/${shopCode}`
        )).toEqual([
            'barn/gas-mart',
            'barn/hardware',
            'warehouse/gas-mart',
            'warehouse/hardware',
        ]);
    });

    it('rejects structurally invalid normalized graph references at the public boundary', () => {
        const input = navigation();
        input.graphs[0]!.connections[0] = {
            ...input.graphs[0]!.connections[0]!,
            targetNodeIndex: 99,
        };

        expect(() => analyzeVehiclePropertyShopRoutes(input)).toThrow(
            'Vehicle general connection 0 references a missing node'
        );
    });
});

function navigation(): VehicleNavigation {
    return {
        schema: 'neonschedule1-vehicle-navigation-1',
        sourceMethod: 'native-graph-capture',
        sourceApplicability: 'static-vehicle-topology',
        sourceLimitation: 'no live driving',
        endpointMappingMethod: 'nearest-walkable-captured-node-by-graph-geometry-distance',
        connectionDirection: 'directed',
        geometricDistanceMethod: 'node-center-euclidean-3d',
        endpointOffsetStatus: 'reported-not-traversable',
        layerCompositionStatus: 'unproven',
        graphs: [
            graph('general', 5, [
                connection(0, 1, 100, 1),
                connection(1, 2, 100, 1),
                connection(0, 2, 1, 5),
                connection(0, 3, 0, 4),
            ]),
            graph('road', 3, [
                connection(0, 1, 0, 3),
                connection(0, 2, 0, 2),
            ]),
        ],
        endpointMappings: [
            ...pairedEndpoints('property-spawn', 'barn', 0),
            ...pairedEndpoints('shop-position', 'hardware', 2),
            ...pairedEndpoints('delivery-bay', 'hardware', 3, { road: 2 }),
        ],
    };
}

function graph(
    role: VehicleNavigationGraphRole,
    nodeCount: number,
    connections: VehicleNavigationConnection[]
): VehicleNavigationGraph {
    return {
        role,
        name: role,
        runtimeType: role === 'general' ? 'Pathfinding.RecastGraph' : 'Pathfinding.PointGraph',
        guid: `${role}-guid`,
        weakComponentCount: 1,
        strongComponentCount: nodeCount,
        nodes: Array.from({ length: nodeCount }, (_, index) => node(index, role)),
        connections,
    };
}

function node(index: number, role: VehicleNavigationGraphRole): VehicleNavigationNode {
    return {
        index,
        runtimeType: role === 'general'
            ? 'Pathfinding.TriangleMeshNode'
            : 'Pathfinding.PointNode',
        geometryKind: role === 'general' ? 'triangle-mesh' : 'point',
        position: { x: index, y: 0, z: 0 },
        walkable: true,
        penalty: 0,
        tag: 0,
        vertices: role === 'general'
            ? [
                { x: index, y: 0, z: 0 },
                { x: index + 1, y: 0, z: 0 },
                { x: index, y: 0, z: 1 },
            ]
            : [],
        weakComponentId: 0,
        strongComponentId: index,
    };
}

function connection(
    sourceNodeIndex: number,
    targetNodeIndex: number,
    rawCost: number,
    geometricDistance: number
): VehicleNavigationConnection {
    return {
        sourceNodeIndex,
        targetNodeIndex,
        rawCost,
        geometricDistance,
        loose: false,
        shapeEdge: 0,
    };
}

function pairedEndpoints(
    subjectKind: string,
    subjectCode: string,
    generalNodeIndex: number,
    override: { readonly road?: number } = {}
): VehicleNavigationEndpointMapping[] {
    return [
        endpoint(subjectKind, subjectCode, 'general', generalNodeIndex),
        endpoint(subjectKind, subjectCode, 'road', override.road ?? Math.min(generalNodeIndex, 2)),
    ];
}

function endpoint(
    subjectKind: string,
    subjectCode: string,
    graphRole: VehicleNavigationGraphRole,
    nodeIndex: number
): VehicleNavigationEndpointMapping {
    return {
        subjectKind,
        subjectCode,
        subjectInstanceKey: '',
        endpointIndex: 0,
        graphRole,
        position: { x: nodeIndex, y: 0, z: 0 },
        nodeIndex,
        graphPosition: { x: nodeIndex, y: 0, z: 0 },
        projectionMethod: graphRole === 'general' ? 'triangle-surface' : 'node-position',
        nodeCenterDistance: 0,
        graphDistance: 0,
        weakComponentId: 0,
        strongComponentId: nodeIndex,
    };
}
