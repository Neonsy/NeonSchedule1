import type {
    CustomerCatalog,
    CustomerDrugType,
    CustomerQuality,
} from '#core/data/customer';
import {
    CustomerOfferEvaluator,
    type CustomerOfferProfile,
    type CustomerOfferState,
} from '#core/customer/offer';
import type { RecipeEvaluation } from '#core/mixing/recipe';

export interface CustomerRecommendationCandidate {
    readonly recipe: RecipeEvaluation;
    readonly drugTypes: readonly CustomerDrugType[];
}

export interface CustomerRecommendationInput {
    readonly candidates: Iterable<CustomerRecommendationCandidate>;
    readonly profile: CustomerOfferProfile;
    readonly state: CustomerOfferState;
    readonly quality: CustomerQuality;
    readonly quantity: number;
    readonly priceMultiplier: number;
    readonly maximumProductionCost: number;
    readonly limit: number;
}

export interface CustomerRecommendation extends CustomerRecommendationCandidate {
    readonly quality: CustomerQuality;
    readonly quantity: number;
    readonly askingPrice: number;
    readonly productionCost: number;
    readonly grossProfit: number;
    readonly acceptanceChance: number;
    readonly expectedRevenue: number;
    readonly expectedProfit: number;
}

interface RankedRecommendation {
    readonly recommendation: CustomerRecommendation;
    readonly ordinal: number;
}

export class CustomerRecommendationRanker {
    readonly #offers: CustomerOfferEvaluator;
    readonly #maximumQuantity: number;

    constructor(catalog: Pick<CustomerCatalog, 'constants' | 'qualityTiers'>) {
        this.#offers = new CustomerOfferEvaluator(catalog);
        this.#maximumQuantity = catalog.constants.maximumOrderQuantityPerProduct;
        requirePositiveSafeInteger(this.#maximumQuantity, 'maximum customer order quantity');
    }

    rank(input: CustomerRecommendationInput): CustomerRecommendation[] {
        requirePositiveSafeInteger(input.quantity, 'Customer recommendation quantity');
        if (input.quantity > this.#maximumQuantity) {
            throw new Error(
                `Customer recommendation quantity cannot exceed ${this.#maximumQuantity}`
            );
        }
        requireNonNegativeFinite(input.priceMultiplier, 'Customer recommendation price multiplier');
        requireNonNegativeFinite(
            input.maximumProductionCost,
            'Customer recommendation production-cost ceiling'
        );
        requirePositiveSafeInteger(input.limit, 'Customer recommendation limit');

        const recommendations: RankedRecommendation[] = [];
        let ordinal = 0;
        for (const candidate of input.candidates) {
            const candidateOrdinal = ordinal++;
            const { recipe } = candidate;
            requirePositiveFinite(recipe.productValue, 'Recipe product value');
            requireNonNegativeFinite(recipe.totalCost, 'Recipe total cost');

            const productionCost = recipe.totalCost * input.quantity;
            if (!Number.isFinite(productionCost)) {
                throw new Error('Customer recommendation production cost must be finite');
            }
            if (productionCost > input.maximumProductionCost) continue;

            const askingPrice = customerMarketRelativePrice(
                recipe.productValue,
                input.quantity,
                input.priceMultiplier
            );
            const acceptanceChance = this.#offers.evaluate(
                input.profile,
                {
                    drugTypes: candidate.drugTypes,
                    effectIds: recipe.effectIds,
                    marketValue: recipe.productValue,
                },
                input.state,
                {
                    quality: input.quality,
                    quantity: input.quantity,
                    askingPrice,
                }
            );
            const grossProfit = askingPrice - productionCost;
            retainBest(recommendations, {
                ...candidate,
                quality: input.quality,
                quantity: input.quantity,
                askingPrice,
                productionCost,
                grossProfit,
                acceptanceChance,
                expectedRevenue: acceptanceChance * askingPrice,
                expectedProfit: acceptanceChance * grossProfit,
            }, candidateOrdinal, input.limit);
        }

        return recommendations
            .sort(compareRankedRecommendations)
            .map(({ recommendation }) => recommendation);
    }
}

function retainBest(
    heap: RankedRecommendation[],
    recommendation: CustomerRecommendation,
    ordinal: number,
    limit: number
): void {
    const ranked = { recommendation, ordinal };
    if (heap.length < limit) {
        heap.push(ranked);
        siftUp(heap, heap.length - 1);
        return;
    }
    if (compareRankedRecommendations(ranked, heap[0]!) >= 0) return;
    heap[0] = ranked;
    siftDown(heap, 0);
}

function siftUp(heap: RankedRecommendation[], start: number): void {
    let index = start;
    while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (compareRankedRecommendations(heap[index]!, heap[parent]!) <= 0) return;
        [heap[index], heap[parent]] = [heap[parent]!, heap[index]!];
        index = parent;
    }
}

function siftDown(heap: RankedRecommendation[], start: number): void {
    let index = start;
    while (true) {
        const left = index * 2 + 1;
        if (left >= heap.length) return;
        const right = left + 1;
        const worse = right < heap.length &&
            compareRankedRecommendations(heap[right]!, heap[left]!) > 0
            ? right
            : left;
        if (compareRankedRecommendations(heap[worse]!, heap[index]!) <= 0) return;
        [heap[index], heap[worse]] = [heap[worse]!, heap[index]!];
        index = worse;
    }
}

function compareRankedRecommendations(
    left: RankedRecommendation,
    right: RankedRecommendation
): number {
    return compareRecommendations(left.recommendation, right.recommendation) ||
        left.ordinal - right.ordinal;
}

export function customerMarketRelativePrice(
    productValue: number,
    quantity: number,
    priceMultiplier: number
): number {
    const marketPrice = Math.fround(Math.fround(productValue) * Math.fround(quantity));
    return Math.fround(marketPrice * Math.fround(priceMultiplier));
}

function compareRecommendations(
    left: CustomerRecommendation,
    right: CustomerRecommendation
): number {
    return (
        right.expectedProfit - left.expectedProfit ||
        right.acceptanceChance - left.acceptanceChance ||
        right.grossProfit - left.grossProfit ||
        left.productionCost - right.productionCost ||
        compareString(left.recipe.productId, right.recipe.productId) ||
        compareStrings(left.recipe.ingredientIds, right.recipe.ingredientIds) ||
        compareStrings(left.recipe.effectIds, right.recipe.effectIds)
    );
}

function compareStrings(left: readonly string[], right: readonly string[]): number {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
        const comparison = compareString(left[index]!, right[index]!);
        if (comparison !== 0) return comparison;
    }
    return left.length - right.length;
}

function compareString(left: string, right: string): number {
    if (left === right) return 0;
    return left < right ? -1 : 1;
}

function requirePositiveFinite(value: number, name: string): void {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
}

function requireNonNegativeFinite(value: number, name: string): void {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be non-negative`);
}

function requirePositiveSafeInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive safe integer`);
    }
}
