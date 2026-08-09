import type { BlueprintDocument } from '#core/data/blueprint';
import type { Vector3 } from '#core/data/common';
import { PropertySchema } from '#core/data/property';
import {
    NavigationGraphSchema,
    type NavigationGraph,
} from '#core/data/world';
import {
    BlueprintAccessAnalyzer,
    type BlueprintAccessLimitation,
    type BlueprintAccessPointClearance,
} from '#core/blueprint/access';
import {
    BlueprintProductionRoutingInputsAnalyzer,
    type BlueprintProductionRoutingInputsResult,
    type BlueprintProductionTransitRoutingPoint,
} from '#core/blueprint/production-routing-inputs';
import type { BlueprintProductionCapacityDataset } from '#core/blueprint/production-capacity';
import {
    NavigationNetwork,
    type FoundNavigationPath,
    type UnreachableNavigationPath,
} from '#core/world/navigation';

export interface BlueprintProductionEndpointAccessDataset
    extends BlueprintProductionCapacityDataset {
    readonly navigation: NavigationGraph;
}

export type BlueprintProductionEmployeeReachability =
    | {
        readonly kind: 'reachable';
        readonly path: FoundNavigationPath;
    }
    | {
        readonly kind: 'unreachable';
        readonly path: UnreachableNavigationPath;
    }
    | {
        readonly kind: 'not-applicable';
        readonly reason: 'property-has-no-employee-capacity';
    };

export interface BlueprintProductionTransitEndpointAccess
    extends BlueprintProductionTransitRoutingPoint {
    readonly staticClearance: BlueprintAccessPointClearance;
    readonly employeeReachability: BlueprintProductionEmployeeReachability;
}

export interface BlueprintProductionPlacementEndpointAccess {
    readonly placementId: string;
    readonly itemId: string;
    readonly transitAccessPoints: readonly BlueprintProductionTransitEndpointAccess[];
}

export interface BlueprintProductionEmployeeReachabilityBasis {
    readonly kind: 'property-spawn-to-production-transit-point';
    readonly propertyCode: string;
    readonly propertyEmployeeCapacity: number;
    readonly origin: Vector3;
    readonly navigationAgentTypeId: number;
    readonly navigationAgentName: string;
    readonly navigationEmployeeTypes: readonly string[];
    readonly navigationAgentRadius: number;
    readonly navigationAgentHeight: number;
    readonly navigationAgentMaximumSlope: number;
    readonly navigationAgentStepHeight: number;
    readonly maximumStartSnapDistance: number;
    readonly maximumEndpointSnapDistance: number;
    readonly networkDistanceScope: 'navigation-graph-edges-only';
    readonly endpointSnapTraversal: 'not-proven-walkable';
    readonly navigationObstacleScope:
        'normalized-navigation-graph-without-blueprint-placement-rebake';
}

export type BlueprintProductionEndpointAccessResult =
    | {
        readonly kind: 'rejected';
        readonly routing: Extract<BlueprintProductionRoutingInputsResult, { readonly kind: 'rejected' }>;
        readonly staticClearanceProofStatus: 'not-applicable';
        readonly employeeReachabilityBasis: 'not-applicable';
        readonly placements: readonly [];
    }
    | {
        readonly kind: 'analyzed';
        readonly routing: Extract<BlueprintProductionRoutingInputsResult, { readonly kind: 'analyzed' }>;
        readonly staticClearanceProofStatus: 'exact' | 'incomplete';
        readonly staticClearanceScope:
            'blueprint-placements-and-property-fixed-geometry';
        readonly staticClearanceLimitations: readonly BlueprintAccessLimitation[];
        readonly staticClearanceSufficiency: 'not-evaluated';
        readonly employeeReachabilityBasis: BlueprintProductionEmployeeReachabilityBasis;
        readonly productionTransferConnectivity: 'not-evaluated';
        readonly itemFlowDirection: 'not-evaluated';
        readonly dynamicObstacleClearance: 'not-evaluated';
        readonly placements: readonly BlueprintProductionPlacementEndpointAccess[];
    };

export class BlueprintProductionEndpointAccessAnalyzer {
    readonly #routing: BlueprintProductionRoutingInputsAnalyzer;
    readonly #access: BlueprintAccessAnalyzer;
    readonly #navigation: NavigationNetwork;
    readonly #navigationSampleSpacing: number;
    readonly #navigationAgent: {
        readonly typeId: number;
        readonly name: string;
        readonly employeeTypes: readonly string[];
        readonly radius: number;
        readonly height: number;
        readonly maximumSlope: number;
        readonly stepHeight: number;
    };
    readonly #propertyByCode: ReadonlyMap<
        string,
        BlueprintProductionEndpointAccessDataset['properties'][number]
    >;
    readonly #layoutByCode: ReadonlyMap<
        string,
        BlueprintProductionEndpointAccessDataset['propertyLayouts'][number]
    >;

    constructor(dataset: BlueprintProductionEndpointAccessDataset) {
        this.#routing = new BlueprintProductionRoutingInputsAnalyzer(dataset);
        this.#access = new BlueprintAccessAnalyzer(dataset);
        const navigation = NavigationGraphSchema.assert(dataset.navigation);
        this.#navigation = new NavigationNetwork(navigation);
        this.#navigationSampleSpacing = navigation.sampleSpacing;
        this.#navigationAgent = {
            typeId: navigation.agent.typeId,
            name: navigation.agent.name,
            employeeTypes: [...navigation.agent.employeeTypes],
            radius: navigation.agent.radius,
            height: navigation.agent.height,
            maximumSlope: navigation.agent.maximumSlope,
            stepHeight: navigation.agent.stepHeight,
        };
        this.#propertyByCode = new Map(
            dataset.properties.map((propertyInput) => {
                const property = PropertySchema.assert(propertyInput);
                requireNonNegativeSafeInteger(
                    property.employeeCapacity,
                    `Property ${JSON.stringify(property.code)} employee capacity`
                );
                return [property.code, property];
            })
        );
        this.#layoutByCode = new Map(
            dataset.propertyLayouts.map((layout) => [layout.propertyCode, layout])
        );
    }

    analyze(blueprint: BlueprintDocument): BlueprintProductionEndpointAccessResult {
        const routing = this.#routing.analyze(blueprint);
        if (routing.kind === 'rejected') {
            return {
                kind: 'rejected',
                routing,
                staticClearanceProofStatus: 'not-applicable',
                employeeReachabilityBasis: 'not-applicable',
                placements: [],
            };
        }

        const access = this.#access.analyze(blueprint);
        if (access.kind === 'rejected') {
            throw new Error('Production routing and access analysis disagree on blueprint validity');
        }
        const propertyCode = routing.capacity.temperature.projection.validation.document.propertyCode;
        const property = this.#propertyByCode.get(propertyCode);
        const layout = this.#layoutByCode.get(propertyCode);
        if (property === undefined || layout === undefined) {
            throw new Error('Production routing references unavailable employee-access property data');
        }

        const productionPlacementIds = new Set(
            routing.placements.map(({ placementId }) => placementId)
        );
        const limitations = access.limitations.filter(({ placementId }) =>
            productionPlacementIds.has(placementId)
        );
        const clearanceByPlacement = indexClearance(access.accessPoints);
        const reachabilityBasis = this.#reachabilityBasis(
            propertyCode,
            property.employeeCapacity,
            layout.spawnPoint.worldPosition
        );
        const placements = routing.placements.map((placement) => ({
            placementId: placement.placementId,
            itemId: placement.itemId,
            transitAccessPoints: placement.transitAccessPoints.map((point) => ({
                ...point,
                staticClearance: requireClearance(clearanceByPlacement, placement.placementId, point),
                employeeReachability: this.#reachability(
                    property.employeeCapacity,
                    reachabilityBasis,
                    point.transform.worldPosition
                ),
            })),
        }));

        return {
            kind: 'analyzed',
            routing,
            staticClearanceProofStatus: limitations.length === 0 ? 'exact' : 'incomplete',
            staticClearanceScope: 'blueprint-placements-and-property-fixed-geometry',
            staticClearanceLimitations: limitations,
            staticClearanceSufficiency: 'not-evaluated',
            employeeReachabilityBasis: reachabilityBasis,
            productionTransferConnectivity: 'not-evaluated',
            itemFlowDirection: 'not-evaluated',
            dynamicObstacleClearance: 'not-evaluated',
            placements,
        };
    }

    #reachabilityBasis(
        propertyCode: string,
        propertyEmployeeCapacity: number,
        origin: Vector3
    ): BlueprintProductionEmployeeReachabilityBasis {
        const maximumSnapDistance = this.#navigationSampleSpacing;
        return {
            kind: 'property-spawn-to-production-transit-point',
            propertyCode,
            propertyEmployeeCapacity,
            origin: copyPosition(origin),
            navigationAgentTypeId: this.#navigationAgent.typeId,
            navigationAgentName: this.#navigationAgent.name,
            navigationEmployeeTypes: [...this.#navigationAgent.employeeTypes],
            navigationAgentRadius: this.#navigationAgent.radius,
            navigationAgentHeight: this.#navigationAgent.height,
            navigationAgentMaximumSlope: this.#navigationAgent.maximumSlope,
            navigationAgentStepHeight: this.#navigationAgent.stepHeight,
            maximumStartSnapDistance: maximumSnapDistance,
            maximumEndpointSnapDistance: maximumSnapDistance,
            networkDistanceScope: 'navigation-graph-edges-only',
            endpointSnapTraversal: 'not-proven-walkable',
            navigationObstacleScope:
                'normalized-navigation-graph-without-blueprint-placement-rebake',
        };
    }

    #reachability(
        propertyEmployeeCapacity: number,
        basis: BlueprintProductionEmployeeReachabilityBasis,
        endpoint: Vector3
    ): BlueprintProductionEmployeeReachability {
        if (propertyEmployeeCapacity <= 0) {
            return {
                kind: 'not-applicable',
                reason: 'property-has-no-employee-capacity',
            };
        }
        const path = this.#navigation.findPathToNearestReachable({
            start: basis.origin,
            end: endpoint,
            maximumStartSnapDistance: basis.maximumStartSnapDistance,
            maximumEndSnapDistance: basis.maximumEndpointSnapDistance,
        });
        return path.kind === 'found'
            ? { kind: 'reachable', path }
            : { kind: 'unreachable', path };
    }
}

function indexClearance(
    accessPoints: readonly BlueprintAccessPointClearance[]
): ReadonlyMap<string, ReadonlyMap<number, BlueprintAccessPointClearance>> {
    const result = new Map<string, Map<number, BlueprintAccessPointClearance>>();
    for (const accessPoint of accessPoints) {
        let byIndex = result.get(accessPoint.placementId);
        if (byIndex === undefined) {
            byIndex = new Map();
            result.set(accessPoint.placementId, byIndex);
        }
        if (byIndex.has(accessPoint.accessPointIndex)) {
            throw new Error('Blueprint access analysis contains a duplicate transit access point');
        }
        byIndex.set(accessPoint.accessPointIndex, accessPoint);
    }
    return result;
}

function requireClearance(
    clearanceByPlacement: ReadonlyMap<
        string,
        ReadonlyMap<number, BlueprintAccessPointClearance>
    >,
    placementId: string,
    point: BlueprintProductionTransitRoutingPoint
): BlueprintAccessPointClearance {
    const clearance = clearanceByPlacement.get(placementId)?.get(point.accessPointIndex);
    if (clearance === undefined) {
        throw new Error('Production transit point has no static-clearance evidence');
    }
    if (
        clearance.path !== point.transform.path ||
        !samePosition(clearance.worldPosition, point.transform.worldPosition)
    ) {
        throw new Error('Production routing and access analysis disagree on a transit point');
    }
    return clearance;
}

function samePosition(left: Vector3, right: Vector3): boolean {
    return left.x === right.x && left.y === right.y && left.z === right.z;
}

function copyPosition(position: Vector3): Vector3 {
    return { x: position.x, y: position.y, z: position.z };
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${label} must be a non-negative safe integer`);
    }
}
