import { describe, expect, it } from 'vitest';

import {
    BlueprintProjector,
    BlueprintValidator,
    planBlueprintConstructionOrder,
    type BlueprintDataset,
    type BlueprintDocument,
    type BlueprintProceduralGridPlacement,
    type Buildable,
    type Collider,
    type ProceduralTile,
    type PropertyLayout,
    type Transform,
    type Vector3,
} from '@neonschedule1/core';

const gameVersion = '0.4.6f12';
const datasetSha256 = 'a'.repeat(64);

describe('procedural-grid blueprint placement', () => {
    it('validates and projects a complete footprint onto property-owned tiles', () => {
        const input = dataset();
        const document = blueprint([lightPlacement('light', null, propertyTileIds)]);

        const validation = new BlueprintValidator(input).validate(document);
        const projection = new BlueprintProjector(input).project(document);

        expect(validation.valid).toBe(true);
        expect(validation.resolvedPlacements).toEqual([expect.objectContaining({
            id: 'light',
            kind: 'procedural-grid',
            parentPlacementId: null,
            tileType: 'Rack',
            frame: {
                space: 'world',
                position: vector(5, 2, 7),
                rotation: { x: 0, y: 0, z: 0, w: 1 },
            },
        })]);
        expect(projection.kind).toBe('projected');
        if (projection.kind !== 'projected') return;
        expect(projection.placements[0]).toEqual(expect.objectContaining({
            id: 'light',
            kind: 'procedural-grid',
            parentPlacementId: null,
            tileIds: propertyTileIds,
            root: expect.objectContaining({ worldPosition: vector(5, 2, 7) }),
        }));
    });

    it('projects provider-owned tiles and orders the provider before its child', () => {
        const input = dataset();
        const document = blueprint([
            lightPlacement('light', 'rack', providerTileIds),
            gridPlacement('rack'),
        ]);
        const validation = new BlueprintValidator(input).validate(document);
        const projection = new BlueprintProjector(input).project(document);
        const construction = planBlueprintConstructionOrder(validation);

        expect(validation.valid).toBe(true);
        expect(projection.kind).toBe('projected');
        if (projection.kind !== 'projected') return;
        expect(projection.placements[0]).toEqual(expect.objectContaining({
            id: 'light',
            root: expect.objectContaining({ worldPosition: vector(10, 0.849, 20) }),
        }));
        expect(construction).toEqual(expect.objectContaining({
            kind: 'ordered',
            placementIds: ['rack', 'light'],
            constraints: [{
                beforePlacementId: 'rack',
                afterPlacementId: 'light',
                parentPlacementId: 'rack',
            }],
        }));
    });

    it.each([
        [
            'procedural-parent-unavailable',
            dataset(),
            lightPlacement('light', 'missing', providerTileIds),
        ],
        [
            'procedural-tile-type-incompatible',
            dataset({ firstPropertyTileType: 'FutureRack' }),
            lightPlacement('light', null, propertyTileIds),
        ],
        [
            'procedural-footprint-incompatible',
            dataset({ shiftFirstPropertyTile: true }),
            lightPlacement('light', null, propertyTileIds),
        ],
        [
            'procedural-footprint-incompatible',
            datasetWithScaledPropertyTile(),
            lightPlacement('light', null, propertyTileIds),
        ],
    ] as const)('reports %s without projecting guessed geometry', (code, input, placement) => {
        const document = blueprint([placement]);
        const validation = new BlueprintValidator(input).validate(document);

        expect(validation.valid).toBe(false);
        expect(validation.resolvedPlacements).toEqual([]);
        expect(validation.issues).toEqual([expect.objectContaining({
            code,
            placementIds: ['light'],
        })]);
        expect(new BlueprintProjector(input).project(document).kind).toBe('rejected');
    });

    it('reports procedural tile sharing and parent cycles explicitly', () => {
        const input = dataset();
        const shared = new BlueprintValidator(input).validate(blueprint([
            lightPlacement('left', null, propertyTileIds),
            lightPlacement('right', null, propertyTileIds),
        ]));
        const cyclic = new BlueprintValidator(input).validate(blueprint([
            lightPlacement('left', 'right', providerTileIds),
            lightPlacement('right', 'left', providerTileIds),
        ]));

        expect(shared.valid).toBe(false);
        expect(shared.issues).toHaveLength(4);
        expect(shared.issues.every((issue) =>
            issue.code === 'procedural-tile-sharing-incompatible'
        )).toBe(true);
        expect(cyclic.valid).toBe(false);
        expect(cyclic.issues.map((issue) => issue.code)).toEqual([
            'procedural-parent-cycle',
            'procedural-parent-cycle',
        ]);
    });
});

const coordinates = [
    { x: 0, y: 0, position: vector(0.25, 0.341, -0.25) },
    { x: 0, y: 1, position: vector(0.25, 0.341, 0.25) },
    { x: 1, y: 0, position: vector(-0.25, 0.341, -0.25) },
    { x: 1, y: 1, position: vector(-0.25, 0.341, 0.25) },
] as const;
const propertyTileIds = coordinates.map(({ x, y }) => `property-${x}-${y}`);
const providerTileIds = coordinates.map(({ x, y }) => `provider-${x}-${y}`);

function dataset(options: {
    readonly firstPropertyTileType?: string;
    readonly shiftFirstPropertyTile?: boolean;
} = {}): BlueprintDataset {
    return {
        manifest: { gameVersion, datasetSha256 },
        buildables: [rackBuildable(), lightBuildable()],
        propertyLayouts: [propertyLayout(options)],
    };
}

function datasetWithScaledPropertyTile(): BlueprintDataset {
    const input = dataset();
    const layout = input.propertyLayouts[0]!;
    return {
        ...input,
        propertyLayouts: [{
            ...layout,
            proceduralTiles: layout.proceduralTiles.map((tile, index) => index === 0
                ? {
                    ...tile,
                    transform: { ...tile.transform, localScale: vector(2, 1, 1) },
                }
                : tile
            ),
        }],
    };
}

function blueprint(placements: BlueprintDocument['placements']): BlueprintDocument {
    return {
        schema: 'neonschedule1-blueprint-4',
        gameVersion,
        datasetSha256,
        propertyCode: 'warehouse',
        productionLogistics: { employees: [], supplies: [] },
        placements,
    };
}

function lightPlacement(
    id: string,
    parentPlacementId: string | null,
    tileIds: readonly string[]
): BlueprintProceduralGridPlacement {
    return {
        id,
        kind: 'procedural-grid',
        itemId: 'grow-light',
        parentPlacementId,
        tiles: coordinates.map(({ x, y }, index) => ({ x, y, tileId: tileIds[index]! })),
    };
}

function gridPlacement(id: string): BlueprintDocument['placements'][number] {
    return {
        id,
        kind: 'grid',
        itemId: 'rack',
        gridId: 'main',
        anchor: { x: 0, y: 0 },
        rotation: 0,
    };
}

function rackBuildable(): Buildable {
    return {
        ...baseBuildable('rack', 'grid'),
        placement: {
            ...basePlacement('grid'),
            footprintWidth: 1,
            footprintHeight: 1,
            tileSharingRule: 'standard',
            tileSharingImplementation: 'Game.StandardGridItem',
            footprintTiles: [footprintTile(0, 0, vector(0, 0, 0))],
        },
        proceduralTiles: coordinates.map(({ x, y, position }) => proceduralTile(
            `provider-${x}-${y}`,
            add(position, vector(0, 0.849, 0))
        )),
    };
}

function lightBuildable(): Buildable {
    return {
        ...baseBuildable('grow-light', 'procedural-grid'),
        placement: {
            ...basePlacement('procedural-grid'),
            footprintWidth: 2,
            footprintHeight: 2,
            proceduralTileType: 'Rack',
            footprintTiles: coordinates.map(({ x, y, position }) =>
                footprintTile(x, y, position)
            ),
        },
    };
}

function baseBuildable(itemId: string, kind: string): Buildable {
    return {
        schema: 'neonschedule1-buildable-5',
        itemId,
        runtimeType: 'Game.Buildable',
        placement: basePlacement(kind),
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

function basePlacement(kind: string): Buildable['placement'] {
    return {
        kind,
        holdDistance: 3,
        footprintWidth: null,
        footprintHeight: null,
        proceduralTileType: null,
        tileSharingRule: null,
        tileSharingImplementation: null,
        allowRotation: null,
        rotationIncrement: null,
        validSurfaceTypes: [],
        buildPoint: transform('BuildPoint', vector(0, 0, 0), vector(0, 0, 0)),
        midAirCenterPoint: null,
        boundingCollider: collider('Bounds'),
        footprintTiles: [],
    };
}

function propertyLayout(options: {
    readonly firstPropertyTileType?: string;
    readonly shiftFirstPropertyTile?: boolean;
}): PropertyLayout {
    const propertyTiles = coordinates.map(({ x, y, position }, index) => {
        const shift = index === 0 && options.shiftFirstPropertyTile
            ? vector(0.1, 0, 0)
            : vector(0, 0, 0);
        return proceduralTile(
            `property-${x}-${y}`,
            add(add(position, vector(5, 2, 7)), shift),
            index === 0 ? (options.firstPropertyTileType ?? 'Rack') : 'Rack'
        );
    });
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
        proceduralTiles: propertyTiles,
        loadingDocks: [],
        grids: [{
            id: 'main',
            width: 1,
            height: 1,
            tileSize: 0.5,
            worldOrigin: vector(10, 0, 20),
            tiles: [{
                x: 0,
                y: 0,
                availableOffset: 0,
                worldPosition: vector(10, 0, 20),
                worldRotation: vector(0, 0, 0),
            }],
        }],
        visuals: { renderers: [], meshes: [] },
    };
}

function footprintTile(
    x: number,
    y: number,
    position: Vector3
): Buildable['placement']['footprintTiles'][number] {
    return {
        x,
        y,
        requiredOffset: 0,
        transform: transform(`Footprint/[${x},${y}]`, position, vector(0, 0, 180)),
        cornerObstacles: [],
    };
}

function proceduralTile(id: string, position: Vector3, type = 'Rack'): ProceduralTile {
    return { id, type, transform: transform(id, position, vector(0, 0, 180)) };
}

function collider(path: string): Collider {
    return {
        source: 'built-item',
        runtimeType: 'UnityEngine.BoxCollider',
        shape: 'box',
        enabled: true,
        isTrigger: true,
        layer: 2,
        layerName: 'Ignore Raycast',
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

function transform(
    path: string,
    worldPosition = vector(0, 0, 0),
    worldRotation = vector(0, 0, 0)
): Transform {
    return {
        name: path,
        path,
        worldPosition,
        localPosition: worldPosition,
        worldRotation,
        localScale: vector(1, 1, 1),
    };
}

function add(left: Vector3, right: Vector3): Vector3 {
    return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

function vector(x: number, y: number, z: number): Vector3 {
    return { x, y, z };
}
