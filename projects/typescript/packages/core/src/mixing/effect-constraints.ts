import type { MixingEngine } from '#core/mixing/engine';

export class FinalEffectConstraints {
    readonly #required: ReadonlySet<string>;
    readonly #forbidden: ReadonlySet<string>;

    constructor(
        engine: MixingEngine,
        requiredEffectIds: readonly string[],
        forbiddenEffectIds: readonly string[]
    ) {
        this.#required = effectIdSet(engine, requiredEffectIds, 'required');
        this.#forbidden = effectIdSet(engine, forbiddenEffectIds, 'forbidden');
        for (const effectId of this.#required) {
            if (this.#forbidden.has(effectId)) {
                throw new Error(
                    `Mixing effect ${JSON.stringify(effectId)} cannot be both required and forbidden`
                );
            }
        }
    }

    matches(effectIds: readonly string[]): boolean {
        for (const effectId of this.#required) {
            if (!effectIds.includes(effectId)) return false;
        }
        for (const effectId of this.#forbidden) {
            if (effectIds.includes(effectId)) return false;
        }
        return true;
    }
}

function effectIdSet(
    engine: MixingEngine,
    effectIds: readonly string[],
    kind: 'required' | 'forbidden'
): ReadonlySet<string> {
    const result = new Set<string>();
    for (const effectId of effectIds) {
        if (result.has(effectId)) {
            throw new Error(`Duplicate ${kind} mixing effect ${JSON.stringify(effectId)}`);
        }
        if (!engine.effectsById.has(effectId)) {
            throw new Error(`Unknown ${kind} mixing effect ${JSON.stringify(effectId)}`);
        }
        result.add(effectId);
    }
    return result;
}
