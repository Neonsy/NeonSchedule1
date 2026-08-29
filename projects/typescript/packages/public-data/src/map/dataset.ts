import {
    PersonSchema,
    PropertySchema,
    ShopSchema,
    WorldLocationCatalogSchema,
    WorldMapSchema,
    type DatasetManifest,
    type Person,
    type Property,
    type Shop,
    type WorldLocationCatalog,
    type WorldMap,
} from '@neonschedule1/core';

import { openNormalizedDataset } from '#public-data/normalized-dataset';

export interface MapPublicationSource {
    readonly manifest: DatasetManifest;
    readonly map: WorldMap;
    readonly locations: WorldLocationCatalog;
    readonly people: readonly Person[];
    readonly properties: readonly Property[];
    readonly shops: readonly Shop[];
}

export async function loadMapPublicationSource(directory: string): Promise<MapPublicationSource> {
    const { manifest, paths, readDocument } = await openNormalizedDataset(directory);

    const map = WorldMapSchema.assert(await readDocument('world/map.json'));
    const locations = WorldLocationCatalogSchema.assert(
        await readDocument('world/locations.json')
    );
    const propertyPaths = paths(/^properties\/[^/]+\/summary\.json$/u);
    const shopPaths = paths(/^shops\/[^/]+\.json$/u);
    const personPaths = paths(/^people\/[^/]+\.json$/u);
    const properties = await Promise.all(propertyPaths.map(async (relativePath) =>
        PropertySchema.assert(await readDocument(relativePath))
    ));
    const shops = await Promise.all(shopPaths.map(async (relativePath) =>
        ShopSchema.assert(await readDocument(relativePath))
    ));
    const people: Person[] = [];
    for (const relativePath of personPaths) {
        const document = await readDocument(relativePath);
        if (
            document !== null &&
            typeof document === 'object' &&
            !Array.isArray(document) &&
            (document as { schema?: unknown }).schema === 'neonschedule1-person-1'
        ) {
            people.push(PersonSchema.assert(document));
        }
    }
    if (properties.length !== manifest.counts.properties) {
        throw new Error(
            `Expected ${manifest.counts.properties} properties, loaded ${properties.length}`
        );
    }
    if (shops.length !== manifest.counts.shops) {
        throw new Error(`Expected ${manifest.counts.shops} shops, loaded ${shops.length}`);
    }
    if (locations.locations.length !== manifest.counts.worldLocations) {
        throw new Error(
            `Expected ${manifest.counts.worldLocations} world locations, loaded ` +
                `${locations.locations.length}`
        );
    }
    if (locations.services.length !== manifest.counts.mapServices) {
        throw new Error(
            `Expected ${manifest.counts.mapServices} map services, loaded ` +
                `${locations.services.length}`
        );
    }
    return { manifest, map, locations, people, properties, shops };
}
