import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
    canonicalJson,
    normalizedDatasetIdentityInput,
    type CustomerCatalog,
    type CustomerOfferProfile,
    type Customer,
    type DatasetManifest,
    type Effect,
    type Item,
    type MixingRules,
} from '@neonschedule1/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
    buildRecipeCorpusManifest,
    describeCorpusFile,
    recipeCorpusCoverageKey,
    verifyRecipeCorpusArtifact,
    verifyRecipeCorpusArtifactIntegrity,
} from '#solver/precompute-artifact';
import {
    defaultSearchBenchmarkOptions,
    runSearchBenchmark,
} from '#solver/benchmark';
import { writeRecipeCorpusIndexArtifact } from '#solver/precompute-index-artifact';
import { CustomerCorpusRecommendationLookup } from '#solver/precompute-customer';
import { LiveFallbackRunner } from '#solver/live-fallback';
import { packageRecipeCorpusProduction } from '#solver/precompute-package';
import { loadRecipeCorpusProduction } from '#solver/precompute-production';
import { RecipeCorpusLookup } from '#solver/precompute-query';
import { loadProductionRuntime } from '#solver/production-runtime';
import { ProductionRequestRouter } from '#solver/production-router';
import {
    readRecipeCorpusProductionSelection,
    refreshRecipeCorpusProduction,
} from '#solver/precompute-refresh';
import { writeRecipeCorpusArtifact } from '#solver/precompute-run';
import type { SolverDataset } from '#solver/dataset';
import {
    partitionPath,
    planExhaustiveCorpus,
    planSelectiveCorpus,
    type RecipeCorpusConfiguration,
    type RecipeCorpusDatasetIdentity,
    type RecipeCorpusMode,
    type RecipeCorpusPartition,
} from '#solver/precompute';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) =>
            rm(directory, { recursive: true, force: true })
        )
    );
});

describe('recipe corpus artifact', () => {
    it('gives standard and seeded profiles distinct coverage identities', () => {
        const standard = recipeCorpusCoverageKey(dataset, configuration);
        const seeded = recipeCorpusCoverageKey(dataset, {
            ...configuration,
            ruleProfile: { kind: 'seeded-rotation', angleDegrees: 90 },
        });

        expect(seeded).not.toBe(standard);
    });

    it('verifies a complete hash-addressed selective artifact', async () => {
        const artifact = await writeArtifact();

        const verified = await verifyRecipeCorpusArtifact(artifact.directory);
        const integrity = await verifyRecipeCorpusArtifactIntegrity(artifact.directory);

        expect(verified.artifactSha256).toBe(artifact.artifactSha256);
        expect(integrity).toEqual(verified);
        expect(verified.counts).toEqual({
            products: 1,
            ingredients: 1,
            partitions: 2,
            recipes: 2,
        });
    });

    it('rejects a partition changed after the manifest was written', async () => {
        const artifact = await writeArtifact();
        await writeFile(artifact.partitionPaths[1]!, '{}\n', 'utf8');

        await expect(verifyRecipeCorpusArtifact(artifact.directory)).rejects.toThrow(
            'failed integrity verification'
        );
        await expect(
            verifyRecipeCorpusArtifactIntegrity(artifact.directory)
        ).rejects.toThrow('failed integrity verification');
    });

    it('keeps semantic verification at the package boundary', async () => {
        const artifact = await writeArtifact('selective', (partition, content) =>
            partition.coverage.resultDepth === 0 ? Buffer.from('{}\n') : content
        );

        await expect(
            verifyRecipeCorpusArtifactIntegrity(artifact.directory)
        ).resolves.toMatchObject({ artifactSha256: artifact.artifactSha256 });
        await expect(verifyRecipeCorpusArtifact(artifact.directory)).rejects.toThrow(
            'partition has an unsupported schema'
        );
    });

    it('records exhaustive coverage as a distinct artifact identity', async () => {
        const selective = await writeArtifact('selective');
        const exhaustive = await writeArtifact('exhaustive');

        const verified = await verifyRecipeCorpusArtifact(exhaustive.directory);

        expect(verified.configuration.mode).toBe('exhaustive');
        expect(verified.artifactSha256).not.toBe(selective.artifactSha256);
    });

    it('resumes completed products without changing artifact identity', async () => {
        const interruptedRoot = await temporaryDirectory('neonschedule1-resume-');
        const cleanRoot = await temporaryDirectory('neonschedule1-clean-');
        const plan = planSelectiveCorpus(solverDataset(), {
            productIds: ['product-a', 'product-b'],
            ingredientIds: ['ingredient'],
            maxIngredients: 1,
            maxStates: 100,
            requiredEffectIds: [],
            forbiddenEffectIds: [],
        });

        await expect(
            writeRecipeCorpusArtifact(interruptedRoot, plan, ({ completedProducts }) => {
                if (completedProducts === 1) throw new Error('controlled interruption');
            })
        ).rejects.toThrow('controlled interruption');

        const resumed = await writeRecipeCorpusArtifact(interruptedRoot, plan);
        const clean = await writeRecipeCorpusArtifact(cleanRoot, plan);
        const resumedIndex = await writeRecipeCorpusIndexArtifact(
            path.join(interruptedRoot, 'indexes'),
            resumed.directory
        );
        const cleanIndex = await writeRecipeCorpusIndexArtifact(
            path.join(cleanRoot, 'indexes'),
            clean.directory
        );

        expect(resumed.resumedProducts).toBe(1);
        expect(resumed.generatedProducts).toBe(1);
        expect(resumed.manifest.artifactSha256).toBe(clean.manifest.artifactSha256);
        expect(resumedIndex.manifest.artifactSha256).toBe(
            cleanIndex.manifest.artifactSha256
        );
    });

    it('changes production selection only after exact refresh verification', async () => {
        const outputRoot = await temporaryDirectory('neonschedule1-refresh-');
        const reportRoot = path.join(outputRoot, 'reports');
        const source = solverDataset();
        const options = { maxIngredients: 1, maxStates: 100 };
        const refreshed = await refreshRecipeCorpusProduction(
            source,
            planExhaustiveCorpus(source, options),
            { outputRoot, reportRoot, verificationLimit: 2 }
        );
        const repeated = await refreshRecipeCorpusProduction(
            source,
            planExhaustiveCorpus(source, options),
            { outputRoot, reportRoot, verificationLimit: 2 }
        );
        const before = await readRecipeCorpusProductionSelection(repeated.selectionPath);
        const changedDataset: SolverDataset = {
            ...source,
            items: source.items.map((item, index) =>
                index === 0 && item.product !== null
                    ? {
                        ...item,
                        product: { ...item.product, basePrice: item.product.basePrice + 1 },
                    } as Item
                    : item
            ),
        };

        await expect(
            refreshRecipeCorpusProduction(
                changedDataset,
                planExhaustiveCorpus(changedDataset, options),
                { outputRoot, reportRoot, verificationLimit: 2 }
            )
        ).rejects.toThrow('differs at result');

        const after = await readRecipeCorpusProductionSelection(refreshed.selectionPath);
        expect(after).toEqual(before);
        expect(before.configuration.mode).toBe('exhaustive');
        expect(before.verification.recipeCaseCount).toBeGreaterThan(0);
        expect(before.verification.customerCaseCount).toBeGreaterThan(0);
    });

    it('loads and routes selected production lookups and rejects a changed report', async () => {
        const outputRoot = await temporaryDirectory('neonschedule1-production-');
        const reportRoot = path.join(outputRoot, 'reports');
        const source = solverDataset();
        const refreshed = await refreshRecipeCorpusProduction(
            source,
            planExhaustiveCorpus(source, { maxIngredients: 1, maxStates: 100 }),
            { outputRoot, reportRoot, verificationLimit: 2 }
        );

        const production = await loadRecipeCorpusProduction(source, {
            outputRoot,
            reportRoot,
        });
        const router = new ProductionRequestRouter(production);
        const recipe = await router.recipe({
            productIds: ['product-b', 'product-a', 'product-a'],
            availableIngredientIds: ['ingredient', 'ingredient'],
            maxIngredients: 1,
            requiredEffectIds: ['mixed-effect'],
            requiredIngredientIds: ['ingredient'],
            exactIngredientCount: 1,
            limit: 2,
        });
        const customer = await router.customer({
            productIds: ['product-a', 'product-b'],
            availableIngredientIds: ['ingredient'],
            maxIngredients: 1,
            minimumIngredientCount: 1,
            profile: customerProfile,
            state: { addiction: 0.2, relationship: 2, orderLimitMultiplier: 1 },
            quality: 'Standard',
            quantity: 1,
            priceMultiplier: 1,
            maximumProductionCost: 20,
            limit: 2,
        });

        expect(recipe.kind).toBe('exact');
        if (recipe.kind !== 'exact') throw new Error('Expected exact recipe route');
        expect(recipe.request.productIds).toEqual(['product-a', 'product-b']);
        expect(recipe.result.recipes.map((entry) => entry.productId)).toEqual([
            'product-a',
            'product-b',
        ]);
        expect(recipe.result.evidence.examinedRankingEntries).toBe(
            recipe.result.recipes.length
        );
        expect(customer.kind).toBe('exact');
        if (customer.kind !== 'exact') throw new Error('Expected exact customer route');
        expect(customer.result.recommendations.every(
            ({ recipe }) => recipe.ingredientCount >= 1
        )).toBe(true);
        if (customer.kind !== 'exact') throw new Error('Expected exact customer route');
        expect(customer.result.recommendations.length).toBeGreaterThan(0);
        expect(production.selection.selectionSha256).toBe(
            refreshed.selection.selectionSha256
        );

        const packageRoot = await temporaryDirectory('neonschedule1-runtime-package-');
        const packaged = await packageRecipeCorpusProduction(source, {
            outputRoot,
            reportRoot,
            packageRoot,
        });
        const repeatedPackage = await packageRecipeCorpusProduction(source, {
            outputRoot,
            reportRoot,
            packageRoot,
        });
        expect(repeatedPackage.packageDirectory).toBe(packaged.packageDirectory);
        expect(path.basename(packaged.packageDirectory)).toBe(
            refreshed.selection.selectionSha256
        );
        const runtime = await loadProductionRuntime(source, {
            packageDirectory: packaged.packageDirectory,
        });
        const packagedRecipe = await runtime.solver.recipe({
            productIds: ['product-a'],
            availableIngredientIds: ['ingredient'],
            maxIngredients: 1,
            limit: 1,
        }, 'quick');
        expect(packagedRecipe.kind).toBe('precomputed-exact');
        expect(runtime.production.selection.selectionSha256).toBe(
            refreshed.selection.selectionSha256
        );

        const miss = await router.recipe({
            productIds: ['missing-product'],
            availableIngredientIds: [],
            maxIngredients: 0,
            limit: 1,
        });
        expect(miss.kind).toBe('coverage-miss');
        if (miss.kind !== 'coverage-miss') throw new Error('Expected coverage miss');
        expect(miss.miss.issues.map((issue) => issue.field)).toEqual([
            'productIds',
            'availableIngredientIds',
            'maxIngredients',
        ]);
        const fallback = new LiveFallbackRunner(source, production);
        const liveBudget = {
            maxStatesPerProduct: 10,
            maxTransitionEvaluationsPerProduct: 100,
            maxDurationMsPerProduct: 10_000,
        };
        const liveRecipeRoute = await router.recipe({
            productIds: ['product-a'],
            availableIngredientIds: [],
            maxIngredients: 0,
            limit: 1,
        });
        if (liveRecipeRoute.kind !== 'coverage-miss') {
            throw new Error('Expected live recipe coverage miss');
        }
        const liveRecipe = fallback.recipe(liveRecipeRoute, liveBudget);
        expect(liveRecipe.kind).toBe('completed');
        if (liveRecipe.kind !== 'completed') throw new Error('Expected completed live recipe');
        expect(liveRecipe.result.recipes).toHaveLength(1);
        expect(liveRecipe.evidence.source).toBe('live');

        const seededRecipeRoute = await router.recipe({
            ruleProfile: { kind: 'seeded-rotation', angleDegrees: 90 },
            productIds: ['product-a'],
            availableIngredientIds: ['ingredient'],
            maxIngredients: 1,
            limit: 1,
        });
        expect(seededRecipeRoute.kind).toBe('coverage-miss');
        if (seededRecipeRoute.kind !== 'coverage-miss') {
            throw new Error('Expected seeded profile coverage miss');
        }
        expect(seededRecipeRoute.miss.issues).toEqual([{
            field: 'ruleProfile',
            reason: 'different-value',
            requested: { kind: 'seeded-rotation', angleDegrees: 90 },
            covered: { kind: 'standard' },
        }]);
        const seededRecipe = fallback.recipe(seededRecipeRoute, liveBudget);
        expect(seededRecipe.kind).toBe('completed');
        expect(seededRecipe.result.ruleProfile).toEqual({
            kind: 'seeded-rotation',
            angleDegrees: 90,
        });
        expect(seededRecipe.evidence.ruleProfile).toEqual(
            seededRecipe.result.ruleProfile
        );
        expect(seededRecipe.result.recipes[0]?.effectIds).toEqual([
            'base-effect',
            'mixed-effect',
        ]);
        expect(seededRecipe.evidence.coverageKey).not.toBe(
            liveRecipe.evidence.coverageKey
        );

        const quickRecipe = fallback.recipeForMode(liveRecipeRoute, 'quick');
        expect(quickRecipe.kind).toBe('completed');
        expect(quickRecipe.evidence).toMatchObject({
            mode: 'quick',
            maxStatesPerProduct: 100_000,
            maxTransitionEvaluationsPerProduct: 20_560,
            maxDurationMsPerProduct: 100,
        });
        expect(quickRecipe.evidence.coverageKey).not.toBe(
            liveRecipe.evidence.coverageKey
        );

        const costBoundRoute = await router.recipe({
            productIds: ['product-a'],
            availableIngredientIds: [],
            maxIngredients: 0,
            maximumTotalCost: 10,
            limit: 1,
        });
        if (costBoundRoute.kind !== 'coverage-miss') {
            throw new Error('Expected cost-bound recipe coverage miss');
        }
        const costBound = fallback.recipe(costBoundRoute, liveBudget);
        expect(costBound.kind).toBe('completed');
        if (costBound.kind !== 'completed') throw new Error('Expected completed cost-bound recipe');
        expect(costBound.result.recipes).toHaveLength(1);
        expect(costBound.result.recipes[0]!.totalCost).toBeLessThanOrEqual(10);

        const limitedRoute = await router.recipe({
            productIds: ['product-a', 'product-b'],
            availableIngredientIds: ['ingredient'],
            maxIngredients: 2,
            limit: 2,
        });
        if (limitedRoute.kind !== 'coverage-miss') {
            throw new Error('Expected limited recipe coverage miss');
        }
        const limited = fallback.recipe(limitedRoute, {
            ...liveBudget,
            maxStatesPerProduct: 1,
        });
        expect(limited.kind).toBe('state-limit');
        if (limited.kind !== 'state-limit') throw new Error('Expected live state limit');
        expect(limited.evidence.completedDepth).toBe(0);
        expect(limited.result.recipes.map((recipe) => recipe.productId)).toEqual([
            'product-a',
            'product-b',
        ]);
        expect(limited.result.recipes.every(
            (recipe) => recipe.ingredientIds.length === 0
        )).toBe(true);

        const workLimited = fallback.recipe(limitedRoute, {
            ...liveBudget,
            maxTransitionEvaluationsPerProduct: 1,
        });
        expect(workLimited.kind).toBe('work-limit');
        if (workLimited.kind !== 'work-limit') throw new Error('Expected live work limit');
        expect(workLimited.evidence).toMatchObject({
            stopReason: 'work-limit',
            transitionEvaluations: 2,
            maxTransitionEvaluationsPerProduct: 1,
        });
        expect(workLimited.result.recipes.map((recipe) => recipe.productId)).toEqual([
            'product-a',
            'product-b',
        ]);

        let clockTime = 0;
        const timedFallback = new LiveFallbackRunner(
            source,
            production,
            { now: () => clockTime++ }
        );
        const timeLimited = timedFallback.recipe(liveRecipeRoute, {
            ...liveBudget,
            maxDurationMsPerProduct: 1,
        });
        expect(timeLimited.kind).toBe('time-limit');
        if (timeLimited.kind !== 'time-limit') throw new Error('Expected live time limit');
        expect(timeLimited.evidence).toMatchObject({
            proofStatus: 'incomplete',
            stopReason: 'time-limit',
            transitionEvaluations: 0,
            maxDurationMsPerProduct: 1,
        });
        expect(timeLimited.result.recipes.map((recipe) => recipe.ingredientIds)).toEqual([[]]);

        const liveCustomerRoute = await router.customer({
            productIds: ['product-a'],
            availableIngredientIds: [],
            maxIngredients: 0,
            profile: customerProfile,
            state: { addiction: 0.2, relationship: 2, orderLimitMultiplier: 1 },
            quality: 'Standard',
            quantity: 1,
            priceMultiplier: 1,
            maximumProductionCost: 20,
            limit: 1,
        });
        if (liveCustomerRoute.kind !== 'coverage-miss') {
            throw new Error('Expected live customer coverage miss');
        }
        expect(fallback.customerForMode(
            liveCustomerRoute,
            'balanced'
        ).evidence).toMatchObject({
            mode: 'balanced',
            maxTransitionEvaluationsPerProduct: 242_704,
            maxDurationMsPerProduct: 500,
        });
        await expect(router.recipe({
            availableIngredientIds: [],
            maxIngredients: 0,
            requiredEffectIds: ['same-effect'],
            forbiddenEffectIds: ['same-effect'],
            limit: 1,
        })).rejects.toThrow('cannot be required and forbidden');

        const otherDataset = {
            ...source,
            manifest: { ...source.manifest, gameVersion: 'other-game' },
        } as SolverDataset;
        await expect(
            loadRecipeCorpusProduction(otherDataset, { outputRoot, reportRoot })
        ).rejects.toThrow('Production selection dataset differs');

        await writeFile(refreshed.reportPath, '{}\n', 'utf8');
        await expect(
            loadRecipeCorpusProduction(source, { outputRoot, reportRoot })
        ).rejects.toThrow('verification report failed integrity verification');
        const invalidPackageRoot = await temporaryDirectory(
            'neonschedule1-invalid-runtime-package-'
        );
        await expect(packageRecipeCorpusProduction(source, {
            outputRoot,
            reportRoot,
            packageRoot: invalidPackageRoot,
        })).rejects.toThrow('verification report failed integrity verification');
        expect(await stat(
            path.join(invalidPackageRoot, refreshed.selection.selectionSha256)
        ).catch(() => null)).toBeNull();
    });

    it('queries indexed effects and costs without scanning corpus files', async () => {
        const artifact = await writeArtifact();
        const indexRoot = await mkdtemp(path.join(tmpdir(), 'neonschedule1-corpus-index-'));
        temporaryDirectories.push(indexRoot);
        const indexed = await writeRecipeCorpusIndexArtifact(indexRoot, artifact.directory);
        const { artifactSha256, ...identity } = indexed.manifest;
        expect(indexed.manifest.schema).toBe('neonschedule1-recipe-corpus-index-manifest');
        expect(indexed.manifest.corpus.ruleProfile).toEqual({ kind: 'standard' });
        expect(createHash('sha256').update(JSON.stringify(identity)).digest('hex')).toBe(
            artifactSha256
        );
        const lookup = await RecipeCorpusLookup.load(artifact.directory, indexed.directory);

        const mixed = await lookup.query({ requiredEffectIds: ['mixed-effect'], limit: 1 });
        const affordable = await lookup.query({ maximumTotalCost: 4, limit: 10 });
        const requiredIngredient = await lookup.query({
            requiredIngredientIds: ['ingredient'],
            exactIngredientCount: 1,
            limit: 10,
        });
        const forbiddenIngredient = await lookup.query({
            forbiddenIngredientIds: ['ingredient'],
            limit: 10,
        });
        const minimumCount = await lookup.query({
            minimumIngredientCount: 1,
            limit: 10,
        });

        expect(mixed.recipes.map((recipe) => recipe.ingredientIds)).toEqual([['ingredient']]);
        expect(affordable.recipes.map((recipe) => recipe.ingredientIds)).toEqual([[]]);
        expect(requiredIngredient.recipes.map((recipe) => recipe.ingredientIds)).toEqual([
            ['ingredient'],
        ]);
        expect(forbiddenIngredient.recipes.map((recipe) => recipe.ingredientIds)).toEqual([
            [],
        ]);
        expect(minimumCount.recipes.map((recipe) => recipe.ingredientIds)).toEqual([
            ['ingredient'],
        ]);
        expect(mixed.evidence.examinedRankingEntries).toBe(1);
        expect(affordable.evidence.examinedRankingEntries).toBe(1);
        await expect(lookup.query({
            requiredIngredientIds: ['ingredient', 'ingredient'],
            limit: 1,
        })).rejects.toThrow('Duplicate required ingredient "ingredient"');
        await expect(lookup.query({
            requiredIngredientIds: ['ingredient'],
            forbiddenIngredientIds: ['ingredient'],
            limit: 1,
        })).rejects.toThrow('cannot be required and forbidden');
        await expect(lookup.query({
            minimumIngredientCount: 2,
            exactIngredientCount: 1,
            limit: 1,
        })).rejects.toThrow('minimumIngredientCount cannot exceed exactIngredientCount');
    });

    it('ranks affordable customer recommendations from corpus candidates', async () => {
        const artifact = await writeArtifact();
        const indexRoot = await mkdtemp(path.join(tmpdir(), 'neonschedule1-corpus-index-'));
        temporaryDirectories.push(indexRoot);
        const indexed = await writeRecipeCorpusIndexArtifact(indexRoot, artifact.directory);
        const recipes = await RecipeCorpusLookup.load(artifact.directory, indexed.directory);
        const customers = new CustomerCorpusRecommendationLookup(recipes, customerCatalog());

        const result = await customers.recommend({
            profile: customerProfile,
            state: { addiction: 0.2, relationship: 2, orderLimitMultiplier: 1 },
            quality: 'Standard',
            quantity: 1,
            priceMultiplier: 1,
            maximumProductionCost: 5,
            limit: 5,
        });

        expect(result.recommendations.map(({ recipe }) => recipe.ingredientIds)).toEqual([[]]);
        expect(result.evidence.evaluatedCandidateCount).toBe(1);
    });

    it('derives and replays per-product transition budgets', () => {
        const report = runSearchBenchmark(solverDataset(), {
            ...defaultSearchBenchmarkOptions(),
            depths: [1],
            iterations: 1,
            warmups: 2,
            limit: 1,
            recipeCostCeilingFractions: [0.5],
            customerIds: ['customer'],
            customerStates: ['baseline'],
            transitionBudgetPercentiles: [0.5],
        });

        expect(report.schema).toBe('neonschedule1-search-benchmark-4');
        expect(report.cases.every((entry) => entry.warmupSamples.length === 2)).toBe(true);
        expect(report.cases.every((entry) => entry.firstRun !== null)).toBe(true);
        expect(report.transitionBudgetSweep).not.toBeNull();
        const sweep = report.transitionBudgetSweep!;
        expect(sweep.probes).toHaveLength(4);
        expect(sweep.probes.every((entry) => entry.warmupSamples.length === 0)).toBe(true);
        expect(sweep.probes.every((entry) => entry.firstRun === null)).toBe(true);
        expect(sweep.candidates).toEqual([
            {
                percentile: 0.5,
                maxTransitionEvaluations: 2,
                completedCases: 2,
                workLimitedCases: 2,
                stateLimitedCases: 0,
                completionRate: 0.5,
                medianDurationMs: expect.any(Number),
            },
        ]);
        expect(sweep.cases.map((entry) => entry.samples[0]!.status).sort()).toEqual([
            'completed',
            'completed',
            'work-limit',
            'work-limit',
        ]);
        expect(sweep.cases.every((entry) => entry.warmupSamples.length === 2)).toBe(true);
        expect(sweep.cases.every((entry) => entry.firstRun !== null)).toBe(true);
        for (const entry of [...report.cases, ...sweep.cases]) {
            const firstRunDurationMs = entry.warmupSamples[0]!.durationMs;
            expect(entry.firstRun).toEqual({
                durationMs: firstRunDurationMs,
                deltaFromWarmedMedianMs:
                    Math.round((firstRunDurationMs - entry.duration.medianMs) * 10) / 10,
            });
        }
    });
});

async function writeArtifact(
    mode: RecipeCorpusMode = 'selective',
    contentFor: (
        partition: RecipeCorpusPartition,
        content: Buffer
    ) => Buffer = (_partition, content) => content
): Promise<{
    readonly directory: string;
    readonly artifactSha256: string;
    readonly partitionPaths: readonly string[];
}> {
    const directory = await mkdtemp(path.join(tmpdir(), 'neonschedule1-corpus-'));
    temporaryDirectories.push(directory);
    const partitions = [partition(0, mode), partition(1, mode)];
    const files = [];
    const partitionPaths: string[] = [];
    for (const value of partitions) {
        const relativePath = partitionPath(value);
        const content = contentFor(value, Buffer.from(`${JSON.stringify(value)}\n`));
        const output = path.join(directory, ...relativePath.split('/'));
        await mkdir(path.dirname(output), { recursive: true });
        await writeFile(output, content);
        partitionPaths.push(output);
        files.push(describeCorpusFile(relativePath, content, value));
    }
    const manifest = buildRecipeCorpusManifest(
        dataset,
        { ...configuration, mode },
        '2',
        files
    );
    await writeFile(
        path.join(directory, 'manifest.json'),
        `${JSON.stringify(manifest)}\n`,
        'utf8'
    );
    return { directory, artifactSha256: manifest.artifactSha256, partitionPaths };
}

async function temporaryDirectory(prefix: string): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), prefix));
    temporaryDirectories.push(directory);
    return directory;
}

function partition(depth: number, mode: RecipeCorpusMode): RecipeCorpusPartition {
    const ingredientIds = depth === 0 ? [] : ['ingredient'];
    const effectIds = depth === 0 ? ['base-effect'] : ['mixed-effect'];
    const ingredientCost = depth * 2;
    const productValue = 10 + depth * 5;
    return {
        schema: 'neonschedule1-recipe-corpus-partition-2',
        algorithmVersion: '2',
        dataset,
        coverage: {
            mode,
            ruleProfile: { kind: 'standard' },
            semantics: 'cheapest-representative-per-ordered-effect-state',
            productId: 'product',
            drugType: 'TestDrug',
            resultDepth: depth,
            maxIngredients: 1,
            ingredientIds: ['ingredient'],
            requiredEffectIds: [],
            forbiddenEffectIds: [],
        },
        proof: {
            proofStatus: 'exact',
            stopReason: 'completed',
            exploredStates: 2,
            prunedStates: 0,
            completedDepth: 1,
        },
        recipes: [
            {
                productId: 'product',
                drugType: 'TestDrug',
                ingredientIds,
                effectIds,
                depth,
                productValue,
                costs: {
                    baseProduct: 4,
                    baseProductBasis: 'base-purchase-price',
                    ingredients: ingredientCost,
                    total: 4 + ingredientCost,
                },
                netValue: productValue - 4 - ingredientCost,
            },
        ],
    };
}

const datasetManifestInput = normalizedDatasetIdentityInput({
    schema: 'neonschedule1-normalized-data-1',
    normalizerVersion: 'test-normalizer',
    gameVersion: 'test-game',
    sourceReportSha256: 'a'.repeat(64),
    sourceManifestSha256: 'b'.repeat(64),
    files: [],
    counts: {
        items: 3,
        effects: 2,
        mixingMaps: 1,
        mixingOracleCases: 0,
        shops: 0,
        properties: 0,
        customers: 1,
        seeds: 0,
        shroomSpawns: 0,
        stationRecipes: 0,
        ovenTransforms: 0,
        productionStations: 0,
        directAssetFiles: 0,
        offlineAssetFiles: 0,
        meshAssets: 0,
        materialAssets: 0,
    },
    deferredDomains: [],
});
const datasetManifest: DatasetManifest = {
    ...datasetManifestInput,
    datasetSha256: createHash('sha256')
        .update(canonicalJson(datasetManifestInput), 'utf8')
        .digest('hex'),
};
const dataset: RecipeCorpusDatasetIdentity = {
    gameVersion: datasetManifest.gameVersion,
    datasetSha256: datasetManifest.datasetSha256,
    normalizerVersion: datasetManifest.normalizerVersion,
};

const configuration: RecipeCorpusConfiguration = {
    mode: 'selective',
    ruleProfile: { kind: 'standard' },
    productIds: ['product'],
    ingredientIds: ['ingredient'],
    maxIngredients: 1,
    maxStates: 100,
    requiredEffectIds: [],
    forbiddenEffectIds: [],
};

const customerProfile: CustomerOfferProfile = {
    standards: 'Moderate',
    preferredEffectIds: ['base-effect'],
    drugAffinities: [{ drugType: 'TestDrug', affinity: 1 }],
    weeklySpend: { minimum: 100, maximum: 200 },
    weeklyOrders: { minimum: 1, maximum: 2 },
};

function customerCatalog(): CustomerCatalog {
    return {
        schema: 'neonschedule1-customer-catalog-2',
        constants: {
            affinityMaxEffect: 0.3,
            propertyMaxEffect: 0.4,
            qualityMaxEffect: 0.3,
            maximumRelationship: 5,
            maximumOrderQuantityPerProduct: 10,
        } as CustomerCatalog['constants'],
        qualityTiers: [
            { name: 'Trash', value: 0, scalar: 0 },
            { name: 'Poor', value: 1, scalar: 0.25 },
            { name: 'Standard', value: 2, scalar: 0.5 },
            { name: 'Premium', value: 3, scalar: 0.75 },
            { name: 'Heavenly', value: 4, scalar: 1 },
        ],
        productEvaluationInputs: [],
        customerIds: ['customer'],
    } as CustomerCatalog;
}

const customer = {
    ...customerProfile,
    schema: 'neonschedule1-customer-1',
    id: 'customer',
    baseAddiction: 0.2,
} as Customer;

function solverDataset(): SolverDataset {
    const product = (id: string): Item => ({
        id,
        isRuntimeOnly: false,
        basePurchasePrice: 4,
        product: {
            drugType: 'TestDrug',
            basePrice: 10,
            marketValue: 10,
            baseAddictiveness: 0,
            effectIds: ['base-effect'],
            validPackagingIds: [],
        },
        mixingIngredient: null,
    }) as Item;
    const ingredient = {
        id: 'ingredient',
        isRuntimeOnly: false,
        basePurchasePrice: 2,
        product: null,
        mixingIngredient: { effectIds: ['mixed-effect'] },
    } as Item;
    const effect = (id: string, x: number): Effect => ({
        id,
        value: { change: 0, multiplier: 1, addBaseValueMultiple: 0.1 },
        mixing: { direction: { x, y: 0 }, magnitude: 1 },
    }) as Effect;
    const mixingRules = {
        schema: 'neonschedule1-mixing-rules-1',
        maxProperties: 8,
        maxDeltaDifference: 0,
        defaultProductIds: [],
        maps: [{
            drugType: 'TestDrug',
            drugTypeValue: 0,
            radius: 0.1,
            effects: [
                { effectId: 'base-effect', position: { x: 0, y: 0 }, radius: 0.1 },
                { effectId: 'mixed-effect', position: { x: 1, y: 0 }, radius: 0.1 },
            ],
        }],
    } satisfies MixingRules;
    return {
        directory: 'test-dataset',
        manifest: datasetManifest,
        items: [product('product-a'), product('product-b'), ingredient],
        effects: [effect('base-effect', 0), effect('mixed-effect', 1)],
        mixingRules,
        customers: [customer],
        customerCatalog: customerCatalog(),
        tradeCatalog: {
            schema: 'neonschedule1-trade-catalog-1',
            dealerMechanics: {
                maximumCustomers: 10,
                dealArrivalDelay: 30,
                travelTime: { minimum: 15, maximum: 360 },
                overflowSlotCount: 10,
                cashReminderThreshold: 500,
                relationshipChangePerDeal: 0.05,
            },
            dealers: [],
            suppliers: [],
        },
    };
}
