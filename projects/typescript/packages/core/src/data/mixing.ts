import { type } from 'arktype';

import { Vector2Schema } from '#core/data/common';

export const MixingMapEffectSchema = type({
    effectId: 'string',
    position: Vector2Schema,
    radius: 'number',
});
export type MixingMapEffect = typeof MixingMapEffectSchema.infer;

export const MixingMapSchema = type({
    drugType: 'string',
    drugTypeValue: 'number',
    radius: 'number',
    effects: MixingMapEffectSchema.array(),
});
export type MixingMap = typeof MixingMapSchema.infer;

export const MixingRulesSchema = type({
    schema: "'neonschedule1-mixing-rules-1'",
    maxProperties: 'number',
    maxDeltaDifference: 'number',
    defaultProductIds: 'string[]',
    maps: MixingMapSchema.array(),
});
export type MixingRules = typeof MixingRulesSchema.infer;
