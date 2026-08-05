import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { loadSolverDataset, resolveDatasetDirectory, workspaceRoot } from '#solver/dataset';
import {
    buildRecipeCorpusManifest,
    describeCorpusFile,
    verifyRecipeCorpusArtifact,
    type RecipeCorpusFile,
} from '#solver/precompute-artifact';
import {
    defaultSelectiveCorpusOptions,
    generateRecipeCorpusPartitions,
    identity,
    partitionPath,
    planSelectiveCorpus,
    type SelectiveCorpusOptions,
} from '#solver/precompute';

interface CliOptions {
    readonly dataset?: string;
    readonly outputRoot?: string;
    readonly corpus: SelectiveCorpusOptions;
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
    const plan = planSelectiveCorpus(dataset, options.corpus);
    process.stdout.write(
        `Selective coverage: ${plan.configuration.productIds.length} products, ` +
        `${plan.configuration.ingredientIds.length} ingredients, depth ` +
        `${plan.configuration.maxIngredients}\n`
    );
    process.stdout.write(
        `Upper-bound ordered sequences before state dominance: ` +
        `${plan.estimatedOrderedSequences}\n`
    );

    const outputRoot = path.resolve(
        invocationDirectory(),
        options.outputRoot ?? path.join(workspaceRoot(), '.local', 'precomputed')
    );
    await mkdir(outputRoot, { recursive: true });
    const stagingDirectory = path.join(
        outputRoot,
        `.${dataset.manifest.datasetSha256.slice(0, 12)}.${process.pid}.tmp`
    );
    if (await stat(stagingDirectory).catch(() => null)) {
        throw new Error(`Precomputation staging directory already exists: ${stagingDirectory}`);
    }
    await mkdir(stagingDirectory, { recursive: true });

    const startedAt = performance.now();
    const files: RecipeCorpusFile[] = [];
    try {
        let completedProducts = 0;
        let currentProductId: string | undefined;
        for (const partition of generateRecipeCorpusPartitions(plan)) {
            if (currentProductId !== undefined && currentProductId !== partition.coverage.productId) {
                completedProducts++;
                process.stdout.write(
                    `[${completedProducts}/${plan.configuration.productIds.length}] ` +
                    `${currentProductId}\n`
                );
            }
            currentProductId = partition.coverage.productId;
            const relativePath = partitionPath(partition);
            const content = Buffer.from(`${JSON.stringify(partition)}\n`, 'utf8');
            await writeNewFile(resolveFile(stagingDirectory, relativePath), content);
            files.push(describeCorpusFile(relativePath, content, partition));
        }
        if (currentProductId !== undefined) {
            completedProducts++;
            process.stdout.write(
                `[${completedProducts}/${plan.configuration.productIds.length}] ${currentProductId}\n`
            );
        }

        const manifest = buildRecipeCorpusManifest(
            identity(dataset),
            plan.configuration,
            plan.estimatedOrderedSequences,
            files
        );
        const manifestContent = Buffer.from(`${JSON.stringify(manifest)}\n`, 'utf8');
        await writeNewFile(path.join(stagingDirectory, 'manifest.json'), manifestContent);
        await verifyRecipeCorpusArtifact(stagingDirectory);

        const artifactDirectory = path.join(
            outputRoot,
            dataset.manifest.gameVersion,
            dataset.manifest.datasetSha256,
            manifest.artifactSha256
        );
        await mkdir(path.dirname(artifactDirectory), { recursive: true });
        const existing = await stat(artifactDirectory).catch(() => null);
        if (existing !== null) {
            const existingManifest = await verifyRecipeCorpusArtifact(artifactDirectory);
            if (existingManifest.artifactSha256 !== manifest.artifactSha256) {
                throw new Error(`Existing artifact has a different identity: ${artifactDirectory}`);
            }
            await rm(stagingDirectory, { recursive: true });
        } else {
            await rename(stagingDirectory, artifactDirectory);
        }
        await verifyRecipeCorpusArtifact(artifactDirectory);

        const durationMs = performance.now() - startedAt;
        const byteLength = files.reduce((total, file) => total + file.byteLength, 0) +
            manifestContent.byteLength;
        process.stdout.write(
            `Verified ${manifest.counts.recipes} recipes in ${manifest.counts.partitions} ` +
            `partitions (${formatBytes(byteLength)}) in ${durationMs.toFixed(1)} ms\n`
        );
        process.stdout.write(`Artifact: ${artifactDirectory}\n`);
    } catch (error) {
        await rm(stagingDirectory, { recursive: true, force: true });
        throw error;
    }
}

function parseArguments(arguments_: readonly string[]): CliOptions {
    const normalizedArguments = arguments_[0] === '--' ? arguments_.slice(1) : arguments_;
    const defaults = defaultSelectiveCorpusOptions();
    let dataset: string | undefined;
    let outputRoot: string | undefined;
    const productIds: string[] = [];
    const ingredientIds: string[] = [];
    const requiredEffectIds: string[] = [];
    const forbiddenEffectIds: string[] = [];
    let maxIngredients = defaults.maxIngredients;
    let maxStates = defaults.maxStates;
    for (let index = 0; index < normalizedArguments.length; index++) {
        const argument = normalizedArguments[index]!;
        const value = (): string => {
            const next = normalizedArguments[++index];
            if (next === undefined) throw new Error(`Missing value after ${argument}`);
            return next;
        };
        switch (argument) {
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
            case '--help':
                process.stdout.write(helpText);
                process.exit(0);
            default:
                throw new Error(`Unknown precomputation argument ${JSON.stringify(argument)}`);
        }
    }
    return {
        ...(dataset === undefined ? {} : { dataset }),
        ...(outputRoot === undefined ? {} : { outputRoot }),
        corpus: {
            ...(productIds.length === 0 ? {} : { productIds }),
            ...(ingredientIds.length === 0 ? {} : { ingredientIds }),
            maxIngredients,
            maxStates,
            requiredEffectIds,
            forbiddenEffectIds,
        },
    };
}

async function writeNewFile(output: string, content: Uint8Array): Promise<void> {
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, content, { flag: 'wx' });
}

function resolveFile(root: string, relativePath: string): string {
    const resolved = path.resolve(root, ...relativePath.split('/'));
    if (!resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error(`Precomputation path escapes staging directory: ${relativePath}`);
    }
    return resolved;
}

function invocationDirectory(): string {
    return process.env.INIT_CWD ?? process.cwd();
}

function integer(value: string, name: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe integer`);
    return parsed;
}

function formatBytes(value: number): string {
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
    return `${(value / 1024 ** 2).toFixed(1)} MiB`;
}

const helpText = `Usage: pnpm solver:precompute -- [options]

Options:
  --dataset PATH          Normalized dataset; defaults to the newest local dataset
  --output-root PATH      Artifact root; defaults to .local/precomputed
  --product ID            Include one base product; repeat for more
  --ingredient ID         Include one mixing ingredient; repeat for more
  --required-effect ID    Require a resulting effect; repeat for more
  --forbidden-effect ID   Forbid a resulting effect; repeat for more
  --max-depth NUMBER      Maximum ingredient count (default: 3)
  --max-states NUMBER     State limit per product (default: 100000)
  --help                  Show this help
`;

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
});
