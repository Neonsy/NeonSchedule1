import { link, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
    loadSolverDataset,
    resolveDatasetDirectory,
    workspaceRoot,
} from '#solver/dataset';
import {
    defaultReverseSearchVerificationOptions,
    runReverseSearchVerification,
    type ReverseSearchVerificationOptions,
    type ReverseSearchVerificationReport,
} from '#solver/verify';

interface CliOptions {
    readonly dataset?: string;
    readonly output?: string;
    readonly verification: ReverseSearchVerificationOptions;
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
    const report = runReverseSearchVerification(
        dataset,
        options.verification,
        (completed, total, result) => {
            process.stdout.write(
                `[${completed}/${total}] ${result.id}: ${result.resultCount} exact results\n`
            );
        }
    );
    const output =
        options.output === undefined
            ? defaultOutputPath(report)
            : path.resolve(invocationDirectory(), options.output);
    await writeReport(output, report);
    process.stdout.write(
        `Verified ${report.cases.length} cases against ` +
            `${report.selection.exhaustiveRecipeCount} exhaustive recipes\n`
    );
    process.stdout.write(`Verification report: ${output}\n`);
}

function parseArguments(arguments_: readonly string[]): CliOptions {
    const defaults = defaultReverseSearchVerificationOptions();
    let dataset: string | undefined;
    let output: string | undefined;
    let depth = defaults.depth;
    let limit = defaults.limit;
    let maxStates = defaults.maxStates;
    let constraintCases = defaults.constraintCases;
    let maxRequiredEffects = defaults.maxRequiredEffects;

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
            case '--depth':
                depth = integer(value(), 'depth');
                break;
            case '--limit':
                limit = integer(value(), 'limit');
                break;
            case '--max-states':
                maxStates = integer(value(), 'max-states');
                break;
            case '--cases':
                constraintCases = integer(value(), 'cases');
                break;
            case '--max-required-effects':
                maxRequiredEffects = integer(value(), 'max-required-effects');
                break;
            case '--help':
                process.stdout.write(helpText);
                process.exit(0);
            default:
                throw new Error(`Unknown verification argument ${JSON.stringify(argument)}`);
        }
    }

    return {
        ...(dataset === undefined ? {} : { dataset }),
        ...(output === undefined ? {} : { output }),
        verification: {
            depth,
            limit,
            maxStates,
            constraintCases,
            maxRequiredEffects,
        },
    };
}

async function writeReport(
    output: string,
    report: ReverseSearchVerificationReport
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

function defaultOutputPath(report: ReverseSearchVerificationReport): string {
    const timestamp = report.createdAt.replaceAll(':', '-');
    return path.join(
        workspaceRoot(),
        '.local',
        'verifications',
        `reverse-search-${report.dataset.datasetSha256.slice(0, 12)}-${timestamp}.json`
    );
}

function invocationDirectory(): string {
    return process.env.INIT_CWD ?? process.cwd();
}

function integer(value: string, name: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe integer`);
    return parsed;
}

const helpText = `Usage: pnpm solver:verify -- [options]

Options:
  --dataset PATH                  Normalized dataset; defaults to the newest local dataset
  --output PATH                   Report path; defaults to .local/verifications
  --depth NUMBER                  Maximum ingredient count (default: 3)
  --limit NUMBER                  Results compared per case (default: 10)
  --max-states NUMBER             State limit per product search (default: 100000)
  --cases NUMBER                  Constraint sets tested (default: 24)
  --max-required-effects NUMBER   Largest required-effect set (default: 4)
  --help                          Show this help
`;

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
});
