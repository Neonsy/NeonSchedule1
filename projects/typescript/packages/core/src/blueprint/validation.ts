import {
    BlueprintDocumentSchema,
    type BlueprintDocument,
    type BlueprintGridCoordinate,
    type BlueprintGridRotation,
    type BlueprintPlacement,
    type BlueprintProceduralTileReference,
} from '#core/data/blueprint';
import { BuildableSchema, type Buildable } from '#core/data/buildable';
import { PropertyLayoutSchema, type PropertyLayout } from '#core/data/property-layout';
import {
    indexPropertyGrids,
    resolveGridPlacement,
    tileSharingIssues,
    type IndexedGrid,
} from '#core/blueprint/grid-validation';
import {
    indexConvexSurfaceHulls,
    indexPropertySurfaces,
    indexSurfaceMeshes,
    resolveSurfacePlacement,
    type ResolvedBlueprintSurfacePlacement,
} from '#core/blueprint/surface-validation';
import {
    indexProceduralTiles,
    proceduralTileSharingIssues,
    resolveProceduralGridPlacement,
    type ProceduralPlacementFrame,
} from '#core/blueprint/procedural-grid-validation';

export type { ResolvedBlueprintSurfacePlacement } from '#core/blueprint/surface-validation';

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
    | 'tile-offset-incompatible'
    | 'tile-sharing-unsupported'
    | 'tile-sharing-incompatible'
    | 'surface-unavailable'
    | 'surface-type-incompatible'
    | 'surface-collider-unavailable'
    | 'surface-geometry-unsupported'
    | 'surface-point-outside-collider'
    | 'surface-face-incompatible'
    | 'surface-face-unsupported'
    | 'procedural-parent-unavailable'
    | 'procedural-parent-cycle'
    | 'procedural-tile-unavailable'
    | 'procedural-tile-type-incompatible'
    | 'procedural-footprint-incompatible'
    | 'procedural-tile-sharing-incompatible';

export interface BlueprintValidationIssue {
    readonly code: BlueprintValidationIssueCode;
    readonly message: string;
    readonly placementIds: readonly string[];
    readonly gridId: string | null;
    readonly surfaceId?: string;
    readonly tiles: readonly BlueprintGridCoordinate[];
    readonly proceduralTileIds?: readonly string[];
}

export interface ResolvedBlueprintGridTile extends BlueprintGridCoordinate {
    readonly requiredOffset: number;
    readonly availableOffset: number;
}

export interface ResolvedBlueprintCornerObstacle {
    readonly sourceTile: BlueprintGridCoordinate;
    readonly neighbouringTiles: readonly BlueprintGridCoordinate[];
}

export interface ResolvedBlueprintGridPlacement {
    readonly id: string;
    readonly kind: 'grid';
    readonly itemId: string;
    readonly gridId: string;
    readonly rotation: BlueprintGridRotation;
    readonly tileSharingRule: 'standard' | 'floor-rack';
    readonly occupiedTiles: readonly ResolvedBlueprintGridTile[];
    readonly cornerObstacles: readonly ResolvedBlueprintCornerObstacle[];
}

export interface ResolvedBlueprintProceduralGridPlacement {
    readonly id: string;
    readonly kind: 'procedural-grid';
    readonly itemId: string;
    readonly parentPlacementId: string | null;
    readonly tileType: string;
    readonly tiles: readonly BlueprintProceduralTileReference[];
    readonly frame: ProceduralPlacementFrame;
}

export type ResolvedBlueprintPlacement =
    | ResolvedBlueprintGridPlacement
    | ResolvedBlueprintSurfacePlacement
    | ResolvedBlueprintProceduralGridPlacement;

export interface BlueprintValidationResult {
    readonly document: BlueprintDocument;
    readonly valid: boolean;
    readonly resolvedPlacements: readonly ResolvedBlueprintPlacement[];
    readonly issues: readonly BlueprintValidationIssue[];
}

interface IndexedProperty {
    readonly layout: PropertyLayout;
    readonly gridById: ReadonlyMap<string, IndexedGrid>;
    readonly surfaceById: ReturnType<typeof indexPropertySurfaces>;
    readonly surfaceMeshById: ReturnType<typeof indexSurfaceMeshes>;
    readonly convexSurfaceHullByMeshId: ReturnType<typeof indexConvexSurfaceHulls>;
    readonly proceduralTileById: ReturnType<typeof indexProceduralTiles>;
}

const sha256Pattern = /^[a-f0-9]{64}$/u;
const quaternionLengthTolerance = 1e-4;

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
                const surfaceMeshById = indexSurfaceMeshes(layout);
                return {
                    layout,
                    gridById: indexPropertyGrids(layout),
                    surfaceById: indexPropertySurfaces(layout),
                    surfaceMeshById,
                    convexSurfaceHullByMeshId: indexConvexSurfaceHulls(
                        layout,
                        surfaceMeshById
                    ),
                    proceduralTileById: indexProceduralTiles(
                        layout.proceduralTiles,
                        `Property ${JSON.stringify(layout.propertyCode)}`
                    ),
                };
            }),
            ({ layout }) => layout.propertyCode,
            'property layout code'
        );
    }

    validate(input: BlueprintDocument): BlueprintValidationResult {
        const document = validateDocument(BlueprintDocumentSchema.assert(input));
        const compatibilityIssues = this.#compatibilityIssues(document);
        if (compatibilityIssues.length > 0) return result(document, [], compatibilityIssues);

        const property = this.#propertyByCode.get(document.propertyCode);
        if (property === undefined) {
            return result(document, [], [issue(
                'property-unavailable',
                `Blueprint property ${JSON.stringify(document.propertyCode)} is unavailable`
            )]);
        }

        const placementById = new Map(document.placements.map((placement) => [placement.id, placement]));
        const cycleIds = proceduralParentCycleIds(document.placements, placementById);
        const resolutionById = new Map<string, {
            readonly placement: ResolvedBlueprintPlacement | null;
            readonly issues: readonly BlueprintValidationIssue[];
        }>();
        const resolve = (placement: BlueprintPlacement): void => {
            if (resolutionById.has(placement.id)) return;
            if (placement.kind === 'grid') {
                resolutionById.set(
                    placement.id,
                    resolveGridPlacement(placement, this.#buildableByItemId, property.gridById)
                );
                return;
            }
            if (placement.kind === 'surface') {
                resolutionById.set(placement.id, resolveSurfacePlacement(
                    placement,
                    this.#buildableByItemId,
                    property.surfaceById,
                    property.surfaceMeshById,
                    property.convexSurfaceHullByMeshId
                ));
                return;
            }
            if (cycleIds.has(placement.id)) {
                resolutionById.set(placement.id, {
                    placement: null,
                    issues: [proceduralIssue(
                        'procedural-parent-cycle',
                        `Placement ${JSON.stringify(placement.id)} belongs to a procedural parent cycle`,
                        placement.id
                    )],
                });
                return;
            }
            let tileById = property.proceduralTileById;
            let frameSpace: 'world' | 'parent' = 'world';
            if (placement.parentPlacementId !== null) {
                const parent = placementById.get(placement.parentPlacementId);
                if (parent === undefined) {
                    resolutionById.set(placement.id, {
                        placement: null,
                        issues: [proceduralIssue(
                            'procedural-parent-unavailable',
                            `Placement ${JSON.stringify(placement.id)} references unavailable parent ` +
                                JSON.stringify(placement.parentPlacementId),
                            placement.id
                        )],
                    });
                    return;
                }
                resolve(parent);
                const resolvedParent = resolutionById.get(parent.id)?.placement;
                if (resolvedParent === null || resolvedParent === undefined) {
                    resolutionById.set(placement.id, {
                        placement: null,
                        issues: [proceduralIssue(
                            'procedural-parent-unavailable',
                            `Placement ${JSON.stringify(placement.id)} depends on unresolved parent ` +
                                JSON.stringify(parent.id),
                            placement.id
                        )],
                    });
                    return;
                }
                const parentBuildable = this.#buildableByItemId.get(parent.itemId)!;
                tileById = indexProceduralTiles(
                    parentBuildable.proceduralTiles,
                    `Buildable ${JSON.stringify(parentBuildable.itemId)}`
                );
                frameSpace = 'parent';
            }
            resolutionById.set(placement.id, resolveProceduralGridPlacement(
                placement,
                this.#buildableByItemId,
                tileById,
                frameSpace
            ));
        };
        for (const placement of document.placements) resolve(placement);
        const resolvedPlacements = document.placements.flatMap((placement) => {
            const resolved = resolutionById.get(placement.id)!.placement;
            return resolved === null ? [] : [resolved];
        });
        const issues = document.placements.flatMap(
            (placement) => resolutionById.get(placement.id)!.issues
        );
        const gridPlacements = resolvedPlacements.filter(
            (placement): placement is ResolvedBlueprintGridPlacement => placement.kind === 'grid'
        );
        issues.push(...tileSharingIssues(gridPlacements));
        const proceduralPlacements = resolvedPlacements.filter(
            (placement): placement is ResolvedBlueprintProceduralGridPlacement =>
                placement.kind === 'procedural-grid'
        );
        issues.push(...proceduralTileSharingIssues(proceduralPlacements));
        return result(document, resolvedPlacements, issues);
    }

    #compatibilityIssues(document: BlueprintDocument): BlueprintValidationIssue[] {
        const issues: BlueprintValidationIssue[] = [];
        if (document.gameVersion !== this.#gameVersion) {
            issues.push(issue(
                'game-version-mismatch',
                `Blueprint game version ${JSON.stringify(document.gameVersion)} does not match ` +
                    JSON.stringify(this.#gameVersion)
            ));
        }
        if (document.datasetSha256 !== this.#datasetSha256) {
            issues.push(issue(
                'dataset-mismatch',
                'Blueprint dataset identity does not match the loaded dataset'
            ));
        }
        return issues;
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
        if (placementIds.has(placement.id)) {
            throw new TypeError(`Blueprint contains duplicate placement ID ${JSON.stringify(placement.id)}`);
        }
        placementIds.add(placement.id);
        if (placement.kind === 'grid') {
            requireNonBlank(placement.gridId, `Blueprint placement grid ID at index ${index}`);
            requireSafeInteger(placement.anchor.x, `Blueprint placement anchor X at index ${index}`);
            requireSafeInteger(placement.anchor.y, `Blueprint placement anchor Y at index ${index}`);
            return {
                ...placement,
                anchor: { x: placement.anchor.x, y: placement.anchor.y },
            };
        }
        if (placement.kind === 'procedural-grid') {
            if (placement.parentPlacementId !== null) {
                requireNonBlank(
                    placement.parentPlacementId,
                    `Blueprint placement parent ID at index ${index}`
                );
            }
            const coordinates = new Set<string>();
            const tileIds = new Set<string>();
            const tiles = placement.tiles.map((tile, tileIndex) => {
                requireSafeInteger(
                    tile.x,
                    `Blueprint procedural tile X at placement ${index}, tile ${tileIndex}`
                );
                requireSafeInteger(
                    tile.y,
                    `Blueprint procedural tile Y at placement ${index}, tile ${tileIndex}`
                );
                requireNonBlank(
                    tile.tileId,
                    `Blueprint procedural tile ID at placement ${index}, tile ${tileIndex}`
                );
                const coordinate = `${tile.x},${tile.y}`;
                if (coordinates.has(coordinate)) {
                    throw new TypeError(
                        `Blueprint placement ${JSON.stringify(placement.id)} maps duplicate ` +
                            `footprint coordinate ${JSON.stringify(coordinate)}`
                    );
                }
                if (tileIds.has(tile.tileId)) {
                    throw new TypeError(
                        `Blueprint placement ${JSON.stringify(placement.id)} maps duplicate ` +
                            `procedural tile ${JSON.stringify(tile.tileId)}`
                    );
                }
                coordinates.add(coordinate);
                tileIds.add(tile.tileId);
                return { x: tile.x, y: tile.y, tileId: tile.tileId };
            });
            return { ...placement, tiles };
        }
        requireNonBlank(placement.surfaceId, `Blueprint placement surface ID at index ${index}`);
        requireNonBlank(
            placement.surfaceColliderPath,
            `Blueprint placement surface collider path at index ${index}`
        );
        requireFiniteVector(
            placement.relativeHitPoint,
            `Blueprint placement relative hit point at index ${index}`
        );
        requireFiniteVector(placement.relativePosition, `Blueprint placement position at index ${index}`);
        requireFiniteQuaternion(placement.relativeRotation, index);
        return {
            ...placement,
            relativeHitPoint: { ...placement.relativeHitPoint },
            relativePosition: { ...placement.relativePosition },
            relativeRotation: { ...placement.relativeRotation },
        };
    });
    const employeeIds = new Set<string>();
    const employees = document.productionLogistics.employees.map((employee, employeeIndex) => {
        requireNonBlank(employee.id, `Blueprint employee ID at index ${employeeIndex}`);
        if (employeeIds.has(employee.id)) {
            throw new TypeError(
                `Blueprint contains duplicate employee ID ${JSON.stringify(employee.id)}`
            );
        }
        employeeIds.add(employee.id);
        const assignedPlacementIds = uniqueNonBlankStrings(
            employee.employeeType === 'Botanist'
                ? employee.assignedPotPlacementIds
                : employee.employeeType === 'Cleaner'
                    ? employee.assignedBinPlacementIds
                : employee.assignedStationPlacementIds,
            `Blueprint employee ${JSON.stringify(employee.id)} assigned placement ID`
        );
        if (employee.employeeType === 'Botanist' && employee.supplyPlacementId !== null) {
            requireNonBlank(
                employee.supplyPlacementId,
                `Blueprint employee ${JSON.stringify(employee.id)} supply placement ID`
            );
        }
        if (employee.employeeType !== 'Handler') {
            if (employee.employeeType === 'Botanist') {
                return { ...employee, assignedPotPlacementIds: assignedPlacementIds };
            }
            if (employee.employeeType === 'Cleaner') {
                return { ...employee, assignedBinPlacementIds: assignedPlacementIds };
            }
            return { ...employee, assignedStationPlacementIds: assignedPlacementIds };
        }
        const routeIds = new Set<string>();
        const handlerRoutes = employee.handlerRoutes.map((route, routeIndex) => {
            requireNonBlank(
                route.id,
                `Blueprint employee ${JSON.stringify(employee.id)} route ID at index ${routeIndex}`
            );
            if (routeIds.has(route.id)) {
                throw new TypeError(
                    `Blueprint employee ${JSON.stringify(employee.id)} contains duplicate route ID ` +
                        JSON.stringify(route.id)
                );
            }
            routeIds.add(route.id);
            requireNonBlank(
                route.sourcePlacementId,
                `Blueprint route ${JSON.stringify(route.id)} source placement ID`
            );
            requireNonBlank(
                route.destinationPlacementId,
                `Blueprint route ${JSON.stringify(route.id)} destination placement ID`
            );
            return {
                ...route,
                filter: {
                    ...route.filter,
                    itemIds: uniqueNonBlankStrings(
                        route.filter.itemIds,
                        `Blueprint route ${JSON.stringify(route.id)} filter item ID`
                    ),
                },
            };
        });
        return {
            ...employee,
            assignedStationPlacementIds: assignedPlacementIds,
            handlerRoutes,
        };
    });
    const supplyIds = new Set<string>();
    const supplies = document.productionLogistics.supplies.map((supply, supplyIndex) => {
        requireNonBlank(supply.id, `Blueprint supply ID at index ${supplyIndex}`);
        if (supplyIds.has(supply.id)) {
            throw new TypeError(
                `Blueprint contains duplicate supply ID ${JSON.stringify(supply.id)}`
            );
        }
        supplyIds.add(supply.id);
        requireNonBlank(supply.itemId, `Blueprint supply item ID at index ${supplyIndex}`);
        requireNonBlank(
            supply.sourcePlacementId,
            `Blueprint supply source placement ID at index ${supplyIndex}`
        );
        requireSafeInteger(supply.quantity, `Blueprint supply quantity at index ${supplyIndex}`);
        if (supply.quantity <= 0) {
            throw new RangeError(`Blueprint supply quantity at index ${supplyIndex} must be positive`);
        }
        return { ...supply };
    });
    return {
        ...document,
        placements,
        productionLogistics: { employees, supplies },
    };
}

function uniqueNonBlankStrings(values: readonly string[], label: string): string[] {
    const seen = new Set<string>();
    return values.map((value, index) => {
        requireNonBlank(value, `${label} at index ${index}`);
        if (seen.has(value)) {
            throw new TypeError(`${label} ${JSON.stringify(value)} is duplicated`);
        }
        seen.add(value);
        return value;
    });
}

function requireFiniteQuaternion(
    quaternion: { readonly x: number; readonly y: number; readonly z: number; readonly w: number },
    index: number
): void {
    const values = [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
    if (!values.every(Number.isFinite)) {
        throw new RangeError(`Blueprint placement rotation at index ${index} must be finite`);
    }
    const length = Math.hypot(...values);
    if (Math.abs(length - 1) > quaternionLengthTolerance) {
        throw new RangeError(`Blueprint placement rotation at index ${index} must be normalized`);
    }
}

function requireFiniteVector(
    vector: { readonly x: number; readonly y: number; readonly z: number },
    label: string
): void {
    if (![vector.x, vector.y, vector.z].every(Number.isFinite)) {
        throw new RangeError(`${label} must be finite`);
    }
}

function result(
    document: BlueprintDocument,
    resolvedPlacements: readonly ResolvedBlueprintPlacement[],
    issues: readonly BlueprintValidationIssue[]
): BlueprintValidationResult {
    return { document, valid: issues.length === 0, resolvedPlacements, issues };
}

function issue(code: BlueprintValidationIssueCode, message: string): BlueprintValidationIssue {
    return { code, message, placementIds: [], gridId: null, tiles: [] };
}

function proceduralIssue(
    code: BlueprintValidationIssueCode,
    message: string,
    placementId: string
): BlueprintValidationIssue {
    return { code, message, placementIds: [placementId], gridId: null, tiles: [] };
}

function proceduralParentCycleIds(
    placements: readonly BlueprintPlacement[],
    placementById: ReadonlyMap<string, BlueprintPlacement>
): ReadonlySet<string> {
    const state = new Map<string, 'visiting' | 'complete'>();
    const stack: string[] = [];
    const cycles = new Set<string>();
    const visit = (placement: BlueprintPlacement): void => {
        if (state.get(placement.id) === 'complete') return;
        const existing = stack.indexOf(placement.id);
        if (existing >= 0) {
            for (const id of stack.slice(existing)) cycles.add(id);
            return;
        }
        state.set(placement.id, 'visiting');
        stack.push(placement.id);
        if (placement.kind === 'procedural-grid' && placement.parentPlacementId !== null) {
            const parent = placementById.get(placement.parentPlacementId);
            if (parent !== undefined) visit(parent);
        }
        stack.pop();
        state.set(placement.id, 'complete');
    };
    for (const placement of placements) visit(placement);
    return cycles;
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

function requireNonBlank(value: string, label: string): void {
    if (value.trim().length === 0) throw new TypeError(`${label} must not be blank`);
}

function requireSha256(value: string, label: string): void {
    if (!sha256Pattern.test(value)) throw new TypeError(`${label} must be a lowercase SHA-256`);
}

function requireSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`);
}
