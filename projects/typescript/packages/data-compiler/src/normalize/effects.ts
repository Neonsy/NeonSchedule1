import { EffectSchema, type Effect } from '@neonschedule1/core';

import type { RawReport } from '../acquisition/types.js';
import { indexUnique, Integrity, requireReferences } from '../integrity.js';
import { booleanField, color, numberField, stringArrayField, stringField } from '../json.js';

export function normalizeEffects(report: RawReport, integrity: Integrity): Effect[] {
    const effectIndex = indexUnique(report.mixing.effects, 'id', 'report.mixing.effects', integrity);
    const visualIndex = indexUnique(
        report.discovery.effectVisuals,
        'effectId',
        'report.discovery.effectVisuals',
        integrity
    );
    const effectIds = new Set(effectIndex.keys());

    requireReferences(visualIndex.keys(), effectIds, 'effect presentation', integrity);
    integrity.check(
        'every effect has one presentation',
        visualIndex.size === effectIndex.size,
        `Expected ${effectIndex.size} effect presentations, found ${visualIndex.size}`
    );
    validateEffectReferences(report, effectIds, integrity);

    const effects = [...effectIndex.entries()]
        .map(([id, raw]) => {
            const path = `report.mixing.effects[${JSON.stringify(id)}]`;
            const visual = visualIndex.get(id);
            if (visual === undefined) {
                integrity.addError(`Effect ${JSON.stringify(id)} has no presentation`);
                return null;
            }
            const name = stringField(raw, 'name', path);
            const visualName = stringField(visual, 'name', `${path}.presentation`);
            if (visualName !== name) {
                integrity.addError(
                    `Effect ${JSON.stringify(id)} name differs between mixing and presentation data`
                );
            }
            return EffectSchema.assert({
                schema: 'neonschedule1-effect-1',
                id,
                name,
                tier: numberField(raw, 'tier', path),
                addictiveness: numberField(raw, 'addictiveness', path),
                implementedPriorMixingRework: booleanField(raw, 'implementedPriorMixingRework', path),
                value: {
                    change: numberField(raw, 'valueChange', path),
                    multiplier: numberField(raw, 'valueMultiplier', path),
                    addBaseValueMultiple: numberField(raw, 'addBaseValueMultiple', path),
                },
                mixing: {
                    direction: {
                        x: numberField(raw, 'mixDirectionX', path),
                        y: numberField(raw, 'mixDirectionY', path),
                    },
                    magnitude: numberField(raw, 'mixMagnitude', path),
                },
                presentation: {
                    description: stringField(visual, 'description', `${path}.presentation`),
                    productColor: color(visual.productColor, `${path}.presentation.productColor`),
                    labelColor: color(visual.labelColor, `${path}.presentation.labelColor`),
                },
            } satisfies Effect);
        })
        .filter((effect): effect is Effect => effect !== null)
        .sort((left, right) => left.id.localeCompare(right.id));

    integrity.check(
        'normalized effect count matches the report',
        effects.length === report.mixing.effects.length,
        `Expected ${report.mixing.effects.length} normalized effects, produced ${effects.length}`
    );
    return effects;
}

function validateEffectReferences(
    report: RawReport,
    effectIds: ReadonlySet<string>,
    integrity: Integrity
): void {
    for (const [index, product] of report.products.entries()) {
        const path = `report.products[${index}]`;
        const id = stringField(product, 'id', path);
        requireReferences(stringArrayField(product, 'effectIds', path), effectIds, `product ${id} effect`, integrity);
    }
    for (const [index, ingredient] of report.mixing.ingredients.entries()) {
        const path = `report.mixing.ingredients[${index}]`;
        const id = stringField(ingredient, 'id', path);
        requireReferences(
            stringArrayField(ingredient, 'effectIds', path),
            effectIds,
            `ingredient ${id} effect`,
            integrity
        );
    }
}
