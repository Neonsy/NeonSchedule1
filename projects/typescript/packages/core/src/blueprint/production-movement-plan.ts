import type { BlueprintDocument } from '#core/data/blueprint';
import type { ProductionLogisticsCatalog } from '#core/data/production-logistics';
import type { BlueprintProductionNetworkRouteCandidate } from '#core/blueprint/production-transfers';
import { BlueprintProductionDestinationSlotReservations } from '#core/blueprint/production-movement-slots';
import type {
    BlueprintProductionConfiguredRouteCandidate,
    BlueprintProductionInputMovementCandidate,
    BlueprintProductionLogisticsRequirement,
    BlueprintProductionMovementAllocation,
    BlueprintProductionMovementPlan,
    BlueprintProductionMovementScope,
    BlueprintProductionPurchasedInputRequirement,
    BlueprintProductionTransferCapacity,
    BlueprintProductionUnallocatedMovementReason,
    BlueprintProductionUnallocatedMovementRequirement,
} from '#core/blueprint/production-logistics-types';

interface MovementOption {
    readonly optionIndex: number;
    readonly sourceKey: string;
    readonly sourcePlacementId: string;
    readonly sourceOrder: number;
    readonly supplyId: string | null;
    readonly employeeId: string;
    readonly movementKind: BlueprintProductionMovementAllocation['movementKind'];
    readonly routeId: string | null;
    readonly storedOrderIndex: number | null;
    readonly networkRouteCandidates: readonly BlueprintProductionNetworkRouteCandidate[];
    readonly capacity: BlueprintProductionTransferCapacity;
}

interface MovementSourcePair {
    readonly sourceKey: string;
    readonly sourceOrder: number;
    readonly options: readonly MovementOption[];
}

interface DestinationRequest {
    readonly scope: BlueprintProductionMovementScope;
    readonly itemId: string;
    readonly producerStepIndex: number | null;
    readonly consumerStepIndex: number;
    readonly destinationPlacementId: string;
    readonly requiredQuantity: number;
    readonly sourcePairs: readonly MovementSourcePair[];
}

interface MovementPlanningContext {
    readonly employeeOrderById: ReadonlyMap<string, number>;
    readonly employeeWalkSpeedById: ReadonlyMap<string, number | null>;
    readonly sourceRemainingByKey: Map<string, number>;
    readonly destinationSlots: BlueprintProductionDestinationSlotReservations;
    readonly allocations: BlueprintProductionMovementAllocation[];
    readonly unallocatedRequirements: BlueprintProductionUnallocatedMovementRequirement[];
}

export function planBlueprintProductionMovement(
    blueprint: BlueprintDocument,
    catalog: ProductionLogisticsCatalog,
    requirements: readonly BlueprintProductionLogisticsRequirement[],
    purchasedInputRequirements: readonly BlueprintProductionPurchasedInputRequirement[]
): BlueprintProductionMovementPlan {
    const sourceInitialByKey = new Map<string, number>();
    const sourceRemainingByKey = new Map<string, number>();
    registerInternalSources(requirements, sourceInitialByKey, sourceRemainingByKey);
    registerPurchasedSources(
        purchasedInputRequirements,
        sourceInitialByKey,
        sourceRemainingByKey
    );
    const employeeOrderById = new Map(
        blueprint.productionLogistics.employees.map((employee, index) => [employee.id, index])
    );
    const roleByEmployeeType = new Map(
        catalog.employeeRoles.map((role) => [role.employeeType, role])
    );
    const employeeWalkSpeedById = new Map(
        blueprint.productionLogistics.employees.map((employee) => [
            employee.id,
            normalizedWalkSpeed(roleByEmployeeType.get(employee.employeeType)?.walkSpeed),
        ])
    );
    const context: MovementPlanningContext = {
        employeeOrderById,
        employeeWalkSpeedById,
        sourceRemainingByKey,
        destinationSlots: new BlueprintProductionDestinationSlotReservations(),
        allocations: [],
        unallocatedRequirements: [],
    };
    const destinationRequests = [
        ...internalDestinationRequests(requirements),
        ...purchasedDestinationRequests(purchasedInputRequirements),
    ].sort(compareDestinationRequests);
    for (const request of destinationRequests) allocateDestination(request, context);

    return {
        status: context.unallocatedRequirements.length === 0
            ? 'complete'
            : context.allocations.length === 0
                ? 'unavailable'
                : 'partial',
        quantityAllocation: 'deterministic-static-under-empty-destination-capacity',
        destinationCapacityScope:
            'per-consumer-step-destination-compatible-input-slot-reservations',
        destinationSlotReservation:
            'consumer-step-destination-least-flexible-item-first',
        currentSourceAndDestinationContents: 'not-evaluated',
        movementSelection:
            'blueprint-employee-order-then-handler-stored-order-then-source-order',
        allocationOptimality:
            'not-optimized-preserves-production-and-configured-route-priority',
        networkRouteSelection: 'minimum-network-distance-then-access-point-order',
        selectedNetworkTraversalTiming: context.allocations.length === 0
            ? 'not-applicable'
            : context.allocations.some((allocation) =>
                allocation.minimumSelectedNetworkTraversalSeconds === null
            )
                ? 'partial-walk-speed-unavailable'
                : 'complete',
        timingScope:
            'selected-source-to-destination-network-edges-at-per-item-maximum-load',
        aggregateTraversalTiming:
            'not-composed-cross-item-trip-sharing-return-legs-task-order-and-concurrency',
        endpointSnapTraversal: 'not-included-not-proven-walkable',
        staticClearanceSufficiency: 'not-evaluated',
        dynamicObstacleClearance: 'not-evaluated',
        allocations: context.allocations,
        unallocatedRequirements: context.unallocatedRequirements,
    };
}

function internalDestinationRequests(
    requirements: readonly BlueprintProductionLogisticsRequirement[]
): DestinationRequest[] {
    return requirements.flatMap((requirement) =>
        uniqueDestinationIds(requirement.assignmentPairs).map((destinationPlacementId) => {
            const pairs = requirement.assignmentPairs.filter(
                (pair) => pair.destinationPlacementId === destinationPlacementId
            );
            return {
                scope: 'internally-produced-plan-dependency' as const,
                itemId: requirement.itemId,
                producerStepIndex: requirement.producerStepIndex,
                consumerStepIndex: requirement.consumerStepIndex,
                destinationPlacementId,
                requiredQuantity: consistentQuantity(
                    pairs.map((pair) => pair.destinationRequiredQuantity),
                    `Internal movement ${requirement.itemId} destination requirement`
                ),
                sourcePairs: pairs.map((pair, sourceOrder) => {
                    const sourceKey = internalSourceKey(
                        requirement.producerStepIndex,
                        pair.sourcePlacementId
                    );
                    return {
                        sourceKey,
                        sourceOrder,
                        options: pair.configuredRouteCandidates.map((candidate, optionIndex) =>
                            configuredRouteOption(
                                candidate,
                                optionIndex,
                                sourceKey,
                                pair.sourcePlacementId,
                                sourceOrder
                            )
                        ),
                    };
                }),
            };
        })
    );
}

function purchasedDestinationRequests(
    requirements: readonly BlueprintProductionPurchasedInputRequirement[]
): DestinationRequest[] {
    return requirements.flatMap((requirement) =>
        requirement.destinationAssignments.map((destination) => {
            const pairs = requirement.supplyPairs.filter((pair) =>
                pair.consumerStepIndex === destination.consumerStepIndex &&
                pair.destinationPlacementId === destination.placementId
            );
            return {
                scope: 'planned-purchased-input' as const,
                itemId: requirement.itemId,
                producerStepIndex: null,
                consumerStepIndex: destination.consumerStepIndex,
                destinationPlacementId: destination.placementId,
                requiredQuantity: destination.requiredQuantity,
                sourcePairs: pairs.map((pair, sourceOrder) => {
                    const sourceKey = purchasedSourceKey(pair.supplyId);
                    return {
                        sourceKey,
                        sourceOrder,
                        options: pair.movementCandidates.map((candidate, optionIndex) =>
                            inputMovementOption(
                                candidate,
                                optionIndex,
                                sourceKey,
                                pair.sourcePlacementId,
                                sourceOrder,
                                pair.supplyId
                            )
                        ),
                    };
                }),
            };
        })
    );
}

function compareDestinationRequests(left: DestinationRequest, right: DestinationRequest): number {
    return left.consumerStepIndex - right.consumerStepIndex ||
        left.destinationPlacementId.localeCompare(right.destinationPlacementId) ||
        compatibleSlotCount(left) - compatibleSlotCount(right) ||
        left.itemId.localeCompare(right.itemId) ||
        left.scope.localeCompare(right.scope) ||
        (left.producerStepIndex ?? -1) - (right.producerStepIndex ?? -1);
}

function compatibleSlotCount(request: DestinationRequest): number {
    const indexes = request.sourcePairs
        .flatMap((pair) => pair.options)
        .find((option) => option.capacity.destinationCompatibleInputSlotIndexes !== null)
        ?.capacity.destinationCompatibleInputSlotIndexes;
    return indexes?.length ?? Number.MAX_SAFE_INTEGER;
}

function allocateDestination(
    request: DestinationRequest,
    context: MovementPlanningContext
): void {
    requireNonNegativeFinite(request.requiredQuantity, 'Movement destination requirement');
    const options = request.sourcePairs
        .flatMap((pair) => pair.options)
        .sort((left, right) => compareMovementOptions(left, right, context.employeeOrderById));
    const destinationCapacity = context.destinationSlots.availableCapacity(
        request,
        options.map((option) => option.capacity)
    );
    let remainingCapacity = destinationCapacity;
    let remainingQuantity = request.requiredQuantity;

    for (const option of options) {
        if (isZero(remainingQuantity)) break;
        const sourceRemaining = requireSourceRemaining(
            context.sourceRemainingByKey,
            option.sourceKey
        );
        if (isZero(sourceRemaining) || option.networkRouteCandidates.length === 0) continue;
        if (remainingCapacity === null || isZero(remainingCapacity)) continue;
        if (option.capacity.maximumMovedQuantityPerTrip === null) continue;
        if (option.capacity.employeeInventoryCapacity <= 0) continue;

        const allocatedQuantity = Math.min(
            remainingQuantity,
            sourceRemaining,
            remainingCapacity
        );
        if (isZero(allocatedQuantity)) continue;
        const maximumMovedQuantityPerTrip = Math.min(
            allocatedQuantity,
            option.capacity.employeeInventoryCapacity
        );
        const minimumTripCount = Math.ceil(
            allocatedQuantity / maximumMovedQuantityPerTrip
        );
        if (!Number.isSafeInteger(minimumTripCount) || minimumTripCount < 1) {
            throw new RangeError('Movement minimum trip count exceeds the safe integer range');
        }
        const selectedCandidate = selectNetworkRoute(option.networkRouteCandidates);
        const employeeWalkSpeed = context.employeeWalkSpeedById.get(option.employeeId) ?? null;
        const networkTraversalSecondsPerTrip = employeeWalkSpeed === null
            ? null
            : divideFinite(
                selectedCandidate.path.networkDistance,
                employeeWalkSpeed,
                'Movement network traversal time'
            );
        const minimumSelectedNetworkTraversalSeconds =
            networkTraversalSecondsPerTrip === null
                ? null
                : multiplyFinite(
                    networkTraversalSecondsPerTrip,
                    minimumTripCount,
                    'Movement minimum selected network traversal time'
                );
        context.allocations.push({
            scope: request.scope,
            itemId: request.itemId,
            producerStepIndex: request.producerStepIndex,
            consumerStepIndex: request.consumerStepIndex,
            supplyId: option.supplyId,
            sourcePlacementId: option.sourcePlacementId,
            destinationPlacementId: request.destinationPlacementId,
            employeeId: option.employeeId,
            movementKind: option.movementKind,
            routeId: option.routeId,
            storedOrderIndex: option.storedOrderIndex,
            allocatedQuantity,
            maximumMovedQuantityPerTrip,
            minimumTripCount,
            selectedNetworkRoute: {
                selectionBasis: 'minimum-network-distance-then-access-point-order',
                sourceAccessPointIndex: selectedCandidate.sourceAccessPointIndex,
                sourceNetworkSampleIndex: selectedCandidate.sourceNetworkEndpoint.sampleIndex,
                destinationAccessPointIndex: selectedCandidate.destinationAccessPointIndex,
                destinationNetworkSampleIndex:
                    selectedCandidate.destinationNetworkEndpoint.sampleIndex,
                networkDistance: selectedCandidate.path.networkDistance,
                distanceScope: 'navigation-graph-edges-only',
                employeeWalkSpeed,
                traversalTimeStatus: networkTraversalSecondsPerTrip === null
                    ? 'walk-speed-unavailable'
                    : 'calculated',
                networkTraversalSecondsPerTrip,
            },
            minimumSelectedNetworkTraversalSeconds,
        });
        context.sourceRemainingByKey.set(
            option.sourceKey,
            subtractQuantity(sourceRemaining, allocatedQuantity)
        );
        context.destinationSlots.reserve(request, option.capacity, allocatedQuantity);
        remainingQuantity = subtractQuantity(remainingQuantity, allocatedQuantity);
        remainingCapacity = subtractQuantity(remainingCapacity, allocatedQuantity);
    }

    if (isZero(remainingQuantity)) return;
    const allocatedQuantity = subtractQuantity(request.requiredQuantity, remainingQuantity);
    context.unallocatedRequirements.push({
        scope: request.scope,
        itemId: request.itemId,
        producerStepIndex: request.producerStepIndex,
        consumerStepIndex: request.consumerStepIndex,
        destinationPlacementId: request.destinationPlacementId,
        requiredQuantity: request.requiredQuantity,
        allocatedQuantity,
        unallocatedQuantity: remainingQuantity,
        reasons: unallocatedReasons(
            request.sourcePairs,
            remainingQuantity,
            destinationCapacity,
            remainingCapacity,
            context
        ),
    });
}

function unallocatedReasons(
    sourcePairs: readonly MovementSourcePair[],
    remainingQuantity: number,
    destinationCapacity: number | null,
    remainingCapacity: number | null,
    context: MovementPlanningContext
): BlueprintProductionUnallocatedMovementReason[] {
    const reasons = new Set<BlueprintProductionUnallocatedMovementReason>();
    const remainingPairs = sourcePairs.filter((pair) =>
        !isZero(requireSourceRemaining(context.sourceRemainingByKey, pair.sourceKey))
    );
    if (remainingPairs.length === 0) {
        return ['selected-allocation-order-exhausted-source-quantity'];
    }
    const configuredPairs = remainingPairs.filter((pair) => pair.options.length > 0);
    const configuredQuantity = sourceQuantity(configuredPairs, context.sourceRemainingByKey);
    if (configuredQuantity < remainingQuantity) reasons.add('configured-movement-unavailable');
    if (configuredPairs.length === 0) return [...reasons];

    const networkPairs = configuredPairs.filter((pair) => pair.options.some((option) =>
        option.networkRouteCandidates.length > 0
    ));
    const networkQuantity = sourceQuantity(networkPairs, context.sourceRemainingByKey);
    if (networkQuantity < Math.min(remainingQuantity, configuredQuantity)) {
        reasons.add('network-route-unavailable');
    }
    if (networkPairs.length === 0) return [...reasons];

    if (destinationCapacity === null) {
        reasons.add('destination-capacity-evidence-unavailable');
        return [...reasons];
    }
    if (destinationCapacity !== null && remainingCapacity !== null && isZero(remainingCapacity)) {
        reasons.add('destination-empty-capacity-insufficient');
        return [...reasons];
    }
    const inventoryPairs = networkPairs.filter((pair) => pair.options.some((option) =>
        option.capacity.employeeInventoryCapacity > 0
    ));
    const inventoryQuantity = sourceQuantity(inventoryPairs, context.sourceRemainingByKey);
    if (inventoryQuantity < Math.min(remainingQuantity, networkQuantity)) {
        reasons.add('employee-inventory-capacity-unavailable');
    }
    const totalSourceQuantity = sourceQuantity(remainingPairs, context.sourceRemainingByKey);
    if (totalSourceQuantity < remainingQuantity) {
        reasons.add('selected-allocation-order-exhausted-source-quantity');
    }
    if (reasons.size === 0) {
        reasons.add('selected-allocation-order-exhausted-source-quantity');
    }
    return [...reasons];
}

function sourceQuantity(
    pairs: readonly MovementSourcePair[],
    sourceRemainingByKey: ReadonlyMap<string, number>
): number {
    return pairs.reduce((sum, pair) => addFinite(
        sum,
        requireSourceRemaining(sourceRemainingByKey, pair.sourceKey),
        'Movement available source quantity'
    ), 0);
}

function configuredRouteOption(
    candidate: BlueprintProductionConfiguredRouteCandidate,
    optionIndex: number,
    sourceKey: string,
    sourcePlacementId: string,
    sourceOrder: number
): MovementOption {
    return {
        optionIndex,
        sourceKey,
        sourcePlacementId,
        sourceOrder,
        supplyId: null,
        employeeId: candidate.employeeId,
        movementKind: 'configured-handler-route',
        routeId: candidate.routeId,
        storedOrderIndex: candidate.storedOrderIndex,
        networkRouteCandidates: candidate.networkRouteCandidates,
        capacity: candidate.capacity,
    };
}

function inputMovementOption(
    candidate: BlueprintProductionInputMovementCandidate,
    optionIndex: number,
    sourceKey: string,
    sourcePlacementId: string,
    sourceOrder: number,
    supplyId: string
): MovementOption {
    return {
        optionIndex,
        sourceKey,
        sourcePlacementId,
        sourceOrder,
        supplyId,
        employeeId: candidate.employeeId,
        movementKind: candidate.kind,
        routeId: candidate.kind === 'configured-handler-route' ? candidate.routeId : null,
        storedOrderIndex: candidate.kind === 'configured-handler-route'
            ? candidate.storedOrderIndex
            : null,
        networkRouteCandidates: candidate.networkRouteCandidates,
        capacity: candidate.capacity,
    };
}

function registerInternalSources(
    requirements: readonly BlueprintProductionLogisticsRequirement[],
    initialByKey: Map<string, number>,
    remainingByKey: Map<string, number>
): void {
    for (const requirement of requirements) {
        for (const pair of requirement.assignmentPairs) {
            registerSource(
                internalSourceKey(requirement.producerStepIndex, pair.sourcePlacementId),
                pair.sourceAvailableQuantity,
                initialByKey,
                remainingByKey
            );
        }
    }
}

function registerPurchasedSources(
    requirements: readonly BlueprintProductionPurchasedInputRequirement[],
    initialByKey: Map<string, number>,
    remainingByKey: Map<string, number>
): void {
    for (const requirement of requirements) {
        for (const pair of requirement.supplyPairs) {
            registerSource(
                purchasedSourceKey(pair.supplyId),
                pair.sourceQuantity,
                initialByKey,
                remainingByKey
            );
        }
    }
}

function registerSource(
    key: string,
    quantity: number,
    initialByKey: Map<string, number>,
    remainingByKey: Map<string, number>
): void {
    requireNonNegativeFinite(quantity, 'Movement source quantity');
    const existing = initialByKey.get(key);
    if (existing !== undefined) {
        requireSameNumber(existing, quantity, 'Movement source quantity');
        return;
    }
    initialByKey.set(key, quantity);
    remainingByKey.set(key, quantity);
}

function consistentQuantity(values: readonly number[], label: string): number {
    const first = values[0];
    if (first === undefined) throw new Error(`${label} is unavailable`);
    for (const value of values.slice(1)) requireSameNumber(value, first, label);
    return first;
}

function uniqueDestinationIds(
    pairs: readonly BlueprintProductionLogisticsRequirement['assignmentPairs'][number][]
): string[] {
    return [...new Set(pairs.map((pair) => pair.destinationPlacementId))];
}

function compareMovementOptions(
    left: MovementOption,
    right: MovementOption,
    employeeOrderById: ReadonlyMap<string, number>
): number {
    const leftEmployeeOrder = requireEmployeeOrder(employeeOrderById, left.employeeId);
    const rightEmployeeOrder = requireEmployeeOrder(employeeOrderById, right.employeeId);
    return leftEmployeeOrder - rightEmployeeOrder ||
        (left.storedOrderIndex ?? -1) - (right.storedOrderIndex ?? -1) ||
        left.sourceOrder - right.sourceOrder ||
        left.optionIndex - right.optionIndex ||
        (left.routeId ?? '').localeCompare(right.routeId ?? '');
}

function selectNetworkRoute(
    candidates: readonly BlueprintProductionNetworkRouteCandidate[]
): BlueprintProductionNetworkRouteCandidate {
    const selected = [...candidates].sort((left, right) =>
        left.path.networkDistance - right.path.networkDistance ||
        left.sourceAccessPointIndex - right.sourceAccessPointIndex ||
        left.destinationAccessPointIndex - right.destinationAccessPointIndex ||
        left.sourceNetworkEndpoint.sampleIndex - right.sourceNetworkEndpoint.sampleIndex ||
        left.destinationNetworkEndpoint.sampleIndex - right.destinationNetworkEndpoint.sampleIndex
    )[0];
    if (selected === undefined) throw new Error('Movement route selection has no candidate');
    return selected;
}

function normalizedWalkSpeed(value: number | null | undefined): number | null {
    return value !== null && value !== undefined && Number.isFinite(value) && value > 0
        ? value
        : null;
}

function internalSourceKey(producerStepIndex: number, placementId: string): string {
    return `internal:${producerStepIndex}:${placementId}`;
}

function purchasedSourceKey(supplyId: string): string {
    return `purchased:${supplyId}`;
}

function requireSourceRemaining(
    sourceRemainingByKey: ReadonlyMap<string, number>,
    key: string
): number {
    const value = sourceRemainingByKey.get(key);
    if (value === undefined) throw new Error(`Movement source ${JSON.stringify(key)} is unavailable`);
    return value;
}

function requireEmployeeOrder(
    employeeOrderById: ReadonlyMap<string, number>,
    employeeId: string
): number {
    const value = employeeOrderById.get(employeeId);
    if (value === undefined) {
        throw new Error(`Movement employee ${JSON.stringify(employeeId)} is unavailable`);
    }
    return value;
}

function subtractQuantity(left: number, right: number): number {
    const result = left - right;
    const tolerance = numberTolerance(left, right);
    if (Math.abs(result) <= tolerance) return 0;
    if (!Number.isFinite(result) || result < 0) {
        throw new RangeError('Movement quantity subtraction produced an invalid result');
    }
    return result;
}

function isZero(value: number): boolean {
    return Math.abs(value) <= numberTolerance(value, 0);
}

function requireSameNumber(actual: number, expected: number, label: string): void {
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > numberTolerance(actual, expected)) {
        throw new Error(`${label} is inconsistent`);
    }
}

function numberTolerance(left: number, right: number): number {
    return 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));
}

function requireNonNegativeFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${label} must be non-negative and finite`);
    }
}

function divideFinite(dividend: number, divisor: number, label: string): number {
    const result = dividend / divisor;
    if (!Number.isFinite(result)) throw new RangeError(`${label} must be finite`);
    return result;
}

function multiplyFinite(left: number, right: number, label: string): number {
    const result = left * right;
    if (!Number.isFinite(result)) throw new RangeError(`${label} must be finite`);
    return result;
}

function addFinite(left: number, right: number, label: string): number {
    const result = left + right;
    if (!Number.isFinite(result)) throw new RangeError(`${label} must be finite`);
    return result;
}
