import { describe, expect, it } from 'vitest';

import {
    BlueprintProductionLogisticsAnalyzer,
    BlueprintProductionTransferAnalyzer,
    type BlueprintDocument,
    type BlueprintProductionLogisticsDataset,
    type Buildable,
    type Collider,
    type NavigationGraph,
    type ProductionBatchPlan,
    type ProductionCatalog,
    type Property,
    type PropertyLayout,
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
            routeQuantityAllocation: 'not-evaluated',
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
                        networkRouteCandidateStatus: 'not-evaluated',
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
                    movementCoverage: 'configured',
                    movementCandidates: [{
                        kind: 'botanist-station-specific',
                        employeeId: 'botanist-1',
                        networkRouteCandidateStatus: 'not-applicable-same-employee-assignment',
                        capacity: {
                            sourceAvailableQuantity: 2,
                            requestedDestinationQuantity: 1,
                            employeeInventoryCapacity: 100,
                            destinationEmptyCapacity: 20,
                            maximumMovedQuantityPerTrip: 1,
                        },
                    }],
                },
            ],
        }]);
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
                'assigned-station-limit-exceeded',
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
        schema: 'neonschedule1-blueprint-3',
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

function logisticsCatalog(): BlueprintProductionLogisticsDataset['productionLogistics'] {
    return {
        schema: 'neonschedule1-production-logistics-1',
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
    assignedStationLimit: number,
    configuredRouteLimit: number | null,
    movementKinds: BlueprintProductionLogisticsDataset['productionLogistics']['employeeRoles'][number]['movementKinds']
): BlueprintProductionLogisticsDataset['productionLogistics']['employeeRoles'][number] {
    return {
        employeeType,
        runtimeType: `Game.${employeeType}`,
        dailyWage: 200,
        baseWorkSpeed: 1,
        inventorySlotCount: 5,
        assignmentKind: employeeType === 'Botanist' ? 'pots' : 'stations',
        assignedStationLimit,
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

function production(): ProductionCatalog {
    return {
        schema: 'neonschedule1-production-catalog-5',
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
        schema: 'neonschedule1-buildable-4',
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
        colliders: [],
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
