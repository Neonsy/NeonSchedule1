import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { SolverDataset } from '#solver/dataset';
import type {
    RecipeCorpusIndexManifest,
} from '#solver/precompute-index-artifact';
import { writeRecipeCorpusIndexArtifact } from '#solver/precompute-index-artifact';
import { RecipeCorpusLookup } from '#solver/precompute-query';
import {
    writeRecipeCorpusArtifact,
    type RecipeCorpusRunProgress,
} from '#solver/precompute-run';
import {
    runRecipeIndexVerification,
    type CustomerIndexVerificationCase,
    type RecipeIndexVerificationCase,
    type RecipeIndexVerificationReport,
} from '#solver/precompute-verify';
import type {
    RecipeCorpusConfiguration,
    RecipeCorpusDatasetIdentity,
    RecipeCorpusPlan,
} from '#solver/precompute';
import type { RecipeCorpusManifest } from '#solver/precompute-artifact';

export interface RecipeCorpusProductionSelection {
    readonly schema: 'neonschedule1-recipe-corpus-production-selection-1';
    readonly selectionSha256: string;
    readonly selectedAt: string;
    readonly dataset: RecipeCorpusDatasetIdentity;
    readonly configuration: RecipeCorpusConfiguration;
    readonly corpus: {
        readonly artifactSha256: string;
        readonly coverageKey: string;
        readonly algorithmVersion: string;
    };
    readonly index: {
        readonly artifactSha256: string;
        readonly algorithmVersion: string;
    };
    readonly verification: {
        readonly reportFile: string;
        readonly reportSha256: string;
        readonly createdAt: string;
        readonly recipeCaseCount: number;
        readonly customerCaseCount: number;
    };
}

export interface RecipeCorpusRefreshOptions {
    readonly outputRoot: string;
    readonly reportRoot: string;
    readonly verificationLimit: number;
    readonly onCorpusProgress?: (progress: RecipeCorpusRunProgress) => void;
    readonly onRecipeVerification?: (
        completed: number,
        total: number,
        result: RecipeIndexVerificationCase
    ) => void;
    readonly onCustomerVerification?: (
        completed: number,
        total: number,
        result: CustomerIndexVerificationCase
    ) => void;
}

export interface RecipeCorpusRefreshResult {
    readonly corpusDirectory: string;
    readonly indexDirectory: string;
    readonly reportPath: string;
    readonly selectionPath: string;
    readonly selection: RecipeCorpusProductionSelection;
}

interface VerificationReportArtifact {
    readonly fileName: string;
    readonly path: string;
    readonly sha256: string;
}

interface RefreshLock {
    readonly schema: 'neonschedule1-recipe-corpus-refresh-lock-1';
    readonly token: string;
    readonly pid: number;
    readonly startedAt: string;
}

export async function refreshRecipeCorpusProduction(
    dataset: SolverDataset,
    plan: RecipeCorpusPlan,
    options: RecipeCorpusRefreshOptions
): Promise<RecipeCorpusRefreshResult> {
    if (plan.dataset !== dataset) {
        throw new Error('Recipe corpus refresh plan belongs to a different dataset object');
    }
    if (plan.configuration.mode !== 'exhaustive') {
        throw new Error('Recipe corpus production refresh requires exhaustive coverage');
    }
    requirePositiveInteger(options.verificationLimit, 'verificationLimit');
    const outputRoot = path.resolve(options.outputRoot);
    const reportRoot = path.resolve(options.reportRoot);
    await mkdir(outputRoot, { recursive: true });
    const release = await acquireLock(path.join(outputRoot, '.refresh.lock'));
    try {
        const corpus = await writeRecipeCorpusArtifact(
            outputRoot,
            plan,
            options.onCorpusProgress
        );
        const index = await writeRecipeCorpusIndexArtifact(
            path.join(outputRoot, 'indexes'),
            corpus.directory
        );
        const lookup = await RecipeCorpusLookup.load(corpus.directory, index.directory);
        const report = await runRecipeIndexVerification(
            dataset,
            lookup,
            options.verificationLimit,
            options.onRecipeVerification,
            options.onCustomerVerification
        );
        const reportArtifact = await writeVerificationReport(reportRoot, report);
        const selection = buildSelection(
            corpus.manifest,
            index.manifest,
            report,
            reportArtifact
        );
        const selectionPath = path.join(outputRoot, 'production.json');
        await writeAtomicReplacement(
            selectionPath,
            Buffer.from(`${JSON.stringify(selection, null, 2)}\n`, 'utf8')
        );
        return {
            corpusDirectory: corpus.directory,
            indexDirectory: index.directory,
            reportPath: reportArtifact.path,
            selectionPath,
            selection,
        };
    } finally {
        await release();
    }
}

export async function readRecipeCorpusProductionSelection(
    selectionPath: string
): Promise<RecipeCorpusProductionSelection> {
    const selection = parseSelection(JSON.parse(await readFile(selectionPath, 'utf8')));
    const expectedHash = sha256(jsonBytes(selectionBody(selection)));
    if (selection.selectionSha256 !== expectedHash) {
        throw new Error('Recipe corpus production selection failed identity verification');
    }
    return selection;
}

function buildSelection(
    corpus: RecipeCorpusManifest,
    index: RecipeCorpusIndexManifest,
    report: RecipeIndexVerificationReport,
    reportArtifact: VerificationReportArtifact
): RecipeCorpusProductionSelection {
    if (index.corpus.artifactSha256 !== corpus.artifactSha256 ||
        index.corpus.coverageKey !== corpus.coverageKey ||
        index.corpus.datasetSha256 !== corpus.dataset.datasetSha256) {
        throw new Error('Recipe corpus refresh index belongs to a different corpus');
    }
    if (report.corpusArtifactSha256 !== corpus.artifactSha256 ||
        report.indexArtifactSha256 !== index.artifactSha256 ||
        report.dataset.datasetSha256 !== corpus.dataset.datasetSha256 ||
        report.dataset.gameVersion !== corpus.dataset.gameVersion ||
        report.dataset.normalizerVersion !== corpus.dataset.normalizerVersion) {
        throw new Error('Recipe corpus refresh report belongs to different artifacts');
    }
    const body = {
        selectedAt: new Date().toISOString(),
        dataset: corpus.dataset,
        configuration: corpus.configuration,
        corpus: {
            artifactSha256: corpus.artifactSha256,
            coverageKey: corpus.coverageKey,
            algorithmVersion: corpus.algorithmVersion,
        },
        index: {
            artifactSha256: index.artifactSha256,
            algorithmVersion: index.algorithmVersion,
        },
        verification: {
            reportFile: reportArtifact.fileName,
            reportSha256: reportArtifact.sha256,
            createdAt: report.createdAt,
            recipeCaseCount: report.recipeCases.length,
            customerCaseCount: report.customerCases.length,
        },
    };
    return {
        schema: 'neonschedule1-recipe-corpus-production-selection-1',
        selectionSha256: sha256(jsonBytes(body)),
        ...body,
    };
}

async function writeVerificationReport(
    reportRoot: string,
    report: RecipeIndexVerificationReport
): Promise<VerificationReportArtifact> {
    await mkdir(reportRoot, { recursive: true });
    const content = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8');
    const fileName = `recipe-index-${report.indexArtifactSha256.slice(0, 12)}-` +
        `${report.createdAt.replaceAll(':', '-')}.json`;
    const output = path.join(reportRoot, fileName);
    await writeAtomicNew(output, content);
    return { fileName, path: output, sha256: sha256(content) };
}

async function writeAtomicNew(output: string, content: Uint8Array): Promise<void> {
    const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, content, { flag: 'wx' });
        await link(temporary, output);
    } finally {
        await rm(temporary, { force: true });
    }
}

async function writeAtomicReplacement(output: string, content: Uint8Array): Promise<void> {
    await mkdir(path.dirname(output), { recursive: true });
    const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, content, { flag: 'wx' });
        await rename(temporary, output);
    } finally {
        await rm(temporary, { force: true });
    }
}

async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
    const lock: RefreshLock = {
        schema: 'neonschedule1-recipe-corpus-refresh-lock-1',
        token: randomUUID(),
        pid: process.pid,
        startedAt: new Date().toISOString(),
    };
    const candidate = `${lockPath}.${lock.token}.candidate`;
    try {
        await writeFile(candidate, `${JSON.stringify(lock)}\n`, { flag: 'wx' });
        await link(candidate, lockPath);
    } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error;
        const owner = await readLock(lockPath);
        if (owner !== null && processExists(owner.pid)) {
            throw new Error(`Recipe corpus refresh is already running in process ${owner.pid}`);
        }
        if (owner !== null) {
            throw new Error(
                `Recipe corpus refresh has a stale lock from process ${owner.pid}: ${lockPath}`
            );
        }
        throw new Error(`Recipe corpus refresh lock cannot be verified: ${lockPath}`);
    } finally {
        await rm(candidate, { force: true });
    }
    return async () => {
        const current = await readLock(lockPath);
        if (current?.token === lock.token) await rm(lockPath, { force: true });
    };
}

async function readLock(lockPath: string): Promise<RefreshLock | null> {
    try {
        const value = JSON.parse(await readFile(lockPath, 'utf8')) as Partial<RefreshLock>;
        return value.schema === 'neonschedule1-recipe-corpus-refresh-lock-1' &&
            typeof value.token === 'string' && value.token.length > 0 &&
            Number.isSafeInteger(value.pid) && value.pid! > 0 &&
            typeof value.startedAt === 'string' && isIsoDate(value.startedAt)
            ? value as RefreshLock
            : null;
    } catch {
        return null;
    }
}

function processExists(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return !hasCode(error, 'ESRCH');
    }
}

function parseSelection(value: unknown): RecipeCorpusProductionSelection {
    const record = object(value, 'Recipe corpus production selection');
    if (record.schema !== 'neonschedule1-recipe-corpus-production-selection-1') {
        throw new Error('Recipe corpus production selection has an unsupported contract');
    }
    const dataset = object(record.dataset, 'selection.dataset');
    const configuration = object(record.configuration, 'selection.configuration');
    const corpus = object(record.corpus, 'selection.corpus');
    const index = object(record.index, 'selection.index');
    const verification = object(record.verification, 'selection.verification');
    return {
        schema: record.schema,
        selectionSha256: hash(record.selectionSha256, 'selectionSha256'),
        selectedAt: date(record.selectedAt, 'selectedAt'),
        dataset: {
            gameVersion: string(dataset.gameVersion, 'dataset.gameVersion'),
            datasetSha256: hash(dataset.datasetSha256, 'dataset.datasetSha256'),
            normalizerVersion: string(dataset.normalizerVersion, 'dataset.normalizerVersion'),
        },
        configuration: {
            mode: configuration.mode === 'exhaustive' ? 'exhaustive' : failMode(),
            productIds: strings(configuration.productIds, 'configuration.productIds'),
            ingredientIds: strings(configuration.ingredientIds, 'configuration.ingredientIds'),
            maxIngredients: integer(configuration.maxIngredients, 'configuration.maxIngredients'),
            maxStates: positiveInteger(configuration.maxStates, 'configuration.maxStates'),
            requiredEffectIds: strings(
                configuration.requiredEffectIds,
                'configuration.requiredEffectIds'
            ),
            forbiddenEffectIds: strings(
                configuration.forbiddenEffectIds,
                'configuration.forbiddenEffectIds'
            ),
        },
        corpus: {
            artifactSha256: hash(corpus.artifactSha256, 'corpus.artifactSha256'),
            coverageKey: hash(corpus.coverageKey, 'corpus.coverageKey'),
            algorithmVersion: string(corpus.algorithmVersion, 'corpus.algorithmVersion'),
        },
        index: {
            artifactSha256: hash(index.artifactSha256, 'index.artifactSha256'),
            algorithmVersion: string(index.algorithmVersion, 'index.algorithmVersion'),
        },
        verification: {
            reportFile: fileName(verification.reportFile),
            reportSha256: hash(verification.reportSha256, 'verification.reportSha256'),
            createdAt: date(verification.createdAt, 'verification.createdAt'),
            recipeCaseCount: positiveInteger(
                verification.recipeCaseCount,
                'verification.recipeCaseCount'
            ),
            customerCaseCount: positiveInteger(
                verification.customerCaseCount,
                'verification.customerCaseCount'
            ),
        },
    };
}

function selectionBody(
    selection: RecipeCorpusProductionSelection
): Omit<RecipeCorpusProductionSelection, 'schema' | 'selectionSha256'> {
    const { schema: _schema, selectionSha256: _hash, ...body } = selection;
    return body;
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

function strings(value: unknown, label: string): string[] {
    if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
    return value.map((entry, index) => string(entry, `${label}[${index}]`));
}

function fileName(value: unknown): string {
    const result = string(value, 'verification.reportFile');
    if (path.basename(result) !== result) throw new Error('verification.reportFile must be a file name');
    return result;
}

function date(value: unknown, label: string): string {
    const result = string(value, label);
    if (!isIsoDate(result)) {
        throw new Error(`${label} must be an ISO date`);
    }
    return result;
}

function isIsoDate(value: string): boolean {
    const parsed = new Date(value);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
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

function requirePositiveInteger(value: number, label: string): void {
    positiveInteger(value, label);
}

function failMode(): never {
    throw new Error('Recipe corpus production selection must be exhaustive');
}

function jsonBytes(value: unknown): Buffer {
    return Buffer.from(JSON.stringify(value), 'utf8');
}

function sha256(content: string | Uint8Array): string {
    return createHash('sha256').update(content).digest('hex');
}

function hasCode(error: unknown, code: string): boolean {
    return typeof error === 'object' && error !== null &&
        'code' in error && (error as { readonly code?: unknown }).code === code;
}
