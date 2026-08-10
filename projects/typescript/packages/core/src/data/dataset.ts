import { type } from 'arktype';

export const IntegrityCountsSchema = type({
    items: 'number',
    effects: 'number',
    mixingMaps: 'number',
    mixingOracleCases: 'number',
    shops: 'number',
    properties: 'number',
    customers: 'number',
    seeds: 'number',
    shroomSpawns: 'number',
    stationRecipes: 'number',
    ovenTransforms: 'number',
    productionStations: 'number',
    directAssetFiles: 'number',
    offlineAssetFiles: 'number',
    meshAssets: 'number',
    materialAssets: 'number',
    'buildables?': 'number',
    'propertyLayouts?': 'number',
    'worldRegions?': 'number',
    'worldLocations?': 'number',
    'mapServices?': 'number',
    'timedAccessZones?': 'number',
    'navigationSamples?': 'number',
    'navigationEdges?': 'number',
    'rankLevels?': 'number',
});
export type IntegrityCounts = typeof IntegrityCountsSchema.infer;

export const IntegrityReportSchema = type({
    schema: "'neonschedule1-integrity-report-1'",
    sourceReportSha256: 'string',
    sourceManifestSha256: 'string',
    counts: IntegrityCountsSchema,
    checks: 'string[]',
    deferredDomains: 'string[]',
    errors: 'string[]',
});
export type IntegrityReport = typeof IntegrityReportSchema.infer;

export const DatasetFileSchema = type({
    path: 'string',
    sha256: 'string',
    byteLength: 'number',
});
export type DatasetFile = typeof DatasetFileSchema.infer;

export const DatasetManifestSchema = type({
    schema: "'neonschedule1-normalized-data-1'",
    normalizerVersion: 'string',
    gameVersion: 'string',
    sourceReportSha256: 'string',
    sourceManifestSha256: 'string',
    datasetSha256: 'string',
    files: DatasetFileSchema.array(),
    counts: IntegrityCountsSchema,
    deferredDomains: 'string[]',
});
export type DatasetManifest = typeof DatasetManifestSchema.infer;
export type NormalizedDatasetIdentityInput = Omit<DatasetManifest, 'datasetSha256'>;

export function normalizedDatasetIdentityInput(
    manifest: NormalizedDatasetIdentityInput
): NormalizedDatasetIdentityInput {
    return {
        schema: manifest.schema,
        normalizerVersion: manifest.normalizerVersion,
        gameVersion: manifest.gameVersion,
        sourceReportSha256: manifest.sourceReportSha256,
        sourceManifestSha256: manifest.sourceManifestSha256,
        files: manifest.files,
        counts: manifest.counts,
        deferredDomains: manifest.deferredDomains,
    };
}
