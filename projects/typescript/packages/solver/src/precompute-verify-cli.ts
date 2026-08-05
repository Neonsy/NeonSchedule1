import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadSolverDataset, resolveDatasetDirectory, workspaceRoot } from '#solver/dataset';
import { RecipeCorpusLookup } from '#solver/precompute-query';
import { runRecipeIndexVerification } from '#solver/precompute-verify';

interface CliOptions {
    readonly dataset?: string;
    readonly corpus?: string;
    readonly index?: string;
    readonly output?: string;
    readonly limit: number;
}

async function main(): Promise<void> {
    const options = parseArguments(process.argv.slice(2));
    const datasetDirectory = await resolveDatasetDirectory(resolveArgument(options.dataset));
    const dataset = await loadSolverDataset(datasetDirectory);
    const precomputedRoot = path.join(workspaceRoot(), '.local', 'precomputed');
    const corpusDirectory = options.corpus === undefined
        ? await newestCorpus(
            precomputedRoot,
            dataset.manifest.gameVersion,
            dataset.manifest.datasetSha256
        )
        : path.resolve(invocationDirectory(), options.corpus);
    const indexDirectory = options.index === undefined
        ? await newestIndex(precomputedRoot, path.basename(corpusDirectory))
        : path.resolve(invocationDirectory(), options.index);
    process.stdout.write(`Corpus: ${corpusDirectory}\n`);
    process.stdout.write(`Index: ${indexDirectory}\n`);
    const lookup = await RecipeCorpusLookup.load(corpusDirectory, indexDirectory);
    const report = await runRecipeIndexVerification(
        dataset,
        lookup,
        options.limit,
        (completed, total, result) => {
            process.stdout.write(
                `[${completed}/${total}] ${result.id}: ${result.resultCount} results, ` +
                `${result.examinedRankingEntries} ranking entries examined\n`
            );
        }
    );
    const output = options.output === undefined
        ? path.join(
            workspaceRoot(),
            '.local',
            'verifications',
            `recipe-index-${report.indexArtifactSha256.slice(0, 12)}-` +
                `${report.createdAt.replaceAll(':', '-')}.json`
        )
        : path.resolve(invocationDirectory(), options.output);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    const maximumExamined = Math.max(
        ...report.cases.map((result) => result.examinedRankingEntries)
    );
    process.stdout.write(
        `Verified ${report.cases.length} indexed queries; maximum ranking scan ` +
        `${maximumExamined} of ${lookup.corpusManifest.counts.recipes} recipes\n`
    );
    process.stdout.write(`Verification report: ${output}\n`);
}

function parseArguments(arguments_: readonly string[]): CliOptions {
    const normalized = arguments_[0] === '--' ? arguments_.slice(1) : arguments_;
    let dataset: string | undefined;
    let corpus: string | undefined;
    let index: string | undefined;
    let output: string | undefined;
    let limit = 10;
    for (let position = 0; position < normalized.length; position++) {
        const argument = normalized[position]!;
        const value = (): string => {
            const next = normalized[++position];
            if (next === undefined) throw new Error(`Missing value after ${argument}`);
            return next;
        };
        switch (argument) {
            case '--dataset':
                dataset = value();
                break;
            case '--corpus':
                corpus = value();
                break;
            case '--index':
                index = value();
                break;
            case '--output':
                output = value();
                break;
            case '--limit':
                limit = integer(value(), 'limit');
                break;
            case '--help':
                process.stdout.write(helpText);
                process.exit(0);
            default:
                throw new Error(`Unknown index verification argument ${JSON.stringify(argument)}`);
        }
    }
    return {
        ...(dataset === undefined ? {} : { dataset }),
        ...(corpus === undefined ? {} : { corpus }),
        ...(index === undefined ? {} : { index }),
        ...(output === undefined ? {} : { output }),
        limit,
    };
}

async function newestCorpus(
    root: string,
    gameVersion: string,
    datasetSha256: string
): Promise<string> {
    const datasetRoot = path.join(root, gameVersion, datasetSha256);
    const candidates: { directory: string; modifiedAt: number }[] = [];
    for (const artifactHash of await directories(datasetRoot)) {
        const directory = path.join(datasetRoot, artifactHash);
        const manifest = await stat(path.join(directory, 'manifest.json')).catch(() => null);
        if (manifest?.isFile()) candidates.push({ directory, modifiedAt: manifest.mtimeMs });
    }
    return newest(candidates, `recipe corpus for dataset ${datasetSha256}`);
}

async function newestIndex(root: string, corpusHash: string): Promise<string> {
    const indexRoot = path.join(root, 'indexes', corpusHash);
    const candidates: { directory: string; modifiedAt: number }[] = [];
    for (const artifactHash of await directories(indexRoot)) {
        const directory = path.join(indexRoot, artifactHash);
        const manifest = await stat(path.join(directory, 'manifest.json')).catch(() => null);
        if (manifest?.isFile()) candidates.push({ directory, modifiedAt: manifest.mtimeMs });
    }
    return newest(candidates, `recipe index for corpus ${corpusHash}`);
}

function newest(
    candidates: { readonly directory: string; readonly modifiedAt: number }[],
    label: string
): string {
    candidates.sort(
        (left, right) => right.modifiedAt - left.modifiedAt ||
            left.directory.localeCompare(right.directory)
    );
    const selected = candidates[0];
    if (selected === undefined) throw new Error(`No ${label} artifact was found`);
    return selected.directory;
}

async function directories(root: string): Promise<string[]> {
    const entries = await readdir(root, { withFileTypes: true }).catch((error: unknown) => {
        throw new Error(`Could not read artifact directory ${root}`, { cause: error });
    });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

function resolveArgument(value: string | undefined): string | undefined {
    return value === undefined ? undefined : path.resolve(invocationDirectory(), value);
}

function invocationDirectory(): string {
    return process.env.INIT_CWD ?? process.cwd();
}

function integer(value: string, label: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error(`${label} must be a safe integer`);
    return parsed;
}

const helpText = `Usage: pnpm solver:precompute:verify -- [options]

Options:
  --dataset PATH   Normalized dataset; defaults to the newest local dataset
  --corpus PATH    Corpus artifact; defaults to the newest local corpus
  --index PATH     Index artifact; defaults to the newest index for the corpus
  --output PATH    Verification report; defaults to .local/verifications
  --limit NUMBER   Results compared per case (default: 10)
  --help           Show this help
`;

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
});
