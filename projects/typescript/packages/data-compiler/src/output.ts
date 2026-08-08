import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
    canonicalJson,
    DatasetManifestSchema,
    normalizedDatasetIdentityInput,
    type DatasetManifest,
    type IntegrityCounts,
} from '@neonschedule1/core';

import { sha256File } from '#data-compiler/acquisition/load';
import { sha256Text } from '#data-compiler/json';

export interface WriteDatasetOptions {
    readonly outputRoot: string;
    readonly normalizerVersion: string;
    readonly gameVersion: string;
    readonly sourceReportSha256: string;
    readonly sourceManifestSha256: string;
    readonly counts: IntegrityCounts;
    readonly deferredDomains: readonly string[];
    readonly documents: ReadonlyMap<string, unknown>;
}

export interface WrittenDataset {
    readonly directory: string;
    readonly manifest: DatasetManifest;
    readonly reusedExisting: boolean;
}

export async function writeDataset(options: WriteDatasetOptions): Promise<WrittenDataset> {
    const versionDirectory = path.resolve(options.outputRoot, options.gameVersion);
    await mkdir(versionDirectory, { recursive: true });
    const staging = path.join(versionDirectory, `.staging-${process.pid}-${randomUUID()}`);
    await mkdir(staging, { recursive: false });

    try {
        const files = [];
        for (const [relativePath, document] of [...options.documents.entries()].sort(([left], [right]) =>
            left.localeCompare(right)
        )) {
            const outputPath = resolveOutputPath(staging, relativePath);
            const content = canonicalJson(document);
            await mkdir(path.dirname(outputPath), { recursive: true });
            await writeFile(outputPath, content, { encoding: 'utf8', flag: 'wx' });
            files.push({
                path: relativePath,
                sha256: sha256Text(content),
                byteLength: Buffer.byteLength(content),
            });
        }

        const identityInput = normalizedDatasetIdentityInput({
            schema: 'neonschedule1-normalized-data-1',
            normalizerVersion: options.normalizerVersion,
            gameVersion: options.gameVersion,
            sourceReportSha256: options.sourceReportSha256,
            sourceManifestSha256: options.sourceManifestSha256,
            files,
            counts: options.counts,
            deferredDomains: [...options.deferredDomains],
        });
        const datasetSha256 = sha256Text(canonicalJson(identityInput));
        const manifest = DatasetManifestSchema.assert({
            ...identityInput,
            datasetSha256,
        });
        await writeFile(path.join(staging, 'manifest.json'), canonicalJson(manifest), {
            encoding: 'utf8',
            flag: 'wx',
        });

        const destination = path.join(versionDirectory, datasetSha256);
        if ((await stat(destination).catch(() => null))?.isDirectory()) {
            const existing = await validateExistingDataset(destination, manifest);
            await rm(staging, { recursive: true, force: true });
            return { directory: destination, manifest: existing, reusedExisting: true };
        }

        try {
            await rename(staging, destination);
        } catch (error) {
            if ((await stat(destination).catch(() => null))?.isDirectory()) {
                const existing = await validateExistingDataset(destination, manifest);
                await rm(staging, { recursive: true, force: true });
                return { directory: destination, manifest: existing, reusedExisting: true };
            }
            throw error;
        }
        return { directory: destination, manifest, reusedExisting: false };
    } catch (error) {
        await rm(staging, { recursive: true, force: true });
        throw error;
    }
}

async function validateExistingDataset(directory: string, expected: DatasetManifest): Promise<DatasetManifest> {
    const manifestPath = path.join(directory, 'manifest.json');
    const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    const actual = DatasetManifestSchema.assert(parsed);
    if (canonicalJson(parsed) !== canonicalJson(expected)) {
        throw new Error(`Existing normalized dataset conflicts with ${expected.datasetSha256}`);
    }
    const expectedPaths = new Set(['manifest.json', ...actual.files.map((file) => file.path)]);
    const actualPaths = await listDatasetFiles(directory);
    if (actualPaths.length !== expectedPaths.size || actualPaths.some((file) => !expectedPaths.has(file))) {
        throw new Error(`Existing normalized dataset has an unexpected file set`);
    }
    for (const file of actual.files) {
        const filePath = resolveOutputPath(directory, file.path);
        const fileStat = await lstat(filePath).catch(() => null);
        if (!fileStat?.isFile() || fileStat.size !== file.byteLength || (await sha256File(filePath)) !== file.sha256) {
            throw new Error(`Existing normalized dataset is corrupt at ${file.path}`);
        }
    }
    return actual;
}

async function listDatasetFiles(root: string, directory = root): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const child = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...(await listDatasetFiles(root, child)));
        else files.push(path.relative(root, child).split(path.sep).join('/'));
    }
    return files.sort();
}

function resolveOutputPath(parent: string, relativePath: string): string {
    const normalized = path.posix.normalize(relativePath.replaceAll('\\', '/'));
    if (
        normalized === '.' ||
        normalized === '..' ||
        normalized.startsWith('../') ||
        normalized.startsWith('/') ||
        /^[a-zA-Z]:/u.test(normalized)
    ) {
        throw new Error(`Unsafe normalized output path: ${relativePath}`);
    }
    const resolvedParent = path.resolve(parent);
    const resolved = path.resolve(resolvedParent, ...normalized.split('/'));
    if (!resolved.startsWith(`${resolvedParent}${path.sep}`)) {
        throw new Error(`Normalized output path escapes its parent: ${relativePath}`);
    }
    return resolved;
}
