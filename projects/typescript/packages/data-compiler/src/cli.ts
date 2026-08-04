import path from 'node:path';
import process from 'node:process';

import { compileDataset } from '#data-compiler/compile';
import { IntegrityError } from '#data-compiler/integrity';

const usage = `Usage: pnpm data:normalize -- --acquisition <directory> [--output <directory>]`;

interface Options {
    readonly acquisition: string;
    readonly output?: string;
}

async function main(): Promise<number> {
    const args = process.argv.slice(2);
    if (args.includes('--help')) {
        console.log(usage);
        return 0;
    }

    let options: Options;
    try {
        options = parseOptions(args);
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        console.error(usage);
        return 1;
    }

    try {
        const result = await compileDataset(options.acquisition, options.output);
        const { counts } = result.manifest;
        const productionCount =
            counts.seeds +
            counts.shroomSpawns +
            counts.stationRecipes +
            counts.ovenTransforms +
            counts.productionStations;
        console.log(`Normalized dataset: ${result.directory}`);
        console.log(`Dataset SHA-256: ${result.manifest.datasetSha256}`);
        console.log(
            `Items=${counts.items} Effects=${counts.effects} ` +
                `MixingMaps=${counts.mixingMaps} Oracles=${counts.mixingOracleCases} ` +
                `Shops=${counts.shops} Properties=${counts.properties} ` +
                `Production=${productionCount} ` +
                `Assets=${counts.directAssetFiles + counts.offlineAssetFiles}`
        );
        if (result.reusedExisting) console.log('Existing hash-addressed dataset verified and reused.');
        return 0;
    } catch (error) {
        if (error instanceof IntegrityError) {
            console.error(error.message);
            error.issues.forEach((issue) => console.error(`- ${issue}`));
            return 2;
        }
        console.error(error instanceof Error ? error.message : String(error));
        return 1;
    }
}

export function parseOptions(args: readonly string[]): Options {
    if (args[0] === '--') args = args.slice(1);
    const values = new Map<string, string>();
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index];
        const value = args[index + 1];
        if (key === undefined || !key.startsWith('--') || value === undefined || value.startsWith('--')) {
            throw new Error(`Invalid argument near ${JSON.stringify(key ?? 'end of command')}`);
        }
        if (key !== '--acquisition' && key !== '--output') {
            throw new Error(`Unknown argument ${key}`);
        }
        if (values.has(key)) throw new Error(`Duplicate argument ${key}`);
        values.set(key, value);
    }
    const acquisition = values.get('--acquisition');
    if (acquisition === undefined) throw new Error('Missing required argument --acquisition');
    const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
    const output = values.get('--output');
    return {
        acquisition: path.resolve(invocationDirectory, acquisition),
        ...(output === undefined ? {} : { output: path.resolve(invocationDirectory, output) }),
    };
}

process.exitCode = await main();
