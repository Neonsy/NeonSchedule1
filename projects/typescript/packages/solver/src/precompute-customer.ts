import {
    CustomerRecommendationRanker,
    type CustomerCatalog,
    type CustomerRecommendation,
    type CustomerRecommendationInput,
    type MixingRuleProfile,
    type RecipeEvaluation,
} from '@neonschedule1/core';

import {
    RecipeCorpusLookup,
    type RecipeCorpusFilter,
} from '#solver/precompute-query';
import type { RecipeCorpusEntry } from '#solver/precompute';

export interface CustomerCorpusRecommendationQuery
    extends Omit<CustomerRecommendationInput, 'candidates'>,
        RecipeCorpusFilter {}

export interface CustomerCorpusRecommendationResult {
    readonly recommendations: readonly CustomerRecommendation[];
    readonly evidence: {
        readonly source: 'precomputed';
        readonly proofStatus: 'exact';
        readonly corpusArtifactSha256: string;
        readonly indexArtifactSha256: string;
        readonly coverageKey: string;
        readonly ruleProfile: MixingRuleProfile;
        readonly evaluatedCandidateCount: number;
    };
}

export class CustomerCorpusRecommendationLookup {
    readonly #corpus: RecipeCorpusLookup;
    readonly #ranker: CustomerRecommendationRanker;

    constructor(
        corpus: RecipeCorpusLookup,
        catalog: Pick<CustomerCatalog, 'constants' | 'qualityTiers'>
    ) {
        this.#corpus = corpus;
        this.#ranker = new CustomerRecommendationRanker(catalog);
    }

    async recommend(
        input: CustomerCorpusRecommendationQuery
    ): Promise<CustomerCorpusRecommendationResult> {
        requirePositiveSafeInteger(input.quantity, 'Customer recommendation quantity');
        requireNonNegativeFinite(
            input.maximumProductionCost,
            'Customer recommendation production-cost ceiling'
        );
        const selection = await this.#corpus.select({
            ...(input.productIds === undefined ? {} : { productIds: input.productIds }),
            ...(input.requiredEffectIds === undefined
                ? {}
                : { requiredEffectIds: input.requiredEffectIds }),
            ...(input.forbiddenEffectIds === undefined
                ? {}
                : { forbiddenEffectIds: input.forbiddenEffectIds }),
            ...(input.requiredIngredientIds === undefined
                ? {}
                : { requiredIngredientIds: input.requiredIngredientIds }),
            ...(input.forbiddenIngredientIds === undefined
                ? {}
                : { forbiddenIngredientIds: input.forbiddenIngredientIds }),
            ...(input.minimumIngredientCount === undefined
                ? {}
                : { minimumIngredientCount: input.minimumIngredientCount }),
            ...(input.exactIngredientCount === undefined
                ? {}
                : { exactIngredientCount: input.exactIngredientCount }),
            maximumTotalCost: conservativeUnitCostCeiling(
                input.maximumProductionCost,
                input.quantity
            ),
        });
        const recommendations = this.#ranker.rank({
            candidates: candidates(selection.recipes, selection.evidence.ruleProfile),
            profile: input.profile,
            state: input.state,
            quality: input.quality,
            quantity: input.quantity,
            priceMultiplier: input.priceMultiplier,
            maximumProductionCost: input.maximumProductionCost,
            limit: input.limit,
        });
        return {
            recommendations,
            evidence: {
                source: selection.evidence.source,
                proofStatus: selection.evidence.proofStatus,
                corpusArtifactSha256: selection.evidence.corpusArtifactSha256,
                indexArtifactSha256: selection.evidence.indexArtifactSha256,
                coverageKey: selection.evidence.coverageKey,
                ruleProfile: selection.evidence.ruleProfile,
                evaluatedCandidateCount: selection.evidence.candidateCount,
            },
        };
    }
}

function* candidates(
    entries: readonly RecipeCorpusEntry[],
    ruleProfile: MixingRuleProfile
): Generator<{
    readonly recipe: RecipeEvaluation;
    readonly drugTypes: readonly string[];
}> {
    for (const entry of entries) {
        yield {
            recipe: {
                ruleProfile,
                productId: entry.productId,
                ingredientIds: entry.ingredientIds,
                effectIds: entry.effectIds,
                productValue: entry.productValue,
                baseProductCost: entry.costs.baseProduct,
                baseProductCostBasis: entry.costs.baseProductBasis,
                ingredientCost: entry.costs.ingredients,
                totalCost: entry.costs.total,
                netValue: entry.netValue,
                ingredientCount: entry.depth,
            },
            drugTypes: [entry.drugType],
        };
    }
}

function conservativeUnitCostCeiling(maximumProductionCost: number, quantity: number): number {
    const quotient = maximumProductionCost / quantity;
    const margin = Math.max(Number.EPSILON, Math.abs(quotient) * Number.EPSILON);
    return Math.min(Number.MAX_VALUE, quotient + margin);
}

function requirePositiveSafeInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive safe integer`);
    }
}

function requireNonNegativeFinite(value: number, name: string): void {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be non-negative`);
}
