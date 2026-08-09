import { type BlueprintDocument, type BlueprintGridCoordinate } from '#core/data/blueprint';
import {
    type Buildable,
    type InteractionPoint,
    type TemperatureEmitter,
} from '#core/data/buildable';
import { type Vector3 } from '#core/data/common';
import {
    type Collider,
    type ColliderWorldBasis,
    type Quaternion,
    type Transform,
} from '#core/data/geometry';
import {
    type PropertyGrid,
    type PropertyLayout,
    type PropertySurface,
} from '#core/data/property-layout';
import {
    axisQuaternion,
    multiplyQuaternions,
    quaternionFromUnityEuler,
    rotateVectorByQuaternion,
    transformPoint,
} from '#core/geometry/transform';
import {
    BlueprintValidator,
    type BlueprintDataset,
    type BlueprintValidationResult,
    type ResolvedBlueprintGridPlacement,
    type ResolvedBlueprintPlacement,
    type ResolvedBlueprintProceduralGridPlacement,
    type ResolvedBlueprintSurfacePlacement,
} from '#core/blueprint/validation';

export interface BlueprintWorldTransform {
    readonly worldPosition: Vector3;
    readonly worldRotation: Quaternion;
}

export interface ProjectedBuildableTransform extends BlueprintWorldTransform {
    readonly name: string;
    readonly path: string;
    readonly localScale: Vector3;
}

export type ProjectedCollider = Omit<Collider, 'transform' | 'worldBasis' | 'worldBounds'> & {
    readonly transform: ProjectedBuildableTransform;
    readonly worldBasis: ColliderWorldBasis;
};

export type ProjectedInteractionPoint = Omit<InteractionPoint, 'transform'> & {
    readonly transform: ProjectedBuildableTransform;
};

export type ProjectedTemperatureEmitter = Omit<TemperatureEmitter, 'emissionPoint'> & {
    readonly worldPosition: Vector3;
};

interface ProjectedBlueprintPlacementBase {
    readonly id: string;
    readonly itemId: string;
    readonly root: BlueprintWorldTransform;
    readonly buildPoint: ProjectedBuildableTransform;
    readonly boundingCollider: ProjectedCollider;
    readonly colliders: readonly ProjectedCollider[];
    readonly temperatureEmitters: readonly ProjectedTemperatureEmitter[];
    readonly interactionPoints: readonly ProjectedInteractionPoint[];
    readonly isTransitEntity: boolean;
    readonly transitAccessPoints: readonly ProjectedBuildableTransform[];
}

export interface ProjectedBlueprintGridPlacement extends ProjectedBlueprintPlacementBase {
    readonly kind: 'grid';
    readonly gridId: string;
    readonly worldYaw: number;
}

export interface ProjectedBlueprintSurfacePlacement extends ProjectedBlueprintPlacementBase {
    readonly kind: 'surface';
    readonly surfaceId: string;
    readonly surfaceColliderPath: string;
    readonly worldHitPoint: Vector3;
}

export interface ProjectedBlueprintProceduralGridPlacement
    extends ProjectedBlueprintPlacementBase {
    readonly kind: 'procedural-grid';
    readonly parentPlacementId: string | null;
    readonly tileType: string;
    readonly tileIds: readonly string[];
}

export type ProjectedBlueprintPlacement =
    | ProjectedBlueprintGridPlacement
    | ProjectedBlueprintSurfacePlacement
    | ProjectedBlueprintProceduralGridPlacement;

export type BlueprintProjectionIssueCode =
    | 'elevation-offset-unsupported'
    | 'grid-tilt-unsupported'
    | 'grid-rotation-inconsistent';

export interface BlueprintProjectionIssue {
    readonly code: BlueprintProjectionIssueCode;
    readonly message: string;
    readonly placementId: string;
    readonly gridId: string;
    readonly tiles: readonly BlueprintGridCoordinate[];
}

export type BlueprintProjectionResult =
    | {
        readonly kind: 'projected';
        readonly validation: BlueprintValidationResult;
        readonly placements: readonly ProjectedBlueprintPlacement[];
        readonly issues: readonly [];
    }
    | {
        readonly kind: 'rejected';
        readonly validation: BlueprintValidationResult;
        readonly placements: readonly [];
        readonly issues: readonly BlueprintProjectionIssue[];
    };

interface GridProjectionContext {
    readonly kind: 'grid';
    readonly buildable: Buildable;
    readonly grid: PropertyGrid;
    readonly placement: ResolvedBlueprintGridPlacement;
}

interface SurfaceProjectionContext {
    readonly kind: 'surface';
    readonly buildable: Buildable;
    readonly surface: PropertySurface;
    readonly placement: ResolvedBlueprintSurfacePlacement;
}

interface ProceduralProjectionContext {
    readonly kind: 'procedural-grid';
    readonly buildable: Buildable;
    readonly placement: ResolvedBlueprintProceduralGridPlacement;
}

type ProjectionContext =
    | GridProjectionContext
    | SurfaceProjectionContext
    | ProceduralProjectionContext;

interface PlacementFrame {
    readonly rootPosition: Vector3;
    readonly rootRotation: Quaternion;
}

type ProjectedBuildable = Omit<
    ProjectedBlueprintPlacementBase,
    'id' | 'itemId'
>;

const offsetTolerance = 1e-6;
const rotationTolerance = 1e-3;

export class BlueprintProjector {
    readonly #validator: BlueprintValidator;
    readonly #buildableByItemId: ReadonlyMap<string, Buildable>;
    readonly #propertyByCode: ReadonlyMap<string, PropertyLayout>;

    constructor(dataset: BlueprintDataset) {
        this.#validator = new BlueprintValidator(dataset);
        this.#buildableByItemId = new Map(
            dataset.buildables.map((buildable) => [buildable.itemId, buildable])
        );
        this.#propertyByCode = new Map(
            dataset.propertyLayouts.map((property) => [property.propertyCode, property])
        );
    }

    project(input: BlueprintDocument): BlueprintProjectionResult {
        const validation = this.#validator.validate(input);
        if (!validation.valid) return rejected(validation, []);

        const property = this.#propertyByCode.get(validation.document.propertyCode);
        if (property === undefined) return rejected(validation, []);

        const contexts = validation.resolvedPlacements.map((placement) =>
            this.#context(property, placement)
        );
        const issues = contexts.flatMap((context) => projectionIssues(context));
        if (issues.length > 0) return rejected(validation, issues);

        const contextById = new Map(contexts.map((context) => [context.placement.id, context]));
        const projectedById = new Map<string, ProjectedBlueprintPlacement>();
        const project = (context: ProjectionContext): ProjectedBlueprintPlacement => {
            const existing = projectedById.get(context.placement.id);
            if (existing !== undefined) return existing;
            let parentRoot: BlueprintWorldTransform | undefined;
            if (
                context.kind === 'procedural-grid' &&
                context.placement.frame.space === 'parent'
            ) {
                const parentPlacementId = context.placement.parentPlacementId;
                const parent = parentPlacementId === null
                    ? undefined
                    : contextById.get(parentPlacementId);
                if (parent === undefined) {
                    throw new Error('Validated blueprint references unavailable projection data');
                }
                parentRoot = project(parent).root;
            }
            const projected = projectPlacement(context, placementFrame(context, parentRoot));
            projectedById.set(context.placement.id, projected);
            return projected;
        };
        return {
            kind: 'projected',
            validation,
            placements: contexts.map(project),
            issues: [],
        };
    }

    #context(property: PropertyLayout, placement: ResolvedBlueprintPlacement): ProjectionContext {
        const buildable = this.#buildableByItemId.get(placement.itemId);
        if (buildable === undefined) {
            throw new Error('Validated blueprint references unavailable projection data');
        }
        if (placement.kind === 'grid') {
            const grid = property.grids.find((candidate) => candidate.id === placement.gridId);
            if (grid === undefined) {
                throw new Error('Validated blueprint references unavailable projection data');
            }
            return { kind: 'grid', buildable, grid, placement };
        }
        if (placement.kind === 'procedural-grid') {
            return { kind: 'procedural-grid', buildable, placement };
        }
        const surface = property.surfaces.find((candidate) => candidate.id === placement.surfaceId);
        if (surface === undefined) {
            throw new Error('Validated blueprint references unavailable projection data');
        }
        return { kind: 'surface', buildable, surface, placement };
    }
}

function projectionIssues(context: ProjectionContext): BlueprintProjectionIssue[] {
    if (context.kind !== 'grid') return [];
    const { buildable, grid, placement } = context;
    const tiles = placement.occupiedTiles.map(({ x, y }) => ({ x, y }));
    if (placement.occupiedTiles.some((tile) =>
        Math.abs(tile.requiredOffset) > offsetTolerance ||
        Math.abs(tile.availableOffset) > offsetTolerance
    )) {
        return [projectionIssue(
            'elevation-offset-unsupported',
            `Placement ${JSON.stringify(placement.id)} uses grid elevation offsets whose world-space ` +
                'meaning is not present in this dataset',
            placement,
            tiles
        )];
    }

    const destinationTiles = resolveDestinationTiles(grid, placement);
    if (destinationTiles.some((tile) =>
        Math.abs(tile.worldRotation.x) > rotationTolerance ||
        Math.abs(tile.worldRotation.z) > rotationTolerance
    )) {
        return [projectionIssue(
            'grid-tilt-unsupported',
            `Placement ${JSON.stringify(placement.id)} occupies a tilted property grid`,
            placement,
            tiles
        )];
    }

    const firstYaw = destinationTiles[0]?.worldRotation.y ?? 0;
    if (destinationTiles.some((tile) =>
        angularDistance(tile.worldRotation.y, firstYaw) > rotationTolerance
    )) {
        return [projectionIssue(
            'grid-rotation-inconsistent',
            `Placement ${JSON.stringify(placement.id)} occupies tiles with inconsistent rotations`,
            placement,
            tiles
        )];
    }
    return [];
}

function projectPlacement(
    context: ProjectionContext,
    frame: PlacementFrame
): ProjectedBlueprintPlacement {
    const projected = projectBuildable(context.buildable, frame);
    if (context.kind === 'grid') {
        return {
            id: context.placement.id,
            kind: 'grid',
            itemId: context.placement.itemId,
            gridId: context.placement.gridId,
            worldYaw: gridWorldYaw(context),
            ...projected,
        };
    }
    if (context.kind === 'procedural-grid') {
        return {
            id: context.placement.id,
            kind: 'procedural-grid',
            itemId: context.placement.itemId,
            parentPlacementId: context.placement.parentPlacementId,
            tileType: context.placement.tileType,
            tileIds: context.placement.tiles.map((tile) => tile.tileId),
            ...projected,
        };
    }
    return {
        id: context.placement.id,
        kind: 'surface',
        itemId: context.placement.itemId,
        surfaceId: context.placement.surfaceId,
        surfaceColliderPath: context.placement.surfaceColliderPath,
        worldHitPoint: transformPoint(
            context.surface.transform,
            context.placement.relativeHitPoint
        ),
        ...projected,
    };
}

function projectBuildable(buildable: Buildable, frame: PlacementFrame): ProjectedBuildable {
    return {
        root: {
            worldPosition: frame.rootPosition,
            worldRotation: frame.rootRotation,
        },
        buildPoint: projectTransform(buildable.placement.buildPoint, frame),
        boundingCollider: projectCollider(buildable.placement.boundingCollider, frame),
        colliders: buildable.colliders.map((collider) => projectCollider(collider, frame)),
        temperatureEmitters: buildable.temperatureEmitters.map((emitter) =>
            projectTemperatureEmitter(emitter, frame)
        ),
        interactionPoints: buildable.interactionPoints.map((point) => ({
            ...point,
            transform: projectTransform(point.transform, frame),
        })),
        isTransitEntity: buildable.isTransitEntity,
        transitAccessPoints: buildable.transitAccessPoints.map((point) =>
            projectTransform(point, frame)
        ),
    };
}

function projectTemperatureEmitter(
    emitter: TemperatureEmitter,
    frame: PlacementFrame
): ProjectedTemperatureEmitter {
    if (!Number.isFinite(emitter.temperature)) {
        throw new RangeError('Temperature emitter temperature must be finite');
    }
    if (!Number.isFinite(emitter.range) || emitter.range < 0) {
        throw new RangeError('Temperature emitter range must be finite and non-negative');
    }
    return {
        temperature: emitter.temperature,
        range: emitter.range,
        worldPosition: add(
            frame.rootPosition,
            rotateVectorByQuaternion(frame.rootRotation, emitter.emissionPoint)
        ),
    };
}

function placementFrame(
    context: ProjectionContext,
    parentRoot?: BlueprintWorldTransform
): PlacementFrame {
    if (context.kind === 'procedural-grid') {
        const frame = context.placement.frame;
        if (frame.space === 'world') {
            return { rootPosition: frame.position, rootRotation: frame.rotation };
        }
        if (parentRoot === undefined) {
            throw new Error('Validated blueprint references unavailable projection data');
        }
        return {
            rootPosition: add(
                parentRoot.worldPosition,
                rotateVectorByQuaternion(parentRoot.worldRotation, frame.position)
            ),
            rootRotation: multiplyQuaternions(parentRoot.worldRotation, frame.rotation),
        };
    }
    if (context.kind === 'surface') {
        const surfaceRotation = quaternionFromUnityEuler(context.surface.transform.worldRotation);
        return {
            rootPosition: transformPoint(
                context.surface.transform,
                context.placement.relativePosition
            ),
            rootRotation: multiplyQuaternions(
                surfaceRotation,
                context.placement.relativeRotation
            ),
        };
    }
    const destinationTiles = resolveDestinationTiles(context.grid, context.placement);
    const destinationCenter = average(destinationTiles.map((tile) => tile.worldPosition));
    const sourceCenter = average(
        context.buildable.placement.footprintTiles.map((tile) => tile.transform.worldPosition)
    );
    const worldYaw = gridWorldYaw(context);
    const rootRotation = axisQuaternion('y', worldYaw);
    return {
        rootPosition: subtract(
            destinationCenter,
            rotateVectorByQuaternion(rootRotation, sourceCenter)
        ),
        rootRotation,
    };
}

function gridWorldYaw(context: GridProjectionContext): number {
    const destinationTiles = resolveDestinationTiles(context.grid, context.placement);
    return normalizeDegrees(
        (destinationTiles[0]?.worldRotation.y ?? 0) + context.placement.rotation
    );
}

function projectCollider(collider: Collider, frame: PlacementFrame): ProjectedCollider {
    const {
        transform: sourceTransform,
        worldBasis: sourceBasis,
        worldBounds: _worldBounds,
        ...definition
    } = collider;
    return {
        ...definition,
        transform: projectTransform(sourceTransform, frame),
        worldBasis: {
            right: rotateVectorByQuaternion(frame.rootRotation, sourceBasis.right),
            up: rotateVectorByQuaternion(frame.rootRotation, sourceBasis.up),
            forward: rotateVectorByQuaternion(frame.rootRotation, sourceBasis.forward),
        },
    };
}

function projectTransform(
    transform: Transform,
    frame: PlacementFrame
): ProjectedBuildableTransform {
    return {
        name: transform.name,
        path: transform.path,
        worldPosition: add(
            frame.rootPosition,
            rotateVectorByQuaternion(frame.rootRotation, transform.worldPosition)
        ),
        worldRotation: multiplyQuaternions(
            frame.rootRotation,
            quaternionFromUnityEuler(transform.worldRotation)
        ),
        localScale: transform.localScale,
    };
}

function resolveDestinationTiles(
    grid: PropertyGrid,
    placement: ResolvedBlueprintGridPlacement
): PropertyGrid['tiles'] {
    const tileByCoordinate = new Map(
        grid.tiles.map((tile) => [coordinateKey(tile), tile])
    );
    return placement.occupiedTiles.map((coordinate) => {
        const tile = tileByCoordinate.get(coordinateKey(coordinate));
        if (tile === undefined) {
            throw new Error('Validated blueprint references an unavailable property-grid tile');
        }
        return tile;
    });
}

function average(vectors: readonly Vector3[]): Vector3 {
    if (vectors.length === 0) throw new Error('Cannot average an empty vector collection');
    const total = vectors.reduce((sum, vector) => add(sum, vector), { x: 0, y: 0, z: 0 });
    return {
        x: total.x / vectors.length,
        y: total.y / vectors.length,
        z: total.z / vectors.length,
    };
}

function add(left: Vector3, right: Vector3): Vector3 {
    return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

function subtract(left: Vector3, right: Vector3): Vector3 {
    return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function normalizeDegrees(degrees: number): number {
    const normalized = degrees % 360;
    const positive = normalized < 0 ? normalized + 360 : normalized;
    return Math.abs(positive - 360) <= Number.EPSILON ? 0 : positive;
}

function angularDistance(left: number, right: number): number {
    const difference = Math.abs(normalizeDegrees(left) - normalizeDegrees(right));
    return Math.min(difference, 360 - difference);
}

function coordinateKey(coordinate: BlueprintGridCoordinate): string {
    return `${coordinate.x},${coordinate.y}`;
}

function projectionIssue(
    code: BlueprintProjectionIssueCode,
    message: string,
    placement: ResolvedBlueprintGridPlacement,
    tiles: readonly BlueprintGridCoordinate[]
): BlueprintProjectionIssue {
    return { code, message, placementId: placement.id, gridId: placement.gridId, tiles };
}

function rejected(
    validation: BlueprintValidationResult,
    issues: readonly BlueprintProjectionIssue[]
): BlueprintProjectionResult {
    return { kind: 'rejected', validation, placements: [], issues };
}
