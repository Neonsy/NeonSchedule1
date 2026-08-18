import type { VehicleNavigationConnection } from '@neonschedule1/core';

export interface VehicleNavigationComponents {
    readonly weakComponentCount: number;
    readonly strongComponentCount: number;
    readonly weakComponentByNode: ReadonlyMap<number, number>;
    readonly strongComponentByNode: ReadonlyMap<number, number>;
}

export function vehicleNavigationComponents(
    nodeIndices: readonly number[],
    connections: readonly VehicleNavigationConnection[]
): VehicleNavigationComponents {
    const weakComponents = weaklyConnectedComponents(nodeIndices, connections);
    const strongComponents = stronglyConnectedComponents(nodeIndices, connections);
    return {
        weakComponentCount: weakComponents.length,
        strongComponentCount: strongComponents.length,
        weakComponentByNode: componentIndex(weakComponents),
        strongComponentByNode: componentIndex(strongComponents),
    };
}

function weaklyConnectedComponents(
    nodeIndices: readonly number[],
    connections: readonly VehicleNavigationConnection[]
): readonly (readonly number[])[] {
    const adjacency = adjacencyByNode(nodeIndices, connections, true);
    return collectComponents(nodeIndices, adjacency);
}

function stronglyConnectedComponents(
    nodeIndices: readonly number[],
    connections: readonly VehicleNavigationConnection[]
): readonly (readonly number[])[] {
    const adjacency = adjacencyByNode(nodeIndices, connections, false);
    const reverseAdjacency = new Map(nodeIndices.map((nodeIndex) => [nodeIndex, [] as number[]]));
    for (const connection of connections) {
        reverseAdjacency.get(connection.targetNodeIndex)!.push(connection.sourceNodeIndex);
    }
    sortAdjacency(reverseAdjacency);

    const visited = new Set<number>();
    const finishOrder: number[] = [];
    for (const start of nodeIndices) {
        if (visited.has(start)) continue;
        visited.add(start);
        const stack = [{ nodeIndex: start, nextNeighbor: 0 }];
        while (stack.length > 0) {
            const frame = stack[stack.length - 1]!;
            const neighbors = adjacency.get(frame.nodeIndex)!;
            const neighbor = neighbors[frame.nextNeighbor];
            if (neighbor === undefined) {
                finishOrder.push(frame.nodeIndex);
                stack.pop();
                continue;
            }
            frame.nextNeighbor++;
            if (visited.has(neighbor)) continue;
            visited.add(neighbor);
            stack.push({ nodeIndex: neighbor, nextNeighbor: 0 });
        }
    }

    const assigned = new Set<number>();
    const components: number[][] = [];
    for (let index = finishOrder.length - 1; index >= 0; index--) {
        const start = finishOrder[index]!;
        if (assigned.has(start)) continue;
        const component: number[] = [];
        const stack = [start];
        assigned.add(start);
        while (stack.length > 0) {
            const nodeIndex = stack.pop()!;
            component.push(nodeIndex);
            for (const neighbor of reverseAdjacency.get(nodeIndex)!) {
                if (assigned.has(neighbor)) continue;
                assigned.add(neighbor);
                stack.push(neighbor);
            }
        }
        component.sort((left, right) => left - right);
        components.push(component);
    }
    return sortComponents(components);
}

function adjacencyByNode(
    nodeIndices: readonly number[],
    connections: readonly VehicleNavigationConnection[],
    includeReverse: boolean
): Map<number, number[]> {
    const adjacency = new Map(nodeIndices.map((nodeIndex) => [nodeIndex, [] as number[]]));
    for (const connection of connections) {
        adjacency.get(connection.sourceNodeIndex)!.push(connection.targetNodeIndex);
        if (includeReverse) {
            adjacency.get(connection.targetNodeIndex)!.push(connection.sourceNodeIndex);
        }
    }
    sortAdjacency(adjacency);
    return adjacency;
}

function sortAdjacency(adjacency: Map<number, number[]>): void {
    for (const neighbors of adjacency.values()) {
        neighbors.sort((left, right) => left - right);
    }
}

function collectComponents(
    nodeIndices: readonly number[],
    adjacency: ReadonlyMap<number, readonly number[]>
): readonly (readonly number[])[] {
    const visited = new Set<number>();
    const components: number[][] = [];
    for (const start of nodeIndices) {
        if (visited.has(start)) continue;
        const component: number[] = [];
        const stack = [start];
        visited.add(start);
        while (stack.length > 0) {
            const nodeIndex = stack.pop()!;
            component.push(nodeIndex);
            for (const neighbor of adjacency.get(nodeIndex)!) {
                if (visited.has(neighbor)) continue;
                visited.add(neighbor);
                stack.push(neighbor);
            }
        }
        component.sort((left, right) => left - right);
        components.push(component);
    }
    return sortComponents(components);
}

function sortComponents(components: number[][]): readonly (readonly number[])[] {
    return components.sort((left, right) => left[0]! - right[0]!);
}

function componentIndex(components: readonly (readonly number[])[]): ReadonlyMap<number, number> {
    const index = new Map<number, number>();
    components.forEach((component, componentId) => {
        component.forEach((nodeIndex) => index.set(nodeIndex, componentId));
    });
    return index;
}
