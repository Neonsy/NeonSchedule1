export interface PropertyTransferAllocationSource {
    readonly key: string;
    readonly capacity: number;
}

export interface PropertyTransferAllocationDestination {
    readonly key: string;
    readonly capacity: number;
}

export interface PropertyTransferAllocationEdge {
    readonly candidateId: string;
    readonly sourceKey: string;
    readonly destinationKey: string;
    readonly capacity: number;
}

export interface PropertyTransferAllocatedEdge extends PropertyTransferAllocationEdge {
    readonly quantity: number;
}

interface FlowEdge {
    readonly to: number;
    readonly reverseIndex: number;
    readonly initialCapacity: number;
    capacity: number;
}

export function maximizePropertyTransferQuantity(
    sources: readonly PropertyTransferAllocationSource[],
    destinations: readonly PropertyTransferAllocationDestination[],
    edges: readonly PropertyTransferAllocationEdge[]
): readonly PropertyTransferAllocatedEdge[] {
    const sourceOffset = 1;
    const destinationOffset = sourceOffset + sources.length;
    const sink = destinationOffset + destinations.length;
    const graph: FlowEdge[][] = Array.from({ length: sink + 1 }, () => []);
    const sourceIndex = new Map(sources.map((source, index) => [source.key, sourceOffset + index]));
    const destinationIndex = new Map(
        destinations.map((destination, index) => [destination.key, destinationOffset + index])
    );
    const indexedCandidateEdges = new Map<string, { readonly node: number; readonly edgeIndex: number }>();

    for (const [index, source] of sources.entries()) {
        addEdge(graph, 0, sourceOffset + index, source.capacity);
    }
    for (const edge of edges) {
        const from = requireIndex(sourceIndex, edge.sourceKey, 'source');
        const to = requireIndex(destinationIndex, edge.destinationKey, 'destination');
        const edgeIndex = graph[from]!.length;
        addEdge(graph, from, to, edge.capacity);
        indexedCandidateEdges.set(edge.candidateId, { node: from, edgeIndex });
    }
    for (const [index, destination] of destinations.entries()) {
        addEdge(graph, destinationOffset + index, sink, destination.capacity);
    }

    maximizeFlow(graph, 0, sink);

    return edges.flatMap((edge) => {
        const indexed = indexedCandidateEdges.get(edge.candidateId);
        if (indexed === undefined) {
            throw new Error(`Missing indexed transfer candidate ${JSON.stringify(edge.candidateId)}`);
        }
        const flowEdge = graph[indexed.node]![indexed.edgeIndex]!;
        const quantity = flowEdge.initialCapacity - flowEdge.capacity;
        return quantity === 0 ? [] : [{ ...edge, quantity }];
    });
}

function maximizeFlow(graph: FlowEdge[][], source: number, sink: number): void {
    while (true) {
        const levels = levelGraph(graph, source);
        if (levels[sink] === -1) return;
        const nextEdgeIndexes = Array.from({ length: graph.length }, () => 0);
        let sent = 0;
        do {
            sent = sendFlow(
                graph,
                source,
                sink,
                Number.MAX_SAFE_INTEGER,
                levels,
                nextEdgeIndexes
            );
        } while (sent > 0);
    }
}

function levelGraph(graph: readonly FlowEdge[][], source: number): number[] {
    const levels = Array.from({ length: graph.length }, () => -1);
    levels[source] = 0;
    const queue = [source];
    for (let index = 0; index < queue.length; index += 1) {
        const node = queue[index]!;
        for (const edge of graph[node]!) {
            if (edge.capacity > 0 && levels[edge.to] === -1) {
                levels[edge.to] = levels[node]! + 1;
                queue.push(edge.to);
            }
        }
    }
    return levels;
}

function sendFlow(
    graph: FlowEdge[][],
    node: number,
    sink: number,
    limit: number,
    levels: readonly number[],
    nextEdgeIndexes: number[]
): number {
    if (node === sink) return limit;
    while (nextEdgeIndexes[node]! < graph[node]!.length) {
        const edgeIndex = nextEdgeIndexes[node]!;
        const edge = graph[node]![edgeIndex]!;
        if (edge.capacity > 0 && levels[edge.to] === levels[node]! + 1) {
            const sent = sendFlow(
                graph,
                edge.to,
                sink,
                Math.min(limit, edge.capacity),
                levels,
                nextEdgeIndexes
            );
            if (sent > 0) {
                edge.capacity -= sent;
                graph[edge.to]![edge.reverseIndex]!.capacity += sent;
                return sent;
            }
        }
        nextEdgeIndexes[node] = edgeIndex + 1;
    }
    return 0;
}

function addEdge(graph: FlowEdge[][], from: number, to: number, capacity: number): void {
    const forwardIndex = graph[from]!.length;
    const reverseIndex = graph[to]!.length;
    graph[from]!.push({
        to,
        reverseIndex,
        initialCapacity: capacity,
        capacity,
    });
    graph[to]!.push({
        to: from,
        reverseIndex: forwardIndex,
        initialCapacity: 0,
        capacity: 0,
    });
}

function requireIndex(index: ReadonlyMap<string, number>, key: string, label: string): number {
    const value = index.get(key);
    if (value === undefined) {
        throw new Error(`Unknown property transfer allocation ${label} ${JSON.stringify(key)}`);
    }
    return value;
}
