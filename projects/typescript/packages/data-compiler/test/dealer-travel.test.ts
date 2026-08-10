import { describe, expect, it } from 'vitest';

import { estimateDealerTravel, type DealerMechanics } from '@neonschedule1/core';

describe('dealer travel', () => {
    it('reproduces native straight-line, walk-speed, rounding, and departure behavior', () => {
        expect(estimateDealerTravel(mechanics(), {
            origin: { x: 0, y: 0, z: 0 },
            destination: { x: 90, y: 0, z: 120 },
            walkSpeed: 4,
            deliveryWindowStartTime: 100,
        })).toEqual({
            method: 'native-straight-line-walk-speed',
            straightLineDistance: 150,
            travelMinutesBeforeClamp: 38,
            travelMinutes: 38,
            targetArrivalTime: 130,
            departureTime: 52,
        });
    });

    it('applies the normalized minimum and maximum travel bounds', () => {
        expect(estimateDealerTravel(mechanics(), {
            origin: { x: 1, y: 2, z: 3 },
            destination: { x: 1, y: 2, z: 3 },
            walkSpeed: 4,
            deliveryWindowStartTime: 900,
        })).toMatchObject({
            straightLineDistance: 0,
            travelMinutesBeforeClamp: 0,
            travelMinutes: 15,
            targetArrivalTime: 930,
            departureTime: 915,
        });

        expect(estimateDealerTravel(mechanics(), {
            origin: { x: 0, y: 0, z: 0 },
            destination: { x: 2_000, y: 0, z: 0 },
            walkSpeed: 2,
            deliveryWindowStartTime: 900,
        })).toMatchObject({
            travelMinutesBeforeClamp: 1_000,
            travelMinutes: 360,
            targetArrivalTime: 930,
            departureTime: 330,
        });
    });

    it('wraps target arrival and departure across midnight', () => {
        expect(estimateDealerTravel(mechanics(), {
            origin: { x: 0, y: 0, z: 0 },
            destination: { x: 100, y: 0, z: 0 },
            walkSpeed: 2,
            deliveryWindowStartTime: 2350,
        })).toMatchObject({
            travelMinutes: 50,
            targetArrivalTime: 20,
            departureTime: 2330,
        });
    });

    it('preserves single-precision distance arithmetic before native ceiling', () => {
        const result = estimateDealerTravel(mechanics(), {
            origin: { x: 100_000_000, y: 0, z: 0 },
            destination: { x: 99_999_999, y: 0, z: 0 },
            walkSpeed: 1,
            deliveryWindowStartTime: 1200,
        });

        expect(result).toMatchObject({
            straightLineDistance: 0,
            travelMinutesBeforeClamp: 0,
            travelMinutes: 15,
        });
    });

    it('rejects malformed mechanics and caller-owned live inputs', () => {
        expect(() => estimateDealerTravel(mechanics(), {
            origin: { x: 0, y: 0, z: 0 },
            destination: { x: Number.NaN, y: 0, z: 0 },
            walkSpeed: 1,
            deliveryWindowStartTime: 1200,
        })).toThrow('Dealer travel destination must contain finite coordinates');
        expect(() => estimateDealerTravel(mechanics(), {
            origin: { x: 0, y: 0, z: 0 },
            destination: { x: 1, y: 0, z: 0 },
            walkSpeed: 0,
            deliveryWindowStartTime: 1200,
        })).toThrow('Dealer walk speed must be positive and finite');
        expect(() => estimateDealerTravel(mechanics(), {
            origin: { x: 0, y: 0, z: 0 },
            destination: { x: 1, y: 0, z: 0 },
            walkSpeed: 1,
            deliveryWindowStartTime: 1260,
        })).toThrow('Delivery window start time must be a valid HHMM game time');
        expect(() => estimateDealerTravel({
            ...mechanics(),
            travelTime: { minimum: 361, maximum: 360 },
        }, {
            origin: { x: 0, y: 0, z: 0 },
            destination: { x: 1, y: 0, z: 0 },
            walkSpeed: 1,
            deliveryWindowStartTime: 1200,
        })).toThrow('Minimum dealer travel time cannot exceed maximum dealer travel time');
    });
});

function mechanics(): DealerMechanics {
    return {
        maximumCustomers: 10,
        dealArrivalDelay: 30,
        travelTime: { minimum: 15, maximum: 360 },
        overflowSlotCount: 10,
        cashReminderThreshold: 500,
        relationshipChangePerDeal: 0.05,
    };
}
