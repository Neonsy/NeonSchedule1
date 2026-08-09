import path from 'node:path';

import { IntegrityReportSchema, type IntegrityCounts, type IntegrityReport } from '@neonschedule1/core';

import { verifyAssets } from '#data-compiler/acquisition/assets';
import { loadAcquisition } from '#data-compiler/acquisition/load';
import { Integrity } from '#data-compiler/integrity';
import { sha256Text, stringField } from '#data-compiler/json';
import {
    normalizeCustomers,
    validateCustomerEnjoymentOracles,
} from '#data-compiler/normalize/customers';
import { validateCustomerOfferOracles } from '#data-compiler/normalize/customer-offers';
import { normalizeBuildables } from '#data-compiler/normalize/buildables';
import { normalizeEffects } from '#data-compiler/normalize/effects';
import { validateEmployeeRoutes } from '#data-compiler/normalize/employee-routes';
import { normalizeItems } from '#data-compiler/normalize/items';
import { normalizeMixing } from '#data-compiler/normalize/mixing';
import { normalizePeople } from '#data-compiler/normalize/people';
import { normalizeProduction } from '#data-compiler/normalize/production';
import { normalizeProductionLogistics } from '#data-compiler/normalize/production-logistics';
import { normalizeProperties } from '#data-compiler/normalize/properties';
import { normalizePropertyLayouts } from '#data-compiler/normalize/property-layouts';
import { normalizeShops } from '#data-compiler/normalize/shops';
import { normalizeTrade } from '#data-compiler/normalize/trade';
import { normalizeVisuals } from '#data-compiler/normalize/visuals';
import { normalizeWorld } from '#data-compiler/normalize/world';
import { writeDataset, type WrittenDataset } from '#data-compiler/output';

export const NORMALIZER_VERSION = '0.0.29';

const deferredDomains = [] as const;

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
    const productionLogistics = normalizeProductionLogistics(
        acquisition.report,
        itemIds,
        integrity
    );
    const shops = normalizeShops(acquisition.report, itemIds, integrity);
    const properties = normalizeProperties(acquisition.report, integrity);
    const buildables = normalizeBuildables(acquisition.report, assets, itemIds, integrity);
    const visuals = normalizeVisuals(acquisition.report, assets, integrity);
    const propertyLayouts = await normalizePropertyLayouts(
        acquisition.report,
        assets,
        properties,
        visuals.meshes,
        integrity
    );
    const people = normalizePeople(acquisition.report, assets, integrity);
    const trade = normalizeTrade(acquisition.report, people.people, shops, itemIds, integrity);
    const world = normalizeWorld(
        acquisition.report,
        assets,
        new Set(people.people.map((person) => person.id)),
        new Set(shops.map((shop) => shop.code)),
        integrity
    );
    validateEmployeeRoutes(world.navigation, properties, propertyLayouts, integrity);

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
        buildables: buildables.length,
        propertyLayouts: propertyLayouts.length,
        worldRegions: world.map.regions.length,
        worldLocations: world.locations.locations.length,
        mapServices: world.locations.services.length,
        timedAccessZones: world.locations.timedAccessZones.length,
        navigationSamples: world.navigation.samples.length,
        navigationEdges: world.navigation.edges.length,
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
    for (const buildable of buildables) {
        documents.set(`buildables/${entityFileName(buildable.itemId)}`, buildable);
    }
    for (const layout of propertyLayouts) {
        documents.set(`properties/${entityDirectoryName(layout.propertyCode)}/layout.json`, layout);
    }
    for (const customer of customers.customers) {
        documents.set(`customers/${entityFileName(customer.id)}`, customer);
    }
    for (const person of people.people) {
        documents.set(`people/${entityFileName(person.id)}`, person);
    }
    documents.set('customers/catalog.json', customers.catalog);
    documents.set('people/relationships.json', people.relationships);
    documents.set('people/trade.json', trade);
    documents.set('mixing/rules.json', mixing);
    documents.set('production/catalog.json', production);
    documents.set('production/logistics.json', productionLogistics);
    documents.set('visuals/assets.json', visuals);
    documents.set('world/map.json', world.map);
    documents.set('world/locations.json', world.locations);
    documents.set('world/navigation.json', world.navigation);
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
