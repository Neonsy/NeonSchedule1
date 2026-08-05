import { customerMarketRelativePrice } from '#core/customer/recommendation';
import type { MixingEngine } from '#core/mixing/engine';

const maxValueBoundDepth = 32;

export interface CustomerProfitBoundAction {
    readonly effectId: string;
    readonly cost: number;
}

export interface CustomerProfitBoundProduct {
    readonly drugType: string;
    readonly basePrice: number;
    readonly baseProductCost: number;
}

interface CustomerProfitBoundMetrics {
    transitionEvaluations: number;
    boundTransitionEvaluations: number;
}

export class CustomerProfitBound {
    readonly #engine: MixingEngine;
    readonly #product: CustomerProfitBoundProduct;
    readonly #actions: readonly CustomerProfitBoundAction[];
    readonly #quantity: number;
    readonly #priceMultiplier: number;
    readonly #acceptanceUpper: number;
    readonly #minimumActionCost: number;
    readonly #metrics: CustomerProfitBoundMetrics;
    readonly #bestEffectCache = new Map<string, string>();
    readonly #bestNewEffectCache = new Map<number, string | null>();

    constructor(
        engine: MixingEngine,
        product: CustomerProfitBoundProduct,
        actions: readonly CustomerProfitBoundAction[],
        quantity: number,
        priceMultiplier: number,
        acceptanceUpper: number,
        metrics: CustomerProfitBoundMetrics
    ) {
        this.#engine = engine;
        this.#product = product;
        this.#actions = actions;
        this.#quantity = quantity;
        this.#priceMultiplier = priceMultiplier;
        this.#acceptanceUpper = Math.max(0, acceptanceUpper);
        this.#metrics = metrics;
        this.#minimumActionCost = Math.min(0, ...actions.map((action) => action.cost));
    }

    upperExpectedProfit(
        effectIds: readonly string[],
        ingredientCost: number,
        remainingIngredients: number
    ): number {
        if (this.#product.basePrice < 0 || remainingIngredients > maxValueBoundDepth) {
            return Number.POSITIVE_INFINITY;
        }
        const upperEffectIds = effectIds.map((effectId) =>
            this.#bestEffect(effectId, remainingIngredients)
        );
        const newEffectCount = Math.min(
            remainingIngredients,
            Math.max(0, this.#engine.rules.maxProperties - effectIds.length)
        );
        for (let index = 0; index < newEffectCount; index++) {
            const effectId = this.#bestNewEffect(remainingIngredients - index - 1);
            if (effectId !== null && this.#effectMultiple(effectId) > 0) {
                upperEffectIds.push(effectId);
            }
        }
        const upperValue = this.#engine.calculateProductValue(
            this.#product.basePrice,
            upperEffectIds
        );
        const upperPrice = customerMarketRelativePrice(
            upperValue,
            this.#quantity,
            this.#priceMultiplier
        );
        const lowerUnitCost =
            this.#product.baseProductCost +
            ingredientCost +
            this.#minimumActionCost * remainingIngredients;
        const upperGrossProfit = upperPrice - lowerUnitCost * this.#quantity;
        return this.#acceptanceUpper * Math.max(0, upperGrossProfit);
    }

    #bestEffect(effectId: string, remainingIngredients: number): string {
        const key = `${remainingIngredients}:${effectId}`;
        const cached = this.#bestEffectCache.get(key);
        if (cached !== undefined) return cached;

        let best = effectId;
        if (remainingIngredients > 0) {
            for (const action of this.#actions) {
                this.#metrics.transitionEvaluations++;
                this.#metrics.boundTransitionEvaluations++;
                const transitioned = this.#engine.mixEffectIds(
                    this.#product.drugType,
                    [effectId],
                    action.effectId
                )[0];
                if (transitioned === undefined) continue;
                const candidate = this.#bestEffect(transitioned, remainingIngredients - 1);
                if (this.#compareEffects(candidate, best) < 0) best = candidate;
            }
        }
        this.#bestEffectCache.set(key, best);
        return best;
    }

    #bestNewEffect(remainingIngredients: number): string | null {
        const cached = this.#bestNewEffectCache.get(remainingIngredients);
        if (cached !== undefined) return cached;

        let best: string | null = null;
        for (const action of this.#actions) {
            const candidate = this.#bestEffect(action.effectId, remainingIngredients);
            if (best === null || this.#compareEffects(candidate, best) < 0) best = candidate;
        }
        this.#bestNewEffectCache.set(remainingIngredients, best);
        return best;
    }

    #compareEffects(leftId: string, rightId: string): number {
        if (leftId === rightId) return 0;
        return (
            this.#effectMultiple(rightId) - this.#effectMultiple(leftId) ||
            (leftId < rightId ? -1 : 1)
        );
    }

    #effectMultiple(effectId: string): number {
        const effect = this.#engine.effectsById.get(effectId);
        if (effect === undefined) {
            throw new Error(`Unknown mixing effect ${JSON.stringify(effectId)}`);
        }
        return effect.value.addBaseValueMultiple;
    }
}
