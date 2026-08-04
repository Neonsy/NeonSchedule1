import { describe, expect, it } from 'vitest';

import { MixingEngine, type Effect, type MixingRules } from '@neonschedule1/core';

describe('mixing engine', () => {
    it('applies map replacements in game order and preserves occupied effects', () => {
        const effects = [
            effect('a', 0, 0, 0.1),
            effect('b', 0, 0),
            effect('c', 0, 0),
            effect('shift', 1, 1),
        ];
        const rules: MixingRules = {
            schema: 'neonschedule1-mixing-rules-1',
            maxProperties: 8,
            maxDeltaDifference: 0.5,
            defaultProductIds: [],
            maps: [
                {
                    drugType: 'Test',
                    drugTypeValue: 0,
                    radius: 4,
                    effects: [
                        mapEffect('a', 0),
                        mapEffect('b', 1),
                        mapEffect('c', 2),
                        mapEffect('shift', 3),
                    ],
                },
            ],
        };
        const engine = new MixingEngine(rules, new Map(effects.map((entry) => [entry.id, entry])));

        expect(engine.mixEffectIds('Test', ['a', 'b'], 'shift')).toEqual(['a', 'c', 'shift']);
        expect(engine.calculateProductValue(35, ['a'])).toBe(38);
    });
});

function effect(id: string, directionX: number, magnitude: number, addBaseValueMultiple = 0): Effect {
    return {
        schema: 'neonschedule1-effect-1',
        id,
        name: id,
        tier: 0,
        addictiveness: 0,
        implementedPriorMixingRework: false,
        value: { change: 0, multiplier: 1, addBaseValueMultiple },
        mixing: { direction: { x: directionX, y: 0 }, magnitude },
        presentation: {
            description: '',
            productColor: color(),
            labelColor: color(),
        },
    };
}

function mapEffect(effectId: string, x: number) {
    return { effectId, position: { x, y: 0 }, radius: 0.01 };
}

function color() {
    return { r: 0, g: 0, b: 0, a: 1, htmlRgba: '#000000FF' };
}
