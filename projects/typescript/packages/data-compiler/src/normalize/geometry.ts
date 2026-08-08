import {
    ColliderSchema,
    SceneVisualsSchema,
    TransformSchema,
    type Collider,
    type ColliderShape,
    type SceneRenderer,
    type SceneVisuals,
    type Transform,
} from '@neonschedule1/core';

import type { VerifiedAssets } from '#data-compiler/acquisition/assets';
import { Integrity } from '#data-compiler/integrity';
import {
    asObject,
    booleanField,
    color,
    nullableNumberField,
    nullableStringField,
    numberField,
    objectArray,
    stringArrayField,
    stringField,
    vector3,
    type JsonObject,
} from '#data-compiler/json';
import { fileIdForDescriptor, nullableVector3 } from '#data-compiler/normalize/shared';

export function normalizeTransform(value: unknown, path: string): Transform {
    const raw = asObject(value, path);
    return TransformSchema.assert({
        name: stringField(raw, 'name', path),
        path: stringField(raw, 'path', path),
        worldPosition: vector3(raw.position, `${path}.position`),
        localPosition: vector3(raw.localPosition, `${path}.localPosition`),
        worldRotation: vector3(raw.rotation, `${path}.rotation`),
        localScale: vector3(raw.localScale, `${path}.localScale`),
    });
}

export function normalizeCollider(value: unknown, path: string): Collider {
    const raw = asObject(value, path);
    const localSize = nullableVector3(raw, 'localSize', path);
    const radius = nullableNumberField(raw, 'radius', path);
    const height = nullableNumberField(raw, 'height', path);
    const meshId = nullableStringField(raw, 'meshAssetReferenceKey', path);
    return ColliderSchema.assert({
        source: stringField(raw, 'source', path),
        runtimeType: stringField(raw, 'runtimeType', path),
        shape: colliderShape(localSize, radius, height, meshId),
        enabled: booleanField(raw, 'enabled', path),
        isTrigger: booleanField(raw, 'isTrigger', path),
        layer: numberField(raw, 'layer', path),
        layerName: stringField(raw, 'layerName', path),
        tag: stringField(raw, 'tag', path),
        transform: normalizeTransform(raw.transform, `${path}.transform`),
        worldBounds: {
            center: vector3(raw.boundsCenter, `${path}.boundsCenter`),
            size: vector3(raw.boundsSize, `${path}.boundsSize`),
        },
        localCenter: nullableVector3(raw, 'localCenter', path),
        localSize,
        radius,
        height,
        direction: nullableNumberField(raw, 'direction', path),
        meshName: nullableStringField(raw, 'meshName', path),
        meshId,
        meshIsReadable: nullableBooleanField(raw, 'meshIsReadable', path),
        isConvex: nullableBooleanField(raw, 'isConvex', path),
    });
}

export function normalizeSceneVisuals(
    value: unknown,
    path: string,
    assets: VerifiedAssets,
    integrity: Integrity
): SceneVisuals {
    const raw = asObject(value, path);
    const renderers = objectArray(raw.renderers, `${path}.renderers`).map((renderer, index) =>
        normalizeRenderer(renderer, `${path}.renderers[${index}]`, assets, integrity)
    );
    const meshes = objectArray(raw.meshes, `${path}.meshes`).map((mesh, index) => {
        const meshPath = `${path}.meshes[${index}]`;
        return {
            transform: normalizeTransform(mesh.transform, `${meshPath}.transform`),
            meshId: stringField(mesh, 'meshAssetReferenceKey', meshPath),
        };
    });
    return SceneVisualsSchema.assert({ renderers, meshes });
}

export function colliderGeometryKey(collider: Collider): string {
    return JSON.stringify({
        runtimeType: collider.runtimeType,
        transformPath: collider.transform.path,
        worldBounds: collider.worldBounds,
        localCenter: collider.localCenter,
        localSize: collider.localSize,
        radius: collider.radius,
        height: collider.height,
        direction: collider.direction,
        meshId: collider.meshId,
    });
}

function normalizeRenderer(
    raw: JsonObject,
    path: string,
    assets: VerifiedAssets,
    integrity: Integrity
): SceneRenderer {
    return {
        runtimeType: stringField(raw, 'runtimeType', path),
        transform: normalizeTransform(raw.transform, `${path}.transform`),
        enabled: booleanField(raw, 'enabled', path),
        worldBounds: {
            center: vector3(raw.boundsCenter, `${path}.boundsCenter`),
            size: vector3(raw.boundsSize, `${path}.boundsSize`),
        },
        color: raw.color === undefined || raw.color === null ? null : color(raw.color, `${path}.color`),
        spriteFileId: fileIdForDescriptor(raw.sprite, `${path}.sprite`, assets, integrity),
        meshId: nullableStringField(raw, 'meshAssetReferenceKey', path),
        materialIds: [...new Set(stringArrayField(raw, 'materialAssetReferenceKeys', path).filter(Boolean))].sort(),
    };
}

function colliderShape(
    localSize: Transform['localPosition'] | null,
    radius: number | null,
    height: number | null,
    meshId: string | null
): ColliderShape {
    if (meshId !== null) return 'mesh';
    if (height !== null) return 'capsule';
    if (radius !== null) return 'sphere';
    if (localSize !== null) return 'box';
    return 'other';
}

function nullableBooleanField(raw: JsonObject, key: string, path: string): boolean | null {
    const value = raw[key];
    if (value === undefined || value === null) return null;
    if (typeof value !== 'boolean') throw new TypeError(`${path}.${key} must be a boolean or null`);
    return value;
}
