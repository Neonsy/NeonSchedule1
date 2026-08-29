import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { canonicalJson } from '@neonschedule1/core';

import { compileBrowserDataArtifact } from '#public-data/browser/compile';
import { loadBrowserPublicationSource } from '#public-data/browser/dataset';
import { MapPublicationInputSchema } from '#public-data/map/input';

interface CliOptions {
    readonly dataset: string;
    readonly map: string;
    readonly output: string | null;
}

async function main(): Promise<void> {
    const options = parseArguments(process.argv.slice(2));
    const source = await loadBrowserPublicationSource(options.dataset);
    const mapInput = MapPublicationInputSchema.assert(JSON.parse(
        await readFile(options.map, 'utf8')
    ) as unknown);
    await verifyMapAssets(mapInput.maps.map((map) => map.image));
    const artifact = compileBrowserDataArtifact(source, mapInput);
    const packageRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
    const output = options.output ?? path.join(
        packageRoot,
        'artifacts',
        artifact.compatibility.gameVersion,
        'data.json'
    );
    await mkdir(path.dirname(output), { recursive: true });
    await writeAtomic(output, canonicalJson(artifact));
    process.stdout.write(
        `Wrote ${artifact.counts.items} items, ${artifact.counts.customers} customers, ` +
            `${artifact.counts.people} people, and ${artifact.counts.mapMarkers} map markers ` +
            `to ${output}\n`
    );
}

async function verifyMapAssets(
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
    let mapInput: string | undefined;
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
            case '--map': mapInput = value(); break;
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
        map: mapInput === undefined
            ? path.join(packageRoot, 'inputs', 'map.json')
            : path.resolve(invocationDirectory, mapInput),
        output: output === undefined ? null : path.resolve(invocationDirectory, output),
    };
}

const helpText = `Compile the browser-safe public data artifact.\n\n` +
    `Usage:\n` +
    `  pnpm --filter @neonschedule1/public-data browser:compile -- ` +
    `--dataset <normalized-dataset> [--map <map-input>] [--output <file>]\n`;

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
