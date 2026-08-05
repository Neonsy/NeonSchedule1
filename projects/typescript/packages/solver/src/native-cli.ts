import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadSolverDataset, resolveDatasetDirectory, workspaceRoot } from '#solver/dataset';
import {
    compareNativeValidation,
    contentSha256,
    createNativeValidationRequest,
    defaultNativeValidationOptions,
    nativeValidationRequestFileName,
    nativeValidationResponseFileName,
    parseNativeValidationRequest,
    parseNativeValidationResponse,
    type NativeValidationOptions,
} from '#solver/native-validation';

interface CliOptions {
    readonly command: 'prepare' | 'compare';
    readonly dataset?: string;
    readonly gameDirectory?: string;
    readonly exportDirectory?: string;
    readonly validation: NativeValidationOptions;
}

async function main(): Promise<void> {
    const options = parseArguments(process.argv.slice(2));
    const exportDirectory = await resolveExportDirectory(options);
    const localDirectory = path.join(workspaceRoot(), '.local', 'native-validation');
    if (options.command === 'prepare') {
        await prepare(options, localDirectory, exportDirectory);
    } else {
        await compare(localDirectory, exportDirectory);
    }
}

async function prepare(
    options: CliOptions,
    localDirectory: string,
    exportDirectory: string
): Promise<void> {
    const datasetDirectory = await resolveDatasetDirectory(
        options.dataset === undefined
            ? undefined
            : path.resolve(invocationDirectory(), options.dataset)
    );
    process.stdout.write(`Loading normalized dataset ${datasetDirectory}\n`);
    const dataset = await loadSolverDataset(datasetDirectory);
    const request = createNativeValidationRequest(dataset, options.validation);
    const content = Buffer.from(`${JSON.stringify(request, null, 2)}\n`);

    await rm(localDirectory, { recursive: true, force: true });
    await mkdir(localDirectory, { recursive: true });
    await mkdir(exportDirectory, { recursive: true });
    await removeStagedFiles(exportDirectory);
    const localRequest = path.join(localDirectory, 'request.json');
    const stagedRequest = path.join(exportDirectory, nativeValidationRequestFileName);
    await writeAtomic(localRequest, content);
    await writeAtomic(stagedRequest, content);

    process.stdout.write(
        `Prepared ${request.cases.length} native cases at depths ` +
        `${[...new Set(request.cases.map((item) => item.ingredientIds.length))].sort().join(', ')}\n`
    );
    process.stdout.write(`Request SHA-256: ${contentSha256(content)}\n`);
    process.stdout.write(`Staged request: ${stagedRequest}\n`);
    process.stdout.write('Start Schedule I and load a save.\n');
}

async function compare(localDirectory: string, exportDirectory: string): Promise<void> {
    const requestPath = path.join(localDirectory, 'request.json');
    const responsePath = path.join(exportDirectory, nativeValidationResponseFileName);
    const sidecarPath = responsePath + '.sha256';
    const [requestContent, responseContent, responseSidecar] = await Promise.all([
        readFile(requestPath),
        readFile(responsePath),
        readFile(sidecarPath, 'ascii'),
    ]);
    const expectedResponseHash = responseSidecar.trim();
    const actualResponseHash = contentSha256(responseContent);
    if (expectedResponseHash !== actualResponseHash) {
        throw new Error(
            `Native response failed SHA-256 verification: expected ${expectedResponseHash}, ` +
            `calculated ${actualResponseHash}`
        );
    }
    const request = parseNativeValidationRequest(JSON.parse(requestContent.toString('utf8')));
    const response = parseNativeValidationResponse(JSON.parse(responseContent.toString('utf8')));
    const report = compareNativeValidation(
        request,
        response,
        contentSha256(requestContent),
        actualResponseHash
    );

    await writeAtomic(path.join(localDirectory, 'response.json'), responseContent);
    await writeAtomic(path.join(localDirectory, 'response.json.sha256'), Buffer.from(responseSidecar));
    await writeAtomic(
        path.join(localDirectory, 'report.json'),
        Buffer.from(`${JSON.stringify(report, null, 2)}\n`)
    );
    await removeStagedFiles(exportDirectory);

    process.stdout.write(
        `Native validation passed ${report.caseCount} cases at depths ` +
        `${report.ingredientDepths.join(', ')} against game ${report.gameVersion}\n`
    );
    process.stdout.write(`Local evidence: ${localDirectory}\n`);
}

function parseArguments(arguments_: readonly string[]): CliOptions {
    const normalizedArguments = arguments_[0] === '--' ? arguments_.slice(1) : arguments_;
    const command = normalizedArguments[0];
    if (command !== 'prepare' && command !== 'compare') {
        throw new Error('First argument must be prepare or compare. Use --help for usage.');
    }
    const defaults = defaultNativeValidationOptions();
    let dataset: string | undefined;
    let gameDirectory: string | undefined;
    let exportDirectory: string | undefined;
    let maxCases = defaults.maxCases;
    let maxStates = defaults.maxStates;
    for (let index = 1; index < normalizedArguments.length; index++) {
        const argument = normalizedArguments[index]!;
        const value = (): string => {
            const next = normalizedArguments[++index];
            if (next === undefined) throw new Error(`Missing value after ${argument}`);
            return next;
        };
        switch (argument) {
            case '--':
                break;
            case '--dataset':
                dataset = value();
                break;
            case '--game-directory':
                gameDirectory = value();
                break;
            case '--export-directory':
                exportDirectory = value();
                break;
            case '--max-cases':
                maxCases = integer(value(), 'max-cases');
                break;
            case '--max-states':
                maxStates = integer(value(), 'max-states');
                break;
            case '--help':
                process.stdout.write(helpText);
                process.exit(0);
            default:
                throw new Error(`Unknown native validation argument ${JSON.stringify(argument)}`);
        }
    }
    return {
        command,
        ...(dataset === undefined ? {} : { dataset }),
        ...(gameDirectory === undefined ? {} : { gameDirectory }),
        ...(exportDirectory === undefined ? {} : { exportDirectory }),
        validation: { maxCases, maxStates },
    };
}

async function resolveExportDirectory(options: CliOptions): Promise<string> {
    if (options.exportDirectory !== undefined) {
        return path.resolve(invocationDirectory(), options.exportDirectory);
    }
    const configuredGameDirectory = options.gameDirectory ?? process.env.NEONSCHEDULE1_GAME_DIR;
    if (configuredGameDirectory === undefined || configuredGameDirectory.trim() === '') {
        throw new Error('Pass --game-directory or --export-directory, or set NEONSCHEDULE1_GAME_DIR');
    }
    const gameDirectory = path.resolve(invocationDirectory(), configuredGameDirectory);
    if (!(await stat(gameDirectory).catch(() => null))?.isDirectory()) {
        throw new Error(`Game directory does not exist: ${gameDirectory}`);
    }
    return path.join(gameDirectory, 'UserData', 'NeonSchedule1', 'exports');
}

async function removeStagedFiles(exportDirectory: string): Promise<void> {
    await Promise.all([
        rm(path.join(exportDirectory, nativeValidationRequestFileName), { force: true }),
        rm(path.join(exportDirectory, nativeValidationResponseFileName), { force: true }),
        rm(path.join(exportDirectory, `${nativeValidationResponseFileName}.sha256`), { force: true }),
    ]);
}

async function writeAtomic(output: string, content: Uint8Array): Promise<void> {
    const temporary = `${output}.${process.pid}.tmp`;
    await writeFile(temporary, content, { flag: 'wx' });
    try {
        await rename(temporary, output);
    } catch (error) {
        await rm(temporary, { force: true });
        throw error;
    }
}

function invocationDirectory(): string {
    return process.env.INIT_CWD ?? process.cwd();
}

function integer(value: string, name: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe integer`);
    return parsed;
}

const helpText = `Usage: pnpm solver:native -- <prepare|compare> [options]

Options:
  --dataset PATH           Normalized dataset; defaults to the newest local dataset
  --game-directory PATH    Schedule I directory; defaults to NEONSCHEDULE1_GAME_DIR
  --export-directory PATH  Exporter output directory override
  --max-cases NUMBER       Bounded recipe count (default: 48, maximum: 64)
  --max-states NUMBER      State limit per solver winner search (default: 100000)
  --help                   Show this help
`;

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
});
