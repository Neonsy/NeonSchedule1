import {
    composeFinishedRecipeElapsedLifecycle,
    composeFinishedRecipeRealizedProfit,
    type FinishedRecipeElapsedLifecycleInput,
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
    equipment: FinishedRecipeRealizedCostTreatment = notIncurredCost('equipment')
): readonly FinishedRecipeRealizedCostTreatment[] {
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
