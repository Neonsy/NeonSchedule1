import {
    BlueprintDocumentSchema,
    type BlueprintDocument,
    type BlueprintGridCoordinate,
    type BlueprintGridRotation,
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
    | 'surface-face-unsupported';

export interface BlueprintValidationIssue {
    readonly code: BlueprintValidationIssueCode;
    readonly message: string;
    readonly placementIds: readonly string[];
    readonly gridId: string | null;
    readonly surfaceId?: string;
    readonly tiles: readonly BlueprintGridCoordinate[];
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

export type ResolvedBlueprintPlacement =
    | ResolvedBlueprintGridPlacement
    | ResolvedBlueprintSurfacePlacement;

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

        const resolvedPlacements: ResolvedBlueprintPlacement[] = [];
        const issues: BlueprintValidationIssue[] = [];
        for (const placement of document.placements) {
            const placementResult = placement.kind === 'grid'
                ? resolveGridPlacement(placement, this.#buildableByItemId, property.gridById)
                : resolveSurfacePlacement(
                    placement,
                    this.#buildableByItemId,
                    property.surfaceById,
                    property.surfaceMeshById,
                    property.convexSurfaceHullByMeshId
                );
            if (placementResult.placement === null) issues.push(...placementResult.issues);
            else resolvedPlacements.push(placementResult.placement);
        }
        const gridPlacements = resolvedPlacements.filter(
            (placement): placement is ResolvedBlueprintGridPlacement => placement.kind === 'grid'
        );
        issues.push(...tileSharingIssues(gridPlacements));
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
    return { ...document, placements };
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
