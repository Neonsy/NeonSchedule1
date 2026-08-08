import type {
    Customer,
    CustomerCatalog,
    CustomerQuality,
} from '#core/data/customer';
import {
    CustomerEnjoymentEvaluator,
    type CustomerEnjoymentProduct,
    type CustomerEnjoymentProfile,
} from '#core/customer/enjoyment';
import {
    CustomerDemandEvaluator,
    type CustomerDemandState,
} from '#core/customer/demand';

export type CustomerOfferProfile = CustomerEnjoymentProfile &
    Pick<Customer, 'weeklySpend' | 'weeklyOrders'>;

export interface CustomerOfferProduct extends CustomerEnjoymentProduct {
    readonly marketValue: number;
}

export type CustomerOfferState = CustomerDemandState;

export interface CustomerOfferTerms {
    readonly quality: CustomerQuality;
    readonly quantity: number;
    readonly askingPrice: number;
}

const float = Math.fround;

export class CustomerOfferEvaluator {
    readonly #enjoyment: CustomerEnjoymentEvaluator;
    readonly #demand: CustomerDemandEvaluator;

    constructor(catalog: Pick<CustomerCatalog, 'constants' | 'qualityTiers'>) {
        this.#enjoyment = new CustomerEnjoymentEvaluator(catalog);
        this.#demand = new CustomerDemandEvaluator(catalog);
    }

    evaluate(
        profile: CustomerOfferProfile,
        product: CustomerOfferProduct,
        state: CustomerOfferState,
        terms: CustomerOfferTerms
    ): number {
        this.#validate(profile, product, state, terms);

        const demand = this.#demand.evaluate(profile, state);
        const budgetRatio = float(float(terms.askingPrice) / demand.budgetPerOrder);

        const enjoyment = this.#enjoyment.evaluateAtQuality(profile, product, terms.quality);
        const enjoymentScore = weightedAverage(
            inverseLerpNegativeOneToOne(enjoyment),
            terms.quantity
        );
        const preference = float(enjoymentScore + float(float(state.addiction) * float(0.25)));

        const unitPrice = float(float(terms.askingPrice) / terms.quantity);
        const proposition = weightedAverage(
            valueProposition(float(product.marketValue), unitPrice),
            terms.quantity
        );
        const value = float(Math.pow(proposition, 1.5));

        let affordability = float(1);
        if (budgetRatio > 1) {
            affordability = clamp(float(1 - float(float(Math.sqrt(budgetRatio)) / float(4))), 0.01, 1);
        }

        const factors = [preference, value, affordability].sort((left, right) => left - right);
        if (factors[0]! < 0.01 || budgetRatio > 3) return 0;

        const weakest = float(factors[0]! * float(0.7));
        const middle = float(factors[1]! * float(0.2));
        const strongest = float(factors[2]! * float(0.1));
        return float(float(weakest + middle) + strongest);
    }

    #validate(
        profile: CustomerOfferProfile,
        product: CustomerOfferProduct,
        state: CustomerOfferState,
        terms: CustomerOfferTerms
    ): void {
        if (!Number.isInteger(terms.quantity) || terms.quantity <= 0) {
            throw new Error('Customer offer quantity must be a positive integer');
        }
        if (!Number.isFinite(terms.askingPrice) || terms.askingPrice < 0) {
            throw new Error('Customer offer price must be a non-negative finite number');
        }
        if (!Number.isFinite(product.marketValue) || product.marketValue < 0) {
            throw new Error('Customer offer product market value must be non-negative');
        }
    }
}

function valueProposition(marketValue: number, unitPrice: number): number {
    let proposition = float(marketValue / unitPrice);
    if (proposition < 1) proposition = float(Math.pow(proposition, 2.5));
    return clamp(proposition, 0, 2);
}

function inverseLerpNegativeOneToOne(value: number): number {
    return clamp(float(float(value + 1) / float(2)), 0, 1);
}

function weightedAverage(value: number, quantity: number): number {
    return float(float(value * float(quantity)) / float(quantity));
}

function clamp(value: number, minimum: number, maximum: number): number {
    if (value < minimum) return minimum;
    if (value > maximum) return maximum;
    return value;
}
