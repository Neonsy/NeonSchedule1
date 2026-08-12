import { describe, expect, it } from 'vitest';

import {
    DealerTravelFeasibilityResolver,
    estimateDealerTravel,
    type DealerMechanics,
    type TradeCatalog,
    type WorldMap,
} from '@neonschedule1/core';

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

    it('uses every regional delivery candidate and admits only worst-case-feasible dealers', () => {
        const result = new DealerTravelFeasibilityResolver(tradeCatalog(), worldMap()).resolve({
            regionId: 'Test',
            deliveryWindowStartTime: 1200,
            minutesUntilDeliveryWindowStart: 10,
            dealers: [
                { personId: 'west', origin: { x: 0, y: 0, z: 0 } },
                { personId: 'center', origin: { x: 100, y: 0, z: 0 } },
            ],
        });

        expect(result).toMatchObject({
            policy: 'worst-case-regional-delivery-location',
            regionId: 'Test',
            eligibleDealerIds: ['center'],
            decisions: [
                {
                    dealerId: 'center',
                    status: 'feasible',
                    deliveryLocationCount: 2,
                    availableTravelMinutes: 40,
                    worstCase: { deliveryLocationId: 'east', travelMinutes: 25 },
                },
                {
                    dealerId: 'west',
                    status: 'infeasible',
                    worstCase: { deliveryLocationId: 'east', travelMinutes: 50 },
                    reasons: [{
                        code: 'insufficient-travel-time',
                        requiredTravelMinutes: 50,
                        availableTravelMinutes: 40,
                    }],
                },
            ],
        });
    });

    it('reports unknown feasibility when caller-owned origin or timing evidence is absent', () => {
        const resolver = new DealerTravelFeasibilityResolver(tradeCatalog(), worldMap());

        expect(resolver.resolve({
            regionId: 'Test',
            deliveryWindowStartTime: 1200,
            dealers: [{ personId: 'west' }],
        }).decisions[0]).toMatchObject({
            status: 'unknown',
            worstCase: null,
            reasons: [
                { code: 'missing-dealer-origin' },
                { code: 'missing-minutes-until-delivery-window-start' },
            ],
        });
    });

    it('treats the exact worst-case travel limit as feasible and one minute less as infeasible', () => {
        const resolver = new DealerTravelFeasibilityResolver(tradeCatalog(), worldMap());
        const facts = {
            regionId: 'Test',
            deliveryWindowStartTime: 1200,
            dealers: [{ personId: 'center', origin: { x: 100, y: 0, z: 0 } }],
        } as const;

        expect(resolver.resolve({
            ...facts,
            minutesUntilDeliveryWindowStart: -5,
        }).decisions[0]?.status).toBe('feasible');
        expect(resolver.resolve({
            ...facts,
            minutesUntilDeliveryWindowStart: -6,
        }).decisions[0]?.status).toBe('infeasible');
    });

    it('reports unknown feasibility when a region has no delivery candidates', () => {
        const source = worldMap();
        const map: WorldMap = {
            ...source,
            regions: [{ ...source.regions[0]!, deliveryLocations: [] }],
        };

        expect(new DealerTravelFeasibilityResolver(tradeCatalog(), map).resolve({
            regionId: 'Test',
            deliveryWindowStartTime: 1200,
            minutesUntilDeliveryWindowStart: 10,
            dealers: [{ personId: 'center', origin: { x: 100, y: 0, z: 0 } }],
        }).decisions[0]).toMatchObject({
            status: 'unknown',
            worstCase: null,
            reasons: [{ code: 'missing-delivery-locations', regionId: 'Test' }],
        });
    });

    it('allows one physical delivery location to belong to multiple regions', () => {
        const source = worldMap();
        const map: WorldMap = {
            ...source,
            regions: [
                source.regions[0]!,
                {
                    ...source.regions[0]!,
                    id: 'Other',
                    name: 'Other',
                    deliveryLocations: [{ id: 'east', position: { x: 200, y: 0, z: 0 } }],
                },
            ],
        };

        expect(new DealerTravelFeasibilityResolver(tradeCatalog(), map).resolve({
            regionId: 'Other',
            deliveryWindowStartTime: 1200,
            minutesUntilDeliveryWindowStart: 10,
            dealers: [{ personId: 'center', origin: { x: 100, y: 0, z: 0 } }],
        }).decisions[0]).toMatchObject({
            status: 'feasible',
            deliveryLocationCount: 1,
            worstCase: { deliveryLocationId: 'east' },
        });
    });

    it('rejects one delivery location ID with inconsistent regional positions', () => {
        const source = worldMap();
        const map: WorldMap = {
            ...source,
            regions: [
                source.regions[0]!,
                {
                    ...source.regions[0]!,
                    id: 'Other',
                    name: 'Other',
                    deliveryLocations: [{ id: 'east', position: { x: 201, y: 0, z: 0 } }],
                },
            ],
        };

        expect(() => new DealerTravelFeasibilityResolver(tradeCatalog(), map)).toThrow(
            'Delivery location "east" has inconsistent positions across regions'
        );
    });

    it('preserves HHMM wrapping for very large safe arrival delays', () => {
        expect(estimateDealerTravel({
            ...mechanics(),
            dealArrivalDelay: Number.MAX_SAFE_INTEGER,
        }, {
            origin: { x: 0, y: 0, z: 0 },
            destination: { x: 0, y: 0, z: 0 },
            walkSpeed: 4,
            deliveryWindowStartTime: 2,
        }).targetArrivalTime).toBe(33);
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

function tradeCatalog(): TradeCatalog {
    return {
        schema: 'neonschedule1-trade-catalog-2',
        dealerMechanics: mechanics(),
        dealers: ['west', 'center'].map((personId) => ({
            personId,
            instanceKey: `${personId}:one`,
            type: 'PlayerDealer',
            homeName: `${personId} home`,
            walkSpeed: 4,
            salesCutPercentage: 0.2,
            signingFee: 0,
            qualityTolerance: { negative: -2, positive: 5 },
        })),
        suppliers: [],
    };
}

function worldMap(): WorldMap {
    return {
        schema: 'neonschedule1-world-map-2',
        mainMap: null,
        tutorialMap: null,
        projection: {
            origin: { x: 0, y: 0, z: 0 },
            edge: { x: 1, y: 0, z: 0 },
            mapDimensions: 1,
            conversionFactor: 1,
        },
        regions: [{
            id: 'Test',
            name: 'Test',
            unlockedByDefault: true,
            rankRequirement: null,
            spriteFileId: null,
            boundsPointA: null,
            boundsPointB: null,
            isClosed: false,
            verticalSize: 0,
            polygonPoints: [],
            adjacentRegionIds: [],
            deliveryLocations: [
                { id: 'west', position: { x: 0, y: 0, z: 0 } },
                { id: 'east', position: { x: 200, y: 0, z: 0 } },
            ],
        }],
    };
}
