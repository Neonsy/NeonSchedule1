import { createHash } from 'node:crypto';

import type { Color, Vector2, Vector3 } from '@neonschedule1/core';

export type JsonObject = Record<string, unknown>;

export function asObject(value: unknown, path: string): JsonObject {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${path} must be an object`);
    }
    return value as JsonObject;
}

export function asArray(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value)) {
        throw new TypeError(`${path} must be an array`);
    }
    return value;
}

export function objectArray(value: unknown, path: string): JsonObject[] {
    return asArray(value, path).map((entry, index) => asObject(entry, `${path}[${index}]`));
}

export function stringField(object: JsonObject, key: string, path: string): string {
    const value = object[key];
    if (typeof value !== 'string') {
        throw new TypeError(`${path}.${key} must be a string`);
    }
    return value;
}

export function nullableStringField(object: JsonObject, key: string, path: string): string | null {
    const value = object[key];
    if (value === null || value === '' || value === undefined) {
        return null;
    }
    if (typeof value !== 'string') {
        throw new TypeError(`${path}.${key} must be a string or null`);
    }
    return value;
}

export function numberField(object: JsonObject, key: string, path: string): number {
    const value = object[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`${path}.${key} must be a finite number`);
    }
    return value;
}

export function nullableNumberField(object: JsonObject, key: string, path: string): number | null {
    const value = object[key];
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`${path}.${key} must be a finite number or null`);
    }
    return value;
}

export function booleanField(object: JsonObject, key: string, path: string): boolean {
    const value = object[key];
    if (typeof value !== 'boolean') {
        throw new TypeError(`${path}.${key} must be a boolean`);
    }
    return value;
}

export function stringArrayField(object: JsonObject, key: string, path: string): string[] {
    return asArray(object[key], `${path}.${key}`).map((value, index) => {
        if (typeof value !== 'string') {
            throw new TypeError(`${path}.${key}[${index}] must be a string`);
        }
        return value;
    });
}

export function vector2(value: unknown, path: string): Vector2 {
    const object = asObject(value, path);
    return { x: numberField(object, 'x', path), y: numberField(object, 'y', path) };
}

export function vector3(value: unknown, path: string): Vector3 {
    const object = asObject(value, path);
    return {
        x: numberField(object, 'x', path),
        y: numberField(object, 'y', path),
        z: numberField(object, 'z', path),
    };
}

export function color(value: unknown, path: string): Color {
    const object = asObject(value, path);
    return {
        r: numberField(object, 'r', path),
        g: numberField(object, 'g', path),
        b: numberField(object, 'b', path),
        a: numberField(object, 'a', path),
        htmlRgba: stringField(object, 'htmlRgba', path),
    };
}

export function sha256Text(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}
