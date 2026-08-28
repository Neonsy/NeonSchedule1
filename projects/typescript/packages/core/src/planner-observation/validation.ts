import {
    PlannerObservationRequestSchema,
    PlannerObservationResponseSchema,
    type PlannerObservationRequest,
    type PlannerObservationResponse,
} from '#core/data/planner-observation';
import {
    validatePlannerInventorySnapshot,
    validatePlannerStateSnapshot,
} from '#core/planner-profile/validation';

const sha256Pattern = /^[a-f0-9]{64}$/u;
const ownerKindsByScope = {
    player: 'player',
    dealers: 'dealer',
    suppliers: 'supplier',
    properties: 'property',
    placements: 'placement',
    employees: 'employee',
    vehicles: 'vehicle',
} as const;

export function validatePlannerObservationRequest(input: unknown): PlannerObservationRequest {
    const request = PlannerObservationRequestSchema.assert(input);
    requireNonBlank(request.requestId, 'Planner observation request ID');
    requireNonBlank(request.expectedGameVersion, 'Planner observation game version');
    return request;
}

export function validatePlannerObservationResponse(input: unknown): PlannerObservationResponse {
    const response = PlannerObservationResponseSchema.assert(input);
    requireNonBlank(response.exporterVersion, 'Planner observation exporter version');
    validateTimestamp(response.observedAtUtc, 'Planner observation timestamp');
    requireNonBlank(response.gameVersion, 'Planner observation game version');
    requireNonBlank(response.requestId, 'Planner observation request ID');
    if (!sha256Pattern.test(response.requestSha256)) {
        throw new TypeError('Planner observation request identity must be a lowercase SHA-256');
    }
    validatePlannerStateSnapshot(response.state, 'Planner observation state');

    let previousOwner: string | null = null;
    for (const [index, inventory] of response.inventories.entries()) {
        validatePlannerInventorySnapshot(inventory, `Planner observation inventory ${index}`);
        const owner = `${inventory.owner.kind}\0${inventory.owner.id}`;
        if (previousOwner !== null && previousOwner >= owner) {
            throw new Error('Planner observation inventories must be sorted and unique');
        }
        previousOwner = owner;
    }

    for (const [scope, ownerKind] of Object.entries(ownerKindsByScope)) {
        if (response.inventoryScopes[scope as keyof typeof ownerKindsByScope] !== 'unknown') {
            continue;
        }
        if (response.inventories.some(({ owner }) => owner.kind === ownerKind)) {
            throw new Error(`Unknown planner observation inventory scope ${scope} has snapshots`);
        }
    }
    const playerInventories = response.inventories.filter(
        ({ owner }) => owner.kind === 'player'
    );
    if (response.inventoryScopes.player === 'complete' &&
        (playerInventories.length !== 1 || playerInventories[0]!.owner.id !== 'local')) {
        throw new Error('Complete player inventory scope must contain only the local player');
    }
    return response;
}

export function comparePlannerObservation(
    request: PlannerObservationRequest,
    response: PlannerObservationResponse,
    requestSha256: string
): PlannerObservationResponse {
    if (!sha256Pattern.test(requestSha256)) {
        throw new TypeError('Planner observation request identity must be a lowercase SHA-256');
    }
    if (response.requestSha256 !== requestSha256) {
        throw new Error('Planner observation response does not match the staged request');
    }
    if (response.requestId !== request.requestId) {
        throw new Error('Planner observation response has the wrong request ID');
    }
    if (response.gameVersion !== request.expectedGameVersion) {
        throw new Error(
            `Planner observation expected game ${request.expectedGameVersion}, ` +
            `received ${response.gameVersion}`
        );
    }
    return response;
}

function requireNonBlank(value: string, label: string): void {
    if (value.trim().length === 0) throw new TypeError(`${label} must not be blank`);
}

function validateTimestamp(value: string, label: string): void {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
        throw new TypeError(`${label} must be a canonical UTC timestamp`);
    }
}
