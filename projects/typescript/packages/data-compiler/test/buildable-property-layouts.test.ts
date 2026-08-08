import { describe, expect, it } from 'vitest';

import type { Property } from '@neonschedule1/core';

import type { VerifiedAssets } from '#data-compiler/acquisition/assets';
import { Integrity } from '#data-compiler/integrity';
import { normalizeBuildables } from '#data-compiler/normalize/buildables';
import { normalizePropertyLayouts } from '#data-compiler/normalize/property-layouts';

const assets: VerifiedAssets = {
    files: [],
    directFileIdByPath: new Map([['sprites/test.png', 'file:test']]),
    offlineFileIdsByMeshKey: new Map(),
    filePathById: new Map(),
    directFileCount: 1,
    offlineFileCount: 0,
};

describe('buildable and property-layout normalization', () => {
    it('keeps stable placement geometry and resolves visual asset references', () => {
        const integrity = new Integrity();
        const buildables = normalizeBuildables(
            {
                discovery: {
                    buildables: [
                        {
                            itemId: 'workstation',
                            runtimeType: 'Game.GridItem',
                            placementKind: 'grid',
                            holdDistance: 3.5,
                            footprintWidth: 1,
                            footprintHeight: 2,
                            proceduralTileType: '',
                            tileSharingRule: 'standard',
                            tileSharingImplementation: 'ScheduleOne.EntityFramework.GridItem',
                            validSurfaceTypes: [],
                            buildPoint: transform('BuildPoint'),
                            boundingCollider: collider('built-item', 'Bounds'),
                            footprintTiles: [
                                {
                                    x: 0,
                                    y: 0,
                                    requiredOffset: 0,
                                    transform: transform('Footprint/[0,0]'),
                                    corners: [
                                        {
                                            obstacleEnabled: true,
                                            coordinates: { x: 0, y: 0 },
                                            transform: transform('Footprint/[0,0]/CornerObstacle'),
                                        },
                                    ],
                                },
                                {
                                    x: 0,
                                    y: 0,
                                    requiredOffset: 0.5,
                                    transform: transform('Footprint/[0,1]'),
                                    corners: [],
                                },
                            ],
                            componentTypes: ['Game.GridItem'],
                            colliders: [
                                collider('built-item', 'Bounds'),
                                collider('built-item', 'Trigger', { radius: 1 }),
                            ],
                            storage: {
                                name: 'Workstation',
                                subtitle: '',
                                slotCount: 4,
                                displayRowCount: 1,
                                slotsAreFilterable: true,
                                maxAccessDistance: 3,
                                transform: transform('Storage'),
                            },
                            temperatureEmitters: [
                                { temperature: 0, range: 4, emissionPoint: point(0, 1, 0) },
                            ],
                            interactionPoints: [
                                {
                                    componentType: 'Game.Interactable',
                                    member: 'Button',
                                    role: 'ui',
                                    transform: transform('Button'),
                                },
                            ],
                            transitAccessPoints: [transform('AccessPoint')],
                            isTransitEntity: true,
                            proceduralTiles: [{
                                id: 'RackTile',
                                tileType: 'Rack',
                                transform: transform('RackTile'),
                            }],
                            visuals: {
                                renderers: [
                                    {
                                        runtimeType: 'UnityEngine.SpriteRenderer',
                                        transform: transform('Icon'),
                                        enabled: true,
                                        boundsCenter: point(0, 1, 0),
                                        boundsSize: point(1, 1, 0),
                                        color: rgba(),
                                        sprite: { relativePath: 'sprites/test.png' },
                                        meshAssetReferenceKey: '',
                                        materialAssetReferenceKeys: ['material:test'],
                                    },
                                ],
                                meshes: [
                                    { transform: transform('Body'), meshAssetReferenceKey: 'mesh:test' },
                                ],
                            },
                        },
                    ],
                },
            },
            assets,
            new Set(['workstation']),
            integrity
        );

        expect(integrity.errors).toEqual([]);
        expect(buildables[0]).toMatchObject({
            schema: 'neonschedule1-buildable-4',
            itemId: 'workstation',
            placement: {
                kind: 'grid',
                footprintWidth: 1,
                footprintHeight: 2,
                proceduralTileType: null,
                tileSharingRule: 'standard',
                tileSharingImplementation: 'ScheduleOne.EntityFramework.GridItem',
                allowRotation: null,
                rotationIncrement: null,
            },
            colliders: [
                {
                    shape: 'box',
                    worldScale: point(1, 1, 1),
                    worldBasis: {
                        right: point(1, 0, 0),
                        up: point(0, 1, 0),
                        forward: point(0, 0, 1),
                    },
                },
                { shape: 'sphere' },
            ],
            storage: { slotCount: 4 },
            transitAccessPoints: [{ path: 'AccessPoint' }],
            isTransitEntity: true,
            proceduralTiles: [{ id: 'RackTile', type: 'Rack' }],
            visuals: {
                renderers: [
                    {
                        spriteFileId: 'file:test',
                        meshId: null,
                        materialIds: ['material:test'],
                    },
                ],
                meshes: [{ meshId: 'mesh:test' }],
            },
        });
        expect(buildables[0]?.placement.footprintTiles.map((tile) => [tile.x, tile.y])).toEqual([
            [0, 0],
            [0, 1],
        ]);
        expect(buildables[0]?.placement.footprintTiles[0]?.cornerObstacles).toEqual([
            expect.objectContaining({ enabled: true, coordinates: { x: 0, y: 0 } }),
        ]);
    });

    it('removes loaded-save state and duplicate boundary geometry from property layouts', async () => {
        const integrity = new Integrity();
        const property: Property = {
            schema: 'neonschedule1-property-1',
            code: 'warehouse',
            name: 'Warehouse',
            price: 1_000,
            employeeCapacity: 4,
            loadingDockCount: 0,
            gridCount: 1,
            ambientTemperature: 20,
            ownedByDefault: false,
            position: point(0, 0, 0),
            business: null,
            hasLayout: true,
        };
        const boundary = collider('property-boundary', 'Boundary');
        const duplicateBoundary = collider('property-fixed', 'Boundary');
        const layouts = await normalizePropertyLayouts(
            {
                discovery: {
                    propertyLayouts: [
                        {
                            propertyCode: 'warehouse',
                            propertyName: 'Warehouse',
                            position: point(10, 0, 20),
                            rotation: point(0, 90, 0),
                            spawnPoint: transform('Spawn'),
                            interiorSpawnPoint: transform('InteriorSpawn'),
                            npcSpawnPoint: transform('NpcSpawn'),
                            boundaryColliders: [boundary],
                            colliders: [
                                duplicateBoundary,
                                collider('property-fixed', 'Wall'),
                                collider('placed-buildable', 'LoadedSaveItem'),
                            ],
                            surfaces: [],
                            proceduralTiles: [],
                            loadingDocks: [],
                            grids: [
                                {
                                    guid: 'grid-1',
                                    width: 2,
                                    height: 2,
                                    tileSize: 0.5,
                                    origin: point(10, 0, 20),
                                    tiles: [
                                        {
                                            x: 0,
                                            y: 0,
                                            availableOffset: 0,
                                            position: point(10, 0, 20),
                                            rotation: point(0, 90, 0),
                                            canBeBuiltOnInLoadedSave: true,
                                            buildableOccupantCount: 2,
                                            tileTemperature: 5,
                                        },
                                    ],
                                },
                            ],
                            itemsInLoadedSave: [{ itemId: 'loaded-item' }],
                            visuals: { renderers: [], meshes: [] },
                        },
                    ],
                },
            },
            assets,
            [property],
            [],
            integrity
        );

        expect(integrity.errors).toEqual([]);
        expect(layouts[0]?.boundaryColliders).toHaveLength(1);
        expect(layouts[0]?.fixedColliders.map((entry) => entry.transform.path)).toEqual(['Wall']);
        expect(layouts[0]?.grids[0]?.tiles[0]).toEqual({
            x: 0,
            y: 0,
            availableOffset: 0,
            worldPosition: point(10, 0, 20),
            worldRotation: point(0, 90, 0),
        });
        expect(JSON.stringify(layouts[0])).not.toContain('itemsInLoadedSave');
        expect(JSON.stringify(layouts[0])).not.toContain('buildableOccupantCount');
        expect(JSON.stringify(layouts[0])).not.toContain('tileTemperature');
        expect(JSON.stringify(layouts[0])).not.toContain('canBeBuiltOnInLoadedSave');
    });
});

function point(x: number, y: number, z: number) {
    return { x, y, z };
}

function transform(path: string) {
    return {
        name: path.split('/').at(-1) ?? path,
        path,
        position: point(0, 0, 0),
        localPosition: point(0, 0, 0),
        rotation: point(0, 0, 0),
        localScale: point(1, 1, 1),
    };
}

function collider(source: string, path: string, options: { readonly radius?: number } = {}) {
    return {
        source,
        runtimeType: options.radius === undefined ? 'UnityEngine.BoxCollider' : 'UnityEngine.SphereCollider',
        enabled: true,
        isTrigger: false,
        layer: 0,
        layerName: 'Default',
        tag: 'Untagged',
        transform: transform(path),
        worldScale: point(1, 1, 1),
        worldRight: point(1, 0, 0),
        worldUp: point(0, 1, 0),
        worldForward: point(0, 0, 1),
        boundsCenter: point(0, 0, 0),
        boundsSize: point(1, 1, 1),
        ...(options.radius === undefined
            ? { localCenter: point(0, 0, 0), localSize: point(1, 1, 1) }
            : { radius: options.radius }),
        meshName: '',
        meshAssetReferenceKey: '',
    };
}

function rgba() {
    return { r: 1, g: 1, b: 1, a: 1, htmlRgba: '#FFFFFFFF' };
}
