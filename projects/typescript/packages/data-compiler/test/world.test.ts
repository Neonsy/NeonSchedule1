import { describe, expect, it } from 'vitest';

import { projectWorldToMapPixel } from '@neonschedule1/core';

import type { VerifiedAssets } from '#data-compiler/acquisition/assets';
import type { RawReport } from '#data-compiler/acquisition/types';
import { Integrity } from '#data-compiler/integrity';
import { normalizeWorld } from '#data-compiler/normalize/world';

const mapFileId = 'a'.repeat(64);
const regionFileId = 'b'.repeat(64);
const iconFileId = 'c'.repeat(64);
const assets: VerifiedAssets = {
    files: [],
    directFileIdByPath: new Map([
        ['assets/map.png', mapFileId],
        ['assets/region.png', regionFileId],
        ['assets/icon.png', iconFileId],
    ]),
    offlineFileIdsByMeshKey: new Map(),
    filePathById: new Map(),
    directFileCount: 3,
    offlineFileCount: 0,
};

describe('world normalization', () => {
    it('preserves map calibration, static locations, access rules, and validated navigation edges', () => {
        const integrity = new Integrity();
        const world = normalizeWorld(
            report(),
            assets,
            new Set(['alice']),
            new Set(['hardware']),
            integrity
        );

        integrity.throwIfInvalid();
        expect(world.map).toMatchObject({
            mainMap: { fileId: mapFileId, width: 4096, height: 4096 },
            projection: {
                origin: { x: 10.49, y: 0, z: -3.69 },
                edge: { x: 10.49, y: 0, z: -208.23 },
                mapDimensions: 2048,
                conversionFactor: 5.006356,
            },
            regions: [{ id: 'Downtown', spriteFileId: regionFileId }],
        });
        expect(world.map.regions[0]?.deliveryLocations).toEqual([{
            id: 'delivery-1',
            position: { x: 8, y: 0, z: 9 },
        }]);
        expect(world.locations.locations).toHaveLength(2);
        expect(world.locations.locations.map((location) => location.sourceId)).toEqual(['shared', 'shared']);
        expect(world.locations.locations[0]?.iconFileIds).toEqual([iconFileId]);
        expect(world.locations.services[0]).toMatchObject({
            kind: 'atm',
            id: 'atm-1',
            regionId: 'Downtown',
            accessPointPosition: { x: 4, y: 0, z: 5 },
            linkedPersonId: 'alice',
        });
        expect(world.locations.timedAccessZones[0]).toMatchObject({
            id: 'zone-1',
            nearestShops: [{ shopCode: 'hardware', distance: 2.5 }],
        });
        expect(world.navigation.edges).toEqual([{ sampleA: 0, sampleB: 1 }]);
        expect(world.navigation.agent).toEqual({
            source: 'employee-prefabs',
            typeId: 7,
            name: 'Employee',
            radius: 0.35,
            height: 1.8,
            maximumSlope: 45,
            stepHeight: 0.4,
            employeeTypes: ['Botanist', 'Chemist', 'Cleaner', 'Handler'],
        });
        const mapImage = world.map.mainMap;
        expect(mapImage).not.toBeNull();
        if (mapImage === null) throw new Error('Test map image is missing');
        expect(projectWorldToMapPixel(world.map.projection.origin, world.map.projection, mapImage))
            .toEqual({ x: 2048, y: 2048 });
        const edgePixel = projectWorldToMapPixel(world.map.projection.edge, world.map.projection, mapImage);
        expect(edgePixel.x).toBeCloseTo(2048, 8);
        expect(edgePixel.y).toBeCloseTo(4096.00011248, 8);
    });

    it('derives projection axes from a rotated origin-to-edge calibration', () => {
        const calibration = {
            origin: { x: 0, y: 0, z: 0 },
            edge: { x: -10, y: 0, z: 0 },
            mapDimensions: 100,
            conversionFactor: 5,
        };
        const image = { width: 200, height: 200 };

        expect(projectWorldToMapPixel({ x: -10, y: 50, z: 0 }, calibration, image))
            .toEqual({ x: 100, y: 200 });
        expect(projectWorldToMapPixel({ x: 0, y: -50, z: -10 }, calibration, image))
            .toEqual({ x: 200, y: 100 });
    });

    it('reports navigation edges that reference missing samples', () => {
        const raw = report();
        raw.discovery.navigation.edges = [0, 2];
        const integrity = new Integrity();

        normalizeWorld(raw, assets, new Set(['alice']), new Set(['hardware']), integrity);

        expect(() => integrity.throwIfInvalid()).toThrow('Integrity validation failed with 1 issue(s)');
        expect(integrity.errors).toEqual(['Navigation edge 0 references a missing sample']);
    });

    it('reports navigation edges beyond employee movement limits', () => {
        const raw = report();
        const navigation = raw.discovery.navigation as {
            samples: Array<{ position: { y: number } }>;
        };
        navigation.samples[1]!.position.y = 10;
        const integrity = new Integrity();

        normalizeWorld(raw, assets, new Set(['alice']), new Set(['hardware']), integrity);

        expect(integrity.errors).toContain('Navigation edge 0 exceeds employee movement limits');
    });

    it('collapses exact native delivery duplicates and permits overlapping regional membership', () => {
        const raw = report();
        const regions = raw.discovery.map.regions as RawRegion[];
        const source = regions[0]!;
        source.deliveryLocations.push({
            id: 'delivery-1',
            position: { x: 8, y: 0, z: 9 },
        });
        regions.push({
            ...source,
            id: 'Docks',
            name: 'Docks',
            deliveryLocations: [{
                id: 'delivery-1',
                position: { x: 8, y: 0, z: 9 },
            }],
        });
        const integrity = new Integrity();

        const world = normalizeWorld(raw, assets, new Set(['alice']), new Set(['hardware']), integrity);

        integrity.throwIfInvalid();
        expect(world.map.regions.map((region) => [region.id, region.deliveryLocations])).toEqual([
            ['Docks', [{ id: 'delivery-1', position: { x: 8, y: 0, z: 9 } }]],
            ['Downtown', [{ id: 'delivery-1', position: { x: 8, y: 0, z: 9 } }]],
        ]);
    });

    it('reports one delivery location ID with inconsistent regional positions', () => {
        const raw = report();
        const regions = raw.discovery.map.regions as RawRegion[];
        const source = regions[0]!;
        regions.push({
            ...source,
            id: 'Docks',
            name: 'Docks',
            deliveryLocations: [{
                id: 'delivery-1',
                position: { x: 9, y: 0, z: 9 },
            }],
        });
        const integrity = new Integrity();

        normalizeWorld(raw, assets, new Set(['alice']), new Set(['hardware']), integrity);

        expect(integrity.errors).toContain(
            'Delivery location "delivery-1" has inconsistent positions across regions'
        );
    });
});

type RawRegion = {
    [key: string]: unknown;
    id: string;
    name: string;
    deliveryLocations: Array<{
        id: string;
        position: { x: number; y: number; z: number };
    }>;
};

function report(): RawReport {
    return {
        discovery: {
            map: {
                mainMapSprite: descriptor('assets/map.png'),
                tutorialMapSprite: null,
                positionUtilityMembers: {
                    OriginPoint: 'transform:Map/Origin@(10.49,0,-3.69)',
                    EdgePoint: 'transform:Map/Edge@(10.49,0,-208.23)',
                    MapDimensions: '2048',
                    conversionFactor: '5.006356',
                },
                regions: [{
                    id: 'Downtown',
                    name: 'Downtown',
                    unlockedByDefault: true,
                    rankRequirement: '',
                    sprite: descriptor('assets/region.png'),
                    boundsPointA: { x: 0, y: 0, z: 0 },
                    boundsPointB: { x: 10, y: 5, z: 10 },
                    isClosed: true,
                    verticalSize: 5,
                    polygonPoints: [
                        { x: 0, y: 0, z: 0 },
                        { x: 10, y: 0, z: 0 },
                        { x: 10, y: 0, z: 10 },
                    ],
                    adjacentRegionIds: [],
                    deliveryLocations: [{
                        id: 'delivery-1',
                        position: { x: 8, y: 0, z: 9 },
                    }],
                }],
            },
            locations: [
                location('poi', 'shared', { x: 1, y: 0, z: 1 }, [descriptor('assets/icon.png')]),
                location('poi', 'shared', { x: 2, y: 0, z: 2 }),
                location('person-position-in-loaded-save', 'alice', { x: 3, y: 0, z: 3 }),
            ],
            mapServices: [{
                kind: 'atm',
                id: 'atm-1',
                name: 'ATM',
                description: '',
                sceneName: 'Main',
                region: 'Downtown',
                position: { x: 3, y: 0, z: 4 },
                rotation: { x: 0, y: 90, z: 0 },
                accessPoint: {
                    position: { x: 4, y: 0, z: 5 },
                    rotation: { x: 0, y: 180, z: 0 },
                },
                locationSource: 'component-transform',
                linkedPersonId: 'alice',
            }],
            timedAccessZones: [{
                id: 'zone-1',
                openTime: 800,
                closeTime: 2200,
                allowExitWhenClosed: true,
                autoCloseDoor: true,
                position: { x: 5, y: 0, z: 5 },
                rotation: { x: 0, y: 0, z: 0 },
                sceneName: 'Main',
                doorCount: 2,
                nearestShops: [{ shopCode: 'hardware', distance: 2.5 }],
            }],
            navigation: {
                method: 'sampled-navmesh-grid',
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
                boundsMinimum: { x: 0, y: 0, z: 0 },
                boundsMaximum: { x: 2, y: 0, z: 0 },
                gridWidth: 2,
                gridHeight: 1,
                samples: [
                    { gridX: 0, gridZ: 0, position: { x: 0, y: 0, z: 0 }, areaMask: 1 },
                    { gridX: 1, gridZ: 0, position: { x: 2, y: 0, z: 0 }, areaMask: 1 },
                ],
                edges: [0, 1],
                error: '',
                edgeError: '',
            },
        },
    } as unknown as RawReport;
}

function descriptor(relativePath: string) {
    return { relativePath, width: 4096, height: 4096 };
}

function location(kind: string, id: string, position: object, icons: object[] = []) {
    return {
        kind,
        id,
        name: id,
        description: '',
        sceneName: 'Main',
        position,
        rotation: { x: 0, y: 0, z: 0 },
        personId: '',
        icons,
    };
}
