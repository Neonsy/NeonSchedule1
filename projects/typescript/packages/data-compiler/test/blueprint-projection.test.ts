import { describe, expect, it } from 'vitest';

import {
    BlueprintProjector,
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

describe('blueprint world projection', () => {
    it('projects a rotated footprint, collider, emitter, and interaction point into property space', () => {
        const result = new BlueprintProjector(dataset()).project(blueprint());

        expect(result.kind).toBe('projected');
        if (result.kind !== 'projected') return;

        const projected = result.placements[0]!;
        expect(projected.kind).toBe('grid');
        if (projected.kind !== 'grid') return;
        expect(projected.worldYaw).toBe(180);
        expect(projected.root.worldPosition).toEqual(vector(10.5, 2.5, 20));
        expect(projected.root.worldRotation).toEqual(expect.objectContaining({
            x: 0,
            y: 1,
            z: 0,
        }));
        expect(projected.buildPoint.worldPosition).toEqual(vector(10.5, 2, 20));
        expect(projected.boundingCollider.transform.worldPosition)
            .toEqual(vector(10.5, 3, 19));
        expect(projected.boundingCollider.worldBasis).toEqual({
            right: vector(-1, 0, 0),
            up: vector(0, 1, 0),
            forward: vector(0, 0, -1),
        });
        expect(projected.boundingCollider).not.toHaveProperty('worldBounds');
        expect(projected.temperatureEmitters).toEqual([{
            temperature: 0,
            range: 4,
            worldPosition: vector(9.5, 2.5, 18),
        }]);
        expect(projected.interactionPoints[0]?.transform.worldPosition)
            .toEqual(vector(9.5, 2.5, 18));
        expect(projected.transitAccessPoints[0]?.worldPosition)
            .toEqual(vector(11.5, 2.5, 20));
        const interactionRotation = projected.interactionPoints[0]!.transform.worldRotation;
        expect(interactionRotation).toMatchObject({ x: 0, z: 0 });
        expect(interactionRotation.y).toBeCloseTo(-0.9238795325112867);
        expect(interactionRotation.w).toBeCloseTo(0.3826834323650897);
    });

    it('rejects elevation offsets until their game-space meaning is available', () => {
        const input = dataset();
        const buildable = input.buildables[0]!;
        const firstTile = buildable.placement.footprintTiles[0]!;
        const projector = new BlueprintProjector({
            ...input,
            buildables: [{
                ...buildable,
                placement: {
                    ...buildable.placement,
                    footprintTiles: [{ ...firstTile, requiredOffset: 0.25 },
                        ...buildable.placement.footprintTiles.slice(1)],
                },
            }],
        });

        const result = projector.project(blueprint());

        expect(result.kind).toBe('rejected');
        expect(result.validation.valid).toBe(true);
        expect(result.placements).toEqual([]);
        expect(result.issues).toEqual([expect.objectContaining({
            code: 'elevation-offset-unsupported',
            placementId: 'bench-1',
            gridId: 'main',
        })]);
    });

    it.each([
        ['grid-tilt-unsupported', vector(1, 90, 0)],
        ['grid-rotation-inconsistent', vector(0, 100, 0)],
    ] as const)('rejects a placement with %s geometry', (code, rotation) => {
        const input = dataset();
        const property = input.propertyLayouts[0]!;
        const grid = property.grids[0]!;
        const projector = new BlueprintProjector({
            ...input,
            propertyLayouts: [{
                ...property,
                grids: [{
                    ...grid,
                    tiles: grid.tiles.map((tile) =>
                        tile.x === 0 && tile.y === 1 ? { ...tile, worldRotation: rotation } : tile
                    ),
                }],
            }],
        });

        const result = projector.project(blueprint());

        expect(result.kind).toBe('rejected');
        expect(result.issues.map((issue) => issue.code)).toEqual([code]);
    });

    it('does not project a blueprint rejected by grid validation', () => {
        const input = blueprint();
        const placement = input.placements[0]!;
        if (placement.kind !== 'grid') throw new Error('Expected grid fixture');
        const result = new BlueprintProjector(dataset()).project({
            ...input,
            placements: [{ ...placement, anchor: { x: 9, y: 9 } }],
        });

        expect(result.kind).toBe('rejected');
        expect(result.validation.issues.map((issue) => issue.code)).toEqual([
            'tile-outside-grid',
        ]);
        expect(result.issues).toEqual([]);
        expect(result.placements).toEqual([]);
    });
});

function dataset(): BlueprintDataset {
    return {
        manifest: { gameVersion, datasetSha256 },
        buildables: [buildable()],
        propertyLayouts: [propertyLayout()],
    };
}

function blueprint(): BlueprintDocument {
    return {
        schema: 'neonschedule1-blueprint-3',
        gameVersion,
        datasetSha256,
        propertyCode: 'warehouse',
        productionLogistics: { employees: [], supplies: [] },
        placements: [{
            id: 'bench-1',
            kind: 'grid',
            itemId: 'bench',
            gridId: 'main',
            anchor: { x: 0, y: 0 },
            rotation: 90,
        }],
    };
}

function buildable(): Buildable {
    return {
        schema: 'neonschedule1-buildable-4',
        itemId: 'bench',
        runtimeType: 'Game.Buildable',
        placement: {
            kind: 'grid',
            holdDistance: 3,
            footprintWidth: 2,
            footprintHeight: 1,
            proceduralTileType: null,
            tileSharingRule: 'standard',
            tileSharingImplementation: 'Game.GridItem',
            allowRotation: null,
            rotationIncrement: null,
            validSurfaceTypes: [],
            buildPoint: transform('BuildPoint', vector(0, -0.5, 0)),
            midAirCenterPoint: null,
            boundingCollider: collider('Bounds', vector(0, 0.5, 1)),
            footprintTiles: [
                footprintTile(0, vector(-0.25, -0.5, 0)),
                footprintTile(1, vector(0.25, -0.5, 0)),
            ],
        },
        componentTypes: [],
        colliders: [collider('Body', vector(0, 0, 0))],
        storage: null,
        temperatureEmitters: [{
            temperature: 0,
            range: 4,
            emissionPoint: vector(1, 0, 2),
        }],
        interactionPoints: [{
            componentType: 'Game.Interactable',
            member: 'AccessPoint',
            role: 'access',
            transform: transform('AccessPoint', vector(1, 0, 2), vector(0, 45, 0)),
        }],
        isTransitEntity: true,
        transitAccessPoints: [transform('TransitAccess', vector(-1, 0, 0))],
        proceduralTiles: [],
        visuals: { renderers: [], meshes: [] },
    };
}

function footprintTile(
    x: number,
    worldPosition: Vector3
): Buildable['placement']['footprintTiles'][number] {
    return {
        x,
        y: 0,
        requiredOffset: 0,
        transform: transform(`Footprint/[${x},0]`, worldPosition),
        cornerObstacles: [],
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
        grids: [propertyGrid()],
        visuals: { renderers: [], meshes: [] },
    };
}

function propertyGrid(): PropertyGrid {
    const tiles: PropertyGrid['tiles'] = [];
    for (let x = 0; x < 3; x++) {
        for (let y = 0; y < 3; y++) {
            tiles.push({
                x,
                y,
                availableOffset: 0,
                worldPosition: vector(10 + y, 2, 20 - x),
                worldRotation: vector(0, 90, 0),
            });
        }
    }
    return {
        id: 'main',
        width: 3,
        height: 3,
        tileSize: 1,
        worldOrigin: vector(10, 2, 20),
        tiles,
    };
}

function collider(path: string, worldPosition: Vector3): Collider {
    return {
        source: 'built-item',
        runtimeType: 'UnityEngine.BoxCollider',
        shape: 'box',
        enabled: true,
        isTrigger: false,
        layer: 0,
        layerName: 'Default',
        tag: 'Untagged',
        transform: transform(path, worldPosition),
        worldScale: vector(1, 1, 1),
        worldBasis: {
            right: vector(1, 0, 0),
            up: vector(0, 1, 0),
            forward: vector(0, 0, 1),
        },
        worldBounds: { center: worldPosition, size: vector(1, 1, 1) },
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

function vector(x: number, y: number, z: number): Vector3 {
    return { x, y, z };
}
