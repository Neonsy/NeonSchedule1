import { describe, expect, it } from 'vitest';

import type { RawReport } from '#data-compiler/acquisition/types';
import { Integrity } from '#data-compiler/integrity';
import { normalizeProductionLogistics } from '#data-compiler/normalize/production-logistics';

describe('production logistics normalization', () => {
    it('preserves native route rules, employee limits, slots, and hard filters', () => {
        const report = logisticsReport();
        const integrity = new Integrity();

        const logistics = normalizeProductionLogistics(
            report,
            new Set(['packagingstation', 'package', 'product']),
            integrity
        );

        expect(integrity.errors).toEqual([]);
        expect(logistics.routeRules).toEqual({
            filterModes: ['whitelist', 'blacklist'],
            selection: 'stored-order-first-ready',
            movedQuantityLimits: [
                'source-quantity',
                'requested-maximum',
                'destination-input-capacity',
            ],
            accessPointSelection: 'npc-reachable',
        });
        expect(logistics.employeeScheduling).toEqual({
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
            movement: employeeMovement(),
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
            cleanerTaskPriority: cleanerTaskPriority(),
            cleanerRules: cleanerRules(),
        });
        expect(logistics.employeeRoles).toEqual([
            {
                employeeType: 'Botanist',
                runtimeType: 'ScheduleOne.Employees.Botanist',
                dailyWage: 200,
                baseWorkSpeed: 1,
                walkSpeed: 1.2,
                inventorySlotCount: 5,
                assignmentKind: 'pots',
                assignmentLimit: 8,
                configuredRouteLimit: null,
                movementKinds: ['station-specific'],
            },
            {
                employeeType: 'Chemist',
                runtimeType: 'ScheduleOne.Employees.Chemist',
                dailyWage: 300,
                baseWorkSpeed: 1,
                walkSpeed: 1.2,
                inventorySlotCount: 5,
                assignmentKind: 'stations',
                assignmentLimit: 4,
                configuredRouteLimit: null,
                movementKinds: ['station-specific'],
            },
            {
                employeeType: 'Cleaner',
                runtimeType: 'ScheduleOne.Employees.Cleaner',
                dailyWage: 100,
                baseWorkSpeed: 1,
                walkSpeed: 1.2,
                inventorySlotCount: 5,
                assignmentKind: 'bins',
                assignmentLimit: 6,
                configuredRouteLimit: null,
                movementKinds: ['trash-collection'],
            },
            {
                employeeType: 'Handler',
                runtimeType: 'ScheduleOne.Employees.Packager',
                dailyWage: 200,
                baseWorkSpeed: 1,
                walkSpeed: 1.2,
                inventorySlotCount: 5,
                assignmentKind: 'stations',
                assignmentLimit: 3,
                configuredRouteLimit: 5,
                movementKinds: ['assigned-station-supply', 'configured-route'],
            },
        ]);
        expect(logistics.stations).toEqual([
            {
                itemId: 'packagingstation',
                kind: 'packaging',
                inputSlots: [
                    {
                        index: 0,
                        filters: [
                            {
                                nativeType: 'ScheduleOne.ItemFramework.ItemFilter_Category',
                                isWhitelist: null,
                                itemIds: [],
                                categories: ['Packaging'],
                            },
                        ],
                    },
                    {
                        index: 1,
                        filters: [
                            {
                                nativeType:
                                    'ScheduleOne.ItemFramework.ItemFilter_UnpackagedProduct',
                                isWhitelist: null,
                                itemIds: [],
                                categories: [],
                            },
                        ],
                    },
                ],
                outputSlots: [
                    {
                        index: 0,
                        filters: [
                            {
                                nativeType: 'ScheduleOne.ItemFramework.ItemFilter_PackagedProduct',
                                isWhitelist: null,
                                itemIds: [],
                                categories: [],
                            },
                        ],
                    },
                ],
            },
        ]);
    });

    it('reports contradictory limits and invalid slot-filter references', () => {
        const report = logisticsReport();
        const handler = report.world.employeeTypes[3];
        if (handler !== undefined) {
            handler.inventorySlotCount = 0;
            handler.walkSpeed = 0;
            handler.mechanics = { MaxAssignedStations: '3', MaxAssignedRoutes: '4' };
        }
        const station = report.productionStations[0];
        if (station !== undefined) {
            station.inputFilters = [idFilter(2, 'missing')];
        }
        const scheduling = employeeScheduling();
        report.productionLogistics.employeeScheduling = {
            ...scheduling,
            workAvailability: { ...scheduling.workAvailability, endOfDayTime: 401 },
            movement: {
                ...scheduling.movement,
                stationTaskLegs: ['source-to-destination-access-point'],
            },
            chemistTaskPriority: [...scheduling.chemistTaskPriority].reverse(),
            cleanerRules: { ...scheduling.cleanerRules, baggingThreshold: 0.8 },
        };
        const integrity = new Integrity();

        normalizeProductionLogistics(
            report,
            new Set(['packagingstation', 'package', 'product']),
            integrity
        );

        expect(integrity.errors).toContain(
            'report.world.employeeTypes["Handler"].mechanics.MaxAssignedRoutes differs from report.productionLogistics.handlerRouteLimit'
        );
        expect(integrity.errors).toContain(
            'report.world.employeeTypes["Handler"].inventorySlotCount must be a positive integer'
        );
        expect(integrity.errors).toContain(
            'report.world.employeeTypes["Handler"].walkSpeed must be positive'
        );
        expect(integrity.errors).toContain(
            'report.productionLogistics.employeeScheduling.workAvailability.endOfDayTime must be 400'
        );
        expect(integrity.errors).toContain(
            'report.productionLogistics.employeeScheduling.chemistTaskPriority must equal ["lab-oven-finish","lab-oven-start","chemistry-station-start","cauldron-start","mixing-station-start","lab-oven-output-move","chemistry-station-output-move","cauldron-output-move","mixing-station-output-move"]'
        );
        expect(integrity.errors).toContain(
            'report.productionLogistics.employeeScheduling.movement.stationTaskLegs must equal ["current-to-station-access-point"]'
        );
        expect(integrity.errors).toContain(
            'report.productionLogistics.employeeScheduling.cleanerRules.baggingThreshold must be 0.75'
        );
        expect(integrity.errors).toContain(
            'report.productionStations["packagingstation"].inputFilters[0].slotIndex 2 is outside 2 slots'
        );
        expect(integrity.errors).toContain(
            'report.productionStations["packagingstation"].inputFilters[0].itemIds references missing id "missing"'
        );
    });

    it('preserves compatibility with acquisitions that predate employee scheduling facts', () => {
        const report = logisticsReport();
        for (const employeeType of report.world.employeeTypes) delete employeeType.walkSpeed;
        delete report.productionLogistics.employeeScheduling;
        const integrity = new Integrity();

        const logistics = normalizeProductionLogistics(
            report,
            new Set(['packagingstation', 'package', 'product']),
            integrity
        );

        expect(integrity.errors).toEqual([]);
        expect(logistics.employeeRoles.map(({ walkSpeed }) => walkSpeed)).toEqual([
            null,
            null,
            null,
            null,
        ]);
        expect(logistics.employeeScheduling).toBeNull();
    });

    it('preserves scheduling compatibility before movement facts were exported', () => {
        const report = logisticsReport();
        const { movement: _movement, ...schedulingWithoutMovement } = employeeScheduling();
        report.productionLogistics.employeeScheduling = schedulingWithoutMovement;
        const integrity = new Integrity();

        const logistics = normalizeProductionLogistics(
            report,
            new Set(['packagingstation', 'package', 'product']),
            integrity
        );

        expect(integrity.errors).toEqual([]);
        expect(logistics.employeeScheduling?.movement).toBeNull();
    });
});

function logisticsReport(): RawReport {
    return {
        productionLogistics: {
            handlerRouteLimit: 5,
            routeSelection: 'stored-order-first-ready',
            routeFilterModes: ['whitelist', 'blacklist'],
            movedQuantityLimits: [
                'source-quantity',
                'requested-maximum',
                'destination-input-capacity',
            ],
            accessPointSelection: 'npc-reachable',
            handlerTaskPriority: [
                'packaging-station-work',
                'brick-press-work',
                'packaging-station-supply-move',
                'brick-press-supply-move',
                'configured-transit-route',
            ],
            employeeScheduling: employeeScheduling(),
            stationMovementEmployeeTypes: ['Botanist', 'Chemist'],
        },
        productionStations: [
            {
                itemId: 'packagingstation',
                kind: 'packaging',
                inputSlotCount: 2,
                outputSlotCount: 1,
                inputFilters: [
                    {
                        slotIndex: 0,
                        filterType: 'ScheduleOne.ItemFramework.ItemFilter_Category',
                        itemIds: [],
                        categories: ['Packaging'],
                    },
                    {
                        slotIndex: 1,
                        filterType: 'ScheduleOne.ItemFramework.ItemFilter_UnpackagedProduct',
                        itemIds: [],
                        categories: [],
                    },
                ],
                outputFilters: [
                    {
                        slotIndex: 0,
                        filterType: 'ScheduleOne.ItemFramework.ItemFilter_PackagedProduct',
                        itemIds: [],
                        categories: [],
                    },
                ],
            },
        ],
        world: {
            employeeTypes: [
                employee('Botanist', 'ScheduleOne.Employees.Botanist', 200, 5, {
                    MaxAssignedPots: '8',
                }),
                employee('Chemist', 'ScheduleOne.Employees.Chemist', 300, 5, {
                    MaximumAssignedStations: '4',
                }),
                employee('Cleaner', 'ScheduleOne.Employees.Cleaner', 100, 5, {
                    MaximumAssignedBins: '6',
                }),
                employee('Handler', 'ScheduleOne.Employees.Packager', 200, 5, {
                    MaxAssignedStations: '3',
                    MaxAssignedRoutes: '5',
                }),
            ],
        },
    } as unknown as RawReport;
}

function employeeScheduling() {
    return {
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
        movement: employeeMovement(),
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
        cleanerTaskPriority: cleanerTaskPriority(),
        cleanerRules: cleanerRules(),
    };
}

function cleanerTaskPriority() {
    return [
        'dispose-nearby-trash-bag',
        'pick-up-reachable-loose-trash',
        'empty-full-trash-grabber',
        'bag-trash-can-at-or-above-threshold',
    ];
}

function cleanerRules() {
    return {
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
    };
}

function employeeMovement() {
    return {
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
    };
}

function employee(
    type: string,
    runtimeType: string,
    dailyWage: number,
    inventorySlotCount: number,
    mechanics: Record<string, string>
) {
    return {
        type,
        runtimeType,
        dailyWage,
        baseWorkSpeed: 1,
        walkSpeed: 1.2,
        inventorySlotCount,
        mechanics,
    };
}

function idFilter(slotIndex: number, itemId: string) {
    return {
        slotIndex,
        filterType: 'ScheduleOne.ItemFramework.ItemFilter_ID',
        isWhitelist: true,
        itemIds: [itemId],
        categories: [],
    };
}
