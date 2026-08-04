import { type } from 'arktype';

export const Vector2Schema = type({ x: 'number', y: 'number' });
export type Vector2 = typeof Vector2Schema.infer;

export const Vector3Schema = type({ x: 'number', y: 'number', z: 'number' });
export type Vector3 = typeof Vector3Schema.infer;

export const ColorSchema = type({
    r: 'number',
    g: 'number',
    b: 'number',
    a: 'number',
    htmlRgba: 'string',
});
export type Color = typeof ColorSchema.infer;

export const BoundsSchema = type({
    center: Vector3Schema,
    size: Vector3Schema,
});
export type Bounds = typeof BoundsSchema.infer;
