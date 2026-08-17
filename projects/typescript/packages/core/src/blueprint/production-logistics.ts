import type {
    BlueprintDocument,
    BlueprintEmployeeAssignment,
    BlueprintHandlerRoute,
    BlueprintProductionSupply,
} from '#core/data/blueprint';
import { BuildableSchema, type Buildable } from '#core/data/buildable';
import { ItemSchema, type Item } from '#core/data/item';
import {
    ProductionLogisticsCatalogSchema,
    type ProductionLogisticsCatalog,
    type ProductionLogisticsEmployeeRole,
    type ProductionLogisticsSlot,
} from '#core/data/production-logistics';
import type { ProductionBatchPlan } from '#core/production/plan';
import type { NavigationGraph } from '#core/data/world';
import { NavigationNetwork } from '#core/world/navigation';
import type { BlueprintProductionScheduledStep } from '#core/blueprint/production-schedule';
import type {
    BlueprintProductionPlacementEndpointAccess,
    BlueprintProductionTransitEndpointAccess,
} from '#core/blueprint/production-endpoint-access';
import { BlueprintProductionLogisticsConfigurationAnalyzer } from '#core/blueprint/production-logistics-configuration';
import { analyzeProductionEmployeeExecution } from '#core/blueprint/production-employee-execution';
import { planBlueprintProductionMovement } from '#core/blueprint/production-movement-plan';
import { BlueprintProductionMovementFeasibilityAnalyzer } from '#core/blueprint/production-movement-feasibility';
import {
    BlueprintProductionTransferAnalyzer,
    type BlueprintProductionNetworkRouteCandidate,
    type BlueprintProductionTransferAssignmentPair,
    type BlueprintProductionTransferRouteUnavailableReason,
} from '#core/blueprint/production-transfers';

export * from '#core/blueprint/production-logistics-types';

import type {
    BlueprintProductionInputDestinationAssignment,
    BlueprintProductionInputMovementCandidate,
    BlueprintProductionInputSupplyPair,
    BlueprintProductionLogisticsDataset,
    BlueprintProductionLogisticsRequirementPair,
    BlueprintProductionLogisticsResult,
    BlueprintProductionPurchasedInputRequirement,
    BlueprintProductionTransferCapacity,
} from '#core/blueprint/production-logistics-types';

interface IndexedRoute {
    readonly employee: BlueprintEmployeeAssignment;
    readonly role: ProductionLogisticsEmployeeRole;
    readonly route: BlueprintHandlerRoute;
    readonly storedOrderIndex: number;
}

export class BlueprintProductionLogisticsAnalyzer {
    readonly #transfers: BlueprintProductionTransferAnalyzer;
    readonly #configuration: BlueprintProductionLogisticsConfigurationAnalyzer;
    readonly #movementFeasibility: BlueprintProductionMovementFeasibilityAnalyzer;
    readonly #catalog: ProductionLogisticsCatalog;
    readonly #navigation: NavigationGraph;
    readonly #navigationNetwork: NavigationNetwork;
    readonly #itemById: ReadonlyMap<string, Item>;
    readonly #buildableByItemId: ReadonlyMap<string, Buildable>;

    constructor(dataset: BlueprintProductionLogisticsDataset) {
        this.#transfers = new BlueprintProductionTransferAnalyzer(dataset);
        this.#movementFeasibility = new BlueprintProductionMovementFeasibilityAnalyzer(dataset);
        this.#catalog = ProductionLogisticsCatalogSchema.assert(dataset.productionLogistics);
        this.#navigation = dataset.navigation;
        this.#navigationNetwork = new NavigationNetwork(dataset.navigation);
        this.#itemById = indexUnique(
            dataset.items.map((input) => {
                const item = ItemSchema.assert(input);
                if (!Number.isSafeInteger(item.stackLimit) || item.stackLimit <= 0) {
                    throw new RangeError(
                        `Item ${JSON.stringify(item.id)} stack limit must be a positive safe integer`
                    );
                }
                return item;
            }),
            (item) => item.id,
            'item ID'
        );
        this.#buildableByItemId = indexUnique(
            dataset.buildables.map((buildable) => BuildableSchema.assert(buildable)),
            (buildable) => buildable.itemId,
            'buildable item ID'
        );
        this.#configuration = new BlueprintProductionLogisticsConfigurationAnalyzer(
            this.#catalog,
            this.#itemById,
            this.#buildableByItemId
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
        const configuration = this.#configuration.analyze(blueprint, propertyEmployeeCapacity);
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
        const accessByPlacementId = new Map(
            transfers.endpointAccess.placements.map((placement) => [placement.placementId, placement])
        );
        const requirements = transfers.requirements.map((requirement) => ({
            itemId: requirement.itemId,
            producerStepIndex: requirement.producerStepIndex,
            consumerStepIndex: requirement.consumerStepIndex,
            requiredQuantity: requirement.requiredQuantity,
            assignmentPairs: requirement.assignmentPairs.map((pair) =>
                this.#requirementPair(requirement.itemId, pair, routes, placementById)
            ),
        }));
        const purchasedInputRequirements = this.#purchasedInputRequirements(
            blueprint,
            plan,
            transfers.schedule.schedule,
            routes,
            placementById,
            accessByPlacementId
        );
        const movementPlan = planBlueprintProductionMovement(
            blueprint,
            this.#catalog,
            requirements,
            purchasedInputRequirements
        );
        const movementPhysicalFeasibility = this.#movementFeasibility.analyze(
            blueprint,
            transfers.endpointAccess,
            movementPlan
        );
        const employeeExecution = analyzeProductionEmployeeExecution(
            blueprint,
            plan,
            this.#catalog,
            transfers,
            this.#navigation
        );
        return {
            kind: 'analyzed',
            transfers,
            configuration,
            productionRequirementScope: 'internally-produced-plan-dependencies',
            purchasedInputSupplyScope: 'first-production-consumers',
            routeQuantityAllocation: 'evaluated-static-empty-destination-capacity',
            transferTiming: 'selected-network-traversals-only',
            movementPlan,
            movementPhysicalFeasibility,
            employeeExecution,
            requirements,
            purchasedInputRequirements,
        };
    }

    #purchasedInputRequirements(
        blueprint: BlueprintDocument,
        plan: ProductionBatchPlan,
        schedule: readonly BlueprintProductionScheduledStep[],
        routes: readonly IndexedRoute[],
        placementById: ReadonlyMap<string, BlueprintDocument['placements'][number]>,
        accessByPlacementId: ReadonlyMap<string, BlueprintProductionPlacementEndpointAccess>
    ): BlueprintProductionPurchasedInputRequirement[] {
        const scheduledByStep = new Map(schedule.map((step) => [step.stepIndex, step]));
        return plan.purchases.flatMap((purchase) => {
            const consumers = plan.productionSteps.flatMap((step, consumerStepIndex) => {
                const matchingInputs = step.inputs.filter((input) => input.itemId === purchase.itemId);
                if (matchingInputs.length === 0) return [];
                const quantityPerBatch = matchingInputs.reduce(
                    (sum, input) => addFinite(sum, input.quantityPerBatch, 'Purchased input quantity per batch'),
                    0
                );
                const requiredQuantity = matchingInputs.reduce(
                    (sum, input) => addFinite(sum, input.totalQuantity, 'Purchased input required quantity'),
                    0
                );
                const scheduled = scheduledByStep.get(consumerStepIndex);
                if (scheduled === undefined) {
                    throw new Error(`Production schedule is missing consumer step ${consumerStepIndex}`);
                }
                return [{ consumerStepIndex, quantityPerBatch, requiredQuantity, scheduled }];
            });
            if (consumers.length === 0) return [];
            const requiredQuantity = consumers.reduce(
                (sum, consumer) => addFinite(sum, consumer.requiredQuantity, 'Purchased input total requirement'),
                0
            );
            requireSameNumber(
                purchase.requiredQuantity,
                requiredQuantity,
                `Purchased input ${purchase.itemId} requirement`
            );
            const destinationAssignments = consumers.flatMap((consumer) =>
                consumer.scheduled.assignments.map((assignment) => ({
                    consumerStepIndex: consumer.consumerStepIndex,
                    placementId: assignment.placementId,
                    batchCount: assignment.batchCount,
                    requiredQuantity: multiplyFinite(
                        assignment.batchCount,
                        consumer.quantityPerBatch,
                        `Purchased input ${purchase.itemId} destination quantity`
                    ),
                }))
            );
            requireSameNumber(
                destinationAssignments.reduce(
                    (sum, assignment) => addFinite(
                        sum,
                        assignment.requiredQuantity,
                        `Purchased input ${purchase.itemId} destination total`
                    ),
                    0
                ),
                requiredQuantity,
                `Purchased input ${purchase.itemId} destination assignments`
            );
            const supplies = blueprint.productionLogistics.supplies.filter(
                (supply) => supply.itemId === purchase.itemId
            );
            const plannedSupplyQuantity = supplies.reduce(
                (sum, supply) => addFinite(sum, supply.quantity, 'Planned input supply quantity'),
                0
            );
            const supplyPairs = supplies.flatMap((supply) =>
                destinationAssignments.map((destination) => this.#inputSupplyPair(
                    blueprint,
                    supply,
                    destination,
                    plan.productionSteps[destination.consumerStepIndex]?.method,
                    routes,
                    placementById,
                    accessByPlacementId
                ))
            );
            return [{
                itemId: purchase.itemId,
                requiredQuantity,
                purchaseQuantity: purchase.purchaseQuantity,
                plannedSupplyQuantity,
                supplyQuantityCoverage:
                    plannedSupplyQuantity >= requiredQuantity ? 'sufficient' as const : 'insufficient' as const,
                destinationAssignments,
                supplyPairs,
            }];
        });
    }

    #inputSupplyPair(
        blueprint: BlueprintDocument,
        supply: BlueprintProductionSupply,
        destination: BlueprintProductionInputDestinationAssignment,
        consumerMethod: ProductionBatchPlan['productionSteps'][number]['method'] | undefined,
        routes: readonly IndexedRoute[],
        placementById: ReadonlyMap<string, BlueprintDocument['placements'][number]>,
        accessByPlacementId: ReadonlyMap<string, BlueprintProductionPlacementEndpointAccess>
    ): BlueprintProductionInputSupplyPair {
        const item = this.#itemById.get(supply.itemId);
        if (item === undefined) {
            throw new Error(`Blueprint supply references unavailable item ${JSON.stringify(supply.itemId)}`);
        }
        const networkRoutes = this.#networkRoutes(
            supply.sourcePlacementId,
            destination.placementId,
            accessByPlacementId
        );
        const employeeCandidates = blueprint.productionLogistics.employees.flatMap(
            (employee): BlueprintProductionInputMovementCandidate[] => {
                const role = this.#catalog.employeeRoles.find(
                    (candidate) => candidate.employeeType === employee.employeeType
                );
                if (role === undefined) return [];
                if (employee.employeeType === 'Botanist') {
                    if (consumerMethod !== 'seed-harvest' && consumerMethod !== 'shroom-harvest') {
                        return [];
                    }
                    if (employee.supplyPlacementId !== supply.sourcePlacementId ||
                        !employee.assignedPotPlacementIds.includes(destination.placementId)) return [];
                    return [{
                        kind: 'botanist-station-specific',
                        employeeId: employee.id,
                        networkRouteCandidateStatus: networkRoutes.candidates.length > 0
                            ? 'available' as const
                            : 'unavailable' as const,
                        unavailableReasons: networkRoutes.unavailableReasons,
                        networkRouteCandidates: networkRoutes.candidates,
                        capacity: this.#capacity(
                            item,
                            supply.quantity,
                            destination.requiredQuantity,
                            role,
                            destination.placementId,
                            placementById
                        ),
                    }];
                }
                if (employee.employeeType !== 'Handler') return [];
                return routes.flatMap((entry) => {
                    if (entry.employee.id !== employee.id ||
                        entry.route.sourcePlacementId !== supply.sourcePlacementId ||
                        entry.route.destinationPlacementId !== destination.placementId ||
                        !routeAllowsItem(entry.route, supply.itemId)) return [];
                    return [{
                        kind: 'configured-handler-route' as const,
                        employeeId: employee.id,
                        routeId: entry.route.id,
                        storedOrderIndex: entry.storedOrderIndex,
                        networkRouteCandidateStatus: networkRoutes.candidates.length > 0
                            ? 'available' as const
                            : 'unavailable' as const,
                        unavailableReasons: networkRoutes.unavailableReasons,
                        networkRouteCandidates: networkRoutes.candidates,
                        capacity: this.#capacity(
                            item,
                            supply.quantity,
                            destination.requiredQuantity,
                            role,
                            destination.placementId,
                            placementById
                        ),
                    }];
                });
            }
        );
        const movementCandidates: BlueprintProductionInputMovementCandidate[] = employeeCandidates;
        return {
            supplyId: supply.id,
            sourcePlacementId: supply.sourcePlacementId,
            sourceQuantity: supply.quantity,
            consumerStepIndex: destination.consumerStepIndex,
            destinationPlacementId: destination.placementId,
            destinationRequiredQuantity: destination.requiredQuantity,
            movementCoverage: movementCandidates.length > 0 ? 'configured' : 'unconfigured',
            movementCandidates,
        };
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
                unavailableReasons: pair.unavailableReasons,
                networkRouteCandidates: pair.networkRouteCandidates,
                capacity: this.#capacity(
                    item,
                    pair.sourceProducedQuantity,
                    pair.destinationRequiredQuantity,
                    entry.role,
                    pair.destinationPlacementId,
                    placementById
                ),
            }];
        });
        return {
            sourcePlacementId: pair.sourcePlacementId,
            sourceAvailableQuantity: pair.sourceProducedQuantity,
            destinationPlacementId: pair.destinationPlacementId,
            destinationRequiredQuantity: pair.destinationRequiredQuantity,
            configuredRouteCoverage:
                configuredRouteCandidates.length > 0 ? 'configured' : 'unconfigured',
            configuredRouteCandidates,
        };
    }

    #networkRoutes(
        sourcePlacementId: string,
        destinationPlacementId: string,
        accessByPlacementId: ReadonlyMap<string, BlueprintProductionPlacementEndpointAccess>
    ): {
        readonly unavailableReasons: readonly BlueprintProductionTransferRouteUnavailableReason[];
        readonly candidates: readonly BlueprintProductionNetworkRouteCandidate[];
    } {
        const sources = reachableEndpoints(
            accessByPlacementId.get(sourcePlacementId)?.transitAccessPoints ?? []
        );
        const destinations = reachableEndpoints(
            accessByPlacementId.get(destinationPlacementId)?.transitAccessPoints ?? []
        );
        const unavailableReasons: BlueprintProductionTransferRouteUnavailableReason[] = [];
        if (sources.length === 0) {
            unavailableReasons.push('source-has-no-network-reachable-transit-point');
        }
        if (destinations.length === 0) {
            unavailableReasons.push('destination-has-no-network-reachable-transit-point');
        }
        return {
            unavailableReasons,
            candidates: sources.flatMap((source) => destinations.map((destination) => {
                const path = this.#navigationNetwork.findPathBetweenSamples({
                    startSampleIndex: source.employeeReachability.path.end.sampleIndex,
                    endSampleIndex: destination.employeeReachability.path.end.sampleIndex,
                });
                if (path.kind !== 'found') {
                    throw new Error(
                        `Production route ${sourcePlacementId} to ${destinationPlacementId} ` +
                            'contains disconnected reachable samples'
                    );
                }
                return {
                    sourcePlacementId,
                    sourceAccessPointIndex: source.accessPointIndex,
                    sourceNetworkEndpoint: source.employeeReachability.path.end,
                    destinationPlacementId,
                    destinationAccessPointIndex: destination.accessPointIndex,
                    destinationNetworkEndpoint: destination.employeeReachability.path.end,
                    path,
                };
            })),
        };
    }

    #capacity(
        item: Item,
        sourceAvailableQuantity: number,
        requestedDestinationQuantity: number,
        role: ProductionLogisticsEmployeeRole,
        destinationPlacementId: string,
        placementById: ReadonlyMap<string, BlueprintDocument['placements'][number]>
    ): BlueprintProductionTransferCapacity {
        const destinationPlacement = placementById.get(destinationPlacementId);
        const destinationBuildable = destinationPlacement === undefined
            ? undefined
            : this.#buildableByItemId.get(destinationPlacement.itemId);
        const destinationCapacity = destinationBuildable === undefined
            ? {
                status: 'filter-evidence-unavailable' as const,
                quantity: null,
                basis: 'unavailable' as const,
                compatibleInputSlotIndexes: null,
            }
            : this.#emptyInputCapacity(destinationBuildable, item);
        const employeeInventoryCapacity = multiplyCapacity(
            role.inventorySlotCount,
            item.stackLimit,
            'Employee inventory capacity'
        );
        const limits = [
            sourceAvailableQuantity,
            requestedDestinationQuantity,
            employeeInventoryCapacity,
        ];
        if (destinationCapacity.quantity !== null) limits.push(destinationCapacity.quantity);
        return {
            itemId: item.id,
            itemStackLimit: item.stackLimit,
            sourceAvailableQuantity,
            requestedDestinationQuantity,
            employeeInventoryCapacity,
            destinationEmptyCapacity: destinationCapacity.quantity,
            destinationCapacityStatus: destinationCapacity.status,
            destinationCapacityBasis: destinationCapacity.basis,
            destinationCompatibleInputSlotIndexes:
                destinationCapacity.compatibleInputSlotIndexes,
            maximumMovedQuantityPerTrip:
                destinationCapacity.quantity === null ? null : Math.min(...limits),
            movedQuantityLimits: [...this.#catalog.routeRules.movedQuantityLimits],
            currentSlotContents: 'not-evaluated',
        };
    }

    #emptyInputCapacity(
        buildable: Buildable,
        item: Item
    ): {
        readonly status: 'calculated' | 'filter-evidence-unavailable';
        readonly quantity: number | null;
        readonly basis:
            'normalized-station-input-slots' |
            'normalized-storage-slots' |
            'unavailable';
        readonly compatibleInputSlotIndexes: readonly number[] | null;
    } {
        const station = this.#catalog.stations.find((entry) => entry.itemId === buildable.itemId);
        if (station !== undefined) {
            const compatibleInputSlotIndexes: number[] = [];
            for (const slot of station.inputSlots) {
                const compatibility = slotAllowsItem(slot, item);
                if (compatibility === 'unknown') {
                    return {
                        status: 'filter-evidence-unavailable',
                        quantity: null,
                        basis: 'normalized-station-input-slots',
                        compatibleInputSlotIndexes: null,
                    };
                }
                if (compatibility) compatibleInputSlotIndexes.push(slot.index);
            }
            return {
                status: 'calculated',
                quantity: multiplyCapacity(
                    compatibleInputSlotIndexes.length,
                    item.stackLimit,
                    'Station input capacity'
                ),
                basis: 'normalized-station-input-slots',
                compatibleInputSlotIndexes,
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
                basis: 'normalized-storage-slots',
                compatibleInputSlotIndexes: Array.from(
                    { length: buildable.storage.slotCount },
                    (_, index) => index
                ),
            };
        }
        return {
            status: 'filter-evidence-unavailable',
            quantity: null,
            basis: 'unavailable',
            compatibleInputSlotIndexes: null,
        };
    }
}

function routeAllowsItem(route: BlueprintHandlerRoute, itemId: string): boolean {
    const listed = route.filter.itemIds.includes(itemId);
    return route.filter.mode === 'whitelist' ? listed : !listed;
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

function multiplyFinite(left: number, right: number, label: string): number {
    const value = left * right;
    if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
    return value;
}

function addFinite(left: number, right: number, label: string): number {
    const value = left + right;
    if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
    return value;
}

function requireSameNumber(actual: number, expected: number, label: string): void {
    const tolerance = 1e-9 * Math.max(1, Math.abs(actual), Math.abs(expected));
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
        throw new Error(`${label} is inconsistent`);
    }
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
