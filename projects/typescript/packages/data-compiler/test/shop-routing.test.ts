import {
    NavigationNetwork,
    ShopRoutePlanner,
    shopAvailability,
    type NavigationGraph,
    type NavigationSample,
    type Shop,
    type Vector3,
} from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

describe('shop routing', () => {
    it('selects the shortest reachable access candidate on the start component', () => {
        const network = new NavigationNetwork(graph(
            [position(0, 0), position(4, 0), position(8, 0), position(8, 1)],
            [[0, 1], [1, 2]]
        ));
        const planner = new ShopRoutePlanner(network, [shop({
            position: position(8, 1),
            deliveryBayPositions: [position(4, 0)],
            defaultStock: 2,
        })]);

        const [option] = planner.findPurchaseOptions({
            itemId: 'soil',
            quantity: 3,
            start: position(0, 0),
            maximumStartSnapDistance: 0,
            maximumAccessSnapDistance: 2,
            atTime: 600,
        });

        expect(option).toMatchObject({
            availability: { kind: 'open' },
            purchase: {
                unitPrice: 10,
                totalPrice: 30,
                stock: { kind: 'limited', defaultStock: 2, sufficient: false },
            },
            access: {
                kind: 'route',
                selected: {
                    candidate: { kind: 'delivery-bay', index: 0 },
                    path: { networkDistance: 4 },
                },
            },
        });
        if (option?.access.kind !== 'route') throw new Error('Expected physical access');
        expect(option.access.alternatives).toHaveLength(2);
        expect(option.access.alternatives[1]?.path.end).toMatchObject({
            sampleIndex: 2,
            snapDistance: 1,
            componentId: 0,
        });
    });

    it('keeps phone-only suppliers as remote options without inventing a route', () => {
        const planner = new ShopRoutePlanner(
            new NavigationNetwork(graph([position(0, 0)], [])),
            [shop({
                code: 'supplier',
                locationSource: 'supplier-phone-interface',
                position: null,
                openTime: null,
                closeTime: null,
            })]
        );

        expect(planner.findPurchaseOptions({
            itemId: 'soil',
            quantity: 1,
            start: position(100, 100),
            maximumStartSnapDistance: 0,
            maximumAccessSnapDistance: 0,
        })[0]).toMatchObject({
            availability: { kind: 'unknown', reason: 'no-schedule-data' },
            purchase: { stock: { kind: 'unlimited' } },
            access: { kind: 'remote', source: 'supplier-phone-interface' },
        });
    });

    it('does not claim that a negative game stock sentinel can fulfill an order', () => {
        const planner = new ShopRoutePlanner(
            new NavigationNetwork(graph([position(0, 0)], [])),
            [shop({ defaultStock: -1 })]
        );

        expect(planner.findPurchaseOptions({
            itemId: 'soil',
            quantity: 1,
            start: position(0, 0),
            maximumStartSnapDistance: 0,
            maximumAccessSnapDistance: 20,
        })[0]?.purchase).toMatchObject({
            stock: { kind: 'unknown', defaultStock: -1 },
        });
    });

    it('evaluates normal and overnight HHMM schedules with a closed end boundary', () => {
        const daytime = shop({ openTime: 500, closeTime: 1800 });
        expect(shopAvailability(daytime, 500).kind).toBe('open');
        expect(shopAvailability(daytime, 1800).kind).toBe('closed');
        expect(shopAvailability(daytime).kind).toBe('not-evaluated');

        const overnight = shop({ openTime: 501, closeTime: 500 });
        expect(shopAvailability(overnight, 2359).kind).toBe('open');
        expect(shopAvailability(overnight, 459).kind).toBe('open');
        expect(shopAvailability(overnight, 500).kind).toBe('closed');
        expect(shopAvailability(shop({ openTime: 500, closeTime: 500 }), 600).kind)
            .toBe('closed');
    });

    it('reports missing access data, an unsnappable start, and no reachable access separately', () => {
        const network = new NavigationNetwork(graph([position(0, 0)], []));
        const planner = new ShopRoutePlanner(network, [
            shop({ code: 'missing', position: null }),
            shop({ code: 'physical', position: position(10, 0) }),
        ]);

        const outside = planner.findPurchaseOptions({
            itemId: 'soil',
            quantity: 1,
            start: position(20, 0),
            maximumStartSnapDistance: 0,
            maximumAccessSnapDistance: 1,
        });
        expect(outside.map(({ access }) => access)).toEqual([
            { kind: 'unreachable', reason: 'no-physical-access-data', candidates: [] },
            expect.objectContaining({ kind: 'unreachable', reason: 'start-outside-network' }),
        ]);

        const unreachable = planner.findPurchaseOptions({
            itemId: 'soil',
            quantity: 1,
            start: position(0, 0),
            maximumStartSnapDistance: 0,
            maximumAccessSnapDistance: 1,
        });
        expect(unreachable[1]?.access).toMatchObject({
            kind: 'unreachable',
            reason: 'no-reachable-access',
        });
    });
});

interface ShopOverrides {
    readonly code?: string;
    readonly locationSource?: string;
    readonly position?: Vector3 | null;
    readonly deliveryBayPositions?: readonly Vector3[];
    readonly openTime?: number | null;
    readonly closeTime?: number | null;
    readonly defaultStock?: number | null;
}

function shop(overrides: ShopOverrides = {}): Shop {
    return {
        schema: 'neonschedule1-shop-1',
        code: overrides.code ?? 'hardware',
        name: 'Hardware',
        description: '',
        paymentType: 'Cash',
        sceneName: 'Test',
        locationSource: overrides.locationSource ?? 'shopkeeper-schedule',
        position: overrides.position === undefined ? position(8, 0) : overrides.position,
        rotation: null,
        holderPersonId: null,
        openTime: overrides.openTime === undefined ? 500 : overrides.openTime,
        closeTime: overrides.closeTime === undefined ? 1800 : overrides.closeTime,
        deliveryBayPositions: [...(overrides.deliveryBayPositions ?? [])],
        listings: [{
            itemId: 'soil',
            price: 10,
            defaultStock: overrides.defaultStock === undefined ? null : overrides.defaultStock,
            canBeDelivered: true,
        }],
    };
}

function graph(positions: readonly Vector3[], edges: readonly (readonly [number, number])[]): NavigationGraph {
    const samples: NavigationSample[] = positions.map((samplePosition, index) => ({
        gridX: index,
        gridZ: 0,
        position: samplePosition,
        areaMask: 1,
    }));
    return {
        schema: 'neonschedule1-navigation-graph-2',
        method: 'test',
        agent: {
            source: 'employee-prefabs',
            typeId: 7,
            name: 'Employee',
            radius: 0.35,
            height: 1.8,
            maximumSlope: 45,
            stepHeight: 0.4,
            employeeTypes: ['Botanist', 'Chemist', 'Cleaner', 'Handler'],
        },
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

function position(x: number, z: number): Vector3 {
    return { x, y: 0, z };
}
