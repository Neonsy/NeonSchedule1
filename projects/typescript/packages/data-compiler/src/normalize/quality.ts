import type { ProductionQualityRules } from '@neonschedule1/core';

import type { RawReport } from '#data-compiler/acquisition/types';
import { indexUnique, Integrity, requireReferences } from '#data-compiler/integrity';
import { numberField, stringField } from '#data-compiler/json';

// Plant.Initialize sets this level and ItemQuality.GetQuality applies the tier thresholds with `>`.
const basePlantQualityLevel = 0.5;
const qualityTierDefinitions = [
    { name: 'Trash', minimumLevelExclusive: null },
    { name: 'Poor', minimumLevelExclusive: 0.25 },
    { name: 'Standard', minimumLevelExclusive: 0.4 },
    { name: 'Premium', minimumLevelExclusive: 0.75 },
    { name: 'Heavenly', minimumLevelExclusive: 0.9 },
] as const;

export function normalizeProductionQuality(
    report: RawReport,
    itemIds: ReadonlySet<string>,
    integrity: Integrity
): ProductionQualityRules {
    const path = 'report.qualityMechanics';
    const scalars = indexUnique(
        report.qualityMechanics.qualityScalars,
        'quality',
        `${path}.qualityScalars`,
        integrity
    );
    integrity.check(
        'quality mechanics define every production quality tier',
        scalars.size === qualityTierDefinitions.length,
        `Expected ${qualityTierDefinitions.length} quality scalars, found ${scalars.size}`
    );

    const productIds = report.products.map((raw, index) =>
        stringField(raw, 'id', `report.products[${index}]`)
    );
    const valuesByProduct = new Map<string, Set<number>>();
    const tiersByProduct = new Map<string, Set<string>>();
    report.qualityValues.forEach((raw, index) => {
        const valuePath = `report.qualityValues[${index}]`;
        const productId = stringField(raw, 'productId', valuePath);
        requireReferences([productId], itemIds, `${valuePath}.productId`, integrity);
        const quality = stringField(raw, 'quality', valuePath);
        if (!scalars.has(quality)) {
            integrity.addError(
                `${valuePath}.quality references unknown tier ${JSON.stringify(quality)}`
            );
        }
        const sampledTiers = tiersByProduct.get(productId) ?? new Set<string>();
        if (sampledTiers.has(quality)) {
            integrity.addError(
                `${valuePath} duplicates ${JSON.stringify(productId)} quality ${JSON.stringify(quality)}`
            );
        }
        sampledTiers.add(quality);
        tiersByProduct.set(productId, sampledTiers);
        const values = valuesByProduct.get(productId) ?? new Set<number>();
        values.add(numberField(raw, 'monetaryValue', valuePath));
        valuesByProduct.set(productId, values);
    });
    for (const productId of productIds) {
        integrity.check(
            `quality monetary samples cover every tier for ${productId}`,
            tiersByProduct.get(productId)?.size === scalars.size,
            `Expected ${scalars.size} quality monetary samples for ${JSON.stringify(productId)}, ` +
                `found ${tiersByProduct.get(productId)?.size ?? 0}`
        );
    }
    const observedVariation = [...valuesByProduct.values()].some((values) => values.size > 1);
    integrity.check(
        'reported quality monetary behavior matches sampled products',
        observedVariation === report.qualityMechanics.monetaryValueVariesByQuality,
        'Reported monetaryValueVariesByQuality differs from sampled quality values'
    );
    integrity.check(
        'product monetary value is independent of quality',
        !observedVariation,
        'Quality-dependent monetary values require an explicit production value model'
    );
    integrity.check(
        'customer quality effect is normalized',
        report.qualityMechanics.customerQualityMaxEffect >= 0 &&
            report.qualityMechanics.customerQualityMaxEffect <= 1,
        'customerQualityMaxEffect must be between zero and one'
    );

    return {
        basePlantLevel: basePlantQualityLevel,
        monetaryValueVariesByQuality: false,
        customerQualityMaxEffect: report.qualityMechanics.customerQualityMaxEffect,
        tiers: qualityTierDefinitions.map((definition) => {
            const raw = scalars.get(definition.name);
            return {
                ...definition,
                customerScalar:
                    raw === undefined
                        ? 0
                        : numberField(raw, 'scalar', `${path}.qualityScalars[${definition.name}]`),
            };
        }),
    };
}
