import type { HarvestQuality } from '#core/production/growing';
import type {
    FinishedRecipeRealizedProfitEconomics,
    FinishedRecipeRealizedProfitInput,
} from '#core/production/finished-recipe-profit-types';
import type { ProductionPlanDataset } from '#core/production/plan';

export interface FinishedRecipeGrowAdditiveScenarioInput {
    readonly id: string;
    readonly profit: FinishedRecipeRealizedProfitInput;
}

export interface FinishedRecipeGrowAdditiveComparisonInput {
    readonly baseline: FinishedRecipeGrowAdditiveScenarioInput;
    readonly alternatives: readonly FinishedRecipeGrowAdditiveScenarioInput[];
}

export interface FinishedRecipeGrowAdditiveProductionStepEvidence {
    readonly productionItemId: string;
    readonly growContainerItemId: string;
    readonly growLightItemId: string | null;
    readonly additiveItemIds: readonly string[];
    readonly additives: readonly FinishedRecipeGrowAdditiveSelectionEvidence[];
    readonly outputQuantityPerBatch: number;
    readonly batchCount: number;
    readonly producedQuantity: number;
    readonly leftoverQuantity: number;
    readonly durationMinutesPerBatch: number;
    readonly totalProcessMinutes: number;
    readonly applicationCount: number;
    readonly materialQuantity: number;
    readonly quality: HarvestQuality;
}

export interface FinishedRecipeGrowAdditiveSelectionEvidence {
    readonly additiveItemId: string;
    readonly applicationCount: number;
    readonly materialQuantity: number;
    readonly qualityChange: number;
    readonly yieldMultiplier: number;
    readonly instantGrowth: number;
}

export interface FinishedRecipeGrowAdditiveScenarioEvidence {
    readonly id: string;
    readonly kind: 'no-additive-baseline' | 'grow-additive-selection';
    readonly dataset: ProductionPlanDataset;
    readonly finishedQuantity: number;
    readonly productionSteps: readonly FinishedRecipeGrowAdditiveProductionStepEvidence[];
    readonly economics: FinishedRecipeRealizedProfitEconomics | null;
    readonly proof: 'exact' | 'incomplete';
}

export interface FinishedRecipeGrowAdditiveProductionStepDelta {
    readonly productionItemId: string;
    readonly yieldPerBatch: number;
    readonly batchCount: number;
    readonly producedQuantity: number;
    readonly leftoverQuantity: number;
    readonly durationMinutesPerBatch: number;
    readonly totalProcessMinutes: number;
    readonly applicationCount: number;
    readonly materialQuantity: number;
    readonly qualityLevel: number;
}

export interface FinishedRecipeGrowAdditiveEconomicsDelta {
    readonly elapsedGameMinutes: number;
    readonly attributedCost: number;
    readonly realizedProfit: number;
    readonly profitPerGameMinute: number;
}

export type FinishedRecipeGrowAdditiveAlternativeComparison = {
    readonly scenario: FinishedRecipeGrowAdditiveScenarioEvidence;
    readonly productionStepDeltas: readonly FinishedRecipeGrowAdditiveProductionStepDelta[];
} & (
    | {
        readonly status: 'complete';
        readonly proof: 'exact';
        readonly economicsDelta: FinishedRecipeGrowAdditiveEconomicsDelta;
        readonly gaps: readonly [];
    }
    | {
        readonly status: 'unavailable';
        readonly proof: 'incomplete';
        readonly economicsDelta: null;
        readonly gaps: readonly FinishedRecipeGrowAdditiveComparisonGap[];
    }
);

export interface FinishedRecipeGrowAdditiveRankingEntry {
    readonly rank: number;
    readonly scenarioId: string;
    readonly kind: FinishedRecipeGrowAdditiveScenarioEvidence['kind'];
    readonly realizedProfit: number;
    readonly elapsedGameMinutes: number;
    readonly profitPerGameMinute: number;
}

export interface FinishedRecipeGrowAdditiveComparisonGap {
    readonly scenarioId: string;
    readonly code: 'baseline-economics-incomplete' | 'alternative-economics-incomplete';
}

interface FinishedRecipeGrowAdditiveComparisonDetails {
    readonly objective: 'highest-exact-realized-profit-per-game-minute';
    readonly tieBreak:
        'profit-per-game-minute-then-realized-profit-then-lower-elapsed-minutes-then-canonical-scenario-id';
    readonly baseline: FinishedRecipeGrowAdditiveScenarioEvidence;
    readonly alternatives: readonly FinishedRecipeGrowAdditiveAlternativeComparison[];
    readonly ranking: readonly FinishedRecipeGrowAdditiveRankingEntry[];
    readonly excludedScenarioIds: readonly string[];
    readonly gaps: readonly FinishedRecipeGrowAdditiveComparisonGap[];
}

export type FinishedRecipeGrowAdditiveComparisonResult =
    FinishedRecipeGrowAdditiveComparisonDetails & (
        | {
            readonly status: 'complete';
            readonly proof: 'exact';
        }
        | {
            readonly status: 'partial';
            readonly proof: 'mixed';
        }
        | {
            readonly status: 'unavailable';
            readonly proof: 'incomplete';
        }
    );
