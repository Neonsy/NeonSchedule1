import type {
    BlueprintDocument,
    BlueprintEmployeeAssignment,
    BlueprintHandlerRoute,
    BlueprintProductionSupply,
} from '#core/data/blueprint';
import type { Buildable } from '#core/data/buildable';
import type { Item } from '#core/data/item';
import type {
    ProductionLogisticsCatalog,
    ProductionLogisticsEmployeeRole,
} from '#core/data/production-logistics';
import type {
    BlueprintProductionConfiguredRoute,
    BlueprintProductionInputSupply,
    BlueprintProductionLogisticsConfiguration,
    BlueprintProductionLogisticsIssue,
    BlueprintProductionLogisticsIssueCode,
    BlueprintProductionPlacementById,
    BlueprintProductionSupplyAssignment,
} from '#core/blueprint/production-logistics-types';

export class BlueprintProductionLogisticsConfigurationAnalyzer {
    readonly #catalog: ProductionLogisticsCatalog;
    readonly #itemById: ReadonlyMap<string, Item>;
    readonly #buildableByItemId: ReadonlyMap<string, Buildable>;

    constructor(
        catalog: ProductionLogisticsCatalog,
        itemById: ReadonlyMap<string, Item>,
        buildableByItemId: ReadonlyMap<string, Buildable>
    ) {
        this.#catalog = catalog;
        this.#itemById = itemById;
        this.#buildableByItemId = buildableByItemId;
    }

    analyze(
        blueprint: BlueprintDocument,
        propertyEmployeeCapacity: number
    ): BlueprintProductionLogisticsConfiguration {
        const issues: BlueprintProductionLogisticsIssue[] = [];
        const placementById = new Map(blueprint.placements.map((placement) => [placement.id, placement]));
        const roleByType = new Map(this.#catalog.employeeRoles.map((role) => [role.employeeType, role]));
        const stationByItemId = new Map(this.#catalog.stations.map((station) => [station.itemId, station]));
        const stationOwner = new Map<string, string>();
        if (blueprint.productionLogistics.employees.length > propertyEmployeeCapacity) {
            issues.push(logisticsIssue(
                'property-employee-capacity-exceeded',
                `Blueprint configures ${blueprint.productionLogistics.employees.length} employees, but the property supports ${propertyEmployeeCapacity}`
            ));
        }
        const employees = blueprint.productionLogistics.employees.map((employee) => {
            const role = roleByType.get(employee.employeeType);
            const assignedPlacementIds = assignmentPlacementIds(employee);
            if (role === undefined) {
                issues.push(logisticsIssue(
                    'employee-role-unavailable',
                    `Employee ${JSON.stringify(employee.id)} uses unavailable role ${JSON.stringify(employee.employeeType)}`,
                    employee.id
                ));
            } else if (assignedPlacementIds.length > role.assignmentLimit) {
                issues.push(logisticsIssue(
                    'assignment-limit-exceeded',
                    `Employee ${JSON.stringify(employee.id)} has ${assignedPlacementIds.length} assignments, but ${employee.employeeType} supports ${role.assignmentLimit}`,
                    employee.id,
                    assignedPlacementIds
                ));
            }
            const movementKind = employee.employeeType === 'Handler'
                ? 'assigned-station-supply' as const
                : 'station-specific' as const;
            const stationMovements = employee.employeeType === 'Cleaner' ? [] : assignedPlacementIds.map((placementId) => {
                const previousOwner = stationOwner.get(placementId);
                if (previousOwner !== undefined) {
                    issues.push(logisticsIssue(
                        'station-assigned-more-than-once',
                        `Placement ${JSON.stringify(placementId)} is assigned to both ${JSON.stringify(previousOwner)} and ${JSON.stringify(employee.id)}`,
                        employee.id,
                        [placementId]
                    ));
                } else {
                    stationOwner.set(placementId, employee.id);
                }
                const placement = placementById.get(placementId);
                if (placement === undefined) {
                    issues.push(logisticsIssue(
                        'assigned-placement-unavailable',
                        `Employee ${JSON.stringify(employee.id)} references unavailable placement ${JSON.stringify(placementId)}`,
                        employee.id,
                        [placementId]
                    ));
                } else if (!stationByItemId.has(placement.itemId)) {
                    issues.push(logisticsIssue(
                        'assigned-station-topology-unavailable',
                        `Placement ${JSON.stringify(placementId)} has no normalized production-logistics station topology`,
                        employee.id,
                        [placementId]
                    ));
                }
                return {
                    employeeId: employee.id,
                    employeeType: employee.employeeType,
                    placementId,
                    movementKind,
                    configuredHandlerRoute: false as const,
                };
            });
            const supply = this.#botanistSupply(employee, placementById, issues);
            const configuredRoutes = this.#configuredRoutes(employee, role, placementById, issues);
            return {
                employeeId: employee.id,
                employeeType: employee.employeeType,
                dailyWage: role?.dailyWage ?? null,
                baseWorkSpeed: role?.baseWorkSpeed ?? null,
                walkSpeed: role?.walkSpeed ?? null,
                inventorySlotCount: role?.inventorySlotCount ?? null,
                assignmentKind: role?.assignmentKind ?? null,
                assignmentLimit: role?.assignmentLimit ?? null,
                configuredRouteLimit: role?.configuredRouteLimit ?? null,
                stationCompatibility: employee.employeeType === 'Cleaner'
                    ? 'not-applicable' as const
                    : 'not-evaluated' as const,
                stationMovements,
                supply,
                configuredRoutes,
            };
        });
        const inputSupplies = blueprint.productionLogistics.supplies.map((supply) =>
            this.#inputSupply(supply, placementById, issues)
        );
        this.#validateCombinedSupplyStorage(inputSupplies, issues);
        return {
            valid: issues.length === 0,
            propertyEmployeeCapacity,
            employeeCount: employees.length,
            stationAssignmentOwnership: 'exclusive',
            routeSelection: this.#catalog.routeRules.selection,
            stationMovementScope: 'employee-specific-not-configured-handler-routes',
            employees,
            inputSupplies,
            issues,
        };
    }

    #inputSupply(
        supply: BlueprintProductionSupply,
        placementById: ReadonlyMap<string, BlueprintDocument['placements'][number]>,
        issues: BlueprintProductionLogisticsIssue[]
    ): BlueprintProductionInputSupply {
        const item = this.#itemById.get(supply.itemId);
        if (item === undefined) {
            issues.push(logisticsIssue(
                'supply-item-unavailable',
                `Supply ${JSON.stringify(supply.id)} references unavailable item ${JSON.stringify(supply.itemId)}`,
                null,
                [],
                null,
                supply.itemId
            ));
        } else if (!item.isStorable) {
            issues.push(logisticsIssue(
                'supply-item-not-storable',
                `Supply ${JSON.stringify(supply.id)} item ${JSON.stringify(supply.itemId)} is not storable`,
                null,
                [],
                null,
                supply.itemId
            ));
        }
        const placement = placementById.get(supply.sourcePlacementId);
        if (placement === undefined) {
            issues.push(logisticsIssue(
                'supply-source-unavailable',
                `Supply ${JSON.stringify(supply.id)} references unavailable source placement ${JSON.stringify(supply.sourcePlacementId)}`,
                null,
                [supply.sourcePlacementId],
                null,
                supply.itemId
            ));
        }
        const storage = placement === undefined
            ? null
            : this.#buildableByItemId.get(placement.itemId)?.storage ?? null;
        if (placement !== undefined && storage === null) {
            issues.push(logisticsIssue(
                'supply-source-storage-unavailable',
                `Supply source placement ${JSON.stringify(supply.sourcePlacementId)} has no normalized storage`,
                null,
                [supply.sourcePlacementId],
                null,
                supply.itemId
            ));
        }
        const emptyStorageCapacity = item === undefined || storage === null
            ? null
            : multiplyCapacity(storage.slotCount, item.stackLimit, 'Supply storage capacity');
        if (emptyStorageCapacity !== null && supply.quantity > emptyStorageCapacity) {
            issues.push(logisticsIssue(
                'supply-storage-capacity-exceeded',
                `Supply ${JSON.stringify(supply.id)} contains ${supply.quantity} units, but empty storage capacity is ${emptyStorageCapacity}`,
                null,
                [supply.sourcePlacementId],
                null,
                supply.itemId
            ));
        }
        return {
            supplyId: supply.id,
            itemId: supply.itemId,
            sourcePlacementId: supply.sourcePlacementId,
            quantity: supply.quantity,
            storageSlotCount: storage?.slotCount ?? null,
            requiredStorageSlots: item === undefined
                ? null
                : Math.ceil(supply.quantity / item.stackLimit),
            emptyStorageCapacity,
            currentSlotContents: 'not-evaluated',
        };
    }

    #validateCombinedSupplyStorage(
        supplies: readonly BlueprintProductionInputSupply[],
        issues: BlueprintProductionLogisticsIssue[]
    ): void {
        const suppliesByPlacement = new Map<string, BlueprintProductionInputSupply[]>();
        for (const supply of supplies) {
            const existing = suppliesByPlacement.get(supply.sourcePlacementId) ?? [];
            existing.push(supply);
            suppliesByPlacement.set(supply.sourcePlacementId, existing);
        }
        for (const [placementId, placementSupplies] of suppliesByPlacement) {
            const storageSlotCount = placementSupplies[0]?.storageSlotCount;
            if (storageSlotCount === null || storageSlotCount === undefined ||
                placementSupplies.some((supply) => supply.requiredStorageSlots === null)) continue;
            const requiredSlots = placementSupplies.reduce(
                (sum, supply) => sum + supply.requiredStorageSlots!,
                0
            );
            if (requiredSlots > storageSlotCount) {
                issues.push(logisticsIssue(
                    'supply-storage-slots-exceeded',
                    `Planned supplies require ${requiredSlots} slots at ${JSON.stringify(placementId)}, but the storage has ${storageSlotCount}`,
                    null,
                    [placementId]
                ));
            }
        }
    }

    #botanistSupply(
        employee: BlueprintEmployeeAssignment,
        placementById: ReadonlyMap<string, BlueprintDocument['placements'][number]>,
        issues: BlueprintProductionLogisticsIssue[]
    ): BlueprintProductionSupplyAssignment | null {
        if (employee.employeeType !== 'Botanist') return null;
        if (employee.supplyPlacementId === null) return null;
        const placement = placementById.get(employee.supplyPlacementId);
        if (placement === undefined) {
            issues.push(logisticsIssue(
                'supply-placement-unavailable',
                `Employee ${JSON.stringify(employee.id)} references unavailable supplies placement ${JSON.stringify(employee.supplyPlacementId)}`,
                employee.id,
                [employee.supplyPlacementId]
            ));
        }
        const storage = placement === undefined
            ? null
            : this.#buildableByItemId.get(placement.itemId)?.storage ?? null;
        if (placement !== undefined && storage === null) {
            issues.push(logisticsIssue(
                'supply-storage-unavailable',
                `Supplies placement ${JSON.stringify(employee.supplyPlacementId)} has no normalized storage`,
                employee.id,
                [employee.supplyPlacementId]
            ));
        }
        return {
            employeeId: employee.id,
            placementId: employee.supplyPlacementId,
            storageSlotCount: storage?.slotCount ?? null,
            capacityBasis: 'storage-slots-times-item-stack-limit',
            currentContents: 'not-evaluated',
        };
    }

    #configuredRoutes(
        employee: BlueprintEmployeeAssignment,
        role: ProductionLogisticsEmployeeRole | undefined,
        placementById: ReadonlyMap<string, BlueprintDocument['placements'][number]>,
        issues: BlueprintProductionLogisticsIssue[]
    ): BlueprintProductionConfiguredRoute[] {
        if (employee.employeeType !== 'Handler') return [];
        if (role?.configuredRouteLimit !== null && role?.configuredRouteLimit !== undefined &&
            employee.handlerRoutes.length > role.configuredRouteLimit) {
            issues.push(logisticsIssue(
                'handler-route-limit-exceeded',
                `Employee ${JSON.stringify(employee.id)} has ${employee.handlerRoutes.length} routes, but ${employee.employeeType} supports ${role.configuredRouteLimit}`,
                employee.id
            ));
        }
        return employee.handlerRoutes.map((route, storedOrderIndex) => {
            this.#validateRouteEndpoint(employee, route, 'source', placementById, issues);
            this.#validateRouteEndpoint(employee, route, 'destination', placementById, issues);
            for (const itemId of route.filter.itemIds) {
                if (!this.#itemById.has(itemId)) {
                    issues.push(logisticsIssue(
                        'route-filter-item-unavailable',
                        `Route ${JSON.stringify(route.id)} references unavailable filter item ${JSON.stringify(itemId)}`,
                        employee.id,
                        [],
                        route.id,
                        itemId
                    ));
                }
            }
            return {
                employeeId: employee.id,
                routeId: route.id,
                storedOrderIndex,
                sourcePlacementId: route.sourcePlacementId,
                destinationPlacementId: route.destinationPlacementId,
                filterMode: route.filter.mode,
                filterItemIds: [...route.filter.itemIds],
                selection: this.#catalog.routeRules.selection,
                accessPointSelection: this.#catalog.routeRules.accessPointSelection,
            };
        });
    }

    #validateRouteEndpoint(
        employee: BlueprintEmployeeAssignment,
        route: BlueprintHandlerRoute,
        endpoint: 'source' | 'destination',
        placementById: ReadonlyMap<string, BlueprintDocument['placements'][number]>,
        issues: BlueprintProductionLogisticsIssue[]
    ): void {
        const placementId = endpoint === 'source'
            ? route.sourcePlacementId
            : route.destinationPlacementId;
        const placement = placementById.get(placementId);
        if (placement === undefined) {
            issues.push(logisticsIssue(
                endpoint === 'source' ? 'route-source-unavailable' : 'route-destination-unavailable',
                `Route ${JSON.stringify(route.id)} references unavailable ${endpoint} placement ${JSON.stringify(placementId)}`,
                employee.id,
                [placementId],
                route.id
            ));
            return;
        }
        if (this.#buildableByItemId.get(placement.itemId)?.isTransitEntity !== true) {
            issues.push(logisticsIssue(
                endpoint === 'source'
                    ? 'route-source-not-transit-entity'
                    : 'route-destination-not-transit-entity',
                `Route ${JSON.stringify(route.id)} ${endpoint} placement ${JSON.stringify(placementId)} is not a normalized transit entity`,
                employee.id,
                [placementId],
                route.id
            ));
        }
    }
}

function assignmentPlacementIds(employee: BlueprintEmployeeAssignment): readonly string[] {
    if (employee.employeeType === 'Botanist') return employee.assignedPotPlacementIds;
    if (employee.employeeType === 'Cleaner') return employee.assignedBinPlacementIds;
    return employee.assignedStationPlacementIds;
}

function multiplyCapacity(left: number, right: number, label: string): number {
    if (!Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0) {
        throw new RangeError(`${label} inputs must be non-negative safe integers`);
    }
    const value = left * right;
    if (!Number.isSafeInteger(value)) throw new RangeError(`${label} exceeds safe integer range`);
    return value;
}

function logisticsIssue(
    code: BlueprintProductionLogisticsIssueCode,
    message: string,
    employeeId: string | null = null,
    placementIds: readonly string[] = [],
    routeId: string | null = null,
    itemId: string | null = null
): BlueprintProductionLogisticsIssue {
    return { code, message, employeeId, placementIds, routeId, itemId };
}
