import path from 'node:path';

import { IntegrityReportSchema, type IntegrityCounts, type IntegrityReport } from '@neonschedule1/core';

import { verifyAssets } from './acquisition/assets.js';
import { loadAcquisition } from './acquisition/load.js';
import { indexUnique, Integrity, requireReferences } from './integrity.js';
import { sha256Text } from './json.js';
import { normalizeEffects } from './normalize/effects.js';
import { normalizeItems } from './normalize/items.js';
import { normalizeMixing } from './normalize/mixing.js';
import { normalizeProperties } from './normalize/properties.js';
import { normalizeShops } from './normalize/shops.js';
import { normalizeVisuals } from './normalize/visuals.js';
import { writeDataset, type WrittenDataset } from './output.js';

export const NORMALIZER_VERSION = '0.0.6';

const deferredDomains = [
    'buildable-geometry',
    'people',
    'property-layouts',
    'relationships',
    'seeds-and-production',
    'world-and-navigation',
] as const;

export async function compileDataset(acquisitionPath: string, outputRoot?: string): Promise<WrittenDataset> {
    const acquisition = await loadAcquisition(acquisitionPath);
    const integrity = new Integrity();
    const assets = await verifyAssets(acquisition, integrity);
    const effects = normalizeEffects(acquisition.report, integrity);
    const items = normalizeItems(acquisition.report, assets, integrity);
    const mixing = normalizeMixing(acquisition.report, effects, items, integrity);
    const itemIds = new Set(items.map((item) => item.id));
    const shops = normalizeShops(acquisition.report, itemIds, integrity);
    const properties = normalizeProperties(acquisition.report, integrity);
    const visuals = normalizeVisuals(acquisition.report, assets, integrity);

    const buildables = indexUnique(
        acquisition.report.discovery.buildables,
        'itemId',
        'report.discovery.buildables',
        integrity
    );
    requireReferences(buildables.keys(), itemIds, 'buildable', integrity);
    integrity.throwIfInvalid();

    const counts: IntegrityCounts = {
        items: items.length,
        effects: effects.length,
        mixingMaps: mixing.maps.length,
        mixingOracleCases: acquisition.report.mixing.oracles.length,
        shops: shops.length,
        properties: properties.length,
        directAssetFiles: assets.directFileCount,
        offlineAssetFiles: assets.offlineFileCount,
        meshAssets: visuals.meshes.length,
        materialAssets: visuals.materials.length,
    };
    const report = IntegrityReportSchema.assert({
        schema: 'neonschedule1-integrity-report-1',
        sourceReportSha256: acquisition.reportSha256,
        sourceManifestSha256: acquisition.manifestSha256,
        counts,
        checks: [...integrity.checks].sort(),
        deferredDomains: [...deferredDomains],
        errors: [],
    } satisfies IntegrityReport);

    const documents = new Map<string, unknown>();
    for (const effect of effects) documents.set(`effects/${entityFileName(effect.id)}`, effect);
    for (const item of items) documents.set(`items/${entityFileName(item.id)}`, item);
    for (const shop of shops) documents.set(`shops/${entityFileName(shop.code)}`, shop);
    for (const property of properties) {
        documents.set(`properties/${entityDirectoryName(property.code)}/summary.json`, property);
    }
    documents.set('mixing/rules.json', mixing);
    documents.set('visuals/assets.json', visuals);
    documents.set('reports/integrity.json', report);

    return writeDataset({
        outputRoot: outputRoot === undefined ? defaultOutputRoot(acquisition.root) : path.resolve(outputRoot),
        normalizerVersion: NORMALIZER_VERSION,
        gameVersion: acquisition.report.gameVersion,
        sourceReportSha256: acquisition.reportSha256,
        sourceManifestSha256: acquisition.manifestSha256,
        counts,
        deferredDomains,
        documents,
    });
}

function defaultOutputRoot(acquisitionRoot: string): string {
    let current = path.resolve(acquisitionRoot);
    while (true) {
        if (path.basename(current).toLowerCase() === 'acquisitions') {
            return path.join(path.dirname(current), 'normalized');
        }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    throw new Error('Could not infer normalized output root. Pass --output explicitly.');
}

function entityFileName(id: string): string {
    return `${entityDirectoryName(id)}.json`;
}

function entityDirectoryName(id: string): string {
    const readable = encodeURIComponent(id).replaceAll('%', '~');
    return `${readable}-${sha256Text(id).slice(0, 12)}`;
}
