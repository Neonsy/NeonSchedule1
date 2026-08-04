import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { writeDataset, type WriteDatasetOptions } from '#data-compiler/output';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('normalized dataset persistence', () => {
    it('reuses an identical hash-addressed dataset after verifying every file', async () => {
        const outputRoot = await temporaryDirectory();
        const options = writeOptions(outputRoot);

        const first = await writeDataset(options);
        const second = await writeDataset(options);

        expect(first.reusedExisting).toBe(false);
        expect(second.reusedExisting).toBe(true);
        expect(second.manifest.datasetSha256).toBe(first.manifest.datasetSha256);
        expect(JSON.parse(await readFile(path.join(first.directory, 'items/example.json'), 'utf8'))).toEqual({
            id: 'example',
        });
    });

    it('refuses to reuse a corrupt existing dataset', async () => {
        const outputRoot = await temporaryDirectory();
        const options = writeOptions(outputRoot);
        const first = await writeDataset(options);
        const itemPath = path.join(first.directory, 'items/example.json');
        const originalItem = await readFile(itemPath, 'utf8');
        await writeFile(itemPath, 'corrupt\n', 'utf8');

        await expect(writeDataset(options)).rejects.toThrow(
            'Existing normalized dataset is corrupt at items/example.json'
        );

        await writeFile(itemPath, originalItem, 'utf8');
        const unexpectedPath = path.join(first.directory, 'unexpected.json');
        await writeFile(unexpectedPath, '{}\n', 'utf8');
        await expect(writeDataset(options)).rejects.toThrow('Existing normalized dataset has an unexpected file set');

        await rm(unexpectedPath);
        const manifestPath = path.join(first.directory, 'manifest.json');
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
        manifest.normalizerVersion = 'tampered';
        await writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
        await expect(writeDataset(options)).rejects.toThrow('Existing normalized dataset conflicts with');
    });
});

async function temporaryDirectory(): Promise<string> {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'neonschedule1-data-compiler-'));
    temporaryDirectories.push(directory);
    return directory;
}

function writeOptions(outputRoot: string): WriteDatasetOptions {
    return {
        outputRoot,
        normalizerVersion: 'test',
        gameVersion: 'test-version',
        sourceReportSha256: 'a'.repeat(64),
        sourceManifestSha256: 'b'.repeat(64),
        counts: {
            items: 1,
        effects: 0,
        mixingMaps: 0,
        mixingOracleCases: 0,
            shops: 0,
            properties: 0,
            directAssetFiles: 0,
            offlineAssetFiles: 0,
            meshAssets: 0,
            materialAssets: 0,
        },
        deferredDomains: [],
        documents: new Map([['items/example.json', { id: 'example' }]]),
    };
}
