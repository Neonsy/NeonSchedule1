import { describe, expect, it } from 'vitest';

import {
    comparePropertyVisualCapture,
    parsePropertyVisualCaptureRequest,
    parsePropertyVisualCaptureResponse,
    propertyVisualCaptureViews,
} from '#data-compiler/property-visual-capture';

const requestSha256 = 'a'.repeat(64);
const responseSha256 = 'b'.repeat(64);

describe('property visual capture protocol', () => {
    it('accepts exactly four hash-bound private captures per requested property', () => {
        const request = parsePropertyVisualCaptureRequest(requestFixture());
        const response = parsePropertyVisualCaptureResponse(responseFixture());

        expect(comparePropertyVisualCapture(
            request,
            response,
            requestSha256,
            responseSha256
        )).toMatchObject({
            propertyCount: 2,
            captureCount: 8,
            viewsPerProperty: 4,
        });
    });

    it('rejects a duplicate capture in place of a missing view', () => {
        const request = parsePropertyVisualCaptureRequest(requestFixture());
        const source = responseFixture();
        const response = parsePropertyVisualCaptureResponse({
            ...source,
            captures: [...source.captures.slice(0, -1), source.captures[0]],
        });

        expect(() => comparePropertyVisualCapture(
            request,
            response,
            requestSha256,
            responseSha256
        )).toThrow('Unexpected or duplicate property capture');
    });

    it('rejects a capture path outside the private run directory', () => {
        const source = responseFixture();
        expect(() => parsePropertyVisualCaptureResponse({
            ...source,
            captures: [{ ...source.captures[0], relativePath: '../barn.png' }],
        })).toThrow('not a safe property capture path');
    });

    it('rejects undeclared response data', () => {
        expect(() => parsePropertyVisualCaptureResponse({
            ...responseFixture(),
            rawScene: { objects: [] },
        })).toThrow('unsupported field rawScene');
    });
});

function requestFixture() {
    return {
        schema: 'neonschedule1-property-visual-capture-request-1',
        requestId: 'request-a',
        dataset: {
            gameVersion: '0.4.6f13',
            datasetSha256: 'c'.repeat(64),
            normalizerVersion: '4',
        },
        width: 1_280,
        height: 960,
        propertyCodes: ['barn', 'bungalow'],
    } as const;
}

function responseFixture() {
    return {
        schema: 'neonschedule1-property-visual-capture-response-1',
        exporterVersion: '0.0.33',
        capturedAtUtc: '2026-09-01T10:00:00.000Z',
        gameVersion: '0.4.6f13',
        requestId: 'request-a',
        requestSha256,
        datasetSha256: 'c'.repeat(64),
        captures: ['barn', 'bungalow'].flatMap((propertyCode) =>
            propertyVisualCaptureViews.map((view) => ({
                propertyCode,
                propertyName: propertyCode === 'barn' ? 'Barn' : 'Bungalow',
                view,
                relativePath:
                    `property-visual-captures-20260901T100000000Z/${propertyCode}-${view}.png`,
                sha256: 'd'.repeat(64),
                width: 1_280,
                height: 960,
                visibleRendererCount: 12,
                subjectBoundsCenter: { x: 1, y: 2, z: 3 },
                subjectBoundsSize: { x: 4, y: 5, z: 6 },
                cameraPosition: { x: 7, y: 8, z: 9 },
                cameraTarget: { x: 1, y: 2, z: 3 },
            }))
        ),
    } as const;
}
