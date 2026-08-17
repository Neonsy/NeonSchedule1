import type {
    BlueprintDocument,
    BlueprintEmployeeAssignment,
    BlueprintHandlerRoute,
} from '#core/data/blueprint';
import type { Item } from '#core/data/item';
import type { Vector3 } from '#core/data/common';
import type { ColliderShape } from '#core/data/geometry';
import type {
    ProductionLogisticsCatalog,
    ProductionLogisticsEmployeeMovement,
    ProductionLogisticsEmployeeRole,
    ProductionLogisticsEmployeeScheduling,
    ProductionLogisticsRouteRules,
} from '#core/data/production-logistics';
import type { BlueprintProductionEndpointAccessDataset } from '#core/blueprint/production-endpoint-access';
import type {
    BlueprintProductionNetworkRouteCandidate,
    BlueprintProductionTransferAssignmentPair,
    BlueprintProductionTransferRouteUnavailableReason,
    BlueprintProductionTransferResult,
} from '#core/blueprint/production-transfers';

export interface BlueprintProductionLogisticsDataset
    extends BlueprintProductionEndpointAccessDataset {
    readonly items: readonly Item[];
    readonly productionLogistics: ProductionLogisticsCatalog;
}

export type BlueprintProductionLogisticsIssueCode =
    | 'property-employee-capacity-exceeded'
    | 'employee-role-unavailable'
    | 'assignment-limit-exceeded'
    | 'station-assigned-more-than-once'
    | 'assigned-placement-unavailable'
    | 'assigned-station-topology-unavailable'
    | 'supply-placement-unavailable'
    | 'supply-storage-unavailable'
    | 'handler-route-limit-exceeded'
    | 'route-source-unavailable'
    | 'route-destination-unavailable'
    | 'route-source-not-transit-entity'
    | 'route-destination-not-transit-entity'
    | 'route-filter-item-unavailable'
    | 'supply-item-unavailable'
    | 'supply-item-not-storable'
    | 'supply-source-unavailable'
    | 'supply-source-storage-unavailable'
    | 'supply-storage-capacity-exceeded'
    | 'supply-storage-slots-exceeded';

export interface BlueprintProductionLogisticsIssue {
    readonly code: BlueprintProductionLogisticsIssueCode;
    readonly message: string;
    readonly employeeId: string | null;
    readonly placementIds: readonly string[];
    readonly routeId: string | null;
    readonly itemId: string | null;
}

export interface BlueprintProductionStationMovement {
    readonly employeeId: string;
    readonly employeeType: BlueprintEmployeeAssignment['employeeType'];
    readonly placementId: string;
    readonly movementKind: 'station-specific' | 'assigned-station-supply';
    readonly configuredHandlerRoute: false;
}

export interface BlueprintProductionSupplyAssignment {
    readonly employeeId: string;
    readonly placementId: string;
    readonly storageSlotCount: number | null;
    readonly capacityBasis: 'storage-slots-times-item-stack-limit';
    readonly currentContents: 'not-evaluated';
}

export interface BlueprintProductionInputSupply {
    readonly supplyId: string;
    readonly itemId: string;
    readonly sourcePlacementId: string;
    readonly quantity: number;
    readonly storageSlotCount: number | null;
    readonly requiredStorageSlots: number | null;
    readonly emptyStorageCapacity: number | null;
    readonly currentSlotContents: 'not-evaluated';
}

export interface BlueprintProductionConfiguredRoute {
    readonly employeeId: string;
    readonly routeId: string;
    readonly storedOrderIndex: number;
    readonly sourcePlacementId: string;
    readonly destinationPlacementId: string;
    readonly filterMode: BlueprintHandlerRoute['filter']['mode'];
    readonly filterItemIds: readonly string[];
    readonly selection: 'stored-order-first-ready';
    readonly accessPointSelection: 'npc-reachable';
}

export interface BlueprintProductionEmployeeLogistics {
    readonly employeeId: string;
    readonly employeeType: BlueprintEmployeeAssignment['employeeType'];
    readonly dailyWage: number | null;
    readonly baseWorkSpeed: number | null;
    readonly walkSpeed: number | null;
    readonly inventorySlotCount: number | null;
    readonly assignmentKind: ProductionLogisticsEmployeeRole['assignmentKind'] | null;
    readonly assignmentLimit: number | null;
    readonly configuredRouteLimit: number | null;
    readonly stationCompatibility: 'not-evaluated' | 'not-applicable';
    readonly stationMovements: readonly BlueprintProductionStationMovement[];
    readonly supply: BlueprintProductionSupplyAssignment | null;
    readonly configuredRoutes: readonly BlueprintProductionConfiguredRoute[];
}

export interface BlueprintProductionLogisticsConfiguration {
    readonly valid: boolean;
    readonly propertyEmployeeCapacity: number | null;
    readonly employeeCount: number;
    readonly stationAssignmentOwnership: 'exclusive';
    readonly routeSelection: 'stored-order-first-ready';
    readonly stationMovementScope: 'employee-specific-not-configured-handler-routes';
    readonly employees: readonly BlueprintProductionEmployeeLogistics[];
    readonly inputSupplies: readonly BlueprintProductionInputSupply[];
    readonly issues: readonly BlueprintProductionLogisticsIssue[];
}

export interface BlueprintProductionTransferCapacity {
    readonly itemId: string;
    readonly itemStackLimit: number;
    readonly sourceAvailableQuantity: number;
    readonly requestedDestinationQuantity: number;
    readonly employeeInventoryCapacity: number;
    readonly destinationEmptyCapacity: number | null;
    readonly destinationCapacityStatus: 'calculated' | 'filter-evidence-unavailable';
    readonly destinationCapacityBasis:
        'normalized-station-input-slots' |
        'normalized-storage-slots' |
        'unavailable';
    readonly destinationCompatibleInputSlotIndexes: readonly number[] | null;
    readonly maximumMovedQuantityPerTrip: number | null;
    readonly movedQuantityLimits: ProductionLogisticsRouteRules['movedQuantityLimits'];
    readonly currentSlotContents: 'not-evaluated';
}

export interface BlueprintProductionConfiguredRouteCandidate {
    readonly employeeId: string;
    readonly routeId: string;
    readonly storedOrderIndex: number;
    readonly networkRouteCandidateStatus: BlueprintProductionTransferAssignmentPair['networkRouteCandidateStatus'];
    readonly unavailableReasons: readonly BlueprintProductionTransferRouteUnavailableReason[];
    readonly networkRouteCandidates: readonly BlueprintProductionNetworkRouteCandidate[];
    readonly capacity: BlueprintProductionTransferCapacity;
}

export interface BlueprintProductionLogisticsRequirementPair {
    readonly sourcePlacementId: string;
    readonly sourceAvailableQuantity: number;
    readonly destinationPlacementId: string;
    readonly destinationRequiredQuantity: number;
    readonly configuredRouteCoverage: 'configured' | 'unconfigured';
    readonly configuredRouteCandidates: readonly BlueprintProductionConfiguredRouteCandidate[];
}

export interface BlueprintProductionLogisticsRequirement {
    readonly itemId: string;
    readonly producerStepIndex: number;
    readonly consumerStepIndex: number;
    readonly requiredQuantity: number;
    readonly assignmentPairs: readonly BlueprintProductionLogisticsRequirementPair[];
}

export interface BlueprintProductionInputDestinationAssignment {
    readonly consumerStepIndex: number;
    readonly placementId: string;
    readonly batchCount: number;
    readonly requiredQuantity: number;
}

export type BlueprintProductionInputMovementCandidate =
    | {
        readonly kind: 'configured-handler-route';
        readonly employeeId: string;
        readonly routeId: string;
        readonly storedOrderIndex: number;
        readonly networkRouteCandidateStatus: 'available' | 'unavailable';
        readonly unavailableReasons: readonly BlueprintProductionTransferRouteUnavailableReason[];
        readonly networkRouteCandidates: readonly BlueprintProductionNetworkRouteCandidate[];
        readonly capacity: BlueprintProductionTransferCapacity;
    }
    | {
        readonly kind: 'botanist-station-specific';
        readonly employeeId: string;
        readonly networkRouteCandidateStatus: 'available' | 'unavailable';
        readonly unavailableReasons: readonly BlueprintProductionTransferRouteUnavailableReason[];
        readonly networkRouteCandidates: readonly BlueprintProductionNetworkRouteCandidate[];
        readonly capacity: BlueprintProductionTransferCapacity;
    };

export interface BlueprintProductionInputSupplyPair {
    readonly supplyId: string;
    readonly sourcePlacementId: string;
    readonly sourceQuantity: number;
    readonly consumerStepIndex: number;
    readonly destinationPlacementId: string;
    readonly destinationRequiredQuantity: number;
    readonly movementCoverage: 'configured' | 'unconfigured';
    readonly movementCandidates: readonly BlueprintProductionInputMovementCandidate[];
}

export interface BlueprintProductionPurchasedInputRequirement {
    readonly itemId: string;
    readonly requiredQuantity: number;
    readonly purchaseQuantity: number;
    readonly plannedSupplyQuantity: number;
    readonly supplyQuantityCoverage: 'sufficient' | 'insufficient';
    readonly destinationAssignments: readonly BlueprintProductionInputDestinationAssignment[];
    readonly supplyPairs: readonly BlueprintProductionInputSupplyPair[];
}

export type BlueprintProductionMovementScope =
    | 'internally-produced-plan-dependency'
    | 'planned-purchased-input';

export type BlueprintProductionUnallocatedMovementReason =
    | 'configured-movement-unavailable'
    | 'network-route-unavailable'
    | 'destination-capacity-evidence-unavailable'
    | 'destination-empty-capacity-insufficient'
    | 'employee-inventory-capacity-unavailable'
    | 'selected-allocation-order-exhausted-source-quantity';

export interface BlueprintProductionSelectedNetworkRoute {
    readonly selectionBasis: 'minimum-network-distance-then-access-point-order';
    readonly sourceAccessPointIndex: number;
    readonly sourceNetworkSampleIndex: number;
    readonly destinationAccessPointIndex: number;
    readonly destinationNetworkSampleIndex: number;
    readonly networkDistance: number;
    readonly distanceScope: 'navigation-graph-edges-only';
    readonly employeeWalkSpeed: number | null;
    readonly traversalTimeStatus: 'calculated' | 'walk-speed-unavailable';
    readonly networkTraversalSecondsPerTrip: number | null;
}

export interface BlueprintProductionMovementAllocation {
    readonly scope: BlueprintProductionMovementScope;
    readonly itemId: string;
    readonly producerStepIndex: number | null;
    readonly consumerStepIndex: number;
    readonly supplyId: string | null;
    readonly sourcePlacementId: string;
    readonly destinationPlacementId: string;
    readonly employeeId: string;
    readonly movementKind: 'configured-handler-route' | 'botanist-station-specific';
    readonly routeId: string | null;
    readonly storedOrderIndex: number | null;
    readonly allocatedQuantity: number;
    readonly maximumMovedQuantityPerTrip: number;
    readonly minimumTripCount: number;
    readonly selectedNetworkRoute: BlueprintProductionSelectedNetworkRoute;
    readonly minimumSelectedNetworkTraversalSeconds: number | null;
}

export interface BlueprintProductionUnallocatedMovementRequirement {
    readonly scope: BlueprintProductionMovementScope;
    readonly itemId: string;
    readonly producerStepIndex: number | null;
    readonly consumerStepIndex: number;
    readonly destinationPlacementId: string;
    readonly requiredQuantity: number;
    readonly allocatedQuantity: number;
    readonly unallocatedQuantity: number;
    readonly reasons: readonly BlueprintProductionUnallocatedMovementReason[];
}

export interface BlueprintProductionMovementPlan {
    readonly status: 'complete' | 'partial' | 'unavailable';
    readonly quantityAllocation:
        'deterministic-static-under-empty-destination-capacity';
    readonly destinationCapacityScope:
        'per-consumer-step-destination-compatible-input-slot-reservations';
    readonly destinationSlotReservation:
        'consumer-step-destination-least-flexible-item-first';
    readonly currentSourceAndDestinationContents: 'not-evaluated';
    readonly movementSelection:
        'blueprint-employee-order-then-handler-stored-order-then-source-order';
    readonly allocationOptimality:
        'not-optimized-preserves-production-and-configured-route-priority';
    readonly networkRouteSelection:
        'minimum-network-distance-then-access-point-order';
    readonly selectedNetworkTraversalTiming:
        'complete' | 'partial-walk-speed-unavailable' | 'not-applicable';
    readonly timingScope:
        'selected-source-to-destination-network-edges-at-per-item-maximum-load';
    readonly aggregateTraversalTiming:
        'not-composed-cross-item-trip-sharing-return-legs-task-order-and-concurrency';
    readonly endpointSnapTraversal: 'not-included-not-proven-walkable';
    readonly staticClearanceSufficiency: 'not-evaluated';
    readonly dynamicObstacleClearance: 'not-evaluated';
    readonly allocations: readonly BlueprintProductionMovementAllocation[];
    readonly unallocatedRequirements:
        readonly BlueprintProductionUnallocatedMovementRequirement[];
}

export type BlueprintProductionPhysicalObstacle =
    | {
        readonly kind: 'placement';
        readonly placementId: string;
        readonly index: number;
        readonly path: string;
        readonly shape: ColliderShape;
    }
    | {
        readonly kind: 'property-fixed';
        readonly index: number;
        readonly path: string;
        readonly shape: ColliderShape;
    };

export type BlueprintProductionPhysicalSegmentLimitation =
    | {
        readonly code: 'employee-body-overlap';
        readonly obstacle: BlueprintProductionPhysicalObstacle;
    }
    | {
        readonly code: 'conservative-body-envelope-overlap';
        readonly obstacle: BlueprintProductionPhysicalObstacle;
    }
    | {
        readonly code: 'collider-activity-unavailable';
        readonly obstacle: BlueprintProductionPhysicalObstacle;
    }
    | {
        readonly code: 'unsupported-obstacle-geometry';
        readonly obstacle: BlueprintProductionPhysicalObstacle;
    };

export interface BlueprintProductionPhysicalSegmentFeasibility {
    readonly kind:
        | 'source-endpoint-snap'
        | 'selected-network-edge'
        | 'destination-endpoint-snap';
    readonly segmentIndex: number | null;
    readonly start: Vector3;
    readonly end: Vector3;
    readonly horizontalDistance: number;
    readonly verticalDistance: number;
    readonly localMovementLimits: 'traversable' | 'exceeded';
    readonly staticGeometry: 'clear' | 'incomplete' | 'blocked';
    readonly status: 'clear' | 'incomplete' | 'blocked';
    readonly limitations: readonly BlueprintProductionPhysicalSegmentLimitation[];
}

export interface BlueprintProductionMovementAllocationFeasibility {
    readonly allocationIndex: number;
    readonly itemId: string;
    readonly sourcePlacementId: string;
    readonly destinationPlacementId: string;
    readonly status: 'clear' | 'incomplete' | 'blocked';
    readonly sourceEndpointSnap: BlueprintProductionPhysicalSegmentFeasibility;
    readonly selectedNetworkEdges: readonly BlueprintProductionPhysicalSegmentFeasibility[];
    readonly destinationEndpointSnap: BlueprintProductionPhysicalSegmentFeasibility;
}

export interface BlueprintProductionMovementPhysicalFeasibility {
    readonly status: 'clear' | 'incomplete' | 'blocked' | 'not-applicable';
    readonly employeeBodyBasis: {
        readonly source: 'normalized-navigation-agent';
        readonly radius: number;
        readonly height: number;
        readonly maximumSlope: number;
        readonly stepHeight: number;
        readonly posture: 'upright';
        readonly collisionEnvelope:
            'swept-upright-cylinder-with-conservative-unsupported-geometry-bounds';
    };
    readonly endpointSnapScope:
        'transit-access-point-to-selected-navigation-sample-against-projected-and-fixed-geometry';
    readonly selectedRouteScope:
        'selected-navigation-graph-edges-rechecked-against-projected-placements';
    readonly placementObstacleBasis:
        'projected-enabled-non-trigger-built-item-colliders';
    readonly unsupportedPlacementGeometryBound:
        'source-world-bounds-then-projected-placement-bound';
    readonly colliderActivityBasis:
        'positive-source-world-bounds-or-incomplete';
    readonly propertyObstacleBasis: 'enabled-non-trigger-fixed-colliders';
    readonly propertyObstacleApplication:
        'endpoint-snaps-only-navigation-graph-already-accounts-for-fixed-geometry';
    readonly clearanceConclusion:
        'clear-when-exact-upright-box-tests-and-conservative-unsupported-geometry-bounds-are-clear';
    readonly navigationRebakeEvidence:
        | 'selected-segments-clear-under-normalized-static-geometry'
        | 'unresolved-for-selected-segments'
        | 'selected-segment-blocked'
        | 'not-applicable-no-selected-network-edges'
        | 'not-applicable-no-selected-movements';
    readonly dynamicObstacleClearance: 'not-evaluated';
    readonly allocations: readonly BlueprintProductionMovementAllocationFeasibility[];
}

export type BlueprintProductionEmployeeServiceTask =
    | 'grow-container-soil'
    | 'sow-seed'
    | 'apply-grow-additive'
    | 'harvest-output-unit'
    | 'apply-mushroom-spawn'
    | 'chemistry-place-ingredients'
    | 'chemistry-stir'
    | 'chemistry-burner'
    | 'cauldron-operation'
    | 'mushroom-spawn-station-operation'
    | 'lab-oven-speed-scaled-operation';

export interface BlueprintProductionEmployeeServiceTaskDuration {
    readonly task: BlueprintProductionEmployeeServiceTask;
    readonly secondsPerBatch: number;
}

interface BlueprintProductionEmployeeServiceAssignmentBase {
    readonly stepIndex: number;
    readonly itemId: string;
    readonly routeId: string;
    readonly placementId: string;
    readonly batchCount: number;
    readonly requiredEmployeeType: BlueprintEmployeeAssignment['employeeType'];
}

export type BlueprintProductionEmployeeServiceAssignment =
    | BlueprintProductionEmployeeServiceAssignmentBase & {
        readonly kind: 'unassigned';
        readonly employeeId: null;
        readonly employeeType: null;
    }
    | BlueprintProductionEmployeeServiceAssignmentBase & {
        readonly kind: 'incompatible-employee';
        readonly employeeId: string;
        readonly employeeType: BlueprintEmployeeAssignment['employeeType'];
    }
    | BlueprintProductionEmployeeServiceAssignmentBase & {
        readonly kind: 'work-speed-unavailable';
        readonly employeeId: string;
        readonly employeeType: BlueprintEmployeeAssignment['employeeType'];
    }
    | BlueprintProductionEmployeeServiceAssignmentBase & {
        readonly kind: 'exact' | 'lower-bound';
        readonly employeeId: string;
        readonly employeeType: BlueprintEmployeeAssignment['employeeType'];
        readonly baseWorkSpeed: number;
        readonly taskDurations: readonly BlueprintProductionEmployeeServiceTaskDuration[];
        readonly omittedTaskKinds: readonly (
            'moisture-action-count' | 'lab-oven-fixed-animation-overhead'
        )[];
        readonly serviceSecondsPerBatch: number;
        readonly totalServiceSeconds: number;
    };

export interface BlueprintProductionEmployeeServiceTotal {
    readonly employeeId: string;
    readonly employeeType: BlueprintEmployeeAssignment['employeeType'];
    readonly kind: 'exact' | 'lower-bound';
    readonly totalServiceSeconds: number;
}

export interface BlueprintProductionEmployeeReachabilityCandidate {
    readonly accessPointIndex: number;
    readonly accessPointPath: string;
    readonly startSnapDistance: number;
    readonly endSnapDistance: number;
    readonly networkDistance: number;
    readonly networkTraversalSeconds: number;
}

export interface BlueprintProductionEmployeeTaskRouteCandidate {
    readonly sourceAccessPointIndex: number;
    readonly sourceAccessPointPath: string;
    readonly destinationAccessPointIndex: number;
    readonly destinationAccessPointPath: string;
    readonly networkDistance: number;
    readonly networkTraversalSeconds: number;
}

interface BlueprintProductionEmployeeTaskRouteAssignmentBase {
    readonly routeKind:
        'move-item-source-to-destination' |
        'supplies-to-grow-container-if-supplies-visited';
    readonly condition:
        'if-native-move-item-task-selected' |
        'if-required-item-missing-from-inventory-and-present-in-assigned-supplies';
    readonly itemId: string;
    readonly sourceStepIndex: number | null;
    readonly destinationStepIndex: number;
    readonly sourcePlacementId: string | null;
    readonly destinationPlacementId: string;
    readonly requiredEmployeeType: BlueprintEmployeeAssignment['employeeType'];
}

export type BlueprintProductionEmployeeTaskRouteAssignment =
    | BlueprintProductionEmployeeTaskRouteAssignmentBase & {
        readonly kind: 'source-or-employee-unassigned';
        readonly employeeId: string | null;
        readonly employeeType: BlueprintEmployeeAssignment['employeeType'] | null;
    }
    | BlueprintProductionEmployeeTaskRouteAssignmentBase & {
        readonly kind: 'incompatible-employee';
        readonly employeeId: string;
        readonly employeeType: BlueprintEmployeeAssignment['employeeType'];
    }
    | BlueprintProductionEmployeeTaskRouteAssignmentBase & {
        readonly kind: 'walk-speed-unavailable';
        readonly employeeId: string;
        readonly employeeType: BlueprintEmployeeAssignment['employeeType'];
    }
    | BlueprintProductionEmployeeTaskRouteAssignmentBase & {
        readonly kind: 'route-endpoints-unavailable';
        readonly employeeId: string;
        readonly employeeType: BlueprintEmployeeAssignment['employeeType'];
        readonly walkSpeed: number;
        readonly unavailableReasons: readonly (
            'source-has-no-network-reachable-transit-point' |
            'destination-has-no-network-reachable-transit-point'
        )[];
    }
    | BlueprintProductionEmployeeTaskRouteAssignmentBase & {
        readonly kind: 'candidates';
        readonly employeeId: string;
        readonly employeeType: BlueprintEmployeeAssignment['employeeType'];
        readonly walkSpeed: number;
        readonly candidates: readonly BlueprintProductionEmployeeTaskRouteCandidate[];
    };

interface BlueprintProductionEmployeeReachabilityAssignmentBase {
    readonly stepIndex: number;
    readonly itemId: string;
    readonly routeId: string;
    readonly placementId: string;
    readonly requiredEmployeeType: BlueprintEmployeeAssignment['employeeType'];
}

export type BlueprintProductionEmployeeReachabilityAssignment =
    | BlueprintProductionEmployeeReachabilityAssignmentBase & {
        readonly kind: 'unassigned';
        readonly employeeId: null;
        readonly employeeType: null;
    }
    | BlueprintProductionEmployeeReachabilityAssignmentBase & {
        readonly kind: 'incompatible-employee';
        readonly employeeId: string;
        readonly employeeType: BlueprintEmployeeAssignment['employeeType'];
    }
    | BlueprintProductionEmployeeReachabilityAssignmentBase & {
        readonly kind: 'walk-speed-unavailable';
        readonly employeeId: string;
        readonly employeeType: BlueprintEmployeeAssignment['employeeType'];
    }
    | BlueprintProductionEmployeeReachabilityAssignmentBase & {
        readonly kind: 'no-network-reachable-transit-point';
        readonly employeeId: string;
        readonly employeeType: BlueprintEmployeeAssignment['employeeType'];
        readonly walkSpeed: number;
    }
    | BlueprintProductionEmployeeReachabilityAssignmentBase & {
        readonly kind: 'candidates';
        readonly employeeId: string;
        readonly employeeType: BlueprintEmployeeAssignment['employeeType'];
        readonly walkSpeed: number;
        readonly candidates: readonly BlueprintProductionEmployeeReachabilityCandidate[];
    };

export interface BlueprintProductionEmployeeExecution {
    readonly timingScope:
        'assigned-production-placement-service-and-property-spawn-network-reachability-candidates';
    readonly workSpeedBasis: 'normalized-employee-role-base-work-speed';
    readonly reachabilityTiming: {
        readonly origin: 'property-spawn';
        readonly destination: 'assigned-placement-transit-points';
        readonly pathSelection: 'all-network-reachable-candidates-unselected';
        readonly distanceScope: 'navigation-graph-edges-only';
        readonly endpointSnapTraversal: 'not-included-not-proven-walkable';
        readonly purpose: 'endpoint-reachability-baseline-not-native-task-travel';
    };
    readonly taskTravelTiming: {
        readonly status:
            'partial-static-internal-route-candidates' |
            'unavailable-movement-contract-not-recorded';
        readonly evaluatedLegs: readonly (
            'move-item-source-to-destination' |
            'supplies-to-grow-container-if-supplies-visited'
        )[];
        readonly pathSelection: 'all-network-reachable-candidates-unselected';
        readonly distanceScope: 'navigation-graph-edges-only';
        readonly endpointSnapTraversal: 'not-included-not-proven-walkable';
        readonly dynamicInitialLeg: 'not-evaluated-current-position-to-first-endpoint';
        readonly routeFrequency: 'not-evaluated-dynamic-task-selection-and-readiness';
        readonly movement: ProductionLogisticsEmployeeMovement | null;
        readonly assignments: readonly BlueprintProductionEmployeeTaskRouteAssignment[];
    };
    readonly taskReadinessTiming: 'not-evaluated-runtime-state-not-recorded';
    readonly scheduling: ProductionLogisticsEmployeeScheduling | null;
    readonly runtimeWorkSpeed: 'not-evaluated';
    readonly elapsedScheduleComposition:
        'not-applied-dynamic-task-sequence-readiness-runtime-speed-and-concurrency';
    readonly assignments: readonly BlueprintProductionEmployeeServiceAssignment[];
    readonly reachabilityAssignments:
        readonly BlueprintProductionEmployeeReachabilityAssignment[];
    readonly employeeTotals: readonly BlueprintProductionEmployeeServiceTotal[];
}

export type BlueprintProductionLogisticsResult =
    | {
        readonly kind: 'rejected';
        readonly transfers: Extract<BlueprintProductionTransferResult, { readonly kind: 'rejected' }>;
        readonly configuration: null;
        readonly requirements: readonly [];
    }
    | {
        readonly kind: 'invalid-configuration';
        readonly transfers: Exclude<BlueprintProductionTransferResult, { readonly kind: 'rejected' }>;
        readonly configuration: BlueprintProductionLogisticsConfiguration;
        readonly requirements: readonly [];
    }
    | {
        readonly kind: 'unavailable';
        readonly transfers: Extract<BlueprintProductionTransferResult, { readonly kind: 'unavailable' }>;
        readonly configuration: BlueprintProductionLogisticsConfiguration;
        readonly requirements: readonly [];
    }
    | {
        readonly kind: 'analyzed';
        readonly transfers: Extract<BlueprintProductionTransferResult, { readonly kind: 'analyzed' }>;
        readonly configuration: BlueprintProductionLogisticsConfiguration;
        readonly productionRequirementScope: 'internally-produced-plan-dependencies';
        readonly purchasedInputSupplyScope: 'first-production-consumers';
        readonly routeQuantityAllocation: 'evaluated-static-empty-destination-capacity';
        readonly transferTiming: 'selected-network-traversals-only';
        readonly movementPlan: BlueprintProductionMovementPlan;
        readonly movementPhysicalFeasibility: BlueprintProductionMovementPhysicalFeasibility;
        readonly employeeExecution: BlueprintProductionEmployeeExecution;
        readonly requirements: readonly BlueprintProductionLogisticsRequirement[];
        readonly purchasedInputRequirements: readonly BlueprintProductionPurchasedInputRequirement[];
    };

export type BlueprintProductionPlacementById = ReadonlyMap<
    string,
    BlueprintDocument['placements'][number]
>;
