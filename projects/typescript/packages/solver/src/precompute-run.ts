import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { sameMixingRuleProfile } from '@neonschedule1/core';

import {
    buildRecipeCorpusManifest,
    describeCorpusFile,
    readRecipeCorpusPartition,
    recipeCorpusCoverageKey,
    verifyRecipeCorpusArtifact,
    type RecipeCorpusFile,
    type RecipeCorpusManifest,
} from '#solver/precompute-artifact';
import {
    generateRecipeCorpusProductPartitions,
    identity,
    partitionPath,
    recipeCorpusAlgorithmVersion,
    recipeCorpusProductKey,
    type RecipeCorpusPlan,
} from '#solver/precompute';

interface ProductCheckpoint {
    readonly schema: 'neonschedule1-recipe-corpus-product-checkpoint-1';
    readonly coverageKey: string;
    readonly productId: string;
    readonly files: readonly RecipeCorpusFile[];
}

interface RunLock {
    readonly schema: 'neonschedule1-recipe-corpus-run-lock-1';
    readonly token: string;
    readonly pid: number;
    readonly startedAt: string;
}

export interface RecipeCorpusRunProgress {
    readonly completedProducts: number;
    readonly totalProducts: number;
    readonly productId: string;
    readonly resumed: boolean;
}

export interface RecipeCorpusRunResult {
    readonly directory: string;
    readonly manifest: RecipeCorpusManifest;
    readonly byteLength: number;
    readonly generatedProducts: number;
    readonly resumedProducts: number;
}

export async function writeRecipeCorpusArtifact(
    outputRoot: string,
    plan: RecipeCorpusPlan,
    onProgress: (progress: RecipeCorpusRunProgress) => void = () => undefined
): Promise<RecipeCorpusRunResult> {
    const resolvedRoot = path.resolve(outputRoot);
    const dataset = identity(plan.dataset);
    const coverageKey = recipeCorpusCoverageKey(dataset, plan.configuration);
    const workRoot = path.join(resolvedRoot, '.work');
    const workspace = path.join(workRoot, coverageKey);
    const checkpointDirectory = path.join(workRoot, `${coverageKey}.checkpoints`);
    const existing = await findExistingArtifact(resolvedRoot, dataset, coverageKey);
    if (existing !== null) {
        await rm(checkpointDirectory, { recursive: true, force: true });
        return existing;
    }
    const lockPath = path.join(workRoot, `${coverageKey}.lock`);
    await mkdir(workRoot, { recursive: true });
    const release = await acquireLock(lockPath);
    try {
        const published = await findExistingArtifact(resolvedRoot, dataset, coverageKey);
        if (published !== null) return published;
        await mkdir(checkpointDirectory, { recursive: true });
        await rm(path.join(workspace, 'manifest.json'), { force: true });
        const files: RecipeCorpusFile[] = [];
        let generatedProducts = 0;
        let resumedProducts = 0;
        for (const [index, productId] of plan.configuration.productIds.entries()) {
            let productFiles = await readProductCheckpoint(
                workspace,
                checkpointDirectory,
                coverageKey,
                plan,
                productId
            );
            const resumed = productFiles !== null;
            if (productFiles === null) {
                productFiles = await generateProduct(
                    workspace,
                    checkpointDirectory,
                    coverageKey,
                    plan,
                    productId
                );
                generatedProducts++;
            } else {
                resumedProducts++;
            }
            files.push(...productFiles);
            onProgress({
                completedProducts: index + 1,
                totalProducts: plan.configuration.productIds.length,
                productId,
                resumed,
            });
        }

        const manifest = buildRecipeCorpusManifest(
            dataset,
            plan.configuration,
            plan.estimatedOrderedSequences,
            files
        );
        const manifestContent = Buffer.from(`${JSON.stringify(manifest)}\n`, 'utf8');
        await writeFile(path.join(workspace, 'manifest.json'), manifestContent, { flag: 'wx' });
        await verifyRecipeCorpusArtifact(workspace);
        const finalDirectory = path.join(
            resolvedRoot,
            dataset.gameVersion,
            dataset.datasetSha256,
            manifest.artifactSha256
        );
        await mkdir(path.dirname(finalDirectory), { recursive: true });
        if (await stat(finalDirectory).catch(() => null)) {
            const existing = await verifyRecipeCorpusArtifact(finalDirectory);
            if (existing.artifactSha256 !== manifest.artifactSha256) {
                throw new Error(`Existing recipe corpus has a different identity: ${finalDirectory}`);
            }
            await rm(workspace, { recursive: true });
        } else {
            await rename(workspace, finalDirectory);
        }
        await verifyRecipeCorpusArtifact(finalDirectory);
        await rm(checkpointDirectory, { recursive: true, force: true });
        return {
            directory: finalDirectory,
            manifest,
            byteLength: files.reduce((total, file) => total + file.byteLength, 0) +
                manifestContent.byteLength,
            generatedProducts,
            resumedProducts,
        };
    } finally {
        await release();
    }
}

async function findExistingArtifact(
    outputRoot: string,
    dataset: ReturnType<typeof identity>,
    coverageKey: string
): Promise<RecipeCorpusRunResult | null> {
    const datasetRoot = path.join(outputRoot, dataset.gameVersion, dataset.datasetSha256);
    const entries = await readdir(datasetRoot, { withFileTypes: true }).catch((error: unknown) => {
        if (hasCode(error, 'ENOENT')) return [];
        throw error;
    });
    let found: RecipeCorpusRunResult | null = null;
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const directory = path.join(datasetRoot, entry.name);
        const manifest = await verifyRecipeCorpusArtifact(directory).catch(() => null);
        if (manifest?.coverageKey !== coverageKey) continue;
        if (found !== null) {
            throw new Error(`Multiple recipe corpora have coverage key ${coverageKey}`);
        }
        const manifestSize = await stat(path.join(directory, 'manifest.json'));
        found = {
            directory,
            manifest,
            byteLength: manifest.files.reduce((total, file) => total + file.byteLength, 0) +
                manifestSize.size,
            generatedProducts: 0,
            resumedProducts: 0,
        };
    }
    return found;
}

async function generateProduct(
    workspace: string,
    checkpointDirectory: string,
    coverageKey: string,
    plan: RecipeCorpusPlan,
    productId: string
): Promise<readonly RecipeCorpusFile[]> {
    const productDirectory = path.join(
        workspace,
        'recipes',
        `product-${recipeCorpusProductKey(productId)}`
    );
    requireWithin(workspace, productDirectory);
    await rm(productDirectory, { recursive: true, force: true });
    const checkpointPath = checkpointFile(checkpointDirectory, productId);
    await rm(checkpointPath, { force: true });
    const files: RecipeCorpusFile[] = [];
    for (const partition of generateRecipeCorpusProductPartitions(plan, productId)) {
        const relativePath = partitionPath(partition);
        const content = Buffer.from(`${JSON.stringify(partition)}\n`, 'utf8');
        const output = resolveFile(workspace, relativePath);
        await mkdir(path.dirname(output), { recursive: true });
        await writeFile(output, content, { flag: 'wx' });
        files.push(describeCorpusFile(relativePath, content, partition));
    }
    const checkpoint: ProductCheckpoint = {
        schema: 'neonschedule1-recipe-corpus-product-checkpoint-1',
        coverageKey,
        productId,
        files,
    };
    await writeAtomic(checkpointPath, Buffer.from(`${JSON.stringify(checkpoint)}\n`, 'utf8'));
    const verified = await readProductCheckpoint(
        workspace,
        checkpointDirectory,
        coverageKey,
        plan,
        productId
    );
    if (verified === null) throw new Error(`Generated checkpoint is invalid for ${productId}`);
    return verified;
}

async function readProductCheckpoint(
    workspace: string,
    checkpointDirectory: string,
    coverageKey: string,
    plan: RecipeCorpusPlan,
    productId: string
): Promise<readonly RecipeCorpusFile[] | null> {
    try {
        const checkpoint = parseCheckpoint(
            JSON.parse(await readFile(checkpointFile(checkpointDirectory, productId), 'utf8'))
        );
        if (checkpoint.coverageKey !== coverageKey || checkpoint.productId !== productId ||
            checkpoint.files.length !== plan.configuration.maxIngredients + 1) {
            return null;
        }
        const depths = new Set<number>();
        const effectStates = new Set<string>();
        for (const file of checkpoint.files) {
            if (file.productId !== productId || depths.has(file.resultDepth) ||
                file.path !== `recipes/product-${recipeCorpusProductKey(productId)}/` +
                    `depth-${file.resultDepth}.json`) {
                return null;
            }
            depths.add(file.resultDepth);
            const partition = await readRecipeCorpusPartition(workspace, file);
            if (partition.algorithmVersion !== recipeCorpusAlgorithmVersion ||
                JSON.stringify(partition.dataset) !== JSON.stringify(identity(plan.dataset)) ||
                partition.coverage.mode !== plan.configuration.mode ||
                !sameMixingRuleProfile(
                    partition.coverage.ruleProfile,
                    plan.configuration.ruleProfile
                ) ||
                partition.coverage.semantics !==
                    'cheapest-representative-per-ordered-effect-state' ||
                partition.coverage.productId !== productId ||
                partition.coverage.drugType !== file.drugType ||
                partition.coverage.resultDepth !== file.resultDepth ||
                partition.coverage.maxIngredients !== plan.configuration.maxIngredients ||
                JSON.stringify(partition.coverage.ingredientIds) !==
                    JSON.stringify(plan.configuration.ingredientIds) ||
                JSON.stringify(partition.coverage.requiredEffectIds) !==
                    JSON.stringify(plan.configuration.requiredEffectIds) ||
                JSON.stringify(partition.coverage.forbiddenEffectIds) !==
                    JSON.stringify(plan.configuration.forbiddenEffectIds) ||
                partition.proof.proofStatus !== 'exact' ||
                partition.proof.completedDepth !== plan.configuration.maxIngredients ||
                partition.recipes.length !== file.recipeCount) {
                return null;
            }
            for (const recipe of partition.recipes) {
                const state = JSON.stringify(recipe.effectIds);
                if (recipe.productId !== productId || recipe.drugType !== file.drugType ||
                    recipe.depth !== file.resultDepth ||
                    recipe.ingredientIds.length !== recipe.depth || effectStates.has(state) ||
                    recipe.costs.total !== recipe.costs.baseProduct + recipe.costs.ingredients ||
                    recipe.netValue !== recipe.productValue - recipe.costs.total) {
                    return null;
                }
                effectStates.add(state);
            }
        }
        for (let depth = 0; depth <= plan.configuration.maxIngredients; depth++) {
            if (!depths.has(depth)) return null;
        }
        return [...checkpoint.files].sort(
            (left, right) => left.resultDepth - right.resultDepth
        );
    } catch {
        return null;
    }
}

function parseCheckpoint(value: unknown): ProductCheckpoint {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('Recipe corpus product checkpoint must be an object');
    }
    const record = value as Record<string, unknown>;
    if (record.schema !== 'neonschedule1-recipe-corpus-product-checkpoint-1' ||
        typeof record.coverageKey !== 'string' || typeof record.productId !== 'string' ||
        !Array.isArray(record.files)) {
        throw new Error('Recipe corpus product checkpoint has an unsupported contract');
    }
    return record as unknown as ProductCheckpoint;
}

async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
    const lock: RunLock = {
        schema: 'neonschedule1-recipe-corpus-run-lock-1',
        token: randomUUID(),
        pid: process.pid,
        startedAt: new Date().toISOString(),
    };
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            await writeFile(lockPath, `${JSON.stringify(lock)}\n`, { flag: 'wx' });
            return async () => {
                const current = await readLock(lockPath);
                if (current?.token === lock.token) await rm(lockPath, { force: true });
            };
        } catch (error) {
            if (!hasCode(error, 'EEXIST')) throw error;
            const owner = await readLock(lockPath);
            if (owner !== null && processExists(owner.pid)) {
                throw new Error(`Recipe corpus coverage is already running in process ${owner.pid}`);
            }
            await rm(lockPath, { force: true });
        }
    }
    throw new Error(`Could not acquire recipe corpus run lock: ${lockPath}`);
}

async function readLock(lockPath: string): Promise<RunLock | null> {
    try {
        const value = JSON.parse(await readFile(lockPath, 'utf8')) as Partial<RunLock>;
        return value.schema === 'neonschedule1-recipe-corpus-run-lock-1' &&
            typeof value.token === 'string' && Number.isSafeInteger(value.pid)
            ? value as RunLock
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

async function writeAtomic(output: string, content: Uint8Array): Promise<void> {
    await mkdir(path.dirname(output), { recursive: true });
    const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, content, { flag: 'wx' });
        await rename(temporary, output);
    } finally {
        await rm(temporary, { force: true });
    }
}

function checkpointFile(directory: string, productId: string): string {
    return path.join(directory, `product-${recipeCorpusProductKey(productId)}.json`);
}

function resolveFile(root: string, relativePath: string): string {
    const resolved = path.resolve(root, ...relativePath.split('/'));
    requireWithin(root, resolved);
    return resolved;
}

function requireWithin(root: string, target: string): void {
    const resolvedRoot = path.resolve(root);
    const resolvedTarget = path.resolve(target);
    if (!resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error(`Precomputation path escapes its workspace: ${resolvedTarget}`);
    }
}

function hasCode(error: unknown, code: string): boolean {
    return typeof error === 'object' && error !== null &&
        'code' in error && (error as { readonly code?: unknown }).code === code;
}
