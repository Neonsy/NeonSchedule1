import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { canonicalJson } from '@neonschedule1/core';

import { compileMapPublicationInput } from '#public-data/map/compile';
import { loadMapPublicationSource } from '#public-data/map/dataset';
import { ProcessedMapProvenanceSchema } from '#public-data/map/input';

interface CliOptions {
    readonly dataset: string;
    readonly provenance: string;
    readonly output: string;
}

async function main(): Promise<void> {
    const options = parseArguments(process.argv.slice(2));
    const source = await loadMapPublicationSource(options.dataset);
    const provenance = ProcessedMapProvenanceSchema.assert(JSON.parse(
        await readFile(options.provenance, 'utf8')
    ) as unknown);
    await verifyProcessedAssets(provenance.assets);
    const input = compileMapPublicationInput(source, provenance);
    await mkdir(path.dirname(options.output), { recursive: true });
    await writeAtomic(options.output, canonicalJson(input));
    process.stdout.write(
        `Wrote ${input.markers.length} map markers and ${input.regions.length} regions to ` +
            `${options.output}\n`
    );
    for (const omission of input.omissions) {
        process.stdout.write(`Omitted ${omission.count} ${omission.sourceFamily} records\n`);
    }
}

async function writeAtomic(output: string, content: string): Promise<void> {
    const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    try {
        await rename(temporary, output);
    } catch (error) {
        await rm(temporary, { force: true });
        throw error;
    }
}

function parseArguments(arguments_: readonly string[]): CliOptions {
    const argumentsList = arguments_[0] === '--' ? arguments_.slice(1) : arguments_;
    if (argumentsList.includes('--help')) {
        process.stdout.write(helpText);
        process.exit(0);
    }
    let dataset: string | undefined;
    let provenance: string | undefined;
    let output: string | undefined;
    for (let index = 0; index < argumentsList.length; index++) {
        const argument = argumentsList[index]!;
        const value = (): string => {
            const next = argumentsList[++index];
            if (next === undefined) throw new Error(`Missing value after ${argument}`);
            return next;
        };
        switch (argument) {
            case '--dataset': dataset = value(); break;
            case '--provenance': provenance = value(); break;
            case '--output': output = value(); break;
            default: throw new Error(`Unknown argument: ${argument}`);
        }
    }
    if (dataset === undefined) {
        throw new Error('Missing --dataset. Use --help for usage.');
    }
    const packageRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
    const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
    return {
        dataset: path.resolve(invocationDirectory, dataset),
        provenance: provenance === undefined
            ? path.join(packageRoot, 'assets', 'map', 'provenance.json')
            : path.resolve(invocationDirectory, provenance),
        output: output === undefined
            ? path.join(packageRoot, 'inputs', 'map.json')
            : path.resolve(invocationDirectory, output),
    };
}

async function verifyProcessedAssets(
    assets: readonly { readonly path: string; readonly outputSha256: string }[]
): Promise<void> {
    const packageRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
    for (const asset of assets) {
        const normalized = path.posix.normalize(asset.path.replaceAll('\\', '/'));
        if (
            normalized === '.' ||
            normalized === '..' ||
            normalized.startsWith('../') ||
            normalized.startsWith('/') ||
            /^[a-zA-Z]:/u.test(normalized)
        ) {
            throw new Error(`Unsafe processed map asset path: ${asset.path}`);
        }
        const resolved = path.resolve(packageRoot, ...normalized.split('/'));
        if (!resolved.startsWith(`${packageRoot}${path.sep}`)) {
            throw new Error(`Processed map asset escapes its package: ${asset.path}`);
        }
        if (!(await stat(resolved).catch(() => null))?.isFile()) {
            throw new Error(`Processed map asset does not exist: ${asset.path}`);
        }
        const actualSha256 = createHash('sha256').update(await readFile(resolved)).digest('hex');
        if (actualSha256 !== asset.outputSha256) {
            throw new Error(
                `Processed map asset hash mismatch for ${asset.path}: expected ` +
                    `${asset.outputSha256}, computed ${actualSha256}`
            );
        }
    }
}

const helpText = `Compile the private map publication input.\n\n` +
    `Usage:\n` +
    `  pnpm --filter @neonschedule1/public-data map:compile -- ` +
    `--dataset <normalized-dataset> [--provenance <file>] [--output <file>]\n`;

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
