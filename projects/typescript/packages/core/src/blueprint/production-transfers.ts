import type { BlueprintDocument } from '#core/data/blueprint';
import type { NavigationEndpoint } from '#core/world/navigation';
import {
    NavigationNetwork,
    type FoundNavigationPath,
} from '#core/world/navigation';
import type {
    ProductionBatchPlan,
    ProductionBatchStep,
} from '#core/production/plan';
import {
    BlueprintProductionScheduleAnalyzer,
    type BlueprintProductionBatchAssignment,
    type BlueprintProductionScheduleResult,
    type BlueprintProductionScheduledStep,
} from '#core/blueprint/production-schedule';
import {
    BlueprintProductionEndpointAccessAnalyzer,
    type BlueprintProductionEndpointAccessDataset,
    type BlueprintProductionEndpointAccessResult,
    type BlueprintProductionPlacementEndpointAccess,
    type BlueprintProductionTransitEndpointAccess,
} from '#core/blueprint/production-endpoint-access';

export interface BlueprintProductionTransferSupplyAssignment {
    readonly placementId: string;
    readonly batchCount: number;
    readonly producedQuantity: number;
}

export interface BlueprintProductionTransferSupply {
    readonly producerStepIndex: number;
    readonly itemId: string;
    readonly producedQuantity: number;
    readonly downstreamRequiredQuantity: number;
    readonly targetRequiredQuantity: number;
    readonly leftoverQuantity: number;
    readonly assignments: readonly BlueprintProductionTransferSupplyAssignment[];
}

export interface BlueprintProductionTransferDemandAssignment {
    readonly placementId: string;
    readonly batchCount: number;
    readonly requiredQuantity: number;
}

export interface BlueprintProductionNetworkRouteCandidate {
    readonly sourcePlacementId: string;
    readonly sourceAccessPointIndex: number;
    readonly sourceNetworkEndpoint: NavigationEndpoint;
    readonly destinationPlacementId: string;
    readonly destinationAccessPointIndex: number;
    readonly destinationNetworkEndpoint: NavigationEndpoint;
    readonly path: FoundNavigationPath;
}

export type BlueprintProductionTransferRouteUnavailableReason =
    | 'source-has-no-network-reachable-transit-point'
    | 'destination-has-no-network-reachable-transit-point';

export interface BlueprintProductionTransferAssignmentPair {
    readonly sourcePlacementId: string;
    readonly sourceProducedQuantity: number;
    readonly destinationPlacementId: string;
    readonly destinationRequiredQuantity: number;
    readonly networkRouteCandidateStatus: 'available' | 'unavailable';
    readonly unavailableReasons: readonly BlueprintProductionTransferRouteUnavailableReason[];
    readonly networkRouteCandidates: readonly BlueprintProductionNetworkRouteCandidate[];
}

export interface BlueprintProductionTransferRequirement {
    readonly itemId: string;
    readonly producerStepIndex: number;
    readonly consumerStepIndex: number;
    readonly consumerInputIndexes: readonly number[];
    readonly quantityPerConsumerBatch: number;
    readonly requiredQuantity: number;
    readonly destinationAssignments: readonly BlueprintProductionTransferDemandAssignment[];
    readonly assignmentPairs: readonly BlueprintProductionTransferAssignmentPair[];
}

export type BlueprintProductionTransferResult =
    | {
        readonly kind: 'rejected';
        readonly schedule: Extract<BlueprintProductionScheduleResult, { readonly kind: 'rejected' }>;
        readonly endpointAccess: Extract<BlueprintProductionEndpointAccessResult, { readonly kind: 'rejected' }>;
        readonly supplies: readonly [];
        readonly requirements: readonly [];
    }
    | {
        readonly kind: 'unavailable';
        readonly schedule: Extract<BlueprintProductionScheduleResult, { readonly kind: 'unavailable' }>;
        readonly endpointAccess: Extract<BlueprintProductionEndpointAccessResult, { readonly kind: 'analyzed' }>;
        readonly supplies: readonly [];
        readonly requirements: readonly [];
    }
    | {
        readonly kind: 'analyzed';
        readonly schedule: Extract<BlueprintProductionScheduleResult, { readonly kind: 'scheduled' }>;
        readonly endpointAccess: Extract<BlueprintProductionEndpointAccessResult, { readonly kind: 'analyzed' }>;
        readonly quantityBasis: 'production-plan-and-scheduled-batch-assignments';
        readonly sourceSupplyScope:
            'producer-assignment-output-before-transfer-allocation';
        readonly routeCandidateBasis:
            'network-paths-between-endpoint-access-navigation-samples';
        readonly quantityAllocation: 'not-evaluated';
        readonly networkRouteSelection: 'not-evaluated';
        readonly transferFeasibility: 'not-evaluated';
        readonly endpointSnapTraversal: 'not-proven-walkable';
        readonly staticClearanceSufficiency: 'not-evaluated';
        readonly dynamicObstacleClearance: 'not-evaluated';
        readonly transferTiming: 'not-evaluated';
        readonly supplies: readonly BlueprintProductionTransferSupply[];
        readonly requirements: readonly BlueprintProductionTransferRequirement[];
    };

interface IndexedRequirement {
    readonly itemId: string;
    readonly producerStepIndex: number;
    readonly consumerStepIndex: number;
    readonly consumerInputIndexes: readonly number[];
    readonly quantityPerConsumerBatch: number;
    readonly requiredQuantity: number;
}

export class BlueprintProductionTransferAnalyzer {
    readonly #schedule: BlueprintProductionScheduleAnalyzer;
    readonly #endpointAccess: BlueprintProductionEndpointAccessAnalyzer;
    readonly #navigation: NavigationNetwork;

    constructor(dataset: BlueprintProductionEndpointAccessDataset) {
        this.#schedule = new BlueprintProductionScheduleAnalyzer(dataset);
        this.#endpointAccess = new BlueprintProductionEndpointAccessAnalyzer(dataset);
        this.#navigation = new NavigationNetwork(dataset.navigation);
    }

    analyze(
        blueprint: BlueprintDocument,
        plan: ProductionBatchPlan
    ): BlueprintProductionTransferResult {
        const schedule = this.#schedule.analyze(blueprint, plan);
        const endpointAccess = this.#endpointAccess.analyze(blueprint);
        if (schedule.kind === 'rejected') {
            if (endpointAccess.kind !== 'rejected') {
                throw new Error('Production schedule and endpoint access disagree on blueprint validity');
            }
            return {
                kind: 'rejected',
                schedule,
                endpointAccess,
                supplies: [],
                requirements: [],
            };
        }
        if (endpointAccess.kind === 'rejected') {
            throw new Error('Production schedule and endpoint access disagree on blueprint validity');
        }
        if (schedule.kind === 'unavailable') {
            return {
                kind: 'unavailable',
                schedule,
                endpointAccess,
                supplies: [],
                requirements: [],
            };
        }

        const indexedRequirements = indexRequirements(plan);
        const scheduleByStep = indexSchedule(schedule.schedule, plan.productionSteps.length);
        const accessByPlacement = new Map(
            endpointAccess.placements.map((placement) => [placement.placementId, placement])
        );
        const downstreamByProducer = sumRequirementsByProducer(indexedRequirements);
        const supplies = plan.productionSteps.map((step, producerStepIndex) =>
            transferSupply(
                plan,
                step,
                producerStepIndex,
                requireScheduledStep(scheduleByStep, producerStepIndex),
                downstreamByProducer.get(producerStepIndex) ?? 0
            )
        );
        const supplyByStep = new Map(
            supplies.map((supply) => [supply.producerStepIndex, supply])
        );
        const requirements = indexedRequirements.map((requirement) =>
            this.#transferRequirement(
                requirement,
                requireScheduledStep(scheduleByStep, requirement.consumerStepIndex),
                requireSupply(supplyByStep, requirement.producerStepIndex),
                accessByPlacement
            )
        );

        return {
            kind: 'analyzed',
            schedule,
            endpointAccess,
            quantityBasis: 'production-plan-and-scheduled-batch-assignments',
            sourceSupplyScope: 'producer-assignment-output-before-transfer-allocation',
            routeCandidateBasis: 'network-paths-between-endpoint-access-navigation-samples',
            quantityAllocation: 'not-evaluated',
            networkRouteSelection: 'not-evaluated',
            transferFeasibility: 'not-evaluated',
            endpointSnapTraversal: 'not-proven-walkable',
            staticClearanceSufficiency: 'not-evaluated',
            dynamicObstacleClearance: 'not-evaluated',
            transferTiming: 'not-evaluated',
            supplies,
            requirements,
        };
    }

    #transferRequirement(
        requirement: IndexedRequirement,
        consumer: BlueprintProductionScheduledStep,
        supply: BlueprintProductionTransferSupply,
        accessByPlacement: ReadonlyMap<
            string,
            BlueprintProductionPlacementEndpointAccess
        >
    ): BlueprintProductionTransferRequirement {
        const destinationAssignments = consumer.assignments.map((assignment) => ({
            placementId: assignment.placementId,
            batchCount: assignment.batchCount,
            requiredQuantity: multiplyFinite(
                assignment.batchCount,
                requirement.quantityPerConsumerBatch,
                `Production transfer ${requirement.itemId} destination quantity`
            ),
        }));
        requireSameNumber(
            destinationAssignments.reduce((sum, assignment) => sum + assignment.requiredQuantity, 0),
            requirement.requiredQuantity,
            `Production transfer ${requirement.itemId} destination assignment total`
        );
        const assignmentPairs = supply.assignments.flatMap((source) =>
            destinationAssignments.map((destination) => this.#assignmentPair(
                source,
                destination,
                requireEndpointPlacement(accessByPlacement, source.placementId).transitAccessPoints,
                requireEndpointPlacement(
                    accessByPlacement,
                    destination.placementId
                ).transitAccessPoints
            ))
        );
        return {
            ...requirement,
            destinationAssignments,
            assignmentPairs,
        };
    }

    #assignmentPair(
        source: BlueprintProductionTransferSupplyAssignment,
        destination: BlueprintProductionTransferDemandAssignment,
        sourceEndpoints: readonly BlueprintProductionTransitEndpointAccess[],
        destinationEndpoints: readonly BlueprintProductionTransitEndpointAccess[]
    ): BlueprintProductionTransferAssignmentPair {
        const reachableSources = reachableEndpoints(sourceEndpoints);
        const reachableDestinations = reachableEndpoints(destinationEndpoints);
        const unavailableReasons: BlueprintProductionTransferRouteUnavailableReason[] = [];
        if (reachableSources.length === 0) {
            unavailableReasons.push('source-has-no-network-reachable-transit-point');
        }
        if (reachableDestinations.length === 0) {
            unavailableReasons.push('destination-has-no-network-reachable-transit-point');
        }
        const networkRouteCandidates = reachableSources.flatMap((sourceEndpoint) =>
            reachableDestinations.map((destinationEndpoint) => this.#routeCandidate(
                source.placementId,
                sourceEndpoint,
                destination.placementId,
                destinationEndpoint
            ))
        );
        return {
            sourcePlacementId: source.placementId,
            sourceProducedQuantity: source.producedQuantity,
            destinationPlacementId: destination.placementId,
            destinationRequiredQuantity: destination.requiredQuantity,
            networkRouteCandidateStatus:
                networkRouteCandidates.length > 0 ? 'available' : 'unavailable',
            unavailableReasons,
            networkRouteCandidates,
        };
    }

    #routeCandidate(
        sourcePlacementId: string,
        sourceEndpoint: ReachableEndpoint,
        destinationPlacementId: string,
        destinationEndpoint: ReachableEndpoint
    ): BlueprintProductionNetworkRouteCandidate {
        const sourceNetworkEndpoint = sourceEndpoint.employeeReachability.path.end;
        const destinationNetworkEndpoint = destinationEndpoint.employeeReachability.path.end;
        const path = this.#navigation.findPathBetweenSamples({
            startSampleIndex: sourceNetworkEndpoint.sampleIndex,
            endSampleIndex: destinationNetworkEndpoint.sampleIndex,
        });
        if (path.kind !== 'found') {
            throw new Error('Production endpoint access contains disconnected reachable samples');
        }
        return {
            sourcePlacementId,
            sourceAccessPointIndex: sourceEndpoint.accessPointIndex,
            sourceNetworkEndpoint,
            destinationPlacementId,
            destinationAccessPointIndex: destinationEndpoint.accessPointIndex,
            destinationNetworkEndpoint,
            path,
        };
    }
}

type ReachableEndpoint = BlueprintProductionTransitEndpointAccess & {
    readonly employeeReachability: Extract<
        BlueprintProductionTransitEndpointAccess['employeeReachability'],
        { readonly kind: 'reachable' }
    >;
};

function reachableEndpoints(
    endpoints: readonly BlueprintProductionTransitEndpointAccess[]
): ReachableEndpoint[] {
    return endpoints.filter((endpoint): endpoint is ReachableEndpoint =>
        endpoint.employeeReachability.kind === 'reachable'
    );
}

function indexRequirements(plan: ProductionBatchPlan): IndexedRequirement[] {
    const producerByItemId = new Map(
        plan.productionSteps.map((step, stepIndex) => [step.itemId, stepIndex])
    );
    return plan.productionSteps.flatMap((consumer, consumerStepIndex) => {
        const grouped = new Map<string, {
            inputIndexes: number[];
            quantityPerBatch: number;
            totalQuantity: number;
        }>();
        consumer.inputs.forEach((input, inputIndex) => {
            if (!producerByItemId.has(input.itemId)) return;
            const existing = grouped.get(input.itemId);
            if (existing === undefined) {
                grouped.set(input.itemId, {
                    inputIndexes: [inputIndex],
                    quantityPerBatch: input.quantityPerBatch,
                    totalQuantity: input.totalQuantity,
                });
            } else {
                existing.inputIndexes.push(inputIndex);
                existing.quantityPerBatch = addFinite(
                    existing.quantityPerBatch,
                    input.quantityPerBatch,
                    `Production transfer ${input.itemId} quantity per batch`
                );
                existing.totalQuantity = addFinite(
                    existing.totalQuantity,
                    input.totalQuantity,
                    `Production transfer ${input.itemId} total quantity`
                );
            }
        });
        return [...grouped].map(([itemId, input]) => {
            const producerStepIndex = producerByItemId.get(itemId);
            if (producerStepIndex === undefined || producerStepIndex >= consumerStepIndex) {
                throw new Error('Production transfer dependency has no earlier producer step');
            }
            requireSameNumber(
                input.totalQuantity,
                multiplyFinite(
                    input.quantityPerBatch,
                    consumer.batchCount,
                    `Production transfer ${itemId} expected requirement`
                ),
                `Production transfer ${itemId} requirement`
            );
            return {
                itemId,
                producerStepIndex,
                consumerStepIndex,
                consumerInputIndexes: input.inputIndexes,
                quantityPerConsumerBatch: input.quantityPerBatch,
                requiredQuantity: input.totalQuantity,
            };
        });
    });
}

function sumRequirementsByProducer(
    requirements: readonly IndexedRequirement[]
): ReadonlyMap<number, number> {
    const result = new Map<number, number>();
    for (const requirement of requirements) {
        result.set(
            requirement.producerStepIndex,
            addFinite(
                result.get(requirement.producerStepIndex) ?? 0,
                requirement.requiredQuantity,
                `Production step ${requirement.producerStepIndex} downstream requirement`
            )
        );
    }
    return result;
}

function transferSupply(
    plan: ProductionBatchPlan,
    step: ProductionBatchStep,
    producerStepIndex: number,
    scheduled: BlueprintProductionScheduledStep,
    downstreamRequiredQuantity: number
): BlueprintProductionTransferSupply {
    requirePositiveFinite(step.requiredQuantity, `${step.routeId} required quantity`);
    requirePositiveFinite(step.outputQuantityPerBatch, `${step.routeId} output quantity per batch`);
    const expectedProducedQuantity = multiplyFinite(
        step.batchCount,
        step.outputQuantityPerBatch,
        `${step.routeId} produced quantity`
    );
    requireSameNumber(step.producedQuantity, expectedProducedQuantity, `${step.routeId} produced quantity`);
    const targetRequiredQuantity = producerStepIndex === plan.productionSteps.length - 1
        ? plan.targetQuantity
        : 0;
    requireSameNumber(
        step.requiredQuantity,
        addFinite(
            downstreamRequiredQuantity,
            targetRequiredQuantity,
            `${step.routeId} total required quantity`
        ),
        `${step.routeId} required quantity conservation`
    );
    const expectedLeftoverQuantity = expectedProducedQuantity - step.requiredQuantity;
    if (expectedLeftoverQuantity < -numberTolerance(expectedProducedQuantity, step.requiredQuantity)) {
        throw new Error(`${step.routeId} produced quantity cannot satisfy its required quantity`);
    }
    requireSameNumber(step.leftoverQuantity, expectedLeftoverQuantity, `${step.routeId} leftover quantity`);
    const assignments = scheduled.assignments.map((assignment) => supplyAssignment(
        assignment,
        step.outputQuantityPerBatch,
        step.routeId
    ));
    requireSameNumber(
        assignments.reduce((sum, assignment) => sum + assignment.producedQuantity, 0),
        step.producedQuantity,
        `${step.routeId} assignment output total`
    );
    return {
        producerStepIndex,
        itemId: step.itemId,
        producedQuantity: step.producedQuantity,
        downstreamRequiredQuantity,
        targetRequiredQuantity,
        leftoverQuantity: cleanZero(step.leftoverQuantity),
        assignments,
    };
}

function supplyAssignment(
    assignment: BlueprintProductionBatchAssignment,
    outputQuantityPerBatch: number,
    routeId: string
): BlueprintProductionTransferSupplyAssignment {
    return {
        placementId: assignment.placementId,
        batchCount: assignment.batchCount,
        producedQuantity: multiplyFinite(
            assignment.batchCount,
            outputQuantityPerBatch,
            `${routeId} assignment output quantity`
        ),
    };
}

function indexSchedule(
    schedule: readonly BlueprintProductionScheduledStep[],
    expectedCount: number
): ReadonlyMap<number, BlueprintProductionScheduledStep> {
    if (schedule.length !== expectedCount) {
        throw new Error('Production schedule and plan contain different step counts');
    }
    const result = new Map<number, BlueprintProductionScheduledStep>();
    for (const step of schedule) {
        if (result.has(step.stepIndex)) {
            throw new Error('Production schedule contains a duplicate step index');
        }
        result.set(step.stepIndex, step);
    }
    return result;
}

function requireScheduledStep(
    schedule: ReadonlyMap<number, BlueprintProductionScheduledStep>,
    stepIndex: number
): BlueprintProductionScheduledStep {
    const step = schedule.get(stepIndex);
    if (step === undefined) throw new Error('Production schedule is missing a plan step');
    return step;
}

function requireSupply(
    supplies: ReadonlyMap<number, BlueprintProductionTransferSupply>,
    stepIndex: number
): BlueprintProductionTransferSupply {
    const supply = supplies.get(stepIndex);
    if (supply === undefined) throw new Error('Production transfer requirement has no supply');
    return supply;
}

function requireEndpointPlacement(
    placements: ReadonlyMap<string, BlueprintProductionPlacementEndpointAccess>,
    placementId: string
): BlueprintProductionPlacementEndpointAccess {
    const placement = placements.get(placementId);
    if (placement === undefined) {
        throw new Error('Scheduled production placement has no endpoint-access evidence');
    }
    return placement;
}

function requirePositiveFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`);
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

function requireSameNumber(actual: number, expected: number, label: string): void {
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > numberTolerance(actual, expected)) {
        throw new Error(`${label} is inconsistent`);
    }
}

function numberTolerance(left: number, right: number): number {
    return 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));
}

function cleanZero(value: number): number {
    return Math.abs(value) <= numberTolerance(value, 0) ? 0 : value;
}
