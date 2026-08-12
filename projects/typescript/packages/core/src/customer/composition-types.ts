import type { Customer, CustomerQuality } from '#core/data/customer';
import type {
    CustomerRecommendation,
    CustomerRecommendationCandidate,
} from '#core/customer/recommendation';
import type { RecipeEvaluation } from '#core/mixing/recipe';
import type { FinishedRecipeProductionEvidence } from '#core/production/finished-recipe';
import type { ProductionPlanDataset } from '#core/production/plan';
import type {
    CustomerEligibilityDecision,
    PersonEligibilityStatus,
} from '#core/relationship/eligibility';

export interface CustomerFinishedInventoryEntry {
    readonly recipe: RecipeEvaluation;
    readonly quality: CustomerQuality;
    readonly quantity: number;
}

export interface CustomerRecommendationProductionPlan {
    /** The caller asserts that this plan produces the requested quality. */
    readonly quality: CustomerQuality;
    readonly plan: {
        readonly dataset: ProductionPlanDataset;
        readonly recipe: RecipeEvaluation;
        readonly finishedQuantity: number;
        readonly duration: {
            readonly modeledTotalProcessMinutes: number | null;
        };
        readonly cost: {
            readonly requiredMaterialCost: number;
            readonly combinedReorderCost: number | null;
        };
        readonly evidence: Pick<
            FinishedRecipeProductionEvidence,
            'modeledDurationProof' | 'finishedLifecycleProof' | 'missingFacts'
        >;
    };
}

export interface CustomerRecommendationCompositionInput {
    readonly dataset: ProductionPlanDataset;
    readonly customer: Customer;
    readonly eligibility: CustomerEligibilityDecision;
    readonly addiction?: number;
    readonly orderLimitMultiplier?: number;
    readonly candidates: Iterable<CustomerRecommendationCandidate>;
    /** A supplied list is complete for the candidates. An omitted recipe has zero finished stock. */
    readonly finishedInventory?: readonly CustomerFinishedInventoryEntry[];
    /** A supplied list is complete for producible shortfalls. An omitted recipe is not producible. */
    readonly productionPlans?: readonly CustomerRecommendationProductionPlan[];
    readonly quality: CustomerQuality;
    readonly quantity: number;
    readonly priceMultiplier: number;
    readonly maximumProductionCost: number;
    /** Optional ceiling over modeled process minutes for the exact finished shortfall. */
    readonly maximumProductionMinutes?: number;
    readonly limit: number;
}

export type CustomerRecommendationProductionMissingFact =
    | FinishedRecipeProductionEvidence['missingFacts'][number]
    | 'complete-duration-proof'
    | 'modeled-process-minutes'
    | 'combined-reorder-cost';

export type CustomerRecommendationCompositionReason =
    | { readonly code: 'customer-ineligible' }
    | { readonly code: 'customer-eligibility-unknown' }
    | { readonly code: 'missing-current-addiction' }
    | { readonly code: 'missing-order-limit-multiplier' }
    | { readonly code: 'missing-finished-inventory' }
    | { readonly code: 'missing-production-plans' }
    | { readonly code: 'production-not-supported' }
    | {
        readonly code: 'incomplete-production-plan';
        readonly missingFacts: readonly CustomerRecommendationProductionMissingFact[];
    }
    | {
        readonly code: 'production-cost-limit';
        readonly productionCost: number;
        readonly maximumProductionCost: number;
    }
    | {
        readonly code: 'production-time-limit';
        readonly productionMinutes: number;
        readonly maximumProductionMinutes: number;
    };

export interface CustomerRecommendationProductionEvidence {
    readonly requiredMaterialCost: number;
    readonly additionalReorderCost: number;
    readonly modeledProcessMinutes: number;
    readonly modeledDurationProof: 'complete';
    readonly finishedLifecycleProof: FinishedRecipeProductionEvidence['finishedLifecycleProof'];
}

export interface CustomerRecommendationFulfillment {
    readonly source:
        | 'finished-inventory'
        | 'finished-inventory-and-production'
        | 'production';
    readonly finishedInventoryQuantity: number;
    readonly finishedInventoryQuantityUsed: number;
    readonly finishedInventoryEstimatedMaterialCost: number;
    readonly productionQuantity: number;
    readonly production: CustomerRecommendationProductionEvidence | null;
}

export interface ComposedCustomerRecommendation {
    readonly recommendation: CustomerRecommendation;
    readonly fulfillment: CustomerRecommendationFulfillment;
}

interface CustomerRecommendationCandidateDecisionBase {
    readonly recipe: RecipeEvaluation;
    readonly quality: CustomerQuality;
}

export type CustomerRecommendationCandidateDecision =
    | CustomerRecommendationCandidateDecisionBase & {
        readonly status: 'available';
        readonly reasons: readonly [];
        readonly composed: ComposedCustomerRecommendation;
    }
    | CustomerRecommendationCandidateDecisionBase & {
        readonly status: 'unavailable' | 'unknown';
        readonly reasons: readonly CustomerRecommendationCompositionReason[];
        readonly composed: null;
    };

export interface CustomerRecommendationCompositionEvidence {
    readonly dataset: ProductionPlanDataset;
    readonly status: 'resolved' | 'partial' | 'ineligible' | 'unknown';
    readonly eligibilityStatus: PersonEligibilityStatus;
    readonly missingFacts: readonly (
        | 'current-addiction'
        | 'order-limit-multiplier'
        | 'finished-inventory'
    )[];
    readonly candidateCount: number;
    readonly availableCandidateCount: number;
    readonly unavailableCandidateCount: number;
    readonly unknownCandidateCount: number;
}

export interface CustomerRecommendationCompositionResult {
    readonly customerId: string;
    readonly eligibility: CustomerEligibilityDecision;
    readonly recommendations: readonly ComposedCustomerRecommendation[];
    readonly candidates: readonly CustomerRecommendationCandidateDecision[];
    readonly evidence: CustomerRecommendationCompositionEvidence;
}
