import type {
    BlueprintDocument,
    BlueprintEmployeeAssignment,
} from '#core/data/blueprint';
import type { ProductionLogisticsCatalog } from '#core/data/production-logistics';
import type { ProductionBatchPlan, ProductionBatchStep } from '#core/production/plan';
import type {
    BlueprintProductionEndpointAccessResult,
    BlueprintProductionPlacementEndpointAccess,
} from '#core/blueprint/production-endpoint-access';
import type { BlueprintProductionScheduledStep } from '#core/blueprint/production-schedule';
import type {
    BlueprintProductionEmployeeExecution,
    BlueprintProductionEmployeeServiceAssignment,
    BlueprintProductionEmployeeServiceTaskDuration,
    BlueprintProductionEmployeeServiceTotal,
    BlueprintProductionEmployeeReachabilityAssignment,
    BlueprintProductionEmployeeReachabilityCandidate,
} from '#core/blueprint/production-logistics-types';

interface EmployeeOwner {
    readonly employee: BlueprintEmployeeAssignment;
    readonly baseWorkSpeed: number | null;
    readonly walkSpeed: number | null;
}

interface ScheduledAssignment {
    readonly scheduledStep: BlueprintProductionScheduledStep;
    readonly step: ProductionBatchStep;
    readonly placementId: string;
    readonly batchCount: number;
}

interface ServiceRule {
    readonly kind: 'exact' | 'lower-bound';
    readonly requiredEmployeeType: BlueprintEmployeeAssignment['employeeType'];
    readonly tasks: readonly BlueprintProductionEmployeeServiceTaskDuration[];
    readonly omittedTaskKinds: readonly (
        'moisture-action-count' | 'lab-oven-fixed-animation-overhead'
    )[];
}

export function analyzeProductionEmployeeExecution(
    blueprint: BlueprintDocument,
    plan: ProductionBatchPlan,
    schedule: readonly BlueprintProductionScheduledStep[],
    catalog: ProductionLogisticsCatalog,
    endpointAccess: Extract<BlueprintProductionEndpointAccessResult, { readonly kind: 'analyzed' }>
): BlueprintProductionEmployeeExecution {
    const ownerByPlacementId = employeeOwners(blueprint, catalog);
    const accessByPlacementId = new Map(
        endpointAccess.placements.map((placement) => [placement.placementId, placement])
    );
    const stepByIndex = new Map(plan.productionSteps.map((step, stepIndex) => [stepIndex, step]));
    const scheduledAssignments = schedule.flatMap((scheduledStep): ScheduledAssignment[] => {
        const step = stepByIndex.get(scheduledStep.stepIndex);
        if (step === undefined) {
            throw new Error(`Production schedule references unavailable step ${scheduledStep.stepIndex}`);
        }
        return scheduledStep.assignments.map((assignment) => ({
            scheduledStep,
            step,
            placementId: assignment.placementId,
            batchCount: assignment.batchCount,
        }));
    });
    const assignments = scheduledAssignments.map((assignment) => serviceAssignment(
        assignment.scheduledStep,
        assignment.step,
        assignment.placementId,
        assignment.batchCount,
        ownerByPlacementId.get(assignment.placementId)
    ));
    const reachabilityAssignments = scheduledAssignments.map((assignment) => reachabilityAssignment(
        assignment.scheduledStep,
        assignment.step,
        assignment.placementId,
        ownerByPlacementId.get(assignment.placementId),
        accessByPlacementId.get(assignment.placementId)
    ));
    return {
        timingScope:
            'assigned-production-placement-service-and-property-spawn-network-reachability-candidates',
        workSpeedBasis: 'normalized-employee-role-base-work-speed',
        reachabilityTiming: {
            origin: 'property-spawn',
            destination: 'assigned-placement-transit-points',
            pathSelection: 'all-network-reachable-candidates-unselected',
            distanceScope: 'navigation-graph-edges-only',
            endpointSnapTraversal: 'not-included-not-proven-walkable',
            purpose: 'endpoint-reachability-baseline-not-native-task-travel',
        },
        taskTravelTiming: {
            status: 'not-evaluated-dynamic-current-position-endpoint-selection-and-task-sequence',
            movement: employeeMovement(catalog),
        },
        taskReadinessTiming: 'not-evaluated-runtime-state-not-recorded',
        scheduling: employeeScheduling(catalog),
        runtimeWorkSpeed: 'not-evaluated',
        elapsedScheduleComposition:
            'not-applied-dynamic-task-sequence-readiness-runtime-speed-and-concurrency',
        assignments,
        reachabilityAssignments,
        employeeTotals: employeeTotals(assignments),
    };
}

function employeeScheduling(
    catalog: ProductionLogisticsCatalog
): BlueprintProductionEmployeeExecution['scheduling'] {
    const scheduling = catalog.employeeScheduling;
    if (scheduling === undefined || scheduling === null) return null;
    return {
        ...scheduling,
        workAvailability: { ...scheduling.workAvailability },
        movement: employeeMovement(catalog),
        botanistTaskPriority: [...scheduling.botanistTaskPriority],
        chemistTaskPriority: [...scheduling.chemistTaskPriority],
    };
}

function employeeMovement(
    catalog: ProductionLogisticsCatalog
): BlueprintProductionEmployeeExecution['taskTravelTiming']['movement'] {
    const movement = catalog.employeeScheduling?.movement;
    if (movement === undefined || movement === null) return null;
    return {
        ...movement,
        growContainerTaskKinds: [...movement.growContainerTaskKinds],
        growContainerTaskLegs: [...movement.growContainerTaskLegs],
        stationTaskKinds: [...movement.stationTaskKinds],
        stationTaskLegs: [...movement.stationTaskLegs],
        moveItemTaskKinds: [...movement.moveItemTaskKinds],
        moveItemTaskLegs: [...movement.moveItemTaskLegs],
    };
}

function employeeOwners(
    blueprint: BlueprintDocument,
    catalog: ProductionLogisticsCatalog
): ReadonlyMap<string, EmployeeOwner> {
    const roleByType = new Map(catalog.employeeRoles.map((role) => [role.employeeType, role]));
    const owners = new Map<string, EmployeeOwner>();
    for (const employee of blueprint.productionLogistics.employees) {
        const role = roleByType.get(employee.employeeType);
        const placementIds = employee.employeeType === 'Botanist'
            ? employee.assignedPotPlacementIds
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

function serviceAssignment(
    scheduledStep: BlueprintProductionScheduledStep,
    step: ProductionBatchStep,
    placementId: string,
    batchCount: number,
    owner: EmployeeOwner | undefined
): BlueprintProductionEmployeeServiceAssignment {
    const rule = serviceRule(step);
    const base = {
        stepIndex: scheduledStep.stepIndex,
        itemId: step.itemId,
        routeId: step.routeId,
        placementId,
        batchCount,
        requiredEmployeeType: rule.requiredEmployeeType,
    };
    if (owner === undefined) {
        return { ...base, kind: 'unassigned', employeeId: null, employeeType: null };
    }
    if (owner.employee.employeeType !== rule.requiredEmployeeType) {
        return {
            ...base,
            kind: 'incompatible-employee',
            employeeId: owner.employee.id,
            employeeType: owner.employee.employeeType,
        };
    }
    if (
        owner.baseWorkSpeed === null ||
        !Number.isFinite(owner.baseWorkSpeed) ||
        owner.baseWorkSpeed <= 0
    ) {
        return {
            ...base,
            kind: 'work-speed-unavailable',
            employeeId: owner.employee.id,
            employeeType: owner.employee.employeeType,
        };
    }
    const baseWorkSpeed = owner.baseWorkSpeed;
    const taskDurations = rule.tasks.map((task) => ({
        ...task,
        secondsPerBatch: divideFinite(
            task.secondsPerBatch,
            baseWorkSpeed,
            `${step.routeId} ${task.task} service time`
        ),
    }));
    const serviceSecondsPerBatch = taskDurations.reduce(
        (total, task) => addFinite(total, task.secondsPerBatch, `${step.routeId} service time`),
        0
    );
    return {
        ...base,
        kind: rule.kind,
        employeeId: owner.employee.id,
        employeeType: owner.employee.employeeType,
        baseWorkSpeed,
        taskDurations,
        omittedTaskKinds: rule.omittedTaskKinds,
        serviceSecondsPerBatch,
        totalServiceSeconds: multiplyFinite(
            serviceSecondsPerBatch,
            batchCount,
            `${step.routeId} assigned service time`
        ),
    };
}

function reachabilityAssignment(
    scheduledStep: BlueprintProductionScheduledStep,
    step: ProductionBatchStep,
    placementId: string,
    owner: EmployeeOwner | undefined,
    access: BlueprintProductionPlacementEndpointAccess | undefined
): BlueprintProductionEmployeeReachabilityAssignment {
    const requiredEmployeeType = serviceRule(step).requiredEmployeeType;
    const base = {
        stepIndex: scheduledStep.stepIndex,
        itemId: step.itemId,
        routeId: step.routeId,
        placementId,
        requiredEmployeeType,
    };
    if (owner === undefined) {
        return { ...base, kind: 'unassigned', employeeId: null, employeeType: null };
    }
    if (owner.employee.employeeType !== requiredEmployeeType) {
        return {
            ...base,
            kind: 'incompatible-employee',
            employeeId: owner.employee.id,
            employeeType: owner.employee.employeeType,
        };
    }
    if (owner.walkSpeed === null || !Number.isFinite(owner.walkSpeed) || owner.walkSpeed <= 0) {
        return {
            ...base,
            kind: 'walk-speed-unavailable',
            employeeId: owner.employee.id,
            employeeType: owner.employee.employeeType,
        };
    }
    const walkSpeed = owner.walkSpeed;
    const candidates: BlueprintProductionEmployeeReachabilityCandidate[] =
        access?.transitAccessPoints.flatMap((point) => {
            if (point.employeeReachability.kind !== 'reachable') return [];
            const path = point.employeeReachability.path;
            return [{
                accessPointIndex: point.accessPointIndex,
                accessPointPath: point.transform.path,
                startSnapDistance: path.start.snapDistance,
                endSnapDistance: path.end.snapDistance,
                networkDistance: path.networkDistance,
                networkTraversalSeconds: divideFinite(
                    path.networkDistance,
                    walkSpeed,
                    `${step.routeId} property-spawn network travel time`
                ),
            }];
        }) ?? [];
    if (candidates.length === 0) {
        return {
            ...base,
            kind: 'no-network-reachable-transit-point',
            employeeId: owner.employee.id,
            employeeType: owner.employee.employeeType,
            walkSpeed,
        };
    }
    return {
        ...base,
        kind: 'candidates',
        employeeId: owner.employee.id,
        employeeType: owner.employee.employeeType,
        walkSpeed,
        candidates,
    };
}

function serviceRule(step: ProductionBatchStep): ServiceRule {
    switch (step.method) {
        case 'seed-harvest':
            return {
                kind: 'lower-bound',
                requiredEmployeeType: 'Botanist',
                tasks: [
                    { task: 'grow-container-soil', secondsPerBatch: 10 },
                    { task: 'sow-seed', secondsPerBatch: 15 },
                    ...step.additiveItemIds.map(() => ({
                        task: 'apply-grow-additive' as const,
                        secondsPerBatch: 10,
                    })),
                    { task: 'harvest-output-unit', secondsPerBatch: step.outputQuantityPerBatch },
                ],
                omittedTaskKinds: ['moisture-action-count'],
            };
        case 'shroom-harvest':
            return {
                kind: 'lower-bound',
                requiredEmployeeType: 'Botanist',
                tasks: [
                    { task: 'grow-container-soil', secondsPerBatch: 10 },
                    { task: 'apply-mushroom-spawn', secondsPerBatch: 15 },
                    { task: 'harvest-output-unit', secondsPerBatch: step.outputQuantityPerBatch },
                ],
                omittedTaskKinds: ['moisture-action-count'],
            };
        case 'station-recipe':
            return {
                kind: 'exact',
                requiredEmployeeType: 'Chemist',
                tasks: [
                    { task: 'chemistry-place-ingredients', secondsPerBatch: 8 },
                    { task: 'chemistry-stir', secondsPerBatch: 6 },
                    { task: 'chemistry-burner', secondsPerBatch: 6 },
                ],
                omittedTaskKinds: [],
            };
        case 'oven':
            return {
                kind: 'lower-bound',
                requiredEmployeeType: 'Chemist',
                tasks: [{ task: 'lab-oven-speed-scaled-operation', secondsPerBatch: 15 }],
                omittedTaskKinds: ['lab-oven-fixed-animation-overhead'],
            };
        case 'cauldron':
            return {
                kind: 'exact',
                requiredEmployeeType: 'Chemist',
                tasks: [{ task: 'cauldron-operation', secondsPerBatch: 15 }],
                omittedTaskKinds: [],
            };
        case 'mushroom-spawn':
            return {
                kind: 'exact',
                requiredEmployeeType: 'Botanist',
                tasks: [{ task: 'mushroom-spawn-station-operation', secondsPerBatch: 6 }],
                omittedTaskKinds: [],
            };
    }
}

function employeeTotals(
    assignments: readonly BlueprintProductionEmployeeServiceAssignment[]
): BlueprintProductionEmployeeServiceTotal[] {
    const totals = new Map<string, BlueprintProductionEmployeeServiceTotal>();
    for (const assignment of assignments) {
        if (assignment.kind !== 'exact' && assignment.kind !== 'lower-bound') continue;
        const current = totals.get(assignment.employeeId);
        totals.set(assignment.employeeId, {
            employeeId: assignment.employeeId,
            employeeType: assignment.employeeType,
            kind: current?.kind === 'lower-bound' || assignment.kind === 'lower-bound'
                ? 'lower-bound'
                : 'exact',
            totalServiceSeconds: addFinite(
                current?.totalServiceSeconds ?? 0,
                assignment.totalServiceSeconds,
                `${assignment.employeeId} total service time`
            ),
        });
    }
    return [...totals.values()].sort((left, right) => left.employeeId.localeCompare(right.employeeId));
}

function divideFinite(value: number, divisor: number, label: string): number {
    const result = value / divisor;
    if (!Number.isFinite(result) || result < 0) throw new RangeError(`${label} must be non-negative`);
    return result;
}

function multiplyFinite(left: number, right: number, label: string): number {
    const result = left * right;
    if (!Number.isFinite(result) || result < 0) throw new RangeError(`${label} must be non-negative`);
    return result;
}

function addFinite(left: number, right: number, label: string): number {
    const result = left + right;
    if (!Number.isFinite(result) || result < 0) throw new RangeError(`${label} must be non-negative`);
    return result;
}
