import type {
    Customer,
    CustomerCatalog,
    CustomerDrugType,
    CustomerQuality,
    CustomerStandards,
} from '#core/data/customer';

export interface CustomerEnjoymentProduct {
    readonly drugTypes: readonly CustomerDrugType[];
    readonly effectIds: readonly string[];
}

export type CustomerEnjoymentProfile = Pick<
    Customer,
    'standards' | 'preferredEffectIds' | 'drugAffinities'
>;

const qualityForStandard = {
    VeryLow: 'Trash',
    Low: 'Poor',
    Moderate: 'Standard',
    High: 'Premium',
    VeryHigh: 'Heavenly',
} as const satisfies Record<CustomerStandards, CustomerQuality>;

const float = Math.fround;
const neutralContribution = float(0.6);
const minimumContribution = float(-0.6);

export class CustomerEnjoymentEvaluator {
    readonly #affinityWeight: number;
    readonly #propertyWeight: number;
    readonly #qualityWeight: number;
    readonly #baseDivisor: number;
    readonly #qualityDivisor: number;
    readonly #qualityScalars: ReadonlyMap<CustomerQuality, number>;

    constructor(catalog: Pick<CustomerCatalog, 'constants' | 'qualityTiers'>) {
        this.#affinityWeight = float(catalog.constants.affinityMaxEffect);
        this.#propertyWeight = float(catalog.constants.propertyMaxEffect);
        this.#qualityWeight = float(catalog.constants.qualityMaxEffect);
        this.#baseDivisor = float(
            neutralContribution + this.#affinityWeight + this.#propertyWeight
        );
        this.#qualityDivisor = float(
            neutralContribution +
                this.#affinityWeight +
                this.#propertyWeight +
                this.#qualityWeight
        );

        const qualityScalars = new Map<CustomerQuality, number>();
        for (const tier of catalog.qualityTiers) {
            if (qualityScalars.has(tier.name)) {
                throw new Error(`Duplicate customer quality tier ${JSON.stringify(tier.name)}`);
            }
            qualityScalars.set(tier.name, float(tier.scalar));
        }
        this.#qualityScalars = qualityScalars;
    }

    evaluate(profile: CustomerEnjoymentProfile, product: CustomerEnjoymentProduct): number {
        return clamp01(
            float(
                float(this.#productContribution(profile, product) - minimumContribution) /
                    this.#baseDivisor
            )
        );
    }

    evaluateAtQuality(
        profile: CustomerEnjoymentProfile,
        product: CustomerEnjoymentProduct,
        quality: CustomerQuality
    ): number {
        const offeredScalar = this.#qualityScalar(quality);
        const expectedScalar = this.#qualityScalar(qualityForStandard[profile.standards]);
        const difference = float(offeredScalar - expectedScalar);
        const qualityScore =
            difference >= 0.25 ? 1 : difference >= 0 ? 0.5 : difference >= -0.25 ? -0.5 : -1;
        const contribution = float(qualityScore * this.#qualityWeight);
        const productContribution = this.#productContribution(profile, product);
        const numerator = float(float(productContribution + contribution) - minimumContribution);
        return clamp01(float(numerator / this.#qualityDivisor));
    }

    #productContribution(
        profile: CustomerEnjoymentProfile,
        product: CustomerEnjoymentProduct
    ): number {
        let contribution = float(0);
        for (const drugType of product.drugTypes) {
            const affinity = profile.drugAffinities.find(
                (candidate) => candidate.drugType === drugType
            )?.affinity;
            contribution = float(
                contribution + float(float(affinity ?? 0) * this.#affinityWeight)
            );
        }

        if (profile.preferredEffectIds.length === 0) return contribution;
        const productEffects = new Set(product.effectIds);
        const increment = float(1 / profile.preferredEffectIds.length);
        let preferredEffectShare = float(0);
        for (const effectId of profile.preferredEffectIds) {
            if (productEffects.has(effectId)) {
                preferredEffectShare = float(preferredEffectShare + increment);
            }
        }
        return float(contribution + float(preferredEffectShare * this.#propertyWeight));
    }

    #qualityScalar(quality: CustomerQuality): number {
        const scalar = this.#qualityScalars.get(quality);
        if (scalar === undefined) {
            throw new Error(`Missing customer quality tier ${JSON.stringify(quality)}`);
        }
        return scalar;
    }
}

function clamp01(value: number): number {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}
