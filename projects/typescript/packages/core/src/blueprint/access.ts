import { type BlueprintDocument } from '#core/data/blueprint';
import { type Collider, type ColliderShape } from '#core/data/geometry';
import { type Vector3 } from '#core/data/common';
import { type PropertyLayout } from '#core/data/property-layout';
import {
    BlueprintProjector,
    type BlueprintProjectionResult,
    type ProjectedBlueprintPlacement,
} from '#core/blueprint/projection';
import { type BlueprintDataset } from '#core/blueprint/validation';
import {
    distanceFromPointToWorldBox,
    worldBoxFromCollider,
    type WorldBox,
} from '#core/geometry/box-collision';

export type BlueprintAccessObstacle =
    | {
        readonly kind: 'placement';
        readonly placementId: string;
    }
    | {
        readonly kind: 'property-fixed';
        readonly index: number;
        readonly path: string;
        readonly shape: ColliderShape;
    };

export interface BlueprintAccessPointClearance {
    readonly placementId: string;
    readonly accessPointIndex: number;
    readonly path: string;
    readonly worldPosition: Vector3;
    readonly minimumClearance: number | null;
    readonly nearestObstacles: readonly BlueprintAccessObstacle[];
}

export type BlueprintAccessLimitation =
    | {
        readonly code: 'missing-transit-access-points';
        readonly placementId: string;
        readonly accessPointIndex: null;
        readonly obstacle: null;
    }
    | {
        readonly code: 'unsupported-obstacle-geometry';
        readonly placementId: string;
        readonly accessPointIndex: number;
        readonly obstacle: BlueprintAccessObstacle;
    };

export type BlueprintAccessResult =
    | {
        readonly kind: 'rejected';
        readonly projection: Extract<BlueprintProjectionResult, { readonly kind: 'rejected' }>;
        readonly proofStatus: 'not-applicable';
        readonly reachability: 'not-evaluated';
        readonly clearanceScope: 'not-applicable';
        readonly accessPoints: readonly [];
        readonly limitations: readonly [];
    }
    | {
        readonly kind: 'analyzed';
        readonly projection: Extract<BlueprintProjectionResult, { readonly kind: 'projected' }>;
        readonly proofStatus: 'exact' | 'incomplete';
        readonly reachability: 'not-evaluated';
        readonly clearanceScope: 'blueprint-placements-and-property-fixed-geometry';
        readonly accessPoints: readonly BlueprintAccessPointClearance[];
        readonly limitations: readonly BlueprintAccessLimitation[];
    };

interface SupportedObstacle {
    readonly reference: BlueprintAccessObstacle;
    readonly box: WorldBox;
}

interface UnsupportedObstacle {
    readonly reference: BlueprintAccessObstacle;
    readonly bounds: AxisAlignedBounds | null;
}

interface AxisAlignedBounds {
    readonly center: Vector3;
    readonly halfSize: Vector3;
}

const distanceTolerance = 1e-9;

export class BlueprintAccessAnalyzer {
    readonly #projector: BlueprintProjector;
    readonly #propertyByCode: ReadonlyMap<string, PropertyLayout>;

    constructor(dataset: BlueprintDataset) {
        this.#projector = new BlueprintProjector(dataset);
        this.#propertyByCode = new Map(
            dataset.propertyLayouts.map((property) => [property.propertyCode, property])
        );
    }

    analyze(input: BlueprintDocument): BlueprintAccessResult {
        const projection = this.#projector.project(input);
        if (projection.kind === 'rejected') {
            return {
                kind: 'rejected',
                projection,
                proofStatus: 'not-applicable',
                reachability: 'not-evaluated',
                clearanceScope: 'not-applicable',
                accessPoints: [],
                limitations: [],
            };
        }

        const property = this.#propertyByCode.get(projection.validation.document.propertyCode);
        if (property === undefined) {
            throw new Error('Projected blueprint references an unavailable property layout');
        }
        const analysis = analyzeAccess(property, projection.placements);
        return {
            kind: 'analyzed',
            projection,
            proofStatus: analysis.limitations.length === 0 ? 'exact' : 'incomplete',
            reachability: 'not-evaluated',
            clearanceScope: 'blueprint-placements-and-property-fixed-geometry',
            ...analysis,
        };
    }
}

function analyzeAccess(
    property: PropertyLayout,
    placements: readonly ProjectedBlueprintPlacement[]
): {
    readonly accessPoints: readonly BlueprintAccessPointClearance[];
    readonly limitations: readonly BlueprintAccessLimitation[];
} {
    const accessPoints: BlueprintAccessPointClearance[] = [];
    const limitations: BlueprintAccessLimitation[] = [];
    const placementObstacles = placements.map(placementObstacle);
    const fixedObstacles = property.fixedColliders
        .map((collider, index) => fixedObstacle(collider, index))
        .filter((obstacle) => obstacle !== null);

    for (const placement of placements) {
        if (placement.isTransitEntity && placement.transitAccessPoints.length === 0) {
            limitations.push({
                code: 'missing-transit-access-points',
                placementId: placement.id,
                accessPointIndex: null,
                obstacle: null,
            });
        }
        placement.transitAccessPoints.forEach((point, accessPointIndex) => {
            const supported: SupportedObstacle[] = [];
            const unsupported: UnsupportedObstacle[] = [];
            for (const obstacle of [...placementObstacles, ...fixedObstacles]) {
                if (obstacle.reference.kind === 'placement' &&
                    obstacle.reference.placementId === placement.id) continue;
                if ('box' in obstacle) supported.push(obstacle);
                else unsupported.push(obstacle);
            }
            const clearance = pointClearance(point.worldPosition, supported);
            for (const obstacle of unsupported) {
                if (couldAffectMinimum(point.worldPosition, obstacle.bounds, clearance.distance)) {
                    limitations.push({
                        code: 'unsupported-obstacle-geometry',
                        placementId: placement.id,
                        accessPointIndex,
                        obstacle: obstacle.reference,
                    });
                }
            }
            accessPoints.push({
                placementId: placement.id,
                accessPointIndex,
                path: point.path,
                worldPosition: point.worldPosition,
                minimumClearance: clearance.distance,
                nearestObstacles: clearance.nearest,
            });
        });
    }
    return {
        accessPoints: accessPoints.sort(compareAccessPoints),
        limitations: limitations.sort(compareLimitations),
    };
}

function placementObstacle(
    placement: ProjectedBlueprintPlacement
): SupportedObstacle | UnsupportedObstacle {
    const reference: BlueprintAccessObstacle = { kind: 'placement', placementId: placement.id };
    const box = tryWorldBox(placement.boundingCollider);
    return box === null ? { reference, bounds: null } : { reference, box };
}

function fixedObstacle(
    collider: Collider,
    index: number
): SupportedObstacle | UnsupportedObstacle | null {
    if (collider.isTrigger) return null;
    const reference: BlueprintAccessObstacle = {
        kind: 'property-fixed',
        index,
        path: collider.transform.path,
        shape: collider.shape,
    };
    const box = tryWorldBox(collider);
    return box === null
        ? { reference, bounds: colliderBounds(collider) }
        : { reference, box };
}

function pointClearance(
    point: Vector3,
    obstacles: readonly SupportedObstacle[]
): { readonly distance: number | null; readonly nearest: readonly BlueprintAccessObstacle[] } {
    let distance: number | null = null;
    let nearest: BlueprintAccessObstacle[] = [];
    for (const obstacle of obstacles) {
        const candidate = distanceFromPointToWorldBox(point, obstacle.box);
        if (distance === null || candidate < distance - distanceTolerance) {
            distance = candidate;
            nearest = [obstacle.reference];
        } else if (Math.abs(candidate - distance) <= distanceTolerance) {
            nearest.push(obstacle.reference);
        }
    }
    return { distance, nearest: nearest.sort(compareObstacles) };
}

function couldAffectMinimum(
    point: Vector3,
    bounds: AxisAlignedBounds | null,
    current: number | null
): boolean {
    if (bounds === null || current === null) return true;
    return distanceFromPointToBounds(point, bounds) <= current + distanceTolerance;
}

function colliderBounds(collider: Collider): AxisAlignedBounds {
    return {
        center: collider.worldBounds.center,
        halfSize: {
            x: Math.abs(collider.worldBounds.size.x) / 2,
            y: Math.abs(collider.worldBounds.size.y) / 2,
            z: Math.abs(collider.worldBounds.size.z) / 2,
        },
    };
}

function distanceFromPointToBounds(point: Vector3, bounds: AxisAlignedBounds): number {
    return Math.hypot(
        Math.max(Math.abs(point.x - bounds.center.x) - bounds.halfSize.x, 0),
        Math.max(Math.abs(point.y - bounds.center.y) - bounds.halfSize.y, 0),
        Math.max(Math.abs(point.z - bounds.center.z) - bounds.halfSize.z, 0)
    );
}

function tryWorldBox(
    collider: Parameters<typeof worldBoxFromCollider>[0]
): WorldBox | null {
    try {
        return worldBoxFromCollider(collider);
    } catch (error) {
        if (error instanceof TypeError || error instanceof RangeError) return null;
        throw error;
    }
}

function compareAccessPoints(
    left: BlueprintAccessPointClearance,
    right: BlueprintAccessPointClearance
): number {
    return left.placementId.localeCompare(right.placementId) ||
        left.accessPointIndex - right.accessPointIndex;
}

function compareLimitations(left: BlueprintAccessLimitation, right: BlueprintAccessLimitation): number {
    return left.placementId.localeCompare(right.placementId) ||
        (left.accessPointIndex ?? -1) - (right.accessPointIndex ?? -1) ||
        left.code.localeCompare(right.code) ||
        compareNullableObstacles(left.obstacle, right.obstacle);
}

function compareNullableObstacles(
    left: BlueprintAccessObstacle | null,
    right: BlueprintAccessObstacle | null
): number {
    if (left === null) return right === null ? 0 : -1;
    if (right === null) return 1;
    return compareObstacles(left, right);
}

function compareObstacles(left: BlueprintAccessObstacle, right: BlueprintAccessObstacle): number {
    const kindOrder = left.kind.localeCompare(right.kind);
    if (kindOrder !== 0) return kindOrder;
    if (left.kind === 'placement' && right.kind === 'placement') {
        return left.placementId.localeCompare(right.placementId);
    }
    if (left.kind === 'property-fixed' && right.kind === 'property-fixed') {
        return left.index - right.index;
    }
    return 0;
}
