import path from 'node:path';

import { loadSolverDataset, resolveDatasetDirectory, workspaceRoot } from '#solver/dataset';
import { planExhaustiveCorpus } from '#solver/precompute';
import { refreshRecipeCorpusProduction } from '#solver/precompute-refresh';

interface CliOptions {
    readonly dataset?: string;
    readonly outputRoot?: string;
    readonly reportRoot?: string;
    readonly maxIngredients: number;
    readonly maxStates: number;
    readonly verificationLimit: number;
}

async function main(): Promise<void> {
    const options = parseArguments(process.argv.slice(2));
    const datasetDirectory = await resolveDatasetDirectory(
        options.dataset === undefined
            ? undefined
            : path.resolve(invocationDirectory(), options.dataset)
    );
    const outputRoot = path.resolve(
        invocationDirectory(),
        options.outputRoot ?? path.join(workspaceRoot(), '.local', 'precomputed')
    );
    const reportRoot = path.resolve(
        invocationDirectory(),
        options.reportRoot ?? path.join(workspaceRoot(), '.local', 'verifications')
    );
    process.stdout.write(`Loading normalized dataset ${datasetDirectory}\n`);
    const dataset = await loadSolverDataset(datasetDirectory);
    const plan = planExhaustiveCorpus(dataset, {
        maxIngredients: options.maxIngredients,
        maxStates: options.maxStates,
    });
    process.stdout.write(
        `Refreshing exhaustive production coverage: ` +
        `${plan.configuration.productIds.length} products, ` +
        `${plan.configuration.ingredientIds.length} ingredients, ` +
        `depth ${plan.configuration.maxIngredients}, ` +
        `${plan.configuration.maxStates} states\n`
    );
    const result = await refreshRecipeCorpusProduction(dataset, plan, {
        outputRoot,
        reportRoot,
        verificationLimit: options.verificationLimit,
        onCorpusProgress: ({ completedProducts, totalProducts, productId, resumed }) => {
            process.stdout.write(
                `[product ${completedProducts}/${totalProducts}] ${productId}` +
                `${resumed ? ' (resumed)' : ''}\n`
            );
        },
        onRecipeVerification: (completed, total, verification) => {
            process.stdout.write(
                `[recipe ${completed}/${total}] ${verification.id}: ` +
                `${verification.resultCount} results\n`
            );
        },
        onCustomerVerification: (completed, total, verification) => {
            process.stdout.write(
                `[customer ${completed}/${total}] ${verification.id}: ` +
                `${verification.resultCount} results\n`
            );
        },
    });
    process.stdout.write(`Corpus: ${result.corpusDirectory}\n`);
    process.stdout.write(`Index: ${result.indexDirectory}\n`);
    process.stdout.write(`Verification: ${result.reportPath}\n`);
    process.stdout.write(
        `Selected production corpus ${result.selection.corpus.artifactSha256}\n`
    );
    process.stdout.write(`Selection: ${result.selectionPath}\n`);
}

function parseArguments(arguments_: readonly string[]): CliOptions {
    const argumentsWithoutSeparator = arguments_[0] === '--' ? arguments_.slice(1) : arguments_;
    let dataset: string | undefined;
    let outputRoot: string | undefined;
    let reportRoot: string | undefined;
    let maxIngredients: number | undefined;
    let maxStates: number | undefined;
    let verificationLimit = 10;
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
            case '--max-depth':
                maxIngredients = integer(value(), 'max-depth', 0);
                break;
            case '--max-states':
                maxStates = integer(value(), 'max-states', 1);
                break;
            case '--limit':
                verificationLimit = integer(value(), 'limit', 1);
                break;
            case '--help':
                process.stdout.write(helpText);
                process.exit(0);
            default:
                throw new Error(`Unknown refresh argument ${JSON.stringify(argument)}`);
        }
    }
    if (maxIngredients === undefined || maxStates === undefined) {
        throw new Error('Production refresh requires --max-depth and --max-states');
    }
    return {
        ...(dataset === undefined ? {} : { dataset }),
        ...(outputRoot === undefined ? {} : { outputRoot }),
        ...(reportRoot === undefined ? {} : { reportRoot }),
        maxIngredients,
        maxStates,
        verificationLimit,
    };
}

function invocationDirectory(): string {
    return process.env.INIT_CWD ?? process.cwd();
}

function integer(value: string, label: string, minimum: number): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum) {
        throw new Error(`${label} must be a safe integer greater than or equal to ${minimum}`);
    }
    return parsed;
}

const helpText = `Usage: pnpm solver:precompute:refresh -- [options]

Required:
  --max-depth NUMBER      Maximum ingredient count for production coverage
  --max-states NUMBER     Exact state ceiling per product

Options:
  --dataset PATH          Normalized dataset; defaults to the newest local dataset
  --output-root PATH      Artifact root; defaults to .local/precomputed
  --report-root PATH      Verification report root; defaults to .local/verifications
  --limit NUMBER          Results compared per verification case (default: 10)
  --help                  Show this help
`;

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
});
