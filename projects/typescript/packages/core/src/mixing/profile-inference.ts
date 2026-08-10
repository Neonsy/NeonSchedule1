import type { Effect } from '#core/data/effect';
import type { Item } from '#core/data/item';
import type {
    MixingRules,
    SeededRotationMixingRuleProfile,
} from '#core/data/mixing';
import { MixingEngine } from '#core/mixing/engine';
import { RecipeEvaluator } from '#core/mixing/recipe';

export const seededMixingProfileCount = 360;

export interface SeededMixingProfileObservation {
    readonly productId: string;
    readonly ingredientIds: readonly string[];
    readonly observedEffectIds: readonly string[];
}

export interface SeededMixingProfileInferenceInput {
    readonly observations: readonly SeededMixingProfileObservation[];
}

export type SeededMixingProfileInferenceStatus =
    | 'identified'
    | 'ambiguous'
    | 'contradictory';

export interface SeededMixingProfileInferenceEvidence {
    readonly proofStatus: 'exact';
    readonly candidateSpace: 'all-seeded-rotation-angles';
    readonly profileCount: typeof seededMixingProfileCount;
    readonly observationCount: number;
    readonly recipeEvaluationCount: number;
    readonly candidateCountsAfterObservation: readonly number[];
}

export interface SeededMixingProfileInferenceResult {
    readonly status: SeededMixingProfileInferenceStatus;
    readonly candidates: readonly SeededRotationMixingRuleProfile[];
    readonly evidence: SeededMixingProfileInferenceEvidence;
}

export class SeededMixingProfileInference {
    readonly #rules: MixingRules;
    readonly #effectsById: ReadonlyMap<string, Effect>;
    readonly #itemsById: ReadonlyMap<string, Item>;

    constructor(
        rules: MixingRules,
        effectsById: ReadonlyMap<string, Effect>,
        itemsById: ReadonlyMap<string, Item>
    ) {
        this.#rules = rules;
        this.#effectsById = new Map(effectsById);
        this.#itemsById = new Map(itemsById);
    }

    infer(input: SeededMixingProfileInferenceInput): SeededMixingProfileInferenceResult {
        const observations = this.#observations(input);
        const candidateCountsAfterObservation = observations.map(() => 0);
        const candidates: SeededRotationMixingRuleProfile[] = [];
        let recipeEvaluationCount = 0;

        for (let angleDegrees = 0; angleDegrees < seededMixingProfileCount; angleDegrees++) {
            const profile = { kind: 'seeded-rotation', angleDegrees } as const;
            const evaluator = new RecipeEvaluator(
                new MixingEngine(this.#rules, this.#effectsById, profile),
                this.#itemsById
            );
            let matchesEveryObservation = true;
            for (let index = 0; index < observations.length; index++) {
                const observation = observations[index]!;
                recipeEvaluationCount++;
                const evaluation = evaluator.evaluate({
                    ruleProfile: profile,
                    productId: observation.productId,
                    ingredientIds: observation.ingredientIds,
                });
                if (!sameStrings(evaluation.effectIds, observation.observedEffectIds)) {
                    matchesEveryObservation = false;
                    break;
                }
                candidateCountsAfterObservation[index] =
                    candidateCountsAfterObservation[index]! + 1;
            }
            if (matchesEveryObservation) candidates.push(profile);
        }

        return {
            status: status(candidates.length),
            candidates,
            evidence: {
                proofStatus: 'exact',
                candidateSpace: 'all-seeded-rotation-angles',
                profileCount: seededMixingProfileCount,
                observationCount: observations.length,
                recipeEvaluationCount,
                candidateCountsAfterObservation,
            },
        };
    }

    #observations(
        input: SeededMixingProfileInferenceInput
    ): readonly SeededMixingProfileObservation[] {
        if (typeof input !== 'object' || input === null) {
            throw new TypeError('Seeded mixing profile inference input must be an object');
        }
        if (!Array.isArray(input.observations) || input.observations.length === 0) {
            throw new TypeError('Seeded mixing profile inference needs at least one observation');
        }
        return input.observations.map((observation, index) => {
            if (typeof observation !== 'object' || observation === null) {
                throw new TypeError(`Mixing observation ${index} must be an object`);
            }
            const productId = id(observation.productId, `observation ${index} productId`);
            const ingredientIds = ids(
                observation.ingredientIds,
                `observation ${index} ingredientIds`
            );
            const observedEffectIds = ids(
                observation.observedEffectIds,
                `observation ${index} observedEffectIds`
            );
            for (const effectId of observedEffectIds) {
                if (!this.#effectsById.has(effectId)) {
                    throw new Error(
                        `Unknown observed mixing effect ${JSON.stringify(effectId)}`
                    );
                }
            }
            return { productId, ingredientIds, observedEffectIds };
        });
    }
}

function status(candidateCount: number): SeededMixingProfileInferenceStatus {
    if (candidateCount === 0) return 'contradictory';
    if (candidateCount === 1) return 'identified';
    return 'ambiguous';
}

function id(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError(`${label} must be a non-blank string`);
    }
    return value;
}

function ids(value: unknown, label: string): string[] {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
    return value.map((entry, index) => id(entry, `${label}[${index}]`));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
