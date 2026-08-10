import type { Vector3 } from '#core/data/common';
import type { DealerMechanics } from '#core/data/trade';

export interface DealerTravelInput {
    readonly origin: Vector3;
    readonly destination: Vector3;
    readonly walkSpeed: number;
    readonly deliveryWindowStartTime: number;
}

export interface DealerTravelEstimate {
    readonly method: 'native-straight-line-walk-speed';
    readonly straightLineDistance: number;
    readonly travelMinutesBeforeClamp: number;
    readonly travelMinutes: number;
    readonly targetArrivalTime: number;
    readonly departureTime: number;
}

export function estimateDealerTravel(
    mechanics: Pick<DealerMechanics, 'dealArrivalDelay' | 'travelTime'>,
    input: DealerTravelInput
): DealerTravelEstimate {
    requirePositiveSafeInteger(mechanics.travelTime.minimum, 'Minimum dealer travel time');
    requirePositiveSafeInteger(mechanics.travelTime.maximum, 'Maximum dealer travel time');
    if (mechanics.travelTime.minimum > mechanics.travelTime.maximum) {
        throw new RangeError('Minimum dealer travel time cannot exceed maximum dealer travel time');
    }
    requireNonNegativeSafeInteger(mechanics.dealArrivalDelay, 'Dealer arrival delay');
    requireVector(input.origin, 'Dealer travel origin');
    requireVector(input.destination, 'Dealer travel destination');
    requirePositiveFinite(input.walkSpeed, 'Dealer walk speed');
    requireGameTime(input.deliveryWindowStartTime, 'Delivery window start time');

    const straightLineDistance = nativeDistance(input.origin, input.destination);
    const travelMinutesBeforeClamp = Math.ceil(
        Math.fround(straightLineDistance / Math.fround(input.walkSpeed))
    );
    const travelMinutes = clamp(
        travelMinutesBeforeClamp,
        mechanics.travelTime.minimum,
        mechanics.travelTime.maximum
    );
    const targetArrivalTime = addGameMinutes(
        input.deliveryWindowStartTime,
        mechanics.dealArrivalDelay
    );
    return {
        method: 'native-straight-line-walk-speed',
        straightLineDistance,
        travelMinutesBeforeClamp,
        travelMinutes,
        targetArrivalTime,
        departureTime: addGameMinutes(targetArrivalTime, -travelMinutes),
    };
}

function nativeDistance(left: Vector3, right: Vector3): number {
    const x = Math.fround(Math.fround(left.x) - Math.fround(right.x));
    const y = Math.fround(Math.fround(left.y) - Math.fround(right.y));
    const z = Math.fround(Math.fround(left.z) - Math.fround(right.z));
    const xSquared = Math.fround(x * x);
    const ySquared = Math.fround(y * y);
    const zSquared = Math.fround(z * z);
    const squaredDistance = Math.fround(Math.fround(ySquared + xSquared) + zSquared);
    return Math.fround(Math.sqrt(squaredDistance));
}

function addGameMinutes(time: number, minutes: number): number {
    const totalMinutes = Math.floor(time / 100) * 60 + time % 100;
    const wrapped = ((totalMinutes + minutes) % 1_440 + 1_440) % 1_440;
    return Math.floor(wrapped / 60) * 100 + wrapped % 60;
}

function clamp(value: number, minimum: number, maximum: number): number {
    if (value < minimum) return minimum;
    if (value > maximum) return maximum;
    return value;
}

function requireVector(value: Vector3, label: string): void {
    if (![value.x, value.y, value.z].every((coordinate) =>
        Number.isFinite(coordinate) && Number.isFinite(Math.fround(coordinate)))) {
        throw new RangeError(`${label} must contain finite coordinates`);
    }
}

function requireGameTime(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 2_359 || value % 100 >= 60) {
        throw new RangeError(`${label} must be a valid HHMM game time`);
    }
}

function requirePositiveFinite(value: number, label: string): void {
    const singlePrecision = Math.fround(value);
    if (!Number.isFinite(value) || !Number.isFinite(singlePrecision) || singlePrecision <= 0) {
        throw new RangeError(`${label} must be positive and finite`);
    }
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${label} must be a non-negative safe integer`);
    }
}

function requirePositiveSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new RangeError(`${label} must be a positive safe integer`);
    }
}
