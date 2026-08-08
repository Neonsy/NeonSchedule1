import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import {
    canonicalJson,
    CustomerCatalogSchema,
    CustomerSchema,
    DatasetManifestSchema,
    EffectSchema,
    ItemSchema,
    MixingRulesSchema,
    TradeCatalogSchema,
    normalizedDatasetIdentityInput,
    type Customer,
    type CustomerCatalog,
    type DatasetFile,
    type DatasetManifest,
    type Effect,
    type Item,
    type MixingRules,
    type TradeCatalog,
} from '@neonschedule1/core';

export interface SolverDataset {
    readonly directory: string;
    readonly manifest: DatasetManifest;
    readonly items: readonly Item[];
    readonly effects: readonly Effect[];
    readonly mixingRules: MixingRules;
    readonly customers: readonly Customer[];
    readonly customerCatalog: CustomerCatalog;
    readonly tradeCatalog: TradeCatalog;
}

export function workspaceRoot(): string {
    return path.resolve(import.meta.dirname, '..', '..', '..');
}

export async function resolveDatasetDirectory(dataset?: string): Promise<string> {
    if (dataset !== undefined) {
        const directory = path.resolve(dataset);
        if (!(await stat(directory).catch(() => null))?.isDirectory()) {
            throw new Error(`Normalized dataset directory does not exist: ${directory}`);
        }
        return directory;
    }

    const root = path.join(workspaceRoot(), '.local', 'normalized');
    const candidates: { directory: string; modifiedAt: number }[] = [];
    for (const version of await directories(root)) {
        for (const hash of await directories(path.join(root, version))) {
            const directory = path.join(root, version, hash);
            const manifest = await stat(path.join(directory, 'manifest.json')).catch(() => null);
            if (manifest?.isFile()) candidates.push({ directory, modifiedAt: manifest.mtimeMs });
        }
    }
    candidates.sort(
        (left, right) => right.modifiedAt - left.modifiedAt || left.directory.localeCompare(right.directory)
    );
    const latest = candidates[0];
    if (latest === undefined) {
        throw new Error(`No normalized dataset containing manifest.json was found under ${root}`);
    }
    return latest.directory;
}

export async function loadSolverDataset(directory: string): Promise<SolverDataset> {
    const resolvedDirectory = path.resolve(directory);
    const manifestDocument: unknown = JSON.parse(
        await readFile(path.join(resolvedDirectory, 'manifest.json'), 'utf8')
    );
    const manifest = DatasetManifestSchema.assert(manifestDocument);
    assertDatasetManifestIdentity(manifest);
    const files = new Map(manifest.files.map((file) => [file.path, file]));
    const itemPaths = matchingPaths(manifest.files, /^items\/[^/]+\.json$/u);
    const effectPaths = matchingPaths(manifest.files, /^effects\/[^/]+\.json$/u);
    const customerPaths = matchingPaths(
        manifest.files,
        /^customers\/(?!catalog\.json$)[^/]+\.json$/u
    );

    const [items, effects, customers, mixingRules, customerCatalog, tradeCatalog] = await Promise.all([
        loadDocuments(resolvedDirectory, files, itemPaths, ItemSchema),
        loadDocuments(resolvedDirectory, files, effectPaths, EffectSchema),
        loadDocuments(resolvedDirectory, files, customerPaths, CustomerSchema),
        loadDocument(resolvedDirectory, files, 'mixing/rules.json', MixingRulesSchema),
        loadDocument(
            resolvedDirectory,
            files,
            'customers/catalog.json',
            CustomerCatalogSchema
        ),
        loadDocument(resolvedDirectory, files, 'people/trade.json', TradeCatalogSchema),
    ]);

    requireCount(items.length, manifest.counts.items, 'items');
    requireCount(effects.length, manifest.counts.effects, 'effects');
    requireCount(customers.length, manifest.counts.customers, 'customers');
    requireCount(mixingRules.maps.length, manifest.counts.mixingMaps, 'mixing maps');

    return {
        directory: resolvedDirectory,
        manifest,
        items,
        effects,
        mixingRules,
        customers,
        customerCatalog,
        tradeCatalog,
    };
}

export function assertDatasetManifestIdentity(manifest: DatasetManifest): void {
    const actual = createHash('sha256')
        .update(canonicalJson(normalizedDatasetIdentityInput(manifest)), 'utf8')
        .digest('hex');
    if (actual !== manifest.datasetSha256) {
        throw new Error(
            `Normalized dataset identity mismatch: expected ${manifest.datasetSha256}, computed ${actual}`
        );
    }
}

interface Assertable<Output> {
    assert(value: unknown): Output;
}

async function loadDocuments<Output>(
    root: string,
    files: ReadonlyMap<string, DatasetFile>,
    paths: readonly string[],
    schema: Assertable<Output>
): Promise<Output[]> {
    return Promise.all(paths.map((relativePath) => loadDocument(root, files, relativePath, schema)));
}

async function loadDocument<Output>(
    root: string,
    files: ReadonlyMap<string, DatasetFile>,
    relativePath: string,
    schema: Assertable<Output>
): Promise<Output> {
    const expected = files.get(relativePath);
    if (expected === undefined) {
        throw new Error(`Normalized dataset manifest does not contain ${relativePath}`);
    }
    const content = await readFile(resolveFile(root, relativePath));
    const actualHash = createHash('sha256').update(content).digest('hex');
    if (content.byteLength !== expected.byteLength || actualHash !== expected.sha256) {
        throw new Error(`Normalized dataset file failed integrity verification: ${relativePath}`);
    }
    return schema.assert(JSON.parse(content.toString('utf8')) as unknown);
}

function matchingPaths(files: readonly DatasetFile[], pattern: RegExp): string[] {
    return files
        .map((file) => file.path)
        .filter((relativePath) => pattern.test(relativePath))
        .sort((left, right) => left.localeCompare(right));
}

function resolveFile(root: string, relativePath: string): string {
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
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(resolvedRoot, ...normalized.split('/'));
    if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error(`Normalized dataset path escapes its root: ${relativePath}`);
    }
    return resolved;
}

async function directories(root: string): Promise<string[]> {
    const entries = await readdir(root, { withFileTypes: true }).catch((error: unknown) => {
        throw new Error(`Could not read normalized dataset root ${root}`, { cause: error });
    });
    return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));
}

function requireCount(actual: number, expected: number, name: string): void {
    if (actual !== expected) {
        throw new Error(`Expected ${expected} normalized ${name}, loaded ${actual}`);
    }
}
