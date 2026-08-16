import type { FinishedRecipePurchaseRequirement } from '#core/production/finished-recipe-purchase-types';
import { canonicalJson } from '#core/data/canonical-json';
import {
    finishedRecipeShoppingAllocationKey,
    indexFinishedRecipeShoppingAllocationArrivals,
} from '#core/production/shopping-route-validation';
import type {
    FinishedRecipeShoppingPropertyAllocation,
    FinishedRecipeShoppingPropertyAssignment,
    FinishedRecipeShoppingPropertyAttributionGap,
    FinishedRecipeShoppingPropertyAttributionInput,
    FinishedRecipeShoppingPropertyAttributionResult,
    FinishedRecipeShoppingSharedAllocation,
} from '#core/production/shopping-property-attribution-types';
import type { FinishedRecipeShoppingAllocation } from '#core/production/shopping-route-types';

type PropertyAssignment = Extract<
    FinishedRecipeShoppingPropertyAssignment,
    { readonly destination: { readonly kind: 'property' } }
>;

export type {
    FinishedRecipeShoppingPropertyAllocation,
    FinishedRecipeShoppingPropertyAssignment,
    FinishedRecipeShoppingPropertyAttributionDetails,
    FinishedRecipeShoppingPropertyAttributionEvidence,
    FinishedRecipeShoppingPropertyAttributionGap,
    FinishedRecipeShoppingPropertyAttributionInput,
    FinishedRecipeShoppingPropertyAttributionResult,
    FinishedRecipeShoppingSharedAllocation,
} from '#core/production/shopping-property-attribution-types';

export function attributeFinishedRecipeShoppingRouteToProperties(
    input: FinishedRecipeShoppingPropertyAttributionInput
): FinishedRecipeShoppingPropertyAttributionResult {
    validateCoverage(input.evidence.coverage);
    const requirements = indexRequirements(input.purchasePlan.requirements);
    const routeAllocations = indexFinishedRecipeShoppingAllocationArrivals(input.routePlan);
    validateRouteDemand(input, requirements, routeAllocations);
    const assignments = indexAssignments(input.evidence.assignments, routeAllocations);
    const allocations: FinishedRecipeShoppingPropertyAllocation[] = [];
    const sharedAllocations: FinishedRecipeShoppingSharedAllocation[] = [];
    const gaps: FinishedRecipeShoppingPropertyAttributionGap[] = [];

    for (const [routeKey, selected] of routeAllocations) {
        let assignedQuantity = 0;
        for (const assignment of assignments.get(routeKey) ?? []) {
            assignedQuantity = safeAdd(
                assignedQuantity,
                assignment.quantity,
                'Shopping property assigned quantity'
            );
            if (assignedQuantity > selected.allocation.quantity) {
                throw new Error(
                    `Shopping property assignments exceed selected allocation ${JSON.stringify(routeKey)}`
                );
            }
            if (!hasPropertyDestination(assignment)) {
                sharedAllocations.push(sharedAllocation(
                    selected.allocation,
                    assignment.quantity,
                    selected.completionMinute,
                    'destination-property-not-established'
                ));
                gaps.push(attributionGap(
                    'shared-destination-property',
                    selected.allocation,
                    assignment.quantity
                ));
                continue;
            }
            const requirement = requirements.get(propertyItemKey(
                assignment.destination.propertyId,
                assignment.itemId
            ));
            if (requirement === undefined) {
                throw new Error(
                    `Shopping attribution references unknown property demand ${JSON.stringify(assignment.destination.propertyId)} ${JSON.stringify(assignment.itemId)}`
                );
            }
            if (assignment.destination.arrivalMinute < selected.completionMinute) {
                throw new Error(
                    `Shopping property arrival precedes selected ${assignment.access} completion`
                );
            }
            allocations.push(propertyAllocation(
                selected.allocation,
                assignment,
                selected.completionMinute
            ));
        }
        const missingQuantity = selected.allocation.quantity - assignedQuantity;
        if (missingQuantity > 0) {
            sharedAllocations.push(sharedAllocation(
                selected.allocation,
                missingQuantity,
                selected.completionMinute,
                'attribution-assignment-not-recorded'
            ));
            gaps.push(attributionGap(
                'selected-allocation-attribution-missing',
                selected.allocation,
                missingQuantity
            ));
        }
    }

    validatePropertyDemand(requirements, allocations, gaps);
    const canonicalEvidence = {
        coverage: input.evidence.coverage,
        assignments: input.evidence.assignments.map(cloneAssignment).sort(compareAssignments),
    } satisfies FinishedRecipeShoppingPropertyAttributionInput['evidence'];
    const details = {
        scope: 'selected-shopping-allocations-by-destination-property',
        assignmentModel: 'caller-supplied-selected-allocation-partitions',
        evidenceProof: gaps.length === 0
            ? input.evidence.coverage === 'complete'
                ? 'complete'
                : 'selected-allocations-supported'
            : input.evidence.coverage === 'complete'
                ? 'complete'
                : 'partial',
        evidence: canonicalEvidence,
        allocations: allocations.sort(comparePropertyAllocations),
        sharedAllocations: sharedAllocations.sort(compareSharedAllocations),
        gaps: gaps.sort(compareGaps),
    } as const;
    return gaps.length === 0
        ? { kind: 'attributed', proof: 'exact', ...details }
        : {
            kind: 'not-attributed',
            reason: 'destination-property-attribution-unavailable',
            proof: input.evidence.coverage === 'complete' ? 'exact' : 'incomplete',
            ...details,
        };
}

export function validateFinishedRecipeShoppingPropertyAttributionResult(
    purchasePlan: FinishedRecipeShoppingPropertyAttributionInput['purchasePlan'],
    routePlan: FinishedRecipeShoppingPropertyAttributionInput['routePlan'],
    result: FinishedRecipeShoppingPropertyAttributionResult
): void {
    const expected = attributeFinishedRecipeShoppingRouteToProperties({
        purchasePlan,
        routePlan,
        evidence: result.evidence,
    });
    if (canonicalJson(result) !== canonicalJson(expected)) {
        throw new Error('Shopping property attribution result is inconsistent');
    }
}

function indexRequirements(
    input: readonly FinishedRecipePurchaseRequirement[]
): ReadonlyMap<string, FinishedRecipePurchaseRequirement & { readonly requestedQuantity: number }> {
    const result = new Map<
        string,
        FinishedRecipePurchaseRequirement & { readonly requestedQuantity: number }
    >();
    for (const requirement of input) {
        requireNonBlank(requirement.propertyId, 'Shopping attribution property ID');
        requireNonBlank(requirement.itemId, 'Shopping attribution item ID');
        if (requirement.requestedQuantity === null) {
            throw new Error('Shopping attribution requires exact property purchase demand');
        }
        requireNonNegativeSafeInteger(
            requirement.requestedQuantity,
            `Shopping attribution ${JSON.stringify(requirement.itemId)} requested quantity`
        );
        const key = propertyItemKey(requirement.propertyId, requirement.itemId);
        if (result.has(key)) {
            throw new Error(`Shopping attribution contains duplicate property demand ${JSON.stringify(key)}`);
        }
        result.set(key, { ...requirement, requestedQuantity: requirement.requestedQuantity });
    }
    return result;
}

function validateRouteDemand(
    input: FinishedRecipeShoppingPropertyAttributionInput,
    requirements: ReadonlyMap<string, FinishedRecipePurchaseRequirement & { readonly requestedQuantity: number }>,
    routeAllocations: ReturnType<typeof indexFinishedRecipeShoppingAllocationArrivals>
): void {
    if (
        input.purchasePlan.demandProof !== 'exact' ||
        input.purchasePlan.totalRequestedQuantity === null
    ) {
        throw new Error('Shopping attribution requires an exact purchase plan');
    }
    const requiredByItem = new Map<string, number>();
    for (const requirement of requirements.values()) {
        requiredByItem.set(
            requirement.itemId,
            safeAdd(
                requiredByItem.get(requirement.itemId) ?? 0,
                requirement.requestedQuantity,
                'Shopping attribution required quantity'
            )
        );
    }
    const selectedByItem = new Map<string, number>();
    for (const { allocation } of routeAllocations.values()) {
        selectedByItem.set(
            allocation.itemId,
            safeAdd(
                selectedByItem.get(allocation.itemId) ?? 0,
                allocation.quantity,
                'Shopping attribution selected quantity'
            )
        );
    }
    assertSameQuantities(requiredByItem, selectedByItem, 'Shopping attribution selected demand');
    const plannedByItem = new Map<string, number>();
    for (const item of input.purchasePlan.items) {
        requireNonBlank(item.itemId, 'Shopping attribution purchase item ID');
        requireNonNegativeSafeInteger(
            item.requestedQuantity,
            `Shopping attribution purchase item ${JSON.stringify(item.itemId)} quantity`
        );
        if (plannedByItem.has(item.itemId)) {
            throw new Error(`Shopping attribution contains duplicate purchase item ${JSON.stringify(item.itemId)}`);
        }
        plannedByItem.set(item.itemId, item.requestedQuantity);
    }
    assertSameQuantities(requiredByItem, plannedByItem, 'Shopping attribution purchase items');
    const requiredTotal = safeSum([...requiredByItem.values()], 'Shopping attribution demand total');
    if (requiredTotal !== input.purchasePlan.totalRequestedQuantity) {
        throw new Error('Shopping attribution purchase total is inconsistent');
    }
}

function indexAssignments(
    input: readonly FinishedRecipeShoppingPropertyAssignment[],
    routeAllocations: ReturnType<typeof indexFinishedRecipeShoppingAllocationArrivals>
): ReadonlyMap<string, readonly FinishedRecipeShoppingPropertyAssignment[]> {
    const result = new Map<string, FinishedRecipeShoppingPropertyAssignment[]>();
    const identities = new Set<string>();
    for (const assignment of input) {
        requireNonBlank(assignment.shopCode, 'Shopping attribution shop code');
        requireNonBlank(assignment.itemId, 'Shopping attribution item ID');
        requirePositiveSafeInteger(assignment.quantity, 'Shopping attribution quantity');
        const routeKey = finishedRecipeShoppingAllocationKey(assignment);
        if (!routeAllocations.has(routeKey)) {
            throw new Error(
                `Shopping attribution references unknown selected allocation ${JSON.stringify(routeKey)}`
            );
        }
        validateDestination(assignment);
        const destinationKey = assignment.destination.kind === 'property'
            ? `property\u0000${assignment.destination.propertyId}`
            : 'shared';
        const identity = `${routeKey}\u0000${destinationKey}`;
        if (identities.has(identity)) {
            throw new Error(`Shopping attribution contains duplicate assignment ${JSON.stringify(identity)}`);
        }
        identities.add(identity);
        const current = result.get(routeKey) ?? [];
        current.push(assignment);
        result.set(routeKey, current);
    }
    return result;
}

function validateDestination(assignment: FinishedRecipeShoppingPropertyAssignment): void {
    if (assignment.destination.kind === 'shared') {
        if (assignment.destination.reason !== 'destination-property-not-established') {
            throw new Error('Shopping shared attribution reason is invalid');
        }
        return;
    }
    requireNonBlank(assignment.destination.propertyId, 'Shopping attribution destination property ID');
    requireNonNegativeFinite(
        assignment.destination.arrivalMinute,
        'Shopping attribution property arrival minute'
    );
    if (
        assignment.access === 'physical' &&
        assignment.destination.evidence !== 'caller-supplied-physical-property-arrival'
    ) {
        throw new Error('Physical shopping attribution has incompatible destination evidence');
    }
    if (
        assignment.access === 'remote-delivery' &&
        assignment.destination.evidence !== 'caller-supplied-remote-delivery-destination'
    ) {
        throw new Error('Remote shopping attribution has incompatible destination evidence');
    }
}

function validatePropertyDemand(
    requirements: ReadonlyMap<string, FinishedRecipePurchaseRequirement & { readonly requestedQuantity: number }>,
    allocations: readonly FinishedRecipeShoppingPropertyAllocation[],
    gaps: FinishedRecipeShoppingPropertyAttributionGap[]
): void {
    const attributed = new Map<string, number>();
    for (const allocation of allocations) {
        const key = propertyItemKey(allocation.propertyId, allocation.itemId);
        const quantity = safeAdd(
            attributed.get(key) ?? 0,
            allocation.quantity,
            'Shopping property attributed quantity'
        );
        const requirement = requirements.get(key);
        if (requirement === undefined || quantity > requirement.requestedQuantity) {
            throw new Error(`Shopping attribution exceeds property demand ${JSON.stringify(key)}`);
        }
        attributed.set(key, quantity);
    }
    for (const [key, requirement] of requirements) {
        const missing = requirement.requestedQuantity - (attributed.get(key) ?? 0);
        if (missing === 0) continue;
        gaps.push({
            code: 'property-demand-attribution-missing',
            shopCode: null,
            itemId: requirement.itemId,
            access: null,
            propertyId: requirement.propertyId,
            quantity: missing,
        });
    }
}

function propertyAllocation(
    selected: FinishedRecipeShoppingAllocation,
    assignment: PropertyAssignment,
    sourceCompletionMinute: number
): FinishedRecipeShoppingPropertyAllocation {
    return {
        ...allocationSlice(selected, assignment.quantity),
        propertyId: assignment.destination.propertyId,
        sourceCompletionMinute,
        arrivalMinute: assignment.destination.arrivalMinute,
        destinationEvidence: assignment.destination.evidence,
    };
}

function sharedAllocation(
    selected: FinishedRecipeShoppingAllocation,
    quantity: number,
    sourceCompletionMinute: number,
    reason: FinishedRecipeShoppingSharedAllocation['reason']
): FinishedRecipeShoppingSharedAllocation {
    return { ...allocationSlice(selected, quantity), sourceCompletionMinute, reason };
}

function allocationSlice(
    selected: FinishedRecipeShoppingAllocation,
    quantity: number
): FinishedRecipeShoppingAllocation {
    return {
        shopCode: selected.shopCode,
        itemId: selected.itemId,
        access: selected.access,
        quantity,
        unitPrice: selected.unitPrice,
        totalPrice: finiteMultiply(
            selected.unitPrice,
            quantity,
            'Shopping attributed allocation cost'
        ),
    };
}

function attributionGap(
    code: FinishedRecipeShoppingPropertyAttributionGap['code'],
    allocation: FinishedRecipeShoppingAllocation,
    quantity: number
): FinishedRecipeShoppingPropertyAttributionGap {
    return {
        code,
        shopCode: allocation.shopCode,
        itemId: allocation.itemId,
        access: allocation.access,
        propertyId: null,
        quantity,
    };
}

function compareAssignments(
    left: FinishedRecipeShoppingPropertyAssignment,
    right: FinishedRecipeShoppingPropertyAssignment
): number {
    return finishedRecipeShoppingAllocationKey(left).localeCompare(
        finishedRecipeShoppingAllocationKey(right)
    ) || destinationIdentity(left).localeCompare(destinationIdentity(right));
}

function cloneAssignment(
    assignment: FinishedRecipeShoppingPropertyAssignment
): FinishedRecipeShoppingPropertyAssignment {
    if (assignment.access === 'physical') {
        return assignment.destination.kind === 'property'
            ? { ...assignment, destination: { ...assignment.destination } }
            : { ...assignment, destination: { ...assignment.destination } };
    }
    return assignment.destination.kind === 'property'
        ? { ...assignment, destination: { ...assignment.destination } }
        : { ...assignment, destination: { ...assignment.destination } };
}

function hasPropertyDestination(
    assignment: FinishedRecipeShoppingPropertyAssignment
): assignment is PropertyAssignment {
    return assignment.destination.kind === 'property';
}

function destinationIdentity(assignment: FinishedRecipeShoppingPropertyAssignment): string {
    return assignment.destination.kind === 'property'
        ? `property:${assignment.destination.propertyId}`
        : 'shared';
}

function comparePropertyAllocations(
    left: FinishedRecipeShoppingPropertyAllocation,
    right: FinishedRecipeShoppingPropertyAllocation
): number {
    return left.propertyId.localeCompare(right.propertyId) ||
        left.itemId.localeCompare(right.itemId) ||
        left.shopCode.localeCompare(right.shopCode) ||
        left.access.localeCompare(right.access);
}

function compareSharedAllocations(
    left: FinishedRecipeShoppingSharedAllocation,
    right: FinishedRecipeShoppingSharedAllocation
): number {
    return left.itemId.localeCompare(right.itemId) ||
        left.shopCode.localeCompare(right.shopCode) ||
        left.access.localeCompare(right.access) ||
        left.reason.localeCompare(right.reason);
}

function compareGaps(
    left: FinishedRecipeShoppingPropertyAttributionGap,
    right: FinishedRecipeShoppingPropertyAttributionGap
): number {
    return left.code.localeCompare(right.code) ||
        left.itemId.localeCompare(right.itemId) ||
        (left.propertyId ?? '').localeCompare(right.propertyId ?? '') ||
        (left.shopCode ?? '').localeCompare(right.shopCode ?? '') ||
        (left.access ?? '').localeCompare(right.access ?? '');
}

function propertyItemKey(propertyId: string, itemId: string): string {
    return `${propertyId}\u0000${itemId}`;
}

function assertSameQuantities(
    expected: ReadonlyMap<string, number>,
    actual: ReadonlyMap<string, number>,
    label: string
): void {
    const keys = new Set([...expected.keys(), ...actual.keys()]);
    for (const key of keys) {
        if ((expected.get(key) ?? 0) !== (actual.get(key) ?? 0)) {
            throw new Error(`${label} does not match for ${JSON.stringify(key)}`);
        }
    }
}

function validateCoverage(value: string): void {
    if (value !== 'complete' && value !== 'partial') {
        throw new Error('Shopping property attribution coverage must be complete or partial');
    }
}

function requireNonBlank(value: string, label: string): void {
    if (value.trim().length === 0) throw new Error(`${label} must not be blank`);
}

function requirePositiveSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${label} must be a positive safe integer`);
    }
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${label} must be a non-negative safe integer`);
    }
}

function requireNonNegativeFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${label} must be non-negative and finite`);
    }
}

function safeAdd(left: number, right: number, label: string): number {
    const result = left + right;
    if (!Number.isSafeInteger(result)) throw new Error(`${label} must be a safe integer`);
    return result;
}

function safeSum(values: readonly number[], label: string): number {
    let result = 0;
    for (const value of values) result = safeAdd(result, value, label);
    return result;
}

function finiteMultiply(left: number, right: number, label: string): number {
    const result = left * right;
    if (!Number.isFinite(result)) throw new Error(`${label} must be finite`);
    return result;
}
