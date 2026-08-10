import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { mixingRuleProfileFromGameSeed, type MixingRuleProfile } from '@neonschedule1/core';

import { loadSolverDataset, resolveDatasetDirectory, workspaceRoot } from '#solver/dataset';
import {
    defaultExhaustiveCorpusOptions,
    planRecipeCorpus,
    type RecipeCorpusMode,
    type RecipeCorpusOptions,
} from '#solver/precompute';
import { writeRecipeCorpusIndexArtifact } from '#solver/precompute-index-artifact';
import { writeRecipeCorpusArtifact } from '#solver/precompute-run';

interface CliOptions {
    readonly dataset?: string;
    readonly outputRoot?: string;
    readonly dryRun: boolean;
    readonly corpus: RecipeCorpusOptions;
}

async function main(): Promise<void> {
    const options = parseArguments(process.argv.slice(2));
    const datasetDirectory = await resolveDatasetDirectory(
        options.dataset === undefined
            ? undefined
            : path.resolve(invocationDirectory(), options.dataset)
    );
    process.stdout.write(`Loading normalized dataset ${datasetDirectory}\n`);
    const dataset = await loadSolverDataset(datasetDirectory);
    const plan = planRecipeCorpus(dataset, options.corpus);
    process.stdout.write(
        `${capitalize(plan.configuration.mode)} coverage: ` +
        `${plan.configuration.productIds.length} products, ` +
        `${plan.configuration.ingredientIds.length} ingredients, depth ` +
        `${plan.configuration.maxIngredients}\n`
    );
    process.stdout.write(
        `Upper-bound ordered sequences before state dominance: ` +
        `${plan.estimatedOrderedSequences}\n`
    );
    if (options.dryRun) {
        process.stdout.write('Dry run complete; no artifacts were written\n');
        return;
    }

    const outputRoot = path.resolve(
        invocationDirectory(),
        options.outputRoot ?? path.join(workspaceRoot(), '.local', 'precomputed')
    );
    const startedAt = performance.now();
    const corpusArtifact = await writeRecipeCorpusArtifact(
        outputRoot,
        plan,
        ({ completedProducts, totalProducts, productId, resumed }) => {
            process.stdout.write(
                `[${completedProducts}/${totalProducts}] ${productId}` +
                `${resumed ? ' (resumed)' : ''}\n`
            );
        }
    );
    const corpusDurationMs = performance.now() - startedAt;
    const indexStartedAt = performance.now();
    const indexArtifact = await writeRecipeCorpusIndexArtifact(
        path.join(outputRoot, 'indexes'),
        corpusArtifact.directory
    );
    process.stdout.write(
        `Verified ${corpusArtifact.manifest.counts.recipes} recipes in ` +
        `${corpusArtifact.manifest.counts.partitions} partitions ` +
        `(${formatBytes(corpusArtifact.byteLength)}) in ${corpusDurationMs.toFixed(1)} ms\n`
    );
    if (corpusArtifact.resumedProducts > 0) {
        process.stdout.write(`Resumed ${corpusArtifact.resumedProducts} completed products\n`);
    }
    process.stdout.write(`Artifact: ${corpusArtifact.directory}\n`);
    process.stdout.write(
        `Verified lookup index ${indexArtifact.manifest.artifactSha256} ` +
        `(${formatBytes(indexArtifact.byteLength)}) in ` +
        `${(performance.now() - indexStartedAt).toFixed(1)} ms\n`
    );
    process.stdout.write(`Index: ${indexArtifact.directory}\n`);
}

function parseArguments(arguments_: readonly string[]): CliOptions {
    const normalizedArguments = arguments_[0] === '--' ? arguments_.slice(1) : arguments_;
    const defaults = defaultExhaustiveCorpusOptions();
    let dataset: string | undefined;
    let outputRoot: string | undefined;
    let mode: RecipeCorpusMode | undefined;
    let dryRun = false;
    const productIds: string[] = [];
    const ingredientIds: string[] = [];
    const requiredEffectIds: string[] = [];
    const forbiddenEffectIds: string[] = [];
    let maxIngredients = defaults.maxIngredients;
    let maxStates = defaults.maxStates;
    let ruleProfile: MixingRuleProfile | undefined;
    for (let index = 0; index < normalizedArguments.length; index++) {
        const argument = normalizedArguments[index]!;
        const value = (): string => {
            const next = normalizedArguments[++index];
            if (next === undefined) throw new Error(`Missing value after ${argument}`);
            return next;
        };
        switch (argument) {
            case '--mode':
                if (mode !== undefined) throw new Error('Precomputation mode was provided twice');
                mode = corpusMode(value());
                break;
            case '--dataset':
                dataset = value();
                break;
            case '--output-root':
                outputRoot = value();
                break;
            case '--product':
                productIds.push(value());
                break;
            case '--ingredient':
                ingredientIds.push(value());
                break;
            case '--required-effect':
                requiredEffectIds.push(value());
                break;
            case '--forbidden-effect':
                forbiddenEffectIds.push(value());
                break;
            case '--max-depth':
                maxIngredients = integer(value(), 'max-depth');
                break;
            case '--max-states':
                maxStates = integer(value(), 'max-states');
                break;
            case '--mixing-seed':
                if (ruleProfile !== undefined) {
                    throw new Error('Mixing seed was provided twice');
                }
                ruleProfile = mixingRuleProfileFromGameSeed(integer(value(), 'mixing-seed'));
                break;
            case '--dry-run':
                dryRun = true;
                break;
            case '--help':
                process.stdout.write(helpText);
                process.exit(0);
            default:
                throw new Error(`Unknown precomputation argument ${JSON.stringify(argument)}`);
        }
    }
    const hasSelection = productIds.length > 0 || ingredientIds.length > 0 ||
        requiredEffectIds.length > 0 || forbiddenEffectIds.length > 0;
    const resolvedMode = mode ?? (hasSelection ? 'selective' : 'exhaustive');
    if (resolvedMode === 'exhaustive' && hasSelection) {
        throw new Error(
            'Exhaustive precomputation cannot select products, ingredients, or effects'
        );
    }
    const corpus: RecipeCorpusOptions = resolvedMode === 'exhaustive'
        ? {
            mode: resolvedMode,
            maxIngredients,
            maxStates,
            ...(ruleProfile === undefined ? {} : { ruleProfile }),
        }
        : {
            mode: resolvedMode,
            ...(ruleProfile === undefined ? {} : { ruleProfile }),
            ...(productIds.length === 0 ? {} : { productIds }),
            ...(ingredientIds.length === 0 ? {} : { ingredientIds }),
            maxIngredients,
            maxStates,
            requiredEffectIds,
            forbiddenEffectIds,
        };
    return {
        ...(dataset === undefined ? {} : { dataset }),
        ...(outputRoot === undefined ? {} : { outputRoot }),
        dryRun,
        corpus,
    };
}

function invocationDirectory(): string {
    return process.env.INIT_CWD ?? process.cwd();
}

function integer(value: string, name: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe integer`);
    return parsed;
}

function corpusMode(value: string): RecipeCorpusMode {
    if (value === 'exhaustive' || value === 'selective') return value;
    throw new Error(`Unknown precomputation mode ${JSON.stringify(value)}`);
}

function capitalize(value: string): string {
    return `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function formatBytes(value: number): string {
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
    return `${(value / 1024 ** 2).toFixed(1)} MiB`;
}

const helpText = `Usage: pnpm solver:precompute -- [options]

Options:
  --mode MODE             exhaustive or selective (default: exhaustive unless filtered)
  --dataset PATH          Normalized dataset; defaults to the newest local dataset
  --output-root PATH      Artifact root; defaults to .local/precomputed
  --product ID            Include one base product; repeat for more
  --ingredient ID         Include one mixing ingredient; repeat for more
  --required-effect ID    Require a resulting effect; repeat for more
  --forbidden-effect ID   Forbid a resulting effect; repeat for more
  --max-depth NUMBER      Maximum ingredient count (default: 3)
  --max-states NUMBER     State limit per product (default: 100000)
  --mixing-seed NUMBER    Use the signed 32-bit save seed's rotation profile
  --dry-run               Resolve coverage and estimate work without writing
  --help                  Show this help
`;

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
});
