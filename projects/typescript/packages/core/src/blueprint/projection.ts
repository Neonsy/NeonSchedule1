import {
    type BlueprintDocument,
    type BlueprintGridCoordinate,
} from '#core/data/blueprint';
import { type Buildable, type InteractionPoint } from '#core/data/buildable';
import { type Vector3 } from '#core/data/common';
import {
    type Collider,
    type ColliderWorldBasis,
    type Transform,
} from '#core/data/geometry';
import { type PropertyGrid, type PropertyLayout } from '#core/data/property-layout';
import {
    BlueprintValidator,
    type BlueprintDataset,
    type BlueprintValidationResult,
    type ResolvedBlueprintGridPlacement,
} from '#core/blueprint/validation';

export interface Quaternion {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly w: number;
}

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

export interface ProjectedBlueprintPlacement {
    readonly id: string;
    readonly itemId: string;
    readonly gridId: string;
    readonly worldYaw: number;
    readonly root: BlueprintWorldTransform;
    readonly buildPoint: ProjectedBuildableTransform;
    readonly boundingCollider: ProjectedCollider;
    readonly colliders: readonly ProjectedCollider[];
    readonly interactionPoints: readonly ProjectedInteractionPoint[];
}

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

interface ProjectionContext {
    readonly buildable: Buildable;
    readonly grid: PropertyGrid;
    readonly placement: ResolvedBlueprintGridPlacement;
}

interface PlacementFrame {
    readonly rootPosition: Vector3;
    readonly worldYaw: number;
}

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

        return {
            kind: 'projected',
            validation,
            placements: contexts.map(projectPlacement),
            issues: [],
        };
    }

    #context(
        property: PropertyLayout,
        placement: ResolvedBlueprintGridPlacement
    ): ProjectionContext {
        const buildable = this.#buildableByItemId.get(placement.itemId);
        const grid = property.grids.find((candidate) => candidate.id === placement.gridId);
        if (buildable === undefined || grid === undefined) {
            throw new Error('Validated blueprint references unavailable projection data');
        }
        return { buildable, grid, placement };
    }
}

function projectionIssues(context: ProjectionContext): BlueprintProjectionIssue[] {
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

function projectPlacement(context: ProjectionContext): ProjectedBlueprintPlacement {
    const frame = placementFrame(context);
    const { buildable, placement } = context;
    return {
        id: placement.id,
        itemId: placement.itemId,
        gridId: placement.gridId,
        worldYaw: frame.worldYaw,
        root: {
            worldPosition: frame.rootPosition,
            worldRotation: yawQuaternion(frame.worldYaw),
        },
        buildPoint: projectTransform(buildable.placement.buildPoint, frame),
        boundingCollider: projectCollider(buildable.placement.boundingCollider, frame),
        colliders: buildable.colliders.map((collider) => projectCollider(collider, frame)),
        interactionPoints: buildable.interactionPoints.map((point) => ({
            ...point,
            transform: projectTransform(point.transform, frame),
        })),
    };
}

function placementFrame(context: ProjectionContext): PlacementFrame {
    const destinationTiles = resolveDestinationTiles(context.grid, context.placement);
    const destinationCenter = average(destinationTiles.map((tile) => tile.worldPosition));
    const sourceCenter = average(
        context.buildable.placement.footprintTiles.map((tile) => tile.transform.worldPosition)
    );
    const gridYaw = destinationTiles[0]?.worldRotation.y ?? 0;
    const worldYaw = normalizeDegrees(gridYaw + context.placement.rotation);
    const rotatedSourceCenter = rotateAroundY(sourceCenter, worldYaw);
    return {
        rootPosition: subtract(destinationCenter, rotatedSourceCenter),
        worldYaw,
    };
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
            right: rotateAroundY(sourceBasis.right, frame.worldYaw),
            up: rotateAroundY(sourceBasis.up, frame.worldYaw),
            forward: rotateAroundY(sourceBasis.forward, frame.worldYaw),
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
            rotateAroundY(transform.worldPosition, frame.worldYaw)
        ),
        worldRotation: multiplyQuaternions(
            yawQuaternion(frame.worldYaw),
            unityEulerQuaternion(transform.worldRotation)
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

function unityEulerQuaternion(rotation: Vector3): Quaternion {
    const x = axisQuaternion('x', rotation.x);
    const y = axisQuaternion('y', rotation.y);
    const z = axisQuaternion('z', rotation.z);
    return multiplyQuaternions(multiplyQuaternions(y, x), z);
}

function yawQuaternion(yaw: number): Quaternion {
    return axisQuaternion('y', yaw);
}

function axisQuaternion(axis: 'x' | 'y' | 'z', degrees: number): Quaternion {
    const halfRadians = degrees * Math.PI / 360;
    const sine = Math.sin(halfRadians);
    const cosine = Math.cos(halfRadians);
    return canonicalQuaternion({
        x: axis === 'x' ? sine : 0,
        y: axis === 'y' ? sine : 0,
        z: axis === 'z' ? sine : 0,
        w: cosine,
    });
}

function multiplyQuaternions(left: Quaternion, right: Quaternion): Quaternion {
    return canonicalQuaternion({
        x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
        y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
        z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
        w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
    });
}

function canonicalQuaternion(input: Quaternion): Quaternion {
    const length = Math.hypot(input.x, input.y, input.z, input.w);
    if (length === 0) throw new Error('Cannot normalize a zero-length quaternion');
    const sign = input.w < 0 ? -1 : 1;
    return {
        x: normalizeZero(sign * input.x / length),
        y: normalizeZero(sign * input.y / length),
        z: normalizeZero(sign * input.z / length),
        w: normalizeZero(sign * input.w / length),
    };
}

function normalizeZero(value: number): number {
    return Math.abs(value) <= Number.EPSILON ? 0 : value;
}

function rotateAroundY(vector: Vector3, degrees: number): Vector3 {
    const radians = degrees * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    return {
        x: normalizeZero(cosine * vector.x + sine * vector.z),
        y: normalizeZero(vector.y),
        z: normalizeZero(-sine * vector.x + cosine * vector.z),
    };
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
