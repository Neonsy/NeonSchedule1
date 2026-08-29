import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
    canonicalJson,
    DatasetManifestSchema,
    normalizedDatasetIdentityInput,
    type DatasetFile,
    type DatasetManifest,
} from '@neonschedule1/core';

export interface VerifiedNormalizedDataset {
    readonly manifest: DatasetManifest;
    readonly readDocument: (relativePath: string) => Promise<unknown>;
    readonly paths: (pattern: RegExp) => readonly string[];
}

export async function openNormalizedDataset(
    directory: string
): Promise<VerifiedNormalizedDataset> {
    const root = path.resolve(directory);
    const manifest = DatasetManifestSchema.assert(JSON.parse(
        await readFile(path.join(root, 'manifest.json'), 'utf8')
    ) as unknown);
    const identity = createHash('sha256')
        .update(canonicalJson(normalizedDatasetIdentityInput(manifest)), 'utf8')
        .digest('hex');
    if (identity !== manifest.datasetSha256) {
        throw new Error(
            `Normalized dataset identity mismatch: expected ${manifest.datasetSha256}, ` +
                `computed ${identity}`
        );
    }
    const files = new Map(manifest.files.map((file) => [file.path, file]));
    return {
        manifest,
        readDocument: async (relativePath) => JSON.parse(
            (await verifiedFile(root, files, relativePath)).toString('utf8')
        ) as unknown,
        paths: (pattern) => manifest.files
            .map((file) => file.path)
            .filter((relativePath) => pattern.test(relativePath))
            .sort((left, right) => left.localeCompare(right)),
    };
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
