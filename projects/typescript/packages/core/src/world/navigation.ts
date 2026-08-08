import {
    NavigationGraphSchema,
    type NavigationAgent,
    type NavigationGraph,
    type NavigationSample,
} from '#core/data/world';
import type { Vector3 } from '#core/data/common';

export interface NavigationPathInput {
    readonly start: Vector3;
    readonly end: Vector3;
    readonly maximumSnapDistance: number;
}

export interface ReachableNavigationPathInput {
    readonly start: Vector3;
    readonly end: Vector3;
    readonly maximumStartSnapDistance: number;
    readonly maximumEndSnapDistance: number;
}

export interface NavigationEndpoint {
    readonly requestedPosition: Vector3;
    readonly sampleIndex: number;
    readonly samplePosition: Vector3;
    readonly snapDistance: number;
    readonly componentId: number;
}

export interface NavigationPathPoint {
    readonly sampleIndex: number;
    readonly position: Vector3;
}

export interface FoundNavigationPath {
    readonly kind: 'found';
    readonly start: NavigationEndpoint;
    readonly end: NavigationEndpoint;
    readonly points: readonly NavigationPathPoint[];
    readonly networkDistance: number;
    readonly exploredSampleCount: number;
}

export interface UnreachableNavigationPath {
    readonly kind: 'unreachable';
    readonly reason:
        | 'start-outside-network'
        | 'end-outside-network'
        | 'end-outside-reachable-network'
        | 'disconnected';
    readonly start: NavigationEndpoint | null;
    readonly end: NavigationEndpoint | null;
    readonly exploredSampleCount: number;
}

export type NavigationPathResult = FoundNavigationPath | UnreachableNavigationPath;

export function isNavigationSegmentLocallyTraversable(
    agent: NavigationAgent,
    start: Vector3,
    end: Vector3
): boolean {
    if (
        !Number.isFinite(agent.maximumSlope) ||
        agent.maximumSlope < 0 ||
        agent.maximumSlope >= 90 ||
        !Number.isFinite(agent.stepHeight) ||
        agent.stepHeight < 0
    ) {
        return false;
    }
    const horizontalDistance = Math.hypot(start.x - end.x, start.z - end.z);
    const verticalDistance = Math.abs(start.y - end.y);
    if (!Number.isFinite(horizontalDistance) || !Number.isFinite(verticalDistance)) return false;
    const slopeRise = horizontalDistance * Math.tan(agent.maximumSlope * Math.PI / 180);
    const maximumRise = slopeRise + agent.stepHeight;
    const tolerance = 1e-5 * Math.max(1, maximumRise);
    return verticalDistance <= maximumRise + tolerance;
}

interface Neighbor {
    readonly sampleIndex: number;
    readonly distance: number;
}

interface QueueEntry {
    readonly sampleIndex: number;
    readonly distanceFromStart: number;
    readonly estimatedTotalDistance: number;
}

export class NavigationNetwork {
    readonly #samples: readonly NavigationSample[];
    readonly #adjacency: readonly (readonly Neighbor[])[];
    readonly #sampleSpacing: number;
    readonly #spatialBuckets: ReadonlyMap<string, readonly number[]>;
    readonly #componentBySample: Int32Array;

    constructor(input: NavigationGraph) {
        const graph = NavigationGraphSchema.assert(input);
        requirePositiveFinite(graph.sampleSpacing, 'Navigation sample spacing');
        if (!Number.isSafeInteger(graph.agent.typeId)) {
            throw new RangeError('Navigation agent type ID must be a safe integer');
        }
        if (graph.agent.name.trim().length === 0) {
            throw new TypeError('Navigation agent name must not be blank');
        }
        requirePositiveFinite(graph.agent.radius, 'Navigation agent radius');
        requirePositiveFinite(graph.agent.height, 'Navigation agent height');
        requireNonNegativeFinite(graph.agent.maximumSlope, 'Navigation agent maximum slope');
        if (graph.agent.maximumSlope >= 90) {
            throw new RangeError('Navigation agent maximum slope must be less than 90 degrees');
        }
        requireNonNegativeFinite(graph.agent.stepHeight, 'Navigation agent step height');
        if (
            graph.agent.employeeTypes.length === 0 ||
            graph.agent.employeeTypes.some((value) => value.trim().length === 0) ||
            new Set(graph.agent.employeeTypes).size !== graph.agent.employeeTypes.length
        ) {
            throw new TypeError('Navigation agent employee types must be non-empty and unique');
        }
        requirePositiveSafeInteger(graph.gridWidth, 'Navigation grid width');
        requirePositiveSafeInteger(graph.gridHeight, 'Navigation grid height');
        if (graph.samples.length === 0) throw new Error('Navigation graph contains no samples');

        const gridKeys = new Set<string>();
        this.#samples = graph.samples.map((sample, index) => {
            requireGridCoordinate(sample.gridX, graph.gridWidth, `Navigation sample ${index} grid X`);
            requireGridCoordinate(sample.gridZ, graph.gridHeight, `Navigation sample ${index} grid Z`);
            requireFinitePosition(sample.position, `Navigation sample ${index}`);
            const gridKey = coordinateKey(sample.gridX, sample.gridZ);
            if (gridKeys.has(gridKey)) {
                throw new Error(`Navigation graph contains duplicate grid coordinate ${gridKey}`);
            }
            gridKeys.add(gridKey);
            return {
                gridX: sample.gridX,
                gridZ: sample.gridZ,
                position: copyPosition(sample.position),
                areaMask: sample.areaMask,
            };
        });

        const adjacency = Array.from({ length: this.#samples.length }, () => [] as Neighbor[]);
        const edgeKeys = new Set<string>();
        for (const [edgeIndex, edge] of graph.edges.entries()) {
            requireSampleIndex(edge.sampleA, this.#samples.length, `Navigation edge ${edgeIndex} sample A`);
            requireSampleIndex(edge.sampleB, this.#samples.length, `Navigation edge ${edgeIndex} sample B`);
            if (edge.sampleA === edge.sampleB) {
                throw new Error(`Navigation edge ${edgeIndex} is a self-edge`);
            }
            const edgeKey = undirectedEdgeKey(edge.sampleA, edge.sampleB);
            if (edgeKeys.has(edgeKey)) {
                throw new Error(`Navigation graph contains duplicate edge ${edgeKey}`);
            }
            edgeKeys.add(edgeKey);
            const distance = positionDistance(
                this.#samples[edge.sampleA]!.position,
                this.#samples[edge.sampleB]!.position
            );
            requirePositiveFinite(distance, `Navigation edge ${edgeIndex} distance`);
            if (!isNavigationSegmentLocallyTraversable(
                graph.agent,
                this.#samples[edge.sampleA]!.position,
                this.#samples[edge.sampleB]!.position
            )) {
                throw new Error(`Navigation edge ${edgeIndex} exceeds employee movement limits`);
            }
            adjacency[edge.sampleA]!.push({ sampleIndex: edge.sampleB, distance });
            adjacency[edge.sampleB]!.push({ sampleIndex: edge.sampleA, distance });
        }
        adjacency.forEach((neighbors) => neighbors.sort((left, right) =>
            left.sampleIndex - right.sampleIndex
        ));

        this.#adjacency = adjacency;
        this.#sampleSpacing = graph.sampleSpacing;
        this.#spatialBuckets = spatialBuckets(this.#samples, graph.sampleSpacing);
        this.#componentBySample = connectedComponents(adjacency);
    }

    get sampleCount(): number {
        return this.#samples.length;
    }

    nearestSample(position: Vector3, maximumDistance: number): NavigationEndpoint | null {
        return this.#nearestSample(position, maximumDistance, null);
    }

    findPath(input: NavigationPathInput): NavigationPathResult {
        const start = this.nearestSample(input.start, input.maximumSnapDistance);
        const end = this.nearestSample(input.end, input.maximumSnapDistance);
        if (start === null) {
            return {
                kind: 'unreachable',
                reason: 'start-outside-network',
                start,
                end,
                exploredSampleCount: 0,
            };
        }
        if (end === null) {
            return {
                kind: 'unreachable',
                reason: 'end-outside-network',
                start,
                end,
                exploredSampleCount: 0,
            };
        }
        return this.#findSamplePath(start, end);
    }

    findPathToNearestReachable(input: ReachableNavigationPathInput): NavigationPathResult {
        requireFinitePosition(input.end, 'Navigation endpoint');
        requireNonNegativeFinite(
            input.maximumEndSnapDistance,
            'Maximum navigation snap distance'
        );
        const start = this.nearestSample(input.start, input.maximumStartSnapDistance);
        if (start === null) {
            return {
                kind: 'unreachable',
                reason: 'start-outside-network',
                start,
                end: null,
                exploredSampleCount: 0,
            };
        }
        const end = this.#nearestSample(
            input.end,
            input.maximumEndSnapDistance,
            start.componentId
        );
        if (end === null) {
            return {
                kind: 'unreachable',
                reason: 'end-outside-reachable-network',
                start,
                end,
                exploredSampleCount: 0,
            };
        }
        return this.#findSamplePath(start, end);
    }

    #findSamplePath(start: NavigationEndpoint, end: NavigationEndpoint): NavigationPathResult {
        if (start.componentId !== end.componentId) {
            return {
                kind: 'unreachable',
                reason: 'disconnected',
                start,
                end,
                exploredSampleCount: 0,
            };
        }
        const distances = new Float64Array(this.#samples.length);
        distances.fill(Number.POSITIVE_INFINITY);
        distances[start.sampleIndex] = 0;
        const previous = new Int32Array(this.#samples.length);
        previous.fill(-1);
        const queue = new MinimumQueue();
        queue.add({
            sampleIndex: start.sampleIndex,
            distanceFromStart: 0,
            estimatedTotalDistance: positionDistance(start.samplePosition, end.samplePosition),
        });
        let exploredSampleCount = 0;

        while (queue.size > 0) {
            const current = queue.removeMinimum()!;
            if (current.distanceFromStart !== distances[current.sampleIndex]) continue;
            exploredSampleCount++;
            if (current.sampleIndex === end.sampleIndex) {
                return {
                    kind: 'found',
                    start,
                    end,
                    points: reconstructPath(previous, start.sampleIndex, end.sampleIndex, this.#samples),
                    networkDistance: current.distanceFromStart,
                    exploredSampleCount,
                };
            }

            for (const neighbor of this.#adjacency[current.sampleIndex]!) {
                const candidateDistance = current.distanceFromStart + neighbor.distance;
                if (candidateDistance >= distances[neighbor.sampleIndex]!) continue;
                distances[neighbor.sampleIndex] = candidateDistance;
                previous[neighbor.sampleIndex] = current.sampleIndex;
                queue.add({
                    sampleIndex: neighbor.sampleIndex,
                    distanceFromStart: candidateDistance,
                    estimatedTotalDistance: candidateDistance + positionDistance(
                        this.#samples[neighbor.sampleIndex]!.position,
                        end.samplePosition
                    ),
                });
            }
        }

        return {
            kind: 'unreachable',
            reason: 'disconnected',
            start,
            end,
            exploredSampleCount,
        };
    }

    #nearbySampleIndices(position: Vector3, maximumDistance: number): readonly number[] {
        const minimumX = Math.floor((position.x - maximumDistance) / this.#sampleSpacing);
        const maximumX = Math.floor((position.x + maximumDistance) / this.#sampleSpacing);
        const minimumZ = Math.floor((position.z - maximumDistance) / this.#sampleSpacing);
        const maximumZ = Math.floor((position.z + maximumDistance) / this.#sampleSpacing);
        const cellCount = (maximumX - minimumX + 1) * (maximumZ - minimumZ + 1);
        if (!Number.isSafeInteger(cellCount) || cellCount > this.#samples.length) {
            return this.#samples.map((_, index) => index);
        }

        const indices: number[] = [];
        for (let bucketX = minimumX; bucketX <= maximumX; bucketX++) {
            for (let bucketZ = minimumZ; bucketZ <= maximumZ; bucketZ++) {
                const bucket = this.#spatialBuckets.get(coordinateKey(bucketX, bucketZ));
                if (bucket !== undefined) indices.push(...bucket);
            }
        }
        return indices;
    }

    #nearestSample(
        position: Vector3,
        maximumDistance: number,
        componentId: number | null
    ): NavigationEndpoint | null {
        requireFinitePosition(position, 'Navigation endpoint');
        requireNonNegativeFinite(maximumDistance, 'Maximum navigation snap distance');
        const candidateIndices = this.#nearbySampleIndices(position, maximumDistance);
        let nearestIndex = -1;
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (const sampleIndex of candidateIndices) {
            if (componentId !== null && this.#componentBySample[sampleIndex] !== componentId) continue;
            const distance = positionDistance(position, this.#samples[sampleIndex]!.position);
            if (
                distance <= maximumDistance &&
                (distance < nearestDistance || (distance === nearestDistance && sampleIndex < nearestIndex))
            ) {
                nearestIndex = sampleIndex;
                nearestDistance = distance;
            }
        }
        if (nearestIndex === -1) return null;
        return this.#endpoint(position, nearestIndex, nearestDistance);
    }

    #endpoint(position: Vector3, sampleIndex: number, snapDistance: number): NavigationEndpoint {
        return {
            requestedPosition: copyPosition(position),
            sampleIndex,
            samplePosition: copyPosition(this.#samples[sampleIndex]!.position),
            snapDistance,
            componentId: this.#componentBySample[sampleIndex]!,
        };
    }
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
        if (minimum === undefined || last === undefined || this.#entries.length === 0) return minimum;

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

function spatialBuckets(
    samples: readonly NavigationSample[],
    spacing: number
): ReadonlyMap<string, readonly number[]> {
    const buckets = new Map<string, number[]>();
    samples.forEach((sample, index) => {
        const key = coordinateKey(
            Math.floor(sample.position.x / spacing),
            Math.floor(sample.position.z / spacing)
        );
        const bucket = buckets.get(key);
        if (bucket === undefined) buckets.set(key, [index]);
        else bucket.push(index);
    });
    return buckets;
}

function connectedComponents(adjacency: readonly (readonly Neighbor[])[]): Int32Array {
    const componentBySample = new Int32Array(adjacency.length);
    componentBySample.fill(-1);
    for (let sampleIndex = 0; sampleIndex < adjacency.length; sampleIndex++) {
        if (componentBySample[sampleIndex] !== -1) continue;
        componentBySample[sampleIndex] = sampleIndex;
        const queue = [sampleIndex];
        for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
            const current = queue[queueIndex]!;
            for (const neighbor of adjacency[current]!) {
                if (componentBySample[neighbor.sampleIndex] !== -1) continue;
                componentBySample[neighbor.sampleIndex] = sampleIndex;
                queue.push(neighbor.sampleIndex);
            }
        }
    }
    return componentBySample;
}

function reconstructPath(
    previous: Int32Array,
    startIndex: number,
    endIndex: number,
    samples: readonly NavigationSample[]
): NavigationPathPoint[] {
    const indices = [endIndex];
    while (indices[indices.length - 1] !== startIndex) {
        const prior = previous[indices[indices.length - 1]!]!;
        if (prior < 0) throw new Error('Navigation path reconstruction reached an unconnected sample');
        indices.push(prior);
    }
    return indices.reverse().map((sampleIndex) => ({
        sampleIndex,
        position: copyPosition(samples[sampleIndex]!.position),
    }));
}

function compareQueueEntries(left: QueueEntry, right: QueueEntry): number {
    return left.estimatedTotalDistance - right.estimatedTotalDistance ||
        left.sampleIndex - right.sampleIndex ||
        left.distanceFromStart - right.distanceFromStart;
}

function positionDistance(left: Vector3, right: Vector3): number {
    return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function copyPosition(position: Vector3): Vector3 {
    return { x: position.x, y: position.y, z: position.z };
}

function coordinateKey(x: number, z: number): string {
    return `${x},${z}`;
}

function undirectedEdgeKey(sampleA: number, sampleB: number): string {
    return sampleA < sampleB ? `${sampleA}-${sampleB}` : `${sampleB}-${sampleA}`;
}

function requireSampleIndex(value: number, sampleCount: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value >= sampleCount) {
        throw new RangeError(`${label} must reference an existing sample`);
    }
}

function requireGridCoordinate(value: number, size: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value >= size) {
        throw new RangeError(`${label} must be within the navigation grid`);
    }
}

function requireFinitePosition(position: Vector3, label: string): void {
    if (![position.x, position.y, position.z].every(Number.isFinite)) {
        throw new RangeError(`${label} position must contain finite coordinates`);
    }
}

function requirePositiveSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new RangeError(`${label} must be a positive safe integer`);
    }
}

function requirePositiveFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${label} must be a positive finite number`);
    }
}

function requireNonNegativeFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${label} must be a non-negative finite number`);
    }
}
