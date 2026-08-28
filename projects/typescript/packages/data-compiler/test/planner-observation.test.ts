import { describe, expect, it } from 'vitest';

import {
    comparePlannerObservation,
    validatePlannerObservationRequest,
    validatePlannerObservationResponse,
} from '@neonschedule1/core';

const requestSha256 = 'a'.repeat(64);

describe('planner observation protocol', () => {
    it('accepts a matching read-only response with explicit inventory coverage', () => {
        const request = validatePlannerObservationRequest({
            schema: 'neonschedule1-planner-observation-request-1',
            requestId: 'request-a',
            expectedGameVersion: '0.4.6f13',
        });
        const response = validatePlannerObservationResponse(responseFixture());

        expect(comparePlannerObservation(request, response, requestSha256)).toBe(response);
    });

    it('rejects undeclared response data', () => {
        expect(() => validatePlannerObservationResponse({
            ...responseFixture(),
            rawSave: { playerName: 'must not pass the boundary' },
        })).toThrow();
    });

    it('rejects a response produced for another request', () => {
        const request = validatePlannerObservationRequest({
            schema: 'neonschedule1-planner-observation-request-1',
            requestId: 'request-a',
            expectedGameVersion: '0.4.6f13',
        });
        const response = validatePlannerObservationResponse({
            ...responseFixture(),
            requestSha256: 'b'.repeat(64),
        });

        expect(() => comparePlannerObservation(request, response, requestSha256))
            .toThrow('does not match the staged request');
    });

    it('rejects snapshots in an unknown inventory scope', () => {
        expect(() => validatePlannerObservationResponse({
            ...responseFixture(),
            inventoryScopes: {
                ...responseFixture().inventoryScopes,
                employees: 'unknown',
            },
        })).toThrow('Unknown planner observation inventory scope employees has snapshots');
    });
});

function responseFixture() {
    const unknown = { status: 'unknown' } as const;
    return {
        schema: 'neonschedule1-planner-observation-response-1',
        exporterVersion: '0.0.32',
        observedAtUtc: '2026-08-28T10:00:00.000Z',
        gameVersion: '0.4.6f13',
        requestId: 'request-a',
        requestSha256,
        source: {
            kind: 'mod',
            access: 'read-only',
            rawPayloadRetention: 'none',
        },
        state: {
            mixingRuleProfile: unknown,
            currentRank: unknown,
            unlockedPersonIds: unknown,
            relationships: unknown,
            recommendedDealerIds: unknown,
            recruitedDealerIds: unknown,
            customers: unknown,
            dealers: unknown,
            availableCash: unknown,
            gameMinute: unknown,
            properties: unknown,
            employees: unknown,
        },
        inventoryScopes: {
            player: 'complete',
            dealers: 'complete',
            suppliers: 'complete',
            properties: 'complete',
            placements: 'complete',
            employees: 'complete',
            vehicles: 'complete',
        },
        inventories: [{
            owner: { kind: 'employee', id: 'employee-a' },
            coverage: 'complete',
            entries: [],
        }, {
            owner: { kind: 'player', id: 'local' },
            coverage: 'complete',
            entries: [{
                itemId: 'cuke',
                currentQuantity: { status: 'known', value: 3 },
                currentStackCount: { status: 'known', value: 1 },
            }],
        }],
    } as const;
}
