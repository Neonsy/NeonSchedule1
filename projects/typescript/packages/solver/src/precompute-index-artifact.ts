import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
    buildRecipeCorpusIndex,
    recipeCorpusIndexAlgorithmVersion,
    type RecipeCorpusIndex,
} from '#solver/precompute-index';

export interface RecipeCorpusIndexManifest {
    readonly schema: 'neonschedule1-recipe-corpus-index-manifest-1';
    readonly artifactSha256: string;
    readonly algorithmVersion: string;
    readonly corpus: RecipeCorpusIndex['corpus'];
    readonly counts: {
        readonly recipes: number;
        readonly products: number;
        readonly effects: number;
    };
    readonly file: {
        readonly path: 'lookup.json';
        readonly sha256: string;
        readonly byteLength: number;
    };
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
    const { index } = await buildRecipeCorpusIndex(corpusDirectory);
    const staging = path.join(resolvedRoot, `.${process.pid}.${randomUUID()}.tmp`);
    if (await stat(staging).catch(() => null)) {
        throw new Error(`Recipe index staging directory already exists: ${staging}`);
    }
    await mkdir(staging, { recursive: true });
    try {
        const lookupFile = await writeIndex(path.join(staging, 'lookup.json'), index);
        const manifest = buildManifest(index, lookupFile);
        verifyIndex(index, manifest);
        const manifestContent = `${JSON.stringify(manifest)}\n`;
        await writeFile(path.join(staging, 'manifest.json'), manifestContent, { flag: 'wx' });
        await verifyRecipeCorpusIndexFiles(staging, manifest);
        const finalDirectory = path.join(
            resolvedRoot,
            index.corpus.artifactSha256,
            manifest.artifactSha256
        );
        await mkdir(path.dirname(finalDirectory), { recursive: true });
        if (await stat(finalDirectory).catch(() => null)) {
            await verifyRecipeCorpusIndexFiles(finalDirectory, manifest);
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

async function writeIndex(
    outputPath: string,
    index: RecipeCorpusIndex
): Promise<RecipeCorpusIndexManifest['file']> {
    const output = await open(outputPath, 'wx');
    const digest = createHash('sha256');
    let byteLength = 0;
    const write = async (content: string): Promise<void> => {
        await output.writeFile(content, 'utf8');
        digest.update(content);
        byteLength += Buffer.byteLength(content);
    };
    try {
        await write('{"schema":');
        await write(JSON.stringify(index.schema));
        await write(',"algorithmVersion":');
        await write(JSON.stringify(index.algorithmVersion));
        await write(',"corpus":');
        await write(JSON.stringify(index.corpus));
        await write(',"records":');
        await writeArray(index.records, write);
        await write(',"postings":{"products":');
        await writePostings(index.postings.products, write);
        await write(',"effects":');
        await writePostings(index.postings.effects, write);
        await write('},"rankings":{"productValue":');
        await writeArray(index.rankings.productValue, write);
        await write(',"netValue":');
        await writeArray(index.rankings.netValue, write);
        await write('},"totalCostOrder":');
        await writeArray(index.totalCostOrder, write);
        await write('}\n');
    } finally {
        await output.close();
    }
    return {
        path: 'lookup.json',
        sha256: digest.digest('hex'),
        byteLength,
    };
}

async function writePostings(
    postings: Readonly<Record<string, readonly number[]>>,
    write: (content: string) => Promise<void>
): Promise<void> {
    await write('{');
    let first = true;
    for (const [key, values] of Object.entries(postings)) {
        if (!first) await write(',');
        first = false;
        await write(`${JSON.stringify(key)}:`);
        await writeArray(values, write);
    }
    await write('}');
}

async function writeArray(
    values: readonly unknown[],
    write: (content: string) => Promise<void>
): Promise<void> {
    await write('[');
    const chunkSize = 4_096;
    for (let start = 0; start < values.length; start += chunkSize) {
        if (start > 0) await write(',');
        const chunk = JSON.stringify(values.slice(start, start + chunkSize));
        await write(chunk.slice(1, -1));
    }
    await write(']');
}

export async function verifyRecipeCorpusIndexArtifact(
    directory: string
): Promise<{
    readonly manifest: RecipeCorpusIndexManifest;
    readonly index: RecipeCorpusIndex;
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
    const index = parseIndex(JSON.parse(lookupContent.toString('utf8')));
    verifyIndex(index, manifest);
    return { manifest, index };
}

function buildManifest(
    index: RecipeCorpusIndex,
    file: RecipeCorpusIndexManifest['file']
): RecipeCorpusIndexManifest {
    const counts = {
        recipes: index.records.length,
        products: Object.keys(index.postings.products).length,
        effects: Object.keys(index.postings.effects).length,
    };
    const body = manifestBody(index.corpus, counts, file);
    return {
        schema: 'neonschedule1-recipe-corpus-index-manifest-1',
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
    const expectedArtifactHash = sha256(jsonBytes(manifestBody(
        manifest.corpus,
        manifest.counts,
        manifest.file
    )));
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
): Omit<RecipeCorpusIndexManifest, 'schema' | 'artifactSha256'> {
    return {
        algorithmVersion: recipeCorpusIndexAlgorithmVersion,
        corpus,
        counts,
        file,
    };
}

function verifyIndex(
    index: RecipeCorpusIndex,
    manifest: RecipeCorpusIndexManifest
): void {
    if (index.algorithmVersion !== manifest.algorithmVersion ||
        JSON.stringify(index.corpus) !== JSON.stringify(manifest.corpus) ||
        index.records.length !== manifest.counts.recipes ||
        Object.keys(index.postings.products).length !== manifest.counts.products ||
        Object.keys(index.postings.effects).length !== manifest.counts.effects) {
        throw new Error('Recipe index lookup metadata differs from its manifest');
    }
    const recordCount = index.records.length;
    verifyPermutation(index.rankings.productValue, recordCount, 'product-value ranking');
    verifyPermutation(index.rankings.netValue, recordCount, 'net-value ranking');
    verifyPermutation(index.totalCostOrder, recordCount, 'total-cost order');
    for (let index_ = 1; index_ < index.totalCostOrder.length; index_++) {
        const previous = index.records[index.totalCostOrder[index_ - 1]!]!;
        const current = index.records[index.totalCostOrder[index_]!]!;
        if (previous.totalCost > current.totalCost) {
            throw new Error('Recipe index total-cost order is not ascending');
        }
    }
    for (const [kind, postings] of [
        ['product', index.postings.products],
        ['effect', index.postings.effects],
    ] as const) {
        for (const [key, ordinals] of Object.entries(postings)) {
            verifyPosting(ordinals, recordCount, `${kind} posting ${JSON.stringify(key)}`);
        }
    }
}

function verifyPermutation(values: readonly number[], count: number, label: string): void {
    if (values.length !== count) throw new Error(`Recipe index ${label} has the wrong length`);
    const seen = new Uint8Array(count);
    for (const value of values) {
        requireOrdinal(value, count, label);
        if (seen[value] === 1) throw new Error(`Recipe index ${label} repeats ordinal ${value}`);
        seen[value] = 1;
    }
}

function verifyPosting(values: readonly number[], count: number, label: string): void {
    for (let index = 0; index < values.length; index++) {
        const value = values[index]!;
        requireOrdinal(value, count, label);
        if (index > 0 && values[index - 1]! >= value) {
            throw new Error(`Recipe index ${label} must be sorted and unique`);
        }
    }
}

function requireOrdinal(value: number, count: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value >= count) {
        throw new Error(`Recipe index ${label} contains invalid ordinal ${value}`);
    }
}

function parseManifest(value: unknown): RecipeCorpusIndexManifest {
    const record = object(value, 'Recipe index manifest');
    if (record.schema !== 'neonschedule1-recipe-corpus-index-manifest-1' ||
        record.algorithmVersion !== recipeCorpusIndexAlgorithmVersion) {
        throw new Error('Recipe index manifest has an unsupported contract');
    }
    const corpus = object(record.corpus, 'Recipe index corpus identity');
    const counts = object(record.counts, 'Recipe index counts');
    const file = object(record.file, 'Recipe index file');
    if (file.path !== 'lookup.json') throw new Error('Recipe index has an unsupported file path');
    return {
        schema: record.schema,
        artifactSha256: hash(record.artifactSha256, 'artifactSha256'),
        algorithmVersion: record.algorithmVersion,
        corpus: {
            artifactSha256: hash(corpus.artifactSha256, 'corpus.artifactSha256'),
            coverageKey: hash(corpus.coverageKey, 'corpus.coverageKey'),
            datasetSha256: hash(corpus.datasetSha256, 'corpus.datasetSha256'),
        },
        counts: {
            recipes: integer(counts.recipes, 'counts.recipes'),
            products: integer(counts.products, 'counts.products'),
            effects: integer(counts.effects, 'counts.effects'),
        },
        file: {
            path: file.path,
            sha256: hash(file.sha256, 'file.sha256'),
            byteLength: integer(file.byteLength, 'file.byteLength'),
        },
    };
}

function parseIndex(value: unknown): RecipeCorpusIndex {
    const record = object(value, 'Recipe index');
    if (record.schema !== 'neonschedule1-recipe-corpus-index-1' ||
        record.algorithmVersion !== recipeCorpusIndexAlgorithmVersion) {
        throw new Error('Recipe index has an unsupported contract');
    }
    object(record.corpus, 'Recipe index corpus');
    array(record.records, 'Recipe index records');
    object(record.postings, 'Recipe index postings');
    object(record.rankings, 'Recipe index rankings');
    array(record.totalCostOrder, 'Recipe index totalCostOrder');
    return record as unknown as RecipeCorpusIndex;
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

function array(value: unknown, label: string): unknown[] {
    if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
    return value;
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
