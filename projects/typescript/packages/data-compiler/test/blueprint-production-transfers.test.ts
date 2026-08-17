import { describe, expect, it } from 'vitest';

import {
    BRICK_PRESS_OPERATION_RULES,
    PACKAGING_OPERATION_RULES,
    BlueprintProductionBusinessAssessmentAnalyzer,
    BlueprintProductionLogisticsAnalyzer,
    BlueprintProductionTransferAnalyzer,
    composeFinishedRecipeElapsedLifecycle,
    type BlueprintDocument,
    type BlueprintProductionLogisticsDataset,
    type Buildable,
    type Collider,
    type FinishedRecipeProductionPlan,
    type FinishedRecipeRealizedProfitInput,
    type NavigationGraph,
    type ProductionBatchPlan,
    type ProductionCatalog,
    type Property,
    type PropertyLayout,
    type Shop,
    type Transform,
    type Vector3,
} from '@neonschedule1/core';

const gameVersion = 'test';
const datasetSha256 = 'a'.repeat(64);

describe('blueprint production transfers', () => {
    it('derives conserved dependency quantities and every network route candidate', () => {
        const result = analyzer().analyze(layoutBlueprint(), plan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result).toMatchObject({
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
            supplies: [
                {
                    producerStepIndex: 0,
                    itemId: 'intermediate',
                    producedQuantity: 6,
                    downstreamRequiredQuantity: 4,
                    targetRequiredQuantity: 0,
                    leftoverQuantity: 2,
                    assignments: [
                        { placementId: 'source-a', batchCount: 1, producedQuantity: 3 },
                        { placementId: 'source-b', batchCount: 1, producedQuantity: 3 },
                    ],
                },
                {
                    producerStepIndex: 1,
                    itemId: 'final',
                    producedQuantity: 2,
                    downstreamRequiredQuantity: 0,
                    targetRequiredQuantity: 2,
                    leftoverQuantity: 0,
                    assignments: [
                        { placementId: 'destination-a', batchCount: 1, producedQuantity: 1 },
                        { placementId: 'destination-b', batchCount: 1, producedQuantity: 1 },
                    ],
                },
            ],
            requirements: [{
                itemId: 'intermediate',
                producerStepIndex: 0,
                consumerStepIndex: 1,
                consumerInputIndexes: [0, 1],
                quantityPerConsumerBatch: 2,
                requiredQuantity: 4,
                destinationAssignments: [
                    { placementId: 'destination-a', batchCount: 1, requiredQuantity: 2 },
                    { placementId: 'destination-b', batchCount: 1, requiredQuantity: 2 },
                ],
            }],
        });
        const pairs = result.requirements[0]?.assignmentPairs;
        expect(pairs).toHaveLength(4);
        expect(pairs?.map((pair) => ({
            source: pair.sourcePlacementId,
            destination: pair.destinationPlacementId,
            sourceProducedQuantity: pair.sourceProducedQuantity,
            destinationRequiredQuantity: pair.destinationRequiredQuantity,
            status: pair.networkRouteCandidateStatus,
            routeCount: pair.networkRouteCandidates.length,
            distance: pair.networkRouteCandidates[0]?.path.networkDistance,
        }))).toEqual([
            {
                source: 'source-a',
                destination: 'destination-a',
                sourceProducedQuantity: 3,
                destinationRequiredQuantity: 2,
                status: 'available',
                routeCount: 1,
                distance: 8,
            },
            {
                source: 'source-a',
                destination: 'destination-b',
                sourceProducedQuantity: 3,
                destinationRequiredQuantity: 2,
                status: 'available',
                routeCount: 1,
                distance: 12,
            },
            {
                source: 'source-b',
                destination: 'destination-a',
                sourceProducedQuantity: 3,
                destinationRequiredQuantity: 2,
                status: 'available',
                routeCount: 1,
                distance: 4,
            },
            {
                source: 'source-b',
                destination: 'destination-b',
                sourceProducedQuantity: 3,
                destinationRequiredQuantity: 2,
                status: 'available',
                routeCount: 1,
                distance: 8,
            },
        ]);
        expect(pairs?.[0]?.networkRouteCandidates[0]).toMatchObject({
            sourcePlacementId: 'source-a',
            sourceAccessPointIndex: 0,
            sourceNetworkEndpoint: { sampleIndex: 1, snapDistance: 0, componentId: 0 },
            destinationPlacementId: 'destination-a',
            destinationAccessPointIndex: 0,
            destinationNetworkEndpoint: { sampleIndex: 3, snapDistance: 0, componentId: 0 },
            path: {
                kind: 'found',
                points: [{ sampleIndex: 1 }, { sampleIndex: 2 }, { sampleIndex: 3 }],
            },
        });
    });

    it('enumerates every reachable endpoint pairing without selecting one', () => {
        const result = analyzer({ multipleTransitPoints: true })
            .analyze(layoutBlueprint(), plan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        const pair = result.requirements[0]?.assignmentPairs.find((candidate) =>
            candidate.sourcePlacementId === 'source-a' &&
            candidate.destinationPlacementId === 'destination-a'
        );
        expect(pair?.networkRouteCandidates.map((candidate) => [
            candidate.sourceAccessPointIndex,
            candidate.destinationAccessPointIndex,
        ])).toEqual([
            [0, 0],
            [0, 1],
            [1, 0],
            [1, 1],
        ]);
    });

    it('reports assignment pairs without network-reachable transit endpoints', () => {
        const missingSource = analyzer({ missingSourceTransitPoint: true })
            .analyze(layoutBlueprint(), plan());
        expect(missingSource.kind).toBe('analyzed');
        if (missingSource.kind !== 'analyzed') return;
        expect(missingSource.requirements[0]?.assignmentPairs[0]).toMatchObject({
            networkRouteCandidateStatus: 'unavailable',
            unavailableReasons: ['source-has-no-network-reachable-transit-point'],
            networkRouteCandidates: [],
        });

        const noEmployees = analyzer({ employeeCapacity: 0 })
            .analyze(layoutBlueprint(), plan());
        expect(noEmployees.kind).toBe('analyzed');
        if (noEmployees.kind !== 'analyzed') return;
        expect(noEmployees.requirements[0]?.assignmentPairs[0]).toMatchObject({
            networkRouteCandidateStatus: 'unavailable',
            unavailableReasons: [
                'source-has-no-network-reachable-transit-point',
                'destination-has-no-network-reachable-transit-point',
            ],
            networkRouteCandidates: [],
        });
    });

    it('preserves schedule unavailability and blueprint rejection without transfers', () => {
        const unavailable = analyzer().analyze(blueprint([
            placement('source-a', 'source-station', 0),
        ]), plan());
        expect(unavailable).toMatchObject({
            kind: 'unavailable',
            supplies: [],
            requirements: [],
        });

        const rejected = analyzer().analyze(blueprint([
            placement('source-a', 'source-station', 99),
            placement('destination-a', 'destination-station', 2),
        ]), plan());
        expect(rejected).toMatchObject({
            kind: 'rejected',
            supplies: [],
            requirements: [],
        });
    });

    it('keeps a purchased-input target as external output without a transfer requirement', () => {
        const input = plan();
        const target = input.productionSteps[1]!;
        const result = analyzer().analyze(blueprint([
            placement('destination-a', 'destination-station', 2),
            placement('destination-b', 'destination-station', 3),
        ]), {
            ...input,
            totalProcessMinutes: target.totalProcessMinutes,
            productionSteps: [target],
        });

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.supplies).toMatchObject([{
            producerStepIndex: 0,
            itemId: 'final',
            downstreamRequiredQuantity: 0,
            targetRequiredQuantity: 2,
            producedQuantity: 2,
            leftoverQuantity: 0,
        }]);
        expect(result.requirements).toEqual([]);
    });

    it('rejects inconsistent produced, required, and leftover quantities', () => {
        const input = plan();
        const source = input.productionSteps[0]!;
        const target = input.productionSteps[1]!;
        const analyze = (changedSource: typeof source): void => {
            analyzer().analyze(layoutBlueprint(), {
                ...input,
                productionSteps: [changedSource, target],
            });
        };

        expect(() => analyze({ ...source, producedQuantity: 7 }))
            .toThrow('produced quantity is inconsistent');
        expect(() => analyze({ ...source, requiredQuantity: 5, leftoverQuantity: 1 }))
            .toThrow('required quantity conservation is inconsistent');
        expect(() => analyze({ ...source, leftoverQuantity: 1 }))
            .toThrow('leftover quantity is inconsistent');
    });
});

describe('blueprint production logistics', () => {
    it('preserves Handler route order and calculates native per-trip capacity bounds', () => {
        const input = logisticsBlueprint();
        const result = new BlueprintProductionLogisticsAnalyzer(
            dataset({ employeeCapacity: 3 })
        ).analyze(input, plan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.configuration).toMatchObject({
            valid: true,
            employeeCount: 3,
            stationAssignmentOwnership: 'exclusive',
            routeSelection: 'stored-order-first-ready',
            stationMovementScope: 'employee-specific-not-configured-handler-routes',
            employees: [
                {
                    employeeId: 'botanist-1',
                    assignmentKind: 'pots',
                    stationMovements: [{
                        placementId: 'source-b',
                        movementKind: 'station-specific',
                        configuredHandlerRoute: false,
                    }],
                    supply: {
                        placementId: 'raw-storage',
                        storageSlotCount: 3,
                    },
                },
                {
                    employeeId: 'chemist-1',
                    assignmentKind: 'stations',
                    stationMovements: [{
                        placementId: 'destination-b',
                        movementKind: 'station-specific',
                        configuredHandlerRoute: false,
                    }],
                },
                {
                    employeeId: 'handler-1',
                    assignmentKind: 'stations',
                    configuredRoutes: [
                        { routeId: 'first-ready', storedOrderIndex: 0 },
                        { routeId: 'second-ready', storedOrderIndex: 1 },
                        { routeId: 'raw-to-source-a', storedOrderIndex: 2 },
                    ],
                },
            ],
        });
        expect(result).toMatchObject({
            productionRequirementScope: 'internally-produced-plan-dependencies',
            purchasedInputSupplyScope: 'first-production-consumers',
            routeQuantityAllocation: 'evaluated-static-empty-destination-capacity',
            transferTiming: 'selected-network-traversals-only',
            employeeExecution: {
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
                    status:
                        'partial-static-internal-route-candidates',
                    evaluatedLegs: [
                        'move-item-source-to-destination',
                        'supplies-to-grow-container-if-supplies-visited',
                    ],
                    pathSelection: 'all-network-reachable-candidates-unselected',
                    dynamicInitialLeg: 'not-evaluated-current-position-to-first-endpoint',
                    routeFrequency: 'not-evaluated-dynamic-task-selection-and-readiness',
                    movement: {
                        taskOrigin: 'current-npc-position',
                        completionPosition: 'task-endpoint-until-subsequent-behaviour',
                        taskChaining: 'each-selected-task-starts-from-then-current-npc-position',
                    },
                },
                taskReadinessTiming: 'not-evaluated-runtime-state-not-recorded',
                scheduling: {
                    dispatchAuthority: 'server',
                    taskSelection: 'first-ready-in-native-priority-order',
                    taskReadiness: 'native-mutable-runtime-state-not-recorded',
                    workAvailability: {
                        shiftSchedule: 'no-fixed-shift',
                        endOfDayTime: 400,
                    },
                    botanistTaskPriority: expect.arrayContaining([
                        'grow-container-watering-below-0.2',
                        'drying-rack-input-move',
                    ]),
                    chemistTaskPriority: expect.arrayContaining([
                        'lab-oven-finish',
                        'mixing-station-output-move',
                    ]),
                },
                runtimeWorkSpeed: 'not-evaluated',
                elapsedScheduleComposition:
                    'not-applied-dynamic-task-sequence-readiness-runtime-speed-and-concurrency',
                assignments: [
                    {
                        stepIndex: 0,
                        placementId: 'source-a',
                        requiredEmployeeType: 'Chemist',
                        kind: 'unassigned',
                    },
                    {
                        stepIndex: 0,
                        placementId: 'source-b',
                        requiredEmployeeType: 'Chemist',
                        kind: 'incompatible-employee',
                        employeeId: 'botanist-1',
                        employeeType: 'Botanist',
                    },
                    {
                        stepIndex: 1,
                        placementId: 'destination-a',
                        requiredEmployeeType: 'Chemist',
                        kind: 'unassigned',
                    },
                    {
                        stepIndex: 1,
                        placementId: 'destination-b',
                        requiredEmployeeType: 'Chemist',
                        kind: 'exact',
                        employeeId: 'chemist-1',
                        baseWorkSpeed: 1,
                        taskDurations: [
                            { task: 'chemistry-place-ingredients', secondsPerBatch: 8 },
                            { task: 'chemistry-stir', secondsPerBatch: 6 },
                            { task: 'chemistry-burner', secondsPerBatch: 6 },
                        ],
                        serviceSecondsPerBatch: 20,
                        totalServiceSeconds: 20,
                    },
                ],
                reachabilityAssignments: [
                    {
                        stepIndex: 0,
                        placementId: 'source-a',
                        requiredEmployeeType: 'Chemist',
                        kind: 'unassigned',
                    },
                    {
                        stepIndex: 0,
                        placementId: 'source-b',
                        requiredEmployeeType: 'Chemist',
                        kind: 'incompatible-employee',
                        employeeId: 'botanist-1',
                    },
                    {
                        stepIndex: 1,
                        placementId: 'destination-a',
                        requiredEmployeeType: 'Chemist',
                        kind: 'unassigned',
                    },
                    {
                        stepIndex: 1,
                        placementId: 'destination-b',
                        requiredEmployeeType: 'Chemist',
                        kind: 'candidates',
                        employeeId: 'chemist-1',
                        walkSpeed: 2,
                        candidates: [{
                            accessPointIndex: 0,
                            accessPointPath: 'TransitAccess',
                            startSnapDistance: 0,
                            endSnapDistance: 0,
                            networkDistance: 13,
                            networkTraversalSeconds: 6.5,
                        }],
                    },
                ],
                employeeTotals: [{
                    employeeId: 'chemist-1',
                    employeeType: 'Chemist',
                    kind: 'exact',
                    totalServiceSeconds: 20,
                }],
            },
        });
        const configured = result.requirements[0]?.assignmentPairs.find((pair) =>
            pair.sourcePlacementId === 'source-a' && pair.destinationPlacementId === 'destination-a'
        );
        expect(configured).toMatchObject({
            configuredRouteCoverage: 'configured',
            configuredRouteCandidates: [
                {
                    routeId: 'first-ready',
                    storedOrderIndex: 0,
                    capacity: {
                        itemStackLimit: 10,
                        sourceAvailableQuantity: 3,
                        requestedDestinationQuantity: 2,
                        employeeInventoryCapacity: 50,
                        destinationEmptyCapacity: 20,
                        destinationCapacityStatus: 'calculated',
                        maximumMovedQuantityPerTrip: 2,
                        currentSlotContents: 'not-evaluated',
                    },
                },
                {
                    routeId: 'second-ready',
                    storedOrderIndex: 1,
                },
            ],
        });
        expect(result.purchasedInputRequirements).toMatchObject([{
            itemId: 'raw',
            requiredQuantity: 2,
            purchaseQuantity: 2,
            plannedSupplyQuantity: 2,
            supplyQuantityCoverage: 'sufficient',
            destinationAssignments: [
                { consumerStepIndex: 0, placementId: 'source-a', requiredQuantity: 1 },
                { consumerStepIndex: 0, placementId: 'source-b', requiredQuantity: 1 },
            ],
            supplyPairs: [
                {
                    supplyId: 'raw-supply',
                    destinationPlacementId: 'source-a',
                    movementCoverage: 'configured',
                    movementCandidates: [{
                        kind: 'configured-handler-route',
                        employeeId: 'handler-1',
                        routeId: 'raw-to-source-a',
                        storedOrderIndex: 2,
                        networkRouteCandidateStatus: 'available',
                        capacity: {
                            sourceAvailableQuantity: 2,
                            requestedDestinationQuantity: 1,
                            employeeInventoryCapacity: 100,
                            destinationEmptyCapacity: 20,
                            maximumMovedQuantityPerTrip: 1,
                        },
                    }],
                },
                {
                    supplyId: 'raw-supply',
                    destinationPlacementId: 'source-b',
                    movementCoverage: 'unconfigured',
                    movementCandidates: [],
                },
            ],
        }]);
        expect(result.movementPlan).toEqual({
            status: 'partial',
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
            selectedNetworkTraversalTiming: 'complete',
            timingScope:
                'selected-source-to-destination-network-edges-at-per-item-maximum-load',
            aggregateTraversalTiming:
                'not-composed-cross-item-trip-sharing-return-legs-task-order-and-concurrency',
            endpointSnapTraversal: 'not-included-not-proven-walkable',
            staticClearanceSufficiency: 'not-evaluated',
            dynamicObstacleClearance: 'not-evaluated',
            allocations: expect.arrayContaining([
                expect.objectContaining({
                    scope: 'internally-produced-plan-dependency',
                    itemId: 'intermediate',
                    producerStepIndex: 0,
                    consumerStepIndex: 1,
                    supplyId: null,
                    sourcePlacementId: 'source-a',
                    destinationPlacementId: 'destination-a',
                    employeeId: 'handler-1',
                    movementKind: 'configured-handler-route',
                    routeId: 'first-ready',
                    storedOrderIndex: 0,
                    allocatedQuantity: 2,
                    maximumMovedQuantityPerTrip: 2,
                    minimumTripCount: 1,
                    minimumSelectedNetworkTraversalSeconds: 4,
                    selectedNetworkRoute: expect.objectContaining({
                        selectionBasis: 'minimum-network-distance-then-access-point-order',
                        networkDistance: 8,
                        employeeWalkSpeed: 2,
                        networkTraversalSecondsPerTrip: 4,
                    }),
                }),
                expect.objectContaining({
                    scope: 'planned-purchased-input',
                    itemId: 'raw',
                    supplyId: 'raw-supply',
                    sourcePlacementId: 'raw-storage',
                    destinationPlacementId: 'source-a',
                    movementKind: 'configured-handler-route',
                    routeId: 'raw-to-source-a',
                    allocatedQuantity: 1,
                    maximumMovedQuantityPerTrip: 1,
                    minimumTripCount: 1,
                    minimumSelectedNetworkTraversalSeconds: 8,
                    selectedNetworkRoute: expect.objectContaining({
                        networkDistance: 16,
                        networkTraversalSecondsPerTrip: 8,
                    }),
                }),
            ]),
            unallocatedRequirements: expect.arrayContaining([
                {
                    scope: 'internally-produced-plan-dependency',
                    itemId: 'intermediate',
                    producerStepIndex: 0,
                    consumerStepIndex: 1,
                    destinationPlacementId: 'destination-b',
                    requiredQuantity: 2,
                    allocatedQuantity: 0,
                    unallocatedQuantity: 2,
                    reasons: ['configured-movement-unavailable'],
                },
                {
                    scope: 'planned-purchased-input',
                    itemId: 'raw',
                    producerStepIndex: null,
                    consumerStepIndex: 0,
                    destinationPlacementId: 'source-b',
                    requiredQuantity: 1,
                    allocatedQuantity: 0,
                    unallocatedQuantity: 1,
                    reasons: ['configured-movement-unavailable'],
                },
            ]),
        });
        expect(result.movementPlan.allocations.map((allocation) => allocation.itemId))
            .toEqual(['raw', 'intermediate']);
        expect(result.movementPlan.unallocatedRequirements.map((requirement) => requirement.itemId))
            .toEqual(['raw', 'intermediate']);
        expect(result.movementPhysicalFeasibility).toMatchObject({
            status: 'blocked',
            employeeBodyBasis: {
                source: 'normalized-navigation-agent',
                radius: 0.35,
                height: 1.8,
                maximumSlope: 45,
                stepHeight: 0.4,
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
            navigationRebakeEvidence: 'selected-segment-blocked',
            dynamicObstacleClearance: 'not-evaluated',
        });
        expect(result.movementPhysicalFeasibility.allocations.flatMap((allocation) => [
            allocation.sourceEndpointSnap,
            ...allocation.selectedNetworkEdges,
            allocation.destinationEndpointSnap,
        ]).flatMap((segment) => segment.limitations)).toContainEqual({
            code: 'employee-body-overlap',
            obstacle: {
                kind: 'placement',
                placementId: 'source-b',
                index: 0,
                path: 'Bounds',
                shape: 'box',
            },
        });
    });

    it('retains incomplete proof when exact collider geometry lacks activity evidence', () => {
        const inputDataset = dataset({ employeeCapacity: 3 });
        const result = new BlueprintProductionLogisticsAnalyzer({
            ...inputDataset,
            buildables: inputDataset.buildables.map((buildable) => ({
                ...buildable,
                colliders: buildable.colliders.map((placementCollider) => ({
                    ...placementCollider,
                    worldBounds: {
                        ...placementCollider.worldBounds,
                        size: vector(0, 0, 0),
                    },
                })),
            })),
        }).analyze(logisticsBlueprint(), plan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.movementPhysicalFeasibility.status).toBe('incomplete');
        expect(result.movementPhysicalFeasibility.allocations.flatMap((allocation) => [
            allocation.sourceEndpointSnap,
            ...allocation.selectedNetworkEdges,
            allocation.destinationEndpointSnap,
        ]).flatMap((segment) => segment.limitations)).toContainEqual({
            code: 'collider-activity-unavailable',
            obstacle: {
                kind: 'placement',
                placementId: 'source-b',
                index: 0,
                path: 'Bounds',
                shape: 'box',
            },
        });
    });

    it('proves selected snaps and graph edges clear when projected physical colliders fit', () => {
        const result = new BlueprintProductionLogisticsAnalyzer(
            datasetWithPlacementCollidersAtZ(100)
        ).analyze(logisticsBlueprint(), plan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.movementPhysicalFeasibility).toMatchObject({
            status: 'clear',
            navigationRebakeEvidence:
                'selected-segments-clear-under-normalized-static-geometry',
        });
        expect(result.movementPhysicalFeasibility.allocations.length).toBeGreaterThan(0);
        expect(result.movementPhysicalFeasibility.allocations.every((allocation) =>
            allocation.status === 'clear' &&
            allocation.sourceEndpointSnap.status === 'clear' &&
            allocation.selectedNetworkEdges.every((segment) => segment.status === 'clear') &&
            allocation.destinationEndpointSnap.status === 'clear'
        )).toBe(true);
    });

    it('retains incomplete proof when unsupported placement geometry can affect a selected edge', () => {
        const inputDataset = datasetWithPlacementCollidersAtZ(100);
        const result = new BlueprintProductionLogisticsAnalyzer({
            ...inputDataset,
            buildables: inputDataset.buildables.map((buildable) =>
                buildable.itemId === 'source-station'
                    ? {
                        ...buildable,
                        colliders: buildable.colliders.map((placementCollider) => ({
                            ...placementCollider,
                            shape: 'sphere' as const,
                            localCenter: null,
                            localSize: null,
                            radius: 0.5,
                            worldBounds: {
                                center: vector(0, 0, 0),
                                size: vector(1, 1, 1),
                            },
                        })),
                    }
                    : buildable
            ),
        }).analyze(logisticsBlueprint(), plan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.movementPhysicalFeasibility.status).toBe('incomplete');
        expect(result.movementPhysicalFeasibility.allocations.flatMap((allocation) =>
            allocation.selectedNetworkEdges
        ).flatMap((segment) => segment.limitations)).toContainEqual({
            code: 'unsupported-obstacle-geometry',
            obstacle: {
                kind: 'placement',
                placementId: 'source-b',
                index: 0,
                path: 'Bounds',
                shape: 'sphere',
            },
        });
    });

    it('blocks an endpoint snap that exceeds normalized employee step and slope limits', () => {
        const inputDataset = datasetWithPlacementCollidersAtZ(100);
        const result = new BlueprintProductionLogisticsAnalyzer({
            ...inputDataset,
            navigation: {
                ...inputDataset.navigation,
                samples: inputDataset.navigation.samples.map((sample, index) =>
                    index === 1
                        ? { ...sample, position: { ...sample.position, y: 0.5 } }
                        : sample
                ),
            },
        }).analyze(logisticsBlueprint(), plan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.movementPhysicalFeasibility).toMatchObject({
            status: 'blocked',
            navigationRebakeEvidence:
                'selected-segments-clear-under-normalized-static-geometry',
        });
        expect(result.movementPhysicalFeasibility.allocations).toContainEqual(
            expect.objectContaining({
                itemId: 'intermediate',
                status: 'blocked',
                sourceEndpointSnap: expect.objectContaining({
                    horizontalDistance: 0,
                    verticalDistance: 0.5,
                    localMovementLimits: 'exceeded',
                    status: 'blocked',
                }),
            })
        );
    });

    it('checks enabled fixed boxes and ignores trigger-only property geometry', () => {
        const inputDataset = datasetWithPlacementCollidersAtZ(100);
        const fixed = {
            ...collider(),
            transform: transform('Fixed', 1),
            worldBounds: { center: vector(1, 0, 0), size: vector(1, 1, 1) },
        };
        const analyze = (propertyCollider: Collider) =>
            new BlueprintProductionLogisticsAnalyzer({
                ...inputDataset,
                propertyLayouts: inputDataset.propertyLayouts.map((layout) => ({
                    ...layout,
                    fixedColliders: [propertyCollider],
                })),
            }).analyze(logisticsBlueprint(), plan());

        const obstructed = analyze(fixed);
        expect(obstructed.kind).toBe('analyzed');
        if (obstructed.kind !== 'analyzed') return;
        expect(obstructed.movementPhysicalFeasibility.status).toBe('blocked');
        expect(obstructed.movementPhysicalFeasibility.allocations.flatMap((allocation) => [
            allocation.sourceEndpointSnap,
            allocation.destinationEndpointSnap,
        ]).flatMap((segment) => segment.limitations)).toContainEqual({
            code: 'employee-body-overlap',
            obstacle: { kind: 'property-fixed', index: 0, path: 'Fixed', shape: 'box' },
        });

        const triggerOnly = analyze({ ...fixed, isTrigger: true });
        expect(triggerOnly.kind).toBe('analyzed');
        if (triggerOnly.kind !== 'analyzed') return;
        expect(triggerOnly.movementPhysicalFeasibility.status).toBe('clear');
    });

    it('clears supporting contact and upright-box corners outside the employee cylinder', () => {
        const inputDataset = datasetWithPlacementCollidersAtZ(100);
        const analyze = (fixed: Collider) => new BlueprintProductionLogisticsAnalyzer({
            ...inputDataset,
            propertyLayouts: inputDataset.propertyLayouts.map((layout) => ({
                ...layout,
                fixedColliders: [fixed],
            })),
        }).analyze(logisticsBlueprint(), plan());
        const floorTransform = {
            ...transform('Floor', 1),
            worldPosition: vector(1, -0.5, 0),
            localPosition: vector(1, -0.5, 0),
        };
        const floor = analyze({
            ...collider(),
            transform: floorTransform,
            worldBounds: { center: floorTransform.worldPosition, size: vector(1, 1, 1) },
        });
        expect(floor.kind).toBe('analyzed');
        if (floor.kind !== 'analyzed') return;
        expect(floor.movementPhysicalFeasibility.status).toBe('clear');

        const cornerTransform = {
            ...transform('Corner', 1.8),
            worldPosition: vector(1.8, 0, 0.8),
            localPosition: vector(1.8, 0, 0.8),
        };
        const corner = analyze({
            ...collider(),
            transform: cornerTransform,
            worldBounds: { center: cornerTransform.worldPosition, size: vector(1, 1, 1) },
        });
        expect(corner.kind).toBe('analyzed');
        if (corner.kind !== 'analyzed') return;
        expect(corner.movementPhysicalFeasibility.status).toBe('clear');
    });

    it('uses the employee inventory bound to calculate minimum selected-route trips', () => {
        const inputDataset = dataset({ employeeCapacity: 3 });
        const result = new BlueprintProductionLogisticsAnalyzer({
            ...inputDataset,
            items: inputDataset.items.map((entry) =>
                entry.id === 'intermediate' ? { ...entry, stackLimit: 1 } : entry
            ),
            productionLogistics: {
                ...inputDataset.productionLogistics,
                employeeRoles: inputDataset.productionLogistics.employeeRoles.map((role) =>
                    role.employeeType === 'Handler'
                        ? { ...role, inventorySlotCount: 1 }
                        : role
                ),
            },
        }).analyze(logisticsBlueprint(), plan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.movementPlan.allocations.find((allocation) =>
            allocation.itemId === 'intermediate'
        )).toMatchObject({
            itemId: 'intermediate',
            allocatedQuantity: 2,
            maximumMovedQuantityPerTrip: 1,
            minimumTripCount: 2,
            minimumSelectedNetworkTraversalSeconds: 8,
        });
    });

    it('does not assign one destination slot to two different input items', () => {
        const inputDataset = dataset({ employeeCapacity: 3 });
        const sourceRecipe = inputDataset.production.stationRecipes[0]!;
        const inputPlan = plan();
        const sourceStep = inputPlan.productionSteps[0]!;
        const input = logisticsBlueprint();
        input.productionLogistics.supplies.push({
            id: 'raw-2-supply',
            itemId: 'raw-2',
            sourcePlacementId: 'raw-storage',
            quantity: 2,
        });
        const handler = input.productionLogistics.employees.find(
            (employee) => employee.employeeType === 'Handler'
        )!;
        handler.handlerRoutes[2]!.filter.itemIds.push('raw-2');
        const result = new BlueprintProductionLogisticsAnalyzer({
            ...inputDataset,
            items: [...inputDataset.items, item('raw-2', 20)],
            production: {
                ...inputDataset.production,
                stationRecipes: [{
                    ...sourceRecipe,
                    ingredients: [
                        ...sourceRecipe.ingredients,
                        { acceptedItemIds: ['raw-2'], quantity: 1 },
                    ],
                }, ...inputDataset.production.stationRecipes.slice(1)],
            },
        }).analyze(input, {
            ...inputPlan,
            requiredMaterialCost: 4,
            purchaseCost: 4,
            purchases: [
                ...inputPlan.purchases,
                {
                    itemId: 'raw-2',
                    requiredQuantity: 2,
                    purchaseQuantity: 2,
                    leftoverQuantity: 0,
                    unitCost: 1,
                    requiredCost: 2,
                    purchaseCost: 2,
                },
            ],
            productionSteps: [{
                ...sourceStep,
                inputs: [
                    ...sourceStep.inputs,
                    { itemId: 'raw-2', quantityPerBatch: 1, totalQuantity: 2 },
                ],
            }, ...inputPlan.productionSteps.slice(1)],
        });

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.movementPlan.allocations).toContainEqual(expect.objectContaining({
            itemId: 'raw',
            destinationPlacementId: 'source-a',
            allocatedQuantity: 1,
        }));
        expect(result.movementPlan.allocations).not.toContainEqual(expect.objectContaining({
            itemId: 'raw-2',
            destinationPlacementId: 'source-a',
        }));
        expect(result.movementPlan.unallocatedRequirements).toContainEqual({
            scope: 'planned-purchased-input',
            itemId: 'raw-2',
            producerStepIndex: null,
            consumerStepIndex: 0,
            destinationPlacementId: 'source-a',
            requiredQuantity: 1,
            allocatedQuantity: 0,
            unallocatedQuantity: 1,
            reasons: ['destination-empty-capacity-insufficient'],
        });
    });

    it('selects equal-distance endpoint routes by stable access-point order', () => {
        const result = new BlueprintProductionLogisticsAnalyzer(
            dataset({ employeeCapacity: 3, multipleTransitPoints: true })
        ).analyze(logisticsBlueprint(), plan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.movementPlan.allocations.find((allocation) =>
            allocation.itemId === 'intermediate'
        )?.selectedNetworkRoute).toMatchObject({
            selectionBasis: 'minimum-network-distance-then-access-point-order',
            sourceAccessPointIndex: 0,
            destinationAccessPointIndex: 0,
            networkDistance: 8,
        });
    });

    it('routes a Handler supply even when no Botanist owns the source storage', () => {
        const input = logisticsBlueprint();
        const botanist = input.productionLogistics.employees.find(
            (employee) => employee.employeeType === 'Botanist'
        )!;
        botanist.supplyPlacementId = null;
        const result = new BlueprintProductionLogisticsAnalyzer(
            dataset({ employeeCapacity: 3 })
        ).analyze(input, plan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        const rawToSource = result.purchasedInputRequirements[0]?.supplyPairs.find((pair) =>
            pair.destinationPlacementId === 'source-a'
        );
        expect(rawToSource?.movementCandidates[0]).toMatchObject({
            kind: 'configured-handler-route',
            networkRouteCandidateStatus: 'available',
            networkRouteCandidates: [expect.objectContaining({
                sourcePlacementId: 'raw-storage',
                destinationPlacementId: 'source-a',
            })],
        });
        expect(result.movementPlan.allocations).toContainEqual(expect.objectContaining({
            scope: 'planned-purchased-input',
            supplyId: 'raw-supply',
            destinationPlacementId: 'source-a',
            routeId: 'raw-to-source-a',
            allocatedQuantity: 1,
        }));
    });

    it('does not allocate more purchased input than the recorded source quantity', () => {
        const input = logisticsBlueprint();
        input.productionLogistics.supplies[0]!.quantity = 1;
        const result = new BlueprintProductionLogisticsAnalyzer(
            dataset({ employeeCapacity: 3 })
        ).analyze(input, plan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.purchasedInputRequirements[0]?.supplyQuantityCoverage).toBe('insufficient');
        expect(result.movementPlan.allocations).toContainEqual(expect.objectContaining({
            scope: 'planned-purchased-input',
            destinationPlacementId: 'source-a',
            allocatedQuantity: 1,
        }));
        expect(result.movementPlan.unallocatedRequirements).toContainEqual({
            scope: 'planned-purchased-input',
            itemId: 'raw',
            producerStepIndex: null,
            consumerStepIndex: 0,
            destinationPlacementId: 'source-b',
            requiredQuantity: 1,
            allocatedQuantity: 0,
            unallocatedQuantity: 1,
            reasons: ['selected-allocation-order-exhausted-source-quantity'],
        });
    });

    it('conserves separate purchased supplies and attributes each allocation', () => {
        const input = logisticsBlueprint();
        const handler = input.productionLogistics.employees.find(
            (employee) => employee.employeeType === 'Handler'
        )!;
        handler.handlerRoutes[1] = {
            id: 'raw-to-source-b',
            sourcePlacementId: 'raw-storage',
            destinationPlacementId: 'source-b',
            filter: { mode: 'whitelist', itemIds: ['raw'] },
        };
        input.productionLogistics.supplies[0]!.quantity = 1;
        input.productionLogistics.supplies.push({
            id: 'raw-supply-2',
            itemId: 'raw',
            sourcePlacementId: 'raw-storage',
            quantity: 1,
        });
        const result = new BlueprintProductionLogisticsAnalyzer(
            dataset({ employeeCapacity: 3 })
        ).analyze(input, plan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.movementPlan.allocations.filter((allocation) =>
            allocation.scope === 'planned-purchased-input'
        ).map((allocation) => ({
            supplyId: allocation.supplyId,
            destinationPlacementId: allocation.destinationPlacementId,
            allocatedQuantity: allocation.allocatedQuantity,
        }))).toEqual([
            {
                supplyId: 'raw-supply',
                destinationPlacementId: 'source-a',
                allocatedQuantity: 1,
            },
            {
                supplyId: 'raw-supply-2',
                destinationPlacementId: 'source-b',
                allocatedQuantity: 1,
            },
        ]);
    });

    it('keeps configured quantities unallocated when endpoint routes are unavailable', () => {
        const result = new BlueprintProductionLogisticsAnalyzer(
            dataset({ employeeCapacity: 3, missingSourceTransitPoint: true })
        ).analyze(logisticsBlueprint(), plan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.movementPlan.status).toBe('unavailable');
        expect(result.movementPlan.allocations).toEqual([]);
        expect(result.movementPhysicalFeasibility).toMatchObject({
            status: 'not-applicable',
            navigationRebakeEvidence: 'not-applicable-no-selected-movements',
            allocations: [],
        });
        expect(result.movementPlan.unallocatedRequirements).toContainEqual({
            scope: 'internally-produced-plan-dependency',
            itemId: 'intermediate',
            producerStepIndex: 0,
            consumerStepIndex: 1,
            destinationPlacementId: 'destination-a',
            requiredQuantity: 2,
            allocatedQuantity: 0,
            unallocatedQuantity: 2,
            reasons: ['network-route-unavailable'],
        });
    });

    it('selects graph routes while keeping timing unavailable without walk speed', () => {
        const inputDataset = dataset({ employeeCapacity: 3 });
        const result = new BlueprintProductionLogisticsAnalyzer({
            ...inputDataset,
            productionLogistics: {
                ...inputDataset.productionLogistics,
                employeeRoles: inputDataset.productionLogistics.employeeRoles.map((role) =>
                    role.employeeType === 'Handler' ? { ...role, walkSpeed: null } : role
                ),
            },
        }).analyze(logisticsBlueprint(), plan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.movementPlan.selectedNetworkTraversalTiming)
            .toBe('partial-walk-speed-unavailable');
        expect(result.movementPlan.allocations.find((allocation) =>
            allocation.routeId === 'first-ready'
        )).toMatchObject({
            routeId: 'first-ready',
            minimumSelectedNetworkTraversalSeconds: null,
            selectedNetworkRoute: {
                networkDistance: 8,
                employeeWalkSpeed: null,
                traversalTimeStatus: 'walk-speed-unavailable',
                networkTraversalSecondsPerTrip: null,
            },
        });
    });

    it('reports unsupported ownership, limits, endpoints, filters, and shared assignments', () => {
        const input = logisticsBlueprint();
        const chemist = input.productionLogistics.employees.find(
            (employee) => employee.employeeType === 'Chemist'
        )!;
        const handler = input.productionLogistics.employees.find(
            (employee) => employee.employeeType === 'Handler'
        )!;
        chemist.assignedStationPlacementIds = ['source-b'];
        handler.assignedStationPlacementIds = [
            'source-a',
            'destination-a',
            'missing-station',
            'source-b',
        ];
        handler.handlerRoutes = [
            ...handler.handlerRoutes,
            {
                id: 'broken',
                sourcePlacementId: 'missing-source',
                destinationPlacementId: 'missing-destination',
                filter: { mode: 'whitelist', itemIds: ['missing-item'] },
            },
            {
                id: 'too-many',
                sourcePlacementId: 'source-a',
                destinationPlacementId: 'destination-a',
                filter: { mode: 'blacklist', itemIds: [] },
            },
            {
                id: 'still-too-many',
                sourcePlacementId: 'source-a',
                destinationPlacementId: 'destination-a',
                filter: { mode: 'blacklist', itemIds: [] },
            },
            {
                id: 'over-the-limit',
                sourcePlacementId: 'source-a',
                destinationPlacementId: 'destination-a',
                filter: { mode: 'blacklist', itemIds: [] },
            },
        ];
        input.productionLogistics.supplies[0]!.quantity = 100;

        const result = new BlueprintProductionLogisticsAnalyzer(
            dataset({ employeeCapacity: 2 })
        ).analyze(input, plan());

        expect(result.kind).toBe('invalid-configuration');
        if (result.kind !== 'invalid-configuration') return;
        expect(result.configuration.valid).toBe(false);
        expect(result.configuration.issues.map((issue) => issue.code)).toEqual(
            expect.arrayContaining([
                'property-employee-capacity-exceeded',
                'station-assigned-more-than-once',
                'assignment-limit-exceeded',
                'assigned-placement-unavailable',
                'handler-route-limit-exceeded',
                'route-source-unavailable',
                'route-destination-unavailable',
                'route-filter-item-unavailable',
                'supply-storage-capacity-exceeded',
                'supply-storage-slots-exceeded',
            ])
        );
    });

    it('reports insufficient planned input supply and uncovered first consumers', () => {
        const input = logisticsBlueprint();
        input.productionLogistics.supplies[0]!.quantity = 1;
        const botanist = input.productionLogistics.employees.find(
            (employee) => employee.employeeType === 'Botanist'
        )!;
        const handler = input.productionLogistics.employees.find(
            (employee) => employee.employeeType === 'Handler'
        )!;
        botanist.assignedPotPlacementIds = [];
        handler.handlerRoutes = handler.handlerRoutes.filter(
            (route) => route.id !== 'raw-to-source-a'
        );

        const result = new BlueprintProductionLogisticsAnalyzer(
            dataset({ employeeCapacity: 3 })
        ).analyze(input, plan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.purchasedInputRequirements).toMatchObject([{
            itemId: 'raw',
            requiredQuantity: 2,
            plannedSupplyQuantity: 1,
            supplyQuantityCoverage: 'insufficient',
            supplyPairs: [
                { destinationPlacementId: 'source-a', movementCoverage: 'unconfigured' },
                { destinationPlacementId: 'source-b', movementCoverage: 'unconfigured' },
            ],
        }]);
    });

    it('scales exact service by normalized base speed and totals assigned work', () => {
        const input = logisticsBlueprint();
        const botanist = input.productionLogistics.employees.find(
            (employee) => employee.employeeType === 'Botanist'
        )!;
        const chemist = input.productionLogistics.employees.find(
            (employee) => employee.employeeType === 'Chemist'
        )!;
        botanist.assignedPotPlacementIds = [];
        chemist.assignedStationPlacementIds = [
            'source-a',
            'source-b',
            'destination-a',
            'destination-b',
        ];
        const inputDataset = dataset({ employeeCapacity: 3 });
        const catalog = {
            ...inputDataset.productionLogistics,
            employeeRoles: inputDataset.productionLogistics.employeeRoles.map((role) =>
                role.employeeType === 'Chemist' ? { ...role, baseWorkSpeed: 2 } : role
            ),
        };

        const result = new BlueprintProductionLogisticsAnalyzer({
            ...inputDataset,
            productionLogistics: catalog,
        }).analyze(input, plan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.employeeExecution.assignments).toHaveLength(4);
        expect(result.employeeExecution.assignments).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: 'exact',
                    baseWorkSpeed: 2,
                    serviceSecondsPerBatch: 10,
                    totalServiceSeconds: 10,
                }),
            ])
        );
        expect(result.employeeExecution.employeeTotals).toEqual([{
            employeeId: 'chemist-1',
            employeeType: 'Chemist',
            kind: 'exact',
            totalServiceSeconds: 40,
        }]);
    });

    it('keeps assigned travel unavailable without normalized walk speed', () => {
        const input = logisticsBlueprint();
        const botanist = input.productionLogistics.employees.find(
            (employee) => employee.employeeType === 'Botanist'
        )!;
        const chemist = input.productionLogistics.employees.find(
            (employee) => employee.employeeType === 'Chemist'
        )!;
        botanist.assignedPotPlacementIds = [];
        chemist.assignedStationPlacementIds = ['source-a', 'destination-b'];
        const inputDataset = dataset({ employeeCapacity: 3 });
        const catalog = {
            ...inputDataset.productionLogistics,
            employeeRoles: inputDataset.productionLogistics.employeeRoles.map((role) =>
                role.employeeType === 'Chemist' ? { ...role, walkSpeed: null } : role
            ),
        };

        const result = new BlueprintProductionLogisticsAnalyzer({
            ...inputDataset,
            productionLogistics: catalog,
        }).analyze(input, plan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.employeeExecution.reachabilityAssignments).toContainEqual(
            expect.objectContaining({
                placementId: 'destination-b',
                kind: 'walk-speed-unavailable',
                employeeId: 'chemist-1',
            })
        );
        expect(result.employeeExecution.taskTravelTiming.assignments).toContainEqual(
            expect.objectContaining({
                routeKind: 'move-item-source-to-destination',
                sourcePlacementId: 'source-a',
                kind: 'walk-speed-unavailable',
                employeeId: 'chemist-1',
            })
        );
    });

    it('enumerates every internal move endpoint pair without selecting one', () => {
        const input = logisticsBlueprint();
        const botanist = input.productionLogistics.employees.find(
            (employee) => employee.employeeType === 'Botanist'
        )!;
        const chemist = input.productionLogistics.employees.find(
            (employee) => employee.employeeType === 'Chemist'
        )!;
        botanist.assignedPotPlacementIds = [];
        chemist.assignedStationPlacementIds = [
            'source-a',
            'source-b',
            'destination-a',
            'destination-b',
        ];
        const result = new BlueprintProductionLogisticsAnalyzer(
            dataset({ employeeCapacity: 3, multipleTransitPoints: true })
        ).analyze(input, plan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        const route = result.employeeExecution.taskTravelTiming.assignments.find(
            (assignment) => assignment.sourcePlacementId === 'source-a' &&
                assignment.destinationPlacementId === 'destination-a'
        );
        expect(route).toMatchObject({
            routeKind: 'move-item-source-to-destination',
            condition: 'if-native-move-item-task-selected',
            kind: 'candidates',
            employeeId: 'chemist-1',
            walkSpeed: 2,
            candidates: [
                { sourceAccessPointIndex: 0, destinationAccessPointIndex: 0 },
                { sourceAccessPointIndex: 0, destinationAccessPointIndex: 1 },
                { sourceAccessPointIndex: 1, destinationAccessPointIndex: 0 },
                { sourceAccessPointIndex: 1, destinationAccessPointIndex: 1 },
            ],
        });
    });

    it('enumerates every reachable assigned transit point without selecting one', () => {
        const result = new BlueprintProductionLogisticsAnalyzer(
            dataset({ employeeCapacity: 3, multipleTransitPoints: true })
        ).analyze(logisticsBlueprint(), plan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        const assigned = result.employeeExecution.reachabilityAssignments.find(
            (assignment) => assignment.placementId === 'destination-b'
        );
        expect(assigned).toMatchObject({
            kind: 'candidates',
            candidates: [
                { accessPointIndex: 0 },
                { accessPointIndex: 1 },
            ],
        });
    });

    it('reports assigned travel without a network-reachable transit point', () => {
        const input = logisticsBlueprint();
        const botanist = input.productionLogistics.employees.find(
            (employee) => employee.employeeType === 'Botanist'
        )!;
        const chemist = input.productionLogistics.employees.find(
            (employee) => employee.employeeType === 'Chemist'
        )!;
        botanist.assignedPotPlacementIds = [];
        chemist.assignedStationPlacementIds = ['source-a'];

        const result = new BlueprintProductionLogisticsAnalyzer(
            dataset({ employeeCapacity: 3, missingSourceTransitPoint: true })
        ).analyze(input, plan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.employeeExecution.reachabilityAssignments).toContainEqual(
            expect.objectContaining({
                placementId: 'source-a',
                kind: 'no-network-reachable-transit-point',
                employeeId: 'chemist-1',
                walkSpeed: 2,
            })
        );
        expect(result.employeeExecution.taskTravelTiming.assignments).toContainEqual(
            expect.objectContaining({
                routeKind: 'move-item-source-to-destination',
                sourcePlacementId: 'source-a',
                kind: 'route-endpoints-unavailable',
                unavailableReasons: ['source-has-no-network-reachable-transit-point'],
            })
        );
    });

    it('times the conditional supplies-to-grow-container leg', () => {
        const inputDataset = seedDataset();
        const input = blueprint([
            placement('pot-1', 'pot', 0),
            placement('supply-1', 'storage', 4),
        ]);
        input.productionLogistics.employees = [{
            id: 'botanist-1',
            employeeType: 'Botanist',
            assignedPotPlacementIds: ['pot-1'],
            supplyPlacementId: 'supply-1',
        }];

        const result = new BlueprintProductionLogisticsAnalyzer(inputDataset)
            .analyze(input, seedPlan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.employeeExecution.taskTravelTiming.assignments).toEqual([{
            routeKind: 'supplies-to-grow-container-if-supplies-visited',
            condition:
                'if-required-item-missing-from-inventory-and-present-in-assigned-supplies',
            itemId: 'leaf',
            sourceStepIndex: null,
            destinationStepIndex: 0,
            sourcePlacementId: 'supply-1',
            destinationPlacementId: 'pot-1',
            requiredEmployeeType: 'Botanist',
            kind: 'candidates',
            employeeId: 'botanist-1',
            employeeType: 'Botanist',
            walkSpeed: 2,
            candidates: [{
                sourceAccessPointIndex: 0,
                sourceAccessPointPath: 'TransitAccess',
                destinationAccessPointIndex: 0,
                destinationAccessPointPath: 'TransitAccess',
                networkDistance: 16,
                networkTraversalSeconds: 8,
            }],
        }]);
    });

    it('allocates a purchased grow-container input through the assigned Botanist supplies', () => {
        const baseDataset = seedDataset();
        const inputDataset = {
            ...baseDataset,
            items: [...baseDataset.items, item('soil', 20)],
        };
        const input = blueprint([
            placement('pot-1', 'pot', 0),
            placement('supply-1', 'storage', 4),
        ]);
        input.productionLogistics.employees = [{
            id: 'botanist-1',
            employeeType: 'Botanist',
            assignedPotPlacementIds: ['pot-1'],
            supplyPlacementId: 'supply-1',
        }];
        input.productionLogistics.supplies = [{
            id: 'soil-supply',
            itemId: 'soil',
            sourcePlacementId: 'supply-1',
            quantity: 1,
        }];
        const basePlan = seedPlan();
        const result = new BlueprintProductionLogisticsAnalyzer(inputDataset).analyze(input, {
            ...basePlan,
            requiredMaterialCost: 1,
            purchaseCost: 1,
            purchases: [{
                itemId: 'soil',
                requiredQuantity: 1,
                purchaseQuantity: 1,
                leftoverQuantity: 0,
                unitCost: 1,
                requiredCost: 1,
                purchaseCost: 1,
            }],
        });

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.purchasedInputRequirements[0]?.supplyPairs[0]?.movementCandidates[0])
            .toMatchObject({
                kind: 'botanist-station-specific',
                employeeId: 'botanist-1',
                networkRouteCandidateStatus: 'available',
            });
        expect(result.movementPlan).toMatchObject({
            status: 'complete',
            selectedNetworkTraversalTiming: 'complete',
            allocations: [{
                scope: 'planned-purchased-input',
                itemId: 'soil',
                supplyId: 'soil-supply',
                sourcePlacementId: 'supply-1',
                destinationPlacementId: 'pot-1',
                employeeId: 'botanist-1',
                movementKind: 'botanist-station-specific',
                routeId: null,
                allocatedQuantity: 1,
                maximumMovedQuantityPerTrip: 1,
                minimumTripCount: 1,
                minimumSelectedNetworkTraversalSeconds: 8,
                selectedNetworkRoute: {
                    networkDistance: 16,
                    employeeWalkSpeed: 2,
                    networkTraversalSecondsPerTrip: 8,
                },
            }],
            unallocatedRequirements: [],
        });
    });

    it('keeps task-internal routes unavailable without movement facts', () => {
        const inputDataset = dataset({ employeeCapacity: 3 });
        const scheduling = inputDataset.productionLogistics.employeeScheduling!;
        const result = new BlueprintProductionLogisticsAnalyzer({
            ...inputDataset,
            productionLogistics: {
                ...inputDataset.productionLogistics,
                employeeScheduling: { ...scheduling, movement: null },
            },
        }).analyze(logisticsBlueprint(), plan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.employeeExecution.taskTravelTiming).toMatchObject({
            status: 'unavailable-movement-contract-not-recorded',
            evaluatedLegs: [],
            movement: null,
            assignments: [],
        });
    });

    it('reports grow-container service as a lower bound when moisture actions are unknown', () => {
        const inputDataset = seedDataset();
        const input = blueprint([placement('pot-1', 'pot', 0)]);
        input.productionLogistics.employees = [{
            id: 'botanist-1',
            employeeType: 'Botanist',
            assignedPotPlacementIds: ['pot-1'],
            supplyPlacementId: null,
        }];

        const result = new BlueprintProductionLogisticsAnalyzer(inputDataset)
            .analyze(input, seedPlan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.employeeExecution).toMatchObject({
            assignments: [{
                kind: 'lower-bound',
                employeeId: 'botanist-1',
                requiredEmployeeType: 'Botanist',
                baseWorkSpeed: 2,
                taskDurations: [
                    { task: 'grow-container-soil', secondsPerBatch: 5 },
                    { task: 'sow-seed', secondsPerBatch: 7.5 },
                    { task: 'harvest-output-unit', secondsPerBatch: 2 },
                ],
                omittedTaskKinds: ['moisture-action-count'],
                serviceSecondsPerBatch: 14.5,
                totalServiceSeconds: 14.5,
            }],
            employeeTotals: [{
                employeeId: 'botanist-1',
                kind: 'lower-bound',
                totalServiceSeconds: 14.5,
            }],
        });
    });

    it('does not invent destination capacity when a native slot filter is unsupported', () => {
        const inputDataset = dataset({ employeeCapacity: 3 });
        const destination = inputDataset.productionLogistics.stations.find(
            (station) => station.itemId === 'destination-station'
        )!;
        destination.inputSlots[0]!.filters = [{
            nativeType: 'ScheduleOne.ItemFramework.ItemFilter_Dryable',
            isWhitelist: null,
            itemIds: [],
            categories: [],
        }];
        const result = new BlueprintProductionLogisticsAnalyzer(inputDataset)
            .analyze(logisticsBlueprint(), plan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        const configured = result.requirements[0]?.assignmentPairs.find((pair) =>
            pair.sourcePlacementId === 'source-a' && pair.destinationPlacementId === 'destination-a'
        )?.configuredRouteCandidates[0];
        expect(configured?.capacity).toMatchObject({
            destinationEmptyCapacity: null,
            destinationCapacityStatus: 'filter-evidence-unavailable',
            maximumMovedQuantityPerTrip: null,
        });
        expect(result.movementPlan.unallocatedRequirements).toContainEqual({
            scope: 'internally-produced-plan-dependency',
            itemId: 'intermediate',
            producerStepIndex: 0,
            consumerStepIndex: 1,
            destinationPlacementId: 'destination-a',
            requiredQuantity: 2,
            allocatedQuantity: 0,
            unallocatedQuantity: 2,
            reasons: ['destination-capacity-evidence-unavailable'],
        });
    });

    it('rejects a purchased-input total that disagrees with production-step demand', () => {
        const inputPlan = plan();
        const purchase = inputPlan.purchases[0]!;

        expect(() => new BlueprintProductionLogisticsAnalyzer(
            dataset({ employeeCapacity: 3 })
        ).analyze(logisticsBlueprint(), {
            ...inputPlan,
            purchases: [{ ...purchase, requiredQuantity: 3 }],
        })).toThrow('Purchased input raw requirement is inconsistent');
    });
});

describe('blueprint production business assessment', () => {
    it('composes existing blueprint costs, wages, capacity, schedule, and blockers', () => {
        const inputDataset = datasetWithPlacementCollidersAtZ(100);
        const result = new BlueprintProductionBusinessAssessmentAnalyzer({
            ...inputDataset,
            shops: [businessShop([
                businessListing('source-station', 100),
                businessListing('destination-station', 200),
                businessListing('storage', 50),
            ])],
        }).analyze(logisticsBlueprint(), plan());

        expect(result).toMatchObject({
            scope: 'blueprint-base-production-business-assessment',
            constructionCost: {
                status: 'complete',
                proof: 'exact-minimum-listed-cost',
                pricedSubtotal: 650,
                minimumListedCost: 650,
            },
            configuredLabor: {
                status: 'complete',
                proof: 'exact',
                knownDailyWage: 600,
                totalDailyWage: 600,
            },
            installedCapacity: {
                status: 'partial',
                proof: 'exact-installed-unit-counts',
                totalInstalledUnitCount: 4,
            },
            scheduledDuration: {
                status: 'complete',
                proof: 'exact-selected-schedule',
                scheduledElapsedMinutes: 5,
                selectedScheduleOptimality: 'not-proven',
                employeeExecutionComposition: 'not-applied',
            },
            profit: {
                status: 'not-supplied',
                expectationBasis: 'not-modeled-realized-sale-evidence-only',
                constructionCostTreatment: 'independent-not-automatically-attributed',
                realizedProfit: null,
            },
            operationalFeasibility: {
                status: 'blocked',
                placement: 'clear',
                schedule: 'clear',
                logistics: 'clear',
                movement: 'blocked',
                physical: 'clear',
                limitations: [
                    'runtime-storage-contents-not-evaluated',
                    'employee-task-sequence-and-readiness-not-evaluated',
                    'aggregate-movement-time-not-composed',
                    'dynamic-obstacles-not-evaluated',
                ],
            },
        });
        expect(result.installedCapacity.equipment).toEqual([
            {
                itemId: 'destination-station',
                installedUnitCount: 2,
                itemLimitPerUnit: null,
                installedItemLimit: null,
                itemLimitProof: 'not-recorded',
            },
            {
                itemId: 'source-station',
                installedUnitCount: 2,
                itemLimitPerUnit: null,
                installedItemLimit: null,
                itemLimitProof: 'not-recorded',
            },
        ]);
        expect(result.operationalFeasibility.unallocatedMovementRequirements).not.toEqual([]);
    });

    it('keeps unlisted construction items and unavailable role wages incomplete', () => {
        const inputDataset = datasetWithPlacementCollidersAtZ(100);
        const result = new BlueprintProductionBusinessAssessmentAnalyzer({
            ...inputDataset,
            productionLogistics: {
                ...inputDataset.productionLogistics,
                employeeRoles: inputDataset.productionLogistics.employeeRoles.filter((role) =>
                    role.employeeType !== 'Handler'
                ),
            },
            shops: [businessShop([businessListing('storage', 50)])],
        }).analyze(logisticsBlueprint(), plan());

        expect(result.constructionCost).toEqual({
            status: 'incomplete',
            proof: 'partial-listed-subtotal',
            source: 'blueprint-item-cost-summary',
            pricingBasis: 'minimum-listed-price-per-item',
            pricedSubtotal: 50,
            minimumListedCost: null,
            unlistedItemIds: ['destination-station', 'source-station'],
        });
        expect(result.configuredLabor).toMatchObject({
            status: 'incomplete',
            proof: 'incomplete',
            knownDailyWage: 400,
            totalDailyWage: null,
            missingWageEmployeeIds: ['handler-1'],
        });
        expect(result.operationalFeasibility).toMatchObject({
            status: 'blocked',
            logistics: 'blocked',
            logisticsIssueCodes: ['employee-role-unavailable'],
        });
    });

    it('distinguishes unavailable movement evidence from a proven operational block', () => {
        const inputDataset = datasetWithPlacementCollidersAtZ(100);
        const destination = inputDataset.productionLogistics.stations.find((station) =>
            station.itemId === 'destination-station'
        )!;
        destination.inputSlots[0]!.filters = [{
            nativeType: 'ScheduleOne.ItemFramework.ItemFilter_Dryable',
            isWhitelist: null,
            itemIds: [],
            categories: [],
        }];
        const inputBlueprint = logisticsBlueprint();
        const handler = inputBlueprint.productionLogistics.employees.find((employee) =>
            employee.employeeType === 'Handler'
        )!;
        handler.handlerRoutes.push(
            {
                id: 'source-b-to-destination-b',
                sourcePlacementId: 'source-b',
                destinationPlacementId: 'destination-b',
                filter: { mode: 'whitelist', itemIds: ['intermediate'] },
            },
            {
                id: 'raw-to-source-b',
                sourcePlacementId: 'raw-storage',
                destinationPlacementId: 'source-b',
                filter: { mode: 'whitelist', itemIds: ['raw'] },
            }
        );
        const result = new BlueprintProductionBusinessAssessmentAnalyzer({
            ...inputDataset,
            shops: [],
        }).analyze(inputBlueprint, plan());

        expect(result.operationalFeasibility).toMatchObject({
            status: 'incomplete',
            placement: 'clear',
            schedule: 'clear',
            logistics: 'clear',
            movement: 'incomplete',
            physical: 'clear',
        });
        expect(result.operationalFeasibility.unallocatedMovementRequirements)
            .toContainEqual(expect.objectContaining({
                reasons: ['destination-capacity-evidence-unavailable'],
            }));
    });

    it('keeps every dependent business value unavailable for an invalid blueprint', () => {
        const inputBlueprint = {
            ...blueprint([]),
            datasetSha256: 'b'.repeat(64),
        };
        const result = new BlueprintProductionBusinessAssessmentAnalyzer({
            ...datasetWithPlacementCollidersAtZ(100),
            shops: [],
        }).analyze(inputBlueprint, emptyProductionPlan());

        expect(result).toMatchObject({
            constructionCost: { status: 'unavailable', minimumListedCost: null },
            configuredLabor: { status: 'unavailable', totalDailyWage: null },
            installedCapacity: { status: 'unavailable', totalInstalledUnitCount: null },
            scheduledDuration: { status: 'unavailable', scheduledElapsedMinutes: null },
            operationalFeasibility: {
                status: 'blocked',
                placement: 'blocked',
                placementIssueCodes: ['dataset-mismatch'],
                schedule: 'blocked',
                logistics: 'blocked',
                movement: 'not-applicable',
                physical: 'not-applicable',
            },
        });
    });

    it('reports exact realized profit only from matching complete lifecycle evidence', () => {
        const inputPlan = emptyProductionPlan();
        const profitInput = completeBusinessProfitInput(inputPlan);
        const inputBlueprint = blueprint([placement('storage-one', 'storage', 0)]);
        const analyzer = new BlueprintProductionBusinessAssessmentAnalyzer({
            ...datasetWithPlacementCollidersAtZ(100),
            shops: [businessShop([businessListing('storage', 50)])],
        });
        const result = analyzer.analyze(inputBlueprint, inputPlan, profitInput);

        expect(result).toMatchObject({
            constructionCost: {
                status: 'complete',
                minimumListedCost: 50,
            },
            configuredLabor: {
                status: 'complete',
                totalDailyWage: 0,
            },
            installedCapacity: {
                status: 'complete',
                totalInstalledUnitCount: 0,
                equipment: [],
            },
            scheduledDuration: {
                status: 'complete',
                scheduledElapsedMinutes: 0,
            },
            profit: {
                status: 'complete',
                proof: 'exact',
                recordedRevenue: 100,
                attributedCost: 30,
                realizedProfit: 70,
                profitPerGameMinute: 14,
            },
            operationalFeasibility: {
                status: 'clear',
                movement: 'not-applicable',
                physical: 'not-applicable',
                limitations: [],
            },
        });

        const incompleteRevenue = analyzer.analyze(inputBlueprint, inputPlan, {
            ...profitInput,
            revenue: { ...profitInput.revenue, coverage: 'partial' },
        });
        expect(incompleteRevenue.profit).toMatchObject({
            status: 'unavailable',
            proof: 'incomplete',
            recordedRevenue: 100,
            attributedCost: 30,
            realizedProfit: null,
            profitPerGameMinute: null,
        });
        expect(incompleteRevenue.sourceResults.realizedProfit?.gaps)
            .toContainEqual({ code: 'realized-revenue-incomplete' });

        const incompleteCosts = analyzer.analyze(inputBlueprint, inputPlan, {
            ...profitInput,
            costs: {
                ...profitInput.costs,
                coverage: 'partial',
                treatments: [{ category: 'materials', treatment: 'included', amount: 20 }],
            },
        });
        expect(incompleteCosts.profit).toMatchObject({
            status: 'unavailable',
            proof: 'incomplete',
            attributedCost: 20,
            realizedProfit: null,
            profitPerGameMinute: null,
        });
        expect(incompleteCosts.sourceResults.realizedProfit?.gaps)
            .toContainEqual({ code: 'attributed-cost-coverage-incomplete' });

        expect(() => analyzer.analyze(inputBlueprint, {
            ...inputPlan,
            targetQuantity: 3,
        }, profitInput)).toThrow('does not match the blueprint production plan');
        expect(() => analyzer.analyze(inputBlueprint, inputPlan, {
            ...profitInput,
            lifecycleInput: {
                ...profitInput.lifecycleInput,
                readiness: {
                    ...profitInput.lifecycleInput.readiness,
                    propertyId: 'other-property',
                },
            },
        })).toThrow('does not match the blueprint property');
    });
});

interface DatasetOptions {
    readonly employeeCapacity?: number;
    readonly missingSourceTransitPoint?: boolean;
    readonly multipleTransitPoints?: boolean;
}

function analyzer(options: DatasetOptions = {}): BlueprintProductionTransferAnalyzer {
    return new BlueprintProductionTransferAnalyzer(dataset(options));
}

function plan(): ProductionBatchPlan {
    return {
        dataset: { gameVersion, datasetSha256 },
        targetItemId: 'final',
        targetQuantity: 2,
        totalProcessMinutes: 10,
        requiredMaterialCost: 2,
        purchaseCost: 2,
        purchases: [{
            itemId: 'raw',
            requiredQuantity: 2,
            purchaseQuantity: 2,
            leftoverQuantity: 0,
            unitCost: 1,
            requiredCost: 2,
            purchaseCost: 2,
        }],
        productionSteps: [
            {
                itemId: 'intermediate',
                routeId: 'recipe:intermediate',
                method: 'station-recipe',
                requiredQuantity: 4,
                batchCount: 2,
                outputQuantityPerBatch: 3,
                durationMinutesPerBatch: 2,
                acceptedEquipmentItemIds: ['source-station'],
                equipmentItemId: 'source-station',
                growLightItemId: null,
                additiveItemIds: [],
                quality: null,
                totalProcessMinutes: 4,
                producedQuantity: 6,
                leftoverQuantity: 2,
                inputs: [{ itemId: 'raw', quantityPerBatch: 1, totalQuantity: 2 }],
            },
            {
                itemId: 'final',
                routeId: 'recipe:final',
                method: 'station-recipe',
                requiredQuantity: 2,
                batchCount: 2,
                outputQuantityPerBatch: 1,
                durationMinutesPerBatch: 3,
                acceptedEquipmentItemIds: ['destination-station'],
                equipmentItemId: 'destination-station',
                growLightItemId: null,
                additiveItemIds: [],
                quality: null,
                totalProcessMinutes: 6,
                producedQuantity: 2,
                leftoverQuantity: 0,
                inputs: [
                    { itemId: 'intermediate', quantityPerBatch: 1, totalQuantity: 2 },
                    { itemId: 'intermediate', quantityPerBatch: 1, totalQuantity: 2 },
                ],
            },
        ],
    };
}

function seedPlan(): ProductionBatchPlan {
    return {
        dataset: { gameVersion, datasetSha256 },
        targetItemId: 'leaf',
        targetQuantity: 4,
        totalProcessMinutes: 60,
        requiredMaterialCost: 0,
        purchaseCost: 0,
        purchases: [],
        productionSteps: [{
            itemId: 'leaf',
            routeId: 'seed:seed:leaf:soil',
            method: 'seed-harvest',
            requiredQuantity: 4,
            batchCount: 1,
            outputQuantityPerBatch: 4,
            durationMinutesPerBatch: 60,
            acceptedEquipmentItemIds: ['pot'],
            equipmentItemId: 'pot',
            growLightItemId: null,
            additiveItemIds: [],
            quality: { level: 0.5, tier: 'Standard', customerScalar: 0.5 },
            totalProcessMinutes: 60,
            producedQuantity: 4,
            leftoverQuantity: 0,
            inputs: [
                { itemId: 'seed', quantityPerBatch: 1, totalQuantity: 1 },
                { itemId: 'soil', quantityPerBatch: 1, totalQuantity: 1 },
            ],
        }],
    };
}

function layoutBlueprint(): BlueprintDocument {
    return blueprint([
        placement('source-b', 'source-station', 1),
        placement('destination-b', 'destination-station', 3),
        placement('source-a', 'source-station', 0),
        placement('destination-a', 'destination-station', 2),
    ]);
}

function logisticsBlueprint(): BlueprintDocument {
    const base = layoutBlueprint();
    return {
        ...base,
        placements: [...base.placements, placement('raw-storage', 'storage', 4)],
        productionLogistics: {
            supplies: [{
                id: 'raw-supply',
                itemId: 'raw',
                sourcePlacementId: 'raw-storage',
                quantity: 2,
            }],
            employees: [
                {
                    id: 'botanist-1',
                    employeeType: 'Botanist',
                    assignedPotPlacementIds: ['source-b'],
                    supplyPlacementId: 'raw-storage',
                },
                {
                    id: 'chemist-1',
                    employeeType: 'Chemist',
                    assignedStationPlacementIds: ['destination-b'],
                },
                {
                    id: 'handler-1',
                    employeeType: 'Handler',
                    assignedStationPlacementIds: [],
                    handlerRoutes: [
                        {
                            id: 'first-ready',
                            sourcePlacementId: 'source-a',
                            destinationPlacementId: 'destination-a',
                            filter: { mode: 'blacklist', itemIds: ['raw'] },
                        },
                        {
                            id: 'second-ready',
                            sourcePlacementId: 'source-a',
                            destinationPlacementId: 'destination-a',
                            filter: { mode: 'whitelist', itemIds: ['intermediate'] },
                        },
                        {
                            id: 'raw-to-source-a',
                            sourcePlacementId: 'raw-storage',
                            destinationPlacementId: 'source-a',
                            filter: { mode: 'whitelist', itemIds: ['raw'] },
                        },
                    ],
                },
            ],
        },
    };
}

function blueprint(placements: BlueprintDocument['placements']): BlueprintDocument {
    return {
        schema: 'neonschedule1-blueprint-4',
        gameVersion,
        datasetSha256,
        propertyCode: 'warehouse',
        productionLogistics: { employees: [], supplies: [] },
        placements,
    };
}

function placement(
    id: string,
    itemId: string,
    x: number
): BlueprintDocument['placements'][number] {
    return { id, kind: 'grid', itemId, gridId: 'main', anchor: { x, y: 0 }, rotation: 0 };
}

function dataset(options: DatasetOptions): BlueprintProductionLogisticsDataset {
    const transitAccessPoints = options.multipleTransitPoints
        ? [transform('TransitAccess/[0]', 1), transform('TransitAccess/[1]', 1.5)]
        : [transform('TransitAccess', 1)];
    return {
        manifest: { gameVersion, datasetSha256 },
        properties: [property(options.employeeCapacity ?? 2)],
        buildables: [
            buildable(
                'source-station',
                options.missingSourceTransitPoint ? [] : transitAccessPoints
            ),
            buildable('destination-station', transitAccessPoints),
            buildable('storage', transitAccessPoints),
        ],
        propertyLayouts: [propertyLayout()],
        production: production(),
        productionLogistics: logisticsCatalog(),
        items: [
            item('raw', 20),
            item('intermediate', 10),
            item('final', 5),
        ],
        navigation: navigation(),
    };
}

function datasetWithPlacementCollidersAtZ(z: number): BlueprintProductionLogisticsDataset {
    const input = dataset({ employeeCapacity: 3 });
    return {
        ...input,
        buildables: input.buildables.map((buildable) => ({
            ...buildable,
            colliders: buildable.colliders.map((placementCollider) => ({
                ...placementCollider,
                transform: {
                    ...placementCollider.transform,
                    localPosition: vector(0, 0, z),
                    worldPosition: vector(0, 0, z),
                },
                worldBounds: {
                    ...placementCollider.worldBounds,
                    center: vector(0, 0, z),
                },
            })),
        })),
    };
}

function seedDataset(): BlueprintProductionLogisticsDataset {
    const base = dataset({ employeeCapacity: 1 });
    return {
        ...base,
        buildables: [
            buildable('pot', [transform('TransitAccess', 1)]),
            buildable('storage', [transform('TransitAccess', 1)]),
        ],
        items: [item('leaf', 20)],
        production: {
            ...production(),
            seeds: [{
                schema: 'neonschedule1-seed-production-3',
                seedItemId: 'seed',
                soilItemIds: ['soil'],
                plantRuntimeType: 'Game.Plant',
                growthTimeMinutes: 60,
                baseYieldQuantity: 4,
                harvestTarget: 'leaf',
                harvestProducts: [{ itemId: 'leaf', quantity: 1 }],
            }],
            stationRecipes: [],
            stations: [{
                schema: 'neonschedule1-production-station-4',
                itemId: 'pot',
                kind: 'grow-container',
                yieldMultiplier: 1,
                growSpeedMultiplier: 1,
                requiresExternalGrowLight: false,
                maxTemperatureGrowthMultiplier: 1.5,
                minimumTemperatureThreshold: 20,
                maximumTemperatureThreshold: 40,
                allowedSoilIds: ['soil'],
                allowedAdditiveIds: [],
            }],
        },
        productionLogistics: {
            ...base.productionLogistics,
            employeeRoles: base.productionLogistics.employeeRoles.map((role) =>
                role.employeeType === 'Botanist' ? { ...role, baseWorkSpeed: 2 } : role
            ),
            stations: [station('pot', 1, [])],
        },
    };
}

function logisticsCatalog(): BlueprintProductionLogisticsDataset['productionLogistics'] {
    return {
        schema: 'neonschedule1-production-logistics-2',
        routeRules: {
            filterModes: ['whitelist', 'blacklist'],
            selection: 'stored-order-first-ready',
            movedQuantityLimits: [
                'source-quantity',
                'requested-maximum',
                'destination-input-capacity',
            ],
            accessPointSelection: 'npc-reachable',
        },
        handlerTaskPriority: [
            'packaging-station-work',
            'brick-press-work',
            'packaging-station-supply-move',
            'brick-press-supply-move',
            'configured-transit-route',
        ],
        employeeScheduling: {
            dispatchAuthority: 'server',
            dispatchPrerequisite: 'can-work-and-no-active-behaviour',
            taskSelection: 'first-ready-in-native-priority-order',
            taskReadiness: 'native-mutable-runtime-state-not-recorded',
            workAvailability: {
                employeeHome: 'required',
                dailyPayment: 'paid-for-today-required-auto-from-employee-home-cash',
                shiftSchedule: 'no-fixed-shift',
                endOfDayTime: 400,
                consumeProduct: 'blocks-work',
            },
            movement: {
                taskOrigin: 'current-npc-position',
                completionPosition: 'task-endpoint-until-subsequent-behaviour',
                taskChaining: 'each-selected-task-starts-from-then-current-npc-position',
                growContainerItemSource: 'employee-inventory-otherwise-assigned-supplies',
                growContainerTaskKinds: [
                    'grow-container-watering-below-0.2',
                    'mushroom-bed-misting-below-0.2',
                    'grow-container-additive',
                    'grow-container-soil-pour',
                    'pot-sow-seed',
                    'mushroom-bed-apply-spawn',
                    'pot-harvest',
                    'mushroom-bed-harvest',
                    'grow-container-watering-below-0.3',
                    'mushroom-bed-misting-below-0.3',
                ],
                growContainerTaskLegs: [
                    'current-to-supplies-if-required-item-missing',
                    'supplies-to-grow-container-if-supplies-visited',
                    'current-to-grow-container-otherwise',
                ],
                stationTaskKinds: [
                    'drying-rack-stop',
                    'mushroom-spawn-station-work',
                    'lab-oven-finish',
                    'lab-oven-start',
                    'chemistry-station-start',
                    'cauldron-start',
                    'mixing-station-start',
                ],
                stationTaskLegs: ['current-to-station-access-point'],
                moveItemTaskKinds: [
                    'drying-rack-output-move',
                    'mushroom-spawn-station-output-move',
                    'drying-rack-input-move',
                    'lab-oven-output-move',
                    'chemistry-station-output-move',
                    'cauldron-output-move',
                    'mixing-station-output-move',
                ],
                moveItemTaskLegs: [
                    'current-to-source-access-point',
                    'source-to-destination-access-point',
                ],
                legFrequency: 'once-per-selected-task-activation-if-not-already-at-endpoint',
            },
            botanistTaskPriority: [
                'grow-container-watering-below-0.2',
                'mushroom-bed-misting-below-0.2',
                'grow-container-additive',
                'grow-container-soil-pour',
                'pot-sow-seed',
                'mushroom-bed-apply-spawn',
                'pot-harvest',
                'mushroom-bed-harvest',
                'drying-rack-stop',
                'drying-rack-output-move',
                'mushroom-spawn-station-work',
                'mushroom-spawn-station-output-move',
                'grow-container-watering-below-0.3',
                'mushroom-bed-misting-below-0.3',
                'drying-rack-input-move',
            ],
            chemistTaskPriority: [
                'lab-oven-finish',
                'lab-oven-start',
                'chemistry-station-start',
                'cauldron-start',
                'mixing-station-start',
                'lab-oven-output-move',
                'chemistry-station-output-move',
                'cauldron-output-move',
                'mixing-station-output-move',
            ],
            cleanerTaskPriority: [
                'dispose-nearby-trash-bag',
                'pick-up-reachable-loose-trash',
                'empty-full-trash-grabber',
                'bag-trash-can-at-or-above-threshold',
            ],
            cleanerRules: {
                assignedBinSelection: 'nearest-current-position-first',
                trashBagSelection: 'first-in-bin-stored-order',
                looseTrashSelection: 'first-npc-reachable-in-bin-stored-order',
                trashGrabberCapacity: 20,
                looseTrashReachabilityDistance: 1,
                nonFullBinThreshold: 1,
                baggingThreshold: 0.75,
                trashBagDisposalDestination: 'assigned-property-disposal-area-required',
                binAccessPointSelection: 'npc-reachable',
                actionMaximumDistance: 2,
                dynamicTrashState: 'not-recorded',
            },
        },
        employeeRoles: [
            employeeRole('Botanist', 8, null, ['station-specific']),
            employeeRole('Chemist', 4, null, ['station-specific']),
            employeeRole('Handler', 3, 5, [
                'assigned-station-supply',
                'configured-route',
            ]),
        ],
        stations: [
            station('source-station', 1, []),
            station('destination-station', 2, [{
                nativeType: 'ScheduleOne.ItemFramework.ItemFilter_ID',
                isWhitelist: true,
                itemIds: ['intermediate'],
                categories: [],
            }]),
        ],
    };
}

function employeeRole(
    employeeType: 'Botanist' | 'Chemist' | 'Handler',
    assignmentLimit: number,
    configuredRouteLimit: number | null,
    movementKinds: BlueprintProductionLogisticsDataset['productionLogistics']['employeeRoles'][number]['movementKinds']
): BlueprintProductionLogisticsDataset['productionLogistics']['employeeRoles'][number] {
    return {
        employeeType,
        runtimeType: `Game.${employeeType}`,
        dailyWage: 200,
        baseWorkSpeed: 1,
        walkSpeed: 2,
        inventorySlotCount: 5,
        assignmentKind: employeeType === 'Botanist' ? 'pots' : 'stations',
        assignmentLimit,
        configuredRouteLimit,
        movementKinds,
    };
}

function station(
    itemId: string,
    inputSlotCount: number,
    filters: BlueprintProductionLogisticsDataset['productionLogistics']['stations'][number]['inputSlots'][number]['filters']
): BlueprintProductionLogisticsDataset['productionLogistics']['stations'][number] {
    return {
        itemId,
        kind: 'fixture',
        inputSlots: Array.from({ length: inputSlotCount }, (_, index) => ({
            index,
            filters: filters.map((filter) => ({ ...filter })),
        })),
        outputSlots: [{ index: 0, filters: [] }],
    };
}

function item(id: string, stackLimit: number): BlueprintProductionLogisticsDataset['items'][number] {
    return {
        schema: 'neonschedule1-item-3',
        id,
        name: id,
        category: 'Ingredient',
        isRuntimeOnly: false,
        stackLimit,
        isStorable: true,
        basePurchasePrice: null,
        resellMultiplier: 0.5,
        requiredRank: null,
        requiredRankTier: null,
        product: null,
        packaging: null,
        additive: null,
        soil: null,
        mixingIngredient: null,
        presentation: {
            description: '',
            iconFileId: null,
            visualKind: 'none',
            fallbackMeshIds: [],
            fallbackMaterialIds: [],
        },
    };
}

function dryingRules(): ProductionCatalog['drying'] {
    return {
        schema: 'neonschedule1-drying-operation-rules-1',
        requiresUnpackagedProduct: true,
        acceptedProductDrugTypes: ['Cocaine', 'Marijuana', 'Methamphetamine'],
        specialQualityItemIdSubstring: 'cocaleaf',
        specialItemRequiresQualityInstance: true,
        maximumQualityTier: 'Heavenly',
        itemIdTransformation: 'preserved',
        quantityTransformation: 'preserved',
        qualityTierIncrement: 1,
    };
}

function production(): ProductionCatalog {
    return {
        schema: 'neonschedule1-production-catalog-9',
        drying: dryingRules(),
        packaging: { ...PACKAGING_OPERATION_RULES },
        brickPressing: { ...BRICK_PRESS_OPERATION_RULES },
        quality: {
            basePlantLevel: 0.5,
            monetaryValueVariesByQuality: false,
            customerQualityMaxEffect: 0.3,
            tiers: [{ name: 'Standard', minimumLevelExclusive: null, customerScalar: 0.5 }],
        },
        seeds: [],
        shrooms: [],
        stationRecipes: [
            {
                schema: 'neonschedule1-station-recipe-2',
                id: 'intermediate',
                title: 'Intermediate',
                cookTimeMinutes: 2,
                cookTemperature: 100,
                cookTemperatureTolerance: 10,
                qualityCalculationMethod: 'Additive',
                acceptedEquipmentItemIds: ['source-station'],
                ingredients: [{ quantity: 1, acceptedItemIds: ['raw'] }],
                outputItemId: 'intermediate',
                outputQuantity: 3,
            },
            {
                schema: 'neonschedule1-station-recipe-2',
                id: 'final',
                title: 'Final',
                cookTimeMinutes: 3,
                cookTemperature: 100,
                cookTemperatureTolerance: 10,
                qualityCalculationMethod: 'Additive',
                acceptedEquipmentItemIds: ['destination-station'],
                ingredients: [
                    { quantity: 1, acceptedItemIds: ['intermediate'] },
                    { quantity: 1, acceptedItemIds: ['intermediate'] },
                ],
                outputItemId: 'final',
                outputQuantity: 1,
            },
        ],
        ovenTransforms: [],
        stations: [],
    };
}

function property(employeeCapacity: number): Property {
    return {
        schema: 'neonschedule1-property-1',
        code: 'warehouse',
        name: 'Warehouse',
        price: 0,
        employeeCapacity,
        loadingDockCount: 0,
        gridCount: 1,
        ambientTemperature: 20,
        ownedByDefault: false,
        position: vector(0, 0, 0),
        business: null,
        hasLayout: true,
    };
}

function buildable(itemId: string, transitAccessPoints: Transform[]): Buildable {
    return {
        schema: 'neonschedule1-buildable-5',
        itemId,
        runtimeType: 'Game.GridItem',
        placement: {
            kind: 'grid',
            holdDistance: 3,
            footprintWidth: 1,
            footprintHeight: 1,
            proceduralTileType: null,
            tileSharingRule: 'standard',
            tileSharingImplementation: 'Game.GridItem',
            allowRotation: null,
            rotationIncrement: null,
            validSurfaceTypes: [],
            buildPoint: transform('BuildPoint', 0),
            midAirCenterPoint: null,
            boundingCollider: collider(),
            footprintTiles: [{
                x: 0,
                y: 0,
                requiredOffset: 0,
                transform: transform('Footprint/[0,0]', 0),
                cornerObstacles: [],
            }],
        },
        componentTypes: [],
        colliders: [collider()],
        storage: itemId === 'storage' ? {
            name: 'Storage',
            subtitle: '',
            slotCount: 3,
            displayRowCount: 1,
            slotsAreFilterable: true,
            maxAccessDistance: 2,
            transform: transform('Storage', 0),
        } : null,
        temperatureEmitters: [],
        interactionPoints: [],
        isTransitEntity: true,
        transitAccessPoints,
        trash: null,
        proceduralTiles: [],
        visuals: { renderers: [], meshes: [] },
    };
}

function propertyLayout(): PropertyLayout {
    return {
        schema: 'neonschedule1-property-layout-4',
        propertyCode: 'warehouse',
        propertyName: 'Warehouse',
        worldPosition: vector(0, 0, 0),
        worldRotation: vector(0, 0, 0),
        spawnPoint: transform('Spawn', 0),
        interiorSpawnPoint: transform('InteriorSpawn', 0),
        npcSpawnPoint: transform('NpcSpawn', 0),
        boundingBox: null,
        boundaryColliders: [],
        fixedColliders: [],
        surfaceMeshes: [],
        surfaces: [],
        proceduralTiles: [],
        loadingDocks: [],
        grids: [{
            id: 'main',
            width: 5,
            height: 1,
            tileSize: 4,
            worldOrigin: vector(0, 0, 0),
            tiles: Array.from({ length: 5 }, (_, x) => ({
                x,
                y: 0,
                availableOffset: 0,
                worldPosition: vector(4 * x, 0, 0),
                worldRotation: vector(0, 0, 0),
            })),
        }],
        visuals: { renderers: [], meshes: [] },
    };
}

function navigation(): NavigationGraph {
    const positions = [0, 1, 5, 9, 13, 17].map((x) => vector(x, 0, 0));
    return {
        schema: 'neonschedule1-navigation-graph-2',
        method: 'test',
        agent: {
            source: 'employee-prefabs',
            typeId: 7,
            name: 'Employee',
            radius: 0.35,
            height: 1.8,
            maximumSlope: 45,
            stepHeight: 0.4,
            employeeTypes: ['Botanist', 'Chemist'],
        },
        sampleSpacing: 2,
        queryHeight: 0,
        maxSampleDistance: 12,
        boundsMinimum: vector(-20, -20, -20),
        boundsMaximum: vector(20, 20, 20),
        gridWidth: positions.length,
        gridHeight: 1,
        samples: positions.map((position, index) => ({
            gridX: index,
            gridZ: 0,
            position,
            areaMask: 1,
        })),
        edges: positions.slice(1).map((_, index) => ({ sampleA: index, sampleB: index + 1 })),
    };
}

function collider(): Collider {
    const zero = vector(0, 0, 0);
    const one = vector(1, 1, 1);
    return {
        source: 'fixture',
        runtimeType: 'UnityEngine.BoxCollider',
        shape: 'box',
        enabled: true,
        isTrigger: false,
        layer: 0,
        layerName: 'Default',
        tag: 'Untagged',
        transform: transform('Bounds', 0),
        worldScale: one,
        worldBasis: { right: vector(1, 0, 0), up: vector(0, 1, 0), forward: vector(0, 0, 1) },
        worldBounds: { center: zero, size: one },
        localCenter: zero,
        localSize: one,
        radius: null,
        height: null,
        direction: null,
        meshName: null,
        meshId: null,
        meshIsReadable: null,
        isConvex: null,
    };
}

function transform(path: string, x: number): Transform {
    return {
        name: path,
        path,
        worldPosition: vector(x, 0, 0),
        localPosition: vector(x, 0, 0),
        worldRotation: vector(0, 0, 0),
        localScale: vector(1, 1, 1),
    };
}

function vector(x: number, y: number, z: number): Vector3 {
    return { x, y, z };
}

function businessShop(listings: Shop['listings']): Shop {
    return {
        schema: 'neonschedule1-shop-1',
        code: 'business-shop',
        name: 'Business shop',
        description: '',
        paymentType: 'Cash',
        sceneName: 'Main',
        locationSource: 'shop-position',
        position: null,
        rotation: null,
        holderPersonId: null,
        openTime: null,
        closeTime: null,
        deliveryBayPositions: [],
        listings,
    };
}

function businessListing(itemId: string, price: number): Shop['listings'][number] {
    return { itemId, price, defaultStock: null, canBeDelivered: false };
}

function emptyProductionPlan(): ProductionBatchPlan {
    return {
        dataset: { gameVersion, datasetSha256 },
        targetItemId: 'final',
        targetQuantity: 2,
        productionSteps: [],
        purchases: [],
        totalProcessMinutes: 0,
        requiredMaterialCost: 0,
        purchaseCost: 0,
    };
}

function completeBusinessProfitInput(
    baseProductPlan: ProductionBatchPlan
): FinishedRecipeRealizedProfitInput {
    const productionPlan: FinishedRecipeProductionPlan = {
        dataset: { ...baseProductPlan.dataset },
        recipe: {
            ruleProfile: { kind: 'standard' },
            productId: baseProductPlan.targetItemId,
            ingredientIds: [],
            effectIds: [],
            productValue: 50,
            baseProductCost: 10,
            baseProductCostBasis: 'base-purchase-price',
            ingredientCost: 0,
            totalCost: 10,
            netValue: 40,
            ingredientCount: 0,
        },
        finishedQuantity: baseProductPlan.targetQuantity,
        baseProductPlan,
        growAdditiveSteps: [],
        ingredientDemands: [],
        purchases: [],
        mixingSteps: [],
        dryingStep: null,
        packagingStep: null,
        brickPressingStep: null,
        equipment: {
            quantityBasis: 'minimum-one-per-selected-item-for-serial-plan',
            selectionProof: 'exact',
            unresolvedProductionRouteIds: [],
            purchaseCostProof: 'exact',
            requirements: [],
            totalRequiredPurchaseCost: 0,
        },
        inventory: {
            allocationOrder: 'reserve-equipment-before-recurring-materials',
            demandProof: 'exact',
            inventoryProof: 'supplied',
            quantityProof: 'exact',
            costProof: 'exact',
            requirements: [],
            totalMaterialReorderCost: 0,
            totalEquipmentReorderCost: 0,
            totalReorderCost: 0,
            requiredStackCount: 0,
            currentStackCount: 0,
            reorderStackCount: 0,
            postReorderStackCount: 0,
            additionalStackCount: 0,
        },
        duration: {
            baseProductProcessMinutes: 0,
            mixingProcessMinutes: 0,
            dryingProcessMinutes: null,
            packagingEmployeeRealSeconds: null,
            brickPressingEmployeeRealSeconds: null,
            knownProcessMinutes: 0,
            modeledTotalProcessMinutes: 0,
        },
        cost: {
            recipeEstimatedUnitMaterialCost: 10,
            recipeEstimatedMaterialCost: 20,
            requiredMaterialCost: 0,
            materialReorderCost: 0,
            equipmentReorderCost: 0,
            combinedReorderCost: 0,
        },
        evidence: {
            modeledScope: 'base-product-and-ordered-mixing',
            modeledQuantityProof: 'exact',
            materialCostCoverage: 'modeled-materials-only',
            modeledDurationProof: 'complete',
            finishedLifecycleProof: 'partial',
            missingFacts: [],
            dryingApplicability: 'not-applicable',
            packagingApplicability: 'not-applicable',
            brickPressingApplicability: 'not-applicable',
            unmodeledOperations: [],
        },
    };
    const lifecycleInput = {
        readiness: {
            propertyId: 'warehouse',
            productionPlan,
            transferPlan: {
                objective: 'maximize-transferred-reorder-quantity-per-item' as const,
                tieBreak: 'canonical-item-source-destination-candidate-identity-order' as const,
                routeOptimization: 'not-evaluated' as const,
                demandProof: 'exact' as const,
                transferEvidenceProof: 'exact' as const,
                allocationProof: 'maximum' as const,
                residualProof: 'exact' as const,
                residualCostProof: 'exact' as const,
                requirements: [],
                sources: [],
                allocations: [],
                totalRequestedReorderQuantity: 0,
                knownAllocatedQuantity: 0,
                unallocatedAfterKnownTransfersQuantity: 0,
                totalResidualReorderQuantity: 0,
                totalResidualMaterialReorderCost: 0,
                totalResidualEquipmentReorderCost: 0,
                totalResidualReorderCost: 0,
            },
            purchasePlan: {
                objective: 'maximize-supported-fulfillment-then-minimize-cost-per-item' as const,
                tieBreak: 'unit-price-then-shop-code' as const,
                routeOptimization: 'not-evaluated' as const,
                timingProof: 'not-evaluated' as const,
                demandProof: 'exact' as const,
                sellerEvidenceProof: 'exact' as const,
                allocationProof: 'minimum-cost' as const,
                fulfillmentProof: 'exact' as const,
                requirements: [],
                items: [],
                allocations: [],
                totalRequestedQuantity: 0,
                knownAllocatedQuantity: 0,
                unallocatedAfterSupportedPurchases: 0,
                totalFinalUnallocatedQuantity: 0,
                knownAllocatedCost: 0,
                minimumRequiredPurchaseCost: 0,
            },
            shopping: {
                dataset: { ...baseProductPlan.dataset },
                arrivalDestination: {
                    kind: 'production-property' as const,
                    propertyId: 'warehouse',
                    evidence: 'caller-supplied-depot-and-remote-delivery-destination' as const,
                },
                route: {
                    kind: 'planned' as const,
                    plan: {
                        objective: 'minimum-elapsed-minutes' as const,
                        tieBreak:
                            'remaining-metrics-then-trip-count-then-canonical-shop-item-identity-order' as const,
                        movementModelId: 'test',
                        carryingModel: 'caller-supplied-load-units' as const,
                        tripModel: 'each-trip-starts-and-returns-to-depot' as const,
                        scheduleModel:
                            'service-start-must-be-within-recurring-shop-window' as const,
                        remoteDeliveryModel:
                            'caller-supplied-concurrent-duration-from-route-start' as const,
                        proof: 'optimal' as const,
                        evidenceProof: 'complete' as const,
                        searchProof: 'exhaustive' as const,
                        evidenceGaps: [],
                        visitedStates: 1,
                        maximumStates: 1,
                        allocations: [],
                        trips: [],
                        remoteDeliveries: [],
                        totalPurchaseCost: 0,
                        totalTravelDistance: 0,
                        physicalCompletionMinute: 10,
                        remoteCompletionMinute: 10,
                        completionMinute: 10,
                        elapsedMinutes: 0,
                    },
                },
            },
        },
        execution: {
            startMinute: 10,
            executionModel: 'caller-supplied-exclusive-sequential-execution' as const,
        },
        sale: {
            kind: 'direct' as const,
            sellerId: 'player',
            destinationId: 'customer',
            quantity: baseProductPlan.targetQuantity,
            startMinute: 10,
            travelDurationMinutes: 5,
            completionMinute: 15,
            completionRule: 'caller-supplied-sale-confirmed-at-destination' as const,
        },
    };
    return {
        lifecycleInput,
        lifecycleResult: composeFinishedRecipeElapsedLifecycle(lifecycleInput),
        revenue: {
            dataset: { ...baseProductPlan.dataset },
            quantity: baseProductPlan.targetQuantity,
            coverage: 'complete',
            recordedRevenue: 100,
            evidence: 'caller-supplied-realized-sale-revenue',
        },
        costs: {
            dataset: { ...baseProductPlan.dataset },
            quantity: baseProductPlan.targetQuantity,
            coverage: 'complete',
            accountingBasis: 'caller-supplied-costs-attributed-to-sold-output',
            treatments: [
                { category: 'materials', treatment: 'included', amount: 20 },
                { category: 'equipment', treatment: 'not-incurred', amount: 0 },
                { category: 'labor', treatment: 'included', amount: 5 },
                { category: 'transport', treatment: 'included', amount: 3 },
                { category: 'sale-fees', treatment: 'included', amount: 2 },
                { category: 'other', treatment: 'not-incurred', amount: 0 },
            ],
        },
    };
}
