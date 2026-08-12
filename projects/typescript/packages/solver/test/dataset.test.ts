import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
    canonicalJson,
    DatasetManifestSchema,
    normalizedDatasetIdentityInput,
    type CustomerCatalog,
    type DatasetFile,
    type DatasetManifest,
    type MixingRules,
    type TradeCatalog,
} from '@neonschedule1/core';
import { afterEach, describe, expect, it } from 'vitest';

import { loadSolverDataset, type SolverDataset } from '#solver/dataset';
import { loadProductionRuntime } from '#solver/production-runtime';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) =>
            rm(directory, { recursive: true, force: true })
        )
    );
});

describe('normalized dataset loading', () => {
    it('rejects a changed file record under the previous dataset identity', async () => {
        const fixture = await writeDatasetFixture();
        const loaded = await loadSolverDataset(fixture.directory);
        expect(loaded.mixingRules.maxProperties).toBe(8);

        const changedRules = { ...loaded.mixingRules, maxProperties: 7 };
        const changedContent = canonicalJson(changedRules);
        await writeFile(path.join(fixture.directory, 'mixing/rules.json'), changedContent);
        const changedManifest = DatasetManifestSchema.assert({
            ...fixture.manifest,
            files: fixture.manifest.files.map((file) =>
                file.path === 'mixing/rules.json'
                    ? describeFile(file.path, changedContent)
                    : file
            ),
        });
        await writeFile(
            path.join(fixture.directory, 'manifest.json'),
            canonicalJson(changedManifest)
        );

        await expect(loadSolverDataset(fixture.directory)).rejects.toThrow(
            'Normalized dataset identity mismatch'
        );
        const forgedDataset: SolverDataset = {
            ...loaded,
            manifest: changedManifest,
            mixingRules: changedRules,
        };
        await expect(
            loadProductionRuntime(forgedDataset, {
                packageDirectory: path.join(fixture.directory, 'missing-package'),
            })
        ).rejects.toThrow('Normalized dataset identity mismatch');
    });
});

async function writeDatasetFixture(): Promise<{
    directory: string;
    manifest: DatasetManifest;
}> {
    const directory = await mkdtemp(path.join(tmpdir(), 'neonschedule1-dataset-'));
    temporaryDirectories.push(directory);
    const documents = new Map<string, unknown>([
        ['customers/catalog.json', customerCatalog()],
        ['mixing/rules.json', mixingRules()],
        ['people/trade.json', tradeCatalog()],
    ]);
    const files: DatasetFile[] = [];
    for (const [relativePath, document] of documents) {
        const content = canonicalJson(document);
        const output = path.join(directory, ...relativePath.split('/'));
        await mkdir(path.dirname(output), { recursive: true });
        await writeFile(output, content);
        files.push(describeFile(relativePath, content));
    }
    const identityInput = normalizedDatasetIdentityInput({
        schema: 'neonschedule1-normalized-data-1',
        normalizerVersion: 'test-normalizer',
        gameVersion: 'test-game',
        sourceReportSha256: 'a'.repeat(64),
        sourceManifestSha256: 'b'.repeat(64),
        files,
        counts: emptyCounts(),
        deferredDomains: [],
    });
    const manifest = DatasetManifestSchema.assert({
        ...identityInput,
        datasetSha256: sha256(canonicalJson(identityInput)),
    });
    await writeFile(path.join(directory, 'manifest.json'), canonicalJson(manifest));
    return { directory, manifest };
}

function describeFile(relativePath: string, content: string): DatasetFile {
    return {
        path: relativePath,
        sha256: sha256(content),
        byteLength: Buffer.byteLength(content),
    };
}

function sha256(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
}

function mixingRules(): MixingRules {
    return {
        schema: 'neonschedule1-mixing-rules-1',
        maxProperties: 8,
        maxDeltaDifference: 0,
        defaultProductIds: [],
        maps: [],
    };
}

function tradeCatalog(): TradeCatalog {
    return {
        schema: 'neonschedule1-trade-catalog-2',
        dealerMechanics: {
            maximumCustomers: 10,
            dealArrivalDelay: 30,
            travelTime: { minimum: 15, maximum: 360 },
            overflowSlotCount: 10,
            cashReminderThreshold: 500,
            relationshipChangePerDeal: 0.05,
        },
        dealers: [],
        suppliers: [],
    };
}

function customerCatalog(): CustomerCatalog {
    return {
        schema: 'neonschedule1-customer-catalog-2',
        constants: {
            addictionDrainPerDay: 0,
            affinityMaxEffect: 0,
            approachChancePerDayMax: 0,
            approachMinimumAddiction: 0,
            approachMinimumCooldown: 0,
            approachMaximumCooldown: 0,
            dealCooldown: 0,
            minimumTravelTime: 0,
            maximumTravelTime: 0,
            minimumNormalizedRelationshipForRecommendation: 0,
            minimumOrderAppeal: 0,
            propertyMaxEffect: 0,
            qualityMaxEffect: 0,
            guaranteedDealerRecommendationRelationship: 0,
            guaranteedSupplierRecommendationRelationship: 0,
            minimumRelationship: 0,
            maximumRelationship: 0,
            maximumOrderQuantityPerProduct: 0,
            qualityTierTolerance: 0,
            sampleRequiresRecommendation: false,
            attackDealCooldown: 0,
            customerUnlockedCartelInfluenceChange: 0,
            dealAttendanceTolerance: 0,
            dealRejectedRelationshipChange: 0,
            offerExpiryTimeMinutes: 0,
            relationshipThresholdToGiveDealToCartel: 0,
        },
        qualityTiers: [],
        productEvaluationInputs: [],
        customerIds: [],
    };
}

function emptyCounts(): DatasetManifest['counts'] {
    return {
        items: 0,
        effects: 0,
        mixingMaps: 0,
        mixingOracleCases: 0,
        shops: 0,
        properties: 0,
        customers: 0,
        seeds: 0,
        shroomSpawns: 0,
        stationRecipes: 0,
        ovenTransforms: 0,
        productionStations: 0,
        directAssetFiles: 0,
        offlineAssetFiles: 0,
        meshAssets: 0,
        materialAssets: 0,
    };
}
