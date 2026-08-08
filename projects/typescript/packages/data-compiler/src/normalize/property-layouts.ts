import {
    PropertyLayoutSchema,
    type Property,
    type PropertyGrid,
    type PropertyLayout,
    type MeshAsset,
    type TriangleMesh,
} from '@neonschedule1/core';

import type { VerifiedAssets } from '#data-compiler/acquisition/assets';
import type { RawReport } from '#data-compiler/acquisition/types';
import { readTriangleMesh } from '#data-compiler/acquisition/triangle-mesh';
import { indexUnique, Integrity, requireReferences } from '#data-compiler/integrity';
import {
    numberField,
    objectArray,
    stringArrayField,
    stringField,
    vector3,
    type JsonObject,
} from '#data-compiler/json';
import {
    colliderGeometryKey,
    normalizeCollider,
    normalizeSceneVisuals,
    normalizeTransform,
} from '#data-compiler/normalize/geometry';

export async function normalizePropertyLayouts(
    report: PropertyLayoutReport,
    assets: VerifiedAssets,
    properties: readonly Property[],
    meshes: readonly MeshAsset[],
    integrity: Integrity
): Promise<PropertyLayout[]> {
    const index = indexUnique(
        report.discovery.propertyLayouts,
        'propertyCode',
        'report.discovery.propertyLayouts',
        integrity
    );
    const propertyByCode = new Map(properties.map((property) => [property.code, property]));
    requireReferences(index.keys(), new Set(propertyByCode.keys()), 'property layout', integrity);
    const meshById = new Map(meshes.map((mesh) => [mesh.id, mesh]));
    const layouts: PropertyLayout[] = [];
    for (const [propertyCode, raw] of index.entries()) {
        layouts.push(await normalizePropertyLayout(
            propertyCode,
            raw,
            propertyByCode.get(propertyCode),
            assets,
            meshById,
            integrity
        ));
    }
    return layouts.sort((left, right) => left.propertyCode.localeCompare(right.propertyCode));
}

type PropertyLayoutReport = {
    readonly discovery: Pick<RawReport['discovery'], 'propertyLayouts'>;
};

async function normalizePropertyLayout(
    propertyCode: string,
    raw: JsonObject,
    property: Property | undefined,
    assets: VerifiedAssets,
    meshById: ReadonlyMap<string, MeshAsset>,
    integrity: Integrity
): Promise<PropertyLayout> {
    const path = `report.discovery.propertyLayouts[${JSON.stringify(propertyCode)}]`;
    const boundaryColliders = objectArray(raw.boundaryColliders, `${path}.boundaryColliders`).map(
        (collider, index) => normalizeCollider(collider, `${path}.boundaryColliders[${index}]`)
    );
    const boundaryKeys = new Set(boundaryColliders.map(colliderGeometryKey));
    const fixedColliders = objectArray(raw.colliders, `${path}.colliders`)
        .map((collider, index) => normalizeCollider(collider, `${path}.colliders[${index}]`))
        .filter((collider) => {
            return (
                collider.source !== 'placed-buildable' &&
                !boundaryKeys.has(colliderGeometryKey(collider))
            );
        });
    const surfaces = objectArray(raw.surfaces, `${path}.surfaces`).map((surface, index) => {
        const surfacePath = `${path}.surfaces[${index}]`;
        const transform = normalizeTransform(surface.transform, `${surfacePath}.transform`);
        const sourceGuid = stringField(surface, 'guid', surfacePath);
        return {
            id: isMissingGuid(sourceGuid) ? `path:${transform.path}` : sourceGuid,
            sourceGuid: isMissingGuid(sourceGuid) ? null : sourceGuid,
            type: stringField(surface, 'surfaceType', surfacePath),
            transform,
            container: normalizeTransform(surface.container, `${surfacePath}.container`),
            validFaces: stringArrayField(surface, 'validFaces', surfacePath),
            colliders: objectArray(surface.colliders, `${surfacePath}.colliders`).map(
                (collider, colliderIndex) => normalizeCollider(
                    collider,
                    `${surfacePath}.colliders[${colliderIndex}]`
                )
            ),
        };
    });
    const surfaceMeshes = await normalizeSurfaceMeshes(surfaces, assets, meshById, integrity);
    const proceduralTiles = objectArray(raw.proceduralTiles, `${path}.proceduralTiles`)
        .map((tile, index) => {
            const tilePath = `${path}.proceduralTiles[${index}]`;
            return {
                id: stringField(tile, 'id', tilePath),
                type: stringField(tile, 'tileType', tilePath),
                transform: normalizeTransform(tile.transform, `${tilePath}.transform`),
            };
        });
    const loadingDocks = objectArray(raw.loadingDocks, `${path}.loadingDocks`).map((dock, index) => {
        const dockPath = `${path}.loadingDocks[${index}]`;
        const parentCode = stringField(dock, 'parentPropertyCode', dockPath);
        if (parentCode !== propertyCode) {
            integrity.addError(
                `Loading dock ${JSON.stringify(stringField(dock, 'guid', dockPath))} belongs to ${JSON.stringify(parentCode)}, not ${JSON.stringify(propertyCode)}`
            );
        }
        return {
            id: stringField(dock, 'guid', dockPath),
            name: stringField(dock, 'name', dockPath),
            transform: normalizeTransform(dock.transform, `${dockPath}.transform`),
            parkingTransform: normalizeTransform(dock.parkingTransform, `${dockPath}.parkingTransform`),
            inputSlotCount: numberField(dock, 'inputSlotCount', dockPath),
            outputSlotCount: numberField(dock, 'outputSlotCount', dockPath),
            accessPoints: objectArray(dock.accessPoints, `${dockPath}.accessPoints`).map((point, pointIndex) =>
                normalizeTransform(point, `${dockPath}.accessPoints[${pointIndex}]`)
            ),
        };
    });
    const grids = objectArray(raw.grids, `${path}.grids`).map((grid, index) =>
        normalizeGrid(grid, `${path}.grids[${index}]`, integrity)
    );
    validateUniqueIds(propertyCode, 'surface', surfaces, integrity);
    validateUniqueIds(propertyCode, 'procedural tile', proceduralTiles, integrity);
    validateUniqueIds(propertyCode, 'loading dock', loadingDocks, integrity);
    validateUniqueIds(propertyCode, 'grid', grids, integrity);
    validatePropertySummary(propertyCode, raw, property, loadingDocks.length, grids.length, integrity);

    return PropertyLayoutSchema.assert({
        schema: 'neonschedule1-property-layout-4',
        propertyCode,
        propertyName: stringField(raw, 'propertyName', path),
        worldPosition: vector3(raw.position, `${path}.position`),
        worldRotation: vector3(raw.rotation, `${path}.rotation`),
        spawnPoint: normalizeTransform(raw.spawnPoint, `${path}.spawnPoint`),
        interiorSpawnPoint: normalizeTransform(raw.interiorSpawnPoint, `${path}.interiorSpawnPoint`),
        npcSpawnPoint: normalizeTransform(raw.npcSpawnPoint, `${path}.npcSpawnPoint`),
        boundingBox:
            raw.boundingBox === undefined || raw.boundingBox === null
                ? null
                : normalizeCollider(raw.boundingBox, `${path}.boundingBox`),
        boundaryColliders,
        fixedColliders,
        surfaceMeshes,
        surfaces,
        proceduralTiles,
        loadingDocks,
        grids,
        visuals: normalizeSceneVisuals(raw.visuals, `${path}.visuals`, assets, integrity),
    });
}

async function normalizeSurfaceMeshes(
    surfaces: readonly PropertyLayout['surfaces'][number][],
    assets: VerifiedAssets,
    meshById: ReadonlyMap<string, MeshAsset>,
    integrity: Integrity
): Promise<TriangleMesh[]> {
    const meshIds = [...new Set(surfaces.flatMap((surface) =>
        surface.colliders.flatMap((collider) => collider.meshId === null ? [] : [collider.meshId])
    ))].sort();
    const fileById = new Map(assets.files.map((file) => [file.id, file]));
    const geometries: TriangleMesh[] = [];
    for (const meshId of meshIds) {
        const mesh = meshById.get(meshId);
        if (mesh === undefined || mesh.fileIds.length !== 1) {
            integrity.addError(
                `Surface mesh ${JSON.stringify(meshId)} must resolve to exactly one geometry file`
            );
            continue;
        }
        const fileId = mesh.fileIds[0]!;
        const file = fileById.get(fileId);
        const filePath = assets.filePathById.get(fileId);
        if (file === undefined || filePath === undefined) {
            integrity.addError(`Surface mesh ${JSON.stringify(meshId)} has no verified local file`);
            continue;
        }
        try {
            const geometry = await readTriangleMesh(filePath, file.mediaType);
            integrity.check(
                `surface mesh ${meshId} bounds match its report`,
                boundsMatch(geometry.bounds, mesh.bounds),
                `Surface mesh ${JSON.stringify(meshId)} geometry bounds differ from its report`
            );
            geometries.push({ meshId, ...geometry });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            integrity.addError(`Surface mesh ${JSON.stringify(meshId)} could not be decoded: ${message}`);
        }
    }
    return geometries;
}

function boundsMatch(left: TriangleMesh['bounds'], right: TriangleMesh['bounds']): boolean {
    return (['x', 'y', 'z'] as const).every((axis) =>
        Math.abs(left.center[axis] - right.center[axis]) <= 1e-5 &&
        Math.abs(left.size[axis] - right.size[axis]) <= 1e-5
    );
}

function normalizeGrid(raw: JsonObject, path: string, integrity: Integrity): PropertyGrid {
    const id = stringField(raw, 'guid', path);
    const width = numberField(raw, 'width', path);
    const height = numberField(raw, 'height', path);
    const tileSize = numberField(raw, 'tileSize', path);
    const tiles = objectArray(raw.tiles, `${path}.tiles`).map((tile, index) => {
        const tilePath = `${path}.tiles[${index}]`;
        return {
            x: numberField(tile, 'x', tilePath),
            y: numberField(tile, 'y', tilePath),
            availableOffset: numberField(tile, 'availableOffset', tilePath),
            worldPosition: vector3(tile.position, `${tilePath}.position`),
            worldRotation: vector3(tile.rotation, `${tilePath}.rotation`),
        };
    });
    integrity.check(
        `grid ${id} has positive dimensions`,
        width > 0 && height > 0 && tileSize > 0,
        `Grid ${JSON.stringify(id)} has non-positive dimensions`
    );
    const coordinates = new Set(tiles.map((tile) => `${tile.x},${tile.y}`));
    integrity.check(
        `grid ${id} tile coordinates are unique`,
        coordinates.size === tiles.length,
        `Grid ${JSON.stringify(id)} has duplicate tile coordinates`
    );
    integrity.check(
        `grid ${id} tiles are within its dimensions`,
        tiles.every((tile) => tile.x >= 0 && tile.y >= 0 && tile.x < width && tile.y < height),
        `Grid ${JSON.stringify(id)} has tiles outside its dimensions`
    );
    return { id, width, height, tileSize, worldOrigin: vector3(raw.origin, `${path}.origin`), tiles };
}

function validateUniqueIds(
    propertyCode: string,
    label: string,
    records: readonly { readonly id: string }[],
    integrity: Integrity
): void {
    const ids = new Set(records.map((record) => record.id));
    integrity.check(
        `property ${propertyCode} ${label} ids are unique`,
        ids.size === records.length,
        `Property ${JSON.stringify(propertyCode)} has duplicate ${label} ids`
    );
}

function validatePropertySummary(
    propertyCode: string,
    raw: JsonObject,
    property: Property | undefined,
    loadingDockCount: number,
    gridCount: number,
    integrity: Integrity
): void {
    if (property === undefined) return;
    const path = `report.discovery.propertyLayouts[${JSON.stringify(propertyCode)}]`;
    integrity.check(
        `property ${propertyCode} layout name matches its summary`,
        stringField(raw, 'propertyName', path) === property.name,
        `Property ${JSON.stringify(propertyCode)} layout name differs from its summary`
    );
    const spawnPosition = normalizeTransform(raw.spawnPoint, `${path}.spawnPoint`).worldPosition;
    integrity.check(
        `property ${propertyCode} spawn position matches its summary`,
        spawnPosition.x === property.position.x &&
            spawnPosition.y === property.position.y &&
            spawnPosition.z === property.position.z,
        `Property ${JSON.stringify(propertyCode)} spawn position differs from its summary`
    );
    integrity.check(
        `property ${propertyCode} loading dock count matches its summary`,
        loadingDockCount === property.loadingDockCount,
        `Property ${JSON.stringify(propertyCode)} layout has ${loadingDockCount} loading docks, expected ${property.loadingDockCount}`
    );
    integrity.check(
        `property ${propertyCode} grid count matches its summary`,
        gridCount === property.gridCount,
        `Property ${JSON.stringify(propertyCode)} layout has ${gridCount} grids, expected ${property.gridCount}`
    );
}

function isMissingGuid(value: string): boolean {
    return value === '' || value === '00000000-0000-0000-0000-000000000000';
}
