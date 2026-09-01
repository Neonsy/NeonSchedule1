import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ProcessedPropertyProvenanceSchema } from '#public-data/property/input';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const provenancePath = path.join(packageRoot, 'assets', 'properties', 'provenance.json');

describe('processed property provenance', () => {
    it('covers every property with a verified lossless derivative', async () => {
        const provenance = ProcessedPropertyProvenanceSchema.assert(JSON.parse(
            await readFile(provenancePath, 'utf8')
        ) as unknown);

        expect(provenance.opencvVersion).toBe('5.0.0');
        expect(provenance.source).toMatchObject({
            gameVersion: '0.4.6f13',
            datasetSha256: '5ee8e697d8ba3eaad5e1eed7ddb2a2ebfa39bb591fc629290d0d05d609190a90',
            exporterVersion: '0.0.33',
        });
        expect(provenance.parameters).toMatchObject({
            sourceBlend: 0.75,
            targetBlend: 0.25,
            outputWidth: 960,
            outputHeight: 720,
        });
        expect(provenance.assets).toHaveLength(13);
        expect(new Set(provenance.assets.map((asset) => asset.propertyCode)).size).toBe(13);
        expect(new Set(provenance.assets.map((asset) => asset.path)).size).toBe(13);
        for (const asset of provenance.assets) {
            expect(asset.path).toBe(`assets/properties/${asset.propertyCode}.png`);
            expect(asset.width).toBe(960);
            expect(asset.height).toBe(720);
            expect(asset.treatmentId).toBe('source-derived-property-grade-1');
            expect(asset.source.channels).toBe(4);
            expect(asset.output.channels).toBe(4);
            expect(asset.output.alphaCoverage).toBeGreaterThan(0);
            expect(asset.output.alphaCoverage).toBeLessThan(1);
            const content = await readFile(path.join(packageRoot, asset.path));
            expect(createHash('sha256').update(content).digest('hex')).toBe(asset.outputSha256);
        }
    });

    it('rejects undeclared source material', async () => {
        const source = JSON.parse(await readFile(provenancePath, 'utf8')) as object;
        expect(() => ProcessedPropertyProvenanceSchema.assert({
            ...source,
            rawCaptures: ['must remain private'],
        })).toThrow();
    });
});
