import {
    type BlueprintGridCoordinate,
    type BlueprintGridPlacement,
} from '#core/data/blueprint';
import { type Buildable } from '#core/data/buildable';
import { type PropertyGrid, type PropertyLayout } from '#core/data/property-layout';
import { rotateFootprint } from '#core/blueprint/grid-footprint';
import type {
    BlueprintValidationIssue,
    BlueprintValidationIssueCode,
    ResolvedBlueprintCornerObstacle,
    ResolvedBlueprintGridPlacement,
    ResolvedBlueprintGridTile,
} from '#core/blueprint/validation';

export interface IndexedGrid {
    readonly grid: PropertyGrid;
    readonly tileByCoordinate: ReadonlyMap<string, PropertyGrid['tiles'][number]>;
}

type GridResolution =
    | { readonly placement: ResolvedBlueprintGridPlacement; readonly issues: readonly [] }
    | { readonly placement: null; readonly issues: readonly BlueprintValidationIssue[] };

export function indexPropertyGrids(layout: PropertyLayout): ReadonlyMap<string, IndexedGrid> {
    return indexUnique(
        layout.grids.map((grid) => ({ grid, tileByCoordinate: indexGridTiles(grid) })),
        ({ grid }) => grid.id,
        `grid ID in property ${JSON.stringify(layout.propertyCode)}`
    );
}

export function resolveGridPlacement(
    placement: BlueprintGridPlacement,
    buildableByItemId: ReadonlyMap<string, Buildable>,
    gridById: ReadonlyMap<string, IndexedGrid>
): GridResolution {
    const buildable = buildableByItemId.get(placement.itemId);
    if (buildable === undefined) {
        return failedPlacement(
            'buildable-unavailable',
            `Placement ${JSON.stringify(placement.id)} references unavailable buildable ` +
                JSON.stringify(placement.itemId),
            placement
        );
    }
    if (buildable.placement.kind !== 'grid') {
        return failedPlacement(
            'placement-kind-incompatible',
            `Buildable ${JSON.stringify(placement.itemId)} uses ` +
                `${JSON.stringify(buildable.placement.kind)} placement, not property-grid placement`,
            placement
        );
    }
    const tileSharingRule = buildable.placement.tileSharingRule;
    if (tileSharingRule !== 'standard' && tileSharingRule !== 'floor-rack') {
        return failedPlacement(
            'tile-sharing-unsupported',
            `Buildable ${JSON.stringify(placement.itemId)} has no supported tile-sharing rule`,
            placement
        );
    }
    const grid = gridById.get(placement.gridId);
    if (grid === undefined) {
        return failedPlacement(
            'grid-unavailable',
            `Placement ${JSON.stringify(placement.id)} references unavailable grid ` +
                JSON.stringify(placement.gridId),
            placement
        );
    }

    const footprint = validatedFootprint(buildable);
    const rotated = rotateFootprint(footprint, placement.rotation);
    const occupiedTiles: ResolvedBlueprintGridTile[] = [];
    const outside: BlueprintGridCoordinate[] = [];
    const unavailable: BlueprintGridCoordinate[] = [];
    for (const tile of rotated) {
        const coordinate = {
            x: placement.anchor.x + tile.x,
            y: placement.anchor.y + tile.y,
        };
        if (
            !Number.isSafeInteger(coordinate.x) ||
            !Number.isSafeInteger(coordinate.y) ||
            coordinate.x < 0 ||
            coordinate.y < 0 ||
            coordinate.x >= grid.grid.width ||
            coordinate.y >= grid.grid.height
        ) {
            outside.push(coordinate);
            continue;
        }
        const propertyTile = grid.tileByCoordinate.get(coordinateKey(coordinate));
        if (propertyTile === undefined) {
            unavailable.push(coordinate);
            continue;
        }
        occupiedTiles.push({
            ...coordinate,
            requiredOffset: tile.requiredOffset,
            availableOffset: propertyTile.availableOffset,
        });
    }
    if (outside.length > 0) {
        const issues = [issue(
            'tile-outside-grid',
            `Placement ${JSON.stringify(placement.id)} extends outside grid ` +
                JSON.stringify(placement.gridId),
            [placement.id],
            placement.gridId,
            sortedCoordinates(outside)
        )];
        if (unavailable.length > 0) {
            issues.push(issue(
                'tile-unavailable',
                `Placement ${JSON.stringify(placement.id)} uses unavailable tiles in grid ` +
                    JSON.stringify(placement.gridId),
                [placement.id],
                placement.gridId,
                sortedCoordinates(unavailable)
            ));
        }
        return { placement: null, issues };
    }
    if (unavailable.length > 0) {
        return {
            placement: null,
            issues: [issue(
                'tile-unavailable',
                `Placement ${JSON.stringify(placement.id)} uses unavailable tiles in grid ` +
                    JSON.stringify(placement.gridId),
                [placement.id],
                placement.gridId,
                sortedCoordinates(unavailable)
            )],
        };
    }
    const incompatibleOffsets = occupiedTiles.filter((tile) =>
        tile.availableOffset !== 0 &&
        tile.requiredOffset !== 0 &&
        tile.requiredOffset > tile.availableOffset
    );
    if (incompatibleOffsets.length > 0) {
        return failedPlacement(
            'tile-offset-incompatible',
            `Placement ${JSON.stringify(placement.id)} requires more offset than grid ` +
                `${JSON.stringify(placement.gridId)} provides`,
            placement,
            sortedCoordinates(incompatibleOffsets.map(({ x, y }) => ({ x, y })))
        );
    }
    return {
        placement: {
            id: placement.id,
            kind: 'grid',
            itemId: placement.itemId,
            gridId: placement.gridId,
            rotation: placement.rotation,
            tileSharingRule,
            occupiedTiles: occupiedTiles.sort(compareCoordinates),
            cornerObstacles: resolvedCornerObstacles(rotated, placement.anchor, grid),
        },
        issues: [],
    };
}

export function tileSharingIssues(
    placements: readonly ResolvedBlueprintGridPlacement[]
): BlueprintValidationIssue[] {
    const occupantsByTile = new Map<
        string,
        {
            readonly gridId: string;
            readonly tile: BlueprintGridCoordinate;
            readonly occupants: ResolvedBlueprintGridPlacement[];
        }
    >();
    for (const placement of placements) {
        for (const tile of placement.occupiedTiles) {
            const key = `${placement.gridId}:${coordinateKey(tile)}`;
            const entry = occupantsByTile.get(key);
            if (entry === undefined) {
                occupantsByTile.set(key, {
                    gridId: placement.gridId,
                    tile: { x: tile.x, y: tile.y },
                    occupants: [placement],
                });
            } else {
                entry.occupants.push(placement);
            }
        }
    }
    const incompatibilities: BlueprintValidationIssue[] = [];
    for (const entry of occupantsByTile.values()) {
        if (entry.occupants.length < 2) continue;
        const sharingAllowed =
            entry.occupants.length === 2 &&
            entry.occupants[0]!.tileSharingRule !== entry.occupants[1]!.tileSharingRule;
        if (sharingAllowed) continue;
        const placementIds = entry.occupants.map((placement) => placement.id).sort();
        incompatibilities.push(issue(
            'tile-sharing-incompatible',
            `Placements ${placementIds.map((id) => JSON.stringify(id)).join(', ')} ` +
                'cannot share a grid tile',
            placementIds,
            entry.gridId,
            [entry.tile]
        ));
    }
    return incompatibilities.sort((left, right) =>
        (left.gridId ?? '').localeCompare(right.gridId ?? '') ||
        compareCoordinates(left.tiles[0]!, right.tiles[0]!)
    );
}

function indexGridTiles(
    grid: PropertyGrid
): ReadonlyMap<string, PropertyGrid['tiles'][number]> {
    requirePositiveSafeInteger(grid.width, `Grid ${JSON.stringify(grid.id)} width`);
    requirePositiveSafeInteger(grid.height, `Grid ${JSON.stringify(grid.id)} height`);
    return indexUnique(
        grid.tiles,
        (tile) => {
            requireSafeInteger(tile.x, `Grid ${JSON.stringify(grid.id)} tile X`);
            requireSafeInteger(tile.y, `Grid ${JSON.stringify(grid.id)} tile Y`);
            if (tile.x < 0 || tile.y < 0 || tile.x >= grid.width || tile.y >= grid.height) {
                throw new RangeError(`Grid ${JSON.stringify(grid.id)} contains an out-of-bounds tile`);
            }
            requireFinite(tile.availableOffset, `Grid ${JSON.stringify(grid.id)} tile available offset`);
            return coordinateKey(tile);
        },
        `tile coordinate in grid ${JSON.stringify(grid.id)}`
    );
}

function validatedFootprint(
    buildable: Buildable
): readonly Buildable['placement']['footprintTiles'][number][] {
    const width = buildable.placement.footprintWidth;
    const height = buildable.placement.footprintHeight;
    if (width === null || height === null) {
        throw new Error(`Grid buildable ${JSON.stringify(buildable.itemId)} has no footprint dimensions`);
    }
    requirePositiveSafeInteger(width, `Buildable ${JSON.stringify(buildable.itemId)} footprint width`);
    requirePositiveSafeInteger(height, `Buildable ${JSON.stringify(buildable.itemId)} footprint height`);
    const coordinates = new Set<string>();
    for (const tile of buildable.placement.footprintTiles) {
        requireSafeInteger(tile.x, `Buildable ${JSON.stringify(buildable.itemId)} footprint X`);
        requireSafeInteger(tile.y, `Buildable ${JSON.stringify(buildable.itemId)} footprint Y`);
        if (tile.x < 0 || tile.y < 0 || tile.x >= width || tile.y >= height) {
            throw new RangeError(
                `Buildable ${JSON.stringify(buildable.itemId)} contains an out-of-bounds footprint tile`
            );
        }
        requireFinite(tile.requiredOffset, `Buildable ${JSON.stringify(buildable.itemId)} footprint required offset`);
        const key = coordinateKey(tile);
        if (coordinates.has(key)) {
            throw new Error(`Buildable ${JSON.stringify(buildable.itemId)} has duplicate footprint tiles`);
        }
        coordinates.add(key);
    }
    if (coordinates.size !== width * height) {
        throw new Error(`Buildable ${JSON.stringify(buildable.itemId)} footprint is incomplete`);
    }
    return buildable.placement.footprintTiles;
}

function resolvedCornerObstacles(
    footprint: ReturnType<typeof rotateFootprint>,
    anchor: BlueprintGridCoordinate,
    grid: IndexedGrid
): ResolvedBlueprintCornerObstacle[] {
    const obstacles: ResolvedBlueprintCornerObstacle[] = [];
    for (const tile of footprint) {
        const sourceTile = { x: anchor.x + tile.x, y: anchor.y + tile.y };
        for (const direction of tile.cornerDirections) {
            const neighbouringTiles = sortedCoordinates([
                sourceTile,
                { x: sourceTile.x + direction.x, y: sourceTile.y },
                { x: sourceTile.x, y: sourceTile.y + direction.y },
                { x: sourceTile.x + direction.x, y: sourceTile.y + direction.y },
            ]);
            if (neighbouringTiles.every((entry) => grid.tileByCoordinate.has(coordinateKey(entry)))) {
                obstacles.push({ sourceTile, neighbouringTiles });
            }
        }
    }
    return obstacles.sort((left, right) =>
        compareCoordinates(left.sourceTile, right.sourceTile) ||
        compareCoordinates(left.neighbouringTiles[0]!, right.neighbouringTiles[0]!)
    );
}

function failedPlacement(
    code: BlueprintValidationIssueCode,
    message: string,
    placement: BlueprintGridPlacement,
    tiles: readonly BlueprintGridCoordinate[] = []
): GridResolution {
    return {
        placement: null,
        issues: [issue(code, message, [placement.id], placement.gridId, tiles)],
    };
}

function issue(
    code: BlueprintValidationIssueCode,
    message: string,
    placementIds: readonly string[],
    gridId: string | null,
    tiles: readonly BlueprintGridCoordinate[]
): BlueprintValidationIssue {
    return { code, message, placementIds, gridId, tiles };
}

function indexUnique<T>(
    values: readonly T[],
    keyFor: (value: T) => string,
    label: string
): ReadonlyMap<string, T> {
    const index = new Map<string, T>();
    for (const value of values) {
        const key = keyFor(value);
        if (key.trim().length === 0) throw new TypeError(`${label} must not be blank`);
        if (index.has(key)) throw new Error(`Dataset contains duplicate ${label} ${JSON.stringify(key)}`);
        index.set(key, value);
    }
    return index;
}

function sortedCoordinates(coordinates: readonly BlueprintGridCoordinate[]): BlueprintGridCoordinate[] {
    return [...coordinates].sort(compareCoordinates);
}

function compareCoordinates(left: BlueprintGridCoordinate, right: BlueprintGridCoordinate): number {
    return left.x - right.x || left.y - right.y;
}

function coordinateKey(coordinate: BlueprintGridCoordinate): string {
    return `${coordinate.x},${coordinate.y}`;
}

function requirePositiveSafeInteger(value: number, label: string): void {
    requireSafeInteger(value, label);
    if (value < 1) throw new RangeError(`${label} must be positive`);
}

function requireFinite(value: number, label: string): void {
    if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
}

function requireSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`);
}
