import { type } from 'arktype';

import { Vector2Schema } from '#core/data/common';

export const StandardMixingRuleProfileSchema = type({
    kind: "'standard'",
});
export type StandardMixingRuleProfile = typeof StandardMixingRuleProfileSchema.infer;

export const SeededRotationMixingRuleProfileSchema = type({
    kind: "'seeded-rotation'",
    angleDegrees: 'number',
});
export type SeededRotationMixingRuleProfile =
    typeof SeededRotationMixingRuleProfileSchema.infer;

export const MixingRuleProfileSchema = StandardMixingRuleProfileSchema.or(
    SeededRotationMixingRuleProfileSchema
);
export type MixingRuleProfile = typeof MixingRuleProfileSchema.infer;

export const standardMixingRuleProfile: StandardMixingRuleProfile = Object.freeze({
    kind: 'standard',
});

export function mixingRuleProfileFromGameSeed(gameSeed: number): MixingRuleProfile {
    if (!Number.isSafeInteger(gameSeed) || gameSeed < -0x8000_0000 || gameSeed > 0x7fff_ffff) {
        throw new TypeError('Mixing game seed must be a signed 32-bit integer');
    }
    return {
        kind: 'seeded-rotation',
        angleDegrees: ((gameSeed % 360) + 360) % 360,
    };
}

export function normalizeMixingRuleProfile(
    input: unknown = standardMixingRuleProfile
): MixingRuleProfile {
    const profile = MixingRuleProfileSchema.assert(input);
    if (profile.kind === 'standard') return standardMixingRuleProfile;
    if (!Number.isInteger(profile.angleDegrees) ||
        profile.angleDegrees < 0 || profile.angleDegrees >= 360) {
        throw new TypeError('Seeded mixing rotation must be an integer from 0 through 359 degrees');
    }
    return { kind: profile.kind, angleDegrees: profile.angleDegrees };
}

export function sameMixingRuleProfile(
    left: MixingRuleProfile,
    right: MixingRuleProfile
): boolean {
    return left.kind === right.kind &&
        (left.kind === 'standard' ||
            (right.kind === 'seeded-rotation' && left.angleDegrees === right.angleDegrees));
}

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
