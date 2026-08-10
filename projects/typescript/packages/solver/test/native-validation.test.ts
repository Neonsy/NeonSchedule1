import { describe, expect, it } from 'vitest';

import {
    compareNativeValidation,
    parseNativeValidationResponse,
    type NativeValidationRequest,
} from '#solver/native-validation';

const requestSha256 = 'a'.repeat(64);

const request: NativeValidationRequest = {
    schema: 'neonschedule1-native-recipe-validation-request-2',
    createdAt: '2026-08-10T00:00:00.000Z',
    ruleProfile: { kind: 'seeded-rotation', angleDegrees: 90 },
    dataset: {
        gameVersion: 'test-game',
        datasetSha256: 'b'.repeat(64),
        normalizerVersion: 'test-normalizer',
    },
    cases: [{
        id: 'case',
        reasons: ['depth-coverage'],
        productId: 'product',
        ingredientIds: ['ingredient'],
        expected: {
            effectIds: ['effect'],
            calculatedValue: 12,
        },
    }],
};

describe('native recipe validation profile boundary', () => {
    it('preserves a canonical seeded profile in a native response', () => {
        const response = parseNativeValidationResponse(responseFor({
            kind: 'seeded-rotation',
            angleDegrees: 90,
        }));

        expect(response.ruleProfile).toEqual(request.ruleProfile);
        expect(compareNativeValidation(
            request,
            response,
            requestSha256,
            'c'.repeat(64)
        ).ruleProfile).toEqual(request.ruleProfile);
    });

    it('rejects a response produced under another loaded-save profile', () => {
        const response = parseNativeValidationResponse(responseFor({ kind: 'standard' }));

        expect(() => compareNativeValidation(
            request,
            response,
            requestSha256,
            'c'.repeat(64)
        )).toThrow('Native response mixing rule profile differs from the request');
    });
});

function responseFor(ruleProfile: unknown): unknown {
    return {
        schema: 'neonschedule1-native-recipe-validation-response-2',
        exporterVersion: '0.0.16',
        evaluatedAtUtc: '2026-08-10T00:01:00.000Z',
        gameVersion: 'test-game',
        requestSha256,
        ruleProfile,
        cases: [{
            id: 'case',
            productId: 'product',
            ingredientIds: ['ingredient'],
            effectIds: ['effect'],
            calculatedValue: 12,
        }],
    };
}
