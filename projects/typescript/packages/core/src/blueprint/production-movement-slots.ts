import type { BlueprintProductionTransferCapacity } from '#core/blueprint/production-logistics-types';

export interface BlueprintProductionDestinationSlotRequest {
    readonly consumerStepIndex: number;
    readonly destinationPlacementId: string;
    readonly itemId: string;
}

interface DestinationSlotReservation {
    readonly itemId: string;
    readonly capacity: number;
    usedQuantity: number;
}

export class BlueprintProductionDestinationSlotReservations {
    readonly #reservationsByDestination = new Map<
        string,
        Map<number, DestinationSlotReservation>
    >();

    availableCapacity(
        request: BlueprintProductionDestinationSlotRequest,
        capacities: readonly BlueprintProductionTransferCapacity[]
    ): number | null {
        const evidence = consistentDestinationSlotEvidence(capacities);
        if (evidence === null) return null;
        const reservations = this.#destinationReservations(request);
        return evidence.compatibleInputSlotIndexes.reduce((sum, slotIndex) => {
            const reservation = reservations.get(slotIndex);
            const available = reservation === undefined
                ? evidence.itemStackLimit
                : reservation.itemId === request.itemId
                    ? subtractQuantity(reservation.capacity, reservation.usedQuantity)
                    : 0;
            return addFinite(sum, available, 'Movement available destination capacity');
        }, 0);
    }

    reserve(
        request: BlueprintProductionDestinationSlotRequest,
        capacity: BlueprintProductionTransferCapacity,
        quantity: number
    ): void {
        const compatibleInputSlotIndexes = capacity.destinationCompatibleInputSlotIndexes;
        if (compatibleInputSlotIndexes === null) {
            throw new Error('Movement allocation has no compatible destination slots');
        }
        const reservations = this.#destinationReservations(request);
        const slotIndexes = [...compatibleInputSlotIndexes]
            .filter((slotIndex) => {
                const reservation = reservations.get(slotIndex);
                return reservation === undefined || reservation.itemId === request.itemId;
            })
            .sort((left, right) => {
                const leftAssigned = reservations.has(left) ? 0 : 1;
                const rightAssigned = reservations.has(right) ? 0 : 1;
                return leftAssigned - rightAssigned || left - right;
            });
        let remaining = quantity;
        for (const slotIndex of slotIndexes) {
            if (isZero(remaining)) break;
            const existing = reservations.get(slotIndex);
            if (existing !== undefined && existing.capacity !== capacity.itemStackLimit) {
                throw new Error('Movement destination slot has inconsistent item capacity');
            }
            const usedQuantity = existing?.usedQuantity ?? 0;
            const available = subtractQuantity(capacity.itemStackLimit, usedQuantity);
            const reservedQuantity = Math.min(remaining, available);
            if (isZero(reservedQuantity)) continue;
            reservations.set(slotIndex, {
                itemId: request.itemId,
                capacity: capacity.itemStackLimit,
                usedQuantity: addFinite(
                    usedQuantity,
                    reservedQuantity,
                    'Movement destination slot reservation'
                ),
            });
            remaining = subtractQuantity(remaining, reservedQuantity);
        }
        if (!isZero(remaining)) {
            throw new Error('Movement allocation exceeds compatible destination slot capacity');
        }
    }

    #destinationReservations(
        request: BlueprintProductionDestinationSlotRequest
    ): Map<number, DestinationSlotReservation> {
        const key = JSON.stringify([
            request.consumerStepIndex,
            request.destinationPlacementId,
        ]);
        let reservations = this.#reservationsByDestination.get(key);
        if (reservations === undefined) {
            reservations = new Map();
            this.#reservationsByDestination.set(key, reservations);
        }
        return reservations;
    }
}

function consistentDestinationSlotEvidence(
    capacities: readonly BlueprintProductionTransferCapacity[]
): {
    readonly itemStackLimit: number;
    readonly compatibleInputSlotIndexes: readonly number[];
} | null {
    const first = capacities[0];
    if (first === undefined) return null;
    for (const capacity of capacities.slice(1)) {
        requireSameNumber(
            capacity.itemStackLimit,
            first.itemStackLimit,
            'Movement destination item stack limit'
        );
        if (!sameOptionalIndexes(
            capacity.destinationCompatibleInputSlotIndexes,
            first.destinationCompatibleInputSlotIndexes
        )) {
            throw new Error('Movement candidates disagree on compatible destination slots');
        }
        if (capacity.destinationEmptyCapacity === null ||
            first.destinationEmptyCapacity === null) {
            if (capacity.destinationEmptyCapacity !== first.destinationEmptyCapacity) {
                throw new Error('Movement candidates disagree on destination capacity evidence');
            }
        } else {
            requireSameNumber(
                capacity.destinationEmptyCapacity,
                first.destinationEmptyCapacity,
                'Movement destination capacity'
            );
        }
    }
    const compatibleInputSlotIndexes = first.destinationCompatibleInputSlotIndexes;
    if (compatibleInputSlotIndexes === null) return null;
    if (compatibleInputSlotIndexes.some((slotIndex) =>
        !Number.isSafeInteger(slotIndex) || slotIndex < 0
    )) {
        throw new RangeError('Movement destination slot indexes must be non-negative safe integers');
    }
    if (new Set(compatibleInputSlotIndexes).size !== compatibleInputSlotIndexes.length) {
        throw new Error('Movement destination contains duplicate compatible slot indexes');
    }
    if (first.destinationEmptyCapacity === null) {
        throw new Error('Movement destination slots have no calculated capacity');
    }
    requireSameNumber(
        first.destinationEmptyCapacity,
        multiplyFinite(
            compatibleInputSlotIndexes.length,
            first.itemStackLimit,
            'Movement destination capacity from compatible slots'
        ),
        'Movement destination capacity from compatible slots'
    );
    return { itemStackLimit: first.itemStackLimit, compatibleInputSlotIndexes };
}

function sameOptionalIndexes(
    left: readonly number[] | null,
    right: readonly number[] | null
): boolean {
    return left === null || right === null
        ? left === right
        : left.length === right.length && left.every((value, index) => value === right[index]);
}

function subtractQuantity(left: number, right: number): number {
    const result = left - right;
    const tolerance = numberTolerance(left, right);
    if (Math.abs(result) <= tolerance) return 0;
    if (!Number.isFinite(result) || result < 0) {
        throw new RangeError('Movement quantity subtraction produced an invalid result');
    }
    return result;
}

function isZero(value: number): boolean {
    return Math.abs(value) <= numberTolerance(value, 0);
}

function requireSameNumber(actual: number, expected: number, label: string): void {
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > numberTolerance(actual, expected)) {
        throw new Error(`${label} is inconsistent`);
    }
}

function numberTolerance(left: number, right: number): number {
    return 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));
}

function multiplyFinite(left: number, right: number, label: string): number {
    const result = left * right;
    if (!Number.isFinite(result)) throw new RangeError(`${label} must be finite`);
    return result;
}

function addFinite(left: number, right: number, label: string): number {
    const result = left + right;
    if (!Number.isFinite(result)) throw new RangeError(`${label} must be finite`);
    return result;
}
