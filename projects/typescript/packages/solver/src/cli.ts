import { link, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
    defaultSearchBenchmarkOptions,
    runSearchBenchmark,
    type BenchmarkCustomerState,
    type SearchBenchmarkOptions,
    type SearchBenchmarkReport,
} from '#solver/benchmark';
import {
    loadSolverDataset,
    resolveDatasetDirectory,
    workspaceRoot,
} from '#solver/dataset';

interface CliOptions {
    readonly dataset?: string;
    readonly output?: string;
    readonly benchmark: SearchBenchmarkOptions;
}

async function main(): Promise<void> {
    const options = parseArguments(process.argv.slice(2));
    const datasetDirectory = await resolveDatasetDirectory(
        options.dataset === undefined ? undefined : path.resolve(invocationDirectory(), options.dataset)
    );
    process.stdout.write(`Loading normalized dataset ${datasetDirectory}\n`);
    const dataset = await loadSolverDataset(datasetDirectory);
    const report = runSearchBenchmark(dataset, options.benchmark, (completed, total, result) => {
        process.stdout.write(
            `[${completed}/${total}] ${result.id}: ${result.duration.medianMs.toFixed(1)} ms\n`
        );
    });
    const output =
        options.output === undefined
            ? defaultOutputPath(report)
            : path.resolve(invocationDirectory(), options.output);
    await writeReport(output, report);
    process.stdout.write(`Benchmark report: ${output}\n`);
}

function parseArguments(arguments_: readonly string[]): CliOptions {
    const defaults = defaultSearchBenchmarkOptions();
    let dataset: string | undefined;
    let output: string | undefined;
    let depths = defaults.depths;
    let iterations = defaults.iterations;
    let warmups = defaults.warmups;
    let limit = defaults.limit;
    let maxStates = defaults.maxStates;
    let recipeCostCeilingFractions = defaults.recipeCostCeilingFractions;
    let customerCount = defaults.customerCount;
    let customerIds: readonly string[] | undefined;
    let customerStates = defaults.customerStates;
    let quality = defaults.quality;
    let quantity = defaults.quantity;
    let priceMultiplier = defaults.priceMultiplier;
    let maximumProductionCost = defaults.maximumProductionCost;

    for (let index = 0; index < arguments_.length; index++) {
        const argument = arguments_[index]!;
        const value = (): string => {
            const next = arguments_[++index];
            if (next === undefined) throw new Error(`Missing value after ${argument}`);
            return next;
        };
        switch (argument) {
            case '--':
                break;
            case '--dataset':
                dataset = value();
                break;
            case '--output':
                output = value();
                break;
            case '--depths':
                depths = commaSeparatedIntegers(value(), 'depths');
                break;
            case '--iterations':
                iterations = integer(value(), 'iterations');
                break;
            case '--warmups':
                warmups = integer(value(), 'warmups');
                break;
            case '--limit':
                limit = integer(value(), 'limit');
                break;
            case '--max-states':
                maxStates = integer(value(), 'max-states');
                break;
            case '--recipe-cost-fractions':
                recipeCostCeilingFractions = commaSeparatedNumbers(
                    value(),
                    'recipe-cost-fractions'
                );
                break;
            case '--customer-count':
                customerCount = integer(value(), 'customer-count');
                break;
            case '--customers':
                customerIds = commaSeparated(value(), 'customers');
                break;
            case '--customer-states':
                customerStates = commaSeparated(value(), 'customer-states').map(
                    customerStateValue
                );
                break;
            case '--quality':
                quality = qualityValue(value());
                break;
            case '--quantity':
                quantity = integer(value(), 'quantity');
                break;
            case '--price-multiplier':
                priceMultiplier = numberValue(value(), 'price-multiplier');
                break;
            case '--maximum-production-cost':
                maximumProductionCost = numberValue(value(), 'maximum-production-cost');
                break;
            case '--help':
                process.stdout.write(helpText);
                process.exit(0);
            default:
                throw new Error(`Unknown benchmark argument ${JSON.stringify(argument)}`);
        }
    }

    return {
        ...(dataset === undefined ? {} : { dataset }),
        ...(output === undefined ? {} : { output }),
        benchmark: {
            depths,
            iterations,
            warmups,
            limit,
            maxStates,
            recipeCostCeilingFractions,
            customerCount,
            ...(customerIds === undefined ? {} : { customerIds }),
            customerStates,
            quality,
            quantity,
            priceMultiplier,
            maximumProductionCost,
        },
    };
}

async function writeReport(output: string, report: SearchBenchmarkReport): Promise<void> {
    const directory = path.dirname(output);
    await mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `.${path.basename(output)}.${process.pid}.tmp`);
    try {
        await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, {
            encoding: 'utf8',
            flag: 'wx',
        });
        await link(temporary, output);
        await rm(temporary);
    } catch (error) {
        await rm(temporary, { force: true });
        throw error;
    }
}

function defaultOutputPath(report: SearchBenchmarkReport): string {
    const timestamp = report.createdAt.replaceAll(':', '-');
    return path.join(
        workspaceRoot(),
        '.local',
        'benchmarks',
        `search-${report.dataset.datasetSha256.slice(0, 12)}-${timestamp}.json`
    );
}

function invocationDirectory(): string {
    return process.env.INIT_CWD ?? process.cwd();
}

function commaSeparatedIntegers(value: string, name: string): number[] {
    return commaSeparated(value, name).map((entry) => integer(entry, name));
}

function commaSeparatedNumbers(value: string, name: string): number[] {
    return commaSeparated(value, name).map((entry) => numberValue(entry, name));
}

function commaSeparated(value: string, name: string): string[] {
    const result = value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    if (result.length === 0) throw new Error(`${name} must contain at least one value`);
    return result;
}

function integer(value: string, name: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe integer`);
    return parsed;
}

function numberValue(value: string, name: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`${name} must be a finite number`);
    return parsed;
}

function qualityValue(value: string): SearchBenchmarkOptions['quality'] {
    if (
        value === 'Trash' ||
        value === 'Poor' ||
        value === 'Standard' ||
        value === 'Premium' ||
        value === 'Heavenly'
    ) {
        return value;
    }
    throw new Error(`Unknown customer quality ${JSON.stringify(value)}`);
}

function customerStateValue(value: string): BenchmarkCustomerState {
    if (
        value === 'baseline' ||
        value === 'maximum-addiction' ||
        value === 'maximum-relationship'
    ) {
        return value;
    }
    throw new Error(`Unknown benchmark customer state ${JSON.stringify(value)}`);
}

const helpText = `Usage: pnpm solver:benchmark -- [options]

Options:
  --dataset PATH                  Normalized dataset directory; defaults to the newest local dataset
  --output PATH                   Report path; defaults to .local/benchmarks
  --depths LIST                   Comma-separated ingredient depths (default: 3,4,5)
  --iterations NUMBER             Measured runs per case (default: 3)
  --warmups NUMBER                Unmeasured warmups per case (default: 1)
  --limit NUMBER                  Results requested per search (default: 10)
  --max-states NUMBER             State limit per recipe/product search (default: 100000)
  --recipe-cost-fractions LIST    Fractions of maximum ingredient-path cost (default: 0.25,0.5)
  --customer-count NUMBER         Spend-quantile customers to select (default: 3)
  --customers LIST                Explicit comma-separated customer IDs
  --customer-states LIST          baseline, maximum-addiction, maximum-relationship
  --quality NAME                  Customer quality (default: Standard)
  --quantity NUMBER               Product quantity (default: 1)
  --price-multiplier NUMBER       Asking-price multiplier (default: 1)
  --maximum-production-cost NUM   Production-cost ceiling (default: 100)
  --help                          Show this help
`;

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
});
