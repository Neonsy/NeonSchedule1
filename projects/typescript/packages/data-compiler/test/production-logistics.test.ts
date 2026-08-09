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
        expect(logistics.employeeRoles).toEqual([
            {
                employeeType: 'Botanist',
                runtimeType: 'ScheduleOne.Employees.Botanist',
                dailyWage: 200,
                baseWorkSpeed: 1,
                inventorySlotCount: 5,
                assignmentKind: 'pots',
                assignedStationLimit: 8,
                configuredRouteLimit: null,
                movementKinds: ['station-specific'],
            },
            {
                employeeType: 'Chemist',
                runtimeType: 'ScheduleOne.Employees.Chemist',
                dailyWage: 300,
                baseWorkSpeed: 1,
                inventorySlotCount: 5,
                assignmentKind: 'stations',
                assignedStationLimit: 4,
                configuredRouteLimit: null,
                movementKinds: ['station-specific'],
            },
            {
                employeeType: 'Handler',
                runtimeType: 'ScheduleOne.Employees.Packager',
                dailyWage: 200,
                baseWorkSpeed: 1,
                inventorySlotCount: 5,
                assignmentKind: 'stations',
                assignedStationLimit: 3,
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
        const handler = report.world.employeeTypes[2];
        if (handler !== undefined) {
            handler.inventorySlotCount = 0;
            handler.mechanics = { MaxAssignedStations: '3', MaxAssignedRoutes: '4' };
        }
        const station = report.productionStations[0];
        if (station !== undefined) {
            station.inputFilters = [idFilter(2, 'missing')];
        }
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
            'report.productionStations["packagingstation"].inputFilters[0].slotIndex 2 is outside 2 slots'
        );
        expect(integrity.errors).toContain(
            'report.productionStations["packagingstation"].inputFilters[0].itemIds references missing id "missing"'
        );
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
                employee('Handler', 'ScheduleOne.Employees.Packager', 200, 5, {
                    MaxAssignedStations: '3',
                    MaxAssignedRoutes: '5',
                }),
            ],
        },
    } as unknown as RawReport;
}

function employee(
    type: string,
    runtimeType: string,
    dailyWage: number,
    inventorySlotCount: number,
    mechanics: Record<string, string>
) {
    return { type, runtimeType, dailyWage, baseWorkSpeed: 1, inventorySlotCount, mechanics };
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
