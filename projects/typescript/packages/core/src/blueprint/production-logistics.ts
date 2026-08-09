import type {
    BlueprintDocument,
    BlueprintEmployeeAssignment,
    BlueprintHandlerRoute,
} from '#core/data/blueprint';
import { BuildableSchema, type Buildable } from '#core/data/buildable';
import { ItemSchema, type Item } from '#core/data/item';
import {
    ProductionLogisticsCatalogSchema,
    type ProductionLogisticsCatalog,
    type ProductionLogisticsEmployeeRole,
    type ProductionLogisticsRouteRules,
    type ProductionLogisticsSlot,
} from '#core/data/production-logistics';
import type { ProductionBatchPlan } from '#core/production/plan';
import type { BlueprintProductionEndpointAccessDataset } from '#core/blueprint/production-endpoint-access';
import {
    BlueprintProductionTransferAnalyzer,
    type BlueprintProductionTransferAssignmentPair,
    type BlueprintProductionTransferResult,
} from '#core/blueprint/production-transfers';

export interface BlueprintProductionLogisticsDataset
    extends BlueprintProductionEndpointAccessDataset {
    readonly items: readonly Item[];
    readonly productionLogistics: ProductionLogisticsCatalog;
}

export type BlueprintProductionLogisticsIssueCode =
    | 'property-employee-capacity-exceeded'
    | 'employee-role-unavailable'
    | 'assigned-station-limit-exceeded'
    | 'station-assigned-more-than-once'
    | 'assigned-placement-unavailable'
    | 'assigned-station-topology-unavailable'
    | 'supply-placement-unavailable'
    | 'supply-storage-unavailable'
    | 'handler-route-limit-exceeded'
    | 'route-source-unavailable'
    | 'route-destination-unavailable'
    | 'route-source-not-transit-entity'
    | 'route-destination-not-transit-entity'
    | 'route-filter-item-unavailable';

export interface BlueprintProductionLogisticsIssue {
    readonly code: BlueprintProductionLogisticsIssueCode;
    readonly message: string;
    readonly employeeId: string | null;
    readonly placementIds: readonly string[];
    readonly routeId: string | null;
    readonly itemId: string | null;
}

export interface BlueprintProductionStationMovement {
    readonly employeeId: string;
    readonly employeeType: BlueprintEmployeeAssignment['employeeType'];
    readonly placementId: string;
    readonly movementKind: 'station-specific' | 'assigned-station-supply';
    readonly configuredHandlerRoute: false;
}

export interface BlueprintProductionSupplyAssignment {
    readonly employeeId: string;
    readonly placementId: string;
    readonly storageSlotCount: number | null;
    readonly capacityBasis: 'storage-slots-times-item-stack-limit';
    readonly currentContents: 'not-evaluated';
}

export interface BlueprintProductionConfiguredRoute {
    readonly employeeId: string;
    readonly routeId: string;
    readonly storedOrderIndex: number;
    readonly sourcePlacementId: string;
    readonly destinationPlacementId: string;
    readonly filterMode: BlueprintHandlerRoute['filter']['mode'];
    readonly filterItemIds: readonly string[];
    readonly selection: 'stored-order-first-ready';
    readonly accessPointSelection: 'npc-reachable';
}

export interface BlueprintProductionEmployeeLogistics {
    readonly employeeId: string;
    readonly employeeType: BlueprintEmployeeAssignment['employeeType'];
    readonly dailyWage: number | null;
    readonly baseWorkSpeed: number | null;
    readonly inventorySlotCount: number | null;
    readonly assignmentKind: ProductionLogisticsEmployeeRole['assignmentKind'] | null;
    readonly assignedStationLimit: number | null;
    readonly configuredRouteLimit: number | null;
    readonly stationCompatibility: 'not-evaluated';
    readonly stationMovements: readonly BlueprintProductionStationMovement[];
    readonly supply: BlueprintProductionSupplyAssignment | null;
    readonly configuredRoutes: readonly BlueprintProductionConfiguredRoute[];
}

export interface BlueprintProductionLogisticsConfiguration {
    readonly valid: boolean;
    readonly propertyEmployeeCapacity: number | null;
    readonly employeeCount: number;
    readonly assignmentOwnership: 'exclusive';
    readonly routeSelection: 'stored-order-first-ready';
    readonly stationMovementScope: 'employee-specific-not-configured-handler-routes';
    readonly employees: readonly BlueprintProductionEmployeeLogistics[];
    readonly issues: readonly BlueprintProductionLogisticsIssue[];
}

export interface BlueprintProductionTransferCapacity {
    readonly itemId: string;
    readonly itemStackLimit: number;
    readonly sourceProducedQuantity: number;
    readonly requestedDestinationQuantity: number;
    readonly employeeInventoryCapacity: number;
    readonly destinationEmptyCapacity: number | null;
    readonly destinationCapacityStatus: 'calculated' | 'filter-evidence-unavailable';
    readonly maximumMovedQuantityPerTrip: number | null;
    readonly movedQuantityLimits: ProductionLogisticsRouteRules['movedQuantityLimits'];
    readonly currentSlotContents: 'not-evaluated';
}

export interface BlueprintProductionConfiguredRouteCandidate {
    readonly employeeId: string;
    readonly routeId: string;
    readonly storedOrderIndex: number;
    readonly networkRouteCandidateStatus: BlueprintProductionTransferAssignmentPair['networkRouteCandidateStatus'];
    readonly capacity: BlueprintProductionTransferCapacity;
}

export interface BlueprintProductionLogisticsRequirementPair {
    readonly sourcePlacementId: string;
    readonly destinationPlacementId: string;
    readonly configuredRouteCoverage: 'configured' | 'unconfigured';
    readonly configuredRouteCandidates: readonly BlueprintProductionConfiguredRouteCandidate[];
}

export interface BlueprintProductionLogisticsRequirement {
    readonly itemId: string;
    readonly producerStepIndex: number;
    readonly consumerStepIndex: number;
    readonly requiredQuantity: number;
    readonly assignmentPairs: readonly BlueprintProductionLogisticsRequirementPair[];
}

export type BlueprintProductionLogisticsResult =
    | {
        readonly kind: 'rejected';
        readonly transfers: Extract<BlueprintProductionTransferResult, { readonly kind: 'rejected' }>;
        readonly configuration: null;
        readonly requirements: readonly [];
    }
    | {
        readonly kind: 'invalid-configuration';
        readonly transfers: Exclude<BlueprintProductionTransferResult, { readonly kind: 'rejected' }>;
        readonly configuration: BlueprintProductionLogisticsConfiguration;
        readonly requirements: readonly [];
    }
    | {
        readonly kind: 'unavailable';
        readonly transfers: Extract<BlueprintProductionTransferResult, { readonly kind: 'unavailable' }>;
        readonly configuration: BlueprintProductionLogisticsConfiguration;
        readonly requirements: readonly [];
    }
    | {
        readonly kind: 'analyzed';
        readonly transfers: Extract<BlueprintProductionTransferResult, { readonly kind: 'analyzed' }>;
        readonly configuration: BlueprintProductionLogisticsConfiguration;
        readonly productionRequirementScope: 'internally-produced-plan-dependencies';
        readonly purchasedInputSupply: 'not-evaluated';
        readonly routeQuantityAllocation: 'not-evaluated';
        readonly transferTiming: 'not-evaluated';
        readonly requirements: readonly BlueprintProductionLogisticsRequirement[];
    };

interface IndexedRoute {
    readonly employee: BlueprintEmployeeAssignment;
    readonly role: ProductionLogisticsEmployeeRole;
    readonly route: BlueprintHandlerRoute;
    readonly storedOrderIndex: number;
}

export class BlueprintProductionLogisticsAnalyzer {
    readonly #transfers: BlueprintProductionTransferAnalyzer;
    readonly #catalog: ProductionLogisticsCatalog;
    readonly #itemById: ReadonlyMap<string, Item>;
    readonly #buildableByItemId: ReadonlyMap<string, Buildable>;

    constructor(dataset: BlueprintProductionLogisticsDataset) {
        this.#transfers = new BlueprintProductionTransferAnalyzer(dataset);
        this.#catalog = ProductionLogisticsCatalogSchema.assert(dataset.productionLogistics);
        this.#itemById = indexUnique(
            dataset.items.map((item) => ItemSchema.assert(item)),
            (item) => item.id,
            'item ID'
        );
        this.#buildableByItemId = indexUnique(
            dataset.buildables.map((buildable) => BuildableSchema.assert(buildable)),
            (buildable) => buildable.itemId,
            'buildable item ID'
        );
    }

    analyze(
        blueprint: BlueprintDocument,
        plan: ProductionBatchPlan
    ): BlueprintProductionLogisticsResult {
        const transfers = this.#transfers.analyze(blueprint, plan);
        if (transfers.kind === 'rejected') {
            return { kind: 'rejected', transfers, configuration: null, requirements: [] };
        }
        const propertyEmployeeCapacity = transfers.endpointAccess.employeeReachabilityBasis
            .propertyEmployeeCapacity;
        const configuration = this.#configuration(blueprint, propertyEmployeeCapacity);
        if (!configuration.valid) {
            return {
                kind: 'invalid-configuration',
                transfers,
                configuration,
                requirements: [],
            };
        }
        if (transfers.kind === 'unavailable') {
            return { kind: 'unavailable', transfers, configuration, requirements: [] };
        }
        const routes = this.#indexedRoutes(blueprint);
        const placementById = new Map(blueprint.placements.map((placement) => [placement.id, placement]));
        const requirements = transfers.requirements.map((requirement) => ({
            itemId: requirement.itemId,
            producerStepIndex: requirement.producerStepIndex,
            consumerStepIndex: requirement.consumerStepIndex,
            requiredQuantity: requirement.requiredQuantity,
            assignmentPairs: requirement.assignmentPairs.map((pair) =>
                this.#requirementPair(requirement.itemId, pair, routes, placementById)
            ),
        }));
        return {
            kind: 'analyzed',
            transfers,
            configuration,
            productionRequirementScope: 'internally-produced-plan-dependencies',
            purchasedInputSupply: 'not-evaluated',
            routeQuantityAllocation: 'not-evaluated',
            transferTiming: 'not-evaluated',
            requirements,
        };
    }

    #configuration(
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
            const assignedPlacementIds = employee.employeeType === 'Botanist'
                ? employee.assignedPotPlacementIds
                : employee.assignedStationPlacementIds;
            if (role === undefined) {
                issues.push(logisticsIssue(
                    'employee-role-unavailable',
                    `Employee ${JSON.stringify(employee.id)} uses unavailable role ${JSON.stringify(employee.employeeType)}`,
                    employee.id
                ));
            } else if (assignedPlacementIds.length > role.assignedStationLimit) {
                issues.push(logisticsIssue(
                    'assigned-station-limit-exceeded',
                    `Employee ${JSON.stringify(employee.id)} has ${assignedPlacementIds.length} assignments, but ${employee.employeeType} supports ${role.assignedStationLimit}`,
                    employee.id,
                    assignedPlacementIds
                ));
            }
            const movementKind = employee.employeeType === 'Handler'
                ? 'assigned-station-supply' as const
                : 'station-specific' as const;
            const stationMovements = assignedPlacementIds.map((placementId) => {
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
            const supply = this.#supply(employee, placementById, issues);
            const configuredRoutes = this.#configuredRoutes(employee, role, placementById, issues);
            return {
                employeeId: employee.id,
                employeeType: employee.employeeType,
                dailyWage: role?.dailyWage ?? null,
                baseWorkSpeed: role?.baseWorkSpeed ?? null,
                inventorySlotCount: role?.inventorySlotCount ?? null,
                assignmentKind: role?.assignmentKind ?? null,
                assignedStationLimit: role?.assignedStationLimit ?? null,
                configuredRouteLimit: role?.configuredRouteLimit ?? null,
                stationCompatibility: 'not-evaluated' as const,
                stationMovements,
                supply,
                configuredRoutes,
            };
        });
        return {
            valid: issues.length === 0,
            propertyEmployeeCapacity,
            employeeCount: employees.length,
            assignmentOwnership: 'exclusive',
            routeSelection: this.#catalog.routeRules.selection,
            stationMovementScope: 'employee-specific-not-configured-handler-routes',
            employees,
            issues,
        };
    }

    #supply(
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

    #indexedRoutes(blueprint: BlueprintDocument): IndexedRoute[] {
        const roleByType = new Map(this.#catalog.employeeRoles.map((role) => [role.employeeType, role]));
        return blueprint.productionLogistics.employees.flatMap((employee) => {
            const role = roleByType.get(employee.employeeType);
            if (role === undefined || employee.employeeType !== 'Handler') return [];
            return employee.handlerRoutes.map((route, storedOrderIndex) => ({
                employee,
                role,
                route,
                storedOrderIndex,
            }));
        });
    }

    #requirementPair(
        itemId: string,
        pair: BlueprintProductionTransferAssignmentPair,
        routes: readonly IndexedRoute[],
        placementById: ReadonlyMap<string, BlueprintDocument['placements'][number]>
    ): BlueprintProductionLogisticsRequirementPair {
        const item = this.#itemById.get(itemId);
        if (item === undefined) {
            throw new Error(`Production plan references unavailable item ${JSON.stringify(itemId)}`);
        }
        const configuredRouteCandidates = routes.flatMap((entry) => {
            if (entry.route.sourcePlacementId !== pair.sourcePlacementId ||
                entry.route.destinationPlacementId !== pair.destinationPlacementId ||
                !routeAllowsItem(entry.route, itemId)) return [];
            return [{
                employeeId: entry.employee.id,
                routeId: entry.route.id,
                storedOrderIndex: entry.storedOrderIndex,
                networkRouteCandidateStatus: pair.networkRouteCandidateStatus,
                capacity: this.#capacity(item, pair, entry.role, placementById),
            }];
        });
        return {
            sourcePlacementId: pair.sourcePlacementId,
            destinationPlacementId: pair.destinationPlacementId,
            configuredRouteCoverage:
                configuredRouteCandidates.length > 0 ? 'configured' : 'unconfigured',
            configuredRouteCandidates,
        };
    }

    #capacity(
        item: Item,
        pair: BlueprintProductionTransferAssignmentPair,
        role: ProductionLogisticsEmployeeRole,
        placementById: ReadonlyMap<string, BlueprintDocument['placements'][number]>
    ): BlueprintProductionTransferCapacity {
        const destinationPlacement = placementById.get(pair.destinationPlacementId);
        const destinationBuildable = destinationPlacement === undefined
            ? undefined
            : this.#buildableByItemId.get(destinationPlacement.itemId);
        const destinationCapacity = destinationBuildable === undefined
            ? { status: 'filter-evidence-unavailable' as const, quantity: null }
            : this.#emptyInputCapacity(destinationBuildable, item);
        const employeeInventoryCapacity = multiplyCapacity(
            role.inventorySlotCount,
            item.stackLimit,
            'Employee inventory capacity'
        );
        const limits = [
            pair.sourceProducedQuantity,
            pair.destinationRequiredQuantity,
            employeeInventoryCapacity,
        ];
        if (destinationCapacity.quantity !== null) limits.push(destinationCapacity.quantity);
        return {
            itemId: item.id,
            itemStackLimit: item.stackLimit,
            sourceProducedQuantity: pair.sourceProducedQuantity,
            requestedDestinationQuantity: pair.destinationRequiredQuantity,
            employeeInventoryCapacity,
            destinationEmptyCapacity: destinationCapacity.quantity,
            destinationCapacityStatus: destinationCapacity.status,
            maximumMovedQuantityPerTrip:
                destinationCapacity.quantity === null ? null : Math.min(...limits),
            movedQuantityLimits: [...this.#catalog.routeRules.movedQuantityLimits],
            currentSlotContents: 'not-evaluated',
        };
    }

    #emptyInputCapacity(
        buildable: Buildable,
        item: Item
    ): { readonly status: 'calculated' | 'filter-evidence-unavailable'; readonly quantity: number | null } {
        const station = this.#catalog.stations.find((entry) => entry.itemId === buildable.itemId);
        if (station !== undefined) {
            let compatibleSlots = 0;
            for (const slot of station.inputSlots) {
                const compatibility = slotAllowsItem(slot, item);
                if (compatibility === 'unknown') {
                    return { status: 'filter-evidence-unavailable', quantity: null };
                }
                if (compatibility) compatibleSlots++;
            }
            return {
                status: 'calculated',
                quantity: multiplyCapacity(compatibleSlots, item.stackLimit, 'Station input capacity'),
            };
        }
        if (buildable.storage !== null) {
            return {
                status: 'calculated',
                quantity: multiplyCapacity(
                    buildable.storage.slotCount,
                    item.stackLimit,
                    'Storage input capacity'
                ),
            };
        }
        return { status: 'filter-evidence-unavailable', quantity: null };
    }
}

function routeAllowsItem(route: BlueprintHandlerRoute, itemId: string): boolean {
    const listed = route.filter.itemIds.includes(itemId);
    return route.filter.mode === 'whitelist' ? listed : !listed;
}

function slotAllowsItem(slot: ProductionLogisticsSlot, item: Item): boolean | 'unknown' {
    let hasUnknownFilter = false;
    for (const filter of slot.filters) {
        let matches: boolean | 'unknown';
        if (filter.nativeType.endsWith('ItemFilter_ID')) {
            matches = filter.itemIds.includes(item.id);
        } else if (filter.nativeType.endsWith('ItemFilter_Category')) {
            matches = filter.categories.includes(item.category);
        } else if (filter.nativeType.endsWith('ItemFilter_MixingIngredient')) {
            matches = item.mixingIngredient !== null;
        } else {
            matches = 'unknown';
        }
        if (matches === 'unknown') {
            hasUnknownFilter = true;
            continue;
        }
        const accepted = filter.isWhitelist === false ? !matches : matches;
        if (!accepted) return false;
    }
    return hasUnknownFilter ? 'unknown' : true;
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

function indexUnique<T>(
    values: readonly T[],
    keyFor: (value: T) => string,
    label: string
): ReadonlyMap<string, T> {
    const index = new Map<string, T>();
    for (const value of values) {
        const key = keyFor(value);
        if (index.has(key)) throw new Error(`Dataset contains duplicate ${label} ${JSON.stringify(key)}`);
        index.set(key, value);
    }
    return index;
}
