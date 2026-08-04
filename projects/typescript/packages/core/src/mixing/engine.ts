import type { Effect } from '#core/data/effect';
import type { MixingMap, MixingMapEffect, MixingRules } from '#core/data/mixing';

interface IndexedMap {
    readonly replacementsByOrigin: ReadonlyMap<string, ReadonlyMap<string, string | null>>;
}

export class MixingEngine {
    readonly rules: MixingRules;
    readonly effectsById: ReadonlyMap<string, Effect>;

    readonly #mapsByDrugType: ReadonlyMap<string, IndexedMap>;

    constructor(rules: MixingRules, effectsById: ReadonlyMap<string, Effect>) {
        const indexedEffects = new Map(effectsById);
        const unsupported = [...indexedEffects.values()].find(
            (effect) => effect.value.change !== 0 || effect.value.multiplier !== 1
        );
        if (unsupported !== undefined) {
            throw new Error(
                `Effect ${JSON.stringify(unsupported.id)} requires an unverified product value operation`
            );
        }
        this.rules = rules;
        this.effectsById = indexedEffects;
        this.#mapsByDrugType = new Map(
            rules.maps.map((map) => [map.drugType, indexMixingMap(map, indexedEffects)])
        );
        if (this.#mapsByDrugType.size !== rules.maps.length) {
            throw new Error('Mixing rules contain duplicate drug types');
        }
    }

    mixEffectIds(drugType: string, currentEffectIds: readonly string[], addedEffectId: string): string[] {
        const map = this.#mapsByDrugType.get(drugType);
        if (map === undefined) throw new Error(`Unknown mixing drug type ${JSON.stringify(drugType)}`);
        const addedEffect = this.#effect(addedEffectId);
        const result = [...currentEffectIds];

        for (let index = 0; index < result.length; index++) {
            const currentId = result[index];
            if (currentId === undefined) continue;
            const replacements = map.replacementsByOrigin.get(currentId);
            if (replacements === undefined) {
                throw new Error(`Effect ${JSON.stringify(currentId)} is absent from the ${drugType} mixing map`);
            }
            const replacementId = replacements.get(addedEffect.id);
            if (replacementId === undefined) {
                throw new Error(`Effect ${JSON.stringify(addedEffect.id)} has no indexed mixing transition`);
            }
            if (replacementId !== null && !result.includes(replacementId)) {
                result[index] = replacementId;
            }
        }

        if (!result.includes(addedEffectId) && result.length < this.rules.maxProperties) {
            result.push(addedEffectId);
        }
        return result;
    }

    calculateProductValue(baseValue: number, effectIds: readonly string[]): number {
        let value = Math.fround(baseValue);
        for (const effectId of effectIds) {
            const effect = this.#effect(effectId);
            const addition = Math.fround(
                Math.fround(baseValue) * Math.fround(effect.value.addBaseValueMultiple)
            );
            value = Math.fround(value + addition);
        }
        return roundToEven(value);
    }

    #effect(id: string): Effect {
        const effect = this.effectsById.get(id);
        if (effect === undefined) throw new Error(`Unknown mixing effect ${JSON.stringify(id)}`);
        return effect;
    }
}

function indexMixingMap(source: MixingMap, effectsById: ReadonlyMap<string, Effect>): IndexedMap {
    uniqueIndex(source.effects, 'effectId', `mixing map ${source.drugType}`);
    const replacementsByOrigin = new Map<string, ReadonlyMap<string, string | null>>();
    for (const origin of source.effects) {
        const replacements = new Map<string, string | null>();
        for (const addedEffect of effectsById.values()) {
            const targetX =
                origin.position.x + addedEffect.mixing.direction.x * addedEffect.mixing.magnitude;
            const targetY =
                origin.position.y + addedEffect.mixing.direction.y * addedEffect.mixing.magnitude;
            replacements.set(
                addedEffect.id,
                closestEffect(source.effects, targetX, targetY)?.effectId ?? null
            );
        }
        replacementsByOrigin.set(origin.effectId, replacements);
    }
    return { replacementsByOrigin };
}

function closestEffect(entries: readonly MixingMapEffect[], x: number, y: number): MixingMapEffect | null {
    let closest: MixingMapEffect | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const entry of entries) {
        const distance = Math.hypot(x - entry.position.x, y - entry.position.y);
        if (distance <= entry.radius && distance < closestDistance) {
            closest = entry;
            closestDistance = distance;
        }
    }
    return closest;
}

function uniqueIndex<T extends Record<K, string>, K extends keyof T>(
    records: readonly T[],
    key: K,
    label: string
): ReadonlyMap<string, T> {
    const result = new Map<string, T>();
    for (const record of records) {
        const id = record[key];
        if (result.has(id)) throw new Error(`${label} contains duplicate id ${JSON.stringify(id)}`);
        result.set(id, record);
    }
    return result;
}

function roundToEven(value: number): number {
    const lower = Math.floor(value);
    if (value - lower !== 0.5) return Math.round(value);
    return lower % 2 === 0 ? lower : lower + 1;
}
