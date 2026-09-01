import { type } from 'arktype';

const Sha256Schema = type(/^[0-9a-f]{64}$/u);
const PropertyCodeSchema = type(/^[a-z0-9][a-z0-9-]{0,63}$/u);

export const PropertyCaptureViewSchema = type(
    "'north-east' | 'south-east' | 'south-west' | 'north-west'"
);
export type PropertyCaptureView = typeof PropertyCaptureViewSchema.infer;

export const ProcessedPropertyAssetSchema = type({
    propertyCode: PropertyCodeSchema,
    captureView: PropertyCaptureViewSchema,
    path: 'string',
    sourceSha256: Sha256Schema,
    outputSha256: Sha256Schema,
    width: 'number',
    height: 'number',
    treatmentId: 'string',
    source: {
        dtype: 'string',
        channels: 'number',
        alphaCoverage: 'number',
    },
    output: {
        dtype: 'string',
        channels: 'number',
        alphaCoverage: 'number',
    },
    sourceCrop: {
        left: 'number',
        top: 'number',
        width: 'number',
        height: 'number',
    },
});
export type ProcessedPropertyAsset = typeof ProcessedPropertyAssetSchema.infer;

export const ProcessedPropertyProvenanceSchema = type({
    schema: "'neonschedule1-processed-property-provenance-1'",
    opencvVersion: 'string',
    source: {
        gameVersion: 'string',
        datasetSha256: Sha256Schema,
        exporterVersion: 'string',
        requestId: 'string',
        requestSha256: Sha256Schema,
        responseSha256: Sha256Schema,
    },
    operations: 'string[]',
    parameters: {
        sourceBlend: 'number',
        targetBlend: 'number',
        edgeBlend: 'number',
        cannyLow: 'number',
        cannyHigh: 'number',
        outputWidth: 'number',
        outputHeight: 'number',
        canvasMargin: 'number',
        cropPaddingRatio: 'number',
        pngCompression: 'number',
    },
    assets: ProcessedPropertyAssetSchema.array(),
}).onDeepUndeclaredKey('reject');
export type ProcessedPropertyProvenance = typeof ProcessedPropertyProvenanceSchema.infer;
