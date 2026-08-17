import type { BlueprintDocument } from '#core/data/blueprint';
import { BuildableSchema, type Buildable } from '#core/data/buildable';
import type { Vector3 } from '#core/data/common';
import type { Collider, ColliderShape } from '#core/data/geometry';
import { PropertyLayoutSchema, type PropertyLayout } from '#core/data/property-layout';
import { NavigationGraphSchema, type NavigationAgent } from '#core/data/world';
import type {
    BlueprintProductionEndpointAccessResult,
    BlueprintProductionTransitEndpointAccess,
} from '#core/blueprint/production-endpoint-access';
import type {
    BlueprintProductionLogisticsDataset,
    BlueprintProductionMovementAllocationFeasibility,
    BlueprintProductionMovementPhysicalFeasibility,
    BlueprintProductionMovementPlan,
    BlueprintProductionPhysicalObstacle,
    BlueprintProductionPhysicalSegmentFeasibility,
    BlueprintProductionPhysicalSegmentLimitation,
} from '#core/blueprint/production-logistics-types';
import type { ProjectedBlueprintPlacement } from '#core/blueprint/projection';
import {
    worldBoxFromCollider,
    worldBoxesOverlap,
    type WorldBox,
} from '#core/geometry/box-collision';
import {
    axisAlignedBoundsBox,
    isWorldBoxSupportContact,
    projectSourceBounds,
    sweptUprightAgentEnvelope,
    sweptUprightCylinderOverlapsBox,
} from '#core/blueprint/production-movement-geometry';
import {
    isNavigationSegmentLocallyTraversable,
    NavigationNetwork,
    type FoundNavigationPath,
} from '#core/world/navigation';

type AnalyzedEndpointAccess = Extract<
    BlueprintProductionEndpointAccessResult,
    { readonly kind: 'analyzed' }
>;

interface PhysicalObstacle {
    readonly reference: BlueprintProductionPhysicalObstacle;
    readonly exactBox: WorldBox | null;
    readonly conservativeBounds: WorldBox | null;
    readonly activityEvidence: 'active-world-bounds' | 'unavailable';
}

interface SegmentInput {
    readonly kind: BlueprintProductionPhysicalSegmentFeasibility['kind'];
    readonly segmentIndex: number | null;
    readonly start: Vector3;
    readonly end: Vector3;
}

export class BlueprintProductionMovementFeasibilityAnalyzer {
    readonly #agent: NavigationAgent;
    readonly #navigation: NavigationNetwork;
    readonly #buildableByItemId: ReadonlyMap<string, Buildable>;
    readonly #propertyByCode: ReadonlyMap<string, PropertyLayout>;

    constructor(dataset: BlueprintProductionLogisticsDataset) {
        const navigation = NavigationGraphSchema.assert(dataset.navigation);
        this.#agent = navigation.agent;
        this.#navigation = new NavigationNetwork(navigation);
        this.#buildableByItemId = indexUnique(
            dataset.buildables.map((input) => BuildableSchema.assert(input)),
            (buildable) => buildable.itemId,
            'buildable item ID'
        );
        this.#propertyByCode = indexUnique(
            dataset.propertyLayouts.map((input) => PropertyLayoutSchema.assert(input)),
            (property) => property.propertyCode,
            'property layout code'
        );
    }

    analyze(
        blueprint: BlueprintDocument,
        endpointAccess: AnalyzedEndpointAccess,
        movementPlan: BlueprintProductionMovementPlan
    ): BlueprintProductionMovementPhysicalFeasibility {
        const property = this.#propertyByCode.get(blueprint.propertyCode);
        if (property === undefined) {
            throw new Error('Movement feasibility references an unavailable property layout');
        }
        const projection = endpointAccess.routing.capacity.temperature.projection;
        if (projection.validation.document.propertyCode !== blueprint.propertyCode) {
            throw new Error('Movement feasibility projection references a different property');
        }
        const placementObstacles = projection.placements.flatMap((placement) =>
            this.#placementObstacles(placement)
        );
        const endpointObstacles = [
            ...placementObstacles,
            ...property.fixedColliders.flatMap((collider, index) =>
                fixedObstacle(collider, index)
            ),
        ];
        const allocations = movementPlan.allocations.map((allocation, allocationIndex) => {
            const sourceEndpoint = requireEndpoint(
                endpointAccess,
                allocation.sourcePlacementId,
                allocation.selectedNetworkRoute.sourceAccessPointIndex,
                allocation.selectedNetworkRoute.sourceNetworkSampleIndex
            );
            const destinationEndpoint = requireEndpoint(
                endpointAccess,
                allocation.destinationPlacementId,
                allocation.selectedNetworkRoute.destinationAccessPointIndex,
                allocation.selectedNetworkRoute.destinationNetworkSampleIndex
            );
            const route = requireSelectedRoute(
                this.#navigation,
                allocation.selectedNetworkRoute.sourceNetworkSampleIndex,
                allocation.selectedNetworkRoute.destinationNetworkSampleIndex,
                allocation.selectedNetworkRoute.networkDistance
            );
            requireSamePosition(
                route.start.samplePosition,
                sourceEndpoint.employeeReachability.path.end.samplePosition,
                'Movement feasibility source sample'
            );
            requireSamePosition(
                route.end.samplePosition,
                destinationEndpoint.employeeReachability.path.end.samplePosition,
                'Movement feasibility destination sample'
            );
            return this.#allocationFeasibility(
                allocationIndex,
                allocation.itemId,
                allocation.sourcePlacementId,
                allocation.destinationPlacementId,
                sourceEndpoint.transform.worldPosition,
                destinationEndpoint.transform.worldPosition,
                route,
                placementObstacles,
                endpointObstacles
            );
        });
        const status = aggregateStatus(allocations.map((allocation) => allocation.status));
        const selectedRouteStatuses = allocations.flatMap((allocation) =>
            allocation.selectedNetworkEdges.map((segment) => segment.status)
        );
        const selectedRouteStatus = aggregateStatus(selectedRouteStatuses);
        return {
            status,
            employeeBodyBasis: {
                source: 'normalized-navigation-agent',
                radius: this.#agent.radius,
                height: this.#agent.height,
                maximumSlope: this.#agent.maximumSlope,
                stepHeight: this.#agent.stepHeight,
                posture: 'upright',
                collisionEnvelope:
                    'swept-upright-cylinder-with-conservative-unsupported-geometry-bounds',
            },
            endpointSnapScope:
                'transit-access-point-to-selected-navigation-sample-against-projected-and-fixed-geometry',
            selectedRouteScope:
                'selected-navigation-graph-edges-rechecked-against-projected-placements',
            placementObstacleBasis:
                'projected-enabled-non-trigger-built-item-colliders',
            unsupportedPlacementGeometryBound:
                'source-world-bounds-then-projected-placement-bound',
            colliderActivityBasis:
                'positive-source-world-bounds-or-incomplete',
            propertyObstacleBasis: 'enabled-non-trigger-fixed-colliders',
            propertyObstacleApplication:
                'endpoint-snaps-only-navigation-graph-already-accounts-for-fixed-geometry',
            clearanceConclusion:
                'clear-when-exact-upright-box-tests-and-conservative-unsupported-geometry-bounds-are-clear',
            navigationRebakeEvidence: selectedRouteStatus === 'clear'
                ? 'selected-segments-clear-under-normalized-static-geometry'
                : selectedRouteStatus === 'incomplete'
                    ? 'unresolved-for-selected-segments'
                    : selectedRouteStatus === 'blocked'
                        ? 'selected-segment-blocked'
                        : allocations.length === 0
                            ? 'not-applicable-no-selected-movements'
                            : 'not-applicable-no-selected-network-edges',
            dynamicObstacleClearance: 'not-evaluated',
            allocations,
        };
    }

    #placementObstacles(placement: ProjectedBlueprintPlacement): PhysicalObstacle[] {
        const buildable = this.#buildableByItemId.get(placement.itemId);
        if (buildable === undefined) {
            throw new Error('Movement feasibility projection references an unavailable buildable');
        }
        if (placement.colliders.length !== buildable.colliders.length) {
            throw new Error('Movement feasibility projected collider count is inconsistent');
        }
        const placementBound = tryWorldBox(placement.boundingCollider) ?? projectSourceBounds(
            buildable.placement.boundingCollider.worldBounds,
            placement.root
        );
        return placement.colliders.flatMap((collider, index): PhysicalObstacle[] => {
            if (!collider.enabled || collider.isTrigger) return [];
            const exactBox = tryWorldBox(collider);
            const sourceCollider = buildable.colliders[index]!;
            const sourceBounds = projectSourceBounds(
                sourceCollider.worldBounds,
                placement.root
            );
            return [{
                reference: {
                    kind: 'placement',
                    placementId: placement.id,
                    index,
                    path: collider.transform.path,
                    shape: collider.shape,
                },
                exactBox,
                conservativeBounds: exactBox ?? sourceBounds ?? placementBound,
                activityEvidence: sourceBounds === null
                    ? 'unavailable'
                    : 'active-world-bounds',
            }];
        });
    }

    #allocationFeasibility(
        allocationIndex: number,
        itemId: string,
        sourcePlacementId: string,
        destinationPlacementId: string,
        sourceEndpoint: Vector3,
        destinationEndpoint: Vector3,
        route: FoundNavigationPath,
        placementObstacles: readonly PhysicalObstacle[],
        endpointObstacles: readonly PhysicalObstacle[]
    ): BlueprintProductionMovementAllocationFeasibility {
        const sourceEndpointSnap = this.#segmentFeasibility({
            kind: 'source-endpoint-snap',
            segmentIndex: null,
            start: sourceEndpoint,
            end: route.start.samplePosition,
        }, endpointObstacles);
        const selectedNetworkEdges = route.points.slice(1).map((point, index) =>
            this.#segmentFeasibility({
                kind: 'selected-network-edge',
                segmentIndex: index,
                start: route.points[index]!.position,
                end: point.position,
            }, placementObstacles)
        );
        const destinationEndpointSnap = this.#segmentFeasibility({
            kind: 'destination-endpoint-snap',
            segmentIndex: null,
            start: route.end.samplePosition,
            end: destinationEndpoint,
        }, endpointObstacles);
        const status = aggregateStatus([
            sourceEndpointSnap.status,
            ...selectedNetworkEdges.map((segment) => segment.status),
            destinationEndpointSnap.status,
        ]);
        if (status === 'not-applicable') {
            throw new Error('Movement allocation feasibility contains no segments');
        }
        return {
            allocationIndex,
            itemId,
            sourcePlacementId,
            destinationPlacementId,
            status,
            sourceEndpointSnap,
            selectedNetworkEdges,
            destinationEndpointSnap,
        };
    }

    #segmentFeasibility(
        input: SegmentInput,
        obstacles: readonly PhysicalObstacle[]
    ): BlueprintProductionPhysicalSegmentFeasibility {
        const envelope = sweptUprightAgentEnvelope(
            input.start,
            input.end,
            this.#agent.radius,
            this.#agent.height
        );
        const limitations = obstacles.flatMap((obstacle) =>
            obstacleLimitations(
                envelope,
                input.start,
                input.end,
                this.#agent.radius,
                this.#agent.height,
                obstacle
            )
        ).sort(compareLimitations);
        const localMovementLimits = isNavigationSegmentLocallyTraversable(
            this.#agent,
            input.start,
            input.end
        ) ? 'traversable' as const : 'exceeded' as const;
        const staticGeometry = limitations.some((limitation) =>
            limitation.code === 'employee-body-overlap'
        )
            ? 'blocked' as const
            : limitations.length === 0
                ? 'clear' as const
                : 'incomplete' as const;
        return {
            ...input,
            start: copyPosition(input.start),
            end: copyPosition(input.end),
            horizontalDistance: Math.hypot(
                input.start.x - input.end.x,
                input.start.z - input.end.z
            ),
            verticalDistance: Math.abs(input.start.y - input.end.y),
            localMovementLimits,
            staticGeometry,
            status: localMovementLimits === 'exceeded'
                ? 'blocked'
                : staticGeometry,
            limitations,
        };
    }
}

function fixedObstacle(collider: Collider, index: number): PhysicalObstacle[] {
    if (!collider.enabled || collider.isTrigger) return [];
    const exactBox = tryWorldBox(collider);
    const sourceBounds = axisAlignedBoundsBox(collider.worldBounds);
    return [{
        reference: {
            kind: 'property-fixed',
            index,
            path: collider.transform.path,
            shape: collider.shape,
        },
        exactBox,
        conservativeBounds: exactBox ?? sourceBounds,
        activityEvidence: sourceBounds === null
            ? 'unavailable'
            : 'active-world-bounds',
    }];
}

function obstacleLimitations(
    envelope: WorldBox,
    start: Vector3,
    end: Vector3,
    radius: number,
    height: number,
    obstacle: PhysicalObstacle
): BlueprintProductionPhysicalSegmentLimitation[] {
    if (obstacle.exactBox !== null) {
        const exactOverlap = sweptUprightCylinderOverlapsBox(
            start,
            end,
            radius,
            height,
            obstacle.exactBox
        );
        if (exactOverlap !== null) {
            return exactOverlap
                ? [{
                    code: obstacle.activityEvidence === 'active-world-bounds'
                        ? 'employee-body-overlap'
                        : 'collider-activity-unavailable',
                    obstacle: obstacle.reference,
                }]
                : [];
        }
        return worldBoxesOverlap(envelope, obstacle.exactBox) &&
            !isWorldBoxSupportContact(envelope, obstacle.exactBox)
            ? [{ code: 'conservative-body-envelope-overlap', obstacle: obstacle.reference }]
            : [];
    }
    if (obstacle.conservativeBounds === null ||
        (worldBoxesOverlap(envelope, obstacle.conservativeBounds) &&
            !isWorldBoxSupportContact(envelope, obstacle.conservativeBounds))) {
        return [{ code: 'unsupported-obstacle-geometry', obstacle: obstacle.reference }];
    }
    return [];
}

function requireEndpoint(
    endpointAccess: AnalyzedEndpointAccess,
    placementId: string,
    accessPointIndex: number,
    sampleIndex: number
): BlueprintProductionTransitEndpointAccess & {
    readonly employeeReachability: Extract<
        BlueprintProductionTransitEndpointAccess['employeeReachability'],
        { readonly kind: 'reachable' }
    >;
} {
    const endpoint = endpointAccess.placements
        .find((placement) => placement.placementId === placementId)
        ?.transitAccessPoints.find((point) => point.accessPointIndex === accessPointIndex);
    if (endpoint === undefined || endpoint.employeeReachability.kind !== 'reachable') {
        throw new Error('Movement feasibility references an unavailable reachable endpoint');
    }
    if (endpoint.employeeReachability.path.end.sampleIndex !== sampleIndex) {
        throw new Error('Movement feasibility endpoint and selected sample disagree');
    }
    return endpoint as BlueprintProductionTransitEndpointAccess & {
        readonly employeeReachability: Extract<
            BlueprintProductionTransitEndpointAccess['employeeReachability'],
            { readonly kind: 'reachable' }
        >;
    };
}

function requireSelectedRoute(
    navigation: NavigationNetwork,
    sourceSampleIndex: number,
    destinationSampleIndex: number,
    expectedDistance: number
): FoundNavigationPath {
    const route = navigation.findPathBetweenSamples({
        startSampleIndex: sourceSampleIndex,
        endSampleIndex: destinationSampleIndex,
    });
    if (route.kind !== 'found') {
        throw new Error('Movement feasibility selected route is disconnected');
    }
    requireSameNumber(route.networkDistance, expectedDistance, 'Movement feasibility route distance');
    return route;
}

function aggregateStatus(
    statuses: readonly ('clear' | 'incomplete' | 'blocked')[]
): 'clear' | 'incomplete' | 'blocked' | 'not-applicable' {
    if (statuses.length === 0) return 'not-applicable';
    if (statuses.includes('blocked')) return 'blocked';
    return statuses.includes('incomplete') ? 'incomplete' : 'clear';
}

function compareLimitations(
    left: BlueprintProductionPhysicalSegmentLimitation,
    right: BlueprintProductionPhysicalSegmentLimitation
): number {
    return left.code.localeCompare(right.code) ||
        compareObstacles(left.obstacle, right.obstacle);
}

function compareObstacles(
    left: BlueprintProductionPhysicalObstacle,
    right: BlueprintProductionPhysicalObstacle
): number {
    const kindOrder = left.kind.localeCompare(right.kind);
    if (kindOrder !== 0) return kindOrder;
    if (left.kind === 'placement' && right.kind === 'placement') {
        return left.placementId.localeCompare(right.placementId) || left.index - right.index;
    }
    if (left.kind === 'property-fixed' && right.kind === 'property-fixed') {
        return left.index - right.index;
    }
    return 0;
}

function tryWorldBox(collider: Parameters<typeof worldBoxFromCollider>[0]): WorldBox | null {
    try {
        return worldBoxFromCollider(collider);
    } catch (error) {
        if (error instanceof TypeError || error instanceof RangeError) return null;
        throw error;
    }
}

function indexUnique<T>(
    values: readonly T[],
    keyFor: (value: T) => string,
    label: string
): ReadonlyMap<string, T> {
    const result = new Map<string, T>();
    for (const value of values) {
        const key = keyFor(value);
        if (result.has(key)) throw new Error(`Dataset contains duplicate ${label} ${JSON.stringify(key)}`);
        result.set(key, value);
    }
    return result;
}

function requireSamePosition(actual: Vector3, expected: Vector3, label: string): void {
    requireSameNumber(actual.x, expected.x, `${label} X`);
    requireSameNumber(actual.y, expected.y, `${label} Y`);
    requireSameNumber(actual.z, expected.z, `${label} Z`);
}

function requireSameNumber(actual: number, expected: number, label: string): void {
    const tolerance = 1e-9 * Math.max(1, Math.abs(actual), Math.abs(expected));
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
        throw new Error(`${label} is inconsistent`);
    }
}

function copyPosition(position: Vector3): Vector3 {
    return { x: position.x, y: position.y, z: position.z };
}
