import {
    compareFinishedRecipeGrowAdditives,
    composeFinishedRecipeElapsedLifecycle,
    composeFinishedRecipeRealizedProfit,
    type FinishedRecipeElapsedLifecycleInput,
    type FinishedRecipeGrowAdditiveScenarioInput,
    type FinishedRecipeProductionPlan,
    type FinishedRecipeProductionReadinessInput,
    type FinishedRecipeRealizedCostEvidence,
    type FinishedRecipeRealizedCostTreatment,
    type FinishedRecipeRealizedProfitInput,
    type FinishedRecipeRealizedRevenueEvidence,
    type FinishedRecipeSaleCompletionEvidence,
    type ProductionPlanDataset,
} from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

const dataset: ProductionPlanDataset = {
    gameVersion: 'test',
    datasetSha256: 'a'.repeat(64),
};

describe('finished recipe realized profit', () => {
    it('calculates exact realized profit and profit per game minute', () => {
        const result = composeFinishedRecipeRealizedProfit(profitInput());

        expect(result).toMatchObject({
            status: 'complete',
            proof: 'exact',
            scope: 'realized-sale-profit-over-complete-elapsed-lifecycle',
            costs: {
                knownTotalCost: 30,
                missingCategories: [],
            },
            economics: {
                realizedRevenue: 100,
                attributedCost: 30,
                realizedProfit: 70,
                elapsedGameMinutes: 10,
                profitPerGameMinute: 7,
            },
            gaps: [],
        });
        expect(result.costs.evidence.treatments.map(({ category }) => category)).toEqual([
            'materials',
            'equipment',
            'labor',
            'transport',
            'sale-fees',
            'other',
        ]);
    });

    it('preserves zero realized revenue and negative profit', () => {
        const result = composeFinishedRecipeRealizedProfit(profitInput({ revenue: 0 }));

        expect(result.economics).toEqual({
            realizedRevenue: 0,
            attributedCost: 30,
            realizedProfit: -30,
            elapsedGameMinutes: 10,
            profitPerGameMinute: -3,
        });
    });

    it('uses the same exact economics boundary for a delivered sale', () => {
        const input = profitInput({ saleKind: 'delivered' });
        const result = composeFinishedRecipeRealizedProfit(input);

        expect(result).toMatchObject({
            status: 'complete',
            lifecycle: {
                sale: {
                    kind: 'delivered',
                    sellerId: 'dealer',
                    destinationId: 'customer',
                },
            },
            economics: {
                realizedProfit: 70,
                profitPerGameMinute: 7,
            },
        });
    });

    it('keeps partial revenue from becoming exact profit', () => {
        const base = profitInput();
        const result = composeFinishedRecipeRealizedProfit({
            ...base,
            revenue: { ...base.revenue, coverage: 'partial' },
        });

        expect(result).toMatchObject({
            status: 'unavailable',
            proof: 'incomplete',
            economics: null,
            gaps: [{ code: 'realized-revenue-incomplete' }],
        });
    });

    it('reports missing cost categories under partial coverage', () => {
        const base = profitInput();
        const result = composeFinishedRecipeRealizedProfit({
            ...base,
            costs: {
                ...base.costs,
                coverage: 'partial',
                treatments: [includedCost('materials', 20)],
            },
        });

        expect(result).toMatchObject({
            status: 'unavailable',
            costs: {
                knownTotalCost: 20,
                missingCategories: [
                    'equipment',
                    'labor',
                    'transport',
                    'sale-fees',
                    'other',
                ],
            },
            economics: null,
            gaps: [{ code: 'attributed-cost-coverage-incomplete' }],
        });
    });

    it('keeps an incomplete lifecycle from becoming exact profit', () => {
        const base = profitInput();
        const lifecycleInput: FinishedRecipeElapsedLifecycleInput = {
            readiness: base.lifecycleInput.readiness,
            ...(base.lifecycleInput.execution === undefined
                ? {}
                : { execution: base.lifecycleInput.execution }),
        };
        const result = composeFinishedRecipeRealizedProfit({
            ...base,
            lifecycleInput,
            lifecycleResult: composeFinishedRecipeElapsedLifecycle(lifecycleInput),
        });

        expect(result).toMatchObject({
            status: 'unavailable',
            economics: null,
            gaps: [{ code: 'elapsed-lifecycle-incomplete' }],
        });
    });

    it('distinguishes included equipment cost from equipment not incurred', () => {
        const withoutEquipment = composeFinishedRecipeRealizedProfit(profitInput());
        const withEquipment = composeFinishedRecipeRealizedProfit(profitInput({
            treatments: completeCostTreatments(includedCost('equipment', 10)),
        }));

        expect(withoutEquipment.costs.evidence.treatments[1]).toEqual(
            notIncurredCost('equipment')
        );
        expect(withEquipment.costs.evidence.treatments[1]).toEqual(
            includedCost('equipment', 10)
        );
        expect(withoutEquipment.economics?.realizedProfit).toBe(70);
        expect(withEquipment.economics?.realizedProfit).toBe(60);
    });

    it('rejects quantity and dataset mismatches', () => {
        const base = profitInput();
        expect(() => composeFinishedRecipeRealizedProfit({
            ...base,
            revenue: { ...base.revenue, quantity: 1 },
        })).toThrow('Realized revenue quantity does not match the sold planned output');
        expect(() => composeFinishedRecipeRealizedProfit({
            ...base,
            costs: { ...base.costs, quantity: 1 },
        })).toThrow('Attributed cost quantity does not match the sold planned output');
        expect(() => composeFinishedRecipeRealizedProfit({
            ...base,
            revenue: {
                ...base.revenue,
                dataset: { ...dataset, datasetSha256: 'b'.repeat(64) },
            },
        })).toThrow('Realized revenue evidence belongs to a different production dataset');
    });

    it('rejects altered lifecycle results and incomplete claimed cost coverage', () => {
        const base = profitInput();
        const elapsed = base.lifecycleResult.elapsed;
        if (elapsed === null) throw new Error('Expected exact lifecycle elapsed timing');
        expect(() => composeFinishedRecipeRealizedProfit({
            ...base,
            lifecycleResult: {
                ...base.lifecycleResult,
                elapsed: {
                    ...elapsed,
                    inputReadyToSaleCompletionMinutes:
                        elapsed.inputReadyToSaleCompletionMinutes + 1,
                },
            },
        })).toThrow('Finished recipe elapsed lifecycle result is inconsistent');
        expect(() => composeFinishedRecipeRealizedProfit({
            ...base,
            costs: {
                ...base.costs,
                treatments: [includedCost('materials', 20)],
            },
        })).toThrow('Complete finished recipe cost evidence is missing a category treatment');
        expect(() => composeFinishedRecipeRealizedProfit({
            ...base,
            costs: {
                ...base.costs,
                treatments: [
                    ...base.costs.treatments,
                    includedCost('materials', 1),
                ],
            },
        })).toThrow('Finished recipe cost evidence contains duplicate category');
        expect(() => composeFinishedRecipeRealizedProfit({
            ...base,
            revenue: { ...base.revenue, recordedRevenue: Number.NaN },
        })).toThrow('Finished recipe recorded revenue must be non-negative');
    });

    it('keeps a zero-minute lifecycle from producing a profit rate', () => {
        const input = profitInput({ productionMinutes: 0, saleMinutes: 0 });
        const result = composeFinishedRecipeRealizedProfit(input);

        expect(result).toMatchObject({
            status: 'unavailable',
            economics: null,
            gaps: [{ code: 'elapsed-time-not-positive' }],
        });
    });
});

describe('finished recipe grow additive comparison', () => {
    it('compares one and stacked additive selections against an exact no-additive baseline', () => {
        const baseline = growScenario({ id: 'none' });
        const yieldSelection = growScenario({
            id: 'yield',
            additives: [growAdditive('pgr', { yieldMultiplier: 1.5, qualityChange: -0.2 })],
            outputQuantityPerBatch: 3,
            revenue: 110,
            cost: 35,
        });
        const stackedSelection = growScenario({
            id: 'stacked',
            additives: [
                growAdditive('pgr', { yieldMultiplier: 1.5, qualityChange: -0.2 }),
                growAdditive('speedgrow', {
                    instantGrowth: 0.5,
                    qualityChange: -0.2,
                }),
            ],
            outputQuantityPerBatch: 3,
            durationMinutesPerBatch: 2.5,
            revenue: 105,
            cost: 40,
        });

        const result = compareFinishedRecipeGrowAdditives({
            baseline,
            alternatives: [yieldSelection, stackedSelection],
        });

        expect(result).toMatchObject({
            status: 'complete',
            proof: 'exact',
            objective: 'highest-exact-realized-profit-per-game-minute',
            baseline: {
                id: 'none',
                kind: 'no-additive-baseline',
                finishedQuantity: 6,
                productionSteps: [
                    {
                        additiveItemIds: [],
                        outputQuantityPerBatch: 2,
                        batchCount: 3,
                        producedQuantity: 6,
                        applicationCount: 0,
                        materialQuantity: 0,
                    },
                ],
            },
            excludedScenarioIds: [],
            gaps: [],
        });
        expect(result.alternatives.map(({ scenario }) => scenario.id)).toEqual([
            'stacked',
            'yield',
        ]);
        expect(result.alternatives[0]).toMatchObject({
            status: 'complete',
            scenario: {
                productionSteps: [
                    {
                        additiveItemIds: ['pgr', 'speedgrow'],
                        additives: [
                            {
                                additiveItemId: 'pgr',
                                applicationCount: 2,
                                materialQuantity: 2,
                                qualityChange: -0.2,
                                yieldMultiplier: 1.5,
                                instantGrowth: 0,
                            },
                            {
                                additiveItemId: 'speedgrow',
                                applicationCount: 2,
                                materialQuantity: 2,
                                qualityChange: -0.2,
                                yieldMultiplier: 1,
                                instantGrowth: 0.5,
                            },
                        ],
                        batchCount: 2,
                        applicationCount: 4,
                        materialQuantity: 4,
                    },
                ],
            },
            productionStepDeltas: [
                {
                    yieldPerBatch: 1,
                    batchCount: -1,
                    totalProcessMinutes: -10,
                    applicationCount: 4,
                    materialQuantity: 4,
                    qualityLevel: expect.closeTo(-0.4),
                },
            ],
            economicsDelta: {
                elapsedGameMinutes: -10,
                attributedCost: 10,
                realizedProfit: -5,
                profitPerGameMinute: 3,
            },
        });
        expect(result.alternatives[1]).toMatchObject({
            productionStepDeltas: [
                {
                    yieldPerBatch: 1,
                    batchCount: -1,
                    totalProcessMinutes: -5,
                },
            ],
            economicsDelta: {
                elapsedGameMinutes: -5,
                attributedCost: 5,
                realizedProfit: 5,
                profitPerGameMinute: 1.5,
            },
        });
        expect(result.ranking.map(({ scenarioId }) => scenarioId)).toEqual([
            'stacked',
            'yield',
            'none',
        ]);
    });

    it('reports negative yield and time deltas independently from realized profit', () => {
        const result = compareFinishedRecipeGrowAdditives({
            baseline: growScenario({ id: 'none' }),
            alternatives: [growScenario({
                id: 'quality',
                additives: [growAdditive('quality', {
                    yieldMultiplier: 0.5,
                    qualityChange: 0.3,
                })],
                outputQuantityPerBatch: 1,
                durationMinutesPerBatch: 4,
                revenue: 140,
                cost: 45,
            })],
        });

        expect(result.alternatives[0]).toMatchObject({
            productionStepDeltas: [
                {
                    yieldPerBatch: -1,
                    batchCount: 3,
                    producedQuantity: 0,
                    totalProcessMinutes: 9,
                    qualityLevel: expect.closeTo(0.3),
                },
            ],
            economicsDelta: {
                elapsedGameMinutes: 9,
                attributedCost: 15,
                realizedProfit: 25,
                profitPerGameMinute: expect.closeTo(-0.224137931),
            },
        });
    });

    it('excludes incomplete evidence from exact ranking', () => {
        const result = compareFinishedRecipeGrowAdditives({
            baseline: growScenario({ id: 'none' }),
            alternatives: [
                growScenario({
                    id: 'partial-cost',
                    additives: [growAdditive('pgr', { yieldMultiplier: 1.5 })],
                    outputQuantityPerBatch: 3,
                    costCoverage: 'partial',
                }),
                growScenario({
                    id: 'partial-lifecycle',
                    additives: [growAdditive('speedgrow', { instantGrowth: 0.5 })],
                    durationMinutesPerBatch: 2.5,
                    completeLifecycle: false,
                }),
            ],
        });

        expect(result).toMatchObject({
            status: 'partial',
            proof: 'mixed',
            excludedScenarioIds: ['partial-cost', 'partial-lifecycle'],
            gaps: [
                { scenarioId: 'partial-cost', code: 'alternative-economics-incomplete' },
                { scenarioId: 'partial-lifecycle', code: 'alternative-economics-incomplete' },
            ],
            alternatives: [
                {
                    status: 'unavailable',
                    economicsDelta: null,
                    gaps: [
                        { scenarioId: 'partial-cost', code: 'alternative-economics-incomplete' },
                    ],
                },
                { status: 'unavailable', economicsDelta: null },
            ],
        });
        expect(result.ranking.map(({ scenarioId }) => scenarioId)).toEqual(['none']);

        const incompleteBaseline = compareFinishedRecipeGrowAdditives({
            baseline: growScenario({ id: 'none', completeLifecycle: false }),
            alternatives: [growScenario({
                id: 'exact-alternative',
                additives: [growAdditive('pgr', {})],
            })],
        });
        expect(incompleteBaseline).toMatchObject({
            status: 'unavailable',
            proof: 'incomplete',
            ranking: [],
            excludedScenarioIds: ['exact-alternative', 'none'],
            gaps: [{ scenarioId: 'none', code: 'baseline-economics-incomplete' }],
            alternatives: [
                {
                    status: 'unavailable',
                    economicsDelta: null,
                    gaps: [{ scenarioId: 'none', code: 'baseline-economics-incomplete' }],
                },
            ],
        });
    });

    it('rejects incompatible scenarios and mismatched evidence', () => {
        const baseline = growScenario({ id: 'none' });
        const datasetAlternative = growScenario({
            id: 'dataset',
            additives: [growAdditive('pgr', {})],
        });
        const datasetPlan = datasetAlternative.profit.lifecycleInput.readiness.productionPlan;
        const mismatchedDataset = { gameVersion: 'test', datasetSha256: 'b'.repeat(64) };
        const mismatchedDatasetAlternative: FinishedRecipeGrowAdditiveScenarioInput = {
            ...datasetAlternative,
            profit: {
                ...datasetAlternative.profit,
                lifecycleInput: {
                    ...datasetAlternative.profit.lifecycleInput,
                    readiness: {
                        ...datasetAlternative.profit.lifecycleInput.readiness,
                        productionPlan: {
                            ...datasetPlan,
                            dataset: mismatchedDataset,
                            baseProductPlan: {
                                ...datasetPlan.baseProductPlan,
                                dataset: mismatchedDataset,
                            },
                        },
                    },
                },
            },
        };
        expect(() => compareFinishedRecipeGrowAdditives({
            baseline,
            alternatives: [mismatchedDatasetAlternative],
        })).toThrow('Finished recipe grow additive scenarios use different datasets');
        expect(() => compareFinishedRecipeGrowAdditives({
            baseline,
            alternatives: [growScenario({
                id: 'container',
                growContainerItemId: 'different-container',
                additives: [growAdditive('pgr', {})],
            })],
        })).toThrow('Finished recipe grow additive scenarios use incompatible production routes');
        expect(() => compareFinishedRecipeGrowAdditives({
            baseline,
            alternatives: [growScenario({
                id: 'quantity',
                finishedQuantity: 5,
                additives: [growAdditive('pgr', {})],
            })],
        })).toThrow('Finished recipe grow additive scenarios use different finished quantities');
        expect(() => compareFinishedRecipeGrowAdditives({
            baseline,
            alternatives: [growScenario({
                id: 'application-count',
                additives: [growAdditive('pgr', {})],
                applicationCountAdjustment: 1,
            })],
        })).toThrow('does not match whole-batch application evidence');
    });

    it('uses canonical scenario IDs as the final deterministic tie break', () => {
        const alternatives = ['zeta', 'alpha'].map((id) => growScenario({
            id,
            additives: [growAdditive(`${id}-additive`, {})],
        }));
        const result = compareFinishedRecipeGrowAdditives({
            baseline: growScenario({ id: 'none' }),
            alternatives,
        });

        expect(result.ranking.map(({ scenarioId }) => scenarioId)).toEqual([
            'alpha',
            'none',
            'zeta',
        ]);
    });
});

interface GrowAdditiveFixture {
    readonly itemId: string;
    readonly qualityChange: number;
    readonly yieldMultiplier: number;
    readonly instantGrowth: number;
}

interface GrowScenarioOptions {
    readonly id: string;
    readonly finishedQuantity?: number;
    readonly growContainerItemId?: string;
    readonly additives?: readonly GrowAdditiveFixture[];
    readonly outputQuantityPerBatch?: number;
    readonly durationMinutesPerBatch?: number;
    readonly revenue?: number;
    readonly cost?: number;
    readonly costCoverage?: FinishedRecipeRealizedCostEvidence['coverage'];
    readonly completeLifecycle?: boolean;
    readonly applicationCountAdjustment?: number;
}

function growAdditive(
    itemId: string,
    effects: Partial<Omit<GrowAdditiveFixture, 'itemId'>>
): GrowAdditiveFixture {
    return {
        itemId,
        qualityChange: effects.qualityChange ?? 0,
        yieldMultiplier: effects.yieldMultiplier ?? 1,
        instantGrowth: effects.instantGrowth ?? 0,
    };
}

function growScenario(options: GrowScenarioOptions): FinishedRecipeGrowAdditiveScenarioInput {
    const finishedQuantity = options.finishedQuantity ?? 6;
    const outputQuantityPerBatch = options.outputQuantityPerBatch ?? 2;
    const durationMinutesPerBatch = options.durationMinutesPerBatch ?? 5;
    const additives = [...(options.additives ?? [])].sort((left, right) =>
        left.itemId.localeCompare(right.itemId)
    );
    const growContainerItemId = options.growContainerItemId ?? 'tent';
    const batchCount = Math.ceil(finishedQuantity / outputQuantityPerBatch);
    const totalProcessMinutes = batchCount * durationMinutesPerBatch;
    const production = growProductionPlan({
        finishedQuantity,
        outputQuantityPerBatch,
        durationMinutesPerBatch,
        additives,
        growContainerItemId,
        batchCount,
        totalProcessMinutes,
        applicationCountAdjustment: options.applicationCountAdjustment ?? 0,
    });
    const completeLifecycleInput = growLifecycleInput(production);
    const lifecycleInput: FinishedRecipeElapsedLifecycleInput =
        options.completeLifecycle === false
            ? {
                readiness: completeLifecycleInput.readiness,
                ...(completeLifecycleInput.execution === undefined
                    ? {}
                    : { execution: completeLifecycleInput.execution }),
            }
            : completeLifecycleInput;
    const treatments = completeCostTreatments(
        notIncurredCost('equipment'),
        options.cost ?? 30
    );
    return {
        id: options.id,
        profit: {
            lifecycleInput,
            lifecycleResult: composeFinishedRecipeElapsedLifecycle(lifecycleInput),
            revenue: realizedRevenue(finishedQuantity, options.revenue ?? 100),
            costs: {
                ...realizedCosts(finishedQuantity, treatments),
                coverage: options.costCoverage ?? 'complete',
                treatments: options.costCoverage === 'partial'
                    ? [includedCost('materials', options.cost ?? 30)]
                    : treatments,
            },
        },
    };
}

interface GrowProductionPlanOptions {
    readonly finishedQuantity: number;
    readonly outputQuantityPerBatch: number;
    readonly durationMinutesPerBatch: number;
    readonly additives: readonly GrowAdditiveFixture[];
    readonly growContainerItemId: string;
    readonly batchCount: number;
    readonly totalProcessMinutes: number;
    readonly applicationCountAdjustment: number;
}

function growProductionPlan(options: GrowProductionPlanOptions): FinishedRecipeProductionPlan {
    const base = productionPlan(options.finishedQuantity, options.totalProcessMinutes);
    const additiveIds = options.additives.map(({ itemId }) => itemId);
    const producedQuantity = options.outputQuantityPerBatch * options.batchCount;
    const productionStep = {
        itemId: 'product',
        routeId: ['seed', 'seed', 'product', 'soil', options.growContainerItemId, ...additiveIds]
            .join(':'),
        method: 'seed-harvest' as const,
        requiredQuantity: options.finishedQuantity,
        batchCount: options.batchCount,
        outputQuantityPerBatch: options.outputQuantityPerBatch,
        durationMinutesPerBatch: options.durationMinutesPerBatch,
        acceptedEquipmentItemIds: ['tent'],
        equipmentItemId: options.growContainerItemId,
        growLightItemId: 'light',
        additiveItemIds: additiveIds,
        quality: {
            level: Math.fround(
                0.5 + options.additives.reduce((total, additive) => total + additive.qualityChange, 0)
            ),
            tier: 'fixture-quality',
            customerScalar: 0.5,
        },
        totalProcessMinutes: options.totalProcessMinutes,
        producedQuantity,
        leftoverQuantity: producedQuantity - options.finishedQuantity,
        inputs: [
            { itemId: 'seed', quantityPerBatch: 1, totalQuantity: options.batchCount },
            { itemId: 'soil', quantityPerBatch: 1, totalQuantity: options.batchCount },
            ...additiveIds.map((itemId) => ({
                itemId,
                quantityPerBatch: 1,
                totalQuantity: options.batchCount,
            })),
        ],
    };
    return {
        ...base,
        baseProductPlan: {
            ...base.baseProductPlan,
            productionSteps: [productionStep],
            totalProcessMinutes: options.totalProcessMinutes,
        },
        growAdditiveSteps: options.additives.map((additive) => ({
            position: 'during-base-product-growth',
            productionItemId: 'product',
            growContainerItemId: options.growContainerItemId,
            additiveItemId: additive.itemId,
            batchCount: options.batchCount,
            applicationCount: options.batchCount + options.applicationCountAdjustment,
            materialQuantity: options.batchCount,
            qualityChange: additive.qualityChange,
            yieldMultiplier: additive.yieldMultiplier,
            instantGrowth: additive.instantGrowth,
            manualApplicationDuration: 'interactive-not-fixed',
        })),
        duration: {
            ...base.duration,
            baseProductProcessMinutes: options.totalProcessMinutes,
            knownProcessMinutes: options.totalProcessMinutes,
            modeledTotalProcessMinutes: options.totalProcessMinutes,
        },
    };
}

function growLifecycleInput(
    production: FinishedRecipeProductionPlan
): FinishedRecipeElapsedLifecycleInput {
    const startMinute = 10;
    const productionCompletionMinute = startMinute + production.duration.baseProductProcessMinutes;
    const saleMinutes = 5;
    return {
        readiness: readinessInput(production),
        execution: {
            startMinute,
            executionModel: 'caller-supplied-exclusive-sequential-execution',
        },
        sale: {
            kind: 'direct',
            sellerId: 'player',
            destinationId: 'customer',
            quantity: production.finishedQuantity,
            startMinute: productionCompletionMinute,
            travelDurationMinutes: saleMinutes,
            completionMinute: productionCompletionMinute + saleMinutes,
            completionRule: 'caller-supplied-sale-confirmed-at-destination',
        },
    };
}

interface ProfitInputOptions {
    readonly revenue?: number;
    readonly productionMinutes?: number;
    readonly saleMinutes?: number;
    readonly saleKind?: FinishedRecipeSaleCompletionEvidence['kind'];
    readonly treatments?: readonly FinishedRecipeRealizedCostTreatment[];
}

function profitInput(options: ProfitInputOptions = {}): FinishedRecipeRealizedProfitInput {
    const quantity = 2;
    const productionMinutes = options.productionMinutes ?? 5;
    const saleMinutes = options.saleMinutes ?? 5;
    const lifecycleInput = elapsedLifecycleInput(
        quantity,
        productionMinutes,
        saleMinutes,
        options.saleKind ?? 'direct'
    );
    return {
        lifecycleInput,
        lifecycleResult: composeFinishedRecipeElapsedLifecycle(lifecycleInput),
        revenue: realizedRevenue(quantity, options.revenue ?? 100),
        costs: realizedCosts(quantity, options.treatments ?? completeCostTreatments()),
    };
}

function elapsedLifecycleInput(
    quantity: number,
    productionMinutes: number,
    saleMinutes: number,
    saleKind: FinishedRecipeSaleCompletionEvidence['kind']
): FinishedRecipeElapsedLifecycleInput {
    const productionCompletionMinute = 10 + productionMinutes;
    return {
        readiness: readinessInput(productionPlan(quantity, productionMinutes)),
        execution: {
            startMinute: 10,
            executionModel: 'caller-supplied-exclusive-sequential-execution',
        },
        sale: saleKind === 'direct'
            ? {
                kind: 'direct',
                sellerId: 'player',
                destinationId: 'customer',
                quantity,
                startMinute: productionCompletionMinute,
                travelDurationMinutes: saleMinutes,
                completionMinute: productionCompletionMinute + saleMinutes,
                completionRule: 'caller-supplied-sale-confirmed-at-destination',
            }
            : {
                kind: 'delivered',
                sellerId: 'dealer',
                destinationId: 'customer',
                quantity,
                startMinute: productionCompletionMinute,
                deliveryDurationMinutes: saleMinutes,
                completionMinute: productionCompletionMinute + saleMinutes,
                completionRule: 'caller-supplied-delivery-confirmed-at-destination',
            },
    };
}

function realizedRevenue(
    quantity: number,
    recordedRevenue: number
): FinishedRecipeRealizedRevenueEvidence {
    return {
        dataset,
        quantity,
        coverage: 'complete',
        recordedRevenue,
        evidence: 'caller-supplied-realized-sale-revenue',
    };
}

function realizedCosts(
    quantity: number,
    treatments: readonly FinishedRecipeRealizedCostTreatment[]
): FinishedRecipeRealizedCostEvidence {
    return {
        dataset,
        quantity,
        coverage: 'complete',
        accountingBasis: 'caller-supplied-costs-attributed-to-sold-output',
        treatments,
    };
}

function completeCostTreatments(
    equipment: FinishedRecipeRealizedCostTreatment = notIncurredCost('equipment'),
    totalCost?: number
): readonly FinishedRecipeRealizedCostTreatment[] {
    if (totalCost !== undefined) {
        return [
            includedCost('sale-fees', 0),
            notIncurredCost('other'),
            includedCost('materials', totalCost),
            includedCost('transport', 0),
            equipment,
            includedCost('labor', 0),
        ];
    }
    return [
        includedCost('sale-fees', 2),
        notIncurredCost('other'),
        includedCost('materials', 20),
        includedCost('transport', 3),
        equipment,
        includedCost('labor', 5),
    ];
}

function includedCost(
    category: FinishedRecipeRealizedCostTreatment['category'],
    amount: number
): FinishedRecipeRealizedCostTreatment {
    return { category, treatment: 'included', amount };
}

function notIncurredCost(
    category: FinishedRecipeRealizedCostTreatment['category']
): FinishedRecipeRealizedCostTreatment {
    return { category, treatment: 'not-incurred', amount: 0 };
}

function readinessInput(
    production: FinishedRecipeProductionPlan
): FinishedRecipeProductionReadinessInput {
    return {
        propertyId: 'lab',
        productionPlan: production,
        transferPlan: {
            objective: 'maximize-transferred-reorder-quantity-per-item',
            tieBreak: 'canonical-item-source-destination-candidate-identity-order',
            routeOptimization: 'not-evaluated',
            demandProof: 'exact',
            transferEvidenceProof: 'exact',
            allocationProof: 'maximum',
            residualProof: 'exact',
            residualCostProof: 'exact',
            requirements: [],
            sources: [],
            allocations: [],
            totalRequestedReorderQuantity: 0,
            knownAllocatedQuantity: 0,
            unallocatedAfterKnownTransfersQuantity: 0,
            totalResidualReorderQuantity: 0,
            totalResidualMaterialReorderCost: 0,
            totalResidualEquipmentReorderCost: 0,
            totalResidualReorderCost: 0,
        },
        purchasePlan: {
            objective: 'maximize-supported-fulfillment-then-minimize-cost-per-item',
            tieBreak: 'unit-price-then-shop-code',
            routeOptimization: 'not-evaluated',
            timingProof: 'not-evaluated',
            demandProof: 'exact',
            sellerEvidenceProof: 'exact',
            allocationProof: 'minimum-cost',
            fulfillmentProof: 'exact',
            requirements: [],
            items: [],
            allocations: [],
            totalRequestedQuantity: 0,
            knownAllocatedQuantity: 0,
            unallocatedAfterSupportedPurchases: 0,
            totalFinalUnallocatedQuantity: 0,
            knownAllocatedCost: 0,
            minimumRequiredPurchaseCost: 0,
        },
        shopping: {
            dataset,
            arrivalDestination: {
                kind: 'production-property',
                propertyId: 'lab',
                evidence: 'caller-supplied-depot-and-remote-delivery-destination',
            },
            route: {
                kind: 'planned',
                plan: {
                    objective: 'minimum-elapsed-minutes',
                    tieBreak: 'remaining-metrics-then-trip-count-then-canonical-shop-item-identity-order',
                    movementModelId: 'test',
                    carryingModel: 'caller-supplied-load-units',
                    tripModel: 'each-trip-starts-and-returns-to-depot',
                    scheduleModel: 'service-start-must-be-within-recurring-shop-window',
                    remoteDeliveryModel: 'caller-supplied-concurrent-duration-from-route-start',
                    proof: 'optimal',
                    evidenceProof: 'complete',
                    searchProof: 'exhaustive',
                    evidenceGaps: [],
                    visitedStates: 1,
                    maximumStates: 1,
                    allocations: [],
                    trips: [],
                    remoteDeliveries: [],
                    totalPurchaseCost: 0,
                    totalTravelDistance: 0,
                    physicalCompletionMinute: 10,
                    remoteCompletionMinute: 10,
                    completionMinute: 10,
                    elapsedMinutes: 0,
                },
            },
        },
    };
}

function productionPlan(
    finishedQuantity: number,
    processMinutes: number
): FinishedRecipeProductionPlan {
    return {
        dataset,
        recipe: {
            ruleProfile: { kind: 'standard' },
            productId: 'product',
            ingredientIds: [],
            effectIds: [],
            productValue: 50,
            baseProductCost: 10,
            baseProductCostBasis: 'base-purchase-price',
            ingredientCost: 0,
            totalCost: 10,
            netValue: 40,
            ingredientCount: 0,
        },
        finishedQuantity,
        baseProductPlan: {
            dataset,
            targetItemId: 'product',
            targetQuantity: finishedQuantity,
            productionSteps: [],
            purchases: [],
            totalProcessMinutes: processMinutes,
            requiredMaterialCost: 0,
            purchaseCost: 0,
        },
        growAdditiveSteps: [],
        ingredientDemands: [],
        purchases: [],
        mixingSteps: [],
        dryingStep: null,
        packagingStep: null,
        brickPressingStep: null,
        equipment: {
            quantityBasis: 'minimum-one-per-selected-item-for-serial-plan',
            selectionProof: 'exact',
            unresolvedProductionRouteIds: [],
            purchaseCostProof: 'exact',
            requirements: [],
            totalRequiredPurchaseCost: 0,
        },
        inventory: {
            allocationOrder: 'reserve-equipment-before-recurring-materials',
            demandProof: 'exact',
            inventoryProof: 'supplied',
            quantityProof: 'exact',
            costProof: 'exact',
            requirements: [],
            totalMaterialReorderCost: 0,
            totalEquipmentReorderCost: 0,
            totalReorderCost: 0,
            requiredStackCount: 0,
            currentStackCount: 0,
            reorderStackCount: 0,
            postReorderStackCount: 0,
            additionalStackCount: 0,
        },
        duration: {
            baseProductProcessMinutes: processMinutes,
            mixingProcessMinutes: 0,
            dryingProcessMinutes: null,
            packagingEmployeeRealSeconds: null,
            brickPressingEmployeeRealSeconds: null,
            knownProcessMinutes: processMinutes,
            modeledTotalProcessMinutes: processMinutes,
        },
        cost: {
            recipeEstimatedUnitMaterialCost: 10,
            recipeEstimatedMaterialCost: finishedQuantity * 10,
            requiredMaterialCost: 0,
            materialReorderCost: 0,
            equipmentReorderCost: 0,
            combinedReorderCost: 0,
        },
        evidence: {
            modeledScope: 'base-product-and-ordered-mixing',
            modeledQuantityProof: 'exact',
            materialCostCoverage: 'modeled-materials-only',
            modeledDurationProof: 'complete',
            finishedLifecycleProof: 'partial',
            missingFacts: [],
            dryingApplicability: 'not-applicable',
            packagingApplicability: 'not-applicable',
            brickPressingApplicability: 'not-applicable',
            unmodeledOperations: [],
        },
    };
}
