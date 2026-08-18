import {
    VehicleNavigationSchema,
    type VehicleNavigation,
    type VehicleNavigationEndpointMapping,
    type VehicleNavigationGraph,
    type VehicleNavigationGraphRole,
} from '#core/data/vehicle-navigation';
import type { Vector3 } from '#core/data/common';

export type VehicleRouteEvidenceLimitation =
    | 'endpoint-access-unproven'
    | 'layer-composition-unproven';

export interface VehicleRouteEndpoint {
    readonly subjectKind: string;
    readonly subjectCode: string;
    readonly subjectInstanceKey: string;
    readonly endpointIndex: number;
    readonly position: Vector3;
    readonly nodeIndex: number;
    readonly graphPosition: Vector3;
    readonly projectionMethod: string;
    readonly nodeCenterDistance: number;
    readonly graphDistance: number;
}

export interface VehicleGraphRoutePoint {
    readonly nodeIndex: number;
    readonly position: Vector3;
}

export interface VehicleGraphRouteCandidate {
    readonly graphRole: VehicleNavigationGraphRole;
    readonly source: VehicleRouteEndpoint;
    readonly destination: VehicleRouteEndpoint;
    readonly points: readonly VehicleGraphRoutePoint[];
    readonly networkDistance: number;
    readonly distanceMethod: 'node-center-euclidean-3d';
    readonly distanceScope: 'directed-graph-edges-only';
    readonly selectionBasis: 'minimum-geometric-distance-per-endpoint-pair-within-layer';
    readonly rawCostStatus: 'preserved-not-used';
    readonly nativePathChoiceStatus: 'unproven';
}

export interface VehicleRouteLayerAnalysis {
    readonly graphRole: VehicleNavigationGraphRole;
    readonly graphCandidateStatus: 'available' | 'unavailable';
    readonly reason: 'route-candidates-found' | 'unmapped-endpoint' | 'directed-disconnection';
    readonly sourceEndpointCount: number;
    readonly destinationEndpointCount: number;
    readonly candidates: readonly VehicleGraphRouteCandidate[];
}

export interface VehiclePropertyShopRouteAnalysis {
    readonly propertyCode: string;
    readonly shopCode: string;
    readonly graphCandidateStatus: 'available' | 'unavailable';
    readonly routeProofStatus: 'incomplete';
    readonly limitations: readonly VehicleRouteEvidenceLimitation[];
    readonly layers: readonly VehicleRouteLayerAnalysis[];
}

export interface VehiclePropertyShopRouteReport {
    readonly schema: 'neonschedule1-vehicle-property-shop-routes-1';
    readonly sourceSchema: 'neonschedule1-vehicle-navigation-1';
    readonly pairBasis: 'every-mapped-property-by-every-mapped-shop';
    readonly pathDirection: 'directed';
    readonly pathSelection: 'minimum-geometric-distance-per-endpoint-pair-within-layer';
    readonly rawCostStatus: 'preserved-not-used';
    readonly nativePathChoiceStatus: 'unproven';
    readonly endpointAccessStatus: 'unproven';
    readonly layerCompositionStatus: 'unproven';
    readonly routeProofStatus: 'incomplete';
    readonly propertyCodes: readonly string[];
    readonly shopCodes: readonly string[];
    readonly pairs: readonly VehiclePropertyShopRouteAnalysis[];
}

interface IndexedGraph {
    readonly nodeIndices: ReadonlySet<number>;
    readonly nodePositionByIndex: ReadonlyMap<number, Vector3>;
    readonly connectionsBySource: ReadonlyMap<number, readonly GraphConnection[]>;
}

interface GraphConnection {
    readonly targetNodeIndex: number;
    readonly geometricDistance: number;
}

interface ShortestPathTree {
    readonly startNodeIndex: number;
    readonly distanceByNode: ReadonlyMap<number, number>;
    readonly previousByNode: ReadonlyMap<number, number>;
}

interface QueueEntry {
    readonly nodeIndex: number;
    readonly distance: number;
}

const graphRoles = ['general', 'road'] as const;
const routeLimitations = [
    'endpoint-access-unproven',
    'layer-composition-unproven',
] as const satisfies readonly VehicleRouteEvidenceLimitation[];

export function analyzeVehiclePropertyShopRoutes(
    input: VehicleNavigation
): VehiclePropertyShopRouteReport {
    const navigation = VehicleNavigationSchema.assert(input);
    validateEvidenceBoundary(navigation);
    const graphs = indexGraphs(navigation.graphs);
    const endpoints = indexEndpoints(navigation.endpointMappings, graphs);
    const propertyCodes = uniqueSorted(navigation.endpointMappings
        .filter(({ subjectKind }) => subjectKind === 'property-spawn')
        .map(({ subjectCode }) => subjectCode));
    const shopCodes = uniqueSorted(navigation.endpointMappings
        .filter(({ subjectKind }) => isShopEndpoint(subjectKind))
        .map(({ subjectCode }) => subjectCode));
    const shortestPathCache = new Map<string, ShortestPathTree>();

    const pairs = propertyCodes.flatMap((propertyCode) => shopCodes.map((shopCode) => {
        const layers = graphRoles.map((role) => analyzeLayer(
            role,
            propertyCode,
            shopCode,
            graphs,
            endpoints,
            shortestPathCache
        ));
        return {
            propertyCode,
            shopCode,
            graphCandidateStatus: layers.some(({ graphCandidateStatus }) =>
                graphCandidateStatus === 'available') ? 'available' : 'unavailable',
            routeProofStatus: 'incomplete',
            limitations: routeLimitations,
            layers,
        } satisfies VehiclePropertyShopRouteAnalysis;
    }));

    return {
        schema: 'neonschedule1-vehicle-property-shop-routes-1',
        sourceSchema: navigation.schema,
        pairBasis: 'every-mapped-property-by-every-mapped-shop',
        pathDirection: navigation.connectionDirection,
        pathSelection: 'minimum-geometric-distance-per-endpoint-pair-within-layer',
        rawCostStatus: 'preserved-not-used',
        nativePathChoiceStatus: 'unproven',
        endpointAccessStatus: 'unproven',
        layerCompositionStatus: navigation.layerCompositionStatus,
        routeProofStatus: 'incomplete',
        propertyCodes,
        shopCodes,
        pairs,
    };
}

function validateEvidenceBoundary(navigation: VehicleNavigation): void {
    if (navigation.geometricDistanceMethod !== 'node-center-euclidean-3d') {
        throw new Error('Vehicle routing requires node-center Euclidean edge distances');
    }
    if (navigation.endpointOffsetStatus !== 'reported-not-traversable') {
        throw new Error('Vehicle routing received an unsupported endpoint access contract');
    }
    if (navigation.layerCompositionStatus !== 'unproven') {
        throw new Error('Vehicle routing received an unsupported layer composition contract');
    }
}

function indexGraphs(
    graphs: readonly VehicleNavigationGraph[]
): ReadonlyMap<VehicleNavigationGraphRole, IndexedGraph> {
    const indexed = new Map<VehicleNavigationGraphRole, IndexedGraph>();
    for (const role of graphRoles) {
        const matching = graphs.filter((graph) => graph.role === role);
        if (matching.length !== 1) {
            throw new Error(`Vehicle navigation must contain exactly one ${role} graph`);
        }
        const graph = matching[0]!;
        const nodeIndices = new Set<number>();
        const nodePositionByIndex = new Map<number, Vector3>();
        for (const node of graph.nodes) {
            requireNodeIndex(node.index, `${role} node index`);
            if (nodeIndices.has(node.index)) {
                throw new Error(`Vehicle ${role} graph contains duplicate node ${node.index}`);
            }
            nodeIndices.add(node.index);
            nodePositionByIndex.set(node.index, copyPosition(node.position));
        }
        const connectionsBySource = new Map<number, GraphConnection[]>();
        const connectionKeys = new Set<string>();
        for (const [connectionIndex, connection] of graph.connections.entries()) {
            if (!nodeIndices.has(connection.sourceNodeIndex) ||
                !nodeIndices.has(connection.targetNodeIndex)) {
                throw new Error(
                    `Vehicle ${role} connection ${connectionIndex} references a missing node`
                );
            }
            if (!Number.isFinite(connection.geometricDistance) ||
                connection.geometricDistance <= 0) {
                throw new RangeError(
                    `Vehicle ${role} connection ${connectionIndex} distance must be positive`
                );
            }
            const key = `${connection.sourceNodeIndex}\0${connection.targetNodeIndex}`;
            if (connectionKeys.has(key)) {
                throw new Error(
                    `Vehicle ${role} graph contains duplicate connection ` +
                    `${connection.sourceNodeIndex} -> ${connection.targetNodeIndex}`
                );
            }
            connectionKeys.add(key);
            const entry = {
                targetNodeIndex: connection.targetNodeIndex,
                geometricDistance: connection.geometricDistance,
            };
            const connections = connectionsBySource.get(connection.sourceNodeIndex);
            if (connections === undefined) {
                connectionsBySource.set(connection.sourceNodeIndex, [entry]);
            } else {
                connections.push(entry);
            }
        }
        for (const connections of connectionsBySource.values()) {
            connections.sort((left, right) =>
                left.targetNodeIndex - right.targetNodeIndex ||
                left.geometricDistance - right.geometricDistance
            );
        }
        indexed.set(role, { nodeIndices, nodePositionByIndex, connectionsBySource });
    }
    if (graphs.length !== graphRoles.length) {
        throw new Error('Vehicle navigation contains unsupported graph layers');
    }
    return indexed;
}

function indexEndpoints(
    mappings: readonly VehicleNavigationEndpointMapping[],
    graphs: ReadonlyMap<VehicleNavigationGraphRole, IndexedGraph>
): ReadonlyMap<string, readonly VehicleNavigationEndpointMapping[]> {
    const indexed = new Map<string, VehicleNavigationEndpointMapping[]>();
    const identities = new Set<string>();
    for (const mapping of mappings) {
        if (!isSupportedEndpoint(mapping.subjectKind)) {
            throw new Error(
                `Vehicle routing received unsupported endpoint kind ` +
                JSON.stringify(mapping.subjectKind)
            );
        }
        const graph = graphs.get(mapping.graphRole)!;
        if (!graph.nodeIndices.has(mapping.nodeIndex)) {
            throw new Error(
                `Vehicle ${mapping.graphRole} endpoint references missing node ${mapping.nodeIndex}`
            );
        }
        if (!Number.isFinite(mapping.graphDistance) || mapping.graphDistance < 0) {
            throw new RangeError('Vehicle endpoint graph distance must be non-negative');
        }
        const identity = endpointIdentity(mapping);
        if (identities.has(identity)) {
            throw new Error(`Vehicle navigation contains duplicate endpoint ${identity}`);
        }
        identities.add(identity);
        const key = endpointGroupKey(mapping.graphRole, mapping.subjectKind, mapping.subjectCode);
        const group = indexed.get(key);
        if (group === undefined) indexed.set(key, [mapping]);
        else group.push(mapping);
    }
    for (const group of indexed.values()) group.sort(compareEndpointMappings);
    return indexed;
}

function analyzeLayer(
    graphRole: VehicleNavigationGraphRole,
    propertyCode: string,
    shopCode: string,
    graphs: ReadonlyMap<VehicleNavigationGraphRole, IndexedGraph>,
    endpoints: ReadonlyMap<string, readonly VehicleNavigationEndpointMapping[]>,
    shortestPathCache: Map<string, ShortestPathTree>
): VehicleRouteLayerAnalysis {
    const sourceEndpoints = endpoints.get(endpointGroupKey(
        graphRole,
        'property-spawn',
        propertyCode
    )) ?? [];
    const destinationEndpoints = [
        ...(endpoints.get(endpointGroupKey(graphRole, 'shop-position', shopCode)) ?? []),
        ...(endpoints.get(endpointGroupKey(graphRole, 'delivery-bay', shopCode)) ?? []),
    ].sort(compareEndpointMappings);
    if (sourceEndpoints.length === 0 || destinationEndpoints.length === 0) {
        return {
            graphRole,
            graphCandidateStatus: 'unavailable',
            reason: 'unmapped-endpoint',
            sourceEndpointCount: sourceEndpoints.length,
            destinationEndpointCount: destinationEndpoints.length,
            candidates: [],
        };
    }

    const graph = graphs.get(graphRole)!;
    const candidates = sourceEndpoints.flatMap((source) => destinationEndpoints.flatMap(
        (destination) => {
            const cacheKey = `${graphRole}\0${source.nodeIndex}`;
            let tree = shortestPathCache.get(cacheKey);
            if (tree === undefined) {
                tree = shortestPaths(graph, source.nodeIndex);
                shortestPathCache.set(cacheKey, tree);
            }
            const networkDistance = tree.distanceByNode.get(destination.nodeIndex);
            if (networkDistance === undefined) return [];
            return [{
                graphRole,
                source: routeEndpoint(source),
                destination: routeEndpoint(destination),
                points: reconstructPath(tree, destination.nodeIndex).map((nodeIndex) => ({
                    nodeIndex,
                    position: copyPosition(graph.nodePositionByIndex.get(nodeIndex)!),
                })),
                networkDistance,
                distanceMethod: 'node-center-euclidean-3d',
                distanceScope: 'directed-graph-edges-only',
                selectionBasis: 'minimum-geometric-distance-per-endpoint-pair-within-layer',
                rawCostStatus: 'preserved-not-used',
                nativePathChoiceStatus: 'unproven',
            } satisfies VehicleGraphRouteCandidate];
        }
    )).sort(compareCandidates);

    return {
        graphRole,
        graphCandidateStatus: candidates.length > 0 ? 'available' : 'unavailable',
        reason: candidates.length > 0 ? 'route-candidates-found' : 'directed-disconnection',
        sourceEndpointCount: sourceEndpoints.length,
        destinationEndpointCount: destinationEndpoints.length,
        candidates,
    };
}

function shortestPaths(graph: IndexedGraph, startNodeIndex: number): ShortestPathTree {
    const distanceByNode = new Map<number, number>([[startNodeIndex, 0]]);
    const previousByNode = new Map<number, number>();
    const queue = new MinimumQueue();
    queue.add({ nodeIndex: startNodeIndex, distance: 0 });
    while (queue.size > 0) {
        const current = queue.removeMinimum()!;
        if (current.distance !== distanceByNode.get(current.nodeIndex)) continue;
        for (const connection of graph.connectionsBySource.get(current.nodeIndex) ?? []) {
            const candidateDistance = current.distance + connection.geometricDistance;
            if (!Number.isFinite(candidateDistance)) {
                throw new RangeError('Vehicle route distance exceeds the finite number range');
            }
            const existingDistance = distanceByNode.get(connection.targetNodeIndex);
            const existingPrevious = previousByNode.get(connection.targetNodeIndex);
            if (existingDistance !== undefined &&
                (candidateDistance > existingDistance ||
                    (candidateDistance === existingDistance &&
                        existingPrevious !== undefined && current.nodeIndex >= existingPrevious))) {
                continue;
            }
            distanceByNode.set(connection.targetNodeIndex, candidateDistance);
            previousByNode.set(connection.targetNodeIndex, current.nodeIndex);
            queue.add({
                nodeIndex: connection.targetNodeIndex,
                distance: candidateDistance,
            });
        }
    }
    return { startNodeIndex, distanceByNode, previousByNode };
}

function reconstructPath(tree: ShortestPathTree, endNodeIndex: number): number[] {
    const nodeIndices = [endNodeIndex];
    while (nodeIndices[nodeIndices.length - 1] !== tree.startNodeIndex) {
        const previous = tree.previousByNode.get(nodeIndices[nodeIndices.length - 1]!);
        if (previous === undefined) {
            throw new Error('Vehicle route reconstruction reached an unconnected node');
        }
        nodeIndices.push(previous);
    }
    return nodeIndices.reverse();
}

function routeEndpoint(mapping: VehicleNavigationEndpointMapping): VehicleRouteEndpoint {
    return {
        subjectKind: mapping.subjectKind,
        subjectCode: mapping.subjectCode,
        subjectInstanceKey: mapping.subjectInstanceKey,
        endpointIndex: mapping.endpointIndex,
        position: copyPosition(mapping.position),
        nodeIndex: mapping.nodeIndex,
        graphPosition: copyPosition(mapping.graphPosition),
        projectionMethod: mapping.projectionMethod,
        nodeCenterDistance: mapping.nodeCenterDistance,
        graphDistance: mapping.graphDistance,
    };
}

function isSupportedEndpoint(subjectKind: string): boolean {
    return subjectKind === 'property-spawn' || isShopEndpoint(subjectKind);
}

function isShopEndpoint(subjectKind: string): boolean {
    return subjectKind === 'shop-position' || subjectKind === 'delivery-bay';
}

function endpointGroupKey(
    role: VehicleNavigationGraphRole,
    subjectKind: string,
    subjectCode: string
): string {
    return `${role}\0${subjectKind}\0${subjectCode}`;
}

function endpointIdentity(mapping: VehicleNavigationEndpointMapping): string {
    return [
        mapping.graphRole,
        mapping.subjectKind,
        mapping.subjectCode,
        mapping.subjectInstanceKey,
        mapping.endpointIndex,
    ].join('\0');
}

function compareEndpointMappings(
    left: VehicleNavigationEndpointMapping,
    right: VehicleNavigationEndpointMapping
): number {
    return endpointKindRank(left.subjectKind) - endpointKindRank(right.subjectKind) ||
        left.subjectInstanceKey.localeCompare(right.subjectInstanceKey) ||
        left.endpointIndex - right.endpointIndex ||
        left.nodeIndex - right.nodeIndex;
}

function endpointKindRank(subjectKind: string): number {
    if (subjectKind === 'property-spawn') return 0;
    if (subjectKind === 'shop-position') return 1;
    return 2;
}

function compareCandidates(
    left: VehicleGraphRouteCandidate,
    right: VehicleGraphRouteCandidate
): number {
    return left.networkDistance - right.networkDistance ||
        compareRouteEndpoints(left.source, right.source) ||
        compareRouteEndpoints(left.destination, right.destination);
}

function compareRouteEndpoints(left: VehicleRouteEndpoint, right: VehicleRouteEndpoint): number {
    return endpointKindRank(left.subjectKind) - endpointKindRank(right.subjectKind) ||
        left.subjectInstanceKey.localeCompare(right.subjectInstanceKey) ||
        left.endpointIndex - right.endpointIndex ||
        left.nodeIndex - right.nodeIndex;
}

function uniqueSorted(values: readonly string[]): string[] {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function requireNodeIndex(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${label} must be a non-negative safe integer`);
    }
}

function copyPosition(position: Vector3): Vector3 {
    return { x: position.x, y: position.y, z: position.z };
}

class MinimumQueue {
    readonly #entries: QueueEntry[] = [];

    get size(): number {
        return this.#entries.length;
    }

    add(entry: QueueEntry): void {
        this.#entries.push(entry);
        let index = this.#entries.length - 1;
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (compareQueueEntries(this.#entries[parent]!, entry) <= 0) break;
            this.#entries[index] = this.#entries[parent]!;
            index = parent;
        }
        this.#entries[index] = entry;
    }

    removeMinimum(): QueueEntry | undefined {
        const minimum = this.#entries[0];
        const last = this.#entries.pop();
        if (minimum === undefined || last === undefined || this.#entries.length === 0) {
            return minimum;
        }
        let index = 0;
        while (true) {
            const left = index * 2 + 1;
            if (left >= this.#entries.length) break;
            const right = left + 1;
            const child = right < this.#entries.length &&
                compareQueueEntries(this.#entries[right]!, this.#entries[left]!) < 0
                ? right
                : left;
            if (compareQueueEntries(last, this.#entries[child]!) <= 0) break;
            this.#entries[index] = this.#entries[child]!;
            index = child;
        }
        this.#entries[index] = last;
        return minimum;
    }
}

function compareQueueEntries(left: QueueEntry, right: QueueEntry): number {
    return left.distance - right.distance || left.nodeIndex - right.nodeIndex;
}
