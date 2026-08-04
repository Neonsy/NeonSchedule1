import type { Effect } from '../data/effect.js';
import type { MixingMap, MixingMapEffect, MixingRules } from '../data/mixing.js';

interface IndexedMap {
    readonly source: MixingMap;
    readonly effectsById: ReadonlyMap<string, MixingMapEffect>;
}

export class MixingEngine {
    readonly rules: MixingRules;
    readonly effectsById: ReadonlyMap<string, Effect>;

    readonly #mapsByDrugType: ReadonlyMap<string, IndexedMap>;

    constructor(rules: MixingRules, effectsById: ReadonlyMap<string, Effect>) {
        const unsupported = [...effectsById.values()].find(
            (effect) => effect.value.change !== 0 || effect.value.multiplier !== 1
        );
        if (unsupported !== undefined) {
            throw new Error(
                `Effect ${JSON.stringify(unsupported.id)} requires an unverified product value operation`
            );
        }
        this.rules = rules;
        this.effectsById = effectsById;
        this.#mapsByDrugType = new Map(
            rules.maps.map((map) => [
                map.drugType,
                { source: map, effectsById: uniqueIndex(map.effects, 'effectId', `mixing map ${map.drugType}`) },
            ])
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
            const origin = map.effectsById.get(currentId);
            if (origin === undefined) {
                throw new Error(`Effect ${JSON.stringify(currentId)} is absent from the ${drugType} mixing map`);
            }
            const targetX =
                origin.position.x + addedEffect.mixing.direction.x * addedEffect.mixing.magnitude;
            const targetY =
                origin.position.y + addedEffect.mixing.direction.y * addedEffect.mixing.magnitude;
            const replacement = closestEffect(map.source.effects, targetX, targetY);
            if (replacement !== null && !result.includes(replacement.effectId)) {
                result[index] = replacement.effectId;
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
