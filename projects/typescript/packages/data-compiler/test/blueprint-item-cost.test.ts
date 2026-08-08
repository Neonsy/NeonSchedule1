import { describe, expect, it } from 'vitest';

import {
    BlueprintItemCostSummarizer,
    type BlueprintDocument,
    type BlueprintValidationResult,
    type ResolvedBlueprintGridPlacement,
    type Shop,
} from '@neonschedule1/core';

describe('blueprint item and cost summaries', () => {
    it('counts placements and exposes deterministic minimum shop-listing costs', () => {
        const validation = validBlueprint([
            placement('rack-two', 'rack'),
            placement('light', 'grow-light'),
            placement('rack-one', 'rack'),
            placement('station', 'unlisted-station'),
        ]);
        const summary = new BlueprintItemCostSummarizer([
            shop('general', [
                listing('rack', 50),
                listing('grow-light', 80),
            ]),
            shop('hardware', [
                listing('rack', 40),
                listing('grow-light', 80),
            ]),
        ]).summarize(validation);

        expect(summary).toEqual({
            kind: 'summarized',
            validation,
            pricingBasis: 'minimum-listed-price-per-item',
            requirements: [
                {
                    itemId: 'grow-light',
                    quantity: 1,
                    placementIds: ['light'],
                    sources: [
                        source('general', 'grow-light', 80, 1),
                        source('hardware', 'grow-light', 80, 1),
                    ],
                    minimumListedSource: source('general', 'grow-light', 80, 1),
                },
                {
                    itemId: 'rack',
                    quantity: 2,
                    placementIds: ['rack-two', 'rack-one'],
                    sources: [
                        source('hardware', 'rack', 40, 2),
                        source('general', 'rack', 50, 2),
                    ],
                    minimumListedSource: source('hardware', 'rack', 40, 2),
                },
                {
                    itemId: 'unlisted-station',
                    quantity: 1,
                    placementIds: ['station'],
                    sources: [],
                    minimumListedSource: null,
                },
            ],
            pricedSubtotal: 160,
            minimumListedCost: null,
            unlistedItemIds: ['unlisted-station'],
        });
    });

    it('does not price an invalid blueprint', () => {
        const validation = { ...validBlueprint([]), valid: false };

        expect(new BlueprintItemCostSummarizer([]).summarize(validation)).toEqual({
            kind: 'invalid-blueprint',
            validation,
        });
    });

    it('rejects ambiguous or invalid shop listings', () => {
        expect(() => new BlueprintItemCostSummarizer([
            shop('general', [listing('rack', 40), listing('rack', 50)]),
        ])).toThrow('duplicate listing "rack"');
        expect(() => new BlueprintItemCostSummarizer([
            shop('general', [listing('rack', -1)]),
        ])).toThrow('Shop listing price must be non-negative');
    });
});

function validBlueprint(
    placements: readonly ResolvedBlueprintGridPlacement[]
): BlueprintValidationResult {
    const document: BlueprintDocument = {
        schema: 'neonschedule1-blueprint-1',
        gameVersion: '0.4.6f12',
        datasetSha256: 'a'.repeat(64),
        propertyCode: 'warehouse',
        placements: placements.map(({ id, itemId }) => ({
            id,
            kind: 'grid',
            itemId,
            gridId: 'main',
            anchor: { x: 0, y: 0 },
            rotation: 0,
        })),
    };
    return { document, valid: true, resolvedPlacements: placements, issues: [] };
}

function placement(id: string, itemId: string): ResolvedBlueprintGridPlacement {
    return {
        id,
        kind: 'grid',
        itemId,
        gridId: 'main',
        rotation: 0,
        tileSharingRule: 'standard',
        occupiedTiles: [],
        cornerObstacles: [],
    };
}

function shop(code: string, listings: Shop['listings']): Shop {
    return {
        schema: 'neonschedule1-shop-1',
        code,
        name: `${code} shop`,
        description: '',
        paymentType: 'Cash',
        sceneName: 'Main',
        locationSource: 'shop-position',
        position: null,
        rotation: null,
        holderPersonId: null,
        openTime: null,
        closeTime: null,
        deliveryBayPositions: [],
        listings,
    };
}

function listing(itemId: string, price: number): Shop['listings'][number] {
    return { itemId, price, defaultStock: null, canBeDelivered: false };
}

function source(
    shopCode: string,
    itemId: string,
    unitPrice: number,
    quantity: number
) {
    return {
        shopCode,
        shopName: `${shopCode} shop`,
        paymentType: 'Cash',
        unitPrice,
        quantity,
        totalPrice: unitPrice * quantity,
        defaultStock: null,
        canBeDelivered: false,
    };
}
