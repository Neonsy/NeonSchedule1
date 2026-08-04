import { type } from 'arktype';

import { ColorSchema, Vector2Schema } from './common.js';

export const EffectSchema = type({
    schema: "'neonschedule1-effect-1'",
    id: 'string',
    name: 'string',
    tier: 'number',
    addictiveness: 'number',
    implementedPriorMixingRework: 'boolean',
    value: {
        change: 'number',
        multiplier: 'number',
        addBaseValueMultiple: 'number',
    },
    mixing: {
        direction: Vector2Schema,
        magnitude: 'number',
    },
    presentation: {
        description: 'string',
        productColor: ColorSchema,
        labelColor: ColorSchema,
    },
});
export type Effect = typeof EffectSchema.infer;
