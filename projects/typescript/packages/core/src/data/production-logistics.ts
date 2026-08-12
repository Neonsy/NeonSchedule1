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

export const ProductionLogisticsCatalogSchema = type({
    schema: "'neonschedule1-production-logistics-1'",
    routeRules: ProductionLogisticsRouteRulesSchema,
    handlerTaskPriority:
        "('packaging-station-work' | 'brick-press-work' | 'packaging-station-supply-move' | 'brick-press-supply-move' | 'configured-transit-route')[]",
    employeeRoles: ProductionLogisticsEmployeeRoleSchema.array(),
    stations: ProductionLogisticsStationSchema.array(),
});
export type ProductionLogisticsCatalog = typeof ProductionLogisticsCatalogSchema.infer;
