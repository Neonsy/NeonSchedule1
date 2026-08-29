import type {
    Buildable,
    Collider,
    PropertyLayout,
    Transform,
    Vector3,
} from '@neonschedule1/core';

import {
    PublicBlueprintGeometrySchema,
    type PublicBlueprintGeometry,
} from '#public-data/browser/geometry-schema';
import { createPublicKeyResolver } from '#public-data/browser/public-key';

type KeyResolver = (sourceKey: string) => string;
type ItemKeyResolver = (sourceKey: string) => string;
type PropertyKeyResolver = (sourceKey: string) => string;

const publishedInteractionRoles = new Set([
    'automation-link',
    'item-placement',
    'operator-access',
]);
const knownInteractionRoles = new Set([
    'automation-link',
    'camera',
    'item-placement',
    'operator-access',
    'placement',
    'task-area',
    'ui',
]);

export function compilePublicBlueprintGeometry(
    buildableSources: readonly Buildable[],
    propertySources: readonly PropertyLayout[],
    itemKey: ItemKeyResolver,
    propertyKey: PropertyKeyResolver
): PublicBlueprintGeometry {
    const keys = geometryKeyResolvers(buildableSources, propertySources);
    const buildables = buildableSources.map((buildable) => compileBuildable(
        buildable,
        itemKey,
        keys.collider,
        keys.interaction,
        keys.access,
        keys.proceduralTile
    ));
    const properties = propertySources.map((property) => compilePropertyLayout(
        property,
        propertyKey,
        keys
    ));
    buildables.sort((left, right) => left.itemKey.localeCompare(right.itemKey));
    properties.sort((left, right) => left.propertyKey.localeCompare(right.propertyKey));

    const geometry = {
        proof: {
            status: 'blueprint-calculation-input-complete' as const,
            renderAssets: 'not-published' as const,
            sourceRuntimeMetadata: 'not-published' as const,
        },
        buildables,
        properties,
        counts: {
            buildables: buildables.length,
            properties: properties.length,
            buildableColliders: buildables.reduce(
                (count, buildable) => count + 1 + buildable.colliders.length,
                0
            ),
            footprintTiles: buildables.reduce(
                (count, buildable) => count + buildable.placement.footprintTiles.length,
                0
            ),
            interactionPoints: buildables.reduce(
                (count, buildable) => count + buildable.interactionPoints.length,
                0
            ),
            transitAccessPoints: buildables.reduce(
                (count, buildable) => count + buildable.transitAccessPoints.length,
                0
            ),
            propertyFixedColliders: properties.reduce(
                (count, property) => count + property.fixedColliders.length,
                0
            ),
            propertyBoundaryColliders: properties.reduce(
                (count, property) => count + property.boundaryColliders.length,
                0
            ),
            propertySurfaceColliders: properties.reduce(
                (count, property) => count + property.surfaces.reduce(
                    (surfaceCount, surface) => surfaceCount + surface.colliderGroups.reduce(
                        (groupCount, group) => groupCount + group.colliders.length,
                        0
                    ),
                    0
                ),
                0
            ),
            surfaceMeshes: properties.reduce(
                (count, property) => count + property.surfaceMeshes.length,
                0
            ),
            surfaces: properties.reduce(
                (count, property) => count + property.surfaces.length,
                0
            ),
            proceduralTiles: buildables.reduce(
                (count, buildable) => count + buildable.proceduralTiles.length,
                properties.reduce(
                    (count, property) => count + property.proceduralTiles.length,
                    0
                )
            ),
            loadingDocks: properties.reduce(
                (count, property) => count + property.loadingDocks.length,
                0
            ),
            grids: properties.reduce((count, property) => count + property.grids.length, 0),
            gridTiles: properties.reduce(
                (count, property) => count + property.grids.reduce(
                    (tileCount, grid) => tileCount + grid.tiles.length,
                    0
                ),
                0
            ),
        },
    };
    return PublicBlueprintGeometrySchema.assert(geometry);
}

function compileBuildable(
    source: Buildable,
    itemKey: ItemKeyResolver,
    colliderKey: KeyResolver,
    interactionKey: KeyResolver,
    accessKey: KeyResolver,
    proceduralTileKey: KeyResolver
) {
    const sourcePrefix = `buildable\0${source.itemId}`;
    const interactions = source.interactionPoints.flatMap((point, index) => {
        requireKnownInteractionRole(point.role);
        return publishedInteractionRoles.has(point.role)
            ? [{
                key: interactionKey(`${sourcePrefix}\0interaction\0${index}\0${point.transform.path}`),
                role: publicInteractionRole(point.role),
                transform: publicTransform(point.transform),
            }]
            : [];
    });
    return {
        itemKey: itemKey(source.itemId),
        placement: {
            kind: publicPlacementKind(source.placement.kind),
            holdDistance: source.placement.holdDistance,
            footprintWidth: source.placement.footprintWidth,
            footprintHeight: source.placement.footprintHeight,
            proceduralTileType: source.placement.proceduralTileType === null
                ? null
                : publicProceduralTileType(source.placement.proceduralTileType),
            tileSharingRule: publicTileSharingRule(source.placement.tileSharingRule),
            allowRotation: source.placement.allowRotation,
            rotationIncrement: source.placement.rotationIncrement,
            validSurfaceTypes: source.placement.validSurfaceTypes.map(publicSurfaceType),
            buildPoint: publicTransform(source.placement.buildPoint),
            boundingCollider: publicCollider(
                source.placement.boundingCollider,
                colliderKey(`${sourcePrefix}\0bounding\0${source.placement.boundingCollider.transform.path}`)
            ),
            footprintTiles: source.placement.footprintTiles.map((tile, tileIndex) => ({
                x: tile.x,
                y: tile.y,
                requiredOffset: tile.requiredOffset,
                transform: publicTransform(tile.transform),
                cornerDirections: tile.cornerObstacles.flatMap((corner, cornerIndex) =>
                    corner.enabled
                        ? [cornerDirection(corner.transform.localPosition, source.itemId, tileIndex, cornerIndex)]
                        : []
                ),
            })),
        },
        colliders: source.colliders.map((collider, index) => publicCollider(
            collider,
            colliderKey(`${sourcePrefix}\0collider\0${index}\0${collider.transform.path}`)
        )),
        storage: source.storage === null ? null : {
            slotCount: source.storage.slotCount,
            displayRowCount: source.storage.displayRowCount,
            slotsAreFilterable: source.storage.slotsAreFilterable,
            maximumAccessDistance: source.storage.maxAccessDistance,
        },
        temperatureEmitters: source.temperatureEmitters.map((emitter) => ({
            temperature: emitter.temperature,
            range: emitter.range,
            position: emitter.emissionPoint,
        })),
        interactionPoints: interactions,
        isTransitEntity: source.isTransitEntity,
        transitAccessPoints: source.transitAccessPoints.map((point, index) => ({
            key: accessKey(`${sourcePrefix}\0transit\0${index}\0${point.path}`),
            transform: publicTransform(point),
        })),
        usableByCleaners: source.trash?.usableByCleaners ?? null,
        proceduralTiles: source.proceduralTiles.map((tile, index) => ({
            key: proceduralTileKey(`${sourcePrefix}\0procedural\0${index}\0${tile.id}`),
            type: publicProceduralTileType(tile.type),
            transform: publicTransform(tile.transform),
        })),
    };
}

function compilePropertyLayout(
    source: PropertyLayout,
    propertyKey: PropertyKeyResolver,
    keys: GeometryKeyResolvers
) {
    const sourcePrefix = `property\0${source.propertyCode}`;
    const meshKey = (sourceMeshId: string): string =>
        keys.mesh(`${sourcePrefix}\0mesh\0${sourceMeshId}`);
    return {
        propertyKey: propertyKey(source.propertyCode),
        frame: { position: source.worldPosition, rotation: source.worldRotation },
        entryPoints: {
            player: publicTransform(source.spawnPoint),
            interior: publicTransform(source.interiorSpawnPoint),
            npc: publicTransform(source.npcSpawnPoint),
        },
        boundingCollider: source.boundingBox === null ? null : publicCollider(
            source.boundingBox,
            keys.collider(`${sourcePrefix}\0bounding\0${source.boundingBox.transform.path}`)
        ),
        boundaryColliders: source.boundaryColliders.map((collider, index) => publicCollider(
            collider,
            keys.collider(`${sourcePrefix}\0boundary\0${index}\0${collider.transform.path}`)
        )),
        fixedColliders: source.fixedColliders.map((collider, index) => publicCollider(
            collider,
            keys.collider(`${sourcePrefix}\0fixed\0${index}\0${collider.transform.path}`)
        )),
        surfaceMeshes: source.surfaceMeshes.map((mesh) => ({
            key: meshKey(mesh.meshId),
            vertices: mesh.vertices,
            triangles: mesh.triangles,
            bounds: mesh.bounds,
        })),
        surfaces: source.surfaces.map((surface) => ({
            key: keys.surface(`${sourcePrefix}\0surface\0${surface.id}`),
            type: publicSurfaceType(surface.type),
            transform: publicTransform(surface.transform),
            validFaces: surface.validFaces.map(publicSurfaceFace),
            colliderGroups: groupSurfaceColliders(surface.colliders).map((group) => ({
                key: keys.surfaceColliderGroup(
                    `${sourcePrefix}\0surface-group\0${surface.id}\0${group.path}`
                ),
                colliders: group.colliders.map(({ collider, index }) => {
                    const publicMeshKey = surfaceColliderMeshKey(collider, meshKey);
                    return publicCollider(
                        collider,
                        keys.collider(
                            `${sourcePrefix}\0surface\0${surface.id}\0${index}\0${collider.transform.path}`
                        ),
                        publicMeshKey
                    );
                }),
            })),
        })),
        proceduralTiles: source.proceduralTiles.map((tile, index) => ({
            key: keys.proceduralTile(`${sourcePrefix}\0procedural\0${index}\0${tile.id}`),
            type: publicProceduralTileType(tile.type),
            transform: publicTransform(tile.transform),
        })),
        loadingDocks: source.loadingDocks.map((dock, dockIndex) => ({
            key: keys.dock(`${sourcePrefix}\0dock\0${dockIndex}\0${dock.id}`),
            transform: publicTransform(dock.transform),
            parkingTransform: publicTransform(dock.parkingTransform),
            inputSlotCount: dock.inputSlotCount,
            outputSlotCount: dock.outputSlotCount,
            accessPoints: dock.accessPoints.map((point, pointIndex) => ({
                key: keys.access(
                    `${sourcePrefix}\0dock\0${dockIndex}\0access\0${pointIndex}\0${point.path}`
                ),
                transform: publicTransform(point),
            })),
        })),
        grids: source.grids.map((grid) => ({
            key: keys.grid(`${sourcePrefix}\0grid\0${grid.id}`),
            width: grid.width,
            height: grid.height,
            tileSize: grid.tileSize,
            origin: grid.worldOrigin,
            tiles: grid.tiles.map((tile) => ({
                x: tile.x,
                y: tile.y,
                availableOffset: tile.availableOffset,
                position: tile.worldPosition,
                rotation: tile.worldRotation,
            })),
        })),
    };
}

interface GeometryKeyResolvers {
    readonly collider: KeyResolver;
    readonly interaction: KeyResolver;
    readonly access: KeyResolver;
    readonly proceduralTile: KeyResolver;
    readonly surface: KeyResolver;
    readonly surfaceColliderGroup: KeyResolver;
    readonly mesh: KeyResolver;
    readonly dock: KeyResolver;
    readonly grid: KeyResolver;
}

function geometryKeyResolvers(
    buildables: readonly Buildable[],
    properties: readonly PropertyLayout[]
): GeometryKeyResolvers {
    const colliderKeys: string[] = [];
    const interactionKeys: string[] = [];
    const accessKeys: string[] = [];
    const proceduralTileKeys: string[] = [];
    const surfaceKeys: string[] = [];
    const surfaceColliderGroupKeys = new Set<string>();
    const meshKeys: string[] = [];
    const dockKeys: string[] = [];
    const gridKeys: string[] = [];

    for (const source of buildables) {
        const prefix = `buildable\0${source.itemId}`;
        colliderKeys.push(`${prefix}\0bounding\0${source.placement.boundingCollider.transform.path}`);
        source.colliders.forEach((collider, index) =>
            colliderKeys.push(`${prefix}\0collider\0${index}\0${collider.transform.path}`)
        );
        source.interactionPoints.forEach((point, index) => {
            requireKnownInteractionRole(point.role);
            if (publishedInteractionRoles.has(point.role)) {
                interactionKeys.push(`${prefix}\0interaction\0${index}\0${point.transform.path}`);
            }
        });
        source.transitAccessPoints.forEach((point, index) =>
            accessKeys.push(`${prefix}\0transit\0${index}\0${point.path}`)
        );
        source.proceduralTiles.forEach((tile, index) =>
            proceduralTileKeys.push(`${prefix}\0procedural\0${index}\0${tile.id}`)
        );
    }
    for (const source of properties) {
        const prefix = `property\0${source.propertyCode}`;
        if (source.boundingBox !== null) {
            colliderKeys.push(`${prefix}\0bounding\0${source.boundingBox.transform.path}`);
        }
        source.boundaryColliders.forEach((collider, index) =>
            colliderKeys.push(`${prefix}\0boundary\0${index}\0${collider.transform.path}`)
        );
        source.fixedColliders.forEach((collider, index) =>
            colliderKeys.push(`${prefix}\0fixed\0${index}\0${collider.transform.path}`)
        );
        source.surfaceMeshes.forEach((mesh) => meshKeys.push(`${prefix}\0mesh\0${mesh.meshId}`));
        source.surfaces.forEach((surface) => {
            surfaceKeys.push(`${prefix}\0surface\0${surface.id}`);
            surface.colliders.forEach((collider, index) => {
                colliderKeys.push(
                    `${prefix}\0surface\0${surface.id}\0${index}\0${collider.transform.path}`
                );
                surfaceColliderGroupKeys.add(
                    `${prefix}\0surface-group\0${surface.id}\0${collider.transform.path}`
                );
            });
        });
        source.proceduralTiles.forEach((tile, index) =>
            proceduralTileKeys.push(`${prefix}\0procedural\0${index}\0${tile.id}`)
        );
        source.loadingDocks.forEach((dock, dockIndex) => {
            dockKeys.push(`${prefix}\0dock\0${dockIndex}\0${dock.id}`);
            dock.accessPoints.forEach((point, pointIndex) => accessKeys.push(
                `${prefix}\0dock\0${dockIndex}\0access\0${pointIndex}\0${point.path}`
            ));
        });
        source.grids.forEach((grid) => gridKeys.push(`${prefix}\0grid\0${grid.id}`));
    }

    return {
        collider: createPublicKeyResolver('collider', colliderKeys),
        interaction: createPublicKeyResolver('interaction', interactionKeys),
        access: createPublicKeyResolver('access', accessKeys),
        proceduralTile: createPublicKeyResolver('proceduraltile', proceduralTileKeys),
        surface: createPublicKeyResolver('surface', surfaceKeys),
        surfaceColliderGroup: createPublicKeyResolver(
            'surfacecollider',
            [...surfaceColliderGroupKeys]
        ),
        mesh: createPublicKeyResolver('mesh', meshKeys),
        dock: createPublicKeyResolver('dock', dockKeys),
        grid: createPublicKeyResolver('grid', gridKeys),
    };
}

function groupSurfaceColliders(colliders: readonly Collider[]) {
    const groups = new Map<string, { collider: Collider; index: number }[]>();
    colliders.forEach((collider, index) => {
        const group = groups.get(collider.transform.path) ?? [];
        group.push({ collider, index });
        groups.set(collider.transform.path, group);
    });
    return [...groups].map(([path, group]) => ({ path, colliders: group }));
}

function publicCollider(source: Collider, key: string, meshKey: string | null = null) {
    const shape = publicColliderShape(source.shape);
    if (meshKey !== null && (shape !== 'mesh' || source.meshId === null)) {
        throw new Error('Only mesh colliders can reference public surface meshes');
    }
    return {
        key,
        enabled: source.enabled,
        isTrigger: source.isTrigger,
        shape,
        box: sourceBox(source),
        bounds: source.worldBounds,
        meshKey,
        meshFrame: meshKey === null ? null : {
            position: source.transform.worldPosition,
            basis: source.worldBasis,
        },
        convex: meshKey === null ? null : source.isConvex,
    };
}

function surfaceColliderMeshKey(
    collider: Collider,
    meshKey: (sourceMeshId: string) => string
): string | null {
    if (collider.shape === 'box') return null;
    if (collider.shape === 'mesh' && collider.meshId !== null) return meshKey(collider.meshId);
    throw new Error(`Surface collider uses unsupported calculation geometry ${collider.shape}`);
}

function sourceBox(source: Collider) {
    if (source.shape !== 'box' || source.localCenter === null || source.localSize === null) {
        return null;
    }
    const halfAxes = [
        scale(source.worldBasis.right, Math.abs(source.localSize.x) / 2),
        scale(source.worldBasis.up, Math.abs(source.localSize.y) / 2),
        scale(source.worldBasis.forward, Math.abs(source.localSize.z) / 2),
    ] as const;
    const determinant = dot(halfAxes[0], cross(halfAxes[1], halfAxes[2]));
    if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-20) return null;
    return {
        center: add(
            source.transform.worldPosition,
            add(
                add(
                    scale(source.worldBasis.right, source.localCenter.x),
                    scale(source.worldBasis.up, source.localCenter.y)
                ),
                scale(source.worldBasis.forward, source.localCenter.z)
            )
        ),
        halfAxes,
    };
}

function publicTransform(source: Transform) {
    return {
        position: source.worldPosition,
        rotation: source.worldRotation,
        scale: source.localScale,
    };
}

function cornerDirection(
    localPosition: Vector3,
    itemId: string,
    tileIndex: number,
    cornerIndex: number
): { readonly x: -1 | 1; readonly y: -1 | 1 } {
    if (
        !Number.isFinite(localPosition.x) || localPosition.x === 0 ||
        !Number.isFinite(localPosition.z) || localPosition.z === 0
    ) {
        throw new Error(
            `Buildable ${JSON.stringify(itemId)} footprint tile ${tileIndex} corner ` +
                `${cornerIndex} has no finite direction`
        );
    }
    return {
        x: localPosition.x < 0 ? -1 : 1,
        y: localPosition.z < 0 ? -1 : 1,
    };
}

function publicPlacementKind(source: string): 'grid' | 'procedural-grid' | 'surface' {
    if (source === 'grid' || source === 'procedural-grid' || source === 'surface') return source;
    throw new Error(`Missing public buildable placement mapping for ${source}`);
}

function publicTileSharingRule(source: string | null): 'standard' | 'floor-rack' | null {
    if (source === null || source === 'standard' || source === 'floor-rack') return source;
    throw new Error(`Missing public tile-sharing mapping for ${source}`);
}

function publicColliderShape(source: string): 'box' | 'capsule' | 'mesh' | 'sphere' {
    if (source === 'box' || source === 'capsule' || source === 'mesh' || source === 'sphere') {
        return source;
    }
    throw new Error(`Missing public collider-shape mapping for ${source}`);
}

function publicSurfaceType(source: string): 'roof' | 'wall' {
    if (source === 'Roof') return 'roof';
    if (source === 'Wall') return 'wall';
    throw new Error(`Missing public surface-type mapping for ${source}`);
}

function publicSurfaceFace(
    source: string
): 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right' {
    if (source === 'Front') return 'front';
    if (source === 'Back') return 'back';
    if (source === 'Top') return 'top';
    if (source === 'Bottom') return 'bottom';
    if (source === 'Left') return 'left';
    if (source === 'Right') return 'right';
    throw new Error(`Missing public surface-face mapping for ${source}`);
}

function publicProceduralTileType(source: string): 'rack' {
    if (source === 'Rack') return 'rack';
    throw new Error(`Missing public procedural-tile mapping for ${source}`);
}

function publicInteractionRole(
    source: string
): 'automation-link' | 'item-placement' | 'operator-access' {
    if (
        source === 'automation-link' || source === 'item-placement' ||
        source === 'operator-access'
    ) return source;
    throw new Error(`Missing public interaction-role mapping for ${source}`);
}

function requireKnownInteractionRole(source: string): void {
    if (!knownInteractionRoles.has(source)) {
        throw new Error(`Missing publication rule for interaction role ${source}`);
    }
}

function add(left: Vector3, right: Vector3): Vector3 {
    return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

function scale(vector: Vector3, factor: number): Vector3 {
    return { x: vector.x * factor, y: vector.y * factor, z: vector.z * factor };
}

function dot(left: Vector3, right: Vector3): number {
    return left.x * right.x + left.y * right.y + left.z * right.z;
}

function cross(left: Vector3, right: Vector3): Vector3 {
    return {
        x: left.y * right.z - left.z * right.y,
        y: left.z * right.x - left.x * right.z,
        z: left.x * right.y - left.y * right.x,
    };
}
