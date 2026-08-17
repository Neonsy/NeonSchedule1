import { describe, expect, it } from 'vitest';

import {
    BlueprintStorageSummarizer,
    type BlueprintDataset,
    type BlueprintDocument,
    type Buildable,
    type Collider,
    type PropertyLayout,
    type Transform,
    type Vector3,
} from '@neonschedule1/core';

const gameVersion = 'test';
const datasetSha256 = 'a'.repeat(64);

describe('blueprint storage summary', () => {
    it('summarizes exact static slots without inventing current or available capacity', () => {
        const result = new BlueprintStorageSummarizer(dataset()).summarize(blueprint());

        expect(result.kind).toBe('summarized');
        if (result.kind !== 'summarized') return;
        expect(result).toMatchObject({
            slotCapacityProofStatus: 'exact',
            capacityScope: 'normalized-storage-on-valid-blueprint-placements',
            currentContentsBasis: 'not-evaluated-blueprint-has-no-runtime-contents',
            placementCount: 3,
            storagePlacementCount: 2,
            totalSlotCount: 10,
            occupiedSlotCount: null,
            availableSlotCount: null,
            nonStoragePlacementIds: ['workbench-1'],
        });
        expect(result.storagePlacements).toEqual([
            {
                placementId: 'rack-1',
                itemId: 'rack',
                storageName: 'Rack',
                storageSubtitle: 'General storage',
                slotCount: 4,
                displayRowCount: 1,
                slotsAreFilterable: true,
                maximumAccessDistance: 2,
                currentContentsBasis: 'not-evaluated-blueprint-has-no-runtime-contents',
                occupiedSlotCount: null,
                availableSlotCount: null,
            },
            {
                placementId: 'table-1',
                itemId: 'table',
                storageName: 'Table',
                storageSubtitle: '',
                slotCount: 6,
                displayRowCount: 2,
                slotsAreFilterable: false,
                maximumAccessDistance: 1.5,
                currentContentsBasis: 'not-evaluated-blueprint-has-no-runtime-contents',
                occupiedSlotCount: null,
                availableSlotCount: null,
            },
        ]);
    });

    it('does not summarize a blueprint that fails dataset compatibility', () => {
        const result = new BlueprintStorageSummarizer(dataset()).summarize({
            ...blueprint(),
            datasetSha256: 'b'.repeat(64),
        });

        expect(result.kind).toBe('rejected');
        if (result.kind !== 'rejected') return;
        expect(result.slotCapacityProofStatus).toBe('not-applicable');
        expect(result.storagePlacements).toEqual([]);
        expect(result.nonStoragePlacementIds).toEqual([]);
        expect(result.validation.issues.map(({ code }) => code)).toEqual(['dataset-mismatch']);
    });

    it('rejects normalized storage facts that cannot be exact slot counts', () => {
        const input = dataset();
        const rack = input.buildables[0]!;
        expect(() => new BlueprintStorageSummarizer({
            ...input,
            buildables: [{
                ...rack,
                storage: { ...rack.storage!, slotCount: 1.5 },
            }, ...input.buildables.slice(1)],
        })).toThrow('storage slot count must be a non-negative safe integer');
    });
});

function dataset(): BlueprintDataset {
    return {
        manifest: { gameVersion, datasetSha256 },
        buildables: [
            storageBuildable('rack', 'Rack', 'General storage', 4, 1, true, 2),
            buildable('workbench'),
            storageBuildable('table', 'Table', '', 6, 2, false, 1.5),
        ],
        propertyLayouts: [propertyLayout()],
    };
}

function blueprint(): BlueprintDocument {
    return {
        schema: 'neonschedule1-blueprint-4',
        gameVersion,
        datasetSha256,
        propertyCode: 'warehouse',
        placements: [
            placement('rack-1', 'rack', 0),
            placement('workbench-1', 'workbench', 1),
            placement('table-1', 'table', 2),
        ],
        productionLogistics: { employees: [], supplies: [] },
    };
}

function placement(
    id: string,
    itemId: string,
    x: number
): BlueprintDocument['placements'][number] {
    return { id, itemId, kind: 'grid', gridId: 'main', anchor: { x, y: 0 }, rotation: 0 };
}

function storageBuildable(
    itemId: string,
    name: string,
    subtitle: string,
    slotCount: number,
    displayRowCount: number,
    slotsAreFilterable: boolean,
    maxAccessDistance: number
): Buildable {
    return {
        ...buildable(itemId),
        storage: {
            name,
            subtitle,
            slotCount,
            displayRowCount,
            slotsAreFilterable,
            maxAccessDistance,
            transform: transform('Storage'),
        },
    };
}

function buildable(itemId: string): Buildable {
    return {
        schema: 'neonschedule1-buildable-5',
        itemId,
        runtimeType: 'Game.Buildable',
        placement: {
            kind: 'grid',
            holdDistance: 3,
            footprintWidth: 1,
            footprintHeight: 1,
            proceduralTileType: null,
            tileSharingRule: 'standard',
            tileSharingImplementation: 'Game.standard',
            allowRotation: null,
            rotationIncrement: null,
            validSurfaceTypes: [],
            buildPoint: transform('BuildPoint'),
            midAirCenterPoint: null,
            boundingCollider: collider(),
            footprintTiles: [{
                x: 0,
                y: 0,
                requiredOffset: 0,
                transform: transform('Footprint/[0,0]'),
                cornerObstacles: [],
            }],
        },
        componentTypes: [],
        colliders: [],
        storage: null,
        temperatureEmitters: [],
        interactionPoints: [],
        isTransitEntity: false,
        transitAccessPoints: [],
        trash: null,
        proceduralTiles: [],
        visuals: { renderers: [], meshes: [] },
    };
}

function propertyLayout(): PropertyLayout {
    return {
        schema: 'neonschedule1-property-layout-4',
        propertyCode: 'warehouse',
        propertyName: 'Warehouse',
        worldPosition: vector(0, 0, 0),
        worldRotation: vector(0, 0, 0),
        spawnPoint: transform('Spawn'),
        interiorSpawnPoint: transform('InteriorSpawn'),
        npcSpawnPoint: transform('NpcSpawn'),
        boundingBox: null,
        boundaryColliders: [],
        fixedColliders: [],
        surfaceMeshes: [],
        surfaces: [],
        proceduralTiles: [],
        loadingDocks: [],
        grids: [{
            id: 'main',
            width: 3,
            height: 1,
            tileSize: 0.5,
            worldOrigin: vector(0, 0, 0),
            tiles: [0, 1, 2].map((x) => ({
                x,
                y: 0,
                availableOffset: 0,
                worldPosition: vector(x, 0, 0),
                worldRotation: vector(0, 0, 0),
            })),
        }],
        visuals: { renderers: [], meshes: [] },
    };
}

function collider(): Collider {
    return {
        source: 'built-item',
        runtimeType: 'UnityEngine.BoxCollider',
        shape: 'box',
        enabled: true,
        isTrigger: false,
        layer: 0,
        layerName: 'Default',
        tag: 'Untagged',
        transform: transform('Bounds'),
        worldScale: vector(1, 1, 1),
        worldBasis: {
            right: vector(1, 0, 0),
            up: vector(0, 1, 0),
            forward: vector(0, 0, 1),
        },
        worldBounds: { center: vector(0, 0, 0), size: vector(1, 1, 1) },
        localCenter: vector(0, 0, 0),
        localSize: vector(1, 1, 1),
        radius: null,
        height: null,
        direction: null,
        meshName: null,
        meshId: null,
        meshIsReadable: null,
        isConvex: null,
    };
}

function transform(path: string): Transform {
    return {
        name: path,
        path,
        worldPosition: vector(0, 0, 0),
        localPosition: vector(0, 0, 0),
        worldRotation: vector(0, 0, 0),
        localScale: vector(1, 1, 1),
    };
}

function vector(x: number, y: number, z: number): Vector3 {
    return { x, y, z };
}
