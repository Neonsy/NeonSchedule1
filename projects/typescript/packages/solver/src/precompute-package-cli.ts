import path from 'node:path';

import { loadSolverDataset, resolveDatasetDirectory, workspaceRoot } from '#solver/dataset';
import { packageRecipeCorpusProduction } from '#solver/precompute-package';

interface CliOptions {
    readonly dataset?: string;
    readonly outputRoot?: string;
    readonly reportRoot?: string;
    readonly packageRoot?: string;
}

async function main(): Promise<void> {
    const options = parseArguments(process.argv.slice(2));
    const directory = invocationDirectory();
    const datasetDirectory = await resolveDatasetDirectory(
        options.dataset === undefined
            ? undefined
            : path.resolve(directory, options.dataset)
    );
    const outputRoot = path.resolve(
        directory,
        options.outputRoot ?? path.join(workspaceRoot(), '.local', 'precomputed')
    );
    const reportRoot = path.resolve(
        directory,
        options.reportRoot ?? path.join(workspaceRoot(), '.local', 'verifications')
    );
    const packageRoot = path.resolve(
        directory,
        options.packageRoot ?? path.join(workspaceRoot(), '.local', 'runtime-artifacts')
    );
    process.stdout.write(`Loading normalized dataset ${datasetDirectory}\n`);
    const dataset = await loadSolverDataset(datasetDirectory);
    const result = await packageRecipeCorpusProduction(dataset, {
        outputRoot,
        reportRoot,
        packageRoot,
    });
    process.stdout.write(
        `Packaged production selection ${result.production.selection.selectionSha256}\n`
    );
    process.stdout.write(`Package: ${result.packageDirectory}\n`);
}

function parseArguments(arguments_: readonly string[]): CliOptions {
    const argumentsWithoutSeparator = arguments_[0] === '--' ? arguments_.slice(1) : arguments_;
    let dataset: string | undefined;
    let outputRoot: string | undefined;
    let reportRoot: string | undefined;
    let packageRoot: string | undefined;
    for (let position = 0; position < argumentsWithoutSeparator.length; position++) {
        const argument = argumentsWithoutSeparator[position]!;
        const value = (): string => {
            const next = argumentsWithoutSeparator[++position];
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
            case '--report-root':
                reportRoot = value();
                break;
            case '--package-root':
                packageRoot = value();
                break;
            case '--help':
                process.stdout.write(helpText);
                process.exit(0);
            default:
                throw new Error(`Unknown package argument ${JSON.stringify(argument)}`);
        }
    }
    return {
        ...(dataset === undefined ? {} : { dataset }),
        ...(outputRoot === undefined ? {} : { outputRoot }),
        ...(reportRoot === undefined ? {} : { reportRoot }),
        ...(packageRoot === undefined ? {} : { packageRoot }),
    };
}

function invocationDirectory(): string {
    return process.env.INIT_CWD ?? process.cwd();
}

const helpText = `Usage: pnpm solver:precompute:package -- [options]

Options:
  --dataset PATH       Normalized dataset; defaults to the newest local dataset
  --output-root PATH   Selected artifact root; defaults to .local/precomputed
  --report-root PATH   Verification report root; defaults to .local/verifications
  --package-root PATH  Package destination; defaults to .local/runtime-artifacts
  --help               Show this help
`;

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
});
