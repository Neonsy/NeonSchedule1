import { describe, expect, it } from 'vitest';

import type {
    NavigationGraph,
    Property,
    PropertyLayout,
    Transform,
    Vector3,
} from '@neonschedule1/core';

import { Integrity } from '#data-compiler/integrity';
import { validateEmployeeRoutes } from '#data-compiler/normalize/employee-routes';

describe('employee route validation', () => {
    it('accepts connected employee properties and loading-dock access', () => {
        const integrity = new Integrity();

        validateEmployeeRoutes(
            navigation([[0, 1], [1, 2]]),
            [property('barn', 2), property('warehouse', 3)],
            [layout('barn', 0, 4), layout('warehouse', 4)],
            integrity
        );

        expect(integrity.errors).toEqual([]);
        expect(integrity.checks).toContain('employee properties barn and warehouse are connected');
        expect(integrity.checks).toContain(
            'employee property barn loading dock 0 access 0 is reachable'
        );
    });

    it('reports disconnected employee properties and loading-dock access', () => {
        const integrity = new Integrity();

        validateEmployeeRoutes(
            navigation([]),
            [property('barn', 2), property('warehouse', 3), property('unused', 0)],
            [layout('barn', 0, 4), layout('warehouse', 4), layout('unused', 100)],
            integrity
        );

        expect(integrity.errors).toEqual([
            'Employee property "barn" loading dock 0 access 0 is unreachable: end-outside-reachable-network',
            'Employee properties "barn" and "warehouse" are disconnected: end-outside-reachable-network',
        ]);
    });
});

function navigation(edges: readonly (readonly [number, number])[]): NavigationGraph {
    const positions = [vector(0), vector(2), vector(4)];
    return {
        schema: 'neonschedule1-navigation-graph-2',
        method: 'test',
        agent: {
            source: 'employee-prefabs',
            typeId: 7,
            name: 'Employee',
            radius: 0.3,
            height: 1.9,
            maximumSlope: 45,
            stepHeight: 0.4,
            employeeTypes: ['Handler'],
        },
        sampleSpacing: 2,
        queryHeight: 0,
        maxSampleDistance: 2,
        boundsMinimum: vector(0),
        boundsMaximum: vector(4),
        gridWidth: 3,
        gridHeight: 1,
        samples: positions.map((position, gridX) => ({ gridX, gridZ: 0, position, areaMask: 1 })),
        edges: edges.map(([sampleA, sampleB]) => ({ sampleA, sampleB })),
    };
}

function property(code: string, employeeCapacity: number): Property {
    return {
        schema: 'neonschedule1-property-1',
        code,
        name: code,
        price: 0,
        employeeCapacity,
        loadingDockCount: code === 'barn' ? 1 : 0,
        gridCount: 0,
        ambientTemperature: 20,
        ownedByDefault: false,
        position: vector(0),
        business: null,
        hasLayout: true,
    };
}

function layout(code: string, entranceX: number, dockX?: number): PropertyLayout {
    const entrance = transform('Spawn', entranceX);
    return {
        schema: 'neonschedule1-property-layout-4',
        propertyCode: code,
        propertyName: code,
        worldPosition: vector(entranceX),
        worldRotation: vector(0),
        spawnPoint: entrance,
        interiorSpawnPoint: entrance,
        npcSpawnPoint: entrance,
        boundingBox: null,
        boundaryColliders: [],
        fixedColliders: [],
        surfaceMeshes: [],
        surfaces: [],
        proceduralTiles: [],
        loadingDocks: dockX === undefined ? [] : [{
            id: 'dock',
            name: 'Dock',
            transform: transform('Dock', dockX),
            parkingTransform: transform('Dock/Parking', dockX),
            inputSlotCount: 0,
            outputSlotCount: 0,
            accessPoints: [transform('Dock/Access', dockX)],
        }],
        grids: [],
        visuals: { renderers: [], meshes: [] },
    };
}

function transform(path: string, x: number): Transform {
    return {
        name: path.split('/').at(-1)!,
        path,
        worldPosition: vector(x),
        localPosition: vector(x),
        worldRotation: vector(0),
        localScale: vector(1, 1, 1),
    };
}

function vector(x: number, y = 0, z = 0): Vector3 {
    return { x, y, z };
}
