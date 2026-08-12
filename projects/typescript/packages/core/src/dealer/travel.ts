import type { Vector3 } from '#core/data/common';
import { TradeCatalogSchema, type DealerMechanics, type TradeCatalog } from '#core/data/trade';
import { WorldMapSchema, type DeliveryLocationCandidate, type WorldMap } from '#core/data/world';
import { logicalDealerProfiles, type LogicalDealerProfile } from '#core/dealer/assignment';

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

export interface DealerTravelAvailability {
    readonly personId: string;
    readonly origin?: Vector3;
}

export interface DealerTravelFeasibilityFacts {
    readonly regionId: string;
    readonly deliveryWindowStartTime: number;
    readonly minutesUntilDeliveryWindowStart?: number;
    readonly dealers: readonly DealerTravelAvailability[];
}

export type DealerTravelFeasibilityStatus = 'feasible' | 'infeasible' | 'unknown';

export type DealerTravelFeasibilityReason =
    | { readonly code: 'missing-delivery-locations'; readonly regionId: string }
    | { readonly code: 'missing-dealer-origin' }
    | { readonly code: 'missing-minutes-until-delivery-window-start' }
    | {
        readonly code: 'insufficient-travel-time';
        readonly requiredTravelMinutes: number;
        readonly availableTravelMinutes: number;
    };

export interface WorstCaseDealerTravelEstimate extends DealerTravelEstimate {
    readonly deliveryLocationId: string;
}

export interface DealerTravelFeasibilityDecision {
    readonly dealerId: string;
    readonly status: DealerTravelFeasibilityStatus;
    readonly deliveryLocationCount: number;
    readonly minutesUntilDeliveryWindowStart: number | null;
    readonly availableTravelMinutes: number | null;
    readonly worstCase: WorstCaseDealerTravelEstimate | null;
    readonly reasons: readonly DealerTravelFeasibilityReason[];
}

export interface DealerTravelFeasibility {
    readonly policy: 'worst-case-regional-delivery-location';
    readonly regionId: string;
    readonly decisions: readonly DealerTravelFeasibilityDecision[];
    readonly eligibleDealerIds: readonly string[];
}

export class DealerTravelFeasibilityResolver {
    readonly #mechanics: DealerMechanics;
    readonly #dealers: ReadonlyMap<string, LogicalDealerProfile>;
    readonly #regions: ReadonlyMap<string, readonly DeliveryLocationCandidate[]>;

    constructor(tradeInput: TradeCatalog, worldInput: WorldMap) {
        const trade = TradeCatalogSchema.assert(tradeInput);
        const world = WorldMapSchema.assert(worldInput);
        this.#mechanics = trade.dealerMechanics;
        validateDealerTravelMechanics(this.#mechanics);
        this.#dealers = uniqueIndex(
            logicalDealerProfiles(trade),
            ({ personId }) => personId,
            'dealer'
        );
        this.#regions = regionLocationIndex(world);
    }

    resolve(facts: DealerTravelFeasibilityFacts): DealerTravelFeasibility {
        requireId(facts.regionId, 'Delivery region');
        requireGameTime(facts.deliveryWindowStartTime, 'Delivery window start time');
        const locations = this.#regions.get(facts.regionId);
        if (locations === undefined) {
            throw new Error(`Unknown delivery region ${JSON.stringify(facts.regionId)}`);
        }
        const minutesUntilWindow = facts.minutesUntilDeliveryWindowStart;
        if (minutesUntilWindow !== undefined && !Number.isSafeInteger(minutesUntilWindow)) {
            throw new RangeError('Minutes until delivery window start must be a safe integer');
        }
        const availableTravelMinutes = minutesUntilWindow === undefined
            ? null
            : safeAdd(
                  minutesUntilWindow,
                  this.#mechanics.dealArrivalDelay,
                  'Available dealer travel time'
              );
        const requestedDealers = uniqueIndex(facts.dealers, ({ personId }) => personId, 'dealer');
        const decisions = [...requestedDealers.values()]
            .map((dealer) => this.#decision(
                dealer,
                locations,
                facts.regionId,
                facts.deliveryWindowStartTime,
                minutesUntilWindow ?? null,
                availableTravelMinutes
            ))
            .sort((left, right) => left.dealerId.localeCompare(right.dealerId));
        return {
            policy: 'worst-case-regional-delivery-location',
            regionId: facts.regionId,
            decisions,
            eligibleDealerIds: decisions
                .filter(({ status }) => status === 'feasible')
                .map(({ dealerId }) => dealerId),
        };
    }

    #decision(
        dealer: DealerTravelAvailability,
        locations: readonly DeliveryLocationCandidate[],
        regionId: string,
        deliveryWindowStartTime: number,
        minutesUntilWindow: number | null,
        availableTravelMinutes: number | null
    ): DealerTravelFeasibilityDecision {
        const profile = this.#dealers.get(dealer.personId);
        if (profile === undefined) {
            throw new Error(`Unknown dealer ${JSON.stringify(dealer.personId)}`);
        }
        if (dealer.origin !== undefined) requireVector(dealer.origin, 'Dealer travel origin');
        const reasons: DealerTravelFeasibilityReason[] = [];
        if (locations.length === 0) reasons.push({ code: 'missing-delivery-locations', regionId });
        if (dealer.origin === undefined) reasons.push({ code: 'missing-dealer-origin' });
        if (availableTravelMinutes === null) {
            reasons.push({ code: 'missing-minutes-until-delivery-window-start' });
        }
        const worstCase = dealer.origin === undefined || locations.length === 0
            ? null
            : worstCaseEstimate(
                  this.#mechanics,
                  dealer.origin,
                  profile.walkSpeed,
                  deliveryWindowStartTime,
                  locations
              );
        if (worstCase !== null && availableTravelMinutes !== null &&
            worstCase.travelMinutes > availableTravelMinutes) {
            reasons.push({
                code: 'insufficient-travel-time',
                requiredTravelMinutes: worstCase.travelMinutes,
                availableTravelMinutes,
            });
        }
        const status: DealerTravelFeasibilityStatus = reasons.some(
            ({ code }) => code === 'insufficient-travel-time'
        ) ? 'infeasible' : reasons.length === 0 ? 'feasible' : 'unknown';
        return {
            dealerId: dealer.personId,
            status,
            deliveryLocationCount: locations.length,
            minutesUntilDeliveryWindowStart: minutesUntilWindow,
            availableTravelMinutes,
            worstCase,
            reasons,
        };
    }
}

export function estimateDealerTravel(
    mechanics: Pick<DealerMechanics, 'dealArrivalDelay' | 'travelTime'>,
    input: DealerTravelInput
): DealerTravelEstimate {
    validateDealerTravelMechanics(mechanics);
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

function validateDealerTravelMechanics(
    mechanics: Pick<DealerMechanics, 'dealArrivalDelay' | 'travelTime'>
): void {
    requirePositiveSafeInteger(mechanics.travelTime.minimum, 'Minimum dealer travel time');
    requirePositiveSafeInteger(mechanics.travelTime.maximum, 'Maximum dealer travel time');
    if (mechanics.travelTime.minimum > mechanics.travelTime.maximum) {
        throw new RangeError('Minimum dealer travel time cannot exceed maximum dealer travel time');
    }
    requireNonNegativeSafeInteger(mechanics.dealArrivalDelay, 'Dealer arrival delay');
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
    const reducedMinutes = ((minutes % 1_440) + 1_440) % 1_440;
    const wrapped = (totalMinutes + reducedMinutes) % 1_440;
    return Math.floor(wrapped / 60) * 100 + wrapped % 60;
}

function worstCaseEstimate(
    mechanics: Pick<DealerMechanics, 'dealArrivalDelay' | 'travelTime'>,
    origin: Vector3,
    walkSpeed: number,
    deliveryWindowStartTime: number,
    locations: readonly DeliveryLocationCandidate[]
): WorstCaseDealerTravelEstimate {
    return locations.map((location): WorstCaseDealerTravelEstimate => ({
        deliveryLocationId: location.id,
        ...estimateDealerTravel(mechanics, {
            origin,
            destination: location.position,
            walkSpeed,
            deliveryWindowStartTime,
        }),
    })).sort(compareWorstCase)[0]!;
}

function compareWorstCase(
    left: WorstCaseDealerTravelEstimate,
    right: WorstCaseDealerTravelEstimate
): number {
    return right.travelMinutes - left.travelMinutes ||
        right.travelMinutesBeforeClamp - left.travelMinutesBeforeClamp ||
        right.straightLineDistance - left.straightLineDistance ||
        left.deliveryLocationId.localeCompare(right.deliveryLocationId);
}

function uniqueIndex<T>(
    values: readonly T[],
    key: (value: T) => string,
    label: string
): ReadonlyMap<string, T> {
    const result = new Map<string, T>();
    for (const value of values) {
        const id = key(value);
        requireId(id, label);
        if (result.has(id)) throw new Error(`Duplicate ${label} ${JSON.stringify(id)}`);
        result.set(id, value);
    }
    return result;
}

function regionLocationIndex(
    world: WorldMap
): ReadonlyMap<string, readonly DeliveryLocationCandidate[]> {
    const regions = new Map<string, readonly DeliveryLocationCandidate[]>();
    const deliveryLocations = new Map<string, DeliveryLocationCandidate>();
    for (const region of world.regions) {
        requireId(region.id, 'Region');
        if (regions.has(region.id)) {
            throw new Error(`Duplicate region ${JSON.stringify(region.id)}`);
        }
        const locations = uniqueIndex(
            region.deliveryLocations,
            ({ id }) => id,
            `delivery location in region ${JSON.stringify(region.id)}`
        );
        for (const location of locations.values()) {
            const existing = deliveryLocations.get(location.id);
            if (existing !== undefined && !samePosition(existing.position, location.position)) {
                throw new Error(
                    `Delivery location ${JSON.stringify(location.id)} has inconsistent positions across regions`
                );
            }
            deliveryLocations.set(location.id, location);
        }
        regions.set(region.id, [...locations.values()]);
    }
    return regions;
}

function samePosition(left: Vector3, right: Vector3): boolean {
    return left.x === right.x && left.y === right.y && left.z === right.z;
}

function requireId(value: string, label: string): void {
    if (value.trim().length === 0) throw new Error(`${label} ID must not be blank`);
}

function safeAdd(left: number, right: number, label: string): number {
    const result = left + right;
    if (!Number.isSafeInteger(result)) throw new RangeError(`${label} must be a safe integer`);
    return result;
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
