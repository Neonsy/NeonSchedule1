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
    readonly productionLogistics: JsonObject;
    readonly qualityValues: JsonObject[];
    readonly qualityMechanics: {
        readonly customerQualityMaxEffect: number;
        readonly monetaryValueVariesByQuality: boolean;
        readonly qualityScalars: JsonObject[];
    };
    readonly shops: JsonObject[];
    readonly peopleSources: {
        readonly npcRegistryCount: number;
        readonly lockedCustomerCount: number;
        readonly unlockedCustomerCount: number;
        readonly uniquePersonCount: number;
        readonly uniqueCustomerCount: number;
        readonly directedConnectionCount: number;
        readonly uniqueRelationshipEdgeCount: number;
    };
    readonly people: JsonObject[];
    readonly relationshipEdges: JsonObject[];
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
        readonly dealerMechanics: JsonObject;
        readonly dealers: JsonObject[];
        readonly suppliers: JsonObject[];
        readonly properties: JsonObject[];
        readonly businesses: JsonObject[];
        readonly employeeTypes: JsonObject[];
        readonly ranks: JsonObject[];
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
        readonly people: JsonObject[];
        readonly npcSchedules: JsonObject[];
        readonly uniquePersonArchetypeCount: number;
        readonly scheduleManagerCount: number;
        readonly scheduleActionCount: number;
        readonly visualMeshes: JsonObject[];
        readonly visualMaterials: JsonObject[];
        readonly map: JsonObject;
        readonly navigation: JsonObject;
        readonly locations: JsonObject[];
        readonly mapServices: JsonObject[];
        readonly timedAccessZones: JsonObject[];
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
