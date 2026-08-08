import {
    RelationshipGraph,
    type RelationshipCatalog,
} from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

const catalog: RelationshipCatalog = {
    schema: 'neonschedule1-relationship-catalog-1',
    personIds: ['isolated', 'e', 'd', 'c', 'b', 'a'],
    edges: [
        { sourceId: 'a', targetId: 'b', bidirectional: false },
        { sourceId: 'c', targetId: 'b', bidirectional: false },
        { sourceId: 'b', targetId: 'd', bidirectional: true },
        { sourceId: 'd', targetId: 'e', bidirectional: false },
    ],
};

describe('relationship graph', () => {
    it('keeps edge direction while providing deterministic traversal and grouping', () => {
        const graph = new RelationshipGraph(catalog);

        expect(graph.personIds).toEqual(['a', 'b', 'c', 'd', 'e', 'isolated']);
        expect(graph.neighbors('b')).toEqual(['d']);
        expect(graph.neighbors('b', 'incoming')).toEqual(['a', 'c', 'd']);
        expect(graph.neighbors('b', 'either')).toEqual(['a', 'c', 'd']);
        expect(graph.traverseFrom('a')).toEqual([
            { personId: 'a', hops: 0 },
            { personId: 'b', hops: 1 },
            { personId: 'd', hops: 2 },
            { personId: 'e', hops: 3 },
        ]);
        expect(graph.traverseFrom('e', { direction: 'incoming', maximumHops: 2 })).toEqual([
            { personId: 'e', hops: 0 },
            { personId: 'd', hops: 1 },
            { personId: 'b', hops: 2 },
        ]);
        expect(graph.shortestPath('a', 'e')).toEqual(['a', 'b', 'd', 'e']);
        expect(graph.shortestPath('e', 'a')).toBeNull();
        expect(graph.shortestPath('e', 'a', 'either')).toEqual(['e', 'd', 'b', 'a']);
        expect(graph.connectedGroups()).toEqual([
            ['a', 'b', 'c', 'd', 'e'],
            ['isolated'],
        ]);
    });

    it.each([
        [
            'duplicate people',
            { ...catalog, personIds: ['a', 'a'] },
            'duplicate person IDs',
        ],
        [
            'missing people',
            { ...catalog, edges: [{ sourceId: 'a', targetId: 'missing', bidirectional: false }] },
            'unknown person',
        ],
        [
            'self references',
            { ...catalog, edges: [{ sourceId: 'a', targetId: 'a', bidirectional: false }] },
            'self-reference',
        ],
        [
            'overlapping bidirectional edges',
            {
                ...catalog,
                edges: [
                    { sourceId: 'a', targetId: 'b', bidirectional: true },
                    { sourceId: 'b', targetId: 'a', bidirectional: false },
                ],
            },
            'duplicate edge',
        ],
    ] satisfies readonly (readonly [string, RelationshipCatalog, string])[])(
        'rejects %s',
        (_name, invalid, message) => {
            expect(() => new RelationshipGraph(invalid)).toThrow(message);
        }
    );

    it('rejects invalid traversal inputs', () => {
        const graph = new RelationshipGraph(catalog);

        expect(() => graph.neighbors('missing')).toThrow('Unknown person');
        expect(() => graph.traverseFrom('a', { maximumHops: 1.5 })).toThrow(
            'maximum hops must be a non-negative integer'
        );
    });
});
