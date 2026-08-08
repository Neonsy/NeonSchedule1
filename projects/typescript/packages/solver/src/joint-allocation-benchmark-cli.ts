import { link, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
    defaultJointAllocationBenchmarkOptions,
    runJointAllocationBenchmark,
    type JointAllocationBenchmarkOptions,
    type JointAllocationBenchmarkReport,
} from '#solver/joint-allocation-benchmark';
import {
    loadSolverDataset,
    resolveDatasetDirectory,
    workspaceRoot,
} from '#solver/dataset';

interface CliOptions {
    readonly dataset?: string;
    readonly output?: string;
    readonly benchmark: JointAllocationBenchmarkOptions;
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
    const report = runJointAllocationBenchmark(
        dataset,
        options.benchmark,
        (completed, total, result) => {
            const sample = result.samples[0]!;
            process.stdout.write(
                `[${completed}/${total}] ${result.id}: ` +
                `${result.duration.medianMs.toFixed(3)} ms, ` +
                `${sample.evidence.evaluatedDealerSubsets} subsets, ` +
                `${sample.evidence.allocationVisitedStates} states (${sample.status})\n`
            );
        }
    );
    process.stdout.write(
        `Generated ${report.recommendationGeneration.optionCount} options for ` +
        `${report.recommendationGeneration.customerIds.length} customers in ` +
        `${report.recommendationGeneration.durationMs.toFixed(3)} ms\n`
    );
    const output = options.output === undefined
        ? defaultOutputPath(report)
        : path.resolve(invocationDirectory(), options.output);
    await writeReport(output, report);
    process.stdout.write(`Joint allocation benchmark report: ${output}\n`);
}

function parseArguments(arguments_: readonly string[]): CliOptions {
    const defaults = defaultJointAllocationBenchmarkOptions();
    let dataset: string | undefined;
    let output: string | undefined;
    let scenarios = defaults.scenarios;
    let iterations = defaults.iterations;
    let warmups = defaults.warmups;
    let maxIngredients = defaults.maxIngredients;
    let recommendationLimit = defaults.recommendationLimit;
    let recipeMaxStates = defaults.recipeMaxStates;
    let maximumOptionProductionCost = defaults.maximumOptionProductionCost;
    let maximumDealerSubsets = defaults.maximumDealerSubsets;
    let maximumStatesPerDealerSubset = defaults.maximumStatesPerDealerSubset;

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
            case '--scenario-ids': {
                const requested = entries(value(), 'scenario-ids');
                const byId = new Map(defaults.scenarios.map((scenario) => [scenario.id, scenario]));
                scenarios = requested.map((id) => {
                    const selected = byId.get(id);
                    if (selected === undefined) {
                        throw new Error(`Unknown joint allocation scenario ${JSON.stringify(id)}`);
                    }
                    return selected;
                });
                break;
            }
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
            case '--maximum-dealer-subsets':
                maximumDealerSubsets = integer(value(), 'maximum-dealer-subsets');
                break;
            case '--maximum-states-per-dealer-subset':
                maximumStatesPerDealerSubset = integer(
                    value(),
                    'maximum-states-per-dealer-subset'
                );
                break;
            case '--help':
                process.stdout.write(helpText);
                process.exit(0);
            default:
                throw new Error(
                    `Unknown joint allocation benchmark argument ${JSON.stringify(argument)}`
                );
        }
    }
    return {
        ...(dataset === undefined ? {} : { dataset }),
        ...(output === undefined ? {} : { output }),
        benchmark: {
            scenarios,
            iterations,
            warmups,
            maxIngredients,
            recommendationLimit,
            recipeMaxStates,
            maximumOptionProductionCost,
            maximumDealerSubsets,
            maximumStatesPerDealerSubset,
        },
    };
}

async function writeReport(
    output: string,
    report: JointAllocationBenchmarkReport
): Promise<void> {
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

function defaultOutputPath(report: JointAllocationBenchmarkReport): string {
    const timestamp = report.createdAt.replaceAll(':', '-');
    return path.join(
        workspaceRoot(),
        '.local',
        'benchmarks',
        `joint-allocation-${report.dataset.datasetSha256.slice(0, 12)}-${timestamp}.json`
    );
}

function invocationDirectory(): string {
    return process.env.INIT_CWD ?? process.cwd();
}

function entries(value: string, name: string): string[] {
    const result = value.split(',').map((entry) => entry.trim()).filter(Boolean);
    if (result.length === 0 || new Set(result).size !== result.length) {
        throw new Error(`${name} must contain unique values`);
    }
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

const helpText = `Usage: pnpm solver:benchmark:joint-allocation -- [options]

Options:
  --dataset PATH                         Normalized dataset; defaults to newest local dataset
  --output PATH                          Report path; defaults to .local/benchmarks
  --scenario-ids LIST                    Comma-separated default scenario IDs
  --iterations NUMBER                    Measured runs per scenario (default: 2)
  --warmups NUMBER                       Warmup runs per scenario (default: 1)
  --max-ingredients NUMBER               Recommendation recipe depth (default: 2)
  --recommendation-limit NUMBER          Options retained per customer (default: 5)
  --recipe-max-states NUMBER             State limit per recommendation search (default: 100000)
  --maximum-option-production-cost NUM   Per-option cost ceiling (default: 100)
  --maximum-dealer-subsets NUMBER        Active dealer sets per run (default: 64)
  --maximum-states-per-dealer-subset NUM Allocation states per active set (default: 100000)
  --help                                 Show this help
`;

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
});
