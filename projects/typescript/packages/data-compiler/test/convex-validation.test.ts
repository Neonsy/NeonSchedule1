import { describe, expect, it } from 'vitest';

import {
    compareConvexValidation,
    createConvexValidationRequest,
    parseConvexValidationResponse,
} from '#data-compiler/validation/convex-surface';
import type {
    Collider,
    DatasetManifest,
    PropertyLayout,
    Transform,
    Vector3,
} from '@neonschedule1/core';

describe('native convex validation', () => {
    it('covers every candidate face and accepts matching Unity raycasts', () => {
        const request = createConvexValidationRequest(manifest(), [layout()]);
        const response = matchingResponse(request);

        const report = compareConvexValidation(
            request,
            response,
            'b'.repeat(64),
            'c'.repeat(64)
        );

        expect(request.cases).toHaveLength(1);
        expect(request.cases[0]!.rays).toHaveLength(6);
        expect(report).toEqual(expect.objectContaining({
            caseCount: 1,
            rayCount: 6,
            maximumPointError: 0,
            minimumNormalDot: 1,
            cookingOptions: [{ value: 30, name: 'Everything', caseCount: 1 }],
        }));
    });

    it('rejects a cooked hull outside the surface hit tolerance', () => {
        const request = createConvexValidationRequest(manifest(), [layout()]);
        const source = matchingResponse(request);
        const firstCase = source.cases[0]!;
        const firstRay = firstCase.rays[0]!;
        const response = {
            ...source,
            cases: [{
                ...firstCase,
                rays: [{
                    ...firstRay,
                    point: { ...firstRay.point!, x: firstRay.point!.x + 0.01 },
                }, ...firstCase.rays.slice(1)],
            }],
        };

        expect(() => compareConvexValidation(
            request,
            response,
            'b'.repeat(64),
            'c'.repeat(64)
        )).toThrow('differs from the candidate');
    });
});

function matchingResponse(request: ReturnType<typeof createConvexValidationRequest>) {
    return parseConvexValidationResponse({
        schema: 'neonschedule1-native-convex-validation-response-1',
        exporterVersion: '0.0.10',
        evaluatedAtUtc: '2026-08-08T00:00:00Z',
        gameVersion: request.dataset.gameVersion,
        requestSha256: 'b'.repeat(64),
        cases: request.cases.map((item) => ({
            id: item.id,
            propertyCode: item.propertyCode,
            surfaceId: item.surfaceId,
            colliderPath: item.colliderPath,
            meshName: item.meshName,
            cookingOptions: 30,
            cookingOptionsName: 'Everything',
            rays: item.rays.map((ray) => ({
                id: ray.id,
                hit: true,
                point: ray.expectedPoint,
                normal: scale(ray.direction, -1),
                distance: ray.maxDistance / 2,
            })),
        })),
    });
}

function manifest(): DatasetManifest {
    return {
        schema: 'neonschedule1-normalized-data-1',
        normalizerVersion: '0.0.25',
        gameVersion: '0.4.6f12',
        sourceReportSha256: '0'.repeat(64),
        sourceManifestSha256: '1'.repeat(64),
        datasetSha256: 'a'.repeat(64),
        files: [],
        counts: {
            items: 0,
            effects: 0,
            mixingMaps: 0,
            mixingOracleCases: 0,
            shops: 0,
            properties: 1,
            customers: 0,
            seeds: 0,
            shroomSpawns: 0,
            stationRecipes: 0,
            ovenTransforms: 0,
            productionStations: 0,
            directAssetFiles: 0,
            offlineAssetFiles: 0,
            meshAssets: 1,
            materialAssets: 0,
            propertyLayouts: 1,
        },
        deferredDomains: [],
    };
}

function layout(): PropertyLayout {
    const source = collider();
    return {
        schema: 'neonschedule1-property-layout-4',
        propertyCode: 'warehouse',
        propertyName: 'Warehouse',
        worldPosition: vector(0, 0, 0),
        worldRotation: vector(0, 0, 0),
        spawnPoint: transform('Spawn'),
        interiorSpawnPoint: transform('InteriorSpawn'),
        npcSpawnPoint: transform('NpcSpawn'),
        boundingBox: null,
        boundaryColliders: [],
        fixedColliders: [],
        surfaceMeshes: [{
            meshId: 'mesh:cube',
            vertices: [
                vector(-1, -1, -1), vector(-1, -1, 1),
                vector(-1, 1, -1), vector(-1, 1, 1),
                vector(1, -1, -1), vector(1, -1, 1),
                vector(1, 1, -1), vector(1, 1, 1),
            ],
            triangles: [0, 1, 2],
            bounds: { center: vector(0, 0, 0), size: vector(2, 2, 2) },
        }],
        surfaces: [{
            id: 'surface-a',
            sourceGuid: 'surface-a',
            type: 'Wall',
            transform: transform('Surface'),
            container: transform('Container'),
            validFaces: ['Front'],
            colliders: [source],
        }],
        proceduralTiles: [],
        loadingDocks: [],
        grids: [],
        visuals: { renderers: [], meshes: [] },
    };
}

function collider(): Collider {
    return {
        source: 'property-surface',
        runtimeType: 'UnityEngine.MeshCollider',
        shape: 'mesh',
        enabled: true,
        isTrigger: false,
        layer: 0,
        layerName: 'Default',
        tag: 'Untagged',
        transform: transform('Surface/Collider'),
        worldScale: vector(1, 1, 1),
        worldBasis: {
            right: vector(1, 0, 0),
            up: vector(0, 1, 0),
            forward: vector(0, 0, 1),
        },
        worldBounds: { center: vector(0, 0, 0), size: vector(2, 2, 2) },
        localCenter: null,
        localSize: null,
        radius: null,
        height: null,
        direction: null,
        meshName: 'Cube',
        meshId: 'mesh:cube',
        meshIsReadable: false,
        isConvex: true,
    };
}

function transform(path: string): Transform {
    return {
        name: path,
        path,
        worldPosition: vector(0, 0, 0),
        localPosition: vector(0, 0, 0),
        worldRotation: vector(0, 0, 0),
        localScale: vector(1, 1, 1),
    };
}

function scale(value: Vector3, factor: number): Vector3 {
    return { x: value.x * factor, y: value.y * factor, z: value.z * factor };
}

function vector(x: number, y: number, z: number): Vector3 {
    return { x, y, z };
}
