import { describe, expect, it } from 'vitest';

import {
    BlueprintValidator,
    type BlueprintDataset,
    type BlueprintDocument,
    type Buildable,
    type Collider,
    type PropertyGrid,
    type PropertyLayout,
    type Transform,
    type Vector3,
} from '@neonschedule1/core';

const gameVersion = '0.4.6f11';
const datasetSha256 = 'a'.repeat(64);

describe('blueprint validation', () => {
    it('resolves rotated grid footprints to exact property tiles', () => {
        const validator = new BlueprintValidator(dataset());
        const result = validator.validate(blueprint([
            placement('bench-1', 'bench', 'main', 1, 0, 90),
        ]));

        expect(result.valid).toBe(true);
        expect(result.issues).toEqual([]);
        expect(result.resolvedPlacements).toEqual([
            {
                id: 'bench-1',
                itemId: 'bench',
                gridId: 'main',
                rotation: 90,
                tileSharingRule: 'standard',
                occupiedTiles: [
                    { x: 1, y: 0, requiredOffset: 0, availableOffset: 0 },
                    { x: 1, y: 1, requiredOffset: 0, availableOffset: 0 },
                ],
            },
        ]);
    });

    it.each([
        [0, [[0, 0, 0], [0, 1, 1], [1, 0, 2], [1, 1, 3]]],
        [90, [[0, 0, 1], [0, 1, 3], [1, 0, 0], [1, 1, 2]]],
        [180, [[0, 0, 3], [0, 1, 2], [1, 0, 1], [1, 1, 0]]],
        [270, [[0, 0, 2], [0, 1, 0], [1, 0, 3], [1, 1, 1]]],
    ] as const)('rotates per-tile footprint evidence through %i degrees', (rotation, expected) => {
        const validator = new BlueprintValidator(dataset());
        const result = validator.validate(blueprint([
            placement('panel-1', 'panel', 'main', 0, 0, rotation),
        ]));

        expect(result.valid).toBe(true);
        expect(result.resolvedPlacements[0]?.occupiedTiles.map((tile) => [
            tile.x,
            tile.y,
            tile.requiredOffset,
        ])).toEqual(expected);
    });

    it('reports sparse, out-of-bounds, and incompatible placements without partial resolution', () => {
        const validator = new BlueprintValidator(dataset());
        const result = validator.validate(blueprint([
            placement('sparse', 'bench', 'main', 1, 1, 0),
            placement('outside', 'bench', 'main', 3, 2, 0),
            placement('surface', 'wall-lamp', 'main', 0, 0, 0),
            placement('unknown-item', 'missing', 'main', 0, 0, 0),
            placement('unknown-grid', 'bench', 'missing', 0, 0, 0),
        ]));

        expect(result.valid).toBe(false);
        expect(result.resolvedPlacements).toEqual([]);
        expect(result.issues.map((issue) => [issue.code, issue.placementIds, issue.tiles])).toEqual([
            ['tile-unavailable', ['sparse'], [{ x: 2, y: 1 }]],
            ['tile-outside-grid', ['outside'], [{ x: 4, y: 2 }]],
            ['placement-kind-incompatible', ['surface'], []],
            ['buildable-unavailable', ['unknown-item'], []],
            ['grid-unavailable', ['unknown-grid'], []],
        ]);
    });

    it('reports exact tiles shared by incompatible buildables', () => {
        const validator = new BlueprintValidator(dataset());
        const result = validator.validate(blueprint([
            placement('left', 'bench', 'main', 0, 0, 0),
            placement('right', 'bench', 'main', 1, 0, 0),
            placement('vertical', 'bench', 'main', 1, 0, 90),
        ]));

        expect(result.valid).toBe(false);
        expect(result.resolvedPlacements).toHaveLength(3);
        expect(result.issues).toEqual([
            expect.objectContaining({
                code: 'tile-sharing-incompatible',
                placementIds: ['left', 'right', 'vertical'],
                gridId: 'main',
                tiles: [{ x: 1, y: 0 }],
            }),
        ]);
    });

    it('allows the native floor-rack and standard-item sharing pair', () => {
        const validator = new BlueprintValidator(dataset());
        const result = validator.validate(blueprint([
            placement('rack', 'rack', 'main', 0, 0, 0),
            placement('bench', 'bench', 'main', 0, 0, 0),
        ]));

        expect(result.valid).toBe(true);
        expect(result.issues).toEqual([]);
    });

    it('applies the native nonzero tile-offset compatibility rule', () => {
        const input = dataset();
        const layout = input.propertyLayouts[0]!;
        const grid = layout.grids[0]!;
        const validator = new BlueprintValidator({
            ...input,
            propertyLayouts: [{
                ...layout,
                grids: [{
                    ...grid,
                    tiles: grid.tiles.map((tile) =>
                        tile.x === 0 && tile.y === 1 ? { ...tile, availableOffset: 0.25 } : tile
                    ),
                }],
            }],
        });
        const result = validator.validate(blueprint([
            placement('panel', 'panel', 'main', 0, 0, 0),
        ]));

        expect(result.valid).toBe(false);
        expect(result.issues).toEqual([
            expect.objectContaining({
                code: 'tile-offset-incompatible',
                placementIds: ['panel'],
                tiles: [{ x: 0, y: 1 }],
            }),
        ]);
    });

    it('does not guess when a future build exposes an unknown sharing implementation', () => {
        const validator = new BlueprintValidator(dataset());
        const result = validator.validate(blueprint([
            placement('future', 'future-grid-item', 'main', 0, 0, 0),
        ]));

        expect(result.valid).toBe(false);
        expect(result.resolvedPlacements).toEqual([]);
        expect(result.issues.map((entry) => entry.code)).toEqual(['tile-sharing-unsupported']);
    });

    it('stops before placement resolution when the blueprint targets another dataset', () => {
        const validator = new BlueprintValidator(dataset());
        const result = validator.validate({
            ...blueprint([placement('bench-1', 'bench', 'main', 0, 0, 0)]),
            gameVersion: 'other',
            datasetSha256: 'b'.repeat(64),
        });

        expect(result.valid).toBe(false);
        expect(result.resolvedPlacements).toEqual([]);
        expect(result.issues.map((issue) => issue.code)).toEqual([
            'game-version-mismatch',
            'dataset-mismatch',
        ]);
    });

    it('rejects malformed document identity and coordinates before geometry evaluation', () => {
        const validator = new BlueprintValidator(dataset());
        const duplicate = blueprint([
            placement('same', 'bench', 'main', 0, 0, 0),
            placement('same', 'bench', 'main', 2, 0, 0),
        ]);
        const fractional = blueprint([placement('fractional', 'bench', 'main', 0.5, 0, 0)]);

        expect(() => validator.validate(duplicate)).toThrow('duplicate placement ID "same"');
        expect(() => validator.validate(fractional)).toThrow('anchor X at index 0 must be a safe integer');
        expect(() => validator.validate({ ...blueprint([]), datasetSha256: 'not-a-hash' }))
            .toThrow('must be a lowercase SHA-256');
    });

    it('rejects ambiguous normalized dataset indexes', () => {
        const input = dataset();
        expect(() => new BlueprintValidator({
            ...input,
            buildables: [...input.buildables, input.buildables[0]!],
        })).toThrow('duplicate buildable item ID "bench"');
    });
});

function dataset(): BlueprintDataset {
    return {
        manifest: { gameVersion, datasetSha256 },
        buildables: [
            gridBuildable(),
            offsetBuildable(),
            rackBuildable(),
            unsupportedBuildable(),
            surfaceBuildable(),
        ],
        propertyLayouts: [propertyLayout()],
    };
}

function blueprint(placements: BlueprintDocument['placements']): BlueprintDocument {
    return {
        schema: 'neonschedule1-blueprint-1',
        gameVersion,
        datasetSha256,
        propertyCode: 'warehouse',
        placements,
    };
}

function placement(
    id: string,
    itemId: string,
    gridId: string,
    x: number,
    y: number,
    rotation: 0 | 90 | 180 | 270
): BlueprintDocument['placements'][number] {
    return { id, kind: 'grid', itemId, gridId, anchor: { x, y }, rotation };
}

function gridBuildable(): Buildable {
    return buildable('bench', 'grid', 2, 1, [
        footprintTile(0, 0),
        footprintTile(1, 0),
    ]);
}

function surfaceBuildable(): Buildable {
    return buildable('wall-lamp', 'surface', null, null, []);
}

function rackBuildable(): Buildable {
    return buildable('rack', 'grid', 2, 1, [footprintTile(0, 0), footprintTile(1, 0)], 'floor-rack');
}

function unsupportedBuildable(): Buildable {
    return buildable('future-grid-item', 'grid', 1, 1, [footprintTile(0, 0)], 'unsupported');
}

function offsetBuildable(): Buildable {
    return buildable('panel', 'grid', 2, 2, [
        footprintTile(0, 0, 0),
        footprintTile(0, 1, 1),
        footprintTile(1, 0, 2),
        footprintTile(1, 1, 3),
    ]);
}

function buildable(
    itemId: string,
    kind: string,
    footprintWidth: number | null,
    footprintHeight: number | null,
    footprintTiles: Buildable['placement']['footprintTiles'],
    tileSharingRule: Buildable['placement']['tileSharingRule'] = kind === 'grid' ? 'standard' : null
): Buildable {
    return {
        schema: 'neonschedule1-buildable-3',
        itemId,
        runtimeType: 'Game.Buildable',
        placement: {
            kind,
            holdDistance: 3,
            footprintWidth,
            footprintHeight,
            proceduralTileType: null,
            tileSharingRule,
            tileSharingImplementation:
                tileSharingRule === null ? null : `Game.${tileSharingRule}`,
            allowRotation: kind === 'surface' ? true : null,
            rotationIncrement: kind === 'surface' ? 45 : null,
            validSurfaceTypes: kind === 'surface' ? ['Wall'] : [],
            buildPoint: transform('BuildPoint'),
            midAirCenterPoint: null,
            boundingCollider: collider('Bounds'),
            footprintTiles,
        },
        componentTypes: [],
        colliders: [],
        storage: null,
        temperatureEmitters: [],
        interactionPoints: [],
        visuals: { renderers: [], meshes: [] },
    };
}

function footprintTile(
    x: number,
    y: number,
    requiredOffset = 0
): Buildable['placement']['footprintTiles'][number] {
    return {
        x,
        y,
        requiredOffset,
        transform: transform(`Footprint/[${x},${y}]`),
        cornerObstacles: [],
    };
}

function propertyLayout(): PropertyLayout {
    return {
        schema: 'neonschedule1-property-layout-2',
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
        surfaces: [],
        loadingDocks: [],
        grids: [propertyGrid()],
        visuals: { renderers: [], meshes: [] },
    };
}

function propertyGrid(): PropertyGrid {
    const tiles: PropertyGrid['tiles'] = [];
    for (let x = 0; x < 4; x++) {
        for (let y = 0; y < 3; y++) {
            if (x === 2 && y === 1) continue;
            tiles.push({
                x,
                y,
                availableOffset: 0,
                worldPosition: vector(x, 0, y),
                worldRotation: vector(0, 0, 0),
            });
        }
    }
    return {
        id: 'main',
        width: 4,
        height: 3,
        tileSize: 0.5,
        worldOrigin: vector(0, 0, 0),
        tiles,
    };
}

function collider(path: string): Collider {
    return {
        source: 'built-item',
        runtimeType: 'UnityEngine.BoxCollider',
        shape: 'box',
        enabled: true,
        isTrigger: false,
        layer: 0,
        layerName: 'Default',
        tag: 'Untagged',
        transform: transform(path),
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
