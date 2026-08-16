import {
    composeFinishedRecipeElapsedLifecycle,
    validateFinishedRecipeElapsedLifecycleResult,
} from '#core/production/finished-recipe-lifecycle';
import type {
    FinishedRecipeRealizedCostCategory,
    FinishedRecipeRealizedCostEvidence,
    FinishedRecipeRealizedCostSummary,
    FinishedRecipeRealizedCostTreatment,
    FinishedRecipeRealizedProfitEconomics,
    FinishedRecipeRealizedProfitGap,
    FinishedRecipeRealizedProfitInput,
    FinishedRecipeRealizedProfitResult,
    FinishedRecipeRealizedRevenueEvidence,
} from '#core/production/finished-recipe-profit-types';
import type { ProductionPlanDataset } from '#core/production/plan';

const costCategories: readonly FinishedRecipeRealizedCostCategory[] = [
    'materials',
    'equipment',
    'labor',
    'transport',
    'sale-fees',
    'other',
];

export type {
    FinishedRecipeRealizedCostCategory,
    FinishedRecipeRealizedCostEvidence,
    FinishedRecipeRealizedCostSummary,
    FinishedRecipeRealizedCostTreatment,
    FinishedRecipeRealizedProfitEconomics,
    FinishedRecipeRealizedProfitGap,
    FinishedRecipeRealizedProfitInput,
    FinishedRecipeRealizedProfitResult,
    FinishedRecipeRealizedRevenueEvidence,
} from '#core/production/finished-recipe-profit-types';

export function composeFinishedRecipeRealizedProfit(
    input: FinishedRecipeRealizedProfitInput
): FinishedRecipeRealizedProfitResult {
    validateFinishedRecipeElapsedLifecycleResult(input.lifecycleInput, input.lifecycleResult);
    const lifecycle = composeFinishedRecipeElapsedLifecycle(input.lifecycleInput);
    const expectedDataset = input.lifecycleInput.readiness.productionPlan.dataset;
    const expectedQuantity = input.lifecycleInput.readiness.productionPlan.finishedQuantity;
    const revenue = validateAndCloneRevenue(
        input.revenue,
        expectedDataset,
        expectedQuantity
    );
    const costs = summarizeCosts(input.costs, expectedDataset, expectedQuantity);
    const gaps: FinishedRecipeRealizedProfitGap[] = [];
    if (lifecycle.status !== 'complete' || lifecycle.proof !== 'exact' || lifecycle.elapsed === null) {
        gaps.push({ code: 'elapsed-lifecycle-incomplete' });
    }
    if (revenue.coverage !== 'complete') {
        gaps.push({ code: 'realized-revenue-incomplete' });
    }
    if (costs.evidence.coverage !== 'complete') {
        gaps.push({ code: 'attributed-cost-coverage-incomplete' });
    }
    const elapsedGameMinutes = lifecycle.elapsed?.inputReadyToSaleCompletionMinutes ?? null;
    if (lifecycle.status === 'complete' && elapsedGameMinutes !== null && elapsedGameMinutes <= 0) {
        gaps.push({ code: 'elapsed-time-not-positive' });
    }
    const economics = gaps.length === 0 && elapsedGameMinutes !== null
        ? realizedEconomics(revenue.recordedRevenue, costs.knownTotalCost, elapsedGameMinutes)
        : null;
    const details = {
        scope: 'realized-sale-profit-over-complete-elapsed-lifecycle',
        accountingBasis: 'caller-supplied-revenue-minus-costs-attributed-to-sold-output',
        lifecycle,
        revenue,
        costs,
        economics,
        gaps,
    } as const;
    return economics === null
        ? { status: 'unavailable', proof: 'incomplete', ...details }
        : { status: 'complete', proof: 'exact', ...details };
}

function validateAndCloneRevenue(
    evidence: FinishedRecipeRealizedRevenueEvidence,
    expectedDataset: ProductionPlanDataset,
    expectedQuantity: number
): FinishedRecipeRealizedRevenueEvidence {
    validateDataset(evidence.dataset, expectedDataset, 'Realized revenue');
    requireMatchingQuantity(evidence.quantity, expectedQuantity, 'Realized revenue');
    validateCoverage(evidence.coverage, 'Realized revenue');
    if (evidence.evidence !== 'caller-supplied-realized-sale-revenue') {
        throw new Error('Finished recipe realized revenue evidence is invalid');
    }
    requireNonNegativeFinite(evidence.recordedRevenue, 'Finished recipe recorded revenue');
    return { ...evidence, dataset: { ...evidence.dataset } };
}

function summarizeCosts(
    evidence: FinishedRecipeRealizedCostEvidence,
    expectedDataset: ProductionPlanDataset,
    expectedQuantity: number
): FinishedRecipeRealizedCostSummary {
    validateDataset(evidence.dataset, expectedDataset, 'Attributed cost');
    requireMatchingQuantity(evidence.quantity, expectedQuantity, 'Attributed cost');
    validateCoverage(evidence.coverage, 'Attributed cost');
    if (evidence.accountingBasis !== 'caller-supplied-costs-attributed-to-sold-output') {
        throw new Error('Finished recipe attributed-cost accounting basis is invalid');
    }
    const treatments = new Map<
        FinishedRecipeRealizedCostCategory,
        FinishedRecipeRealizedCostTreatment
    >();
    for (const treatment of evidence.treatments) {
        validateCostCategory(treatment.category);
        if (treatments.has(treatment.category)) {
            throw new Error(
                `Finished recipe cost evidence contains duplicate category ${JSON.stringify(treatment.category)}`
            );
        }
        validateCostTreatment(treatment);
        treatments.set(treatment.category, { ...treatment });
    }
    const missingCategories = costCategories.filter((category) => !treatments.has(category));
    if (evidence.coverage === 'complete' && missingCategories.length > 0) {
        throw new Error('Complete finished recipe cost evidence is missing a category treatment');
    }
    const canonicalTreatments = costCategories.flatMap((category) => {
        const treatment = treatments.get(category);
        return treatment === undefined ? [] : [treatment];
    });
    const knownTotalCost = finiteSum(
        canonicalTreatments.map((treatment) => treatment.amount),
        'Finished recipe attributed cost'
    );
    return {
        evidence: {
            ...evidence,
            dataset: { ...evidence.dataset },
            treatments: canonicalTreatments,
        },
        knownTotalCost,
        missingCategories,
    };
}

function validateCostTreatment(treatment: FinishedRecipeRealizedCostTreatment): void {
    const category = treatment.category;
    if (treatment.treatment === 'included') {
        requireNonNegativeFinite(
            treatment.amount,
            `Finished recipe ${category} attributed cost`
        );
        return;
    }
    if (treatment.treatment !== 'not-incurred' || treatment.amount !== 0) {
        throw new Error(
            `Finished recipe ${category} cost treatment is invalid`
        );
    }
}

function realizedEconomics(
    realizedRevenue: number,
    attributedCost: number,
    elapsedGameMinutes: number
): FinishedRecipeRealizedProfitEconomics {
    const realizedProfit = subtractFinite(
        realizedRevenue,
        attributedCost,
        'Finished recipe realized profit'
    );
    const profitPerGameMinute = divideFinite(
        realizedProfit,
        elapsedGameMinutes,
        'Finished recipe profit per game minute'
    );
    return {
        realizedRevenue,
        attributedCost,
        realizedProfit,
        elapsedGameMinutes,
        profitPerGameMinute,
    };
}

function validateDataset(
    actual: ProductionPlanDataset,
    expected: ProductionPlanDataset,
    label: string
): void {
    requireNonBlank(actual.gameVersion, `${label} dataset game version`);
    requireSha256(actual.datasetSha256, `${label} dataset identity`);
    if (
        actual.gameVersion !== expected.gameVersion ||
        actual.datasetSha256 !== expected.datasetSha256
    ) {
        throw new Error(`${label} evidence belongs to a different production dataset`);
    }
}

function requireMatchingQuantity(actual: number, expected: number, label: string): void {
    requirePositiveSafeInteger(actual, `${label} quantity`);
    if (actual !== expected) {
        throw new Error(`${label} quantity does not match the sold planned output`);
    }
}

function validateCoverage(value: string, label: string): void {
    if (value !== 'complete' && value !== 'partial') {
        throw new Error(`${label} coverage must be complete or partial`);
    }
}

function validateCostCategory(value: string): asserts value is FinishedRecipeRealizedCostCategory {
    if (!costCategories.includes(value as FinishedRecipeRealizedCostCategory)) {
        throw new Error(`Finished recipe cost category ${JSON.stringify(value)} is invalid`);
    }
}

function finiteSum(values: readonly number[], label: string): number {
    let result = 0;
    for (const value of values) {
        result += value;
        if (!Number.isFinite(result)) throw new Error(`${label} must be finite`);
    }
    return result;
}

function subtractFinite(left: number, right: number, label: string): number {
    const result = left - right;
    if (!Number.isFinite(result)) throw new Error(`${label} must be finite`);
    return result;
}

function divideFinite(left: number, right: number, label: string): number {
    const result = left / right;
    if (!Number.isFinite(result)) throw new Error(`${label} must be finite`);
    return result;
}

function requireNonBlank(value: string, label: string): void {
    if (value.trim().length === 0) throw new Error(`${label} must not be blank`);
}

function requireSha256(value: string, label: string): void {
    if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error(`${label} must be a lowercase SHA-256`);
}

function requireNonNegativeFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative`);
}

function requirePositiveSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${label} must be a positive safe integer`);
    }
}
