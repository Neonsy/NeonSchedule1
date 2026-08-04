import {
    MixingEngine,
    MixingRulesSchema,
    type Effect,
    type Item,
    type MixingMap,
    type MixingRules,
} from '@neonschedule1/core';

import type { RawReport } from '#data-compiler/acquisition/types';
import { indexUnique, Integrity, requireReferences } from '#data-compiler/integrity';
import {
    nullableStringField,
    numberField,
    objectArray,
    stringArrayField,
    stringField,
    type JsonObject,
} from '#data-compiler/json';

export function normalizeMixing(
    report: RawReport,
    effects: readonly Effect[],
    items: readonly Item[],
    integrity: Integrity
): MixingRules {
    const effectIds = new Set(effects.map((effect) => effect.id));
    const itemIds = new Set(items.map((item) => item.id));
    const rawMapIndex = indexUnique(report.mixing.mixerMaps, 'drugType', 'report.mixing.mixerMaps', integrity);
    const maps = [...rawMapIndex.entries()]
        .map(([drugType, raw]) => normalizeMap(drugType, raw, effectIds, report, integrity))
        .sort((left, right) => left.drugType.localeCompare(right.drugType));

    integrity.check(
        'mixing maps use distinct drug type values',
        new Set(maps.map((map) => map.drugTypeValue)).size === maps.length,
        'Mixing maps contain duplicate drug type values'
    );
    const summaryDrugTypes = Object.keys(report.mixing.mixerMapEffectCounts);
    integrity.check(
        'mixing map summaries match the map set',
        summaryDrugTypes.length === rawMapIndex.size &&
            summaryDrugTypes.every((drugType) => rawMapIndex.has(drugType)),
        'Mixer map effect counts do not match the exported map set'
    );

    requireReferences(report.mixing.defaultProductIds, itemIds, 'default mixing product', integrity);
    integrity.check(
        'mixing ingredient summary count matches the report',
        report.mixing.validIngredientCount === report.mixing.ingredients.length,
        `Expected ${report.mixing.validIngredientCount} mixing ingredients, found ${report.mixing.ingredients.length}`
    );
    integrity.check(
        'mixing effect summary count matches the report',
        report.mixing.effectCount === effects.length,
        `Expected ${report.mixing.effectCount} mixing effects, normalized ${effects.length}`
    );
    integrity.check(
        'mixing limits are positive',
        Number.isInteger(report.mixing.maxProperties) &&
            report.mixing.maxProperties > 0 &&
            report.mixing.maxDeltaDifference > 0,
        'Mixing limits must be positive and maxProperties must be an integer'
    );

    const unsupportedValueEffect = effects.find(
        (effect) => effect.value.change !== 0 || effect.value.multiplier !== 1
    );
    integrity.check(
        'product value calculation uses the oracle-verified additive model',
        unsupportedValueEffect === undefined,
        `Effect ${JSON.stringify(unsupportedValueEffect?.id)} requires an unverified product value operation`
    );

    const rules = MixingRulesSchema.assert({
        schema: 'neonschedule1-mixing-rules-1',
        maxProperties: report.mixing.maxProperties,
        maxDeltaDifference: report.mixing.maxDeltaDifference,
        defaultProductIds: [...report.mixing.defaultProductIds].sort(),
        maps,
    } satisfies MixingRules);
    if (unsupportedValueEffect === undefined) {
        validateOracles(report, rules, effects, items, integrity);
    }
    return rules;
}

function normalizeMap(
    drugType: string,
    raw: JsonObject,
    effectIds: ReadonlySet<string>,
    report: RawReport,
    integrity: Integrity
): MixingMap {
    const path = `report.mixing.mixerMaps[${JSON.stringify(drugType)}]`;
    const rawEffects = objectArray(raw.effects, `${path}.effects`);
    const seenEffectIds = new Set<string>();
    const effects = rawEffects.map((entry, position) => {
        const entryPath = `${path}.effects[${position}]`;
        const index = numberField(entry, 'index', entryPath);
        const effectId = stringField(entry, 'effectId', entryPath);
        if (index !== position) {
            integrity.addError(`${entryPath}.index is ${index}, expected ${position}`);
        }
        if (seenEffectIds.has(effectId)) {
            integrity.addError(`${path}.effects contains duplicate effect ${JSON.stringify(effectId)}`);
        }
        seenEffectIds.add(effectId);
        const radius = numberField(entry, 'radius', entryPath);
        if (radius <= 0) integrity.addError(`${entryPath}.radius must be positive`);
        return {
            effectId,
            position: {
                x: numberField(entry, 'positionX', entryPath),
                y: numberField(entry, 'positionY', entryPath),
            },
            radius,
        };
    });

    requireReferences(seenEffectIds, effectIds, `${drugType} mixing map`, integrity);
    integrity.check(
        `the ${drugType} mixing map contains every effect once`,
        seenEffectIds.size === effectIds.size && [...effectIds].every((id) => seenEffectIds.has(id)),
        `${drugType} mixing map contains ${seenEffectIds.size} of ${effectIds.size} effects`
    );
    const reportedCount = numberField(
        report.mixing.mixerMapEffectCounts,
        drugType,
        'report.mixing.mixerMapEffectCounts'
    );
    integrity.check(
        `the ${drugType} mixing map count matches its summary`,
        reportedCount === rawEffects.length,
        `${drugType} mixing map summary says ${reportedCount}, found ${rawEffects.length}`
    );

    const radius = numberField(raw, 'mapRadius', path);
    if (radius <= 0) integrity.addError(`${path}.mapRadius must be positive`);
    return {
        drugType,
        drugTypeValue: numberField(raw, 'drugTypeValue', path),
        radius,
        effects,
    };
}

function validateOracles(
    report: RawReport,
    rules: MixingRules,
    effects: readonly Effect[],
    items: readonly Item[],
    integrity: Integrity
): void {
    const effectsById = new Map(effects.map((effect) => [effect.id, effect]));
    const effectIds = new Set(effectsById.keys());
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const ingredientIds = new Set(
        items.filter((item) => item.mixingIngredient !== null).map((item) => item.id)
    );
    const mapsByDrugType = new Map(rules.maps.map((map) => [map.drugType, map]));
    let engine: MixingEngine;
    try {
        engine = new MixingEngine(rules, effectsById);
    } catch (error) {
        integrity.addError(
            `Could not index normalized mixing rules: ${error instanceof Error ? error.message : String(error)}`
        );
        return;
    }
    let transitionMismatchCount = 0;
    let valueMismatchCount = 0;
    let firstTransitionMismatch = '';
    let firstValueMismatch = '';

    report.mixing.oracles.forEach((oracle, index) => {
        const path = `report.mixing.oracles[${index}]`;
        const kind = stringField(oracle, 'kind', path);
        const productId = nullableStringField(oracle, 'productId', path);
        const drugType = stringField(oracle, 'drugType', path);
        const drugTypeValue = numberField(oracle, 'drugTypeValue', path);
        const baseValue = numberField(oracle, 'baseValue', path);
        const inputEffectIds = stringArrayField(oracle, 'inputEffectIds', path);
        const oracleIngredientIds = stringArrayField(oracle, 'ingredientIds', path);
        const expectedEffectIds = stringArrayField(oracle, 'resultEffectIds', path);
        const expectedValue = numberField(oracle, 'calculatedValue', path);
        const map = mapsByDrugType.get(drugType);

        requireReferences(inputEffectIds, effectIds, `${path} input effect`, integrity);
        requireReferences(expectedEffectIds, effectIds, `${path} result effect`, integrity);
        requireReferences(oracleIngredientIds, ingredientIds, `${path} ingredient`, integrity);
        if (map === undefined) {
            integrity.addError(`${path} references missing mixing map ${JSON.stringify(drugType)}`);
            return;
        }
        if (map.drugTypeValue !== drugTypeValue) {
            integrity.addError(`${path}.drugTypeValue differs from the ${drugType} mixing map`);
        }
        validateOracleSource(kind, productId, drugType, baseValue, inputEffectIds, itemsById, path, integrity);
        if (
            inputEffectIds.some((id) => !effectsById.has(id)) ||
            expectedEffectIds.some((id) => !effectsById.has(id)) ||
            oracleIngredientIds.some((id) => !ingredientIds.has(id))
        ) {
            return;
        }

        let actualEffectIds = [...inputEffectIds];
        for (const ingredientId of oracleIngredientIds) {
            const ingredient = itemsById.get(ingredientId)?.mixingIngredient;
            const addedEffectId = ingredient?.effectIds[0];
            if (addedEffectId === undefined) {
                integrity.addError(`${path} ingredient ${JSON.stringify(ingredientId)} has no primary effect`);
                return;
            }
            if (!effectsById.has(addedEffectId)) {
                integrity.addError(
                    `${path} ingredient ${JSON.stringify(ingredientId)} references missing primary effect ${JSON.stringify(addedEffectId)}`
                );
                return;
            }
            actualEffectIds = engine.mixEffectIds(drugType, actualEffectIds, addedEffectId);
        }
        if (!sameStrings(actualEffectIds, expectedEffectIds)) {
            transitionMismatchCount++;
            firstTransitionMismatch ||= `${path} expected [${expectedEffectIds.join(', ')}], produced [${actualEffectIds.join(', ')}]`;
        }
        const actualValue = engine.calculateProductValue(baseValue, actualEffectIds);
        if (actualValue !== expectedValue) {
            valueMismatchCount++;
            firstValueMismatch ||= `${path} expected value ${expectedValue}, produced ${actualValue}`;
        }
    });

    integrity.check(
        'every mixing oracle transition matches the normalized evaluator',
        transitionMismatchCount === 0,
        `${transitionMismatchCount} mixing oracle transitions differ. ${firstTransitionMismatch}`
    );
    integrity.check(
        'every mixing oracle value matches the normalized evaluator',
        valueMismatchCount === 0,
        `${valueMismatchCount} mixing oracle values differ. ${firstValueMismatch}`
    );
}

function validateOracleSource(
    kind: string,
    productId: string | null,
    drugType: string,
    baseValue: number,
    inputEffectIds: readonly string[],
    itemsById: ReadonlyMap<string, Item>,
    path: string,
    integrity: Integrity
): void {
    if (kind === 'single-effect') {
        if (productId !== null) integrity.addError(`${path} single-effect oracle has a product ID`);
        return;
    }
    if (kind !== 'product-sequence') {
        integrity.addError(`${path} has unsupported kind ${JSON.stringify(kind)}`);
        return;
    }
    const product = productId === null ? undefined : itemsById.get(productId)?.product;
    if (product === undefined || product === null) {
        integrity.addError(`${path} references missing product ${JSON.stringify(productId)}`);
        return;
    }
    if (product.drugType !== drugType) integrity.addError(`${path}.drugType differs from its product`);
    if (product.basePrice !== baseValue) integrity.addError(`${path}.baseValue differs from its product`);
    if (!sameStrings(product.effectIds, inputEffectIds)) {
        integrity.addError(`${path}.inputEffectIds differ from its product`);
    }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
