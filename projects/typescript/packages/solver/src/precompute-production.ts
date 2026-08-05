import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { SolverDataset } from '#solver/dataset';
import { CustomerCorpusRecommendationLookup } from '#solver/precompute-customer';
import { RecipeCorpusLookup } from '#solver/precompute-query';
import {
    readRecipeCorpusProductionSelection,
    type RecipeCorpusProductionSelection,
} from '#solver/precompute-refresh';
import { identity } from '#solver/precompute';

export interface RecipeCorpusProductionLoadOptions {
    readonly outputRoot: string;
    readonly reportRoot: string;
}

export interface LoadedRecipeCorpusProduction {
    readonly selection: RecipeCorpusProductionSelection;
    readonly selectionPath: string;
    readonly corpusDirectory: string;
    readonly indexDirectory: string;
    readonly reportPath: string;
    readonly recipes: RecipeCorpusLookup;
    readonly customers: CustomerCorpusRecommendationLookup;
}

export async function loadRecipeCorpusProduction(
    dataset: SolverDataset,
    options: RecipeCorpusProductionLoadOptions
): Promise<LoadedRecipeCorpusProduction> {
    const outputRoot = path.resolve(options.outputRoot);
    const reportRoot = path.resolve(options.reportRoot);
    const selectionPath = childPath(outputRoot, 'production.json');
    const selection = await readRecipeCorpusProductionSelection(selectionPath);
    requireSame(
        'Production selection dataset',
        identity(dataset),
        selection.dataset
    );

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
    const reportPath = childPath(reportRoot, selection.verification.reportFile);
    await verifySelectedReport(reportPath, selection);

    const recipes = await RecipeCorpusLookup.load(corpusDirectory, indexDirectory);
    requireSame(
        'Production selection corpus dataset',
        recipes.corpusManifest.dataset,
        selection.dataset
    );
    requireSame(
        'Production selection corpus configuration',
        recipes.corpusManifest.configuration,
        selection.configuration
    );
    requireEqual(
        'Production selection corpus artifact',
        recipes.corpusManifest.artifactSha256,
        selection.corpus.artifactSha256
    );
    requireEqual(
        'Production selection corpus coverage',
        recipes.corpusManifest.coverageKey,
        selection.corpus.coverageKey
    );
    requireEqual(
        'Production selection corpus algorithm',
        recipes.corpusManifest.algorithmVersion,
        selection.corpus.algorithmVersion
    );
    requireEqual(
        'Production selection index artifact',
        recipes.indexManifest.artifactSha256,
        selection.index.artifactSha256
    );
    requireEqual(
        'Production selection index algorithm',
        recipes.indexManifest.algorithmVersion,
        selection.index.algorithmVersion
    );

    return {
        selection,
        selectionPath,
        corpusDirectory,
        indexDirectory,
        reportPath,
        recipes,
        customers: new CustomerCorpusRecommendationLookup(
            recipes,
            dataset.customerCatalog
        ),
    };
}

async function verifySelectedReport(
    reportPath: string,
    selection: RecipeCorpusProductionSelection
): Promise<void> {
    const content = await readFile(reportPath);
    if (sha256(content) !== selection.verification.reportSha256) {
        throw new Error('Production verification report failed integrity verification');
    }
    const report = object(
        JSON.parse(content.toString('utf8')),
        'Production verification report'
    );
    if (report.schema !== 'neonschedule1-recipe-index-verification-2') {
        throw new Error('Production verification report has an unsupported contract');
    }
    const dataset = object(report.dataset, 'Production verification report dataset');
    const configuration = object(
        report.configuration,
        'Production verification report configuration'
    );
    const recipeCases = array(report.recipeCases, 'Production verification recipe cases');
    const customerCases = array(
        report.customerCases,
        'Production verification customer cases'
    );
    const reportIdentity = {
        gameVersion: string(dataset.gameVersion, 'verification dataset gameVersion'),
        datasetSha256: string(dataset.datasetSha256, 'verification dataset datasetSha256'),
        normalizerVersion: string(
            dataset.normalizerVersion,
            'verification dataset normalizerVersion'
        ),
    };
    requireSame('Production verification report dataset', reportIdentity, selection.dataset);
    requireEqual(
        'Production verification report corpus artifact',
        string(report.corpusArtifactSha256, 'verification corpusArtifactSha256'),
        selection.corpus.artifactSha256
    );
    requireEqual(
        'Production verification report index artifact',
        string(report.indexArtifactSha256, 'verification indexArtifactSha256'),
        selection.index.artifactSha256
    );
    requireEqual(
        'Production verification report creation time',
        string(report.createdAt, 'verification createdAt'),
        selection.verification.createdAt
    );
    positiveInteger(configuration.limit, 'verification limit');
    requireCount(
        recipeCases,
        configuration.recipeCaseCount,
        selection.verification.recipeCaseCount,
        'recipe'
    );
    requireCount(
        customerCases,
        configuration.customerCaseCount,
        selection.verification.customerCaseCount,
        'customer'
    );
}

function childPath(root: string, ...segments: readonly string[]): string {
    const result = path.resolve(root, ...segments);
    const relative = path.relative(root, result);
    if (relative.length === 0 || relative === '..' ||
        relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Production artifact path escapes its configured root: ${result}`);
    }
    return result;
}

function requireCount(
    cases: readonly unknown[],
    reportCount: unknown,
    selectionCount: number,
    label: string
): void {
    const count = positiveInteger(reportCount, `verification ${label}CaseCount`);
    if (cases.length !== count || count !== selectionCount) {
        throw new Error(`Production verification ${label} case counts differ`);
    }
}

function requireSame(label: string, actual: unknown, expected: unknown): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${label} differs from the selected identity`);
    }
}

function requireEqual(label: string, actual: string, expected: string): void {
    if (actual !== expected) throw new Error(`${label} differs from the selected identity`);
}

function object(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function array(value: unknown, label: string): readonly unknown[] {
    if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
    return value;
}

function string(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`${label} must be a string`);
    }
    return value;
}

function positiveInteger(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 1) {
        throw new Error(`${label} must be a positive safe integer`);
    }
    return value as number;
}

function sha256(content: Uint8Array): string {
    return createHash('sha256').update(content).digest('hex');
}
