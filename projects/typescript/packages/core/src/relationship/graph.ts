import {
    RelationshipCatalogSchema,
    type RelationshipCatalog,
} from '#core/data/person';

export type RelationshipDirection = 'outgoing' | 'incoming' | 'either';

export interface RelationshipTraversalOptions {
    readonly direction?: RelationshipDirection;
    readonly maximumHops?: number;
}

export interface RelationshipVisit {
    readonly personId: string;
    readonly hops: number;
}

export class RelationshipGraph {
    readonly #personIds: readonly string[];
    readonly #outgoing: ReadonlyMap<string, readonly string[]>;
    readonly #incoming: ReadonlyMap<string, readonly string[]>;
    readonly #either: ReadonlyMap<string, readonly string[]>;

    constructor(input: RelationshipCatalog) {
        const catalog = RelationshipCatalogSchema.assert(input);
        const personIds = [...catalog.personIds].sort();
        if (personIds.some((id) => id.trim() === '')) {
            throw new Error('Relationship catalog contains a blank person ID');
        }
        if (new Set(personIds).size !== personIds.length) {
            throw new Error('Relationship catalog contains duplicate person IDs');
        }

        const known = new Set(personIds);
        const outgoing = setsFor(personIds);
        const incoming = setsFor(personIds);
        const arcKeys = new Set<string>();
        for (const edge of catalog.edges) {
            if (!known.has(edge.sourceId) || !known.has(edge.targetId)) {
                throw new Error(
                    `Relationship edge references an unknown person: ` +
                    `${JSON.stringify(edge.sourceId)} -> ${JSON.stringify(edge.targetId)}`
                );
            }
            if (edge.sourceId === edge.targetId) {
                throw new Error(`Relationship edge for ${JSON.stringify(edge.sourceId)} is a self-reference`);
            }
            addUniqueArc(outgoing, incoming, arcKeys, edge.sourceId, edge.targetId);
            if (edge.bidirectional) {
                addUniqueArc(outgoing, incoming, arcKeys, edge.targetId, edge.sourceId);
            }
        }

        this.#personIds = personIds;
        this.#outgoing = sortedAdjacency(outgoing);
        this.#incoming = sortedAdjacency(incoming);
        this.#either = new Map(personIds.map((id) => [
            id,
            [...new Set([...this.#outgoing.get(id)!, ...this.#incoming.get(id)!])].sort(),
        ]));
    }

    get personIds(): readonly string[] {
        return [...this.#personIds];
    }

    neighbors(personId: string, direction: RelationshipDirection = 'outgoing'): readonly string[] {
        this.#requirePerson(personId);
        return [...this.#adjacency(direction).get(personId)!];
    }

    traverseFrom(
        personId: string,
        options: RelationshipTraversalOptions = {}
    ): readonly RelationshipVisit[] {
        this.#requirePerson(personId);
        const maximumHops = options.maximumHops ?? Number.POSITIVE_INFINITY;
        if (
            maximumHops !== Number.POSITIVE_INFINITY &&
            (!Number.isInteger(maximumHops) || maximumHops < 0)
        ) {
            throw new RangeError('Relationship traversal maximum hops must be a non-negative integer');
        }

        const adjacency = this.#adjacency(options.direction ?? 'outgoing');
        const hopsById = new Map([[personId, 0]]);
        const queue = [personId];
        for (let index = 0; index < queue.length; index++) {
            const current = queue[index]!;
            const nextHops = hopsById.get(current)! + 1;
            if (nextHops > maximumHops) continue;
            for (const neighbor of adjacency.get(current)!) {
                if (hopsById.has(neighbor)) continue;
                hopsById.set(neighbor, nextHops);
                queue.push(neighbor);
            }
        }
        return [...hopsById]
            .map(([id, hops]) => ({ personId: id, hops }))
            .sort((left, right) => left.hops - right.hops || left.personId.localeCompare(right.personId));
    }

    shortestPath(
        sourceId: string,
        targetId: string,
        direction: RelationshipDirection = 'outgoing'
    ): readonly string[] | null {
        this.#requirePerson(sourceId);
        this.#requirePerson(targetId);
        if (sourceId === targetId) return [sourceId];

        const adjacency = this.#adjacency(direction);
        const previous = new Map<string, string>();
        const visited = new Set([sourceId]);
        const queue = [sourceId];
        for (let index = 0; index < queue.length; index++) {
            const current = queue[index]!;
            for (const neighbor of adjacency.get(current)!) {
                if (visited.has(neighbor)) continue;
                visited.add(neighbor);
                previous.set(neighbor, current);
                if (neighbor === targetId) return reconstructPath(sourceId, targetId, previous);
                queue.push(neighbor);
            }
        }
        return null;
    }

    connectedGroups(): readonly (readonly string[])[] {
        const remaining = new Set(this.#personIds);
        const groups: string[][] = [];
        for (const personId of this.#personIds) {
            if (!remaining.has(personId)) continue;
            const group = this.traverseFrom(personId, { direction: 'either' })
                .map((visit) => visit.personId)
                .sort();
            group.forEach((id) => remaining.delete(id));
            groups.push(group);
        }
        return groups;
    }

    #adjacency(direction: RelationshipDirection): ReadonlyMap<string, readonly string[]> {
        if (direction === 'outgoing') return this.#outgoing;
        if (direction === 'incoming') return this.#incoming;
        if (direction === 'either') return this.#either;
        throw new Error(`Unknown relationship direction ${JSON.stringify(direction)}`);
    }

    #requirePerson(personId: string): void {
        if (!this.#outgoing.has(personId)) {
            throw new Error(`Unknown person ${JSON.stringify(personId)}`);
        }
    }
}

function setsFor(personIds: readonly string[]): Map<string, Set<string>> {
    return new Map(personIds.map((id) => [id, new Set<string>()]));
}

function addUniqueArc(
    outgoing: Map<string, Set<string>>,
    incoming: Map<string, Set<string>>,
    arcKeys: Set<string>,
    sourceId: string,
    targetId: string
): void {
    const key = JSON.stringify([sourceId, targetId]);
    if (arcKeys.has(key)) {
        throw new Error(
            `Relationship catalog contains a duplicate edge: ` +
            `${JSON.stringify(sourceId)} -> ${JSON.stringify(targetId)}`
        );
    }
    arcKeys.add(key);
    outgoing.get(sourceId)!.add(targetId);
    incoming.get(targetId)!.add(sourceId);
}

function sortedAdjacency(source: ReadonlyMap<string, ReadonlySet<string>>) {
    return new Map([...source].map(([id, neighbors]) => [id, [...neighbors].sort()]));
}

function reconstructPath(
    sourceId: string,
    targetId: string,
    previous: ReadonlyMap<string, string>
): string[] {
    const path = [targetId];
    while (path[0] !== sourceId) path.unshift(previous.get(path[0]!)!);
    return path;
}
