import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
    canonicalJson,
    DatasetManifestSchema,
    normalizedDatasetIdentityInput,
    PropertyLayoutSchema,
    type DatasetFile,
    type DatasetManifest,
    type PropertyLayout,
} from '@neonschedule1/core';

import {
    compareConvexValidation,
    contentSha256,
    convexValidationRequestFileName,
    convexValidationResponseFileName,
    createConvexValidationRequest,
    parseConvexValidationRequest,
    parseConvexValidationResponse,
} from '#data-compiler/validation/convex-surface';

interface CliOptions {
    readonly command: 'prepare' | 'compare';
    readonly dataset?: string;
    readonly gameDirectory?: string;
    readonly exportDirectory?: string;
}

async function main(): Promise<void> {
    const options = parseArguments(process.argv.slice(2));
    const exportDirectory = await resolveExportDirectory(options);
    const localDirectory = path.join(workspaceRoot(), '.local', 'convex-validation');
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
    const datasetDirectory = await resolveDatasetDirectory(options.dataset);
    process.stdout.write(`Loading normalized dataset ${datasetDirectory}\n`);
    const { manifest, layouts } = await loadGeometryDataset(datasetDirectory);
    const request = createConvexValidationRequest(manifest, layouts);
    const content = Buffer.from(`${JSON.stringify(request, null, 2)}\n`);

    await rm(localDirectory, { recursive: true, force: true });
    await mkdir(localDirectory, { recursive: true });
    await mkdir(exportDirectory, { recursive: true });
    await removeStagedFiles(exportDirectory);
    await writeAtomic(path.join(localDirectory, 'request.json'), content);
    const stagedRequest = path.join(exportDirectory, convexValidationRequestFileName);
    await writeAtomic(stagedRequest, content);

    const rayCount = request.cases.reduce((sum, item) => sum + item.rays.length, 0);
    process.stdout.write(`Prepared ${request.cases.length} convex colliders and ${rayCount} face rays\n`);
    process.stdout.write(`Request SHA-256: ${contentSha256(content)}\n`);
    process.stdout.write(`Staged request: ${stagedRequest}\n`);
    process.stdout.write('Start Schedule I and load a save.\n');
}

async function compare(localDirectory: string, exportDirectory: string): Promise<void> {
    const requestPath = path.join(localDirectory, 'request.json');
    const responsePath = path.join(exportDirectory, convexValidationResponseFileName);
    const [requestContent, responseContent, responseSidecar] = await Promise.all([
        readFile(requestPath),
        readFile(responsePath),
        readFile(`${responsePath}.sha256`, 'ascii'),
    ]);
    const responseSha256 = contentSha256(responseContent);
    if (responseSidecar.trim() !== responseSha256) {
        throw new Error(
            `Convex validation response failed SHA-256 verification: expected ` +
                `${responseSidecar.trim()}, calculated ${responseSha256}`
        );
    }
    const request = parseConvexValidationRequest(JSON.parse(requestContent.toString('utf8')));
    const response = parseConvexValidationResponse(JSON.parse(responseContent.toString('utf8')));
    const report = compareConvexValidation(
        request,
        response,
        contentSha256(requestContent),
        responseSha256
    );
    await writeAtomic(path.join(localDirectory, 'response.json'), responseContent);
    await writeAtomic(
        path.join(localDirectory, 'response.json.sha256'),
        Buffer.from(responseSidecar)
    );
    await writeAtomic(
        path.join(localDirectory, 'report.json'),
        Buffer.from(`${JSON.stringify(report, null, 2)}\n`)
    );
    await removeStagedFiles(exportDirectory);

    process.stdout.write(
        `Convex validation passed ${report.caseCount} colliders and ${report.rayCount} rays ` +
            `with maximum point error ${report.maximumPointError}\n`
    );
    process.stdout.write(`Local evidence: ${localDirectory}\n`);
}

async function loadGeometryDataset(
    directory: string
): Promise<{ readonly manifest: DatasetManifest; readonly layouts: readonly PropertyLayout[] }> {
    const manifest = DatasetManifestSchema.assert(JSON.parse(
        await readFile(path.join(directory, 'manifest.json'), 'utf8')
    ) as unknown);
    const identity = createHash('sha256')
        .update(canonicalJson(normalizedDatasetIdentityInput(manifest)), 'utf8')
        .digest('hex');
    if (identity !== manifest.datasetSha256) {
        throw new Error(`Normalized dataset identity mismatch: expected ${manifest.datasetSha256}, computed ${identity}`);
    }
    const files = new Map(manifest.files.map((file) => [file.path, file]));
    const paths = manifest.files.map((file) => file.path)
        .filter((relativePath) => /^properties\/[^/]+\/layout\.json$/u.test(relativePath))
        .sort((left, right) => left.localeCompare(right));
    const layouts = await Promise.all(paths.map(async (relativePath) =>
        PropertyLayoutSchema.assert(JSON.parse(
            (await verifiedFile(directory, files, relativePath)).toString('utf8')
        ) as unknown)
    ));
    if (layouts.length !== manifest.counts.propertyLayouts) {
        throw new Error(
            `Expected ${manifest.counts.propertyLayouts} property layouts, loaded ${layouts.length}`
        );
    }
    return { manifest, layouts };
}

async function verifiedFile(
    root: string,
    files: ReadonlyMap<string, DatasetFile>,
    relativePath: string
): Promise<Buffer> {
    const expected = files.get(relativePath);
    if (expected === undefined) throw new Error(`Dataset manifest does not contain ${relativePath}`);
    const normalized = path.posix.normalize(relativePath.replaceAll('\\', '/'));
    if (normalized.startsWith('../') || normalized.startsWith('/') || /^[a-zA-Z]:/u.test(normalized)) {
        throw new Error(`Unsafe normalized dataset path: ${relativePath}`);
    }
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(resolvedRoot, ...normalized.split('/'));
    if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error(`Normalized dataset path escapes its root: ${relativePath}`);
    }
    const content = await readFile(resolved);
    const actualHash = contentSha256(content);
    if (content.byteLength !== expected.byteLength || actualHash !== expected.sha256) {
        throw new Error(`Normalized dataset file failed integrity verification: ${relativePath}`);
    }
    return content;
}

async function resolveDatasetDirectory(configured?: string): Promise<string> {
    if (configured !== undefined) {
        const directory = path.resolve(invocationDirectory(), configured);
        if (!(await stat(directory).catch(() => null))?.isDirectory()) {
            throw new Error(`Normalized dataset directory does not exist: ${directory}`);
        }
        return directory;
    }
    const root = path.join(workspaceRoot(), '.local', 'normalized');
    const candidates: { directory: string; modifiedAt: number }[] = [];
    await findDatasets(root, 0, candidates);
    candidates.sort(
        (left, right) => right.modifiedAt - left.modifiedAt || left.directory.localeCompare(right.directory)
    );
    const latest = candidates[0];
    if (latest === undefined) throw new Error(`No normalized dataset was found under ${root}`);
    return latest.directory;
}

async function findDatasets(
    directory: string,
    depth: number,
    result: { directory: string; modifiedAt: number }[]
): Promise<void> {
    const manifest = await stat(path.join(directory, 'manifest.json')).catch(() => null);
    if (manifest?.isFile()) {
        result.push({ directory, modifiedAt: manifest.mtimeMs });
        return;
    }
    if (depth === 3) return;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
        if (entry.isDirectory()) await findDatasets(path.join(directory, entry.name), depth + 1, result);
    }
}

function parseArguments(arguments_: readonly string[]): CliOptions {
    const argumentsList = arguments_[0] === '--' ? arguments_.slice(1) : arguments_;
    if (argumentsList[0] === '--help') {
        process.stdout.write(helpText);
        process.exit(0);
    }
    const command = argumentsList[0];
    if (command !== 'prepare' && command !== 'compare') {
        throw new Error('First argument must be prepare or compare. Use --help for usage.');
    }
    let dataset: string | undefined;
    let gameDirectory: string | undefined;
    let exportDirectory: string | undefined;
    for (let index = 1; index < argumentsList.length; index++) {
        const argument = argumentsList[index]!;
        const value = (): string => {
            const next = argumentsList[++index];
            if (next === undefined) throw new Error(`Missing value after ${argument}`);
            return next;
        };
        switch (argument) {
            case '--dataset': dataset = value(); break;
            case '--game-directory': gameDirectory = value(); break;
            case '--export-directory': exportDirectory = value(); break;
            case '--help': process.stdout.write(helpText); process.exit(0);
            default: throw new Error(`Unknown convex validation argument ${JSON.stringify(argument)}`);
        }
    }
    return {
        command,
        ...(dataset === undefined ? {} : { dataset }),
        ...(gameDirectory === undefined ? {} : { gameDirectory }),
        ...(exportDirectory === undefined ? {} : { exportDirectory }),
    };
}

async function resolveExportDirectory(options: CliOptions): Promise<string> {
    if (options.exportDirectory !== undefined) {
        return path.resolve(invocationDirectory(), options.exportDirectory);
    }
    const configured = options.gameDirectory ?? process.env.NEONSCHEDULE1_GAME_DIR;
    if (configured === undefined || configured.trim() === '') {
        throw new Error('Pass --game-directory or --export-directory, or set NEONSCHEDULE1_GAME_DIR');
    }
    const directory = path.resolve(invocationDirectory(), configured);
    if (!(await stat(directory).catch(() => null))?.isDirectory()) {
        throw new Error(`Game directory does not exist: ${directory}`);
    }
    return path.join(directory, 'UserData', 'NeonSchedule1', 'exports');
}

async function removeStagedFiles(exportDirectory: string): Promise<void> {
    await Promise.all([
        rm(path.join(exportDirectory, convexValidationRequestFileName), { force: true }),
        rm(path.join(exportDirectory, convexValidationResponseFileName), { force: true }),
        rm(path.join(exportDirectory, `${convexValidationResponseFileName}.sha256`), { force: true }),
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

function workspaceRoot(): string {
    return path.resolve(import.meta.dirname, '..', '..', '..');
}

function invocationDirectory(): string {
    return process.env.INIT_CWD ?? process.cwd();
}

const helpText = `Usage: pnpm data:validate-convex <prepare|compare> [options]

Options:
  --dataset PATH           Normalized dataset; defaults to the newest local dataset
  --game-directory PATH    Schedule I directory; defaults to NEONSCHEDULE1_GAME_DIR
  --export-directory PATH  Exporter output directory override
  --help                   Show this help
`;

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
});
