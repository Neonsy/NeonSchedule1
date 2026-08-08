import { type BlueprintSurfacePlacement } from '#core/data/blueprint';
import { type Buildable } from '#core/data/buildable';
import { type Vector3 } from '#core/data/common';
import { type Quaternion } from '#core/data/geometry';
import { type PropertyLayout, type PropertySurface } from '#core/data/property-layout';
import { worldBoxFromCollider, type WorldBox } from '#core/geometry/box-collision';
import { transformPoint } from '#core/geometry/transform';
import type {
    BlueprintValidationIssue,
    BlueprintValidationIssueCode,
} from '#core/blueprint/validation';

export interface ResolvedBlueprintSurfacePlacement {
    readonly id: string;
    readonly kind: 'surface';
    readonly itemId: string;
    readonly surfaceId: string;
    readonly surfaceColliderPath: string;
    readonly relativeHitPoint: Vector3;
    readonly relativePosition: Vector3;
    readonly relativeRotation: Quaternion;
}

type SurfaceResolution =
    | { readonly placement: ResolvedBlueprintSurfacePlacement; readonly issues: readonly [] }
    | { readonly placement: null; readonly issues: readonly BlueprintValidationIssue[] };

type SurfaceFace = 'Front' | 'Back' | 'Top' | 'Bottom' | 'Left' | 'Right';

const surfaceFaces = new Set<SurfaceFace>([
    'Front',
    'Back',
    'Top',
    'Bottom',
    'Left',
    'Right',
]);
const surfaceHitTolerance = 1e-3;

export function indexPropertySurfaces(
    layout: PropertyLayout
): ReadonlyMap<string, PropertySurface> {
    const index = new Map<string, PropertySurface>();
    for (const surface of layout.surfaces) {
        if (surface.id.trim().length === 0) {
            throw new TypeError(`Surface ID in property ${JSON.stringify(layout.propertyCode)} must not be blank`);
        }
        if (index.has(surface.id)) {
            throw new Error(
                `Dataset contains duplicate surface ID ${JSON.stringify(surface.id)} in property ` +
                    JSON.stringify(layout.propertyCode)
            );
        }
        for (const collider of surface.colliders) {
            const path = collider.transform.path;
            if (path.trim().length === 0) {
                throw new TypeError(
                    `Surface ${JSON.stringify(surface.id)} in property ` +
                        `${JSON.stringify(layout.propertyCode)} has a blank collider path`
                );
            }
        }
        index.set(surface.id, surface);
    }
    return index;
}

export function resolveSurfacePlacement(
    placement: BlueprintSurfacePlacement,
    buildableByItemId: ReadonlyMap<string, Buildable>,
    surfaceById: ReadonlyMap<string, PropertySurface>
): SurfaceResolution {
    const buildable = buildableByItemId.get(placement.itemId);
    if (buildable === undefined) {
        return failed(
            'buildable-unavailable',
            `Placement ${JSON.stringify(placement.id)} references unavailable buildable ` +
                JSON.stringify(placement.itemId),
            placement
        );
    }
    if (buildable.placement.kind !== 'surface') {
        return failed(
            'placement-kind-incompatible',
            `Buildable ${JSON.stringify(placement.itemId)} uses ` +
                `${JSON.stringify(buildable.placement.kind)} placement, not surface placement`,
            placement
        );
    }
    const surface = surfaceById.get(placement.surfaceId);
    if (surface === undefined) {
        return failed(
            'surface-unavailable',
            `Placement ${JSON.stringify(placement.id)} references unavailable surface ` +
                JSON.stringify(placement.surfaceId),
            placement
        );
    }
    if (!buildable.placement.validSurfaceTypes.includes(surface.type)) {
        return failed(
            'surface-type-incompatible',
            `Buildable ${JSON.stringify(placement.itemId)} cannot be placed on surface type ` +
                JSON.stringify(surface.type),
            placement
        );
    }
    const unsupportedFaces = surface.validFaces.filter(
        (face): face is string => !surfaceFaces.has(face as SurfaceFace)
    );
    if (unsupportedFaces.length > 0) {
        return failed(
            'surface-face-unsupported',
            `Surface ${JSON.stringify(surface.id)} uses unsupported faces ` +
                unsupportedFaces.map((face) => JSON.stringify(face)).join(', '),
            placement
        );
    }

    const colliders = surface.colliders.filter(
        (candidate) => candidate.transform.path === placement.surfaceColliderPath
    );
    const availableColliders = colliders.filter(
        (candidate) => candidate.enabled && !candidate.isTrigger
    );
    if (availableColliders.length === 0) {
        return failed(
            'surface-collider-unavailable',
            `Placement ${JSON.stringify(placement.id)} references unavailable surface collider ` +
                JSON.stringify(placement.surfaceColliderPath),
            placement
        );
    }
    const worldHitPoint = transformPoint(surface.transform, placement.relativeHitPoint);
    const boxHits = availableColliders.flatMap((collider) => {
        if (collider.shape !== 'box') return [];
        try {
            const box = worldBoxFromCollider(collider);
            const coordinates = normalizedBoxCoordinates(worldHitPoint, box);
            return [{ box, coordinates }];
        } catch (error) {
            if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
            return [];
        }
    });
    if (boxHits.length === 0) {
        return failed(
            'surface-geometry-unsupported',
            `Placement ${JSON.stringify(placement.id)} cannot prove a raycast hit against the ` +
                `surface collider geometry at ${JSON.stringify(placement.surfaceColliderPath)}`,
            placement
        );
    }
    const boundaryHits = boxHits.filter(({ box, coordinates }) =>
        isOnBoxBoundary(coordinates, box)
    );
    if (boundaryHits.length === 0) {
        return failed(
            'surface-point-outside-collider',
            `Placement ${JSON.stringify(placement.id)} does not contain a raycast hit on surface ` +
                `collider ${JSON.stringify(placement.surfaceColliderPath)}`,
            placement
        );
    }
    if (!boundaryHits.some(({ coordinates }) =>
        surface.validFaces.some((face) => faceAccepts(face as SurfaceFace, coordinates))
    )) {
        return failed(
            'surface-face-incompatible',
            `Placement ${JSON.stringify(placement.id)} hits a face not accepted by surface ` +
                JSON.stringify(surface.id),
            placement
        );
    }
    return {
        placement: {
            id: placement.id,
            kind: 'surface',
            itemId: placement.itemId,
            surfaceId: placement.surfaceId,
            surfaceColliderPath: placement.surfaceColliderPath,
            relativeHitPoint: placement.relativeHitPoint,
            relativePosition: placement.relativePosition,
            relativeRotation: placement.relativeRotation,
        },
        issues: [],
    };
}

function normalizedBoxCoordinates(
    point: Vector3,
    box: WorldBox
): readonly [number, number, number] {
    const [xAxis, yAxis, zAxis] = box.halfAxes;
    const delta = subtract(point, box.center);
    const determinant = dot(xAxis, cross(yAxis, zAxis));
    if (!Number.isFinite(determinant) || Math.abs(determinant) <= Number.EPSILON) {
        throw new RangeError('Surface collider box is degenerate');
    }
    return [
        dot(delta, cross(yAxis, zAxis)) / determinant,
        dot(xAxis, cross(delta, zAxis)) / determinant,
        dot(xAxis, cross(yAxis, delta)) / determinant,
    ];
}

function isOnBoxBoundary(coordinates: readonly number[], box: WorldBox): boolean {
    const tolerances = box.halfAxes.map((axis) =>
        surfaceHitTolerance / Math.hypot(axis.x, axis.y, axis.z)
    );
    return coordinates.every((coordinate, index) =>
        Math.abs(coordinate) <= 1 + tolerances[index]!
    ) && coordinates.some((coordinate, index) =>
        Math.abs(Math.abs(coordinate) - 1) <= tolerances[index]!
    );
}

function faceAccepts(
    face: SurfaceFace,
    coordinates: readonly [number, number, number]
): boolean {
    const [x, y, z] = coordinates;
    switch (face) {
        case 'Front': return z >= 0;
        case 'Back': return z <= 0;
        case 'Top': return y >= 0;
        case 'Bottom': return y <= 0;
        case 'Left': return x <= 0;
        case 'Right': return x >= 0;
    }
}

function failed(
    code: BlueprintValidationIssueCode,
    message: string,
    placement: BlueprintSurfacePlacement
): SurfaceResolution {
    return {
        placement: null,
        issues: [{
            code,
            message,
            placementIds: [placement.id],
            gridId: null,
            surfaceId: placement.surfaceId,
            tiles: [],
        }],
    };
}

function subtract(left: Vector3, right: Vector3): Vector3 {
    return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
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
