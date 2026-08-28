import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { canonicalJson, type MapService } from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

import { servicePublicContent } from '#public-data/map/compile';
import {
    MapPublicationInputSchema,
    ProcessedMapProvenanceSchema,
    type MapPublicationInput,
    type ProcessedMapProvenance,
} from '#public-data/map/input';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const inputPath = path.join(packageRoot, 'inputs', 'map.json');
const provenancePath = path.join(packageRoot, 'assets', 'map', 'provenance.json');

describe('map publication input', () => {
    it('keeps the selected dataset and finite map facts explicit', async () => {
        const input = await readInput();

        expect(input.compatibility).toEqual({
            gameVersion: '0.4.6f13',
            normalizerVersion: '0.0.40',
            datasetSha256: '5ee8e697d8ba3eaad5e1eed7ddb2a2ebfa39bb591fc629290d0d05d609190a90',
        });
        expect(input.maps.map((map) => [map.id, map.label, map.markerCoverage])).toEqual([
            ['hyland-point', 'Hyland Point', 'mapped'],
            ['tutorial-area', 'Tutorial area', 'none'],
        ]);
        expect(input.canvas).toEqual({ width: 4096, height: 4096 });
        expect(input.regions).toHaveLength(6);
        expect(input.regions.every((region) => region.mapId === 'hyland-point')).toBe(true);
        expect(input.regions.map((region) => region.label)).toEqual([
            'Docks',
            'Downtown',
            'Northtown',
            'Suburbia',
            'Uptown',
            'Westville',
        ]);
        const regionPoints = input.regions.flatMap((region) => region.polygon);
        expect(regionPoints.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)))
            .toBe(true);
        expect(regionPoints.some((point) =>
            point.x < 0 || point.y < 0 || point.x > input.canvas.width || point.y > input.canvas.height
        )).toBe(true);
    });

    it('publishes 229 markers and keeps dealer state positions', async () => {
        const input = await readInput();
        expect(input.markers).toHaveLength(229);
        expect(input.markers.every((marker) => marker.mapId === 'hyland-point')).toBe(true);
        expect(input.markers.flatMap((marker) => marker.positions)).toHaveLength(235);
        expect(countBy(input.markers, (marker) => marker.source.family)).toEqual({
            person: 72,
            property: 13,
            service: 136,
            shop: 8,
        });
        expect(countBy(input.markers, (marker) => marker.kind)).toEqual({
            atm: 16,
            barbershop: 1,
            'blackjack-table': 1,
            'cash-for-trash': 13,
            customer: 66,
            'dead-drop': 25,
            dealer: 6,
            parking: 33,
            'pawn-shop': 1,
            'pay-phone': 17,
            property: 13,
            shop: 8,
            'skateboard-seller': 1,
            'slot-machine': 5,
            'supplier-meetup': 4,
            'supplier-stash': 4,
            'tattoo-shop': 1,
            'vehicle-dealership': 1,
            'vehicle-repaint': 1,
            'vending-machine': 12,
        });
        const dealers = input.markers.filter((marker) => marker.kind === 'dealer');
        expect(dealers).toHaveLength(6);
        for (const dealer of dealers) {
            expect(dealer.positions.map((position) => [position.state, position.label])).toEqual([
                ['dealer', 'Dealer'],
                ['potential-dealer', 'Potential dealer'],
            ]);
        }
        const positions = input.markers.flatMap((marker) => marker.positions);
        expect(positions.filter((position) => position.regionId === null)).toHaveLength(4);
        expect(positions.every((position) =>
            position.position.x >= 0 &&
            position.position.y >= 0 &&
            position.position.x <= input.canvas.width &&
            position.position.y <= input.canvas.height
        )).toBe(true);
    });

    it('records every deliberate omission', async () => {
        const input = await readInput();
        expect(Object.fromEntries(input.omissions.map((omission) => [
            omission.sourceFamily,
            omission.count,
        ]))).toEqual({
            'world.locations.poi': 121,
            'world.locations.property-mirror': 13,
            'world.locations.shop-mirror': 12,
            'world.locations.service-mirror': 138,
            'shops.unpositioned': 4,
            'world.services.visual-only': 2,
        });
    });

    it('keeps recipient labels separate from source identities', async () => {
        const input = await readInput();
        const markerIds = input.markers.map((marker) => marker.id);
        expect(new Set(markerIds).size).toBe(markerIds.length);
        expect(markerIds.every((id) => /^marker-[0-9a-f]{20}$/u.test(id))).toBe(true);
        expect(input.markers.every((marker) => marker.label !== marker.source.key)).toBe(true);
        expect(input.markerKinds.map((entry) => entry.kind).sort()).toEqual(
            [...new Set(input.markers.map((marker) => marker.kind))].sort()
        );
        const forbiddenKeys = new Set([
            'steamId',
            'platformId',
            'playerId',
            'userId',
            'username',
        ]);
        expect([...objectKeys(input)].filter((key) => forbiddenKeys.has(key))).toEqual([]);
    });

    it('is strict and canonically serialized', async () => {
        const content = await readFile(inputPath, 'utf8');
        const input = MapPublicationInputSchema.assert(JSON.parse(content) as unknown);
        expect(content).toBe(canonicalJson(input));
        expect(() => MapPublicationInputSchema.assert({ ...input, unexpected: true }))
            .toThrow();
    });
});

describe('processed map provenance', () => {
    it('matches the checked-in lossless map assets', async () => {
        const provenance = await readProvenance();
        expect(provenance.opencvVersion).toBe('5.0.0');
        expect(provenance.parameters).toEqual({
            sourceBlend: 0.75,
            targetBlend: 0.25,
            edgeBlend: 0.12,
            cannyLow: 64,
            cannyHigh: 160,
            pngCompression: 9,
        });
        expect(provenance.assets).toHaveLength(2);
        for (const asset of provenance.assets) {
            expect(asset).toMatchObject({
                width: 4096,
                height: 4096,
                treatmentId: 'source-derived-map-grade-1',
                source: { dtype: 'uint8', channels: 4, alphaCoverage: 1 },
                output: { dtype: 'uint8', channels: 4, alphaCoverage: 1 },
            });
            const content = await readFile(path.join(packageRoot, asset.path));
            expect(createHash('sha256').update(content).digest('hex')).toBe(asset.outputSha256);
        }
    });
});

describe('map service public forms', () => {
    it.each([
        ['atm', 'atm', 'ATM'],
        ['barbershop', 'barbershop', 'Barbershop'],
        ['blackjack-table', 'blackjack-table', 'Blackjack table'],
        ['cash-for-trash', 'cash-for-trash', 'Cash for trash'],
        ['parking-lot', 'parking', 'Parking'],
        ['pawn-shop', 'pawn-shop', 'Pawn shop'],
        ['pay-phone', 'pay-phone', 'Pay phone'],
        ['skateboard-seller', 'skateboard-seller', 'Skateboard seller'],
        ['slot-machine', 'slot-machine', 'Slot machine'],
        ['tattoo-shop', 'tattoo-shop', 'Tattoo shop'],
        ['vehicle-dealership', 'vehicle-dealership', 'Vehicle dealership'],
        ['vehicle-repaint', 'vehicle-repaint', 'Vehicle repainting'],
        ['vending-machine', 'vending-machine', 'Vending machine'],
    ] as const)('maps %s without exposing its source name', (sourceKind, kind, label) => {
        expect(servicePublicContent(service(sourceKind, 'Internal source name', 'Internal copy')))
            .toEqual({ kind, label, description: null });
    });

    it.each(['dead-drop', 'supplier-meetup', 'supplier-stash'] as const)(
        'accepts verified game-facing copy for %s',
        (kind) => {
            expect(servicePublicContent(service(kind, 'Approved place', 'Approved direction')))
                .toEqual({ kind, label: 'Approved place', description: 'Approved direction' });
        }
    );

    it('fails closed for visual-only, unknown, or incomplete services', () => {
        expect(() => servicePublicContent(service('pay-phone-visual', 'Pay Phone', 'Model')))
            .toThrow(/Missing public map service mapping/u);
        expect(() => servicePublicContent(service('new-service', 'New service', 'Description')))
            .toThrow(/Missing public map service mapping/u);
        expect(() => servicePublicContent(service('dead-drop', 'Place', '')))
            .toThrow(/has no approved public text/u);
    });
});

async function readInput(): Promise<MapPublicationInput> {
    return MapPublicationInputSchema.assert(JSON.parse(
        await readFile(inputPath, 'utf8')
    ) as unknown);
}

async function readProvenance(): Promise<ProcessedMapProvenance> {
    return ProcessedMapProvenanceSchema.assert(JSON.parse(
        await readFile(provenancePath, 'utf8')
    ) as unknown);
}

function countBy<T>(values: readonly T[], key: (value: T) => string): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const value of values) {
        const result = key(value);
        counts[result] = (counts[result] ?? 0) + 1;
    }
    return counts;
}

function* objectKeys(value: unknown): Iterable<string> {
    if (Array.isArray(value)) {
        for (const item of value) yield* objectKeys(item);
        return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        yield key;
        yield* objectKeys(child);
    }
}

function service(kind: string, name: string, description: string): MapService {
    return {
        kind,
        id: 'service-id',
        name,
        description,
        sceneName: 'Main',
        regionId: null,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        accessPointPosition: null,
        accessPointRotation: null,
        locationSource: 'test',
        linkedPersonId: null,
    };
}
