import { type BlueprintDocument } from '#core/data/blueprint';
import { type Collider, type ColliderShape } from '#core/data/geometry';
import { type PropertyLayout } from '#core/data/property-layout';
import {
    BlueprintProjector,
    type BlueprintProjectionResult,
    type ProjectedBlueprintPlacement,
} from '#core/blueprint/projection';
import {
    worldBoxFromCollider,
    worldBoxesOverlap,
    type WorldBox,
} from '#core/geometry/box-collision';
import { type BlueprintDataset } from '#core/blueprint/validation';

export interface PropertyColliderReference {
    readonly index: number;
    readonly path: string;
    readonly shape: ColliderShape;
}

export type BlueprintCollision =
    | {
        readonly code: 'fixed-geometry-overlap';
        readonly placementIds: readonly [string];
        readonly propertyCollider: PropertyColliderReference;
    }
    | {
        readonly code: 'placement-overlap';
        readonly placementIds: readonly [string, string];
        readonly propertyCollider: null;
    };

export type BlueprintCollisionLimitation =
    | {
        readonly code: 'unsupported-fixed-geometry';
        readonly placementId: string;
        readonly propertyCollider: PropertyColliderReference;
        readonly placementShape: null;
    }
    | {
        readonly code: 'unsupported-placement-geometry';
        readonly placementId: string;
        readonly propertyCollider: null;
        readonly placementShape: ColliderShape;
    };

export type BlueprintCollisionResult =
    | {
        readonly kind: 'rejected';
        readonly projection: Extract<BlueprintProjectionResult, { readonly kind: 'rejected' }>;
        readonly proofStatus: 'not-applicable';
        readonly collisions: readonly [];
        readonly limitations: readonly [];
    }
    | {
        readonly kind: 'analyzed';
        readonly projection: Extract<BlueprintProjectionResult, { readonly kind: 'projected' }>;
        readonly proofStatus: 'exact' | 'incomplete';
        readonly collisions: readonly BlueprintCollision[];
        readonly limitations: readonly BlueprintCollisionLimitation[];
    };

interface AxisAlignedBounds {
    readonly minimum: { readonly x: number; readonly y: number; readonly z: number };
    readonly maximum: { readonly x: number; readonly y: number; readonly z: number };
}

export class BlueprintCollisionAnalyzer {
    readonly #projector: BlueprintProjector;
    readonly #propertyByCode: ReadonlyMap<string, PropertyLayout>;

    constructor(dataset: BlueprintDataset) {
        this.#projector = new BlueprintProjector(dataset);
        this.#propertyByCode = new Map(
            dataset.propertyLayouts.map((property) => [property.propertyCode, property])
        );
    }

    analyze(input: BlueprintDocument): BlueprintCollisionResult {
        const projection = this.#projector.project(input);
        if (projection.kind === 'rejected') {
            return {
                kind: 'rejected',
                projection,
                proofStatus: 'not-applicable',
                collisions: [],
                limitations: [],
            };
        }

        const property = this.#propertyByCode.get(projection.validation.document.propertyCode);
        if (property === undefined) {
            throw new Error('Projected blueprint references an unavailable property layout');
        }
        const analysis = analyzeCollisions(property, projection.placements);
        return {
            kind: 'analyzed',
            projection,
            proofStatus: analysis.limitations.length === 0 ? 'exact' : 'incomplete',
            ...analysis,
        };
    }
}

function analyzeCollisions(
    property: PropertyLayout,
    placements: readonly ProjectedBlueprintPlacement[]
): {
    readonly collisions: readonly BlueprintCollision[];
    readonly limitations: readonly BlueprintCollisionLimitation[];
} {
    const collisions: BlueprintCollision[] = [];
    const limitations: BlueprintCollisionLimitation[] = [];
    const placementBoxes: {
        readonly placement: ProjectedBlueprintPlacement;
        readonly box: WorldBox;
    }[] = [];
    for (const placement of placements) {
        const box = placement.boundingCollider.shape === 'box'
            ? tryWorldBox(placement.boundingCollider)
            : null;
        if (box === null) {
            limitations.push({
                code: 'unsupported-placement-geometry',
                placementId: placement.id,
                propertyCollider: null,
                placementShape: placement.boundingCollider.shape,
            });
            continue;
        }
        placementBoxes.push({
            placement,
            box,
        });
    }

    for (let leftIndex = 0; leftIndex < placementBoxes.length; leftIndex++) {
        const left = placementBoxes[leftIndex]!;
        for (let rightIndex = leftIndex + 1; rightIndex < placementBoxes.length; rightIndex++) {
            const right = placementBoxes[rightIndex]!;
            if (isExplicitProceduralParentPair(left.placement, right.placement)) continue;
            if (!worldBoxesOverlap(left.box, right.box)) continue;
            const placementIds = [left.placement.id, right.placement.id].sort() as [string, string];
            collisions.push({ code: 'placement-overlap', placementIds, propertyCollider: null });
        }
    }

    property.fixedColliders.forEach((collider, index) => {
        if (collider.isTrigger) return;
        const reference = colliderReference(collider, index);
        for (const candidate of placementBoxes) {
            if (!aabbOverlaps(worldBoxBounds(candidate.box), colliderBounds(collider))) continue;
            if (collider.shape !== 'box') {
                limitations.push({
                    code: 'unsupported-fixed-geometry',
                    placementId: candidate.placement.id,
                    propertyCollider: reference,
                    placementShape: null,
                });
                continue;
            }
            const fixedBox = tryWorldBox(collider);
            if (fixedBox === null) {
                limitations.push({
                    code: 'unsupported-fixed-geometry',
                    placementId: candidate.placement.id,
                    propertyCollider: reference,
                    placementShape: null,
                });
                continue;
            }
            if (worldBoxesOverlap(candidate.box, fixedBox)) {
                collisions.push({
                    code: 'fixed-geometry-overlap',
                    placementIds: [candidate.placement.id],
                    propertyCollider: reference,
                });
            }
        }
    });

    return {
        collisions: collisions.sort(compareCollisions),
        limitations: limitations.sort(compareLimitations),
    };
}

function isExplicitProceduralParentPair(
    left: ProjectedBlueprintPlacement,
    right: ProjectedBlueprintPlacement
): boolean {
    return (left.kind === 'procedural-grid' && left.parentPlacementId === right.id) ||
        (right.kind === 'procedural-grid' && right.parentPlacementId === left.id);
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

function colliderReference(collider: Collider, index: number): PropertyColliderReference {
    return {
        index,
        path: collider.transform.path,
        shape: collider.shape,
    };
}

function worldBoxBounds(box: WorldBox): AxisAlignedBounds {
    const extent = {
        x: box.halfAxes.reduce((sum, axis) => sum + Math.abs(axis.x), 0),
        y: box.halfAxes.reduce((sum, axis) => sum + Math.abs(axis.y), 0),
        z: box.halfAxes.reduce((sum, axis) => sum + Math.abs(axis.z), 0),
    };
    return {
        minimum: {
            x: box.center.x - extent.x,
            y: box.center.y - extent.y,
            z: box.center.z - extent.z,
        },
        maximum: {
            x: box.center.x + extent.x,
            y: box.center.y + extent.y,
            z: box.center.z + extent.z,
        },
    };
}

function colliderBounds(collider: Collider): AxisAlignedBounds {
    const halfSize = {
        x: Math.abs(collider.worldBounds.size.x) / 2,
        y: Math.abs(collider.worldBounds.size.y) / 2,
        z: Math.abs(collider.worldBounds.size.z) / 2,
    };
    return {
        minimum: {
            x: collider.worldBounds.center.x - halfSize.x,
            y: collider.worldBounds.center.y - halfSize.y,
            z: collider.worldBounds.center.z - halfSize.z,
        },
        maximum: {
            x: collider.worldBounds.center.x + halfSize.x,
            y: collider.worldBounds.center.y + halfSize.y,
            z: collider.worldBounds.center.z + halfSize.z,
        },
    };
}

function aabbOverlaps(left: AxisAlignedBounds, right: AxisAlignedBounds): boolean {
    return left.minimum.x < right.maximum.x && right.minimum.x < left.maximum.x &&
        left.minimum.y < right.maximum.y && right.minimum.y < left.maximum.y &&
        left.minimum.z < right.maximum.z && right.minimum.z < left.maximum.z;
}

function compareCollisions(left: BlueprintCollision, right: BlueprintCollision): number {
    return left.code.localeCompare(right.code) ||
        (left.propertyCollider?.index ?? -1) - (right.propertyCollider?.index ?? -1) ||
        left.placementIds.join('\0').localeCompare(right.placementIds.join('\0'));
}

function compareLimitations(
    left: BlueprintCollisionLimitation,
    right: BlueprintCollisionLimitation
): number {
    return (left.propertyCollider?.index ?? -1) - (right.propertyCollider?.index ?? -1) ||
        left.placementId.localeCompare(right.placementId);
}
