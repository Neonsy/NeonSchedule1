import path from 'node:path';

import { IntegrityReportSchema, type IntegrityCounts, type IntegrityReport } from '@neonschedule1/core';

import { verifyAssets } from '#data-compiler/acquisition/assets';
import { loadAcquisition } from '#data-compiler/acquisition/load';
import { indexUnique, Integrity, requireReferences } from '#data-compiler/integrity';
import { sha256Text, stringField } from '#data-compiler/json';
import {
    normalizeCustomers,
    validateCustomerEnjoymentOracles,
} from '#data-compiler/normalize/customers';
import { validateCustomerOfferOracles } from '#data-compiler/normalize/customer-offers';
import { normalizeEffects } from '#data-compiler/normalize/effects';
import { normalizeItems } from '#data-compiler/normalize/items';
import { normalizeMixing } from '#data-compiler/normalize/mixing';
import { normalizeProduction } from '#data-compiler/normalize/production';
import { normalizeProperties } from '#data-compiler/normalize/properties';
import { normalizeShops } from '#data-compiler/normalize/shops';
import { normalizeVisuals } from '#data-compiler/normalize/visuals';
import { writeDataset, type WrittenDataset } from '#data-compiler/output';

export const NORMALIZER_VERSION = '0.0.16';

const deferredDomains = [
    'buildable-geometry',
    'non-customer-people',
    'property-layouts',
    'relationships',
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
    const productIds = new Set(
        acquisition.report.products.map((product, index) =>
            stringField(product, 'id', `report.products[${index}]`)
        )
    );
    const customers = normalizeCustomers(
        acquisition.report,
        new Set(effects.map((effect) => effect.id)),
        productIds,
        integrity
    );
    validateCustomerEnjoymentOracles(acquisition.report, customers, items, integrity);
    validateCustomerOfferOracles(acquisition.report, customers, items, integrity);
    const production = normalizeProduction(acquisition.report, itemIds, integrity);
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
        customers: customers.customers.length,
        seeds: production.seeds.length,
        shroomSpawns: production.shrooms.length,
        stationRecipes: production.stationRecipes.length,
        ovenTransforms: production.ovenTransforms.length,
        productionStations: production.stations.length,
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
    for (const customer of customers.customers) {
        documents.set(`customers/${entityFileName(customer.id)}`, customer);
    }
    documents.set('customers/catalog.json', customers.catalog);
    documents.set('mixing/rules.json', mixing);
    documents.set('production/catalog.json', production);
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
