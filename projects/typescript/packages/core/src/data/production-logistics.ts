import { type } from 'arktype';

export const ProductionLogisticsSlotFilterSchema = type({
    nativeType: 'string',
    isWhitelist: 'boolean | null',
    itemIds: 'string[]',
    categories: 'string[]',
});
export type ProductionLogisticsSlotFilter = typeof ProductionLogisticsSlotFilterSchema.infer;

export const ProductionLogisticsSlotSchema = type({
    index: 'number',
    filters: ProductionLogisticsSlotFilterSchema.array(),
});
export type ProductionLogisticsSlot = typeof ProductionLogisticsSlotSchema.infer;

export const ProductionLogisticsStationSchema = type({
    itemId: 'string',
    kind: 'string',
    inputSlots: ProductionLogisticsSlotSchema.array(),
    outputSlots: ProductionLogisticsSlotSchema.array(),
});
export type ProductionLogisticsStation = typeof ProductionLogisticsStationSchema.infer;

export const ProductionLogisticsEmployeeRoleSchema = type({
    employeeType: "'Botanist' | 'Chemist' | 'Handler'",
    runtimeType: 'string',
    dailyWage: 'number',
    baseWorkSpeed: 'number',
    'walkSpeed?': 'number | null',
    inventorySlotCount: 'number',
    assignmentKind: "'pots' | 'stations'",
    assignedStationLimit: 'number',
    configuredRouteLimit: 'number | null',
    movementKinds: "('station-specific' | 'assigned-station-supply' | 'configured-route')[]",
});
export type ProductionLogisticsEmployeeRole = typeof ProductionLogisticsEmployeeRoleSchema.infer;

export const ProductionLogisticsRouteRulesSchema = type({
    filterModes: "('whitelist' | 'blacklist')[]",
    selection: "'stored-order-first-ready'",
    movedQuantityLimits:
        "('source-quantity' | 'requested-maximum' | 'destination-input-capacity')[]",
    accessPointSelection: "'npc-reachable'",
});
export type ProductionLogisticsRouteRules = typeof ProductionLogisticsRouteRulesSchema.infer;

export const ProductionLogisticsEmployeeMovementSchema = type({
    taskOrigin: "'current-npc-position'",
    completionPosition: "'task-endpoint-until-subsequent-behaviour'",
    taskChaining: "'each-selected-task-starts-from-then-current-npc-position'",
    growContainerItemSource: "'employee-inventory-otherwise-assigned-supplies'",
    growContainerTaskKinds:
        "('grow-container-watering-below-0.2' | 'mushroom-bed-misting-below-0.2' | 'grow-container-additive' | 'grow-container-soil-pour' | 'pot-sow-seed' | 'mushroom-bed-apply-spawn' | 'pot-harvest' | 'mushroom-bed-harvest' | 'grow-container-watering-below-0.3' | 'mushroom-bed-misting-below-0.3')[]",
    growContainerTaskLegs:
        "('current-to-supplies-if-required-item-missing' | 'supplies-to-grow-container-if-supplies-visited' | 'current-to-grow-container-otherwise')[]",
    stationTaskKinds:
        "('drying-rack-stop' | 'mushroom-spawn-station-work' | 'lab-oven-finish' | 'lab-oven-start' | 'chemistry-station-start' | 'cauldron-start' | 'mixing-station-start')[]",
    stationTaskLegs: "('current-to-station-access-point')[]",
    moveItemTaskKinds:
        "('drying-rack-output-move' | 'mushroom-spawn-station-output-move' | 'drying-rack-input-move' | 'lab-oven-output-move' | 'chemistry-station-output-move' | 'cauldron-output-move' | 'mixing-station-output-move')[]",
    moveItemTaskLegs:
        "('current-to-source-access-point' | 'source-to-destination-access-point')[]",
    legFrequency: "'once-per-selected-task-activation-if-not-already-at-endpoint'",
});
export type ProductionLogisticsEmployeeMovement =
    typeof ProductionLogisticsEmployeeMovementSchema.infer;

export const ProductionLogisticsEmployeeSchedulingSchema = type({
    dispatchAuthority: "'server'",
    dispatchPrerequisite: "'can-work-and-no-active-behaviour'",
    taskSelection: "'first-ready-in-native-priority-order'",
    taskReadiness: "'native-mutable-runtime-state-not-recorded'",
    workAvailability: {
        employeeHome: "'required'",
        dailyPayment: "'paid-for-today-required-auto-from-employee-home-cash'",
        shiftSchedule: "'no-fixed-shift'",
        endOfDayTime: '400',
        consumeProduct: "'blocks-work'",
    },
    'movement?': ProductionLogisticsEmployeeMovementSchema.or('null'),
    botanistTaskPriority:
        "('grow-container-watering-below-0.2' | 'mushroom-bed-misting-below-0.2' | 'grow-container-additive' | 'grow-container-soil-pour' | 'pot-sow-seed' | 'mushroom-bed-apply-spawn' | 'pot-harvest' | 'mushroom-bed-harvest' | 'drying-rack-stop' | 'drying-rack-output-move' | 'mushroom-spawn-station-work' | 'mushroom-spawn-station-output-move' | 'grow-container-watering-below-0.3' | 'mushroom-bed-misting-below-0.3' | 'drying-rack-input-move')[]",
    chemistTaskPriority:
        "('lab-oven-finish' | 'lab-oven-start' | 'chemistry-station-start' | 'cauldron-start' | 'mixing-station-start' | 'lab-oven-output-move' | 'chemistry-station-output-move' | 'cauldron-output-move' | 'mixing-station-output-move')[]",
});
export type ProductionLogisticsEmployeeScheduling =
    typeof ProductionLogisticsEmployeeSchedulingSchema.infer;

export const ProductionLogisticsCatalogSchema = type({
    schema: "'neonschedule1-production-logistics-1'",
    routeRules: ProductionLogisticsRouteRulesSchema,
    handlerTaskPriority:
        "('packaging-station-work' | 'brick-press-work' | 'packaging-station-supply-move' | 'brick-press-supply-move' | 'configured-transit-route')[]",
    'employeeScheduling?': ProductionLogisticsEmployeeSchedulingSchema.or('null'),
    employeeRoles: ProductionLogisticsEmployeeRoleSchema.array(),
    stations: ProductionLogisticsStationSchema.array(),
});
export type ProductionLogisticsCatalog = typeof ProductionLogisticsCatalogSchema.infer;
