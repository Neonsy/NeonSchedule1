import {
    VisualRegistrySchema,
    type MaterialAsset,
    type MaterialTexture,
    type MeshAsset,
    type ShaderProperty,
    type VisualRegistry,
} from '@neonschedule1/core';

import type { VerifiedAssets } from '../acquisition/assets.js';
import type { RawReport } from '../acquisition/types.js';
import { indexUnique, Integrity, requireReferences } from '../integrity.js';
import {
    asArray,
    asObject,
    booleanField,
    color,
    numberField,
    objectArray,
    stringField,
    vector2,
    vector3,
    type JsonObject,
} from '../json.js';
import { fileIdForDescriptor } from './shared.js';

export function normalizeVisuals(report: RawReport, assets: VerifiedAssets, integrity: Integrity): VisualRegistry {
    const meshIndex = indexUnique(
        report.discovery.visualMeshes,
        'assetReferenceKey',
        'report.discovery.visualAssets.meshes',
        integrity
    );
    const materialIndex = indexUnique(
        report.discovery.visualMaterials,
        'assetReferenceKey',
        'report.discovery.visualAssets.materials',
        integrity
    );

    const meshes = [...meshIndex.entries()]
        .map(([id, raw]) => normalizeMesh(id, raw, assets, integrity))
        .sort((left, right) => left.id.localeCompare(right.id));
    const materials = [...materialIndex.entries()]
        .map(([id, raw]) => normalizeMaterial(id, raw, assets, integrity))
        .sort((left, right) => left.id.localeCompare(right.id));

    for (const key of assets.offlineFileIdsByMeshKey.keys()) {
        if (!meshIndex.has(key)) {
            integrity.addError(`Offline manifest references unknown mesh ${JSON.stringify(key)}`);
        }
    }
    validateVisualReferences(report.document, new Set(meshIndex.keys()), new Set(materialIndex.keys()), integrity);

    return VisualRegistrySchema.assert({
        schema: 'neonschedule1-visual-registry-1',
        files: assets.files,
        meshes,
        materials,
    });
}

function normalizeMesh(id: string, raw: JsonObject, assets: VerifiedAssets, integrity: Integrity): MeshAsset {
    const path = `report.discovery.visualAssets.meshes[${JSON.stringify(id)}]`;
    const descriptor = asObject(raw.asset, `${path}.asset`);
    const directFileId = fileIdForDescriptor(descriptor, `${path}.asset`, assets, integrity);
    const offlineFileIds = assets.offlineFileIdsByMeshKey.get(id) ?? [];
    if (directFileId !== null && offlineFileIds.length > 0) {
        integrity.addError(`Mesh ${JSON.stringify(id)} has both direct and offline files`);
    }
    const fileIds = directFileId === null ? [...offlineFileIds] : [directFileId];
    if (fileIds.length === 0) {
        integrity.addError(`Mesh ${JSON.stringify(id)} has no verified geometry file`);
    }
    return {
        id,
        name: stringField(raw, 'name', path),
        isReadable: booleanField(raw, 'isReadable', path),
        vertexCount: numberField(raw, 'vertexCount', path),
        subMeshCount: numberField(raw, 'subMeshCount', path),
        bounds: {
            center: vector3(raw.boundsCenter, `${path}.boundsCenter`),
            size: vector3(raw.boundsSize, `${path}.boundsSize`),
        },
        fileIds: [...new Set(fileIds)].sort(),
    };
}

function normalizeMaterial(id: string, raw: JsonObject, assets: VerifiedAssets, integrity: Integrity): MaterialAsset {
    const path = `report.discovery.visualAssets.materials[${JSON.stringify(id)}]`;
    const textures = objectArray(raw.textures, `${path}.textures`)
        .map((texture, index) => normalizeTexture(texture, `${path}.textures[${index}]`, assets, integrity))
        .sort(
            (left, right) =>
                left.propertyName.localeCompare(right.propertyName) || left.textureId.localeCompare(right.textureId)
        );
    const shaderProperties = objectArray(raw.shaderProperties, `${path}.shaderProperties`)
        .map((property, index) => normalizeShaderProperty(property, `${path}.shaderProperties[${index}]`))
        .sort((left, right) => left.name.localeCompare(right.name));
    return {
        id,
        name: stringField(raw, 'name', path),
        shaderName: stringField(raw, 'shaderName', path),
        renderQueue: numberField(raw, 'renderQueue', path),
        color: raw.color === undefined || raw.color === null ? null : color(raw.color, `${path}.color`),
        mainTextureScale: vector2(raw.mainTextureScale, `${path}.mainTextureScale`),
        mainTextureOffset: vector2(raw.mainTextureOffset, `${path}.mainTextureOffset`),
        textures,
        shaderProperties,
    };
}

function normalizeTexture(
    raw: JsonObject,
    path: string,
    assets: VerifiedAssets,
    integrity: Integrity
): MaterialTexture {
    return {
        propertyName: stringField(raw, 'propertyName', path),
        textureId: stringField(raw, 'assetReferenceKey', path),
        textureName: stringField(raw, 'textureName', path),
        fileId: fileIdForDescriptor(raw.asset, `${path}.asset`, assets, integrity),
    };
}

function normalizeShaderProperty(raw: JsonObject, path: string): ShaderProperty {
    return {
        name: stringField(raw, 'name', path),
        type: stringField(raw, 'type', path),
        value: stringField(raw, 'value', path),
    };
}

function validateVisualReferences(
    document: JsonObject,
    meshIds: ReadonlySet<string>,
    materialIds: ReadonlySet<string>,
    integrity: Integrity
): void {
    const meshReferences: string[] = [];
    const materialReferences: string[] = [];
    const visit = (value: unknown): void => {
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        if (value === null || typeof value !== 'object') return;
        const object = value as JsonObject;
        if (typeof object.meshAssetReferenceKey === 'string' && object.meshAssetReferenceKey !== '') {
            meshReferences.push(object.meshAssetReferenceKey);
        }
        if (Array.isArray(object.materialAssetReferenceKeys)) {
            for (const reference of object.materialAssetReferenceKeys) {
                if (typeof reference !== 'string') {
                    throw new TypeError('materialAssetReferenceKeys must contain only strings');
                }
                if (reference !== '') materialReferences.push(reference);
            }
        }
        Object.values(object).forEach(visit);
    };
    visit(document);
    requireReferences(meshReferences, meshIds, 'mesh', integrity);
    requireReferences(materialReferences, materialIds, 'material', integrity);
    integrity.check(
        'every mesh registry entry has verified geometry',
        meshIds.size > 0,
        'Visual mesh registry is empty'
    );
    integrity.check(
        'every material registry entry is available',
        materialIds.size > 0,
        'Visual material registry is empty'
    );
}
