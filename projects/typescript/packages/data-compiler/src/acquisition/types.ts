import type { JsonObject } from '#data-compiler/json';

export interface RawReport {
    readonly document: JsonObject;
    readonly schemaVersion: string;
    readonly exporterVersion: string;
    readonly gameVersion: string;
    readonly items: JsonObject[];
    readonly products: JsonObject[];
    readonly packaging: JsonObject[];
    readonly additives: JsonObject[];
    readonly soils: JsonObject[];
    readonly recipes: JsonObject[];
    readonly seeds: JsonObject[];
    readonly shroomSpawns: JsonObject[];
    readonly ovenTransforms: JsonObject[];
    readonly productionStations: JsonObject[];
    readonly qualityValues: JsonObject[];
    readonly qualityMechanics: {
        readonly customerQualityMaxEffect: number;
        readonly monetaryValueVariesByQuality: boolean;
        readonly qualityScalars: JsonObject[];
    };
    readonly shops: JsonObject[];
    readonly peopleSources: {
        readonly uniqueCustomerCount: number;
    };
    readonly people: JsonObject[];
    readonly customers: JsonObject[];
    readonly customerConstants: JsonObject;
    readonly mixing: {
        readonly maxProperties: number;
        readonly maxDeltaDifference: number;
        readonly validIngredientCount: number;
        readonly effectCount: number;
        readonly mixerMapEffectCounts: JsonObject;
        readonly defaultProductIds: string[];
        readonly effects: JsonObject[];
        readonly ingredients: JsonObject[];
        readonly mixerMaps: JsonObject[];
        readonly oracles: JsonObject[];
    };
    readonly world: {
        readonly currentOrderLimitMultiplierInLoadedSave: number;
        readonly properties: JsonObject[];
        readonly businesses: JsonObject[];
    };
    readonly discovery: {
        readonly assetDirectory: string;
        readonly assetFileCount: number;
        readonly assetVerificationErrors: unknown[];
        readonly itemPresentations: JsonObject[];
        readonly effectVisuals: JsonObject[];
        readonly buildables: JsonObject[];
        readonly propertyLayouts: JsonObject[];
        readonly shopDetails: JsonObject[];
        readonly visualMeshes: JsonObject[];
        readonly visualMaterials: JsonObject[];
    };
}

export interface RawManifest {
    readonly document: JsonObject;
    readonly schema: string;
    readonly sourceReportSha256: string;
    readonly targetCount: number;
    readonly referenceCount: number;
    readonly processedCount: number;
    readonly entries: JsonObject[];
}

export interface LoadedAcquisition {
    readonly root: string;
    readonly exportsDirectory: string;
    readonly reportPath: string;
    readonly reportSha256: string;
    readonly manifestPath: string;
    readonly manifestDirectory: string;
    readonly manifestSha256: string;
    readonly report: RawReport;
    readonly manifest: RawManifest;
}
