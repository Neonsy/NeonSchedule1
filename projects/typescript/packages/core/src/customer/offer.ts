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

export type CustomerOfferProfile = CustomerEnjoymentProfile &
    Pick<Customer, 'weeklySpend' | 'weeklyOrders'>;

export interface CustomerOfferProduct extends CustomerEnjoymentProduct {
    readonly marketValue: number;
}

export interface CustomerOfferState {
    readonly addiction: number;
    readonly relationship: number;
    readonly orderLimitMultiplier: number;
}

export interface CustomerOfferTerms {
    readonly quality: CustomerQuality;
    readonly quantity: number;
    readonly askingPrice: number;
}

const float = Math.fround;

export class CustomerOfferEvaluator {
    readonly #enjoyment: CustomerEnjoymentEvaluator;
    readonly #relationshipMaximum: number;

    constructor(catalog: Pick<CustomerCatalog, 'constants' | 'qualityTiers'>) {
        this.#enjoyment = new CustomerEnjoymentEvaluator(catalog);
        this.#relationshipMaximum = float(catalog.constants.maximumRelationship);
        if (this.#relationshipMaximum <= 0) {
            throw new Error('Customer maximum relationship must be positive');
        }
    }

    evaluate(
        profile: CustomerOfferProfile,
        product: CustomerOfferProduct,
        state: CustomerOfferState,
        terms: CustomerOfferTerms
    ): number {
        this.#validate(profile, product, state, terms);

        const relationship = float(float(state.relationship) / this.#relationshipMaximum);
        const weeklySpend = float(
            float(
                lerp(
                    float(profile.weeklySpend.minimum),
                    float(profile.weeklySpend.maximum),
                    relationship
                )
            ) * float(state.orderLimitMultiplier)
        );
        const orderDays = orderDayCount(profile.weeklyOrders, state.addiction, relationship);
        const dailySpend = float(weeklySpend / orderDays);
        const budgetRatio = float(float(terms.askingPrice) / dailySpend);

        const enjoyment = this.#enjoyment.evaluateAtQuality(profile, product, terms.quality);
        const enjoymentScore = inverseLerpNegativeOneToOne(enjoyment);
        const preference = float(enjoymentScore + float(float(state.addiction) * float(0.25)));

        const unitPrice = float(float(terms.askingPrice) / terms.quantity);
        const proposition = valueProposition(float(product.marketValue), unitPrice);
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
        if (!Number.isFinite(state.addiction) || state.addiction < 0 || state.addiction > 1) {
            throw new Error('Customer addiction must be between zero and one');
        }
        if (!Number.isFinite(state.relationship)) {
            throw new Error('Customer relationship must be finite');
        }
        if (!Number.isFinite(state.orderLimitMultiplier) || state.orderLimitMultiplier <= 0) {
            throw new Error('Customer order limit multiplier must be positive');
        }
        if (
            !Number.isInteger(profile.weeklyOrders.minimum) ||
            !Number.isInteger(profile.weeklyOrders.maximum) ||
            profile.weeklyOrders.minimum < 0 ||
            profile.weeklyOrders.maximum < profile.weeklyOrders.minimum
        ) {
            throw new Error('Customer weekly order range must contain non-negative integers');
        }
        if (
            !Number.isFinite(profile.weeklySpend.minimum) ||
            !Number.isFinite(profile.weeklySpend.maximum) ||
            profile.weeklySpend.minimum <= 0 ||
            profile.weeklySpend.maximum < profile.weeklySpend.minimum
        ) {
            throw new Error('Customer weekly spend range must be positive and ordered');
        }
    }
}

function orderDayCount(
    weeklyOrders: Customer['weeklyOrders'],
    addiction: number,
    relationship: number
): number {
    const demand = Math.max(float(addiction), relationship);
    const intendedOrders = roundToEven(
        lerp(float(weeklyOrders.minimum), float(weeklyOrders.maximum), demand)
    );
    if (intendedOrders === 0) return 7;
    const interval = Math.max(roundToEven(float(float(7) / intendedOrders)), 1);
    return Math.ceil(7 / interval);
}

function valueProposition(marketValue: number, unitPrice: number): number {
    let proposition = float(marketValue / unitPrice);
    if (proposition < 1) proposition = float(Math.pow(proposition, 2.5));
    return clamp(proposition, 0, 2);
}

function inverseLerpNegativeOneToOne(value: number): number {
    return clamp(float(float(value + 1) / float(2)), 0, 1);
}

function lerp(minimum: number, maximum: number, amount: number): number {
    const difference = float(maximum - minimum);
    return float(minimum + float(difference * clamp(amount, 0, 1)));
}

function roundToEven(value: number): number {
    const floor = Math.floor(value);
    const fraction = value - floor;
    if (fraction < 0.5) return floor;
    if (fraction > 0.5) return floor + 1;
    return floor % 2 === 0 ? floor : floor + 1;
}

function clamp(value: number, minimum: number, maximum: number): number {
    if (value < minimum) return minimum;
    if (value > maximum) return maximum;
    return value;
}
