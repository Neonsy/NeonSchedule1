import { type } from 'arktype';

export const PublicKeySchema = type(/^[a-z]+-[0-9a-f]{20}$/u);
export const SlugSchema = type(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
export const Vector3Schema = type({ x: 'number', y: 'number', z: 'number' });
