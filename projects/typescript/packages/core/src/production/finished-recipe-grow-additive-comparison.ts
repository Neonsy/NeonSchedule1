import { canonicalJson } from '#core/data/canonical-json';
import type {
    FinishedRecipeGrowAdditiveStep,
    FinishedRecipeProductionPlan,
} from '#core/production/finished-recipe';
import type {
    FinishedRecipeGrowAdditiveAlternativeComparison,
    FinishedRecipeGrowAdditiveComparisonGap,
    FinishedRecipeGrowAdditiveComparisonInput,
    FinishedRecipeGrowAdditiveComparisonResult,
    FinishedRecipeGrowAdditiveEconomicsDelta,
    FinishedRecipeGrowAdditiveProductionStepDelta,
    FinishedRecipeGrowAdditiveProductionStepEvidence,
    FinishedRecipeGrowAdditiveRankingEntry,
    FinishedRecipeGrowAdditiveScenarioEvidence,
    FinishedRecipeGrowAdditiveScenarioInput,
    FinishedRecipeGrowAdditiveSelectionEvidence,
} from '#core/production/finished-recipe-grow-additive-comparison-types';
import { composeFinishedRecipeRealizedProfit } from '#core/production/finished-recipe-profit';
import type { FinishedRecipeRealizedProfitEconomics } from '#core/production/finished-recipe-profit-types';
import type { ProductionBatchStep } from '#core/production/plan';

export type {
    FinishedRecipeGrowAdditiveAlternativeComparison,
    FinishedRecipeGrowAdditiveComparisonGap,
    FinishedRecipeGrowAdditiveComparisonInput,
    FinishedRecipeGrowAdditiveComparisonResult,
    FinishedRecipeGrowAdditiveEconomicsDelta,
    FinishedRecipeGrowAdditiveProductionStepDelta,
    FinishedRecipeGrowAdditiveProductionStepEvidence,
    FinishedRecipeGrowAdditiveRankingEntry,
    FinishedRecipeGrowAdditiveScenarioEvidence,
    FinishedRecipeGrowAdditiveScenarioInput,
    FinishedRecipeGrowAdditiveSelectionEvidence,
} from '#core/production/finished-recipe-grow-additive-comparison-types';

export function compareFinishedRecipeGrowAdditives(
    input: FinishedRecipeGrowAdditiveComparisonInput
): FinishedRecipeGrowAdditiveComparisonResult {
    if (input.alternatives.length === 0) {
        throw new Error('Finished recipe grow additive comparison requires an alternative');
    }
    const scenarioIds = [input.baseline.id, ...input.alternatives.map(({ id }) => id)];
    validateScenarioIds(scenarioIds);
    const baseline = scenarioEvidence(input.baseline, 'no-additive-baseline');
    if (baseline.productionSteps.some(({ additiveItemIds }) => additiveItemIds.length > 0)) {
        throw new Error('Finished recipe grow additive baseline must not select additives');
    }
    const baselinePlan = productionPlan(input.baseline);
    const alternatives = [...input.alternatives]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((alternative) =>
            compareAlternative(baseline, input.baseline, baselinePlan, alternative)
        );
    const baselineGap: FinishedRecipeGrowAdditiveComparisonGap[] = baseline.proof === 'exact'
        ? []
        : [{ scenarioId: baseline.id, code: 'baseline-economics-incomplete' }];
    const alternativeGaps = alternatives.flatMap(({ gaps }) => gaps);
    const gaps = deduplicateGaps([...baselineGap, ...alternativeGaps]);
    const exactScenarios = baseline.proof !== 'exact'
        ? []
        : [baseline, ...alternatives.map(({ scenario }) => scenario)]
              .filter((scenario) => scenario.proof === 'exact');
    const ranking = rankExactScenarios(exactScenarios);
    const rankedIds = new Set(ranking.map(({ scenarioId }) => scenarioId));
    const excludedScenarioIds = [baseline, ...alternatives.map(({ scenario }) => scenario)]
        .map(({ id }) => id)
        .filter((id) => !rankedIds.has(id))
        .sort();
    const details = {
        objective: 'highest-exact-realized-profit-per-game-minute',
        tieBreak:
            'profit-per-game-minute-then-realized-profit-then-lower-elapsed-minutes-then-canonical-scenario-id',
        baseline,
        alternatives,
        ranking,
        excludedScenarioIds,
        gaps,
    } as const;
    if (baseline.proof !== 'exact') {
        return { status: 'unavailable', proof: 'incomplete', ...details };
    }
    return gaps.length === 0
        ? { status: 'complete', proof: 'exact', ...details }
        : { status: 'partial', proof: 'mixed', ...details };
}

function compareAlternative(
    baseline: FinishedRecipeGrowAdditiveScenarioEvidence,
    baselineInput: FinishedRecipeGrowAdditiveScenarioInput,
    baselinePlan: FinishedRecipeProductionPlan,
    alternativeInput: FinishedRecipeGrowAdditiveScenarioInput
): FinishedRecipeGrowAdditiveAlternativeComparison {
    const alternativePlan = productionPlan(alternativeInput);
    validateComparablePlans(baselinePlan, alternativePlan);
    validateComparableScenarioContext(baselineInput, alternativeInput);
    const scenario = scenarioEvidence(alternativeInput, 'grow-additive-selection');
    if (scenario.productionSteps.every(({ additiveItemIds }) => additiveItemIds.length === 0)) {
        throw new Error(
            `Finished recipe grow additive alternative ${JSON.stringify(scenario.id)} selects no additives`
        );
    }
    const productionStepDeltas = scenario.productionSteps.map((step, index) =>
        productionStepDelta(baseline.productionSteps[index], step)
    );
    if (baseline.economics === null || scenario.economics === null) {
        const gaps: FinishedRecipeGrowAdditiveComparisonGap[] = [];
        if (baseline.economics === null) {
            gaps.push({ scenarioId: baseline.id, code: 'baseline-economics-incomplete' });
        }
        if (scenario.economics === null) {
            gaps.push({ scenarioId: scenario.id, code: 'alternative-economics-incomplete' });
        }
        return {
            status: 'unavailable',
            proof: 'incomplete',
            scenario,
            productionStepDeltas,
            economicsDelta: null,
            gaps,
        };
    }
    return {
        status: 'complete',
        proof: 'exact',
        scenario,
        productionStepDeltas,
        economicsDelta: economicsDelta(baseline.economics, scenario.economics),
        gaps: [],
    };
}

function scenarioEvidence(
    input: FinishedRecipeGrowAdditiveScenarioInput,
    kind: FinishedRecipeGrowAdditiveScenarioEvidence['kind']
): FinishedRecipeGrowAdditiveScenarioEvidence {
    const plan = productionPlan(input);
    validateGrowPlan(plan);
    const result = composeFinishedRecipeRealizedProfit(input.profit);
    return {
        id: input.id,
        kind,
        dataset: { ...plan.dataset },
        finishedQuantity: plan.finishedQuantity,
        productionSteps: plan.baseProductPlan.productionSteps
            .filter(({ method }) => method === 'seed-harvest')
            .map((step) => productionStepEvidence(plan, step)),
        economics: result.economics,
        proof: result.status === 'complete' ? 'exact' : 'incomplete',
    };
}

function productionPlan(
    scenario: FinishedRecipeGrowAdditiveScenarioInput
): FinishedRecipeProductionPlan {
    return scenario.profit.lifecycleInput.readiness.productionPlan;
}

function productionStepEvidence(
    plan: FinishedRecipeProductionPlan,
    step: ProductionBatchStep
): FinishedRecipeGrowAdditiveProductionStepEvidence {
    if (step.equipmentItemId === null || step.quality === null) {
        throw new Error('Finished recipe seed harvest is missing grow evidence');
    }
    const additiveSteps = plan.growAdditiveSteps.filter(
        ({ productionItemId }) => productionItemId === step.itemId
    );
    const additives = step.additiveItemIds.map((additiveItemId) => {
        const additive = additiveSteps.find(
            (candidate) => candidate.additiveItemId === additiveItemId
        );
        if (additive === undefined) {
            throw new Error('Finished recipe grow additive evidence is incomplete');
        }
        return {
            additiveItemId,
            applicationCount: additive.applicationCount,
            materialQuantity: additive.materialQuantity,
            qualityChange: additive.qualityChange,
            yieldMultiplier: additive.yieldMultiplier,
            instantGrowth: additive.instantGrowth,
        };
    });
    return {
        productionItemId: step.itemId,
        growContainerItemId: step.equipmentItemId,
        growLightItemId: step.growLightItemId,
        additiveItemIds: [...step.additiveItemIds],
        additives,
        outputQuantityPerBatch: step.outputQuantityPerBatch,
        batchCount: step.batchCount,
        producedQuantity: step.producedQuantity,
        leftoverQuantity: step.leftoverQuantity,
        durationMinutesPerBatch: step.durationMinutesPerBatch,
        totalProcessMinutes: step.totalProcessMinutes,
        applicationCount: additiveSteps.reduce(
            (total, additive) => addFinite(total, additive.applicationCount, 'application count'),
            0
        ),
        materialQuantity: additiveSteps.reduce(
            (total, additive) => addFinite(total, additive.materialQuantity, 'material quantity'),
            0
        ),
        quality: { ...step.quality },
    };
}

function validateGrowPlan(plan: FinishedRecipeProductionPlan): void {
    if (canonicalJson(plan.dataset) !== canonicalJson(plan.baseProductPlan.dataset)) {
        throw new Error('Finished recipe grow additive plan has inconsistent datasets');
    }
    if (
        plan.finishedQuantity !== plan.baseProductPlan.targetQuantity ||
        plan.recipe.productId !== plan.baseProductPlan.targetItemId
    ) {
        throw new Error('Finished recipe grow additive plan has inconsistent target identity');
    }
    const seedSteps = plan.baseProductPlan.productionSteps.filter(
        ({ method }) => method === 'seed-harvest'
    );
    if (seedSteps.length === 0) {
        throw new Error('Finished recipe grow additive comparison requires seed harvest production');
    }
    for (const step of seedSteps) validateSeedStep(plan.growAdditiveSteps, step);
    const seedItemIds = new Set(seedSteps.map(({ itemId }) => itemId));
    if (plan.growAdditiveSteps.some(({ productionItemId }) => !seedItemIds.has(productionItemId))) {
        throw new Error('Finished recipe grow additive evidence references a non-seed production step');
    }
}

function validateSeedStep(
    additiveSteps: readonly FinishedRecipeGrowAdditiveStep[],
    productionStep: ProductionBatchStep
): void {
    requirePositiveSafeInteger(productionStep.batchCount, 'Finished recipe grow batch count');
    requirePositiveFinite(productionStep.outputQuantityPerBatch, 'Finished recipe grow yield');
    requirePositiveFinite(productionStep.requiredQuantity, 'Finished recipe grow required quantity');
    requirePositiveFinite(productionStep.producedQuantity, 'Finished recipe grow produced quantity');
    requireNonNegativeFinite(productionStep.leftoverQuantity, 'Finished recipe grow leftover');
    requireNonNegativeFinite(productionStep.durationMinutesPerBatch, 'Finished recipe grow duration');
    requireNonNegativeFinite(productionStep.totalProcessMinutes, 'Finished recipe grow total duration');
    if (
        productionStep.producedQuantity !==
            productionStep.outputQuantityPerBatch * productionStep.batchCount ||
        productionStep.leftoverQuantity !==
            productionStep.producedQuantity - productionStep.requiredQuantity ||
        productionStep.totalProcessMinutes !==
            productionStep.durationMinutesPerBatch * productionStep.batchCount
    ) {
        throw new Error('Finished recipe grow production step has inconsistent batch quantities');
    }
    requireFinite(productionStep.quality?.level ?? Number.NaN, 'Finished recipe grow quality level');
    requireFinite(
        productionStep.quality?.customerScalar ?? Number.NaN,
        'Finished recipe grow quality scalar'
    );
    if (productionStep.equipmentItemId === null || productionStep.quality === null) {
        throw new Error('Finished recipe seed harvest is missing grow evidence');
    }
    const selectedIds = productionStep.additiveItemIds;
    if (new Set(selectedIds).size !== selectedIds.length) {
        throw new Error('Finished recipe grow additive plan selects an additive more than once');
    }
    if (canonicalJson(selectedIds) !== canonicalJson([...selectedIds].sort())) {
        throw new Error('Finished recipe grow additive selection is not canonical');
    }
    const matching = additiveSteps.filter(
        ({ productionItemId }) => productionItemId === productionStep.itemId
    );
    if (matching.length !== selectedIds.length) {
        throw new Error('Finished recipe grow additive evidence does not match the production step');
    }
    for (const additiveId of selectedIds) {
        const evidence = matching.find(({ additiveItemId }) => additiveItemId === additiveId);
        const input = productionStep.inputs.find(({ itemId }) => itemId === additiveId);
        if (
            evidence === undefined ||
            evidence.growContainerItemId !== productionStep.equipmentItemId ||
            evidence.batchCount !== productionStep.batchCount ||
            evidence.applicationCount !== productionStep.batchCount ||
            evidence.materialQuantity !== productionStep.batchCount ||
            input?.quantityPerBatch !== 1 ||
            input.totalQuantity !== productionStep.batchCount
        ) {
            throw new Error(
                `Finished recipe grow additive ${JSON.stringify(additiveId)} does not match whole-batch application evidence`
            );
        }
        requireFinite(evidence.qualityChange, 'Finished recipe grow additive quality change');
        requireNonNegativeFinite(evidence.yieldMultiplier, 'Finished recipe grow additive yield multiplier');
        requireNonNegativeFinite(evidence.instantGrowth, 'Finished recipe grow additive instant growth');
    }
}

function validateComparablePlans(
    baseline: FinishedRecipeProductionPlan,
    alternative: FinishedRecipeProductionPlan
): void {
    if (canonicalJson(baseline.dataset) !== canonicalJson(alternative.dataset)) {
        throw new Error('Finished recipe grow additive scenarios use different datasets');
    }
    if (baseline.finishedQuantity !== alternative.finishedQuantity) {
        throw new Error('Finished recipe grow additive scenarios use different finished quantities');
    }
    if (canonicalJson(recipeIdentity(baseline)) !== canonicalJson(recipeIdentity(alternative))) {
        throw new Error('Finished recipe grow additive scenarios use different recipe identities');
    }
    if (canonicalJson(downstreamIdentity(baseline)) !== canonicalJson(downstreamIdentity(alternative))) {
        throw new Error('Finished recipe grow additive scenarios use different downstream processing');
    }
    const baselineSteps = baseline.baseProductPlan.productionSteps;
    const alternativeSteps = alternative.baseProductPlan.productionSteps;
    if (baselineSteps.length !== alternativeSteps.length) {
        throw new Error('Finished recipe grow additive scenarios use different production routes');
    }
    for (let index = 0; index < baselineSteps.length; index += 1) {
        if (
            canonicalJson(productionStepIdentity(baselineSteps[index])) !==
            canonicalJson(productionStepIdentity(alternativeSteps[index]))
        ) {
            throw new Error('Finished recipe grow additive scenarios use incompatible production routes');
        }
    }
}

function validateComparableScenarioContext(
    baseline: FinishedRecipeGrowAdditiveScenarioInput,
    alternative: FinishedRecipeGrowAdditiveScenarioInput
): void {
    const baselineLifecycle = baseline.profit.lifecycleInput;
    const alternativeLifecycle = alternative.profit.lifecycleInput;
    if (baselineLifecycle.readiness.propertyId !== alternativeLifecycle.readiness.propertyId) {
        throw new Error('Finished recipe grow additive scenarios use different production properties');
    }
    const baselineSale = baselineLifecycle.sale;
    const alternativeSale = alternativeLifecycle.sale;
    if (
        baselineSale !== undefined &&
        alternativeSale !== undefined &&
        canonicalJson(saleIdentity(baselineSale)) !== canonicalJson(saleIdentity(alternativeSale))
    ) {
        throw new Error('Finished recipe grow additive scenarios use different sale routes');
    }
}

function saleIdentity(
    sale: NonNullable<FinishedRecipeGrowAdditiveScenarioInput['profit']['lifecycleInput']['sale']>
): unknown {
    return {
        kind: sale.kind,
        sellerId: sale.sellerId,
        destinationId: sale.destinationId,
        completionRule: sale.completionRule,
    };
}

function recipeIdentity(plan: FinishedRecipeProductionPlan): unknown {
    return {
        ruleProfile: plan.recipe.ruleProfile,
        productId: plan.recipe.productId,
        ingredientIds: plan.recipe.ingredientIds,
        effectIds: plan.recipe.effectIds,
    };
}

function downstreamIdentity(plan: FinishedRecipeProductionPlan): unknown {
    return {
        mixingSteps: plan.mixingSteps,
        dryingStep: plan.dryingStep,
        packagingStep: plan.packagingStep,
        brickPressingStep: plan.brickPressingStep,
    };
}

function productionStepIdentity(step: ProductionBatchStep | undefined): unknown {
    if (step === undefined) return null;
    return {
        itemId: step.itemId,
        method: step.method,
        acceptedEquipmentItemIds: step.acceptedEquipmentItemIds,
        equipmentItemId: step.equipmentItemId,
        growLightItemId: step.growLightItemId,
        inputs: step.inputs
            .filter(({ itemId }) => !step.additiveItemIds.includes(itemId))
            .map(({ itemId, quantityPerBatch }) => ({ itemId, quantityPerBatch })),
    };
}

function productionStepDelta(
    baseline: FinishedRecipeGrowAdditiveProductionStepEvidence | undefined,
    alternative: FinishedRecipeGrowAdditiveProductionStepEvidence
): FinishedRecipeGrowAdditiveProductionStepDelta {
    if (baseline === undefined || baseline.productionItemId !== alternative.productionItemId) {
        throw new Error('Finished recipe grow additive production evidence is not comparable');
    }
    return {
        productionItemId: alternative.productionItemId,
        yieldPerBatch: subtractFinite(
            alternative.outputQuantityPerBatch,
            baseline.outputQuantityPerBatch,
            'yield delta'
        ),
        batchCount: alternative.batchCount - baseline.batchCount,
        producedQuantity: subtractFinite(
            alternative.producedQuantity,
            baseline.producedQuantity,
            'produced quantity delta'
        ),
        leftoverQuantity: subtractFinite(
            alternative.leftoverQuantity,
            baseline.leftoverQuantity,
            'leftover quantity delta'
        ),
        durationMinutesPerBatch: subtractFinite(
            alternative.durationMinutesPerBatch,
            baseline.durationMinutesPerBatch,
            'duration per batch delta'
        ),
        totalProcessMinutes: subtractFinite(
            alternative.totalProcessMinutes,
            baseline.totalProcessMinutes,
            'total process duration delta'
        ),
        applicationCount: alternative.applicationCount,
        materialQuantity: alternative.materialQuantity,
        qualityLevel: subtractFinite(
            alternative.quality.level,
            baseline.quality.level,
            'quality level delta'
        ),
    };
}

function economicsDelta(
    baseline: FinishedRecipeRealizedProfitEconomics,
    alternative: FinishedRecipeRealizedProfitEconomics
): FinishedRecipeGrowAdditiveEconomicsDelta {
    return {
        elapsedGameMinutes: subtractFinite(
            alternative.elapsedGameMinutes,
            baseline.elapsedGameMinutes,
            'elapsed duration delta'
        ),
        attributedCost: subtractFinite(
            alternative.attributedCost,
            baseline.attributedCost,
            'attributed cost delta'
        ),
        realizedProfit: subtractFinite(
            alternative.realizedProfit,
            baseline.realizedProfit,
            'realized profit delta'
        ),
        profitPerGameMinute: subtractFinite(
            alternative.profitPerGameMinute,
            baseline.profitPerGameMinute,
            'profit per game minute delta'
        ),
    };
}

function rankExactScenarios(
    scenarios: readonly FinishedRecipeGrowAdditiveScenarioEvidence[]
): FinishedRecipeGrowAdditiveRankingEntry[] {
    return scenarios
        .map((scenario) => {
            if (scenario.economics === null) {
                throw new Error('Exact finished recipe grow additive scenario has no economics');
            }
            return { scenario, economics: scenario.economics };
        })
        .sort((left, right) =>
            compareDescending(
                left.economics.profitPerGameMinute,
                right.economics.profitPerGameMinute
            ) ||
            compareDescending(left.economics.realizedProfit, right.economics.realizedProfit) ||
            compareAscending(left.economics.elapsedGameMinutes, right.economics.elapsedGameMinutes) ||
            left.scenario.id.localeCompare(right.scenario.id)
        )
        .map(({ scenario, economics }, index) => ({
            rank: index + 1,
            scenarioId: scenario.id,
            kind: scenario.kind,
            realizedProfit: economics.realizedProfit,
            elapsedGameMinutes: economics.elapsedGameMinutes,
            profitPerGameMinute: economics.profitPerGameMinute,
        }));
}

function validateScenarioIds(ids: readonly string[]): void {
    for (const id of ids) {
        if (id.trim().length === 0) throw new Error('Finished recipe grow additive scenario ID is blank');
    }
    if (new Set(ids).size !== ids.length) {
        throw new Error('Finished recipe grow additive scenario IDs must be unique');
    }
}

function deduplicateGaps(
    gaps: readonly FinishedRecipeGrowAdditiveComparisonGap[]
): FinishedRecipeGrowAdditiveComparisonGap[] {
    const byIdentity = new Map(
        gaps.map((gap) => [`${gap.scenarioId}\u0000${gap.code}`, gap])
    );
    return [...byIdentity.values()].sort((left, right) =>
        left.scenarioId.localeCompare(right.scenarioId) || left.code.localeCompare(right.code)
    );
}

function compareDescending(left: number, right: number): number {
    return left > right ? -1 : left < right ? 1 : 0;
}

function compareAscending(left: number, right: number): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function addFinite(left: number, right: number, label: string): number {
    return requireFinite(left + right, `Finished recipe grow additive ${label}`);
}

function subtractFinite(left: number, right: number, label: string): number {
    return requireFinite(left - right, `Finished recipe grow additive ${label}`);
}

function requireFinite(value: number, label: string): number {
    if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
    return value;
}

function requirePositiveFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`);
}

function requireNonNegativeFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative`);
}

function requirePositiveSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${label} must be a positive safe integer`);
    }
}
