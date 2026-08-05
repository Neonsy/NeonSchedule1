import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import {
    recipeCorpusAlgorithmVersion,
    type RecipeCorpusConfiguration,
    type RecipeCorpusDatasetIdentity,
    type RecipeCorpusPartition,
} from '#solver/precompute';

export interface RecipeCorpusFile {
    readonly path: string;
    readonly sha256: string;
    readonly byteLength: number;
    readonly productId: string;
    readonly drugType: string;
    readonly resultDepth: number;
    readonly recipeCount: number;
}

export interface RecipeCorpusManifest {
    readonly schema: 'neonschedule1-recipe-corpus-manifest-1';
    readonly artifactSha256: string;
    readonly coverageKey: string;
    readonly algorithmVersion: string;
    readonly dataset: RecipeCorpusDatasetIdentity;
    readonly configuration: RecipeCorpusConfiguration;
    readonly semantics: 'cheapest-representative-per-ordered-effect-state';
    readonly estimatedOrderedSequences: string;
    readonly proofStatus: 'exact';
    readonly counts: {
        readonly products: number;
        readonly ingredients: number;
        readonly partitions: number;
        readonly recipes: number;
    };
    readonly files: readonly RecipeCorpusFile[];
}

export function describeCorpusFile(
    relativePath: string,
    content: Uint8Array,
    partition: RecipeCorpusPartition
): RecipeCorpusFile {
    return {
        path: safeRelativePath(relativePath),
        sha256: sha256(content),
        byteLength: content.byteLength,
        productId: partition.coverage.productId,
        drugType: partition.coverage.drugType,
        resultDepth: partition.coverage.resultDepth,
        recipeCount: partition.recipes.length,
    };
}

export function buildRecipeCorpusManifest(
    dataset: RecipeCorpusDatasetIdentity,
    configuration: RecipeCorpusConfiguration,
    estimatedOrderedSequences: string,
    files: readonly RecipeCorpusFile[]
): RecipeCorpusManifest {
    const sortedFiles = [...files].sort((left, right) => left.path.localeCompare(right.path));
    const coverageKey = sha256(
        jsonBytes({
            algorithmVersion: recipeCorpusAlgorithmVersion,
            dataset,
            configuration,
        })
    );
    const body = manifestBody(
        coverageKey,
        dataset,
        configuration,
        estimatedOrderedSequences,
        sortedFiles
    );
    return {
        schema: 'neonschedule1-recipe-corpus-manifest-1',
        artifactSha256: sha256(jsonBytes(body)),
        ...body,
    };
}

export async function verifyRecipeCorpusArtifact(
    directory: string
): Promise<RecipeCorpusManifest> {
    const resolvedDirectory = path.resolve(directory);
    if (!(await stat(resolvedDirectory).catch(() => null))?.isDirectory()) {
        throw new Error(`Recipe corpus directory does not exist: ${resolvedDirectory}`);
    }
    const manifest = parseManifest(
        JSON.parse(await readFile(path.join(resolvedDirectory, 'manifest.json'), 'utf8'))
    );
    const expectedArtifactHash = sha256(
        jsonBytes(
            manifestBody(
                manifest.coverageKey,
                manifest.dataset,
                manifest.configuration,
                manifest.estimatedOrderedSequences,
                manifest.files
            )
        )
    );
    if (manifest.artifactSha256 !== expectedArtifactHash) {
        throw new Error('Recipe corpus manifest failed artifact identity verification');
    }
    const expectedCoverageKey = sha256(
        jsonBytes({
            algorithmVersion: manifest.algorithmVersion,
            dataset: manifest.dataset,
            configuration: manifest.configuration,
        })
    );
    if (manifest.coverageKey !== expectedCoverageKey) {
        throw new Error('Recipe corpus manifest failed coverage-key verification');
    }

    if (manifest.counts.products !== manifest.configuration.productIds.length ||
        manifest.counts.ingredients !== manifest.configuration.ingredientIds.length ||
        manifest.counts.partitions !== manifest.files.length) {
        throw new Error('Recipe corpus manifest counts are inconsistent');
    }

    const expectedPartitions = new Set(
        manifest.configuration.productIds.flatMap((productId) =>
            Array.from(
                { length: manifest.configuration.maxIngredients + 1 },
                (_, depth) => JSON.stringify([productId, depth])
            )
        )
    );
    const paths = new Set<string>();
    const effectStatesByProduct = new Map<string, Set<string>>();

    let recipeCount = 0;
    for (const file of manifest.files) {
        if (paths.has(file.path)) throw new Error(`Duplicate recipe corpus path: ${file.path}`);
        paths.add(file.path);
        const partitionKey = JSON.stringify([file.productId, file.resultDepth]);
        if (!expectedPartitions.delete(partitionKey)) {
            throw new Error(`Unexpected recipe corpus partition: ${partitionKey}`);
        }
        const content = await readFile(resolveFile(resolvedDirectory, file.path));
        if (content.byteLength !== file.byteLength || sha256(content) !== file.sha256) {
            throw new Error(`Recipe corpus partition failed integrity verification: ${file.path}`);
        }
        const partition = parsePartition(JSON.parse(content.toString('utf8')), file.path);
        verifyPartition(partition, file, manifest, effectStatesByProduct);
        recipeCount += partition.recipes.length;
    }
    if (expectedPartitions.size > 0) {
        throw new Error(`Recipe corpus is missing ${expectedPartitions.size} configured partitions`);
    }
    if (recipeCount !== manifest.counts.recipes) {
        throw new Error(
            `Recipe corpus contains ${recipeCount} recipes, manifest declares ${manifest.counts.recipes}`
        );
    }
    return manifest;
}

function manifestBody(
    coverageKey: string,
    dataset: RecipeCorpusDatasetIdentity,
    configuration: RecipeCorpusConfiguration,
    estimatedOrderedSequences: string,
    files: readonly RecipeCorpusFile[]
): Omit<RecipeCorpusManifest, 'schema' | 'artifactSha256'> {
    return {
        coverageKey,
        algorithmVersion: recipeCorpusAlgorithmVersion,
        dataset,
        configuration,
        semantics: 'cheapest-representative-per-ordered-effect-state',
        estimatedOrderedSequences,
        proofStatus: 'exact',
        counts: {
            products: configuration.productIds.length,
            ingredients: configuration.ingredientIds.length,
            partitions: files.length,
            recipes: files.reduce((total, file) => total + file.recipeCount, 0),
        },
        files,
    };
}

function verifyPartition(
    partition: RecipeCorpusPartition,
    file: RecipeCorpusFile,
    manifest: RecipeCorpusManifest,
    effectStatesByProduct: Map<string, Set<string>>
): void {
    if (partition.algorithmVersion !== manifest.algorithmVersion ||
        JSON.stringify(partition.dataset) !== JSON.stringify(manifest.dataset)) {
        throw new Error(`Recipe corpus partition has different provenance: ${file.path}`);
    }
    if (partition.coverage.productId !== file.productId ||
        partition.coverage.drugType !== file.drugType ||
        partition.coverage.resultDepth !== file.resultDepth ||
        partition.recipes.length !== file.recipeCount) {
        throw new Error(`Recipe corpus partition metadata differs from manifest: ${file.path}`);
    }
    if (partition.coverage.mode !== manifest.configuration.mode ||
        partition.coverage.semantics !== manifest.semantics ||
        partition.coverage.maxIngredients !== manifest.configuration.maxIngredients ||
        JSON.stringify(partition.coverage.ingredientIds) !==
            JSON.stringify(manifest.configuration.ingredientIds) ||
        JSON.stringify(partition.coverage.requiredEffectIds) !==
            JSON.stringify(manifest.configuration.requiredEffectIds) ||
        JSON.stringify(partition.coverage.forbiddenEffectIds) !==
            JSON.stringify(manifest.configuration.forbiddenEffectIds)) {
        throw new Error(`Recipe corpus partition has different coverage: ${file.path}`);
    }
    if (partition.proof.proofStatus !== 'exact' ||
        partition.proof.completedDepth !== manifest.configuration.maxIngredients) {
        throw new Error(`Recipe corpus partition lacks exact completion proof: ${file.path}`);
    }
    const effectStates = effectStatesByProduct.get(file.productId) ?? new Set<string>();
    effectStatesByProduct.set(file.productId, effectStates);
    for (const recipe of partition.recipes) {
        if (recipe.productId !== file.productId || recipe.drugType !== file.drugType ||
            recipe.depth !== file.resultDepth || recipe.ingredientIds.length !== recipe.depth) {
            throw new Error(`Recipe corpus entry is outside its partition: ${file.path}`);
        }
        const effectState = JSON.stringify(recipe.effectIds);
        if (effectStates.has(effectState)) {
            throw new Error(`Recipe corpus repeats an effect state for ${file.productId}`);
        }
        effectStates.add(effectState);
        if (recipe.costs.total !== recipe.costs.baseProduct + recipe.costs.ingredients ||
            recipe.netValue !== recipe.productValue - recipe.costs.total) {
            throw new Error(`Recipe corpus entry has inconsistent value inputs: ${file.path}`);
        }
    }
}

function parseManifest(value: unknown): RecipeCorpusManifest {
    const record = object(value, 'Recipe corpus manifest');
    if (record.schema !== 'neonschedule1-recipe-corpus-manifest-1' ||
        record.algorithmVersion !== recipeCorpusAlgorithmVersion ||
        record.semantics !== 'cheapest-representative-per-ordered-effect-state' ||
        record.proofStatus !== 'exact') {
        throw new Error('Recipe corpus manifest has an unsupported contract');
    }
    const dataset = object(record.dataset, 'Recipe corpus dataset');
    const configuration = object(record.configuration, 'Recipe corpus configuration');
    if (configuration.mode !== 'selective') {
        throw new Error('Recipe corpus configuration must be selective');
    }
    const parsedConfiguration: RecipeCorpusConfiguration = {
        mode: configuration.mode,
        productIds: uniqueStringArray(configuration.productIds, 'configuration.productIds'),
        ingredientIds: uniqueStringArray(
            configuration.ingredientIds,
            'configuration.ingredientIds'
        ),
        maxIngredients: integer(configuration.maxIngredients, 'configuration.maxIngredients'),
        maxStates: positiveInteger(configuration.maxStates, 'configuration.maxStates'),
        requiredEffectIds: uniqueStringArray(
            configuration.requiredEffectIds,
            'configuration.requiredEffectIds'
        ),
        forbiddenEffectIds: uniqueStringArray(
            configuration.forbiddenEffectIds,
            'configuration.forbiddenEffectIds'
        ),
    };
    if (parsedConfiguration.productIds.length === 0 ||
        parsedConfiguration.ingredientIds.length === 0) {
        throw new Error('Recipe corpus configuration needs products and ingredients');
    }
    for (const effectId of parsedConfiguration.requiredEffectIds) {
        if (parsedConfiguration.forbiddenEffectIds.includes(effectId)) {
            throw new Error(`Recipe corpus effect ${JSON.stringify(effectId)} is contradictory`);
        }
    }
    const parsedDataset: RecipeCorpusDatasetIdentity = {
        gameVersion: string(dataset.gameVersion, 'dataset.gameVersion'),
        datasetSha256: hash(dataset.datasetSha256, 'dataset.datasetSha256'),
        normalizerVersion: string(dataset.normalizerVersion, 'dataset.normalizerVersion'),
    };
    const files = array(record.files, 'Recipe corpus manifest files').map((value, index) => {
        const file = object(value, `Recipe corpus file ${index}`);
        return {
            path: safeRelativePath(string(file.path, 'file.path')),
            sha256: hash(file.sha256, 'file.sha256'),
            byteLength: integer(file.byteLength, 'file.byteLength'),
            productId: string(file.productId, 'file.productId'),
            drugType: string(file.drugType, 'file.drugType'),
            resultDepth: integer(file.resultDepth, 'file.resultDepth'),
            recipeCount: integer(file.recipeCount, 'file.recipeCount'),
        };
    });
    const counts = object(record.counts, 'Recipe corpus counts');
    return {
        schema: record.schema,
        artifactSha256: hash(record.artifactSha256, 'artifactSha256'),
        coverageKey: hash(record.coverageKey, 'coverageKey'),
        algorithmVersion: record.algorithmVersion,
        dataset: parsedDataset,
        configuration: parsedConfiguration,
        semantics: record.semantics,
        estimatedOrderedSequences: integerString(
            record.estimatedOrderedSequences,
            'estimatedOrderedSequences'
        ),
        proofStatus: record.proofStatus,
        counts: {
            products: integer(counts.products, 'counts.products'),
            ingredients: integer(counts.ingredients, 'counts.ingredients'),
            partitions: integer(counts.partitions, 'counts.partitions'),
            recipes: integer(counts.recipes, 'counts.recipes'),
        },
        files,
    };
}

function parsePartition(value: unknown, file: string): RecipeCorpusPartition {
    const record = object(value, file);
    if (record.schema !== 'neonschedule1-recipe-corpus-partition-1') {
        throw new Error(`Recipe corpus partition has an unsupported schema: ${file}`);
    }
    object(record.dataset, `${file}.dataset`);
    object(record.coverage, `${file}.coverage`);
    object(record.proof, `${file}.proof`);
    array(record.recipes, `${file}.recipes`);
    return record as unknown as RecipeCorpusPartition;
}

function resolveFile(root: string, relativePath: string): string {
    const resolved = path.resolve(root, ...safeRelativePath(relativePath).split('/'));
    if (!resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error(`Recipe corpus path escapes its root: ${relativePath}`);
    }
    return resolved;
}

function safeRelativePath(value: string): string {
    const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
    if (normalized === '.' || normalized === '..' || normalized.startsWith('../') ||
        normalized.startsWith('/') || /^[a-zA-Z]:/u.test(normalized)) {
        throw new Error(`Unsafe recipe corpus path: ${value}`);
    }
    return normalized;
}

function jsonBytes(value: unknown): Buffer {
    return Buffer.from(JSON.stringify(value), 'utf8');
}

function sha256(content: Uint8Array): string {
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

function positiveInteger(value: unknown, label: string): number {
    const result = integer(value, label);
    if (result < 1) throw new Error(`${label} must be positive`);
    return result;
}

function uniqueStringArray(value: unknown, label: string): string[] {
    const result = array(value, label).map((entry, index) =>
        string(entry, `${label}[${index}]`)
    );
    for (let index = 0; index < result.length; index++) {
        if (index > 0 && result[index - 1]! >= result[index]!) {
            throw new Error(`${label} must be sorted and unique`);
        }
    }
    return result;
}

function integerString(value: unknown, label: string): string {
    const result = string(value, label);
    if (!/^(0|[1-9][0-9]*)$/u.test(result)) throw new Error(`${label} must be an integer string`);
    return result;
}
