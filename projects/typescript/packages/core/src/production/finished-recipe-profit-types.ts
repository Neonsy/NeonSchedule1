import type { ProductionPlanDataset } from '#core/production/plan';
import type {
    FinishedRecipeElapsedLifecycleInput,
    FinishedRecipeElapsedLifecycleResult,
} from '#core/production/finished-recipe-lifecycle-types';

export type FinishedRecipeRealizedCostCategory =
    | 'materials'
    | 'equipment'
    | 'labor'
    | 'transport'
    | 'sale-fees'
    | 'other';

interface FinishedRecipeRealizedCostTreatmentBase {
    readonly category: FinishedRecipeRealizedCostCategory;
}

export type FinishedRecipeRealizedCostTreatment =
    | FinishedRecipeRealizedCostTreatmentBase & {
        readonly treatment: 'included';
        readonly amount: number;
    }
    | FinishedRecipeRealizedCostTreatmentBase & {
        readonly treatment: 'not-incurred';
        readonly amount: 0;
    };

export interface FinishedRecipeRealizedRevenueEvidence {
    readonly dataset: ProductionPlanDataset;
    readonly quantity: number;
    readonly coverage: 'complete' | 'partial';
    readonly recordedRevenue: number;
    readonly evidence: 'caller-supplied-realized-sale-revenue';
}

export interface FinishedRecipeRealizedCostEvidence {
    readonly dataset: ProductionPlanDataset;
    readonly quantity: number;
    readonly coverage: 'complete' | 'partial';
    readonly accountingBasis: 'caller-supplied-costs-attributed-to-sold-output';
    readonly treatments: readonly FinishedRecipeRealizedCostTreatment[];
}

export interface FinishedRecipeRealizedProfitInput {
    readonly lifecycleInput: FinishedRecipeElapsedLifecycleInput;
    readonly lifecycleResult: FinishedRecipeElapsedLifecycleResult;
    readonly revenue: FinishedRecipeRealizedRevenueEvidence;
    readonly costs: FinishedRecipeRealizedCostEvidence;
}

export interface FinishedRecipeRealizedCostSummary {
    readonly evidence: FinishedRecipeRealizedCostEvidence;
    readonly knownTotalCost: number;
    readonly missingCategories: readonly FinishedRecipeRealizedCostCategory[];
}

export interface FinishedRecipeRealizedProfitEconomics {
    readonly realizedRevenue: number;
    readonly attributedCost: number;
    readonly realizedProfit: number;
    readonly elapsedGameMinutes: number;
    readonly profitPerGameMinute: number;
}

export interface FinishedRecipeRealizedProfitGap {
    readonly code:
        | 'elapsed-lifecycle-incomplete'
        | 'realized-revenue-incomplete'
        | 'attributed-cost-coverage-incomplete'
        | 'elapsed-time-not-positive';
}

interface FinishedRecipeRealizedProfitDetails {
    readonly scope: 'realized-sale-profit-over-complete-elapsed-lifecycle';
    readonly accountingBasis: 'caller-supplied-revenue-minus-costs-attributed-to-sold-output';
    readonly lifecycle: FinishedRecipeElapsedLifecycleResult;
    readonly revenue: FinishedRecipeRealizedRevenueEvidence;
    readonly costs: FinishedRecipeRealizedCostSummary;
    readonly economics: FinishedRecipeRealizedProfitEconomics | null;
    readonly gaps: readonly FinishedRecipeRealizedProfitGap[];
}

export type FinishedRecipeRealizedProfitResult =
    FinishedRecipeRealizedProfitDetails & (
        | {
            readonly status: 'complete';
            readonly proof: 'exact';
        }
        | {
            readonly status: 'unavailable';
            readonly proof: 'incomplete';
        }
    );
