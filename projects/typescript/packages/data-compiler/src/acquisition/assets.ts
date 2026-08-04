import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import type { AssetFile } from '@neonschedule1/core';

import { Integrity } from '../integrity.js';
import { asArray, asObject, numberField, stringArrayField, stringField, type JsonObject } from '../json.js';
import { sha256File } from './load.js';
import type { LoadedAcquisition } from './types.js';

interface DirectDescriptor {
    readonly relativePath: string;
    readonly sha256: string;
    readonly byteLength: number | null;
}

interface MutableAssetFile {
    readonly id: string;
    readonly sha256: string;
    readonly byteLength: number;
    readonly mediaType: string;
    readonly sourcePaths: Set<string>;
}

export interface VerifiedAssets {
    readonly files: AssetFile[];
    readonly directFileIdByPath: ReadonlyMap<string, string>;
    readonly offlineFileIdsByMeshKey: ReadonlyMap<string, readonly string[]>;
    readonly directFileCount: number;
    readonly offlineFileCount: number;
}

const completeStatuses = new Set(['matched', 'matched-identical-duplicates', 'ambiguous-variants-preserved']);

export async function verifyAssets(acquisition: LoadedAcquisition, integrity: Integrity): Promise<VerifiedAssets> {
    const registry = new Map<string, MutableAssetFile>();
    const directFileIdByPath = await verifyDirectAssets(acquisition, registry, integrity);
    const offline = await verifyOfflineAssets(acquisition, registry, integrity);
    integrity.throwIfInvalid();

    const files = [...registry.values()]
        .map<AssetFile>((file) => ({
            id: file.id,
            sha256: file.sha256,
            byteLength: file.byteLength,
            mediaType: file.mediaType,
            sourcePaths: [...file.sourcePaths].sort(),
        }))
        .sort((left, right) => left.id.localeCompare(right.id));

    return {
        files,
        directFileIdByPath,
        offlineFileIdsByMeshKey: offline.byMeshKey,
        directFileCount: directFileIdByPath.size,
        offlineFileCount: offline.fileCount,
    };
}

async function verifyDirectAssets(
    acquisition: LoadedAcquisition,
    registry: Map<string, MutableAssetFile>,
    integrity: Integrity
): Promise<Map<string, string>> {
    const descriptors = collectDirectDescriptors(acquisition.report.document, integrity);
    const assetDirectoryRelative = normalizeRelativePath(acquisition.report.discovery.assetDirectory);
    const assetDirectory = resolveWithin(acquisition.exportsDirectory, assetDirectoryRelative);
    const actualFiles = await walkFiles(assetDirectory);
    const actualRelativePaths = new Set(actualFiles.map((file) => relativePosix(acquisition.exportsDirectory, file)));
    const directFileIdByPath = new Map<string, string>();

    for (const descriptor of descriptors.values()) {
        const relativePath = normalizeRelativePath(descriptor.relativePath);
        if (relativePath !== assetDirectoryRelative && !relativePath.startsWith(`${assetDirectoryRelative}/`)) {
            integrity.addError(`Direct asset escapes the declared asset directory: ${relativePath}`);
            continue;
        }
        const fullPath = resolveWithin(acquisition.exportsDirectory, relativePath);
        const fileStat = await stat(fullPath).catch(() => null);
        if (!fileStat?.isFile()) {
            integrity.addError(`Direct asset is missing: ${relativePath}`);
            continue;
        }
        if (descriptor.byteLength !== null && descriptor.byteLength !== fileStat.size) {
            integrity.addError(`Direct asset length does not match the report: ${relativePath}`);
            continue;
        }
        const actualHash = await sha256File(fullPath);
        if (actualHash !== descriptor.sha256) {
            integrity.addError(`Direct asset checksum does not match the report: ${relativePath}`);
            continue;
        }
        addRegistryFile(
            registry,
            actualHash,
            fileStat.size,
            mediaTypeForPath(relativePath),
            `exports/${relativePath}`,
            integrity
        );
        directFileIdByPath.set(relativePath, actualHash);
    }

    const expectedRelativePaths = new Set(directFileIdByPath.keys());
    for (const relativePath of actualRelativePaths) {
        if (!expectedRelativePaths.has(relativePath)) {
            integrity.addError(`Direct asset directory contains an unrecorded file: ${relativePath}`);
        }
    }
    integrity.check(
        'direct asset count matches the report',
        directFileIdByPath.size === acquisition.report.discovery.assetFileCount,
        `Expected ${acquisition.report.discovery.assetFileCount} direct assets, verified ${directFileIdByPath.size}`
    );
    integrity.check(
        'exporter reported zero direct asset verification errors',
        acquisition.report.discovery.assetVerificationErrors.length === 0,
        `Exporter reported ${acquisition.report.discovery.assetVerificationErrors.length} direct asset verification errors`
    );
    return directFileIdByPath;
}

async function verifyOfflineAssets(
    acquisition: LoadedAcquisition,
    registry: Map<string, MutableAssetFile>,
    integrity: Integrity
): Promise<{ byMeshKey: Map<string, readonly string[]>; fileCount: number }> {
    const recordedPaths = new Set<string>();
    const byMeshKey = new Map<string, readonly string[]>();
    let referenceCount = 0;

    for (const [entryIndex, entry] of acquisition.manifest.entries.entries()) {
        const entryPath = `manifest.entries[${entryIndex}]`;
        const status = stringField(entry, 'status', entryPath);
        if (!completeStatuses.has(status)) {
            integrity.addError(`${entryPath} has unresolved status ${JSON.stringify(status)}`);
        }
        const fileIds: string[] = [];
        const files = asArray(entry.files, `${entryPath}.files`);
        for (const [fileIndex, value] of files.entries()) {
            const record = asObject(value, `${entryPath}.files[${fileIndex}]`);
            const relativePath = normalizeRelativePath(
                stringField(record, 'relativePath', `${entryPath}.files[${fileIndex}]`)
            );
            if (recordedPaths.has(relativePath)) {
                integrity.addError(`Offline manifest records duplicate file path ${relativePath}`);
                continue;
            }
            recordedPaths.add(relativePath);
            const fullPath = resolveWithin(acquisition.manifestDirectory, relativePath);
            const fileStat = await stat(fullPath).catch(() => null);
            if (!fileStat?.isFile()) {
                integrity.addError(`Offline asset is missing: ${relativePath}`);
                continue;
            }
            const expectedLength = numberField(record, 'byteLength', `${entryPath}.files[${fileIndex}]`);
            const expectedHash = stringField(record, 'sha256', `${entryPath}.files[${fileIndex}]`).toLowerCase();
            if (fileStat.size !== expectedLength) {
                integrity.addError(`Offline asset length does not match the manifest: ${relativePath}`);
                continue;
            }
            if (!(await hasGlbHeader(fullPath))) {
                integrity.addError(`Offline asset does not have a glTF binary header: ${relativePath}`);
                continue;
            }
            const actualHash = await sha256File(fullPath);
            if (actualHash !== expectedHash) {
                integrity.addError(`Offline asset checksum does not match the manifest: ${relativePath}`);
                continue;
            }
            addRegistryFile(
                registry,
                actualHash,
                fileStat.size,
                'model/gltf-binary',
                relativePosix(acquisition.root, fullPath),
                integrity
            );
            fileIds.push(actualHash);
        }

        const keys = stringArrayField(entry, 'assetReferenceKeys', entryPath);
        referenceCount += keys.length;
        const sortedFileIds = [...new Set(fileIds)].sort();
        for (const key of keys) {
            const existing = byMeshKey.get(key);
            if (existing !== undefined && existing.join('\0') !== sortedFileIds.join('\0')) {
                integrity.addError(`Offline manifest maps mesh key ${JSON.stringify(key)} to conflicting files`);
            } else {
                byMeshKey.set(key, sortedFileIds);
            }
        }
    }

    const actualGlbs = (await walkFiles(acquisition.manifestDirectory))
        .filter((file) => path.extname(file).toLowerCase() === '.glb')
        .map((file) => relativePosix(acquisition.manifestDirectory, file));
    for (const relativePath of actualGlbs) {
        if (!recordedPaths.has(relativePath)) {
            integrity.addError(`Offline output contains an unrecorded GLB: ${relativePath}`);
        }
    }
    integrity.check(
        'offline manifest target count is complete',
        acquisition.manifest.entries.length === acquisition.manifest.targetCount &&
            acquisition.manifest.processedCount === acquisition.manifest.targetCount,
        'Offline manifest target, processed, and entry counts differ'
    );
    integrity.check(
        'offline manifest reference count is complete',
        referenceCount === acquisition.manifest.referenceCount,
        `Offline manifest expected ${acquisition.manifest.referenceCount} references, found ${referenceCount}`
    );
    integrity.check(
        'offline manifest records every GLB',
        actualGlbs.length === recordedPaths.size,
        `Offline manifest records ${recordedPaths.size} GLBs but ${actualGlbs.length} exist`
    );
    return { byMeshKey, fileCount: recordedPaths.size };
}

function collectDirectDescriptors(document: JsonObject, integrity: Integrity): Map<string, DirectDescriptor> {
    const descriptors = new Map<string, DirectDescriptor>();
    const visit = (value: unknown): void => {
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        if (value === null || typeof value !== 'object') return;
        const object = value as JsonObject;
        if (typeof object.relativePath === 'string' && object.relativePath !== '') {
            const relativePath = normalizeRelativePath(object.relativePath);
            const sha256 = typeof object.sha256 === 'string' ? object.sha256.toLowerCase() : '';
            if (!/^[a-f0-9]{64}$/u.test(sha256)) {
                integrity.addError(`Direct asset has an invalid checksum: ${relativePath}`);
            } else {
                const byteLength = typeof object.byteLength === 'number' ? object.byteLength : null;
                const existing = descriptors.get(relativePath);
                if (existing !== undefined && (existing.sha256 !== sha256 || existing.byteLength !== byteLength)) {
                    integrity.addError(`Direct asset has conflicting descriptors: ${relativePath}`);
                } else {
                    descriptors.set(relativePath, { relativePath, sha256, byteLength });
                }
            }
        }
        Object.values(object).forEach(visit);
    };
    visit(document);
    return descriptors;
}

function addRegistryFile(
    registry: Map<string, MutableAssetFile>,
    sha256: string,
    byteLength: number,
    mediaType: string,
    sourcePath: string,
    integrity: Integrity
): void {
    const existing = registry.get(sha256);
    if (existing === undefined) {
        registry.set(sha256, {
            id: sha256,
            sha256,
            byteLength,
            mediaType,
            sourcePaths: new Set([sourcePath]),
        });
        return;
    }
    if (existing.byteLength !== byteLength || existing.mediaType !== mediaType) {
        integrity.addError(`Asset checksum ${sha256} has conflicting file metadata`);
    }
    existing.sourcePaths.add(sourcePath);
}

async function walkFiles(directory: string): Promise<string[]> {
    const results: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const child = path.join(directory, entry.name);
        if (entry.isDirectory()) results.push(...(await walkFiles(child)));
        else if (entry.isFile()) results.push(child);
    }
    return results.sort();
}

function normalizeRelativePath(value: string): string {
    const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
    if (
        normalized === '.' ||
        normalized === '..' ||
        normalized.startsWith('../') ||
        normalized.startsWith('/') ||
        /^[a-zA-Z]:/u.test(normalized)
    ) {
        throw new Error(`Unsafe relative asset path: ${JSON.stringify(value)}`);
    }
    return normalized;
}

function resolveWithin(parent: string, relativePath: string): string {
    const resolvedParent = path.resolve(parent);
    const resolved = path.resolve(resolvedParent, ...relativePath.split('/'));
    if (!resolved.startsWith(`${resolvedParent}${path.sep}`)) {
        throw new Error(`Resolved asset path escapes its parent: ${relativePath}`);
    }
    return resolved;
}

function relativePosix(parent: string, child: string): string {
    return path.relative(parent, child).split(path.sep).join('/');
}

function mediaTypeForPath(filePath: string): string {
    switch (path.extname(filePath).toLowerCase()) {
        case '.png':
            return 'image/png';
        case '.obj':
            return 'model/obj';
        case '.glb':
            return 'model/gltf-binary';
        default:
            return 'application/octet-stream';
    }
}

async function hasGlbHeader(filePath: string): Promise<boolean> {
    const file = await open(filePath, 'r');
    try {
        const header = Buffer.alloc(4);
        const { bytesRead } = await file.read(header, 0, header.length, 0);
        return bytesRead === 4 && header.toString('ascii') === 'glTF';
    } finally {
        await file.close();
    }
}
