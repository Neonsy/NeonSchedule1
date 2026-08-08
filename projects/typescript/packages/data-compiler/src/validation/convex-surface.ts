import { createHash } from 'node:crypto';

import {
    convexHullFromTriangleMesh,
    worldPointFromBasis,
    worldNormalFromBasis,
    type Collider,
    type ConvexHull,
    type DatasetManifest,
    type PropertyLayout,
    type Vector3,
} from '@neonschedule1/core';

export const convexValidationRequestFileName = 'native-convex-validation-request.json';
export const convexValidationResponseFileName = 'native-convex-validation-response.json';
export const convexValidationPointTolerance = 1e-3;

const requestSchema = 'neonschedule1-native-convex-validation-request-1';
const responseSchema = 'neonschedule1-native-convex-validation-response-1';
const reportSchema = 'neonschedule1-native-convex-validation-report-1';
const minimumNormalDot = Math.cos(3 * Math.PI / 180);
const maximumCookedFaces = 255;

export interface ConvexValidationRequest {
    readonly schema: typeof requestSchema;
    readonly dataset: ConvexValidationDataset;
    readonly cases: readonly ConvexValidationCase[];
}

interface ConvexValidationDataset {
    readonly gameVersion: string;
    readonly datasetSha256: string;
    readonly normalizerVersion: string;
}

export interface ConvexValidationCase {
    readonly id: string;
    readonly propertyCode: string;
    readonly surfaceId: string;
    readonly colliderPath: string;
    readonly meshName: string;
    readonly rays: readonly ConvexValidationRay[];
}

export interface ConvexValidationRay {
    readonly id: string;
    readonly origin: Vector3;
    readonly direction: Vector3;
    readonly maxDistance: number;
    readonly expectedPoint: Vector3;
}

export interface ConvexValidationResponse {
    readonly schema: typeof responseSchema;
    readonly exporterVersion: string;
    readonly evaluatedAtUtc: string;
    readonly gameVersion: string;
    readonly requestSha256: string;
    readonly cases: readonly ConvexValidationResponseCase[];
}

interface ConvexValidationResponseCase {
    readonly id: string;
    readonly propertyCode: string;
    readonly surfaceId: string;
    readonly colliderPath: string;
    readonly meshName: string;
    readonly cookingOptions: number;
    readonly cookingOptionsName: string;
    readonly rays: readonly ConvexValidationRayResult[];
}

interface ConvexValidationRayResult {
    readonly id: string;
    readonly hit: boolean;
    readonly point: Vector3 | null;
    readonly normal: Vector3 | null;
    readonly distance: number | null;
}

export interface ConvexValidationReport {
    readonly schema: typeof reportSchema;
    readonly comparedAt: string;
    readonly gameVersion: string;
    readonly datasetSha256: string;
    readonly exporterVersion: string;
    readonly requestSha256: string;
    readonly responseSha256: string;
    readonly caseCount: number;
    readonly rayCount: number;
    readonly maximumPointError: number;
    readonly minimumNormalDot: number;
    readonly cookingOptions: readonly {
        readonly value: number;
        readonly name: string;
        readonly caseCount: number;
    }[];
}

export function createConvexValidationRequest(
    manifest: DatasetManifest,
    layouts: readonly PropertyLayout[]
): ConvexValidationRequest {
    const cases = layouts.flatMap((layout) => validationCases(layout));
    if (cases.length === 0) throw new Error('Dataset contains no enabled convex surface colliders');
    return {
        schema: requestSchema,
        dataset: {
            gameVersion: manifest.gameVersion,
            datasetSha256: manifest.datasetSha256,
            normalizerVersion: manifest.normalizerVersion,
        },
        cases,
    };
}

export function parseConvexValidationRequest(value: unknown): ConvexValidationRequest {
    const source = record(value, 'request');
    if (text(source.schema, 'request.schema') !== requestSchema) {
        throw new Error(`Unsupported convex validation request schema ${JSON.stringify(source.schema)}`);
    }
    const dataset = record(source.dataset, 'request.dataset');
    return {
        schema: requestSchema,
        dataset: {
            gameVersion: text(dataset.gameVersion, 'request.dataset.gameVersion'),
            datasetSha256: sha256(dataset.datasetSha256, 'request.dataset.datasetSha256'),
            normalizerVersion: text(
                dataset.normalizerVersion,
                'request.dataset.normalizerVersion'
            ),
        },
        cases: list(source.cases, 'request.cases').map((entry, index) => {
            const item = record(entry, `request.cases[${index}]`);
            return {
                id: text(item.id, `request.cases[${index}].id`),
                propertyCode: text(item.propertyCode, `request.cases[${index}].propertyCode`),
                surfaceId: text(item.surfaceId, `request.cases[${index}].surfaceId`),
                colliderPath: text(item.colliderPath, `request.cases[${index}].colliderPath`),
                meshName: text(item.meshName, `request.cases[${index}].meshName`),
                rays: list(item.rays, `request.cases[${index}].rays`).map((ray, rayIndex) => {
                    const raySource = record(ray, `request.cases[${index}].rays[${rayIndex}]`);
                    return {
                        id: text(raySource.id, `request.cases[${index}].rays[${rayIndex}].id`),
                        origin: vector(
                            raySource.origin,
                            `request.cases[${index}].rays[${rayIndex}].origin`
                        ),
                        direction: vector(
                            raySource.direction,
                            `request.cases[${index}].rays[${rayIndex}].direction`
                        ),
                        maxDistance: finite(
                            raySource.maxDistance,
                            `request.cases[${index}].rays[${rayIndex}].maxDistance`
                        ),
                        expectedPoint: vector(
                            raySource.expectedPoint,
                            `request.cases[${index}].rays[${rayIndex}].expectedPoint`
                        ),
                    };
                }),
            };
        }),
    };
}

export function parseConvexValidationResponse(value: unknown): ConvexValidationResponse {
    const source = record(value, 'response');
    if (text(source.schema, 'response.schema') !== responseSchema) {
        throw new Error(`Unsupported convex validation response schema ${JSON.stringify(source.schema)}`);
    }
    return {
        schema: responseSchema,
        exporterVersion: text(source.exporterVersion, 'response.exporterVersion'),
        evaluatedAtUtc: text(source.evaluatedAtUtc, 'response.evaluatedAtUtc'),
        gameVersion: text(source.gameVersion, 'response.gameVersion'),
        requestSha256: sha256(source.requestSha256, 'response.requestSha256'),
        cases: list(source.cases, 'response.cases').map((entry, index) => {
            const item = record(entry, `response.cases[${index}]`);
            return {
                id: text(item.id, `response.cases[${index}].id`),
                propertyCode: text(item.propertyCode, `response.cases[${index}].propertyCode`),
                surfaceId: text(item.surfaceId, `response.cases[${index}].surfaceId`),
                colliderPath: text(item.colliderPath, `response.cases[${index}].colliderPath`),
                meshName: text(item.meshName, `response.cases[${index}].meshName`),
                cookingOptions: integer(item.cookingOptions, `response.cases[${index}].cookingOptions`),
                cookingOptionsName: text(
                    item.cookingOptionsName,
                    `response.cases[${index}].cookingOptionsName`
                ),
                rays: list(item.rays, `response.cases[${index}].rays`).map((ray, rayIndex) =>
                    parseRayResult(ray, `response.cases[${index}].rays[${rayIndex}]`)
                ),
            };
        }),
    };
}

export function compareConvexValidation(
    request: ConvexValidationRequest,
    response: ConvexValidationResponse,
    requestSha256: string,
    responseSha256: string
): ConvexValidationReport {
    equal(response.requestSha256, requestSha256, 'request SHA-256');
    equal(response.gameVersion, request.dataset.gameVersion, 'game version');
    equal(response.cases.length, request.cases.length, 'case count');

    let maximumPointError = 0;
    let normalDot = 1;
    let rayCount = 0;
    const options = new Map<string, { value: number; name: string; caseCount: number }>();
    request.cases.forEach((expectedCase, caseIndex) => {
        const actualCase = response.cases[caseIndex]!;
        for (const field of ['id', 'propertyCode', 'surfaceId', 'colliderPath', 'meshName'] as const) {
            equal(actualCase[field], expectedCase[field], `${expectedCase.id} ${field}`);
        }
        equal(actualCase.rays.length, expectedCase.rays.length, `${expectedCase.id} ray count`);
        const optionKey = `${actualCase.cookingOptions}:${actualCase.cookingOptionsName}`;
        const option = options.get(optionKey) ?? {
            value: actualCase.cookingOptions,
            name: actualCase.cookingOptionsName,
            caseCount: 0,
        };
        option.caseCount++;
        options.set(optionKey, option);

        expectedCase.rays.forEach((expectedRay, rayIndex) => {
            const actualRay = actualCase.rays[rayIndex]!;
            equal(actualRay.id, expectedRay.id, `${expectedCase.id} ray ID`);
            if (!actualRay.hit || actualRay.point === null || actualRay.normal === null) {
                throw new Error(`Unity convex collider missed ${expectedCase.id}/${expectedRay.id}`);
            }
            const pointError = length(subtract(actualRay.point, expectedRay.expectedPoint));
            maximumPointError = Math.max(maximumPointError, pointError);
            const outward = scale(expectedRay.direction, -1);
            normalDot = Math.min(normalDot, dot(normalize(actualRay.normal), outward));
            rayCount++;
        });
    });
    if (maximumPointError > convexValidationPointTolerance) {
        throw new Error(
            `Unity convex hull differs from the candidate by ${maximumPointError}, ` +
                `above ${convexValidationPointTolerance}`
        );
    }
    if (normalDot < minimumNormalDot) {
        throw new Error(
            `Unity convex hull normal dot ${normalDot} is below ${minimumNormalDot}`
        );
    }
    return {
        schema: reportSchema,
        comparedAt: new Date().toISOString(),
        gameVersion: response.gameVersion,
        datasetSha256: request.dataset.datasetSha256,
        exporterVersion: response.exporterVersion,
        requestSha256,
        responseSha256,
        caseCount: request.cases.length,
        rayCount,
        maximumPointError,
        minimumNormalDot: normalDot,
        cookingOptions: [...options.values()].sort(
            (left, right) => left.value - right.value || left.name.localeCompare(right.name)
        ),
    };
}

export function contentSha256(content: Uint8Array): string {
    return createHash('sha256').update(content).digest('hex');
}

function validationCases(layout: PropertyLayout): ConvexValidationCase[] {
    const meshById = new Map(layout.surfaceMeshes.map((mesh) => [mesh.meshId, mesh]));
    return layout.surfaces.flatMap((surface) => surface.colliders.flatMap((collider) => {
        if (!isEnabledConvexMesh(collider)) return [];
        const source = meshById.get(collider.meshId);
        if (source === undefined) {
            throw new Error(`Convex surface collider ${JSON.stringify(collider.transform.path)} has no mesh`);
        }
        const hull = convexHullFromTriangleMesh(source);
        const faceCount = hull.faces.length;
        if (hull.vertices.length > maximumCookedFaces || faceCount > maximumCookedFaces) {
            throw new Error(
                `Convex hull ${JSON.stringify(source.meshId)} exceeds the supported PhysX limit`
            );
        }
        const key = JSON.stringify([
            layout.propertyCode,
            surface.id,
            collider.transform.path,
            collider.meshName,
        ]);
        return [{
            id: `convex-${contentSha256(Buffer.from(key)).slice(0, 12)}`,
            propertyCode: layout.propertyCode,
            surfaceId: surface.id,
            colliderPath: collider.transform.path,
            meshName: collider.meshName,
            rays: faceRays(collider, hull),
        }];
    })).sort((left, right) => left.id.localeCompare(right.id));
}

function isEnabledConvexMesh(
    collider: Collider
): collider is Collider & { readonly meshId: string; readonly meshName: string } {
    return collider.shape === 'mesh' && collider.enabled && !collider.isTrigger &&
        collider.isConvex === true && collider.meshId !== null && collider.meshName !== null;
}

function faceRays(collider: Collider, hull: ConvexHull): ConvexValidationRay[] {
    const offset = Math.max(length(collider.worldBounds.size), 1);
    return hull.faces.map((face, index) => {
        const expectedPoint = worldPointFromBasis(
            collider.transform,
            collider.worldBasis,
            face.centroid
        );
        const outward = worldNormalFromBasis(collider.worldBasis, face.normal);
        return {
            id: `face-${index}`,
            origin: add(expectedPoint, scale(outward, offset)),
            direction: scale(outward, -1),
            maxDistance: offset * 2,
            expectedPoint,
        };
    });
}

function parseRayResult(value: unknown, label: string): ConvexValidationRayResult {
    const source = record(value, label);
    const hit = boolean(source.hit, `${label}.hit`);
    return {
        id: text(source.id, `${label}.id`),
        hit,
        point: source.point === null ? null : vector(source.point, `${label}.point`),
        normal: source.normal === null ? null : vector(source.normal, `${label}.normal`),
        distance: source.distance === null ? null : finite(source.distance, `${label}.distance`),
    };
}

function record(value: unknown, label: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function list(value: unknown, label: string): unknown[] {
    if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
    return value;
}

function text(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a string`);
    return value;
}

function sha256(value: unknown, label: string): string {
    const result = text(value, label);
    if (!/^[a-f0-9]{64}$/u.test(result)) throw new Error(`${label} must be a lowercase SHA-256`);
    return result;
}

function finite(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`);
    return value;
}

function integer(value: unknown, label: string): number {
    const result = finite(value, label);
    if (!Number.isSafeInteger(result)) throw new Error(`${label} must be a safe integer`);
    return result;
}

function boolean(value: unknown, label: string): boolean {
    if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`);
    return value;
}

function vector(value: unknown, label: string): Vector3 {
    const source = record(value, label);
    return {
        x: finite(source.x, `${label}.x`),
        y: finite(source.y, `${label}.y`),
        z: finite(source.z, `${label}.z`),
    };
}

function equal(actual: unknown, expected: unknown, label: string): void {
    if (actual !== expected) {
        throw new Error(`Convex validation mismatch for ${label}: expected ${expected}, received ${actual}`);
    }
}

function normalize(value: Vector3): Vector3 {
    const magnitude = length(value);
    if (magnitude === 0) throw new RangeError('Cannot normalize a zero-length vector');
    return scale(value, 1 / magnitude);
}

function length(value: Vector3): number {
    return Math.hypot(value.x, value.y, value.z);
}

function add(left: Vector3, right: Vector3): Vector3 {
    return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

function subtract(left: Vector3, right: Vector3): Vector3 {
    return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function scale(value: Vector3, factor: number): Vector3 {
    return { x: value.x * factor, y: value.y * factor, z: value.z * factor };
}

function dot(left: Vector3, right: Vector3): number {
    return left.x * right.x + left.y * right.y + left.z * right.z;
}
