import type { BlueprintDocument } from '#core/data/blueprint';
import type {
    ProjectedBlueprintPlacement,
    ProjectedBuildableTransform,
} from '#core/blueprint/projection';
import {
    BlueprintProductionCapacityAnalyzer,
    type BlueprintProductionCapacityDataset,
    type BlueprintProductionCapacityResult,
} from '#core/blueprint/production-capacity';

export type BlueprintProductionRoutingInteractionRole =
    | 'operator-access'
    | 'item-placement'
    | 'automation-link';

export interface BlueprintProductionInteractionRoutingPoint<
    Role extends BlueprintProductionRoutingInteractionRole = BlueprintProductionRoutingInteractionRole,
> {
    readonly kind: 'interaction-point';
    readonly interactionPointIndex: number;
    readonly role: Role;
    readonly componentType: string;
    readonly member: string;
    readonly transform: ProjectedBuildableTransform;
}

export interface BlueprintProductionTransitRoutingPoint {
    readonly kind: 'transit-access-point';
    readonly accessPointIndex: number;
    readonly transform: ProjectedBuildableTransform;
}

export interface BlueprintProductionPlacementRoutingInputs {
    readonly placementId: string;
    readonly itemId: string;
    readonly placementKind: ProjectedBlueprintPlacement['kind'];
    readonly isTransitEntity: boolean;
    readonly operatorAccessPoints: readonly BlueprintProductionInteractionRoutingPoint<'operator-access'>[];
    readonly itemPlacementPoints: readonly BlueprintProductionInteractionRoutingPoint<'item-placement'>[];
    readonly automationLinkPoints: readonly BlueprintProductionInteractionRoutingPoint<'automation-link'>[];
    readonly transitAccessPoints: readonly BlueprintProductionTransitRoutingPoint[];
}

export type BlueprintProductionRoutingInputsResult =
    | {
        readonly kind: 'rejected';
        readonly capacity: Extract<BlueprintProductionCapacityResult, { readonly kind: 'rejected' }>;
        readonly endpointBasis: 'not-applicable';
        readonly placements: readonly [];
    }
    | {
        readonly kind: 'analyzed';
        readonly capacity: Extract<BlueprintProductionCapacityResult, { readonly kind: 'analyzed' }>;
        readonly endpointBasis: 'normalized-buildable-interaction-and-transit-points';
        readonly interactionRoleBasis: 'exported-classification';
        readonly routeConnectivity: 'not-evaluated';
        readonly employeeReachability: 'not-evaluated';
        readonly itemFlowDirection: 'not-evaluated';
        readonly staticObstacleClearance: 'not-evaluated';
        readonly dynamicObstacleClearance: 'not-evaluated';
        readonly placements: readonly BlueprintProductionPlacementRoutingInputs[];
    };

export class BlueprintProductionRoutingInputsAnalyzer {
    readonly #capacity: BlueprintProductionCapacityAnalyzer;

    constructor(dataset: BlueprintProductionCapacityDataset) {
        this.#capacity = new BlueprintProductionCapacityAnalyzer(dataset);
    }

    analyze(blueprint: BlueprintDocument): BlueprintProductionRoutingInputsResult {
        const capacity = this.#capacity.analyze(blueprint);
        if (capacity.kind === 'rejected') {
            return {
                kind: 'rejected',
                capacity,
                endpointBasis: 'not-applicable',
                placements: [],
            };
        }

        const projectedById = new Map(
            capacity.temperature.projection.placements.map((placement) => [placement.id, placement])
        );
        const placements = capacity.equipment
            .flatMap((equipment) => equipment.placements.map(({ placementId }) => {
                const projected = projectedById.get(placementId);
                if (projected === undefined) {
                    throw new Error('Production capacity references an unavailable projected placement');
                }
                if (projected.itemId !== equipment.itemId) {
                    throw new Error('Production capacity and projection disagree on placed equipment');
                }
                return routingInputs(projected);
            }))
            .sort((left, right) => left.placementId.localeCompare(right.placementId));

        return {
            kind: 'analyzed',
            capacity,
            endpointBasis: 'normalized-buildable-interaction-and-transit-points',
            interactionRoleBasis: 'exported-classification',
            routeConnectivity: 'not-evaluated',
            employeeReachability: 'not-evaluated',
            itemFlowDirection: 'not-evaluated',
            staticObstacleClearance: 'not-evaluated',
            dynamicObstacleClearance: 'not-evaluated',
            placements,
        };
    }
}

function routingInputs(
    placement: ProjectedBlueprintPlacement
): BlueprintProductionPlacementRoutingInputs {
    const interactions = placement.interactionPoints.map((point, interactionPointIndex) => ({
        point,
        interactionPointIndex,
    }));
    return {
        placementId: placement.id,
        itemId: placement.itemId,
        placementKind: placement.kind,
        isTransitEntity: placement.isTransitEntity,
        operatorAccessPoints: interactionPoints(interactions, 'operator-access'),
        itemPlacementPoints: interactionPoints(interactions, 'item-placement'),
        automationLinkPoints: interactionPoints(interactions, 'automation-link'),
        transitAccessPoints: placement.transitAccessPoints
            .map((transform, accessPointIndex) => ({
                kind: 'transit-access-point' as const,
                accessPointIndex,
                transform,
            }))
            .sort((left, right) =>
                left.transform.path.localeCompare(right.transform.path) ||
                left.accessPointIndex - right.accessPointIndex
            ),
    };
}

function interactionPoints<Role extends BlueprintProductionRoutingInteractionRole>(
    interactions: readonly {
        readonly point: {
            readonly role: string;
            readonly componentType: string;
            readonly member: string;
            readonly transform: ProjectedBuildableTransform;
        };
        readonly interactionPointIndex: number;
    }[],
    role: Role
): BlueprintProductionInteractionRoutingPoint<Role>[] {
    return interactions
        .filter(({ point }) => point.role === role)
        .map(({ point, interactionPointIndex }) => ({
            kind: 'interaction-point' as const,
            interactionPointIndex,
            role,
            componentType: point.componentType,
            member: point.member,
            transform: point.transform,
        }))
        .sort((left, right) =>
            left.transform.path.localeCompare(right.transform.path) ||
            left.componentType.localeCompare(right.componentType) ||
            left.member.localeCompare(right.member) ||
            left.interactionPointIndex - right.interactionPointIndex
        );
}
