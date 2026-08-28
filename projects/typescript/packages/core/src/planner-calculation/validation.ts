import {
    PlannerCalculationContextSelectionSchema,
    PlannerProductionEvidenceRequestSchema,
    PlannerProgressionRequestFactsSchema,
    type PlannerCalculationContextSelection,
    type PlannerMovementPosition,
    type PlannerProductionEvidenceRequest,
    type PlannerPropertyTransferCandidate,
    type PlannerPropertyTransferMovementAssignment,
    type PlannerRealizedCostTreatment,
} from '#core/data/planner-calculation';
import {
    type PlannerCompatibility,
    type PlannerCustomerDrugAffinity,
    type PlannerInventoryOwner,
    type PlannerInventorySnapshot,
    type PlannerProfileBundle,
    type PlannerStateSnapshot,
    type PlannerStringSetValue,
} from '#core/data/planner-profile';
import { normalizeMixingRuleProfile } from '#core/data/mixing';
import {
    validatePlannerInventorySnapshot,
    validatePlannerProfileBundle,
} from '#core/planner-profile/validation';
import type { PersonEligibilityFacts } from '#core/relationship/eligibility';
import type { PlayerProgressionFacts } from '#core/progression/availability';
import type { FinishedRecipeInventoryItem } from '#core/production/inventory';
import type {
    FinishedRecipePropertyTransferEvidence,
    FinishedRecipePropertyTransferSupply,
} from '#core/production/property-transfer-types';
import type { FinishedRecipePropertyTransferMovementEvidence } from '#core/production/property-transfer-arrival-types';
import type {
    FinishedRecipeShoppingMovementModel,
    FinishedRecipeShoppingObjective,
    FinishedRecipeShoppingTravelEvidence,
    FinishedRecipeRemoteDeliveryEvidence,
} from '#core/production/shopping-route-types';
import type {
    FinishedRecipeProductionExecutionEvidence,
    FinishedRecipeSaleCompletionEvidence,
} from '#core/production/finished-recipe-lifecycle-types';
import type {
    FinishedRecipeRealizedCostEvidence,
    FinishedRecipeRealizedCostTreatment,
    FinishedRecipeRealizedRevenueEvidence,
} from '#core/production/finished-recipe-profit-types';

export interface PlannerCalculationContext {
    readonly profileId: string;
    readonly compatibility: PlannerCompatibility;
    readonly selection: PlannerCalculationContextSelection;
    readonly state: PlannerStateSnapshot;
    readonly inventories: readonly PlannerInventorySnapshot[];
}

export type PlannerProjectionGapCode =
    | 'current-rank-unknown'
    | 'unlocked-products-unknown'
    | 'unlocked-products-partial'
    | 'accessible-shops-unknown'
    | 'accessible-shops-partial'
    | 'owned-properties-unknown'
    | 'owned-properties-partial'
    | 'property-ownership-unknown'
    | 'unlocked-people-unknown'
    | 'unlocked-people-partial'
    | 'relationships-unknown'
    | 'relationships-partial'
    | 'recommended-dealers-unknown'
    | 'recommended-dealers-partial'
    | 'recruited-dealers-unknown'
    | 'recruited-dealers-partial'
    | 'customer-state-unknown'
    | 'customer-state-partial'
    | 'customer-state-not-recorded'
    | 'customer-addiction-unknown'
    | 'customer-order-limit-unknown'
    | 'customer-affinities-unknown'
    | 'customer-affinities-partial'
    | 'inventory-not-selected'
    | 'inventory-coverage-partial'
    | 'inventory-quantity-unknown'
    | 'inventory-quantity-not-whole';

export interface PlannerProjectionGap {
    readonly code: PlannerProjectionGapCode;
}

export interface PlannerProgressionFactsProjection {
    readonly facts: PlayerProgressionFacts;
    readonly gaps: readonly PlannerProjectionGap[];
}

export interface PlannerPersonEligibilityFactsProjection {
    readonly facts: PersonEligibilityFacts;
    readonly gaps: readonly PlannerProjectionGap[];
}

export interface PlannerCustomerCalculationFacts {
    readonly customerId: string;
    readonly addiction?: number;
    readonly orderLimitMultiplier?: number;
    readonly drugAffinities?: readonly PlannerCustomerDrugAffinity[];
}

export interface PlannerCustomerFactsProjection {
    readonly facts: PlannerCustomerCalculationFacts;
    readonly gaps: readonly PlannerProjectionGap[];
}

export type PlannerInventoryProjection =
    | {
        readonly status: 'available';
        readonly items: readonly FinishedRecipeInventoryItem[];
        readonly gaps: readonly [];
    }
    | {
        readonly status: 'unavailable';
        readonly items: null;
        readonly gaps: readonly PlannerProjectionGap[];
    };

export interface PlannerPropertyTransferInputs {
    readonly supplies: readonly FinishedRecipePropertyTransferSupply[];
    readonly evidence: FinishedRecipePropertyTransferEvidence;
    readonly movementEvidence: FinishedRecipePropertyTransferMovementEvidence | null;
}

export interface PlannerShoppingEvidenceInputs {
    readonly objective: FinishedRecipeShoppingObjective;
    readonly movement: FinishedRecipeShoppingMovementModel;
    readonly travel: FinishedRecipeShoppingTravelEvidence;
    readonly remoteDelivery: FinishedRecipeRemoteDeliveryEvidence;
    readonly maximumStates: number;
}

export interface PlannerLifecycleEvidenceInputs {
    readonly execution?: FinishedRecipeProductionExecutionEvidence;
    readonly sale?: FinishedRecipeSaleCompletionEvidence;
}

export type PlannerRealizedEvidenceProjection =
    | {
        readonly status: 'available';
        readonly revenue: FinishedRecipeRealizedRevenueEvidence;
        readonly costs: FinishedRecipeRealizedCostEvidence;
        readonly gaps: readonly [];
    }
    | {
        readonly status: 'unavailable';
        readonly revenue: null;
        readonly costs: null;
        readonly gaps: readonly ('realized-revenue-unknown' | 'realized-costs-unknown')[];
    };

const sha256Pattern = /^[a-f0-9]{64}$/u;
const realizedCostCategories = [
    'materials',
    'equipment',
    'labor',
    'transport',
    'sale-fees',
    'other',
] as const;

export function validatePlannerProductionEvidenceRequest(
    input: unknown
): PlannerProductionEvidenceRequest {
    const request = PlannerProductionEvidenceRequestSchema.assert(input);
    requireId(request.requestId, 'Planner production request ID');
    requireId(request.profileId, 'Planner production profile ID');
    validateTimestamp(request.createdAt, 'Planner production request createdAt');
    validateCompatibility(request.compatibility, 'Planner production request');
    validateContextSelection(request.context);
    validateProductionIdentity(request);
    if (request.positions.status === 'known') validatePositions(request.positions.values);
    validatePropertyTransfers(request);
    validateShopping(request);
    validateLifecycle(request);
    validateRealizedEvidence(request);
    return request;
}

export function validatePlannerProductionEvidenceRequestForBundle(
    input: unknown,
    bundleInput: unknown
): PlannerProductionEvidenceRequest {
    const request = validatePlannerProductionEvidenceRequest(input);
    const bundle = validatePlannerProfileBundle(bundleInput);
    if (request.profileId !== bundle.manifest.profileId) {
        throw new Error('Planner production request belongs to a different profile');
    }
    if (!sameCompatibility(request.compatibility, bundle.manifest.compatibility)) {
        throw new Error('Planner production request is incompatible with the selected profile');
    }
    const context = resolvePlannerCalculationContext(bundle, request.context);
    const inventoryOwner = request.production.inventoryOwner;
    if (
        inventoryOwner !== null &&
        !context.inventories.some(({ owner }) =>
            inventoryOwnerKey(owner) === inventoryOwnerKey(inventoryOwner)
        )
    ) {
        throw new Error('Planner production request references an unselected inventory owner');
    }
    return request;
}

export function resolvePlannerCalculationContext(
    bundleInput: unknown,
    selectionInput: unknown
): PlannerCalculationContext {
    const bundle = validatePlannerProfileBundle(bundleInput);
    const selection = PlannerCalculationContextSelectionSchema.assert(selectionInput);
    validateContextSelection(selection);

    const state = selection.state.kind === 'manual-state'
        ? selectedManualState(bundle, selection.state.documentId)
        : selectedObservation(bundle, selection.state.documentId).state;
    const inventories = selectedInventories(bundle, selection);
    requireUnique(
        inventories,
        ({ owner }) => inventoryOwnerKey(owner),
        'Planner calculation inventory owners'
    );
    return {
        profileId: bundle.manifest.profileId,
        compatibility: { ...bundle.manifest.compatibility },
        selection,
        state,
        inventories,
    };
}

export function plannerProgressionFacts(
    state: PlannerStateSnapshot,
    requestFactsInput: unknown
): PlannerProgressionFactsProjection {
    const requestFacts = PlannerProgressionRequestFactsSchema.assert(requestFactsInput);
    validateStringSet(requestFacts.unlockedProductIds, 'Unlocked product IDs');
    validateStringSet(requestFacts.accessibleShopCodes, 'Accessible shop codes');
    const facts: Mutable<PlayerProgressionFacts> = {};
    const gaps: PlannerProjectionGap[] = [];

    if (state.currentRank.status === 'known') facts.currentRank = { ...state.currentRank.value };
    else gaps.push({ code: 'current-rank-unknown' });
    projectCompleteStringSet(
        requestFacts.unlockedProductIds,
        'unlocked-products',
        gaps,
        (values) => { facts.unlockedProductIds = values; }
    );
    projectCompleteStringSet(
        requestFacts.accessibleShopCodes,
        'accessible-shops',
        gaps,
        (values) => { facts.accessibleShopCodes = values; }
    );
    if (state.properties.status === 'unknown') {
        gaps.push({ code: 'owned-properties-unknown' });
    } else if (state.properties.coverage === 'partial') {
        gaps.push({ code: 'owned-properties-partial' });
    } else if (state.properties.values.some(({ owned }) => owned.status === 'unknown')) {
        gaps.push({ code: 'property-ownership-unknown' });
    } else {
        facts.ownedPropertyCodes = state.properties.values
            .filter(({ owned }) => owned.status === 'known' && owned.value)
            .map(({ propertyCode }) => propertyCode);
    }
    return { facts, gaps };
}

export function plannerPersonEligibilityFacts(
    state: PlannerStateSnapshot
): PlannerPersonEligibilityFactsProjection {
    const facts: Mutable<PersonEligibilityFacts> = {};
    const gaps: PlannerProjectionGap[] = [];
    if (state.currentRank.status === 'known') facts.currentRank = { ...state.currentRank.value };
    else gaps.push({ code: 'current-rank-unknown' });
    projectCompleteStringSet(
        state.unlockedPersonIds,
        'unlocked-people',
        gaps,
        (values) => { facts.unlockedPersonIds = values; }
    );
    if (state.relationships.status === 'unknown') {
        gaps.push({ code: 'relationships-unknown' });
    } else if (state.relationships.coverage === 'partial') {
        gaps.push({ code: 'relationships-partial' });
    } else {
        facts.relationships = state.relationships.values.map((value) => ({ ...value }));
    }
    projectCompleteStringSet(
        state.recommendedDealerIds,
        'recommended-dealers',
        gaps,
        (values) => { facts.recommendedDealerIds = values; }
    );
    projectCompleteStringSet(
        state.recruitedDealerIds,
        'recruited-dealers',
        gaps,
        (values) => { facts.recruitedDealerIds = values; }
    );
    return { facts, gaps };
}

export function plannerCustomerFacts(
    state: PlannerStateSnapshot,
    customerId: string
): PlannerCustomerFactsProjection {
    requireId(customerId, 'Planner customer ID');
    const facts: Mutable<PlannerCustomerCalculationFacts> = { customerId };
    const gaps: PlannerProjectionGap[] = [];
    if (state.customers.status === 'unknown') {
        gaps.push({ code: 'customer-state-unknown' });
        return { facts, gaps };
    }
    const customer = state.customers.values.find((candidate) =>
        candidate.customerId === customerId
    );
    if (customer === undefined) {
        gaps.push({
            code: state.customers.coverage === 'complete'
                ? 'customer-state-not-recorded'
                : 'customer-state-partial',
        });
        return { facts, gaps };
    }
    if (state.customers.coverage === 'partial') gaps.push({ code: 'customer-state-partial' });
    if (customer.addiction.status === 'known') facts.addiction = customer.addiction.value;
    else gaps.push({ code: 'customer-addiction-unknown' });
    if (customer.orderLimitMultiplier.status === 'known') {
        facts.orderLimitMultiplier = customer.orderLimitMultiplier.value;
    } else {
        gaps.push({ code: 'customer-order-limit-unknown' });
    }
    if (customer.drugAffinities.status === 'unknown') {
        gaps.push({ code: 'customer-affinities-unknown' });
    } else if (customer.drugAffinities.coverage === 'partial') {
        gaps.push({ code: 'customer-affinities-partial' });
    } else {
        facts.drugAffinities = customer.drugAffinities.values.map((value) => ({ ...value }));
    }
    return { facts, gaps };
}

export function plannerFinishedRecipeInventory(
    inventories: readonly PlannerInventorySnapshot[],
    owner: PlannerInventoryOwner
): PlannerInventoryProjection {
    requireId(owner.id, 'Planner inventory owner ID');
    inventories.forEach((inventory, index) =>
        validatePlannerInventorySnapshot(inventory, `Planner calculation inventory ${index}`)
    );
    requireUnique(
        inventories,
        ({ owner: candidateOwner }) => inventoryOwnerKey(candidateOwner),
        'Planner calculation inventory owners'
    );
    const inventory = inventories.find((candidate) =>
        inventoryOwnerKey(candidate.owner) === inventoryOwnerKey(owner)
    );
    if (inventory === undefined) {
        return unavailableInventory('inventory-not-selected');
    }
    if (inventory.coverage === 'partial') {
        return unavailableInventory('inventory-coverage-partial');
    }
    if (inventory.entries.some(({ currentQuantity }) => currentQuantity.status === 'unknown')) {
        return unavailableInventory('inventory-quantity-unknown');
    }
    const quantities = inventory.entries.map(({ itemId, currentQuantity }) => ({
        itemId,
        quantity: currentQuantity.status === 'known' ? currentQuantity.value : Number.NaN,
    }));
    if (quantities.some(({ quantity }) => !Number.isSafeInteger(quantity) || quantity < 0)) {
        return unavailableInventory('inventory-quantity-not-whole');
    }
    return { status: 'available', items: quantities, gaps: [] };
}

export function plannerPropertyTransferInputs(
    requestInput: unknown
): PlannerPropertyTransferInputs | null {
    const request = validatePlannerProductionEvidenceRequest(requestInput);
    if (request.propertyTransfers.status === 'unknown') return null;
    const value = request.propertyTransfers.value;
    return {
        supplies: value.supplies.map((supply) => ({ ...supply })),
        evidence: {
            coverage: value.evidence.coverage,
            candidates: value.evidence.candidates.map((candidate) => ({ ...candidate })),
        },
        movementEvidence: value.movement.status === 'unknown'
            ? null
            : {
                coverage: value.movement.value.coverage,
                maximumTripsPerAllocation: value.movement.value.maximumTripsPerAllocation,
                assignments: value.movement.value.assignments.map((assignment) => ({
                    ...assignment,
                    outboundLeg: assignment.outboundLeg === null
                        ? null
                        : { ...assignment.outboundLeg },
                    returnLeg: assignment.returnLeg === null
                        ? null
                        : { ...assignment.returnLeg },
                })),
            },
    };
}

export function plannerShoppingEvidenceInputs(
    requestInput: unknown
): PlannerShoppingEvidenceInputs | null {
    const request = validatePlannerProductionEvidenceRequest(requestInput);
    if (request.shopping.status === 'unknown') return null;
    const value = request.shopping.value;
    return {
        objective: value.objective,
        movement: {
            ...value.movement,
            itemLoadUnits: value.movement.itemLoadUnits.map((entry) => ({ ...entry })),
        },
        travel: {
            ...value.travel,
            legs: value.travel.legs.map((leg) => ({ ...leg })),
        },
        remoteDelivery: {
            ...value.remoteDelivery,
            deliveries: value.remoteDelivery.deliveries.map((delivery) => ({ ...delivery })),
        },
        maximumStates: value.maximumStates,
    };
}

export function plannerLifecycleEvidenceInputs(
    requestInput: unknown
): PlannerLifecycleEvidenceInputs {
    const request = validatePlannerProductionEvidenceRequest(requestInput);
    return {
        ...(request.lifecycle.execution.status === 'known'
            ? { execution: { ...request.lifecycle.execution.value } }
            : {}),
        ...(request.lifecycle.sale.status === 'known'
            ? { sale: { ...request.lifecycle.sale.value } }
            : {}),
    };
}

export function plannerRealizedEvidence(
    requestInput: unknown
): PlannerRealizedEvidenceProjection {
    const request = validatePlannerProductionEvidenceRequest(requestInput);
    const gaps: ('realized-revenue-unknown' | 'realized-costs-unknown')[] = [];
    if (request.realized.revenue.status === 'unknown') gaps.push('realized-revenue-unknown');
    if (request.realized.costs.status === 'unknown') gaps.push('realized-costs-unknown');
    if (
        request.realized.revenue.status === 'unknown' ||
        request.realized.costs.status === 'unknown'
    ) {
        return { status: 'unavailable', revenue: null, costs: null, gaps };
    }
    const revenue = request.realized.revenue.value;
    const costs = request.realized.costs.value;
    return {
        status: 'available',
        revenue: {
            dataset: { ...request.compatibility },
            quantity: request.production.finishedQuantity,
            coverage: revenue.coverage,
            recordedRevenue: revenue.recordedRevenue,
            evidence: 'caller-supplied-realized-sale-revenue',
        },
        costs: {
            dataset: { ...request.compatibility },
            quantity: request.production.finishedQuantity,
            coverage: costs.coverage,
            accountingBasis: 'caller-supplied-costs-attributed-to-sold-output',
            treatments: costs.treatments.map(realizedCostTreatment),
        },
        gaps: [],
    };
}

function validateProductionIdentity(request: PlannerProductionEvidenceRequest): void {
    requireId(request.production.recipe.productId, 'Planner production product ID');
    request.production.recipe.ingredientIds.forEach((itemId) =>
        requireId(itemId, 'Planner production ingredient ID')
    );
    normalizeMixingRuleProfile(request.production.recipe.ruleProfile);
    requirePositiveSafeInteger(
        request.production.finishedQuantity,
        'Planner production finished quantity'
    );
    requireId(request.production.propertyId, 'Planner production property ID');
    if (request.production.inventoryOwner !== null) {
        requireId(request.production.inventoryOwner.id, 'Planner production inventory owner ID');
    }
}

function validatePositions(positions: readonly PlannerMovementPosition[]): void {
    requireCanonicalEntries(positions, ({ locationId, observedAt, position }) => {
        requireId(locationId, 'Planner movement location ID');
        if (observedAt !== null) validateTimestamp(observedAt, 'Planner movement observedAt');
        if (position.status === 'known') requireVector(position.value, 'Planner movement position');
        return locationId;
    }, 'Planner movement positions');
}

function validatePropertyTransfers(request: PlannerProductionEvidenceRequest): void {
    if (request.propertyTransfers.status === 'unknown') return;
    const value = request.propertyTransfers.value;
    requireCanonicalEntries(value.supplies, (supply) => {
        requireId(supply.propertyId, 'Planner transfer supply property ID');
        requireId(supply.itemId, 'Planner transfer supply item ID');
        requireNonNegativeSafeInteger(
            supply.transferableQuantity,
            'Planner transfer supply quantity'
        );
        return `${supply.propertyId}\0${supply.itemId}`;
    }, 'Planner transfer supplies');
    const candidates = new Map<string, PlannerPropertyTransferCandidate>();
    const pairs = new Set<string>();
    requireCanonicalEntries(value.evidence.candidates, (candidate) => {
        requireId(candidate.candidateId, 'Planner transfer candidate ID');
        requireId(candidate.itemId, 'Planner transfer candidate item ID');
        requireId(candidate.sourcePropertyId, 'Planner transfer source property ID');
        requireId(candidate.destinationPropertyId, 'Planner transfer destination property ID');
        if (candidate.sourcePropertyId === candidate.destinationPropertyId) {
            throw new Error('Planner transfer candidate must connect different properties');
        }
        if (candidate.destinationPropertyId !== request.production.propertyId) {
            throw new Error('Planner transfer candidate targets a different production property');
        }
        if (candidate.quantityCapacity !== null) {
            requireNonNegativeSafeInteger(
                candidate.quantityCapacity,
                'Planner transfer candidate capacity'
            );
        }
        const pair = `${candidate.itemId}\0${candidate.sourcePropertyId}\0${candidate.destinationPropertyId}`;
        if (pairs.has(pair)) throw new Error('Planner transfer candidates contain a duplicate route pair');
        pairs.add(pair);
        candidates.set(candidate.candidateId, candidate);
        return candidate.candidateId;
    }, 'Planner transfer candidates');
    if (value.movement.status === 'unknown') return;
    requirePositiveSafeInteger(
        value.movement.value.maximumTripsPerAllocation,
        'Planner transfer maximum trips per allocation'
    );
    requireCanonicalEntries(value.movement.value.assignments, (assignment) => {
        validateTransferAssignment(assignment, candidates);
        return assignment.candidateId;
    }, 'Planner transfer movement assignments');
}

function validateTransferAssignment(
    assignment: PlannerPropertyTransferMovementAssignment,
    candidates: ReadonlyMap<string, PlannerPropertyTransferCandidate>
): void {
    const candidate = candidates.get(assignment.candidateId);
    if (candidate === undefined) {
        throw new Error('Planner transfer movement references an unknown candidate');
    }
    if (
        assignment.itemId !== candidate.itemId ||
        assignment.sourcePropertyId !== candidate.sourcePropertyId ||
        assignment.destinationPropertyId !== candidate.destinationPropertyId
    ) {
        throw new Error('Planner transfer movement differs from its candidate');
    }
    requireId(assignment.movementModelId, 'Planner transfer movement model ID');
    requirePositiveFinite(assignment.carryingCapacity, 'Planner transfer carrying capacity');
    requirePositiveFinite(assignment.itemLoadUnits, 'Planner transfer item load units');
    requireNonNegativeFinite(assignment.startMinute, 'Planner transfer start minute');
    requireNonNegativeFinite(assignment.loadMinutesPerTrip, 'Planner transfer load minutes');
    requireNonNegativeFinite(assignment.unloadMinutesPerTrip, 'Planner transfer unload minutes');
    if (assignment.outboundLeg !== null) {
        validateTransferLeg(
            assignment.outboundLeg,
            assignment.sourcePropertyId,
            assignment.destinationPropertyId,
            'outbound'
        );
    }
    if (assignment.returnLeg !== null) {
        validateTransferLeg(
            assignment.returnLeg,
            assignment.destinationPropertyId,
            assignment.sourcePropertyId,
            'return'
        );
    }
}

function validateTransferLeg(
    leg: {
        readonly legId: string;
        readonly sourcePropertyId: string;
        readonly destinationPropertyId: string;
        readonly distance: number;
        readonly durationMinutes: number;
    },
    sourcePropertyId: string,
    destinationPropertyId: string,
    direction: string
): void {
    requireId(leg.legId, `Planner transfer ${direction} leg ID`);
    if (
        leg.sourcePropertyId !== sourcePropertyId ||
        leg.destinationPropertyId !== destinationPropertyId
    ) {
        throw new Error(`Planner transfer ${direction} leg has inconsistent endpoints`);
    }
    requireNonNegativeFinite(leg.distance, `Planner transfer ${direction} distance`);
    requireNonNegativeFinite(
        leg.durationMinutes,
        `Planner transfer ${direction} duration`
    );
}

function validateShopping(request: PlannerProductionEvidenceRequest): void {
    if (request.shopping.status === 'unknown') return;
    const value = request.shopping.value;
    requireId(value.movement.modelId, 'Planner shopping movement model ID');
    requirePositiveFinite(value.movement.carryingCapacity, 'Planner shopping carrying capacity');
    requireCanonicalEntries(value.movement.itemLoadUnits, (entry) => {
        requireId(entry.itemId, 'Planner shopping load item ID');
        requirePositiveFinite(entry.loadUnitsPerItem, 'Planner shopping item load units');
        return entry.itemId;
    }, 'Planner shopping item load units');
    requireNonNegativeFinite(value.movement.startMinute, 'Planner shopping start minute');
    requireNonNegativeFinite(
        value.movement.serviceMinutesPerVisit,
        'Planner shopping service minutes'
    );
    requireId(value.travel.depotLocationId, 'Planner shopping depot location ID');
    const pairs = new Set<string>();
    requireCanonicalEntries(value.travel.legs, (leg) => {
        requireId(leg.legId, 'Planner shopping leg ID');
        requireId(leg.fromLocationId, 'Planner shopping leg origin');
        requireId(leg.toLocationId, 'Planner shopping leg destination');
        if (leg.fromLocationId === leg.toLocationId) {
            throw new Error('Planner shopping leg must connect different locations');
        }
        const pair = `${leg.fromLocationId}\0${leg.toLocationId}`;
        if (pairs.has(pair)) throw new Error('Planner shopping legs contain a duplicate directed pair');
        pairs.add(pair);
        requireNonNegativeFinite(leg.distance, 'Planner shopping leg distance');
        requireNonNegativeFinite(leg.durationMinutes, 'Planner shopping leg duration');
        return leg.legId;
    }, 'Planner shopping legs');
    requireCanonicalEntries(value.remoteDelivery.deliveries, (delivery) => {
        requireId(delivery.shopCode, 'Planner remote delivery shop code');
        requireNonNegativeFinite(
            delivery.durationMinutes,
            'Planner remote delivery duration'
        );
        return delivery.shopCode;
    }, 'Planner remote deliveries');
    requirePositiveSafeInteger(value.maximumStates, 'Planner shopping maximum states');
}

function validateLifecycle(request: PlannerProductionEvidenceRequest): void {
    if (request.lifecycle.execution.status === 'known') {
        requireNonNegativeFinite(
            request.lifecycle.execution.value.startMinute,
            'Planner production execution start minute'
        );
    }
    if (request.lifecycle.sale.status === 'unknown') return;
    const sale = request.lifecycle.sale.value;
    requireId(sale.sellerId, 'Planner sale seller ID');
    requireId(sale.destinationId, 'Planner sale destination ID');
    requirePositiveSafeInteger(sale.quantity, 'Planner sale quantity');
    if (sale.quantity !== request.production.finishedQuantity) {
        throw new Error('Planner sale quantity does not match planned output');
    }
    requireNonNegativeFinite(sale.startMinute, 'Planner sale start minute');
    requireNonNegativeFinite(sale.completionMinute, 'Planner sale completion minute');
    const duration = sale.kind === 'direct'
        ? sale.travelDurationMinutes
        : sale.deliveryDurationMinutes;
    requireNonNegativeFinite(duration, 'Planner sale duration');
    if (sale.completionMinute !== sale.startMinute + duration) {
        throw new Error('Planner sale completion minute is inconsistent');
    }
}

function validateRealizedEvidence(request: PlannerProductionEvidenceRequest): void {
    if (request.realized.revenue.status === 'known') {
        requireNonNegativeFinite(
            request.realized.revenue.value.recordedRevenue,
            'Planner realized revenue'
        );
    }
    if (request.realized.costs.status === 'unknown') return;
    const costs = request.realized.costs.value;
    let previousCategory = -1;
    const seen = new Set<string>();
    for (const treatment of costs.treatments) {
        const categoryIndex = realizedCostCategories.indexOf(treatment.category);
        if (seen.has(treatment.category) || categoryIndex <= previousCategory) {
            throw new Error('Planner realized cost treatments must be canonical and unique');
        }
        seen.add(treatment.category);
        previousCategory = categoryIndex;
        requireNonNegativeFinite(treatment.amount, 'Planner realized cost amount');
        if (treatment.treatment === 'not-incurred' && treatment.amount !== 0) {
            throw new Error('Planner not-incurred cost must have a zero amount');
        }
    }
    if (costs.coverage === 'complete' && seen.size !== realizedCostCategories.length) {
        throw new Error('Complete planner realized costs must treat every category');
    }
}

function validateContextSelection(selection: PlannerCalculationContextSelection): void {
    requireId(selection.state.documentId, 'Planner calculation state document ID');
    if (selection.inventories.kind === 'manual-inventories') {
        requireCanonicalIds(
            selection.inventories.documentIds,
            'Planner calculation inventory document IDs'
        );
    } else if (selection.inventories.kind === 'observation') {
        requireId(
            selection.inventories.documentId,
            'Planner calculation observation document ID'
        );
    }
}

function selectedManualState(
    bundle: PlannerProfileBundle,
    documentId: string
): PlannerStateSnapshot {
    if (documentId !== bundle.manualState.metadata.documentId) {
        throw new Error('Planner calculation references an unknown manual state document');
    }
    return bundle.manualState.state;
}

function selectedObservation(bundle: PlannerProfileBundle, documentId: string) {
    if (bundle.observation === null || bundle.observation.metadata.documentId !== documentId) {
        throw new Error('Planner calculation references an unknown observation document');
    }
    return bundle.observation;
}

function selectedInventories(
    bundle: PlannerProfileBundle,
    selection: PlannerCalculationContextSelection
): readonly PlannerInventorySnapshot[] {
    if (selection.inventories.kind === 'none') return [];
    if (selection.inventories.kind === 'observation') {
        return selectedObservation(bundle, selection.inventories.documentId).inventories;
    }
    const byId = new Map(bundle.inventories.map((document) => [
        document.metadata.documentId,
        document.inventory,
    ]));
    return selection.inventories.documentIds.map((documentId) => {
        const inventory = byId.get(documentId);
        if (inventory === undefined) {
            throw new Error('Planner calculation references an unknown inventory document');
        }
        return inventory;
    });
}

function projectCompleteStringSet(
    value: PlannerStringSetValue,
    field: 'unlocked-products' | 'accessible-shops' | 'unlocked-people' |
        'recommended-dealers' | 'recruited-dealers',
    gaps: PlannerProjectionGap[],
    apply: (values: readonly string[]) => void
): void {
    if (value.status === 'unknown') {
        gaps.push({ code: `${field}-unknown` });
    } else if (value.coverage === 'partial') {
        gaps.push({ code: `${field}-partial` });
    } else {
        apply([...value.values]);
    }
}

function validateStringSet(value: PlannerStringSetValue, label: string): void {
    if (value.status === 'known') requireCanonicalIds(value.values, label);
}

function unavailableInventory(code: PlannerProjectionGapCode): PlannerInventoryProjection {
    return { status: 'unavailable', items: null, gaps: [{ code }] };
}

function realizedCostTreatment(
    treatment: PlannerRealizedCostTreatment
): FinishedRecipeRealizedCostTreatment {
    return treatment.treatment === 'included'
        ? {
            category: treatment.category,
            treatment: 'included',
            amount: treatment.amount,
        }
        : {
            category: treatment.category,
            treatment: 'not-incurred',
            amount: 0,
        };
}

function inventoryOwnerKey(owner: PlannerInventoryOwner): string {
    return `${owner.kind}\0${owner.id}`;
}

function validateCompatibility(input: PlannerCompatibility, label: string): void {
    requireNonBlank(input.gameVersion, `${label} game version`);
    if (!sha256Pattern.test(input.datasetSha256)) {
        throw new TypeError(`${label} dataset identity must be a lowercase SHA-256`);
    }
}

function sameCompatibility(left: PlannerCompatibility, right: PlannerCompatibility): boolean {
    return left.gameVersion === right.gameVersion && left.datasetSha256 === right.datasetSha256;
}

function validateTimestamp(value: string, label: string): void {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
        throw new TypeError(`${label} must be a canonical UTC timestamp`);
    }
}

function requireVector(
    value: { readonly x: number; readonly y: number; readonly z: number },
    label: string
): void {
    if (![value.x, value.y, value.z].every(Number.isFinite)) {
        throw new RangeError(`${label} must contain finite coordinates`);
    }
}

function requireCanonicalIds(values: readonly string[], label: string): void {
    requireCanonicalEntries(values, (value) => {
        requireId(value, label);
        return value;
    }, label);
}

function requireCanonicalEntries<T>(
    values: readonly T[],
    key: (value: T, index: number) => string,
    label: string
): void {
    let previous: string | null = null;
    values.forEach((value, index) => {
        const current = key(value, index);
        if (previous !== null && previous >= current) {
            throw new Error(`${label} must be sorted and unique`);
        }
        previous = current;
    });
}

function requireUnique<T>(
    values: readonly T[],
    key: (value: T) => string,
    label: string
): void {
    const seen = new Set<string>();
    for (const value of values) {
        const current = key(value);
        if (seen.has(current)) throw new Error(`${label} contain duplicate ${JSON.stringify(current)}`);
        seen.add(current);
    }
}

function requireId(value: string, label: string): void {
    requireNonBlank(value, label);
    if (value.includes('\0')) throw new TypeError(`${label} must not contain a null character`);
}

function requireNonBlank(value: string, label: string): void {
    if (value.trim().length === 0) throw new TypeError(`${label} must not be blank`);
}

function requirePositiveSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${label} must be a positive safe integer`);
    }
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${label} must be a non-negative safe integer`);
    }
}

function requirePositiveFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${label} must be positive and finite`);
    }
}

function requireNonNegativeFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${label} must be non-negative and finite`);
    }
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
