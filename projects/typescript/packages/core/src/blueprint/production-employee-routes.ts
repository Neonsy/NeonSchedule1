import type {
    BlueprintDocument,
    BlueprintEmployeeAssignment,
} from '#core/data/blueprint';
import type { ProductionLogisticsCatalog } from '#core/data/production-logistics';
import type { NavigationGraph } from '#core/data/world';
import type { ProductionBatchPlan, ProductionBatchStep } from '#core/production/plan';
import { NavigationNetwork } from '#core/world/navigation';
import type {
    BlueprintProductionPlacementEndpointAccess,
    BlueprintProductionTransitEndpointAccess,
} from '#core/blueprint/production-endpoint-access';
import type {
    BlueprintProductionNetworkRouteCandidate,
    BlueprintProductionTransferResult,
} from '#core/blueprint/production-transfers';
import type {
    BlueprintProductionEmployeeTaskRouteAssignment,
    BlueprintProductionEmployeeTaskRouteCandidate,
} from '#core/blueprint/production-logistics-types';

export interface BlueprintProductionEmployeeOwner {
    readonly employee: BlueprintEmployeeAssignment;
    readonly baseWorkSpeed: number | null;
    readonly walkSpeed: number | null;
}

export function productionEmployeeOwners(
    blueprint: BlueprintDocument,
    catalog: ProductionLogisticsCatalog
): ReadonlyMap<string, BlueprintProductionEmployeeOwner> {
    const roleByType = new Map(catalog.employeeRoles.map((role) => [role.employeeType, role]));
    const owners = new Map<string, BlueprintProductionEmployeeOwner>();
    for (const employee of blueprint.productionLogistics.employees) {
        const role = roleByType.get(employee.employeeType);
        const placementIds = employee.employeeType === 'Botanist'
            ? employee.assignedPotPlacementIds
            : employee.employeeType === 'Cleaner'
                ? []
                : employee.assignedStationPlacementIds;
        for (const placementId of placementIds) {
            owners.set(placementId, {
                employee,
                baseWorkSpeed: role?.baseWorkSpeed ?? null,
                walkSpeed: role?.walkSpeed ?? null,
            });
        }
    }
    return owners;
}

export function analyzeProductionEmployeeTaskRoutes(
    blueprint: BlueprintDocument,
    plan: ProductionBatchPlan,
    catalog: ProductionLogisticsCatalog,
    transfers: Extract<BlueprintProductionTransferResult, { readonly kind: 'analyzed' }>,
    navigationGraph: NavigationGraph
): readonly BlueprintProductionEmployeeTaskRouteAssignment[] {
    if (catalog.employeeScheduling?.movement === null ||
        catalog.employeeScheduling?.movement === undefined) return [];
    const ownerByPlacementId = productionEmployeeOwners(blueprint, catalog);
    const accessByPlacementId = new Map(
        transfers.endpointAccess.placements.map((placement) => [placement.placementId, placement])
    );
    return [
        ...moveItemRouteAssignments(plan, transfers, ownerByPlacementId, accessByPlacementId),
        ...growContainerRouteAssignments(
            plan,
            transfers,
            ownerByPlacementId,
            accessByPlacementId,
            new NavigationNetwork(navigationGraph)
        ),
    ];
}

function moveItemRouteAssignments(
    plan: ProductionBatchPlan,
    transfers: Extract<BlueprintProductionTransferResult, { readonly kind: 'analyzed' }>,
    ownerByPlacementId: ReadonlyMap<string, BlueprintProductionEmployeeOwner>,
    accessByPlacementId: ReadonlyMap<string, BlueprintProductionPlacementEndpointAccess>
): BlueprintProductionEmployeeTaskRouteAssignment[] {
    return transfers.requirements.flatMap((requirement) => {
        const producer = plan.productionSteps[requirement.producerStepIndex];
        if (producer === undefined) {
            throw new Error(`Production transfer references unavailable step ${requirement.producerStepIndex}`);
        }
        const requiredEmployeeType = outputMoveEmployeeType(producer);
        if (requiredEmployeeType === null) return [];
        return requirement.assignmentPairs.map((pair) => taskRouteAssignment(
            {
                routeKind: 'move-item-source-to-destination',
                condition: 'if-native-move-item-task-selected',
                itemId: requirement.itemId,
                sourceStepIndex: requirement.producerStepIndex,
                destinationStepIndex: requirement.consumerStepIndex,
                sourcePlacementId: pair.sourcePlacementId,
                destinationPlacementId: pair.destinationPlacementId,
                requiredEmployeeType,
            },
            ownerByPlacementId.get(pair.sourcePlacementId),
            pair.unavailableReasons,
            pair.networkRouteCandidates.map((candidate) => transferTaskRouteCandidate(
                candidate,
                accessByPlacementId
            ))
        ));
    });
}

function growContainerRouteAssignments(
    plan: ProductionBatchPlan,
    transfers: Extract<BlueprintProductionTransferResult, { readonly kind: 'analyzed' }>,
    ownerByPlacementId: ReadonlyMap<string, BlueprintProductionEmployeeOwner>,
    accessByPlacementId: ReadonlyMap<string, BlueprintProductionPlacementEndpointAccess>,
    navigation: NavigationNetwork
): BlueprintProductionEmployeeTaskRouteAssignment[] {
    const stepByIndex = new Map(plan.productionSteps.map((step, stepIndex) => [stepIndex, step]));
    return transfers.schedule.schedule.flatMap((scheduledStep) => {
        const step = stepByIndex.get(scheduledStep.stepIndex);
        if (step === undefined) {
            throw new Error(`Production schedule references unavailable step ${scheduledStep.stepIndex}`);
        }
        if (step.method !== 'seed-harvest' && step.method !== 'shroom-harvest') return [];
        return scheduledStep.assignments.map((assignment) => {
            const owner = ownerByPlacementId.get(assignment.placementId);
            const supplyPlacementId = owner?.employee.employeeType === 'Botanist'
                ? owner.employee.supplyPlacementId
                : null;
            const base = {
                routeKind: 'supplies-to-grow-container-if-supplies-visited' as const,
                condition:
                    'if-required-item-missing-from-inventory-and-present-in-assigned-supplies' as const,
                itemId: step.itemId,
                sourceStepIndex: null,
                destinationStepIndex: scheduledStep.stepIndex,
                sourcePlacementId: supplyPlacementId,
                destinationPlacementId: assignment.placementId,
                requiredEmployeeType: 'Botanist' as const,
            };
            if (owner === undefined || owner.employee.employeeType !== 'Botanist') {
                return taskRouteAssignment(base, owner, [], []);
            }
            if (supplyPlacementId === null) {
                return {
                    ...base,
                    kind: 'source-or-employee-unassigned' as const,
                    employeeId: owner?.employee.id ?? null,
                    employeeType: owner?.employee.employeeType ?? null,
                };
            }
            const routes = findTaskRoutes(
                supplyPlacementId,
                accessByPlacementId.get(supplyPlacementId),
                assignment.placementId,
                accessByPlacementId.get(assignment.placementId),
                navigation
            );
            return taskRouteAssignment(base, owner, routes.unavailableReasons, routes.candidates);
        });
    });
}

interface TaskRouteBase {
    readonly routeKind: BlueprintProductionEmployeeTaskRouteAssignment['routeKind'];
    readonly condition: BlueprintProductionEmployeeTaskRouteAssignment['condition'];
    readonly itemId: string;
    readonly sourceStepIndex: number | null;
    readonly destinationStepIndex: number;
    readonly sourcePlacementId: string | null;
    readonly destinationPlacementId: string;
    readonly requiredEmployeeType: BlueprintEmployeeAssignment['employeeType'];
}

type TaskRouteUnavailableReason = Extract<
    BlueprintProductionEmployeeTaskRouteAssignment,
    { readonly kind: 'route-endpoints-unavailable' }
>['unavailableReasons'][number];

function taskRouteAssignment(
    base: TaskRouteBase,
    owner: BlueprintProductionEmployeeOwner | undefined,
    unavailableReasons: readonly TaskRouteUnavailableReason[],
    candidates: readonly Omit<BlueprintProductionEmployeeTaskRouteCandidate, 'networkTraversalSeconds'>[]
): BlueprintProductionEmployeeTaskRouteAssignment {
    if (owner === undefined) {
        return {
            ...base,
            kind: 'source-or-employee-unassigned',
            employeeId: null,
            employeeType: null,
        };
    }
    if (owner.employee.employeeType !== base.requiredEmployeeType) {
        return {
            ...base,
            kind: 'incompatible-employee',
            employeeId: owner.employee.id,
            employeeType: owner.employee.employeeType,
        };
    }
    const walkSpeed = owner.walkSpeed;
    if (walkSpeed === null || !Number.isFinite(walkSpeed) || walkSpeed <= 0) {
        return {
            ...base,
            kind: 'walk-speed-unavailable',
            employeeId: owner.employee.id,
            employeeType: owner.employee.employeeType,
        };
    }
    if (candidates.length === 0) {
        return {
            ...base,
            kind: 'route-endpoints-unavailable',
            employeeId: owner.employee.id,
            employeeType: owner.employee.employeeType,
            walkSpeed,
            unavailableReasons,
        };
    }
    return {
        ...base,
        kind: 'candidates',
        employeeId: owner.employee.id,
        employeeType: owner.employee.employeeType,
        walkSpeed,
        candidates: candidates.map((candidate) => ({
            ...candidate,
            networkTraversalSeconds: divideFinite(
                candidate.networkDistance,
                walkSpeed,
                'Production task network traversal time'
            ),
        })),
    };
}

function outputMoveEmployeeType(
    step: ProductionBatchStep
): BlueprintEmployeeAssignment['employeeType'] | null {
    switch (step.method) {
        case 'station-recipe':
        case 'oven':
        case 'cauldron':
            return 'Chemist';
        case 'mushroom-spawn':
            return 'Botanist';
        case 'seed-harvest':
        case 'shroom-harvest':
            return null;
    }
}

function transferTaskRouteCandidate(
    candidate: BlueprintProductionNetworkRouteCandidate,
    accessByPlacementId: ReadonlyMap<string, BlueprintProductionPlacementEndpointAccess>
): Omit<BlueprintProductionEmployeeTaskRouteCandidate, 'networkTraversalSeconds'> {
    const source = requireTransitEndpoint(
        accessByPlacementId,
        candidate.sourcePlacementId,
        candidate.sourceAccessPointIndex
    );
    const destination = requireTransitEndpoint(
        accessByPlacementId,
        candidate.destinationPlacementId,
        candidate.destinationAccessPointIndex
    );
    return {
        sourceAccessPointIndex: candidate.sourceAccessPointIndex,
        sourceAccessPointPath: source.transform.path,
        destinationAccessPointIndex: candidate.destinationAccessPointIndex,
        destinationAccessPointPath: destination.transform.path,
        networkDistance: candidate.path.networkDistance,
    };
}

function findTaskRoutes(
    sourcePlacementId: string,
    source: BlueprintProductionPlacementEndpointAccess | undefined,
    destinationPlacementId: string,
    destination: BlueprintProductionPlacementEndpointAccess | undefined,
    navigation: NavigationNetwork
): {
    readonly unavailableReasons: readonly TaskRouteUnavailableReason[];
    readonly candidates: readonly Omit<
        BlueprintProductionEmployeeTaskRouteCandidate,
        'networkTraversalSeconds'
    >[];
} {
    const sources = reachableTransitEndpoints(source?.transitAccessPoints ?? []);
    const destinations = reachableTransitEndpoints(destination?.transitAccessPoints ?? []);
    const unavailableReasons: TaskRouteUnavailableReason[] = [];
    if (sources.length === 0) {
        unavailableReasons.push('source-has-no-network-reachable-transit-point');
    }
    if (destinations.length === 0) {
        unavailableReasons.push('destination-has-no-network-reachable-transit-point');
    }
    return {
        unavailableReasons,
        candidates: sources.flatMap((sourceEndpoint) => destinations.map((destinationEndpoint) => {
            const path = navigation.findPathBetweenSamples({
                startSampleIndex: sourceEndpoint.employeeReachability.path.end.sampleIndex,
                endSampleIndex: destinationEndpoint.employeeReachability.path.end.sampleIndex,
            });
            if (path.kind !== 'found') {
                throw new Error(
                    `Production route ${sourcePlacementId} to ${destinationPlacementId} contains disconnected reachable samples`
                );
            }
            return {
                sourceAccessPointIndex: sourceEndpoint.accessPointIndex,
                sourceAccessPointPath: sourceEndpoint.transform.path,
                destinationAccessPointIndex: destinationEndpoint.accessPointIndex,
                destinationAccessPointPath: destinationEndpoint.transform.path,
                networkDistance: path.networkDistance,
            };
        })),
    };
}

type ReachableTransitEndpoint = BlueprintProductionTransitEndpointAccess & {
    readonly employeeReachability: Extract<
        BlueprintProductionTransitEndpointAccess['employeeReachability'],
        { readonly kind: 'reachable' }
    >;
};

function reachableTransitEndpoints(
    endpoints: readonly BlueprintProductionTransitEndpointAccess[]
): ReachableTransitEndpoint[] {
    return endpoints.filter((endpoint): endpoint is ReachableTransitEndpoint =>
        endpoint.employeeReachability.kind === 'reachable'
    );
}

function requireTransitEndpoint(
    accessByPlacementId: ReadonlyMap<string, BlueprintProductionPlacementEndpointAccess>,
    placementId: string,
    accessPointIndex: number
): BlueprintProductionTransitEndpointAccess {
    const endpoint = accessByPlacementId.get(placementId)?.transitAccessPoints[accessPointIndex];
    if (endpoint === undefined) {
        throw new Error(`Production route references unavailable endpoint ${placementId}[${accessPointIndex}]`);
    }
    return endpoint;
}

function divideFinite(dividend: number, divisor: number, label: string): number {
    const result = dividend / divisor;
    if (!Number.isFinite(result)) throw new RangeError(`${label} must be finite`);
    return result;
}
