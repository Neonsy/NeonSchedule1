import { type } from 'arktype';

export const IntegrityCountsSchema = type({
    items: 'number',
    effects: 'number',
    mixingMaps: 'number',
    mixingOracleCases: 'number',
    shops: 'number',
    properties: 'number',
    directAssetFiles: 'number',
    offlineAssetFiles: 'number',
    meshAssets: 'number',
    materialAssets: 'number',
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
