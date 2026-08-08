import { link, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
    defaultAllocationBenchmarkOptions,
    runAllocationBenchmark,
    type AllocationBenchmarkOptions,
    type AllocationBenchmarkReport,
    type AllocationBenchmarkStockMode,
} from '#solver/allocation-benchmark';
import {
    loadSolverDataset,
    resolveDatasetDirectory,
    workspaceRoot,
} from '#solver/dataset';

interface CliOptions {
    readonly dataset?: string;
    readonly output?: string;
    readonly benchmark: AllocationBenchmarkOptions;
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
    const report = runAllocationBenchmark(dataset, options.benchmark, (completed, total, result) => {
        const sample = result.samples[0]!;
        process.stdout.write(
            `[${completed}/${total}] ${result.id}: ` +
            `${result.duration.medianMs.toFixed(3)} ms, ` +
            `${sample.evidence.visitedStates} states (${sample.status})\n`
        );
    });
    process.stdout.write(
        `Generated ${report.recommendationGeneration.optionCount} options for ` +
        `${report.recommendationGeneration.customerIds.length} customers in ` +
        `${report.recommendationGeneration.durationMs.toFixed(3)} ms\n`
    );
    const output = options.output === undefined
        ? defaultOutputPath(report)
        : path.resolve(invocationDirectory(), options.output);
    await writeReport(output, report);
    process.stdout.write(`Allocation benchmark report: ${output}\n`);
}

function parseArguments(arguments_: readonly string[]): CliOptions {
    const defaults = defaultAllocationBenchmarkOptions();
    let dataset: string | undefined;
    let output: string | undefined;
    let customerCounts = defaults.customerCounts;
    let productionBudgetFractions = defaults.productionBudgetFractions;
    let stockModes = defaults.stockModes;
    let iterations = defaults.iterations;
    let warmups = defaults.warmups;
    let maxIngredients = defaults.maxIngredients;
    let recommendationLimit = defaults.recommendationLimit;
    let recipeMaxStates = defaults.recipeMaxStates;
    let maximumOptionProductionCost = defaults.maximumOptionProductionCost;
    let allocationMaxStates = defaults.allocationMaxStates;

    for (let index = 0; index < arguments_.length; index++) {
        const argument = arguments_[index]!;
        const value = (): string => {
            const next = arguments_[++index];
            if (next === undefined) throw new Error(`Missing value after ${argument}`);
            return next;
        };
        switch (argument) {
            case '--': break;
            case '--dataset': dataset = value(); break;
            case '--output': output = value(); break;
            case '--customer-counts':
                customerCounts = integers(value(), 'customer-counts');
                break;
            case '--production-budget-fractions':
                productionBudgetFractions = numbers(value(), 'production-budget-fractions');
                break;
            case '--stock-modes':
                stockModes = entries(value(), 'stock-modes').map(stockMode);
                break;
            case '--iterations': iterations = integer(value(), 'iterations'); break;
            case '--warmups': warmups = integer(value(), 'warmups'); break;
            case '--max-ingredients': maxIngredients = integer(value(), 'max-ingredients'); break;
            case '--recommendation-limit':
                recommendationLimit = integer(value(), 'recommendation-limit');
                break;
            case '--recipe-max-states':
                recipeMaxStates = integer(value(), 'recipe-max-states');
                break;
            case '--maximum-option-production-cost':
                maximumOptionProductionCost = finiteNumber(
                    value(),
                    'maximum-option-production-cost'
                );
                break;
            case '--allocation-max-states':
                allocationMaxStates = integer(value(), 'allocation-max-states');
                break;
            case '--help':
                process.stdout.write(helpText);
                process.exit(0);
            default:
                throw new Error(`Unknown allocation benchmark argument ${JSON.stringify(argument)}`);
        }
    }
    return {
        ...(dataset === undefined ? {} : { dataset }),
        ...(output === undefined ? {} : { output }),
        benchmark: {
            customerCounts,
            productionBudgetFractions,
            stockModes,
            iterations,
            warmups,
            maxIngredients,
            recommendationLimit,
            recipeMaxStates,
            maximumOptionProductionCost,
            allocationMaxStates,
        },
    };
}

async function writeReport(output: string, report: AllocationBenchmarkReport): Promise<void> {
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

function defaultOutputPath(report: AllocationBenchmarkReport): string {
    const timestamp = report.createdAt.replaceAll(':', '-');
    return path.join(
        workspaceRoot(),
        '.local',
        'benchmarks',
        `allocation-${report.dataset.datasetSha256.slice(0, 12)}-${timestamp}.json`
    );
}

function invocationDirectory(): string {
    return process.env.INIT_CWD ?? process.cwd();
}

function integers(value: string, name: string): number[] {
    return entries(value, name).map((entry) => integer(entry, name));
}

function numbers(value: string, name: string): number[] {
    return entries(value, name).map((entry) => finiteNumber(entry, name));
}

function entries(value: string, name: string): string[] {
    const result = value.split(',').map((entry) => entry.trim()).filter(Boolean);
    if (result.length === 0) throw new Error(`${name} must contain at least one value`);
    return result;
}

function integer(value: string, name: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe integer`);
    return parsed;
}

function finiteNumber(value: string, name: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`${name} must be finite`);
    return parsed;
}

function stockMode(value: string): AllocationBenchmarkStockMode {
    if (value === 'production-only' || value === 'one-per-mix') return value;
    throw new Error(`Unknown allocation benchmark stock mode ${JSON.stringify(value)}`);
}

const helpText = `Usage: pnpm solver:benchmark:allocation -- [options]

Options:
  --dataset PATH                       Normalized dataset; defaults to newest local dataset
  --output PATH                        Report path; defaults to .local/benchmarks
  --customer-counts LIST               Spend-quantile counts (default: 5,10,20)
  --production-budget-fractions LIST   Fractions of reference plan cost (default: 0.5,1)
  --stock-modes LIST                   production-only,one-per-mix
  --iterations NUMBER                  Measured allocation runs per case (default: 3)
  --warmups NUMBER                     Warmup allocation runs per case (default: 1)
  --max-ingredients NUMBER             Recommendation recipe depth (default: 2)
  --recommendation-limit NUMBER        Options retained per customer (default: 5)
  --recipe-max-states NUMBER           State limit per recommendation search (default: 100000)
  --maximum-option-production-cost NUM Per-option cost ceiling (default: 100)
  --allocation-max-states NUMBER       Allocation state limit (default: 1000000)
  --help                               Show this help
`;

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
});
