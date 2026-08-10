import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { normalizeMixingRuleProfile } from '@neonschedule1/core';

import {
    buildRecipeCorpusIndex,
    recipeCorpusIndexAlgorithmVersion,
    type RecipeCorpusIndex,
} from '#solver/precompute-index';
import {
    readBinaryRecipeCorpusIndex,
    writeBinaryRecipeCorpusIndex,
    type BinaryRecipeCorpusIndexFile,
} from '#solver/precompute-index-binary';
import { RuntimeRecipeCorpusIndex } from '#solver/runtime-index';

const recipeCorpusIndexManifestSchema = 'neonschedule1-recipe-corpus-index-manifest' as const;

interface RecipeCorpusIndexManifestBase {
    readonly artifactSha256: string;
    readonly algorithmVersion: string;
    readonly corpus: RecipeCorpusIndex['corpus'];
    readonly counts: {
        readonly recipes: number;
        readonly products: number;
        readonly effects: number;
    };
}

export interface RecipeCorpusIndexManifest extends RecipeCorpusIndexManifestBase {
    readonly schema: typeof recipeCorpusIndexManifestSchema;
    readonly storage: 'binary-columnar-1';
    readonly file: BinaryRecipeCorpusIndexFile;
}

export async function writeRecipeCorpusIndexArtifact(
    indexRoot: string,
    corpusDirectory: string
): Promise<{
    readonly directory: string;
    readonly manifest: RecipeCorpusIndexManifest;
    readonly byteLength: number;
}> {
    const resolvedRoot = path.resolve(indexRoot);
    await mkdir(resolvedRoot, { recursive: true });
    const { manifest: corpusManifest, index } = await buildRecipeCorpusIndex(corpusDirectory);
    const staging = path.join(resolvedRoot, `.${process.pid}.${randomUUID()}.tmp`);
    if (await stat(staging).catch(() => null)) {
        throw new Error(`Recipe index staging directory already exists: ${staging}`);
    }
    await mkdir(staging, { recursive: true });
    try {
        const summary = indexSummary(index);
        const lookupFile = await writeBinaryRecipeCorpusIndex(
            path.join(staging, 'lookup.bin'),
            index,
            corpusManifest.files
        );
        const manifest = buildManifest(summary, lookupFile);
        const manifestContent = `${JSON.stringify(manifest)}\n`;
        await writeFile(path.join(staging, 'manifest.json'), manifestContent, { flag: 'wx' });
        await verifyRecipeCorpusIndexArtifact(staging);
        const finalDirectory = path.join(
            resolvedRoot,
            index.corpus.artifactSha256,
            manifest.artifactSha256
        );
        await mkdir(path.dirname(finalDirectory), { recursive: true });
        if (await stat(finalDirectory).catch(() => null)) {
            await verifyRecipeCorpusIndexFiles(finalDirectory, manifest);
            await verifyRecipeCorpusIndexArtifact(finalDirectory);
            await rm(staging, { recursive: true });
        } else {
            await rename(staging, finalDirectory);
        }
        await verifyRecipeCorpusIndexFiles(finalDirectory, manifest);
        return {
            directory: finalDirectory,
            manifest,
            byteLength: lookupFile.byteLength + Buffer.byteLength(manifestContent),
        };
    } catch (error) {
        await rm(staging, { recursive: true, force: true });
        throw error;
    }
}

export async function verifyRecipeCorpusIndexArtifact(
    directory: string
): Promise<{
    readonly manifest: RecipeCorpusIndexManifest;
    readonly index: RuntimeRecipeCorpusIndex;
}> {
    const resolvedDirectory = path.resolve(directory);
    if (!(await stat(resolvedDirectory).catch(() => null))?.isDirectory()) {
        throw new Error(`Recipe index directory does not exist: ${resolvedDirectory}`);
    }
    const manifest = await readManifest(resolvedDirectory);
    const lookupContent = await readFile(path.join(resolvedDirectory, manifest.file.path));
    if (lookupContent.byteLength !== manifest.file.byteLength ||
        sha256(lookupContent) !== manifest.file.sha256) {
        throw new Error('Recipe index lookup file failed integrity verification');
    }
    const index = readBinaryRecipeCorpusIndex(lookupContent);
    verifyRuntimeIndex(index, manifest);
    return { manifest, index };
}

interface RecipeCorpusIndexSummary {
    readonly corpus: RecipeCorpusIndex['corpus'];
    readonly counts: RecipeCorpusIndexManifest['counts'];
}

function indexSummary(index: RecipeCorpusIndex): RecipeCorpusIndexSummary {
    return {
        corpus: index.corpus,
        counts: {
        recipes: index.records.length,
        products: Object.keys(index.postings.products).length,
        effects: Object.keys(index.postings.effects).length,
        },
    };
}

function buildManifest(
    summary: RecipeCorpusIndexSummary,
    file: BinaryRecipeCorpusIndexFile
): RecipeCorpusIndexManifest {
    const body = manifestBody(summary.corpus, summary.counts, file);
    return {
        artifactSha256: sha256(jsonBytes(body)),
        ...body,
    };
}

async function verifyRecipeCorpusIndexFiles(
    directory: string,
    expected: RecipeCorpusIndexManifest
): Promise<void> {
    const resolvedDirectory = path.resolve(directory);
    if (!(await stat(resolvedDirectory).catch(() => null))?.isDirectory()) {
        throw new Error(`Recipe index directory does not exist: ${resolvedDirectory}`);
    }
    const manifest = await readManifest(resolvedDirectory);
    if (manifest.artifactSha256 !== expected.artifactSha256) {
        throw new Error(`Existing recipe index has a different identity: ${resolvedDirectory}`);
    }
    const lookupPath = path.join(resolvedDirectory, manifest.file.path);
    const lookupStat = await stat(lookupPath).catch(() => null);
    if (lookupStat?.size !== manifest.file.byteLength ||
        await sha256File(lookupPath) !== manifest.file.sha256) {
        throw new Error('Recipe index lookup file failed integrity verification');
    }
}

async function readManifest(directory: string): Promise<RecipeCorpusIndexManifest> {
    const manifest = parseManifest(
        JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
    );
    const expectedArtifactHash = sha256(jsonBytes(
        manifestBody(manifest.corpus, manifest.counts, manifest.file)
    ));
    if (manifest.artifactSha256 !== expectedArtifactHash) {
        throw new Error('Recipe index manifest failed artifact identity verification');
    }
    return manifest;
}

async function sha256File(filePath: string): Promise<string> {
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(filePath)) digest.update(chunk);
    return digest.digest('hex');
}

function manifestBody(
    corpus: RecipeCorpusIndex['corpus'],
    counts: RecipeCorpusIndexManifest['counts'],
    file: RecipeCorpusIndexManifest['file']
): Omit<RecipeCorpusIndexManifest, 'artifactSha256'> {
    return {
        schema: recipeCorpusIndexManifestSchema,
        algorithmVersion: recipeCorpusIndexAlgorithmVersion,
        corpus,
        counts,
        storage: 'binary-columnar-1',
        file,
    };
}

function verifyRuntimeIndex(
    index: RuntimeRecipeCorpusIndex,
    manifest: RecipeCorpusIndexManifest
): void {
    if (index.recordCount !== manifest.counts.recipes ||
        Object.keys(index.postings.products).length !== manifest.counts.products ||
        Object.keys(index.postings.effects).length !== manifest.counts.effects) {
        throw new Error('Recipe index lookup metadata differs from its manifest');
    }
}

function parseManifest(value: unknown): RecipeCorpusIndexManifest {
    const record = object(value, 'Recipe index manifest');
    const file = object(record.file, 'Recipe index file');
    if (record.schema !== recipeCorpusIndexManifestSchema ||
        record.storage !== 'binary-columnar-1' || file.path !== 'lookup.bin') {
        throw new Error(
            'Recipe index artifact is stale or unsupported; expected manifest with lookup.bin'
        );
    }
    if (record.algorithmVersion !== recipeCorpusIndexAlgorithmVersion) {
        throw new Error('Recipe index manifest has an unsupported algorithm version');
    }
    const corpus = object(record.corpus, 'Recipe index corpus identity');
    const counts = object(record.counts, 'Recipe index counts');
    const common = {
        artifactSha256: hash(record.artifactSha256, 'artifactSha256'),
        algorithmVersion: record.algorithmVersion,
        corpus: {
            artifactSha256: hash(corpus.artifactSha256, 'corpus.artifactSha256'),
            coverageKey: hash(corpus.coverageKey, 'corpus.coverageKey'),
            datasetSha256: hash(corpus.datasetSha256, 'corpus.datasetSha256'),
            ruleProfile: normalizeMixingRuleProfile(corpus.ruleProfile),
        },
        counts: {
            recipes: integer(counts.recipes, 'counts.recipes'),
            products: integer(counts.products, 'counts.products'),
            effects: integer(counts.effects, 'counts.effects'),
        },
    };
    const fileIdentity = {
        sha256: hash(file.sha256, 'file.sha256'),
        byteLength: integer(file.byteLength, 'file.byteLength'),
    };
    return {
        schema: record.schema,
        ...common,
        storage: record.storage,
        file: { path: file.path, ...fileIdentity },
    };
}

function jsonBytes(value: unknown): Buffer {
    return Buffer.from(JSON.stringify(value), 'utf8');
}

function sha256(content: string | Uint8Array): string {
    return createHash('sha256').update(content).digest('hex');
}

function object(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a string`);
    return value;
}

function hash(value: unknown, label: string): string {
    const result = string(value, label);
    if (!/^[a-f0-9]{64}$/u.test(result)) throw new Error(`${label} must be a lowercase SHA-256`);
    return result;
}

function integer(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new Error(`${label} must be a non-negative safe integer`);
    }
    return value as number;
}
