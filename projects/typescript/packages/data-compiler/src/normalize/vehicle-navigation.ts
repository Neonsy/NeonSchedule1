import {
    VehicleNavigationSchema,
    type VehicleNavigation,
    type VehicleNavigationConnection,
    type VehicleNavigationEndpointMapping,
    type VehicleNavigationGraph,
    type VehicleNavigationGraphRole,
    type VehicleNavigationNode,
    type Vector3,
} from '@neonschedule1/core';

import type { RawReport } from '#data-compiler/acquisition/types';
import { Integrity } from '#data-compiler/integrity';
import {
    asObject,
    booleanField,
    numberField,
    objectArray,
    stringField,
    vector3,
    type JsonObject,
} from '#data-compiler/json';
import { vehicleNavigationComponents } from '#data-compiler/normalize/vehicle-navigation-components';

interface GraphDescriptor {
    readonly raw: JsonObject;
    readonly path: string;
    readonly role: VehicleNavigationGraphRole;
    readonly arrayIndex: number;
    readonly runtimeGraphIndex: number;
    readonly name: string;
    readonly runtimeType: string;
    readonly guid: string;
}

type VehicleNavigationNodeWithoutComponents = Omit<
    VehicleNavigationNode,
    'weakComponentId' | 'strongComponentId'
>;

interface NormalizedGraphRecord {
    readonly descriptor: GraphDescriptor;
    readonly graph: VehicleNavigationGraph;
    readonly nodeByIndex: ReadonlyMap<number, VehicleNavigationNode>;
}

export function normalizeVehicleNavigation(
    report: RawReport,
    propertyCodes: ReadonlySet<string>,
    shopCodes: ReadonlySet<string>,
    integrity: Integrity
): VehicleNavigation {
    const raw = report.discovery.vehicleNavigation;
    const path = 'report.discovery.vehicleNavigation';
    const sourceMethod = stringField(raw, 'method', path);
    const sourceApplicability = stringField(raw, 'applicability', path);
    const sourceLimitation = stringField(raw, 'limitation', path);
    const endpointMappingMethod = stringField(raw, 'endpointMappingMethod', path);
    integrity.check(
        'vehicle navigation capture completed',
        stringField(raw, 'error', path) === '',
        'Vehicle navigation capture failed'
    );
    integrity.check(
        'vehicle navigation source metadata is present',
        sourceMethod.trim().length > 0 &&
            sourceApplicability.trim().length > 0 &&
            sourceLimitation.trim().length > 0 &&
            endpointMappingMethod.trim().length > 0,
        'Vehicle navigation source metadata is blank'
    );

    const descriptors = objectArray(raw.graphs, `${path}.graphs`).map((graph, index) =>
        graphDescriptor(graph, index)
    );
    validateGraphDescriptors(descriptors, integrity);
    const graphByArrayIndex = new Map(descriptors.map((graph) => [graph.arrayIndex, graph]));
    const graphRecords = descriptors.map((descriptor) =>
        normalizeGraph(descriptor, graphByArrayIndex, integrity)
    );
    const graphByRole = new Map(graphRecords.map((record) => [record.graph.role, record]));
    const endpointMappings = normalizeEndpointMappings(
        raw,
        graphByArrayIndex,
        graphByRole,
        propertyCodes,
        shopCodes,
        integrity
    );

    return VehicleNavigationSchema.assert({
        schema: 'neonschedule1-vehicle-navigation-1',
        sourceMethod,
        sourceApplicability,
        sourceLimitation,
        endpointMappingMethod,
        connectionDirection: 'directed',
        geometricDistanceMethod: 'node-center-euclidean-3d',
        endpointOffsetStatus: 'reported-not-traversable',
        layerCompositionStatus: 'unproven',
        graphs: graphRecords
            .map(({ graph }) => graph)
            .sort((left, right) => left.role.localeCompare(right.role)),
        endpointMappings,
    } satisfies VehicleNavigation);
}

function graphDescriptor(raw: JsonObject, index: number): GraphDescriptor {
    const path = `report.discovery.vehicleNavigation.graphs[${index}]`;
    return {
        raw,
        path,
        role: graphRole(stringField(raw, 'role', path), `${path}.role`),
        arrayIndex: nonNegativeIntegerField(raw, 'arrayIndex', path),
        runtimeGraphIndex: nonNegativeIntegerField(raw, 'runtimeGraphIndex', path),
        name: stringField(raw, 'name', path),
        runtimeType: stringField(raw, 'runtimeType', path),
        guid: stringField(raw, 'guid', path),
    };
}

function validateGraphDescriptors(
    descriptors: readonly GraphDescriptor[],
    integrity: Integrity
): void {
    const roles = new Set(descriptors.map(({ role }) => role));
    integrity.check(
        'vehicle navigation contains one general and one road graph',
        descriptors.length === 2 && roles.size === 2 && roles.has('general') && roles.has('road'),
        'Vehicle navigation must contain exactly one general graph and one road graph'
    );
    const arrayIndices = new Set(descriptors.map(({ arrayIndex }) => arrayIndex));
    integrity.check(
        'vehicle navigation graph array indices are unique',
        arrayIndices.size === descriptors.length,
        'Vehicle navigation graph array indices are duplicated'
    );
    const runtimeIndices = new Set(descriptors.map(({ runtimeGraphIndex }) => runtimeGraphIndex));
    integrity.check(
        'vehicle navigation runtime graph indices are unique',
        runtimeIndices.size === descriptors.length,
        'Vehicle navigation runtime graph indices are duplicated'
    );
}

function normalizeGraph(
    descriptor: GraphDescriptor,
    graphByArrayIndex: ReadonlyMap<number, GraphDescriptor>,
    integrity: Integrity
): NormalizedGraphRecord {
    const { raw, path, role } = descriptor;
    integrity.check(
        `vehicle navigation ${role} graph capture completed`,
        stringField(raw, 'error', path) === '',
        `Vehicle navigation ${role} graph capture failed`
    );
    integrity.check(
        `vehicle navigation ${role} graph resolved every connection`,
        nonNegativeIntegerField(raw, 'unresolvedConnectionCount', path) === 0,
        `Vehicle navigation ${role} graph contains unresolved connections`
    );
    validateGraphType(descriptor, integrity);

    const rawNodes = objectArray(raw.nodes, `${path}.nodes`);
    integrity.check(
        `vehicle navigation ${role} graph declared node count matches`,
        nonNegativeIntegerField(raw, 'declaredNodeCount', path) === rawNodes.length,
        `Vehicle navigation ${role} graph declared node count does not match its nodes`
    );
    const parsedNodes = rawNodes.map((node, index) =>
        normalizeNode(node, index, descriptor, integrity)
    );
    const nodeByIndex = new Map<number, VehicleNavigationNodeWithoutComponents>();
    for (const node of parsedNodes) {
        if (nodeByIndex.has(node.index)) {
            integrity.addError(
                `Vehicle navigation ${role} graph contains duplicate node index ${node.index}`
            );
            continue;
        }
        nodeByIndex.set(node.index, node);
    }
    integrity.check(
        `vehicle navigation ${role} graph contains nodes`,
        nodeByIndex.size > 0,
        `Vehicle navigation ${role} graph contains no nodes`
    );

    const connections = normalizeConnections(
        rawNodes,
        descriptor,
        graphByArrayIndex,
        nodeByIndex,
        integrity
    );
    const nodeIndices = [...nodeByIndex.keys()].sort((left, right) => left - right);
    const components = vehicleNavigationComponents(nodeIndices, connections);
    const nodes = nodeIndices.map<VehicleNavigationNode>((nodeIndex) => ({
        ...nodeByIndex.get(nodeIndex)!,
        weakComponentId: components.weakComponentByNode.get(nodeIndex)!,
        strongComponentId: components.strongComponentByNode.get(nodeIndex)!,
    }));
    const normalizedNodeByIndex = new Map(nodes.map((node) => [node.index, node]));
    const graph: VehicleNavigationGraph = {
        role,
        name: descriptor.name,
        runtimeType: descriptor.runtimeType,
        guid: descriptor.guid,
        weakComponentCount: components.weakComponentCount,
        strongComponentCount: components.strongComponentCount,
        nodes,
        connections,
    };
    return { descriptor, graph, nodeByIndex: normalizedNodeByIndex };
}

function validateGraphType(descriptor: GraphDescriptor, integrity: Integrity): void {
    const expectedRuntimeType = descriptor.role === 'general'
        ? 'Pathfinding.RecastGraph'
        : 'Pathfinding.PointGraph';
    integrity.check(
        `vehicle navigation ${descriptor.role} graph has the expected runtime type`,
        descriptor.runtimeType === expectedRuntimeType,
        `Vehicle navigation ${descriptor.role} graph runtime type is ${JSON.stringify(descriptor.runtimeType)}, expected ${expectedRuntimeType}`
    );
    integrity.check(
        `vehicle navigation ${descriptor.role} graph identity is present`,
        descriptor.name.trim().length > 0 && descriptor.guid.trim().length > 0,
        `Vehicle navigation ${descriptor.role} graph name or GUID is blank`
    );
}

function normalizeNode(
    raw: JsonObject,
    nodePosition: number,
    graph: GraphDescriptor,
    integrity: Integrity
): VehicleNavigationNodeWithoutComponents {
    const path = `${graph.path}.nodes[${nodePosition}]`;
    const index = nonNegativeIntegerField(raw, 'index', path);
    const runtimeType = stringField(raw, 'runtimeType', path);
    const geometryKind = stringField(raw, 'geometryKind', path);
    const walkable = booleanField(raw, 'walkable', path);
    const vertices = objectArray(raw.vertices, `${path}.vertices`).map((vertex, vertexIndex) =>
        vector3(vertex, `${path}.vertices[${vertexIndex}]`)
    );
    const expectedGeometryKind = graph.role === 'general' ? 'triangle-mesh' : 'point';
    const expectedRuntimeType = graph.role === 'general'
        ? 'Pathfinding.TriangleMeshNode'
        : 'Pathfinding.PointNode';
    const expectedVertexCount = graph.role === 'general' ? 3 : 0;
    if (stringField(raw, 'error', path) !== '') {
        integrity.addError(`Vehicle navigation ${graph.role} node ${index} capture failed`);
    }
    if (nonNegativeIntegerField(raw, 'runtimeGraphIndex', path) !== graph.runtimeGraphIndex) {
        integrity.addError(
            `Vehicle navigation ${graph.role} node ${index} has a mismatched runtime graph index`
        );
    }
    if (
        runtimeType !== expectedRuntimeType ||
        geometryKind !== expectedGeometryKind ||
        nonNegativeIntegerField(raw, 'declaredVertexCount', path) !== vertices.length ||
        vertices.length !== expectedVertexCount
    ) {
        integrity.addError(`Vehicle navigation ${graph.role} node ${index} has unexpected geometry`);
    }
    if (!walkable) {
        integrity.addError(`Vehicle navigation ${graph.role} node ${index} is not walkable`);
    }
    return {
        index,
        runtimeType,
        geometryKind,
        position: vector3(raw.position, `${path}.position`),
        walkable,
        penalty: nonNegativeIntegerField(raw, 'penalty', path),
        tag: nonNegativeIntegerField(raw, 'tag', path),
        vertices,
    };
}

function normalizeConnections(
    rawNodes: readonly JsonObject[],
    graph: GraphDescriptor,
    graphByArrayIndex: ReadonlyMap<number, GraphDescriptor>,
    nodeByIndex: ReadonlyMap<number, VehicleNavigationNodeWithoutComponents>,
    integrity: Integrity
): VehicleNavigationConnection[] {
    const connections: VehicleNavigationConnection[] = [];
    const identities = new Set<string>();
    rawNodes.forEach((rawNode, nodePosition) => {
        const nodePath = `${graph.path}.nodes[${nodePosition}]`;
        const sourceNodeIndex = nonNegativeIntegerField(rawNode, 'index', nodePath);
        objectArray(rawNode.connections, `${nodePath}.connections`).forEach((raw, index) => {
            const path = `${nodePath}.connections[${index}]`;
            const targetGraphArrayIndex = nonNegativeIntegerField(
                raw,
                'targetGraphArrayIndex',
                path
            );
            const targetNodeIndex = nonNegativeIntegerField(raw, 'targetNodeIndex', path);
            const targetGraph = graphByArrayIndex.get(targetGraphArrayIndex);
            if (targetGraph === undefined) {
                integrity.addError(
                    `Vehicle navigation connection ${graph.role}/${sourceNodeIndex} -> ${targetNodeIndex} targets a missing graph`
                );
                return;
            }
            if (targetGraph.role !== graph.role) {
                integrity.addError(
                    `Vehicle navigation connection ${graph.role}/${sourceNodeIndex} -> ${targetGraph.role}/${targetNodeIndex} crosses graph layers`
                );
                return;
            }
            if (
                nonNegativeIntegerField(raw, 'targetRuntimeGraphIndex', path) !==
                graph.runtimeGraphIndex
            ) {
                integrity.addError(
                    `Vehicle navigation connection ${graph.role}/${sourceNodeIndex} -> ${targetNodeIndex} has a mismatched target runtime graph index`
                );
            }
            const sourceNode = nodeByIndex.get(sourceNodeIndex);
            const targetNode = nodeByIndex.get(targetNodeIndex);
            if (sourceNode === undefined || targetNode === undefined) {
                integrity.addError(
                    `Vehicle navigation connection ${graph.role}/${sourceNodeIndex} -> ${targetNodeIndex} references a missing node`
                );
                return;
            }
            if (sourceNodeIndex === targetNodeIndex) {
                integrity.addError(
                    `Vehicle navigation ${graph.role} connection ${sourceNodeIndex} is a self-connection`
                );
                return;
            }
            const identity = `${sourceNodeIndex}\0${targetNodeIndex}`;
            if (identities.has(identity)) {
                integrity.addError(
                    `Vehicle navigation ${graph.role} connection ${sourceNodeIndex} -> ${targetNodeIndex} is duplicated`
                );
                return;
            }
            identities.add(identity);
            const geometricDistance = distance(sourceNode.position, targetNode.position);
            if (geometricDistance <= 0) {
                integrity.addError(
                    `Vehicle navigation ${graph.role} connection ${sourceNodeIndex} -> ${targetNodeIndex} has zero geometric distance`
                );
            }
            connections.push({
                sourceNodeIndex,
                targetNodeIndex,
                rawCost: nonNegativeIntegerField(raw, 'cost', path),
                geometricDistance,
                loose: booleanField(raw, 'loose', path),
                shapeEdge: nonNegativeIntegerField(raw, 'shapeEdge', path),
            });
        });
    });
    return connections.sort((left, right) =>
        left.sourceNodeIndex - right.sourceNodeIndex ||
        left.targetNodeIndex - right.targetNodeIndex
    );
}

function normalizeEndpointMappings(
    rawNavigation: JsonObject,
    graphByArrayIndex: ReadonlyMap<number, GraphDescriptor>,
    graphByRole: ReadonlyMap<VehicleNavigationGraphRole, NormalizedGraphRecord>,
    propertyCodes: ReadonlySet<string>,
    shopCodes: ReadonlySet<string>,
    integrity: Integrity
): VehicleNavigationEndpointMapping[] {
    const path = 'report.discovery.vehicleNavigation.endpointMappings';
    const mappings: VehicleNavigationEndpointMapping[] = [];
    const fullIdentities = new Set<string>();
    const rolesByEndpoint = new Map<string, Set<VehicleNavigationGraphRole>>();
    objectArray(rawNavigation.endpointMappings, path).forEach((raw, index) => {
        const endpointPath = `${path}[${index}]`;
        const subjectKind = stringField(raw, 'subjectKind', endpointPath);
        const subjectCode = stringField(raw, 'subjectCode', endpointPath);
        const subjectInstanceKey = stringField(raw, 'subjectInstanceKey', endpointPath);
        const endpointIndex = nonNegativeIntegerField(raw, 'endpointIndex', endpointPath);
        const graphRoleValue = graphRole(
            stringField(raw, 'graphRole', endpointPath),
            `${endpointPath}.graphRole`
        );
        const endpointIdentity = [
            subjectKind,
            subjectCode,
            subjectInstanceKey,
            endpointIndex,
        ].join('\0');
        const fullIdentity = `${endpointIdentity}\0${graphRoleValue}`;
        if (fullIdentities.has(fullIdentity)) {
            integrity.addError(
                `Vehicle navigation endpoint mapping ${subjectKind}/${subjectCode}/${endpointIndex}/${graphRoleValue} is duplicated`
            );
            return;
        }
        fullIdentities.add(fullIdentity);
        const endpointRoles = rolesByEndpoint.get(endpointIdentity) ?? new Set();
        endpointRoles.add(graphRoleValue);
        rolesByEndpoint.set(endpointIdentity, endpointRoles);

        validateEndpointSubject(subjectKind, subjectCode, propertyCodes, shopCodes, integrity);
        integrity.check(
            `vehicle navigation endpoint mapping ${index} capture completed`,
            stringField(raw, 'error', endpointPath) === '',
            `Vehicle navigation endpoint mapping ${index} failed`
        );
        const sourceArrayIndex = nonNegativeIntegerField(raw, 'graphArrayIndex', endpointPath);
        const sourceGraph = graphByArrayIndex.get(sourceArrayIndex);
        if (sourceGraph === undefined || sourceGraph.role !== graphRoleValue) {
            integrity.addError(
                `Vehicle navigation endpoint mapping ${index} has a mismatched graph identity`
            );
            return;
        }
        if (stringField(raw, 'graphName', endpointPath) !== sourceGraph.name) {
            integrity.addError(
                `Vehicle navigation endpoint mapping ${index} has a mismatched graph name`
            );
        }
        const normalizedGraph = graphByRole.get(graphRoleValue);
        const nodeIndex = nonNegativeIntegerField(raw, 'nearestNodeIndex', endpointPath);
        const node = normalizedGraph?.nodeByIndex.get(nodeIndex);
        if (node === undefined) {
            integrity.addError(
                `Vehicle navigation endpoint mapping ${index} references missing ${graphRoleValue} node ${nodeIndex}`
            );
            return;
        }
        const position = vector3(raw.position, `${endpointPath}.position`);
        const reportedNodePosition = vector3(
            raw.nearestNodePosition,
            `${endpointPath}.nearestNodePosition`
        );
        const graphPosition = vector3(
            raw.nearestGraphPosition,
            `${endpointPath}.nearestGraphPosition`
        );
        const nodeCenterDistance = nonNegativeNumberField(
            raw,
            'nodeCenterDistance',
            endpointPath
        );
        const graphDistance = nonNegativeNumberField(raw, 'graphDistance', endpointPath);
        const projectionMethod = stringField(raw, 'projectionMethod', endpointPath);
        if (!samePosition(reportedNodePosition, node.position)) {
            integrity.addError(
                `Vehicle navigation endpoint mapping ${index} node position does not match node ${nodeIndex}`
            );
        }
        if (!approximatelyEqual(nodeCenterDistance, distance(position, node.position))) {
            integrity.addError(
                `Vehicle navigation endpoint mapping ${index} node-center distance is inconsistent`
            );
        }
        if (!approximatelyEqual(graphDistance, distance(position, graphPosition))) {
            integrity.addError(
                `Vehicle navigation endpoint mapping ${index} graph distance is inconsistent`
            );
        }
        if (graphDistance > nodeCenterDistance &&
            !approximatelyEqual(graphDistance, nodeCenterDistance)) {
            integrity.addError(
                `Vehicle navigation endpoint mapping ${index} graph distance exceeds its node-center distance`
            );
        }
        const expectedProjectionMethod = graphRoleValue === 'general'
            ? 'triangle-surface'
            : 'node-position';
        if (projectionMethod !== expectedProjectionMethod) {
            integrity.addError(
                `Vehicle navigation endpoint mapping ${index} uses unexpected projection method ${JSON.stringify(projectionMethod)}`
            );
        }
        if (graphRoleValue === 'road' && !samePosition(graphPosition, node.position)) {
            integrity.addError(
                `Vehicle navigation road endpoint mapping ${index} does not project to its point node`
            );
        }
        mappings.push({
            subjectKind,
            subjectCode,
            subjectInstanceKey,
            endpointIndex,
            graphRole: graphRoleValue,
            position,
            nodeIndex,
            graphPosition,
            projectionMethod,
            nodeCenterDistance,
            graphDistance,
            weakComponentId: node.weakComponentId,
            strongComponentId: node.strongComponentId,
        });
    });
    for (const [identity, roles] of rolesByEndpoint) {
        if (roles.size !== 2 || !roles.has('general') || !roles.has('road')) {
            integrity.addError(
                `Vehicle navigation endpoint ${JSON.stringify(identity)} does not have both graph-layer mappings`
            );
        }
    }
    integrity.check(
        'vehicle navigation contains endpoint mappings',
        mappings.length > 0,
        'Vehicle navigation contains no endpoint mappings'
    );
    return mappings.sort(compareEndpointMappings);
}

function validateEndpointSubject(
    subjectKind: string,
    subjectCode: string,
    propertyCodes: ReadonlySet<string>,
    shopCodes: ReadonlySet<string>,
    integrity: Integrity
): void {
    if (subjectKind === 'property-spawn') {
        if (!propertyCodes.has(subjectCode)) {
            integrity.addError(
                `Vehicle navigation endpoint references missing property ${JSON.stringify(subjectCode)}`
            );
        }
        return;
    }
    if (subjectKind === 'shop-position' || subjectKind === 'delivery-bay') {
        if (!shopCodes.has(subjectCode)) {
            integrity.addError(
                `Vehicle navigation endpoint references missing shop ${JSON.stringify(subjectCode)}`
            );
        }
        return;
    }
    integrity.addError(
        `Vehicle navigation endpoint has unsupported subject kind ${JSON.stringify(subjectKind)}`
    );
}

function graphRole(value: string, path: string): VehicleNavigationGraphRole {
    if (value === 'general' || value === 'road') return value;
    throw new TypeError(`${path} must be general or road`);
}

function nonNegativeIntegerField(object: JsonObject, key: string, path: string): number {
    const value = numberField(object, key, path);
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`${path}.${key} must be a non-negative safe integer`);
    }
    return value;
}

function nonNegativeNumberField(object: JsonObject, key: string, path: string): number {
    const value = numberField(object, key, path);
    if (value < 0) throw new TypeError(`${path}.${key} must be non-negative`);
    return value;
}

function distance(left: Vector3, right: Vector3): number {
    return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function samePosition(left: Vector3, right: Vector3): boolean {
    return approximatelyEqual(left.x, right.x) &&
        approximatelyEqual(left.y, right.y) &&
        approximatelyEqual(left.z, right.z);
}

function approximatelyEqual(left: number, right: number): boolean {
    return Math.abs(left - right) <= 1e-5 * Math.max(1, Math.abs(left), Math.abs(right));
}

function compareEndpointMappings(
    left: VehicleNavigationEndpointMapping,
    right: VehicleNavigationEndpointMapping
): number {
    return left.subjectKind.localeCompare(right.subjectKind) ||
        left.subjectCode.localeCompare(right.subjectCode) ||
        left.subjectInstanceKey.localeCompare(right.subjectInstanceKey) ||
        left.endpointIndex - right.endpointIndex ||
        left.graphRole.localeCompare(right.graphRole);
}
