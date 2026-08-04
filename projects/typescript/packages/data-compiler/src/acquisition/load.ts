import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { type } from 'arktype';

import {
    asObject,
    numberField,
    objectArray,
    stringArrayField,
    stringField,
    type JsonObject,
} from '../json.js';
import type { LoadedAcquisition, RawManifest, RawReport } from './types.js';

const reportShape = type({
    schemaVersion: "'neonschedule1-game-data-export-1'",
    exporterVersion: 'string',
    gameVersion: 'string',
    items: 'unknown[]',
    products: 'unknown[]',
    packaging: 'unknown[]',
    additives: 'unknown[]',
    soils: 'unknown[]',
    shops: 'unknown[]',
    mixing: 'object',
    world: 'object',
    discovery: 'object',
});

const manifestShape = type({
    schema: "'neonschedule1-offline-mesh-export-1'",
    sourceReportSha256: 'string',
    targetCount: 'number',
    referenceCount: 'number',
    processedCount: 'number',
    entries: 'unknown[]',
});

export async function loadAcquisition(acquisitionPath: string): Promise<LoadedAcquisition> {
    const root = path.resolve(acquisitionPath);
    const rootStat = await stat(root).catch(() => null);
    if (!rootStat?.isDirectory()) {
        throw new Error(`Acquisition directory does not exist: ${root}`);
    }

    const exportsDirectory = path.join(root, 'exports');
    const exportNames = await readdir(exportsDirectory);
    const reports = exportNames.filter((name) => /^neonschedule1-game-data-.+\.json$/u.test(name));
    if (reports.length !== 1) {
        throw new Error(`Expected exactly one game-data report in ${exportsDirectory}, found ${reports.length}`);
    }

    const reportName = reports[0];
    if (reportName === undefined) {
        throw new Error('Game-data report discovery failed');
    }
    const reportPath = path.join(exportsDirectory, reportName);
    const reportSha256 = await sha256File(reportPath);
    const sidecar = (await readFile(`${reportPath}.sha256`, 'utf8')).trim().toLowerCase();
    if (sidecar !== reportSha256) {
        throw new Error(`Report checksum sidecar does not match ${reportName}`);
    }

    const reportDocument = await readJson(reportPath);
    reportShape.assert(reportDocument);
    const report = parseReport(reportDocument);

    const offlineRoot = path.join(root, 'offline-assets');
    const offlineRuns = await readdir(offlineRoot, { withFileTypes: true });
    const manifestPaths: string[] = [];
    for (const entry of offlineRuns) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(offlineRoot, entry.name, 'offline-mesh-manifest.json');
        if ((await stat(candidate).catch(() => null))?.isFile()) manifestPaths.push(candidate);
    }
    if (manifestPaths.length !== 1) {
        throw new Error(`Expected exactly one offline mesh manifest in ${offlineRoot}, found ${manifestPaths.length}`);
    }

    const manifestPath = manifestPaths[0];
    if (manifestPath === undefined) {
        throw new Error('Offline manifest discovery failed');
    }
    const manifestDocument = await readJson(manifestPath);
    manifestShape.assert(manifestDocument);
    const manifest = parseManifest(manifestDocument);
    if (manifest.sourceReportSha256.toLowerCase() !== reportSha256) {
        throw new Error('Offline manifest belongs to a different game-data report');
    }

    return {
        root,
        exportsDirectory,
        reportPath,
        reportSha256,
        manifestPath,
        manifestDirectory: path.dirname(manifestPath),
        manifestSha256: await sha256File(manifestPath),
        report,
        manifest,
    };
}

export async function sha256File(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filePath)) hash.update(chunk);
    return hash.digest('hex');
}

async function readJson(filePath: string): Promise<JsonObject> {
    try {
        return asObject(JSON.parse(await readFile(filePath, 'utf8')), filePath);
    } catch (error) {
        throw new Error(`Could not parse JSON file ${filePath}`, { cause: error });
    }
}

function parseReport(document: JsonObject): RawReport {
    const mixing = asObject(document.mixing, 'report.mixing');
    const world = asObject(document.world, 'report.world');
    const discovery = asObject(document.discovery, 'report.discovery');
    const visualAssets = asObject(discovery.visualAssets, 'report.discovery.visualAssets');
    return {
        document,
        schemaVersion: stringField(document, 'schemaVersion', 'report'),
        exporterVersion: stringField(document, 'exporterVersion', 'report'),
        gameVersion: stringField(document, 'gameVersion', 'report'),
        items: objectArray(document.items, 'report.items'),
        products: objectArray(document.products, 'report.products'),
        packaging: objectArray(document.packaging, 'report.packaging'),
        additives: objectArray(document.additives, 'report.additives'),
        soils: objectArray(document.soils, 'report.soils'),
        shops: objectArray(document.shops, 'report.shops'),
        mixing: {
            maxProperties: numberField(mixing, 'maxProperties', 'report.mixing'),
            maxDeltaDifference: numberField(mixing, 'maxDeltaDifference', 'report.mixing'),
            validIngredientCount: numberField(mixing, 'validIngredientCount', 'report.mixing'),
            effectCount: numberField(mixing, 'effectCount', 'report.mixing'),
            mixerMapEffectCounts: asObject(
                mixing.mixerMapEffectCounts,
                'report.mixing.mixerMapEffectCounts'
            ),
            defaultProductIds: stringArrayField(mixing, 'defaultProductIds', 'report.mixing'),
            effects: objectArray(mixing.effects, 'report.mixing.effects'),
            ingredients: objectArray(mixing.ingredients, 'report.mixing.ingredients'),
            mixerMaps: objectArray(mixing.mixerMaps, 'report.mixing.mixerMaps'),
            oracles: objectArray(mixing.oracles, 'report.mixing.oracles'),
        },
        world: {
            properties: objectArray(world.properties, 'report.world.properties'),
            businesses: objectArray(world.businesses, 'report.world.businesses'),
        },
        discovery: {
            assetDirectory: stringField(discovery, 'assetDirectory', 'report.discovery'),
            assetFileCount: numberField(discovery, 'assetFileCount', 'report.discovery'),
            assetVerificationErrors: Array.isArray(discovery.assetVerificationErrors)
                ? discovery.assetVerificationErrors
                : [],
            itemPresentations: objectArray(discovery.itemPresentations, 'report.discovery.itemPresentations'),
            effectVisuals: objectArray(discovery.effectVisuals, 'report.discovery.effectVisuals'),
            buildables: objectArray(discovery.buildables, 'report.discovery.buildables'),
            propertyLayouts: objectArray(discovery.propertyLayouts, 'report.discovery.propertyLayouts'),
            shopDetails: objectArray(discovery.shopDetails, 'report.discovery.shopDetails'),
            visualMeshes: objectArray(visualAssets.meshes, 'report.discovery.visualAssets.meshes'),
            visualMaterials: objectArray(visualAssets.materials, 'report.discovery.visualAssets.materials'),
        },
    };
}

function parseManifest(document: JsonObject): RawManifest {
    return {
        document,
        schema: stringField(document, 'schema', 'manifest'),
        sourceReportSha256: stringField(document, 'sourceReportSha256', 'manifest'),
        targetCount: numberField(document, 'targetCount', 'manifest'),
        referenceCount: numberField(document, 'referenceCount', 'manifest'),
        processedCount: numberField(document, 'processedCount', 'manifest'),
        entries: objectArray(document.entries, 'manifest.entries'),
    };
}
