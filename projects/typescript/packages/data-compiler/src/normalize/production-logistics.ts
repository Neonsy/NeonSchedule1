import {
    ProductionLogisticsCatalogSchema,
    type ProductionLogisticsCatalog,
    type ProductionLogisticsEmployeeRole,
    type ProductionLogisticsSlot,
    type ProductionLogisticsSlotFilter,
    type ProductionLogisticsStation,
} from '@neonschedule1/core';

import type { RawReport } from '#data-compiler/acquisition/types';
import { Integrity, indexUnique, requireReferences } from '#data-compiler/integrity';
import {
    asObject,
    booleanField,
    nullableNumberField,
    numberField,
    objectArray,
    stringArrayField,
    stringField,
    type JsonObject,
} from '#data-compiler/json';

const employeeTypes = ['Botanist', 'Chemist', 'Handler'] as const;
type ProductionEmployeeType = (typeof employeeTypes)[number];

const assignmentMechanics = {
    Botanist: { key: 'MaxAssignedPots', kind: 'pots' },
    Chemist: { key: 'MaximumAssignedStations', kind: 'stations' },
    Handler: { key: 'MaxAssignedStations', kind: 'stations' },
} as const;

const movementKinds = {
    Botanist: ['station-specific'],
    Chemist: ['station-specific'],
    Handler: ['assigned-station-supply', 'configured-route'],
} as const;

const transitTopology = new Map<string, readonly [inputSlots: number, outputSlots: number]>([
    ['brick-press', [2, 1]],
    ['cauldron', [5, 1]],
    ['drying-rack', [1, 1]],
    ['grow-container', [0, 1]],
    ['lab-oven', [1, 1]],
    ['mixing', [2, 1]],
    ['mixing-mk2', [2, 1]],
    ['mushroom-spawn', [2, 1]],
    ['packaging', [2, 1]],
    ['packaging-mk2', [2, 1]],
]);

const hardFilterTypes = new Set([
    'ScheduleOne.ItemFramework.ItemFilter_Category',
    'ScheduleOne.ItemFramework.ItemFilter_Dryable',
    'ScheduleOne.ItemFramework.ItemFilter_ID',
    'ScheduleOne.ItemFramework.ItemFilter_MixingIngredient',
    'ScheduleOne.ItemFramework.ItemFilter_PackagedProduct',
    'ScheduleOne.ItemFramework.ItemFilter_UnpackagedProduct',
]);

export function normalizeProductionLogistics(
    report: RawReport,
    itemIds: ReadonlySet<string>,
    integrity: Integrity
): ProductionLogisticsCatalog {
    const raw = report.productionLogistics;
    const routeLimit = positiveInteger(raw, 'handlerRouteLimit', 'report.productionLogistics', integrity);
    const stationMovementTypes = stringArrayField(
        raw,
        'stationMovementEmployeeTypes',
        'report.productionLogistics'
    );
    expectExactValues(
        stationMovementTypes,
        ['Botanist', 'Chemist'],
        'report.productionLogistics.stationMovementEmployeeTypes',
        integrity
    );

    const catalog: ProductionLogisticsCatalog = {
        schema: 'neonschedule1-production-logistics-1',
        routeRules: {
            filterModes: literals(
                stringArrayField(raw, 'routeFilterModes', 'report.productionLogistics'),
                ['whitelist', 'blacklist'],
                'report.productionLogistics.routeFilterModes',
                integrity
            ),
            selection: literal(
                stringField(raw, 'routeSelection', 'report.productionLogistics'),
                'stored-order-first-ready',
                'report.productionLogistics.routeSelection',
                integrity
            ),
            movedQuantityLimits: literals(
                stringArrayField(raw, 'movedQuantityLimits', 'report.productionLogistics'),
                ['source-quantity', 'requested-maximum', 'destination-input-capacity'],
                'report.productionLogistics.movedQuantityLimits',
                integrity
            ),
            accessPointSelection: literal(
                stringField(raw, 'accessPointSelection', 'report.productionLogistics'),
                'npc-reachable',
                'report.productionLogistics.accessPointSelection',
                integrity
            ),
        },
        handlerTaskPriority: literals(
            stringArrayField(raw, 'handlerTaskPriority', 'report.productionLogistics'),
            [
                'packaging-station-work',
                'brick-press-work',
                'packaging-station-supply-move',
                'brick-press-supply-move',
                'configured-transit-route',
            ],
            'report.productionLogistics.handlerTaskPriority',
            integrity
        ),
        employeeRoles: normalizeEmployeeRoles(report, routeLimit, integrity),
        stations: normalizeStations(report.productionStations, itemIds, integrity),
    };

    return ProductionLogisticsCatalogSchema.assert(catalog);
}

function normalizeEmployeeRoles(
    report: RawReport,
    handlerRouteLimit: number,
    integrity: Integrity
): ProductionLogisticsEmployeeRole[] {
    const employees = indexUnique(
        report.world.employeeTypes,
        'type',
        'report.world.employeeTypes',
        integrity
    );
    return employeeTypes.map((employeeType) => {
        const raw = employees.get(employeeType);
        const path = `report.world.employeeTypes[${JSON.stringify(employeeType)}]`;
        if (raw === undefined) {
            integrity.addError(`${path} is missing`);
            return missingEmployeeRole(employeeType);
        }

        const mechanics = asObject(raw.mechanics, `${path}.mechanics`);
        const assignment = assignmentMechanics[employeeType];
        const assignedStationLimit = positiveIntegerString(
            mechanics,
            assignment.key,
            `${path}.mechanics`,
            integrity
        );
        const configuredRouteLimit = employeeType === 'Handler' ? handlerRouteLimit : null;
        if (employeeType === 'Handler') {
            const recordedRouteLimit = positiveIntegerString(
                mechanics,
                'MaxAssignedRoutes',
                `${path}.mechanics`,
                integrity
            );
            integrity.check(
                'Handler route limits agree',
                recordedRouteLimit === handlerRouteLimit,
                `${path}.mechanics.MaxAssignedRoutes differs from report.productionLogistics.handlerRouteLimit`
            );
        }

        return {
            employeeType,
            runtimeType: stringField(raw, 'runtimeType', path),
            dailyWage: positiveNumber(raw, 'dailyWage', path, integrity),
            baseWorkSpeed: positiveNumber(raw, 'baseWorkSpeed', path, integrity),
            walkSpeed: raw.walkSpeed === undefined
                ? null
                : positiveNumber(raw, 'walkSpeed', path, integrity),
            inventorySlotCount: positiveInteger(raw, 'inventorySlotCount', path, integrity),
            assignmentKind: assignment.kind,
            assignedStationLimit,
            configuredRouteLimit,
            movementKinds: [...movementKinds[employeeType]],
        };
    });
}

function missingEmployeeRole(employeeType: ProductionEmployeeType): ProductionLogisticsEmployeeRole {
    return {
        employeeType,
        runtimeType: '',
        dailyWage: 0,
        baseWorkSpeed: 0,
        walkSpeed: null,
        inventorySlotCount: 0,
        assignmentKind: assignmentMechanics[employeeType].kind,
        assignedStationLimit: 0,
        configuredRouteLimit: employeeType === 'Handler' ? 0 : null,
        movementKinds: [...movementKinds[employeeType]],
    };
}

function normalizeStations(
    records: readonly JsonObject[],
    itemIds: ReadonlySet<string>,
    integrity: Integrity
): ProductionLogisticsStation[] {
    const stations = indexUnique(records, 'itemId', 'report.productionStations', integrity);
    return [...stations.entries()]
        .flatMap(([itemId, raw]) => {
            const path = `report.productionStations[${JSON.stringify(itemId)}]`;
            const kind = stringField(raw, 'kind', path);
            const expectedTopology = transitTopology.get(kind);
            const inputSlotCount = nullableNumberField(raw, 'inputSlotCount', path);
            const outputSlotCount = nullableNumberField(raw, 'outputSlotCount', path);
            if (inputSlotCount === null && outputSlotCount === null) {
                if (expectedTopology !== undefined) {
                    integrity.addError(`${path} is missing transit slot topology`);
                }
                return [];
            }

            requireReferences([itemId], itemIds, `${path}.itemId`, integrity);
            const inputCount = slotCount(inputSlotCount, 'inputSlotCount', path, integrity);
            const outputCount = slotCount(outputSlotCount, 'outputSlotCount', path, integrity);
            if (expectedTopology === undefined) {
                integrity.addError(`${path} kind ${JSON.stringify(kind)} must not have transit slots`);
            } else {
                integrity.check(
                    `${path} has the native transit topology`,
                    inputCount === expectedTopology[0] && outputCount === expectedTopology[1],
                    `${path} expected ${expectedTopology[0]} input slots and ${expectedTopology[1]} output slots`
                );
            }
            return [{
                itemId,
                kind,
                inputSlots: normalizeSlots(raw, 'inputFilters', inputCount, path, itemIds, integrity),
                outputSlots: normalizeSlots(raw, 'outputFilters', outputCount, path, itemIds, integrity),
            }];
        })
        .sort((left, right) => left.itemId.localeCompare(right.itemId));
}

function normalizeSlots(
    raw: JsonObject,
    filterKey: 'inputFilters' | 'outputFilters',
    slotCountValue: number,
    stationPath: string,
    itemIds: ReadonlySet<string>,
    integrity: Integrity
): ProductionLogisticsSlot[] {
    const filters = new Map<number, ProductionLogisticsSlotFilter[]>();
    objectArray(raw[filterKey], `${stationPath}.${filterKey}`).forEach((filter, index) => {
        const path = `${stationPath}.${filterKey}[${index}]`;
        const slotIndex = nonNegativeInteger(filter, 'slotIndex', path, integrity);
        integrity.check(
            `${path}.slotIndex is in range`,
            slotIndex < slotCountValue,
            `${path}.slotIndex ${slotIndex} is outside ${slotCountValue} slots`
        );
        const itemFilterIds = uniqueStrings(
            stringArrayField(filter, 'itemIds', path),
            `${path}.itemIds`,
            integrity
        );
        const categories = uniqueStrings(
            stringArrayField(filter, 'categories', path),
            `${path}.categories`,
            integrity
        );
        requireReferences(itemFilterIds, itemIds, `${path}.itemIds`, integrity);
        const isWhitelistValue = filter.isWhitelist;
        const isWhitelist = isWhitelistValue === null || isWhitelistValue === undefined
            ? null
            : booleanField(filter, 'isWhitelist', path);
        const nativeType = stringField(filter, 'filterType', path);
        validateHardFilter(nativeType, isWhitelist, itemFilterIds, categories, path, integrity);
        const normalized = filters.get(slotIndex) ?? [];
        normalized.push({ nativeType, isWhitelist, itemIds: itemFilterIds, categories });
        filters.set(slotIndex, normalized);
    });

    return Array.from({ length: slotCountValue }, (_, index) => ({
        index,
        filters: filters.get(index) ?? [],
    }));
}

function validateHardFilter(
    nativeType: string,
    isWhitelist: boolean | null,
    itemIds: readonly string[],
    categories: readonly string[],
    path: string,
    integrity: Integrity
): void {
    integrity.check(
        `${path} has a supported native filter type`,
        hardFilterTypes.has(nativeType),
        `${path}.filterType is unsupported: ${JSON.stringify(nativeType)}`
    );
    if (nativeType.endsWith('.ItemFilter_ID')) {
        integrity.check(
            `${path} has item IDs`,
            itemIds.length > 0,
            `${path}.itemIds must not be empty`
        );
        integrity.check(
            `${path} is a whitelist`,
            isWhitelist === true,
            `${path}.isWhitelist must be true`
        );
        integrity.check(
            `${path} has no categories`,
            categories.length === 0,
            `${path}.categories must be empty`
        );
        return;
    }
    if (nativeType.endsWith('.ItemFilter_Category')) {
        expectExactValues(categories, ['Packaging'], `${path}.categories`, integrity);
        integrity.check(
            `${path} has no item IDs`,
            itemIds.length === 0,
            `${path}.itemIds must be empty`
        );
        return;
    }
    integrity.check(
        `${path} has no item IDs`,
        itemIds.length === 0,
        `${path}.itemIds must be empty`
    );
    integrity.check(
        `${path} has no categories`,
        categories.length === 0,
        `${path}.categories must be empty`
    );
}

function slotCount(value: number | null, key: string, path: string, integrity: Integrity): number {
    if (value === null) {
        integrity.addError(`${path}.${key} must be present for a transit station`);
        return 0;
    }
    integrity.check(
        `${path}.${key} is a non-negative integer`,
        Number.isInteger(value) && value >= 0,
        `${path}.${key} must be a non-negative integer`
    );
    return Number.isInteger(value) && value >= 0 ? value : 0;
}

function positiveInteger(raw: JsonObject, key: string, path: string, integrity: Integrity): number {
    const value = numberField(raw, key, path);
    integrity.check(
        `${path}.${key} is a positive integer`,
        Number.isInteger(value) && value > 0,
        `${path}.${key} must be a positive integer`
    );
    return value;
}

function positiveNumber(raw: JsonObject, key: string, path: string, integrity: Integrity): number {
    const value = numberField(raw, key, path);
    integrity.check(
        `${path}.${key} is positive`,
        value > 0,
        `${path}.${key} must be positive`
    );
    return value;
}

function nonNegativeInteger(raw: JsonObject, key: string, path: string, integrity: Integrity): number {
    const value = numberField(raw, key, path);
    integrity.check(
        `${path}.${key} is a non-negative integer`,
        Number.isInteger(value) && value >= 0,
        `${path}.${key} must be a non-negative integer`
    );
    return Number.isInteger(value) && value >= 0 ? value : 0;
}

function positiveIntegerString(
    raw: JsonObject,
    key: string,
    path: string,
    integrity: Integrity
): number {
    const text = stringField(raw, key, path);
    const value = Number(text);
    integrity.check(
        `${path}.${key} is a positive integer`,
        Number.isInteger(value) && value > 0,
        `${path}.${key} must be a positive integer string`
    );
    return value;
}

function literal<const Value extends string>(
    actual: string,
    expected: Value,
    path: string,
    integrity: Integrity
): Value {
    integrity.check(
        `${path} matches the native contract`,
        actual === expected,
        `${path} must be ${JSON.stringify(expected)}`
    );
    return expected;
}

function literals<const Values extends readonly string[]>(
    actual: readonly string[],
    expected: Values,
    path: string,
    integrity: Integrity
): Values[number][] {
    expectExactValues(actual, expected, path, integrity);
    return [...expected];
}

function expectExactValues(
    actual: readonly string[],
    expected: readonly string[],
    path: string,
    integrity: Integrity
): void {
    integrity.check(
        `${path} matches the native contract`,
        actual.length === expected.length && actual.every((value, index) => value === expected[index]),
        `${path} must equal ${JSON.stringify(expected)}`
    );
}

function uniqueStrings(values: readonly string[], path: string, integrity: Integrity): string[] {
    const unique = new Set(values);
    integrity.check(
        `${path} is unique`,
        unique.size === values.length,
        `${path} must not contain duplicates`
    );
    return [...unique].sort();
}
