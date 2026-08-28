import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
    canonicalJson,
    DatasetManifestSchema,
    normalizedDatasetIdentityInput,
    PersonSchema,
    PropertySchema,
    ShopSchema,
    WorldLocationCatalogSchema,
    WorldMapSchema,
    type DatasetFile,
    type DatasetManifest,
    type Person,
    type Property,
    type Shop,
    type WorldLocationCatalog,
    type WorldMap,
} from '@neonschedule1/core';

export interface MapPublicationSource {
    readonly manifest: DatasetManifest;
    readonly map: WorldMap;
    readonly locations: WorldLocationCatalog;
    readonly people: readonly Person[];
    readonly properties: readonly Property[];
    readonly shops: readonly Shop[];
}

export async function loadMapPublicationSource(directory: string): Promise<MapPublicationSource> {
    const root = path.resolve(directory);
    const manifest = DatasetManifestSchema.assert(JSON.parse(
        await readFile(path.join(root, 'manifest.json'), 'utf8')
    ) as unknown);
    const identity = createHash('sha256')
        .update(canonicalJson(normalizedDatasetIdentityInput(manifest)), 'utf8')
        .digest('hex');
    if (identity !== manifest.datasetSha256) {
        throw new Error(
            `Normalized dataset identity mismatch: expected ${manifest.datasetSha256}, computed ${identity}`
        );
    }
    const files = new Map(manifest.files.map((file) => [file.path, file]));
    const readDocument = async (relativePath: string): Promise<unknown> => JSON.parse(
        (await verifiedFile(root, files, relativePath)).toString('utf8')
    ) as unknown;

    const map = WorldMapSchema.assert(await readDocument('world/map.json'));
    const locations = WorldLocationCatalogSchema.assert(
        await readDocument('world/locations.json')
    );
    const propertyPaths = manifest.files
        .map((file) => file.path)
        .filter((relativePath) => /^properties\/[^/]+\/summary\.json$/u.test(relativePath))
        .sort((left, right) => left.localeCompare(right));
    const shopPaths = manifest.files
        .map((file) => file.path)
        .filter((relativePath) => /^shops\/[^/]+\.json$/u.test(relativePath))
        .sort((left, right) => left.localeCompare(right));
    const personPaths = manifest.files
        .map((file) => file.path)
        .filter((relativePath) => /^people\/[^/]+\.json$/u.test(relativePath))
        .sort((left, right) => left.localeCompare(right));
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

async function verifiedFile(
    root: string,
    files: ReadonlyMap<string, DatasetFile>,
    relativePath: string
): Promise<Buffer> {
    const expected = files.get(relativePath);
    if (expected === undefined) {
        throw new Error(`Dataset manifest does not contain ${relativePath}`);
    }
    const normalized = path.posix.normalize(relativePath.replaceAll('\\', '/'));
    if (
        normalized === '.' ||
        normalized === '..' ||
        normalized.startsWith('../') ||
        normalized.startsWith('/') ||
        /^[a-zA-Z]:/u.test(normalized)
    ) {
        throw new Error(`Unsafe normalized dataset path: ${relativePath}`);
    }
    const resolved = path.resolve(root, ...normalized.split('/'));
    if (!resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error(`Normalized dataset path escapes its root: ${relativePath}`);
    }
    const content = await readFile(resolved);
    const actualHash = createHash('sha256').update(content).digest('hex');
    if (content.byteLength !== expected.byteLength || actualHash !== expected.sha256) {
        throw new Error(`Normalized dataset file failed integrity verification: ${relativePath}`);
    }
    return content;
}
