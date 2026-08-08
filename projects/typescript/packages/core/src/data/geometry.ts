import { type } from 'arktype';

import { BoundsSchema, ColorSchema, Vector3Schema } from '#core/data/common';

export const TransformSchema = type({
    name: 'string',
    path: 'string',
    worldPosition: Vector3Schema,
    localPosition: Vector3Schema,
    worldRotation: Vector3Schema,
    localScale: Vector3Schema,
});
export type Transform = typeof TransformSchema.infer;

export const ColliderShapeSchema = type("'box' | 'capsule' | 'mesh' | 'sphere' | 'other'");
export type ColliderShape = typeof ColliderShapeSchema.infer;

export const ColliderSchema = type({
    source: 'string',
    runtimeType: 'string',
    shape: ColliderShapeSchema,
    enabled: 'boolean',
    isTrigger: 'boolean',
    layer: 'number',
    layerName: 'string',
    tag: 'string',
    transform: TransformSchema,
    worldBounds: BoundsSchema,
    localCenter: Vector3Schema.or('null'),
    localSize: Vector3Schema.or('null'),
    radius: 'number | null',
    height: 'number | null',
    direction: 'number | null',
    meshName: 'string | null',
    meshId: 'string | null',
    meshIsReadable: 'boolean | null',
    isConvex: 'boolean | null',
});
export type Collider = typeof ColliderSchema.infer;

export const SceneRendererSchema = type({
    runtimeType: 'string',
    transform: TransformSchema,
    enabled: 'boolean',
    worldBounds: BoundsSchema,
    color: ColorSchema.or('null'),
    spriteFileId: 'string | null',
    meshId: 'string | null',
    materialIds: 'string[]',
});
export type SceneRenderer = typeof SceneRendererSchema.infer;

export const MeshInstanceSchema = type({
    transform: TransformSchema,
    meshId: 'string',
});
export type MeshInstance = typeof MeshInstanceSchema.infer;

export const SceneVisualsSchema = type({
    renderers: SceneRendererSchema.array(),
    meshes: MeshInstanceSchema.array(),
});
export type SceneVisuals = typeof SceneVisualsSchema.infer;
