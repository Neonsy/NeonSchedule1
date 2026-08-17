import type {
    BlueprintDocument,
    BlueprintEmployeeAssignment,
    BlueprintHandlerRoute,
} from '#core/data/blueprint';
import type { Item } from '#core/data/item';
import type {
    ProductionLogisticsCatalog,
    ProductionLogisticsEmployeeMovement,
    ProductionLogisticsEmployeeRole,
    ProductionLogisticsEmployeeScheduling,
    ProductionLogisticsRouteRules,
} from '#core/data/production-logistics';
import type { BlueprintProductionEndpointAccessDataset } from '#core/blueprint/production-endpoint-access';
import type {
    BlueprintProductionTransferAssignmentPair,
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
    readonly maximumMovedQuantityPerTrip: number | null;
    readonly movedQuantityLimits: ProductionLogisticsRouteRules['movedQuantityLimits'];
    readonly currentSlotContents: 'not-evaluated';
}

export interface BlueprintProductionConfiguredRouteCandidate {
    readonly employeeId: string;
    readonly routeId: string;
    readonly storedOrderIndex: number;
    readonly networkRouteCandidateStatus: BlueprintProductionTransferAssignmentPair['networkRouteCandidateStatus'];
    readonly capacity: BlueprintProductionTransferCapacity;
}

export interface BlueprintProductionLogisticsRequirementPair {
    readonly sourcePlacementId: string;
    readonly destinationPlacementId: string;
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
        readonly networkRouteCandidateStatus: 'not-evaluated';
        readonly capacity: BlueprintProductionTransferCapacity;
    }
    | {
        readonly kind: 'botanist-station-specific';
        readonly employeeId: string;
        readonly networkRouteCandidateStatus: 'not-applicable-same-employee-assignment';
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
        readonly routeQuantityAllocation: 'not-evaluated';
        readonly transferTiming: 'not-evaluated';
        readonly employeeExecution: BlueprintProductionEmployeeExecution;
        readonly requirements: readonly BlueprintProductionLogisticsRequirement[];
        readonly purchasedInputRequirements: readonly BlueprintProductionPurchasedInputRequirement[];
    };

export type BlueprintProductionPlacementById = ReadonlyMap<
    string,
    BlueprintDocument['placements'][number]
>;
