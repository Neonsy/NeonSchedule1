import { type } from 'arktype';

const Sha256Schema = type(/^[0-9a-f]{64}$/u);

export const PublicMapIdSchema = type("'hyland-point' | 'tutorial-area'");
export type PublicMapId = typeof PublicMapIdSchema.infer;

export const PublicMapMarkerKindSchema = type(
    "'atm' | 'barbershop' | 'blackjack-table' | 'cash-for-trash' | 'customer' | 'dead-drop' | 'dealer' | 'parking' | 'pawn-shop' | 'pay-phone' | 'property' | 'shop' | 'skateboard-seller' | 'slot-machine' | 'supplier-meetup' | 'supplier-stash' | 'tattoo-shop' | 'vehicle-dealership' | 'vehicle-repaint' | 'vending-machine'"
);
export type PublicMapMarkerKind = typeof PublicMapMarkerKindSchema.infer;

export const MapPixelPointSchema = type({ x: 'number', y: 'number' });
export type MapPixelPoint = typeof MapPixelPointSchema.infer;

export const PublicWorldPointSchema = type({ x: 'number', z: 'number' });
export type PublicWorldPoint = typeof PublicWorldPointSchema.infer;

export const ProcessedMapAssetSchema = type({
    mapId: PublicMapIdSchema,
    path: 'string',
    sourceSha256: Sha256Schema,
    outputSha256: Sha256Schema,
    width: 'number',
    height: 'number',
    treatmentId: 'string',
});
export type ProcessedMapAsset = typeof ProcessedMapAssetSchema.infer;

export const ProcessedMapProvenanceAssetSchema = type({
    mapId: PublicMapIdSchema,
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
});
export type ProcessedMapProvenanceAsset = typeof ProcessedMapProvenanceAssetSchema.infer;

export const ProcessedMapProvenanceSchema = type({
    schema: "'neonschedule1-processed-map-provenance-1'",
    opencvVersion: 'string',
    operations: 'string[]',
    parameters: {
        sourceBlend: 'number',
        targetBlend: 'number',
        edgeBlend: 'number',
        cannyLow: 'number',
        cannyHigh: 'number',
        pngCompression: 'number',
    },
    assets: ProcessedMapProvenanceAssetSchema.array(),
}).onDeepUndeclaredKey('reject');
export type ProcessedMapProvenance = typeof ProcessedMapProvenanceSchema.infer;

export const PublicMapAssetSchema = type({
    id: PublicMapIdSchema,
    label: 'string',
    markerCoverage: "'mapped' | 'none'",
    image: ProcessedMapAssetSchema,
});
export type PublicMapAsset = typeof PublicMapAssetSchema.infer;

export const PublicMapRegionSchema = type({
    mapId: "'hyland-point'",
    id: 'string',
    label: 'string',
    unlockedByDefault: 'boolean',
    rankRequirement: 'string | null',
    polygon: MapPixelPointSchema.array(),
    source: {
        regionId: 'string',
    },
});
export type PublicMapRegion = typeof PublicMapRegionSchema.infer;

export const PublicMapMarkerKindLabelSchema = type({
    kind: PublicMapMarkerKindSchema,
    label: 'string',
});
export type PublicMapMarkerKindLabel = typeof PublicMapMarkerKindLabelSchema.infer;

export const PublicMapMarkerPositionSchema = type({
    state: "'default' | 'potential-dealer' | 'dealer'",
    label: 'string | null',
    regionId: 'string | null',
    position: MapPixelPointSchema,
    worldPosition: PublicWorldPointSchema,
});
export type PublicMapMarkerPosition = typeof PublicMapMarkerPositionSchema.infer;

export const PublicMapMarkerSchema = type({
    mapId: "'hyland-point'",
    id: 'string',
    kind: PublicMapMarkerKindSchema,
    label: 'string',
    description: 'string | null',
    positions: PublicMapMarkerPositionSchema.array(),
    source: {
        family: "'property' | 'shop' | 'person' | 'service'",
        key: 'string',
    },
});
export type PublicMapMarker = typeof PublicMapMarkerSchema.infer;

export const PublicMapOmissionSchema = type({
    sourceFamily: "'world.locations.poi' | 'world.locations.property-mirror' | 'world.locations.shop-mirror' | 'world.locations.service-mirror' | 'shops.unpositioned' | 'world.services.visual-only'",
    count: 'number',
    reason: 'string',
});
export type PublicMapOmission = typeof PublicMapOmissionSchema.infer;

export const MapPublicationInputSchema = type({
    schema: "'neonschedule1-map-publication-input-1'",
    compatibility: {
        gameVersion: 'string',
        normalizerVersion: 'string',
        datasetSha256: Sha256Schema,
    },
    maps: PublicMapAssetSchema.array(),
    canvas: {
        width: 'number',
        height: 'number',
    },
    projection: {
        mapId: "'hyland-point'",
        origin: PublicWorldPointSchema,
        edge: PublicWorldPointSchema,
        mapDimensions: 'number',
        conversionFactor: 'number',
    },
    regions: PublicMapRegionSchema.array(),
    markerKinds: PublicMapMarkerKindLabelSchema.array(),
    markers: PublicMapMarkerSchema.array(),
    omissions: PublicMapOmissionSchema.array(),
}).onDeepUndeclaredKey('reject');
export type MapPublicationInput = typeof MapPublicationInputSchema.infer;
