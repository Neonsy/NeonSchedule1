import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import type { SolverDataset } from '#solver/dataset';
import {
    loadRecipeCorpusProduction,
    type LoadedRecipeCorpusProduction,
    type RecipeCorpusProductionLoadOptions,
} from '#solver/precompute-production';
import {
    readRecipeCorpusProductionSelection,
    type RecipeCorpusProductionSelection,
} from '#solver/precompute-refresh';

export interface RecipeCorpusPackageOptions extends RecipeCorpusProductionLoadOptions {
    readonly packageRoot: string;
}

export interface PackagedRecipeCorpusProduction {
    readonly packageDirectory: string;
    readonly production: LoadedRecipeCorpusProduction;
}

interface ProductionPackageSource {
    readonly selection: RecipeCorpusProductionSelection;
    readonly selectionPath: string;
    readonly corpusDirectory: string;
    readonly corpusFiles: readonly string[];
    readonly indexDirectory: string;
    readonly indexFile: string;
    readonly reportPath: string;
}

export async function packageRecipeCorpusProduction(
    dataset: SolverDataset,
    options: RecipeCorpusPackageOptions
): Promise<PackagedRecipeCorpusProduction> {
    const source = await productionPackageSource(options);
    const packageRoot = path.resolve(options.packageRoot);
    const packageDirectory = childPath(
        packageRoot,
        source.selection.selectionSha256
    );
    await mkdir(packageRoot, { recursive: true });
    if (await exists(packageDirectory)) {
        return loadExistingPackage(
            dataset,
            packageDirectory,
            source.selection.selectionSha256
        );
    }

    const staging = childPath(
        packageRoot,
        `.${source.selection.selectionSha256}.${randomUUID()}.tmp`
    );
    await mkdir(staging);
    let published = false;
    try {
        await copyProductionFiles(source, staging);
        try {
            await rename(staging, packageDirectory);
            published = true;
        } catch (error) {
            if (!hasCode(error, 'EEXIST') && !hasCode(error, 'ENOTEMPTY')) throw error;
            await rm(staging, { recursive: true, force: true });
            return loadExistingPackage(
                dataset,
                packageDirectory,
                source.selection.selectionSha256
            );
        }
        const production = await loadPackagedRecipeCorpusProduction(
            dataset,
            packageDirectory
        );
        requireSameSelection(production, source.selection.selectionSha256);
        return {
            packageDirectory,
            production,
        };
    } catch (error) {
        await rm(staging, { recursive: true, force: true });
        if (published) {
            await rm(packageDirectory, { recursive: true, force: true });
        }
        throw error;
    }
}

export async function loadPackagedRecipeCorpusProduction(
    dataset: SolverDataset,
    packageDirectory: string
): Promise<LoadedRecipeCorpusProduction> {
    const root = path.resolve(packageDirectory);
    return loadRecipeCorpusProduction(dataset, {
        outputRoot: root,
        reportRoot: childPath(root, 'reports'),
    });
}

async function loadExistingPackage(
    dataset: SolverDataset,
    packageDirectory: string,
    selectionSha256: string
): Promise<PackagedRecipeCorpusProduction> {
    const production = await loadPackagedRecipeCorpusProduction(
        dataset,
        packageDirectory
    );
    requireSameSelection(production, selectionSha256);
    return { packageDirectory, production };
}

async function productionPackageSource(
    options: RecipeCorpusProductionLoadOptions
): Promise<ProductionPackageSource> {
    const outputRoot = path.resolve(options.outputRoot);
    const reportRoot = path.resolve(options.reportRoot);
    const selectionPath = childPath(outputRoot, 'production.json');
    const selection = await readRecipeCorpusProductionSelection(selectionPath);
    const corpusDirectory = childPath(
        outputRoot,
        selection.dataset.gameVersion,
        selection.dataset.datasetSha256,
        selection.corpus.artifactSha256
    );
    const indexDirectory = childPath(
        outputRoot,
        'indexes',
        selection.corpus.artifactSha256,
        selection.index.artifactSha256
    );
    return {
        selection,
        selectionPath,
        corpusDirectory,
        corpusFiles: await manifestFiles(
            childPath(corpusDirectory, 'manifest.json'),
            'files'
        ),
        indexDirectory,
        indexFile: await manifestFile(
            childPath(indexDirectory, 'manifest.json'),
            'file'
        ),
        reportPath: childPath(reportRoot, selection.verification.reportFile),
    };
}

async function copyProductionFiles(
    source: ProductionPackageSource,
    destination: string
): Promise<void> {
    await copy(source.selectionPath, childPath(destination, 'production.json'));
    const corpusDirectory = childPath(
        destination,
        source.selection.dataset.gameVersion,
        source.selection.dataset.datasetSha256,
        source.selection.corpus.artifactSha256
    );
    await copy(source.corpusDirectory, corpusDirectory, [
        'manifest.json',
        ...source.corpusFiles,
    ]);
    const indexDirectory = childPath(
        destination,
        'indexes',
        source.selection.corpus.artifactSha256,
        source.selection.index.artifactSha256
    );
    await copy(source.indexDirectory, indexDirectory, [
        'manifest.json',
        source.indexFile,
    ]);
    await copy(
        source.reportPath,
        childPath(destination, 'reports', source.selection.verification.reportFile)
    );
}

async function copy(
    source: string,
    destination: string,
    relativePaths?: readonly string[]
): Promise<void> {
    if (relativePaths === undefined) {
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(source, destination);
        return;
    }
    for (const relativePath of relativePaths) {
        await copy(
            childPath(source, relativePath),
            childPath(destination, relativePath)
        );
    }
}

function requireSameSelection(
    actual: LoadedRecipeCorpusProduction,
    selectionSha256: string
): void {
    if (actual.selection.selectionSha256 !== selectionSha256) {
        throw new Error('Existing production package contains a different selection');
    }
}

async function manifestFiles(manifestPath: string, field: string): Promise<string[]> {
    const manifest = object(
        JSON.parse(await readFile(manifestPath, 'utf8')),
        'Corpus manifest'
    );
    const files = manifest[field];
    if (!Array.isArray(files)) throw new Error(`Corpus manifest ${field} must be an array`);
    return files.map((entry, index) => {
        const file = object(entry, `Corpus manifest ${field}[${index}]`);
        return string(file.path, `Corpus manifest ${field}[${index}].path`);
    });
}

async function manifestFile(manifestPath: string, field: string): Promise<string> {
    const manifest = object(
        JSON.parse(await readFile(manifestPath, 'utf8')),
        'Index manifest'
    );
    const file = object(manifest[field], `Index manifest ${field}`);
    return string(file.path, `Index manifest ${field}.path`);
}

function object(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`${label} must be a non-empty string`);
    }
    return value;
}

async function exists(target: string): Promise<boolean> {
    return (await stat(target).catch(() => null)) !== null;
}

function childPath(root: string, ...segments: readonly string[]): string {
    const result = path.resolve(root, ...segments);
    const relative = path.relative(root, result);
    if (relative.length === 0 || relative === '..' ||
        relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Production package path escapes its configured root: ${result}`);
    }
    return result;
}

function hasCode(error: unknown, code: string): boolean {
    return typeof error === 'object' && error !== null &&
        'code' in error && error.code === code;
}
