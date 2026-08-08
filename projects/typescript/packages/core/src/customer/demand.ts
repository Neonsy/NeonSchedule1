import type { Customer, CustomerCatalog } from '#core/data/customer';

export type CustomerDemandProfile = Pick<Customer, 'weeklySpend' | 'weeklyOrders'>;

export interface CustomerDemandState {
    readonly addiction: number;
    readonly relationship: number;
    readonly orderLimitMultiplier: number;
}

export interface CustomerDemand {
    readonly normalizedRelationship: number;
    readonly weeklyBudget: number;
    readonly intendedOrdersPerWeek: number;
    readonly orderDaysPerWeek: number;
    readonly budgetPerOrder: number;
}

const float = Math.fround;

export class CustomerDemandEvaluator {
    readonly #relationshipMaximum: number;

    constructor(catalog: Pick<CustomerCatalog, 'constants'>) {
        this.#relationshipMaximum = float(catalog.constants.maximumRelationship);
        if (this.#relationshipMaximum <= 0) {
            throw new Error('Customer maximum relationship must be positive');
        }
    }

    evaluate(profile: CustomerDemandProfile, state: CustomerDemandState): CustomerDemand {
        validate(profile, state);

        const normalizedRelationship = clamp(
            float(float(state.relationship) / this.#relationshipMaximum),
            0,
            1
        );
        const weeklyBudget = float(
            float(
                lerp(
                    float(profile.weeklySpend.minimum),
                    float(profile.weeklySpend.maximum),
                    normalizedRelationship
                )
            ) * float(state.orderLimitMultiplier)
        );
        const demand = Math.max(float(state.addiction), normalizedRelationship);
        const intendedOrdersPerWeek = roundToEven(
            lerp(
                float(profile.weeklyOrders.minimum),
                float(profile.weeklyOrders.maximum),
                demand
            )
        );
        const orderDaysPerWeek = orderDayCount(intendedOrdersPerWeek);

        return {
            normalizedRelationship,
            weeklyBudget,
            intendedOrdersPerWeek,
            orderDaysPerWeek,
            budgetPerOrder: float(weeklyBudget / orderDaysPerWeek),
        };
    }
}

function validate(profile: CustomerDemandProfile, state: CustomerDemandState): void {
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

function orderDayCount(intendedOrdersPerWeek: number): number {
    if (intendedOrdersPerWeek === 0) return 7;
    const interval = Math.max(roundToEven(float(float(7) / intendedOrdersPerWeek)), 1);
    return Math.ceil(7 / interval);
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
