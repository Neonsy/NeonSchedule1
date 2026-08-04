import { type } from 'arktype';

import { BoundsSchema, ColorSchema, Vector2Schema } from '#core/data/common';

export const AssetFileSchema = type({
    id: 'string',
    sha256: 'string',
    byteLength: 'number',
    mediaType: 'string',
    sourcePaths: 'string[]',
});
export type AssetFile = typeof AssetFileSchema.infer;

export const MeshAssetSchema = type({
    id: 'string',
    name: 'string',
    isReadable: 'boolean',
    vertexCount: 'number',
    subMeshCount: 'number',
    bounds: BoundsSchema,
    fileIds: 'string[]',
});
export type MeshAsset = typeof MeshAssetSchema.infer;

export const MaterialTextureSchema = type({
    propertyName: 'string',
    textureId: 'string',
    textureName: 'string',
    fileId: 'string | null',
});
export type MaterialTexture = typeof MaterialTextureSchema.infer;

export const ShaderPropertySchema = type({
    name: 'string',
    type: 'string',
    value: 'string',
});
export type ShaderProperty = typeof ShaderPropertySchema.infer;

export const MaterialAssetSchema = type({
    id: 'string',
    name: 'string',
    shaderName: 'string',
    renderQueue: 'number',
    color: ColorSchema.or('null'),
    mainTextureScale: Vector2Schema,
    mainTextureOffset: Vector2Schema,
    textures: MaterialTextureSchema.array(),
    shaderProperties: ShaderPropertySchema.array(),
});
export type MaterialAsset = typeof MaterialAssetSchema.infer;

export const VisualRegistrySchema = type({
    schema: "'neonschedule1-visual-registry-1'",
    files: AssetFileSchema.array(),
    meshes: MeshAssetSchema.array(),
    materials: MaterialAssetSchema.array(),
});
export type VisualRegistry = typeof VisualRegistrySchema.infer;
