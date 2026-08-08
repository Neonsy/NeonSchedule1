import {
    BlueprintDocumentSchema,
    type BlueprintDocument,
    type BlueprintGridCoordinate,
    type BlueprintGridPlacement,
    type BlueprintGridRotation,
} from '#core/data/blueprint';
import { BuildableSchema, type Buildable } from '#core/data/buildable';
import {
    PropertyLayoutSchema,
    type PropertyGrid,
    type PropertyLayout,
} from '#core/data/property-layout';

export interface BlueprintDataset {
    readonly manifest: {
        readonly gameVersion: string;
        readonly datasetSha256: string;
    };
    readonly buildables: readonly Buildable[];
    readonly propertyLayouts: readonly PropertyLayout[];
}

export type BlueprintValidationIssueCode =
    | 'game-version-mismatch'
    | 'dataset-mismatch'
    | 'property-unavailable'
    | 'buildable-unavailable'
    | 'placement-kind-incompatible'
    | 'grid-unavailable'
    | 'tile-outside-grid'
    | 'tile-unavailable'
    | 'tile-overlap';

export interface BlueprintValidationIssue {
    readonly code: BlueprintValidationIssueCode;
    readonly message: string;
    readonly placementIds: readonly string[];
    readonly gridId: string | null;
    readonly tiles: readonly BlueprintGridCoordinate[];
}

export interface ResolvedBlueprintGridTile extends BlueprintGridCoordinate {
    readonly requiredOffset: number;
    readonly availableOffset: number;
}

export interface ResolvedBlueprintGridPlacement {
    readonly id: string;
    readonly itemId: string;
    readonly gridId: string;
    readonly rotation: BlueprintGridRotation;
    readonly occupiedTiles: readonly ResolvedBlueprintGridTile[];
}

export interface BlueprintValidationResult {
    readonly document: BlueprintDocument;
    readonly valid: boolean;
    readonly resolvedPlacements: readonly ResolvedBlueprintGridPlacement[];
    readonly issues: readonly BlueprintValidationIssue[];
}

interface IndexedGrid {
    readonly grid: PropertyGrid;
    readonly tileByCoordinate: ReadonlyMap<string, PropertyGrid['tiles'][number]>;
}

interface IndexedProperty {
    readonly layout: PropertyLayout;
    readonly gridById: ReadonlyMap<string, IndexedGrid>;
}

const sha256Pattern = /^[a-f0-9]{64}$/u;

export class BlueprintValidator {
    readonly #gameVersion: string;
    readonly #datasetSha256: string;
    readonly #buildableByItemId: ReadonlyMap<string, Buildable>;
    readonly #propertyByCode: ReadonlyMap<string, IndexedProperty>;

    constructor(dataset: BlueprintDataset) {
        requireNonBlank(dataset.manifest.gameVersion, 'Dataset game version');
        requireSha256(dataset.manifest.datasetSha256, 'Dataset identity');
        this.#gameVersion = dataset.manifest.gameVersion;
        this.#datasetSha256 = dataset.manifest.datasetSha256;
        this.#buildableByItemId = indexUnique(
            dataset.buildables.map((buildable) => BuildableSchema.assert(buildable)),
            (buildable) => buildable.itemId,
            'buildable item ID'
        );
        this.#propertyByCode = indexUnique(
            dataset.propertyLayouts.map((input) => {
                const layout = PropertyLayoutSchema.assert(input);
                return { layout, gridById: indexPropertyGrids(layout) };
            }),
            ({ layout }) => layout.propertyCode,
            'property layout code'
        );
    }

    validate(input: BlueprintDocument): BlueprintValidationResult {
        const document = validateDocument(BlueprintDocumentSchema.assert(input));
        const compatibilityIssues = this.#compatibilityIssues(document);
        if (compatibilityIssues.length > 0) {
            return result(document, [], compatibilityIssues);
        }

        const property = this.#propertyByCode.get(document.propertyCode);
        if (property === undefined) {
            return result(document, [], [issue(
                'property-unavailable',
                `Blueprint property ${JSON.stringify(document.propertyCode)} is unavailable`,
                [],
                null,
                []
            )]);
        }

        const resolvedPlacements: ResolvedBlueprintGridPlacement[] = [];
        const issues: BlueprintValidationIssue[] = [];
        for (const placement of document.placements) {
            const placementResult = this.#resolvePlacement(placement, property.gridById);
            if (placementResult.placement === null) issues.push(...placementResult.issues);
            else resolvedPlacements.push(placementResult.placement);
        }
        issues.push(...overlapIssues(resolvedPlacements));
        return result(document, resolvedPlacements, issues);
    }

    #compatibilityIssues(document: BlueprintDocument): BlueprintValidationIssue[] {
        const issues: BlueprintValidationIssue[] = [];
        if (document.gameVersion !== this.#gameVersion) {
            issues.push(issue(
                'game-version-mismatch',
                `Blueprint game version ${JSON.stringify(document.gameVersion)} does not match ` +
                    `${JSON.stringify(this.#gameVersion)}`,
                [],
                null,
                []
            ));
        }
        if (document.datasetSha256 !== this.#datasetSha256) {
            issues.push(issue(
                'dataset-mismatch',
                'Blueprint dataset identity does not match the loaded dataset',
                [],
                null,
                []
            ));
        }
        return issues;
    }

    #resolvePlacement(
        placement: BlueprintGridPlacement,
        gridById: ReadonlyMap<string, IndexedGrid>
    ):
        | { readonly placement: ResolvedBlueprintGridPlacement; readonly issues: readonly [] }
        | { readonly placement: null; readonly issues: readonly BlueprintValidationIssue[] } {
        const buildable = this.#buildableByItemId.get(placement.itemId);
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
            const placementIssues = [issue(
                'tile-outside-grid',
                `Placement ${JSON.stringify(placement.id)} extends outside grid ` +
                    JSON.stringify(placement.gridId),
                [placement.id],
                placement.gridId,
                sortedCoordinates(outside)
            )];
            if (unavailable.length > 0) {
                placementIssues.push(issue(
                    'tile-unavailable',
                    `Placement ${JSON.stringify(placement.id)} uses unavailable tiles in grid ` +
                        JSON.stringify(placement.gridId),
                    [placement.id],
                    placement.gridId,
                    sortedCoordinates(unavailable)
                ));
            }
            return { placement: null, issues: placementIssues };
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
        return {
            placement: {
                id: placement.id,
                itemId: placement.itemId,
                gridId: placement.gridId,
                rotation: placement.rotation,
                occupiedTiles: occupiedTiles.sort(compareCoordinates),
            },
            issues: [],
        };
    }
}

function validateDocument(document: BlueprintDocument): BlueprintDocument {
    requireNonBlank(document.gameVersion, 'Blueprint game version');
    requireSha256(document.datasetSha256, 'Blueprint dataset identity');
    requireNonBlank(document.propertyCode, 'Blueprint property code');
    const placementIds = new Set<string>();
    const placements = document.placements.map((placement, index) => {
        requireNonBlank(placement.id, `Blueprint placement ID at index ${index}`);
        requireNonBlank(placement.itemId, `Blueprint placement item ID at index ${index}`);
        requireNonBlank(placement.gridId, `Blueprint placement grid ID at index ${index}`);
        requireSafeInteger(placement.anchor.x, `Blueprint placement anchor X at index ${index}`);
        requireSafeInteger(placement.anchor.y, `Blueprint placement anchor Y at index ${index}`);
        if (placementIds.has(placement.id)) {
            throw new TypeError(`Blueprint contains duplicate placement ID ${JSON.stringify(placement.id)}`);
        }
        placementIds.add(placement.id);
        return {
            id: placement.id,
            kind: placement.kind,
            itemId: placement.itemId,
            gridId: placement.gridId,
            anchor: { x: placement.anchor.x, y: placement.anchor.y },
            rotation: placement.rotation,
        };
    });
    return {
        schema: document.schema,
        gameVersion: document.gameVersion,
        datasetSha256: document.datasetSha256,
        propertyCode: document.propertyCode,
        placements,
    };
}

function indexPropertyGrids(layout: PropertyLayout): ReadonlyMap<string, IndexedGrid> {
    return indexUnique(
        layout.grids.map((grid) => ({ grid, tileByCoordinate: indexGridTiles(grid) })),
        ({ grid }) => grid.id,
        `grid ID in property ${JSON.stringify(layout.propertyCode)}`
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

function validatedFootprint(buildable: Buildable): readonly Buildable['placement']['footprintTiles'][number][] {
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
        requireFinite(
            tile.requiredOffset,
            `Buildable ${JSON.stringify(buildable.itemId)} footprint required offset`
        );
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

function rotateFootprint(
    footprint: readonly Buildable['placement']['footprintTiles'][number][],
    rotation: BlueprintGridRotation
): readonly { readonly x: number; readonly y: number; readonly requiredOffset: number }[] {
    const maximumX = Math.max(...footprint.map((tile) => tile.x));
    const maximumY = Math.max(...footprint.map((tile) => tile.y));
    return footprint.map((tile) => {
        if (rotation === 0) return tile;
        if (rotation === 90) {
            return { x: maximumY - tile.y, y: tile.x, requiredOffset: tile.requiredOffset };
        }
        if (rotation === 180) {
            return {
                x: maximumX - tile.x,
                y: maximumY - tile.y,
                requiredOffset: tile.requiredOffset,
            };
        }
        return { x: tile.y, y: maximumX - tile.x, requiredOffset: tile.requiredOffset };
    });
}

function overlapIssues(
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
    const overlaps: BlueprintValidationIssue[] = [];
    for (const entry of occupantsByTile.values()) {
        if (entry.occupants.length < 2) continue;
        const placementIds = entry.occupants.map((placement) => placement.id).sort();
        overlaps.push(issue(
            'tile-overlap',
            `Placements ${placementIds.map((id) => JSON.stringify(id)).join(', ')} overlap`,
            placementIds,
            entry.gridId,
            [entry.tile]
        ));
    }
    return overlaps.sort((left, right) =>
        (left.gridId ?? '').localeCompare(right.gridId ?? '') ||
        compareCoordinates(left.tiles[0]!, right.tiles[0]!)
    );
}

function result(
    document: BlueprintDocument,
    resolvedPlacements: readonly ResolvedBlueprintGridPlacement[],
    issues: readonly BlueprintValidationIssue[]
): BlueprintValidationResult {
    return { document, valid: issues.length === 0, resolvedPlacements, issues };
}

function failedPlacement(
    code: BlueprintValidationIssueCode,
    message: string,
    placement: BlueprintGridPlacement,
    tiles: readonly BlueprintGridCoordinate[] = []
): { readonly placement: null; readonly issues: readonly BlueprintValidationIssue[] } {
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
        requireNonBlank(key, label);
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

function requireNonBlank(value: string, label: string): void {
    if (value.trim().length === 0) throw new TypeError(`${label} must not be blank`);
}

function requireSha256(value: string, label: string): void {
    if (!sha256Pattern.test(value)) throw new TypeError(`${label} must be a lowercase SHA-256`);
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
