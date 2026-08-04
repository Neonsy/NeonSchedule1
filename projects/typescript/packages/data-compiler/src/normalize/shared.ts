import path from 'node:path';

import type { Vector3 } from '@neonschedule1/core';

import type { VerifiedAssets } from '../acquisition/assets.js';
import { Integrity } from '../integrity.js';
import { asObject, stringField, vector3, type JsonObject } from '../json.js';

export function fileIdForDescriptor(
    descriptorValue: unknown,
    descriptorPath: string,
    assets: VerifiedAssets,
    integrity: Integrity
): string | null {
    if (descriptorValue === undefined || descriptorValue === null) return null;
    const descriptor = asObject(descriptorValue, descriptorPath);
    const relativePath = stringField(descriptor, 'relativePath', descriptorPath);
    if (relativePath === '') return null;
    const normalized = path.posix.normalize(relativePath.replaceAll('\\', '/'));
    const fileId = assets.directFileIdByPath.get(normalized);
    if (fileId === undefined) {
        integrity.addError(`${descriptorPath} references unverified asset ${JSON.stringify(relativePath)}`);
        return null;
    }
    return fileId;
}

export function optionalVector3(object: JsonObject, key: string, objectPath: string): Vector3[] {
    const value = object[key];
    if (!Array.isArray(value)) {
        throw new TypeError(`${objectPath}.${key} must be an array`);
    }
    return value.map((entry, index) => vector3(entry, `${objectPath}.${key}[${index}]`));
}

export function nullableVector3(object: JsonObject, key: string, objectPath: string): Vector3 | null {
    const value = object[key];
    return value === undefined || value === null ? null : vector3(value, `${objectPath}.${key}`);
}
