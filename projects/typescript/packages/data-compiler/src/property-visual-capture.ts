import { createHash } from 'node:crypto';

import type { DatasetManifest, PropertyLayout, Vector3 } from '@neonschedule1/core';

export const propertyVisualCaptureRequestFileName =
    'property-visual-capture-request.json';
export const propertyVisualCaptureResponseFileName =
    'property-visual-capture-response.json';
export const propertyVisualCaptureWidth = 1_280;
export const propertyVisualCaptureHeight = 960;

const requestSchema = 'neonschedule1-property-visual-capture-request-1';
const responseSchema = 'neonschedule1-property-visual-capture-response-1';
const reportSchema = 'neonschedule1-property-visual-capture-report-1';
const propertyCodePattern = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const capturePathPattern =
    /^property-visual-captures-\d{8}T\d{9}Z\/[a-z0-9][a-z0-9-]{0,63}-(north-east|south-east|south-west|north-west)\.png$/u;

export const propertyVisualCaptureViews = [
    'north-east',
    'south-east',
    'south-west',
    'north-west',
] as const;

export type PropertyVisualCaptureView = typeof propertyVisualCaptureViews[number];

export interface PropertyVisualCaptureRequest {
    readonly schema: typeof requestSchema;
    readonly requestId: string;
    readonly dataset: {
        readonly gameVersion: string;
        readonly datasetSha256: string;
        readonly normalizerVersion: string;
    };
    readonly width: typeof propertyVisualCaptureWidth;
    readonly height: typeof propertyVisualCaptureHeight;
    readonly propertyCodes: readonly string[];
}

export interface PropertyVisualCaptureResponse {
    readonly schema: typeof responseSchema;
    readonly exporterVersion: string;
    readonly capturedAtUtc: string;
    readonly gameVersion: string;
    readonly requestId: string;
    readonly requestSha256: string;
    readonly datasetSha256: string;
    readonly captures: readonly PropertyVisualCapture[];
}

export interface PropertyVisualCapture {
    readonly propertyCode: string;
    readonly propertyName: string;
    readonly view: PropertyVisualCaptureView;
    readonly relativePath: string;
    readonly sha256: string;
    readonly width: typeof propertyVisualCaptureWidth;
    readonly height: typeof propertyVisualCaptureHeight;
    readonly visibleRendererCount: number;
    readonly subjectBoundsCenter: Vector3;
    readonly subjectBoundsSize: Vector3;
    readonly cameraPosition: Vector3;
    readonly cameraTarget: Vector3;
}

export interface PropertyVisualCaptureReport {
    readonly schema: typeof reportSchema;
    readonly comparedAtUtc: string;
    readonly gameVersion: string;
    readonly datasetSha256: string;
    readonly exporterVersion: string;
    readonly requestId: string;
    readonly requestSha256: string;
    readonly responseSha256: string;
    readonly propertyCount: number;
    readonly captureCount: number;
    readonly viewsPerProperty: number;
}

export function createPropertyVisualCaptureRequest(
    manifest: DatasetManifest,
    layouts: readonly PropertyLayout[],
    requestId: string
): PropertyVisualCaptureRequest {
    const propertyCodes = layouts
        .map((layout) => layout.propertyCode)
        .sort((left, right) => left.localeCompare(right));
    if (propertyCodes.length === 0) throw new Error('Dataset contains no properties');
    if (new Set(propertyCodes).size !== propertyCodes.length) {
        throw new Error('Dataset contains duplicate property codes');
    }
    return parsePropertyVisualCaptureRequest({
        schema: requestSchema,
        requestId,
        dataset: {
            gameVersion: manifest.gameVersion,
            datasetSha256: manifest.datasetSha256,
            normalizerVersion: manifest.normalizerVersion,
        },
        width: propertyVisualCaptureWidth,
        height: propertyVisualCaptureHeight,
        propertyCodes,
    });
}

export function parsePropertyVisualCaptureRequest(
    value: unknown
): PropertyVisualCaptureRequest {
    const source = exactRecord(value, 'request', [
        'schema',
        'requestId',
        'dataset',
        'width',
        'height',
        'propertyCodes',
    ]);
    equal(text(source.schema, 'request.schema'), requestSchema, 'request schema');
    const dataset = exactRecord(source.dataset, 'request.dataset', [
        'gameVersion',
        'datasetSha256',
        'normalizerVersion',
    ]);
    const requestId = text(source.requestId, 'request.requestId');
    if (requestId.length > 128 || requestId.includes('\0')) {
        throw new Error('request.requestId is invalid');
    }
    const propertyCodes = list(source.propertyCodes, 'request.propertyCodes').map(
        (entry, index) => propertyCode(entry, `request.propertyCodes[${index}]`)
    );
    if (propertyCodes.length === 0 || propertyCodes.length > 64) {
        throw new Error('request.propertyCodes must contain 1 to 64 entries');
    }
    if (new Set(propertyCodes).size !== propertyCodes.length) {
        throw new Error('request.propertyCodes contains duplicates');
    }
    equal(integer(source.width, 'request.width'), propertyVisualCaptureWidth, 'capture width');
    equal(integer(source.height, 'request.height'), propertyVisualCaptureHeight, 'capture height');
    return {
        schema: requestSchema,
        requestId,
        dataset: {
            gameVersion: text(dataset.gameVersion, 'request.dataset.gameVersion'),
            datasetSha256: sha256(dataset.datasetSha256, 'request.dataset.datasetSha256'),
            normalizerVersion: text(
                dataset.normalizerVersion,
                'request.dataset.normalizerVersion'
            ),
        },
        width: propertyVisualCaptureWidth,
        height: propertyVisualCaptureHeight,
        propertyCodes,
    };
}

export function parsePropertyVisualCaptureResponse(
    value: unknown
): PropertyVisualCaptureResponse {
    const source = exactRecord(value, 'response', [
        'schema',
        'exporterVersion',
        'capturedAtUtc',
        'gameVersion',
        'requestId',
        'requestSha256',
        'datasetSha256',
        'captures',
    ]);
    equal(text(source.schema, 'response.schema'), responseSchema, 'response schema');
    const capturedAtUtc = timestamp(source.capturedAtUtc, 'response.capturedAtUtc');
    return {
        schema: responseSchema,
        exporterVersion: text(source.exporterVersion, 'response.exporterVersion'),
        capturedAtUtc,
        gameVersion: text(source.gameVersion, 'response.gameVersion'),
        requestId: text(source.requestId, 'response.requestId'),
        requestSha256: sha256(source.requestSha256, 'response.requestSha256'),
        datasetSha256: sha256(source.datasetSha256, 'response.datasetSha256'),
        captures: list(source.captures, 'response.captures').map(parseCapture),
    };
}

export function comparePropertyVisualCapture(
    request: PropertyVisualCaptureRequest,
    response: PropertyVisualCaptureResponse,
    requestSha256: string,
    responseSha256: string
): PropertyVisualCaptureReport {
    equal(response.requestId, request.requestId, 'request ID');
    equal(response.requestSha256, requestSha256, 'request SHA-256');
    equal(response.gameVersion, request.dataset.gameVersion, 'game version');
    equal(response.datasetSha256, request.dataset.datasetSha256, 'dataset SHA-256');
    equal(
        response.captures.length,
        request.propertyCodes.length * propertyVisualCaptureViews.length,
        'capture count'
    );

    const expected = new Set(request.propertyCodes.flatMap((propertyCode) =>
        propertyVisualCaptureViews.map((view) => `${propertyCode}:${view}`)
    ));
    for (const capture of response.captures) {
        const key = `${capture.propertyCode}:${capture.view}`;
        if (!expected.delete(key)) {
            throw new Error(`Unexpected or duplicate property capture ${key}`);
        }
        if (capture.visibleRendererCount === 0) {
            throw new Error(`Property capture ${key} contains no visible renderers`);
        }
        const expectedSuffix = `/${capture.propertyCode}-${capture.view}.png`;
        if (!capture.relativePath.endsWith(expectedSuffix)) {
            throw new Error(`Property capture ${key} path does not match its identity`);
        }
    }
    if (expected.size !== 0) {
        throw new Error(`Missing property captures: ${[...expected].sort().join(', ')}`);
    }
    return {
        schema: reportSchema,
        comparedAtUtc: new Date().toISOString(),
        gameVersion: response.gameVersion,
        datasetSha256: response.datasetSha256,
        exporterVersion: response.exporterVersion,
        requestId: response.requestId,
        requestSha256,
        responseSha256,
        propertyCount: request.propertyCodes.length,
        captureCount: response.captures.length,
        viewsPerProperty: propertyVisualCaptureViews.length,
    };
}

export function contentSha256(content: Uint8Array): string {
    return createHash('sha256').update(content).digest('hex');
}

function parseCapture(value: unknown, index: number): PropertyVisualCapture {
    const label = `response.captures[${index}]`;
    const source = exactRecord(value, label, [
        'propertyCode',
        'propertyName',
        'view',
        'relativePath',
        'sha256',
        'width',
        'height',
        'visibleRendererCount',
        'subjectBoundsCenter',
        'subjectBoundsSize',
        'cameraPosition',
        'cameraTarget',
    ]);
    const relativePath = text(source.relativePath, `${label}.relativePath`);
    if (!capturePathPattern.test(relativePath)) {
        throw new Error(`${label}.relativePath is not a safe property capture path`);
    }
    const subjectBoundsSize = vector(source.subjectBoundsSize, `${label}.subjectBoundsSize`);
    if (subjectBoundsSize.x <= 0 || subjectBoundsSize.y <= 0 || subjectBoundsSize.z <= 0) {
        throw new Error(`${label}.subjectBoundsSize must be positive`);
    }
    return {
        propertyCode: propertyCode(source.propertyCode, `${label}.propertyCode`),
        propertyName: text(source.propertyName, `${label}.propertyName`),
        view: captureView(source.view, `${label}.view`),
        relativePath,
        sha256: sha256(source.sha256, `${label}.sha256`),
        width: exactDimension(source.width, propertyVisualCaptureWidth, `${label}.width`),
        height: exactDimension(source.height, propertyVisualCaptureHeight, `${label}.height`),
        visibleRendererCount: nonNegativeInteger(
            source.visibleRendererCount,
            `${label}.visibleRendererCount`
        ),
        subjectBoundsCenter: vector(source.subjectBoundsCenter, `${label}.subjectBoundsCenter`),
        subjectBoundsSize,
        cameraPosition: vector(source.cameraPosition, `${label}.cameraPosition`),
        cameraTarget: vector(source.cameraTarget, `${label}.cameraTarget`),
    };
}

function exactRecord(
    value: unknown,
    label: string,
    fields: readonly string[]
): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    const source = value as Record<string, unknown>;
    const expected = new Set(fields);
    for (const field of Object.keys(source)) {
        if (!expected.delete(field)) throw new Error(`${label} contains unsupported field ${field}`);
    }
    if (expected.size !== 0) {
        throw new Error(`${label} is missing fields ${[...expected].join(', ')}`);
    }
    return source;
}

function list(value: unknown, label: string): readonly unknown[] {
    if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
    return value;
}

function text(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${label} must be non-empty text`);
    }
    return value;
}

function integer(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new Error(`${label} must be an integer`);
    }
    return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
    const result = integer(value, label);
    if (result < 0) throw new Error(`${label} must be non-negative`);
    return result;
}

function exactDimension<const Expected extends number>(
    value: unknown,
    expected: Expected,
    label: string
): Expected {
    equal(integer(value, label), expected, label);
    return expected;
}

function propertyCode(value: unknown, label: string): string {
    const result = text(value, label);
    if (!propertyCodePattern.test(result)) throw new Error(`${label} is invalid`);
    return result;
}

function captureView(value: unknown, label: string): PropertyVisualCaptureView {
    const result = text(value, label);
    if (!propertyVisualCaptureViews.includes(result as PropertyVisualCaptureView)) {
        throw new Error(`${label} is unsupported`);
    }
    return result as PropertyVisualCaptureView;
}

function sha256(value: unknown, label: string): string {
    const result = text(value, label);
    if (!sha256Pattern.test(result)) throw new Error(`${label} must be a lowercase SHA-256`);
    return result;
}

function timestamp(value: unknown, label: string): string {
    const result = text(value, label);
    if (Number.isNaN(Date.parse(result))) throw new Error(`${label} must be a timestamp`);
    return result;
}

function vector(value: unknown, label: string): Vector3 {
    const source = exactRecord(value, label, ['x', 'y', 'z']);
    return {
        x: finite(source.x, `${label}.x`),
        y: finite(source.y, `${label}.y`),
        z: finite(source.z, `${label}.z`),
    };
}

function finite(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${label} must be finite`);
    }
    return value;
}

function equal(actual: unknown, expected: unknown, label: string): void {
    if (actual !== expected) {
        throw new Error(`${label} mismatch: expected ${String(expected)}, received ${String(actual)}`);
    }
}
