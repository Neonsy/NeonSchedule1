import {
    composeFinishedRecipeElapsedLifecycle,
    composeFinishedRecipeProductionReadiness,
    attributeFinishedRecipeShoppingRouteToProperties,
    planFinishedRecipePropertyTransferArrivals,
    type FinishedRecipeBrickPressingStep,
    type FinishedRecipePackagingStep,
    type FinishedRecipeProductionPlan,
    type FinishedRecipeProductionReadinessInput,
    type FinishedRecipePropertyTransferPlan,
    type FinishedRecipePropertyTransferArrivalResult,
    type FinishedRecipePurchasePlan,
    type FinishedRecipeShoppingAllocation,
    type FinishedRecipeShoppingPropertyAttributionResult,
    type FinishedRecipeShoppingRouteResult,
    type ProductionPlanDataset,
} from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

const dataset: ProductionPlanDataset = {
    gameVersion: 'test',
    datasetSha256: 'a'.repeat(64),
};

describe('finished recipe production readiness', () => {
    it('makes purchased inputs ready when a physical trip returns to the production property', () => {
        const result = composeFinishedRecipeProductionReadiness(input({
            route: physicalRoute(2, 12),
        }));

        expect(result).toMatchObject({
            status: 'ready',
            readinessProof: 'exact',
            routeStartMinute: 0,
            shoppingCompletionMinute: 12,
            productionInputsReadyMinute: 12,
            gaps: [],
        });
        expect(result.inputs).toEqual([{
            itemId: 'soil',
            requiredMaterialQuantity: 2,
            requiredEquipmentQuantity: 0,
            currentAppliedQuantity: 0,
            transferredQuantity: 0,
            transferArrivalMinute: null,
            purchasedQuantity: 2,
            purchaseArrivalMinute: 12,
            readyMinute: 12,
            readinessProof: 'exact',
        }]);
    });

    it('uses the selected remote delivery completion for production-property arrival', () => {
        const result = composeFinishedRecipeProductionReadiness(input({
            route: remoteRoute(2, 20),
        }));

        expect(result).toMatchObject({
            status: 'ready',
            shoppingRouteProof: 'optimal',
            shoppingCompletionMinute: 20,
            productionInputsReadyMinute: 20,
        });
        expect(result.inputs[0]).toMatchObject({
            purchasedQuantity: 2,
            purchaseArrivalMinute: 20,
            readyMinute: 20,
        });
    });

    it('accepts a complete selected route without claiming global seller optimality', () => {
        const purchase = purchasePlan(2, {
            fulfillmentProof: 'seller-evidence-incomplete',
            totalFinalUnallocatedQuantity: null,
        });
        const selected = physicalRoute(2, 12);
        if (selected.kind !== 'planned') throw new Error('Expected a planned route');
        const route: FinishedRecipeShoppingRouteResult = {
            kind: 'planned',
            plan: {
                ...selected.plan,
                proof: 'best-known-feasible',
                evidenceProof: 'incomplete',
            },
        };

        expect(composeFinishedRecipeProductionReadiness(input({ purchase, route })))
            .toMatchObject({
                status: 'ready',
                readinessProof: 'exact',
                shoppingRouteProof: 'best-known-feasible',
                productionInputsReadyMinute: 12,
            });
    });

    it('keeps incomplete fulfillment unavailable instead of treating known purchases as ready', () => {
        const purchase = purchasePlan(2, {
            fulfillmentProof: 'seller-evidence-incomplete',
            totalFinalUnallocatedQuantity: null,
        });
        const route: FinishedRecipeShoppingRouteResult = {
            kind: 'not-planned',
            reason: 'purchase-demand-incomplete',
            proof: 'incomplete',
            evidenceGaps: [],
            visitedStates: 0,
            maximumStates: 100,
        };
        const result = composeFinishedRecipeProductionReadiness(input({ purchase, route }));

        expect(result).toMatchObject({
            status: 'unavailable',
            readinessProof: 'incomplete',
            productionInputsReadyMinute: null,
        });
        expect(result.gaps.map((gap) => gap.code)).toEqual([
            'shopping-route-not-planned',
            'purchase-fulfillment-incomplete',
        ]);
        expect(result.inputs[0]).toMatchObject({
            purchasedQuantity: 2,
            purchaseArrivalMinute: null,
            readyMinute: null,
            readinessProof: 'purchase-not-fulfilled',
        });
    });

    it('reports exact non-readiness when complete evidence has no feasible shopping route', () => {
        const route: FinishedRecipeShoppingRouteResult = {
            kind: 'not-planned',
            reason: 'no-known-feasible-route',
            proof: 'exact',
            evidenceGaps: [],
            visitedStates: 4,
            maximumStates: 100,
        };

        const result = composeFinishedRecipeProductionReadiness(input({ route }));

        expect(result).toMatchObject({
            status: 'not-ready',
            readinessProof: 'exact',
            shoppingRouteProof: 'exact-not-planned',
            productionInputsReadyMinute: null,
        });
    });

    it('keeps a search-limited missing route unavailable', () => {
        const route: FinishedRecipeShoppingRouteResult = {
            kind: 'not-planned',
            reason: 'search-limit-before-feasible-plan',
            proof: 'incomplete',
            evidenceGaps: [],
            visitedStates: 100,
            maximumStates: 100,
        };

        expect(composeFinishedRecipeProductionReadiness(input({ route }))).toMatchObject({
            status: 'unavailable',
            readinessProof: 'incomplete',
            shoppingRouteProof: 'incomplete-not-planned',
        });
    });

    it('rejects shopping evidence from another normalized dataset', () => {
        expect(() => composeFinishedRecipeProductionReadiness(input({
            shoppingDataset: {
                gameVersion: 'test',
                datasetSha256: 'b'.repeat(64),
            },
        }))).toThrow('Shopping evidence belongs to a different production dataset');
    });

    it('keeps readiness unavailable when incoming property transfers have no arrival time', () => {
        const result = composeFinishedRecipeProductionReadiness(input({
            transfer: transferPlan(1),
            purchase: purchasePlan(1),
            route: physicalRoute(1, 5),
        }));

        expect(result).toMatchObject({
            status: 'unavailable',
            readinessProof: 'incomplete',
            productionInputsReadyMinute: null,
        });
        expect(result.inputs[0]).toMatchObject({
            transferredQuantity: 1,
            transferArrivalMinute: null,
            purchasedQuantity: 1,
            purchaseArrivalMinute: 5,
            readyMinute: null,
            readinessProof: 'property-transfer-arrival-unavailable',
        });
        expect(result.gaps).toContainEqual({
            code: 'property-transfer-arrival-not-evaluated',
            itemId: 'soil',
            propertyId: 'lab',
            shoppingReason: null,
        });
    });

    it('makes transferred and purchased inputs ready at their later property arrival', () => {
        const transfer = transferPlan(1);
        const result = composeFinishedRecipeProductionReadiness(input({
            transfer,
            propertyTransferArrivals: transferArrivals(transfer, 9),
            purchase: purchasePlan(1),
            route: physicalRoute(1, 5),
        }));

        expect(result).toMatchObject({
            status: 'ready',
            readinessProof: 'exact',
            productionInputsReadyMinute: 9,
            gaps: [],
        });
        expect(result.inputs[0]).toMatchObject({
            transferredQuantity: 1,
            transferArrivalMinute: 9,
            purchasedQuantity: 1,
            purchaseArrivalMinute: 5,
            readyMinute: 9,
            readinessProof: 'exact',
        });
    });

    it('keeps readiness unavailable when selected transfer movement is not planned', () => {
        const transfer = transferPlan(1);
        const result = composeFinishedRecipeProductionReadiness(input({
            transfer,
            propertyTransferArrivals: unavailableTransferArrivals(transfer),
            purchase: purchasePlan(1),
            route: physicalRoute(1, 5),
        }));

        expect(result).toMatchObject({
            status: 'unavailable',
            readinessProof: 'incomplete',
            productionInputsReadyMinute: null,
        });
        expect(result.gaps).toContainEqual({
            code: 'property-transfer-arrival-not-planned',
            itemId: 'soil',
            propertyId: 'lab',
            shoppingReason: null,
        });
    });

    it('does not treat a route endpoint with no property mapping as production readiness', () => {
        const result = composeFinishedRecipeProductionReadiness(input({
            arrivalDestination: { kind: 'not-established' },
        }));

        expect(result).toMatchObject({
            status: 'unavailable',
            shoppingCompletionMinute: 12,
            productionInputsReadyMinute: null,
        });
        expect(result.inputs[0]).toMatchObject({
            purchaseArrivalMinute: 12,
            readyMinute: null,
            readinessProof: 'shopping-arrival-unavailable',
        });
        expect(result.gaps.map((gap) => gap.code)).toContain(
            'shopping-arrival-destination-not-established'
        );
    });

    it('keeps aggregate shopping quantities unavailable for multiple destination properties', () => {
        const purchase = multiPropertyPurchasePlan();
        const result = composeFinishedRecipeProductionReadiness(input({
            purchase,
            route: physicalRoute(3, 12),
        }));

        expect(result).toMatchObject({
            status: 'unavailable',
            productionInputsReadyMinute: null,
        });
        expect(result.inputs[0]).toMatchObject({
            purchasedQuantity: 2,
            readyMinute: null,
            readinessProof: 'shopping-arrival-unavailable',
        });
        expect(result.gaps).toContainEqual({
            code: 'purchase-allocation-by-property-unavailable',
            itemId: 'soil',
            propertyId: 'barn',
            shoppingReason: null,
        });
    });

    it('uses explicit property attribution for a multi-property shopping result', () => {
        const purchase = multiPropertyPurchasePlan();
        const route = physicalRoute(3, 12);
        if (route.kind !== 'planned') throw new Error('Expected a planned route');
        const propertyAttribution = attributeFinishedRecipeShoppingRouteToProperties({
            purchasePlan: purchase,
            routePlan: route.plan,
            evidence: {
                coverage: 'complete',
                assignments: [
                    shoppingPropertyAssignment('lab', 2, 12),
                    shoppingPropertyAssignment('barn', 1, 18),
                ],
            },
        });
        const result = composeFinishedRecipeProductionReadiness(input({
            purchase,
            route,
            propertyAttribution,
        }));

        expect(result).toMatchObject({
            status: 'ready',
            readinessProof: 'exact',
            productionInputsReadyMinute: 12,
            gaps: [],
        });
        expect(result.inputs[0]).toMatchObject({
            purchasedQuantity: 2,
            purchaseArrivalMinute: 12,
            readyMinute: 12,
        });
    });

    it('keeps one property unavailable when its shopping attribution is incomplete', () => {
        const purchase = multiPropertyPurchasePlan();
        const route = physicalRoute(3, 12);
        if (route.kind !== 'planned') throw new Error('Expected a planned route');
        const propertyAttribution = attributeFinishedRecipeShoppingRouteToProperties({
            purchasePlan: purchase,
            routePlan: route.plan,
            evidence: {
                coverage: 'partial',
                assignments: [
                    shoppingPropertyAssignment('lab', 1, 12),
                    shoppingPropertyAssignment('barn', 1, 18),
                ],
            },
        });
        const result = composeFinishedRecipeProductionReadiness(input({
            purchase,
            route,
            propertyAttribution,
        }));

        expect(result).toMatchObject({
            status: 'unavailable',
            readinessProof: 'incomplete',
            productionInputsReadyMinute: null,
        });
        expect(result.gaps).toContainEqual({
            code: 'shopping-property-attribution-incomplete',
            itemId: 'soil',
            propertyId: 'lab',
            shoppingReason: null,
        });
    });

    it('rejects a physical allocation that was not picked up by the route', () => {
        const route = physicalRoute(2, 12);
        if (route.kind !== 'planned') throw new Error('Expected a planned route');

        expect(() => composeFinishedRecipeProductionReadiness(input({
            route: { kind: 'planned', plan: { ...route.plan, trips: [] } },
        }))).toThrow('Physical shopping completion minute is inconsistent');
    });
});

describe('finished recipe elapsed lifecycle', () => {
    it('composes exact no-terminal production through a direct sale', () => {
        const result = composeFinishedRecipeElapsedLifecycle({
            readiness: input(),
            execution: productionExecution(15),
            sale: directSale(1, 18, 2),
        });

        expect(result).toMatchObject({
            status: 'complete',
            proof: 'exact',
            production: {
                startMinute: 15,
                modeledProcessMinutes: 0,
                terminalOperation: {
                    kind: 'none',
                    processedQuantity: 0,
                    remainderQuantity: 1,
                    gameMinutes: 0,
                },
                completionMinute: 15,
            },
            elapsed: {
                inputReadyToProductionStartMinutes: 3,
                productionMinutes: 0,
                productionCompletionToSaleStartMinutes: 3,
                saleMinutes: 2,
                inputReadyToSaleCompletionMinutes: 8,
            },
            gaps: [],
        });
    });

    it('includes selected drying in the modeled production clock', () => {
        const plan = withDrying(productionPlan(), 10);
        const result = composeFinishedRecipeElapsedLifecycle({
            readiness: input({ production: plan }),
            execution: productionExecution(12),
            sale: deliveredSale(1, 25, 3),
        });

        expect(result).toMatchObject({
            status: 'complete',
            production: {
                modeledProcessMinutes: 10,
                terminalOperation: { kind: 'none' },
                completionMinute: 22,
            },
            elapsed: {
                productionMinutes: 10,
                productionCompletionToSaleStartMinutes: 3,
                saleMinutes: 3,
                inputReadyToSaleCompletionMinutes: 16,
            },
        });
    });

    it('converts selected packaging employee seconds to game minutes', () => {
        const plan = withPackaging(productionPlan(), 5);
        const result = composeFinishedRecipeElapsedLifecycle({
            readiness: input({ production: plan }),
            execution: productionExecution(12),
            sale: directSale(1, 17, 1),
        });

        expect(result).toMatchObject({
            status: 'complete',
            production: {
                modeledProcessMinutes: 0,
                terminalOperation: {
                    kind: 'packaging',
                    processedQuantity: 1,
                    employeeRealSeconds: 5,
                    gameMinutes: 5,
                },
                totalElapsedMinutes: 5,
                completionMinute: 17,
            },
        });
    });

    it('converts selected brick-pressing employee seconds to game minutes', () => {
        const plan = withBrickPressing(productionPlan(), 20);
        const result = composeFinishedRecipeElapsedLifecycle({
            readiness: input({ production: plan }),
            execution: productionExecution(12),
            sale: deliveredSale(1, 32, 4),
        });

        expect(result).toMatchObject({
            status: 'complete',
            production: {
                terminalOperation: {
                    kind: 'brick-pressing',
                    processedQuantity: 1,
                    employeeRealSeconds: 20,
                    gameMinutes: 20,
                },
                completionMinute: 32,
            },
            sale: {
                kind: 'delivered',
                completionMinute: 36,
            },
        });
    });

    it('keeps missing execution and sale evidence incomplete', () => {
        const result = composeFinishedRecipeElapsedLifecycle({ readiness: input() });

        expect(result).toMatchObject({
            status: 'unavailable',
            proof: 'incomplete',
            production: {
                executionModel: 'not-established',
                completionMinute: null,
            },
            sale: null,
            elapsed: null,
            gaps: [
                { code: 'production-execution-not-established' },
                { code: 'sale-completion-not-established' },
            ],
        });
    });

    it('keeps partial production duration from becoming exact elapsed time', () => {
        const base = productionPlan();
        const partial: FinishedRecipeProductionPlan = {
            ...base,
            duration: {
                ...base.duration,
                mixingProcessMinutes: null,
                modeledTotalProcessMinutes: null,
            },
            evidence: { ...base.evidence, modeledDurationProof: 'partial' },
        };
        const result = composeFinishedRecipeElapsedLifecycle({
            readiness: input({ production: partial }),
            execution: productionExecution(12),
            sale: directSale(1, 12, 1),
        });

        expect(result).toMatchObject({
            status: 'unavailable',
            production: {
                modeledProcessMinutes: null,
                totalElapsedMinutes: null,
                completionMinute: null,
            },
            elapsed: null,
            gaps: [{ code: 'modeled-production-duration-incomplete' }],
        });
    });

    it('rejects unsupported concurrency, premature stages, and mismatched quantities', () => {
        expect(() => composeFinishedRecipeElapsedLifecycle({
            readiness: input(),
            execution: {
                startMinute: 12,
                executionModel: 'parallel' as never,
            },
            sale: directSale(1, 12, 1),
        })).toThrow('Finished recipe production execution model is invalid');

        expect(() => composeFinishedRecipeElapsedLifecycle({
            readiness: input(),
            execution: productionExecution(11),
            sale: directSale(1, 12, 1),
        })).toThrow('Finished recipe production starts before its inputs are ready');

        expect(() => composeFinishedRecipeElapsedLifecycle({
            readiness: input({ production: withDrying(productionPlan(), 10) }),
            execution: productionExecution(12),
            sale: directSale(1, 21, 1),
        })).toThrow('Finished recipe sale starts before production completion');

        expect(() => composeFinishedRecipeElapsedLifecycle({
            readiness: input(),
            execution: productionExecution(12),
            sale: directSale(2, 12, 1),
        })).toThrow('Finished recipe sale quantity does not match planned output');
    });
});

interface InputOverrides {
    readonly production?: FinishedRecipeProductionPlan;
    readonly transfer?: FinishedRecipePropertyTransferPlan;
    readonly propertyTransferArrivals?: FinishedRecipePropertyTransferArrivalResult;
    readonly purchase?: FinishedRecipePurchasePlan;
    readonly route?: FinishedRecipeShoppingRouteResult;
    readonly propertyAttribution?: FinishedRecipeShoppingPropertyAttributionResult;
    readonly shoppingDataset?: ProductionPlanDataset;
    readonly arrivalDestination?: FinishedRecipeProductionReadinessInput['shopping']['arrivalDestination'];
}

function input(overrides: InputOverrides = {}): FinishedRecipeProductionReadinessInput {
    return {
        propertyId: 'lab',
        productionPlan: overrides.production ?? productionPlan(),
        transferPlan: overrides.transfer ?? transferPlan(0),
        ...(overrides.propertyTransferArrivals === undefined
            ? {}
            : { propertyTransferArrivals: overrides.propertyTransferArrivals }),
        purchasePlan: overrides.purchase ?? purchasePlan(2),
        shopping: {
            dataset: overrides.shoppingDataset ?? dataset,
            arrivalDestination: overrides.arrivalDestination ?? {
                kind: 'production-property',
                propertyId: 'lab',
                evidence: 'caller-supplied-depot-and-remote-delivery-destination',
            },
            route: overrides.route ?? physicalRoute(2, 12),
            ...(overrides.propertyAttribution === undefined
                ? {}
                : { propertyAttribution: overrides.propertyAttribution }),
        },
    };
}

function shoppingPropertyAssignment(
    propertyId: string,
    quantity: number,
    arrivalMinute: number
) {
    return {
        shopCode: 'shop',
        itemId: 'soil',
        access: 'physical' as const,
        quantity,
        destination: {
            kind: 'property' as const,
            propertyId,
            arrivalMinute,
            evidence: 'caller-supplied-physical-property-arrival' as const,
        },
    };
}

function transferArrivals(
    transfer: FinishedRecipePropertyTransferPlan,
    completionMinute: number
): FinishedRecipePropertyTransferArrivalResult {
    const allocation = transfer.allocations[0];
    if (allocation === undefined) throw new Error('Expected one transfer allocation');
    return planFinishedRecipePropertyTransferArrivals({
        transferPlan: transfer,
        movementEvidence: {
            coverage: 'complete',
            maximumTripsPerAllocation: 100,
            assignments: [{
                candidateId: allocation.candidateId,
                itemId: allocation.itemId,
                sourcePropertyId: allocation.sourcePropertyId,
                destinationPropertyId: allocation.destinationPropertyId,
                movementModelId: 'test-player-carry',
                carryingCapacity: 10,
                itemLoadUnits: 1,
                startMinute: 0,
                loadMinutesPerTrip: 0,
                unloadMinutesPerTrip: 0,
                outboundLeg: {
                    legId: 'warehouse-lab',
                    sourcePropertyId: allocation.sourcePropertyId,
                    destinationPropertyId: allocation.destinationPropertyId,
                    distance: 1,
                    durationMinutes: completionMinute,
                },
                returnLeg: null,
            }],
        },
    });
}

function unavailableTransferArrivals(
    transfer: FinishedRecipePropertyTransferPlan
): FinishedRecipePropertyTransferArrivalResult {
    const allocation = transfer.allocations[0];
    if (allocation === undefined) throw new Error('Expected one transfer allocation');
    return planFinishedRecipePropertyTransferArrivals({
        transferPlan: transfer,
        movementEvidence: {
            coverage: 'partial',
            maximumTripsPerAllocation: 100,
            assignments: [{
                candidateId: allocation.candidateId,
                itemId: allocation.itemId,
                sourcePropertyId: allocation.sourcePropertyId,
                destinationPropertyId: allocation.destinationPropertyId,
                movementModelId: 'test-player-carry',
                carryingCapacity: 10,
                itemLoadUnits: 1,
                startMinute: 0,
                loadMinutesPerTrip: 0,
                unloadMinutesPerTrip: 0,
                outboundLeg: null,
                returnLeg: null,
            }],
        },
    });
}

function productionPlan(): FinishedRecipeProductionPlan {
    return {
        dataset,
        recipe: {
            ruleProfile: { kind: 'standard' },
            productId: 'product',
            ingredientIds: [],
            effectIds: [],
            productValue: 20,
            baseProductCost: 10,
            baseProductCostBasis: 'base-purchase-price',
            ingredientCost: 0,
            totalCost: 10,
            netValue: 10,
            ingredientCount: 0,
        },
        finishedQuantity: 1,
        baseProductPlan: {
            dataset,
            targetItemId: 'product',
            targetQuantity: 1,
            productionSteps: [],
            purchases: [],
            totalProcessMinutes: 0,
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
            requirements: [{
                itemId: 'soil',
                unitPurchasePrice: 10,
                currentQuantity: 0,
                material: {
                    requiredQuantity: 2,
                    purchaseQuantityBeforeInventory: 2,
                    stockAppliedQuantity: 0,
                    shortageQuantity: 2,
                    reorderQuantity: 2,
                    reorderCost: 20,
                },
                equipment: {
                    requiredQuantity: 0,
                    stockAppliedQuantity: 0,
                    shortageQuantity: 0,
                    reorderQuantity: 0,
                    reorderCost: 0,
                },
                shortageQuantity: 2,
                reorderQuantity: 2,
                reorderCost: 20,
                postReorderSurplusQuantity: 0,
                stacks: {
                    itemStackLimit: 20,
                    requiredStackCount: 1,
                    currentStackCount: 0,
                    reorderStackCount: 1,
                    postReorderStackCount: 1,
                    additionalStackCount: 1,
                    postReorderCapacity: 20,
                    unusedPostReorderCapacity: 18,
                },
            }],
            totalMaterialReorderCost: 20,
            totalEquipmentReorderCost: 0,
            totalReorderCost: 20,
            requiredStackCount: 1,
            currentStackCount: 0,
            reorderStackCount: 1,
            postReorderStackCount: 1,
            additionalStackCount: 1,
        },
        duration: {
            baseProductProcessMinutes: 0,
            mixingProcessMinutes: 0,
            dryingProcessMinutes: null,
            packagingEmployeeRealSeconds: null,
            brickPressingEmployeeRealSeconds: null,
            knownProcessMinutes: 0,
            modeledTotalProcessMinutes: 0,
        },
        cost: {
            recipeEstimatedUnitMaterialCost: 10,
            recipeEstimatedMaterialCost: 10,
            requiredMaterialCost: 0,
            materialReorderCost: 20,
            equipmentReorderCost: 0,
            combinedReorderCost: 20,
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

function productionExecution(startMinute: number) {
    return {
        startMinute,
        executionModel: 'caller-supplied-exclusive-sequential-execution' as const,
    };
}

function directSale(quantity: number, startMinute: number, travelDurationMinutes: number) {
    return {
        kind: 'direct' as const,
        sellerId: 'player',
        destinationId: 'customer',
        quantity,
        startMinute,
        travelDurationMinutes,
        completionMinute: startMinute + travelDurationMinutes,
        completionRule: 'caller-supplied-sale-confirmed-at-destination' as const,
    };
}

function deliveredSale(quantity: number, startMinute: number, deliveryDurationMinutes: number) {
    return {
        kind: 'delivered' as const,
        sellerId: 'dealer',
        destinationId: 'customer',
        quantity,
        startMinute,
        deliveryDurationMinutes,
        completionMinute: startMinute + deliveryDurationMinutes,
        completionRule: 'caller-supplied-delivery-confirmed-at-destination' as const,
    };
}

function withDrying(
    base: FinishedRecipeProductionPlan,
    totalProcessMinutes: number
): FinishedRecipeProductionPlan {
    return {
        ...base,
        dryingStep: {
            position: 'after-ordered-mixing',
            stationItemId: 'drying-rack',
            itemId: 'product',
            startingQuality: 'standard',
            targetQuality: 'premium',
            qualityTierCount: 1,
            capacityPerBatch: 1,
            batchQuantities: [1],
            inputQuantity: 1,
            outputQuantity: 1,
            averageTemperature: 20,
            processMultiplier: 1,
            baseMinutesPerTier: totalProcessMinutes,
            effectiveMinutesPerTier: totalProcessMinutes,
            minutesPerBatch: totalProcessMinutes,
            totalProcessMinutes,
        },
        duration: {
            ...base.duration,
            dryingProcessMinutes: totalProcessMinutes,
            knownProcessMinutes: totalProcessMinutes,
            modeledTotalProcessMinutes: totalProcessMinutes,
        },
        evidence: {
            ...base.evidence,
            modeledScope: 'base-product-ordered-mixing-and-selected-drying',
            dryingApplicability: 'selected',
        },
    };
}

function withPackaging(
    base: FinishedRecipeProductionPlan,
    totalEmployeeRealSeconds: number
): FinishedRecipeProductionPlan {
    const packagingStep: FinishedRecipePackagingStep = {
        position: 'after-optional-drying',
        stationItemId: 'packaging-station',
        stationKind: 'packaging',
        productItemId: 'product',
        packagingItemId: 'bag',
        inputProductState: 'unpackaged',
        outputProductState: 'packaged',
        inputProductQuantity: 1,
        productQuantityPerPackage: 1,
        packageCount: 1,
        packagedProductQuantity: 1,
        unpackagedRemainderQuantity: 0,
        packagingMaterialQuantity: 1,
        outputSlotCapacityPackages: 20,
        outputBatchPackageCounts: [1],
        employeeBaseSecondsPerPackage: totalEmployeeRealSeconds,
        employeePackagingSpeedMultiplier: 1,
        stationEmployeeSpeedMultiplier: 1,
        employeeCurrentWorkSpeed: 1,
        employeeSecondsPerPackage: totalEmployeeRealSeconds,
        totalEmployeeRealSeconds,
    };
    return {
        ...base,
        packagingStep,
        duration: {
            ...base.duration,
            packagingEmployeeRealSeconds: totalEmployeeRealSeconds,
        },
        evidence: {
            ...base.evidence,
            modeledScope: 'base-product-ordered-mixing-and-selected-packaging',
            packagingApplicability: 'selected',
        },
    };
}

function withBrickPressing(
    base: FinishedRecipeProductionPlan,
    totalEmployeeRealSeconds: number
): FinishedRecipeProductionPlan {
    const brickPressingStep: FinishedRecipeBrickPressingStep = {
        position: 'after-optional-drying',
        stationItemId: 'brick-press',
        stationKind: 'brick-press',
        productItemId: 'product',
        outputPackagingItemId: 'brick',
        inputProductState: 'unpackaged',
        outputProductState: 'packaged',
        inputProductQuantity: 1,
        productQuantityPerBrick: 1,
        brickCount: 1,
        pressedProductQuantity: 1,
        unpackagedRemainderQuantity: 0,
        packagingMaterialConsumption: 'none',
        outputSlotCapacityBricks: 20,
        outputBatchBrickCounts: [1],
        employeeBaseSecondsPerBrick: totalEmployeeRealSeconds,
        employeeCompletionOverheadSecondsPerBrick: 0,
        employeePackagingSpeedMultiplier: 1,
        employeeCurrentWorkSpeed: 1,
        employeeSecondsPerBrick: totalEmployeeRealSeconds,
        totalEmployeeRealSeconds,
        manualDuration: 'interactive-not-fixed',
    };
    return {
        ...base,
        brickPressingStep,
        duration: {
            ...base.duration,
            brickPressingEmployeeRealSeconds: totalEmployeeRealSeconds,
        },
        evidence: {
            ...base.evidence,
            modeledScope: 'base-product-ordered-mixing-and-selected-brick-pressing',
            brickPressingApplicability: 'selected',
        },
    };
}

function transferPlan(allocatedQuantity: number): FinishedRecipePropertyTransferPlan {
    const residual = 2 - allocatedQuantity;
    return {
        objective: 'maximize-transferred-reorder-quantity-per-item',
        tieBreak: 'canonical-item-source-destination-candidate-identity-order',
        routeOptimization: 'not-evaluated',
        demandProof: 'exact',
        transferEvidenceProof: 'exact',
        allocationProof: 'maximum',
        residualProof: 'exact',
        residualCostProof: 'exact',
        requirements: [{
            propertyId: 'lab',
            itemId: 'soil',
            unitPurchasePrice: 10,
            materialReorderQuantity: 2,
            equipmentReorderQuantity: 0,
            requestedReorderQuantity: 2,
            allocatedQuantity,
            allocatedEquipmentQuantity: 0,
            allocatedMaterialQuantity: allocatedQuantity,
            unallocatedEquipmentQuantity: 0,
            unallocatedMaterialQuantity: residual,
            unallocatedReorderQuantity: residual,
            residualEquipmentReorderQuantity: 0,
            residualMaterialReorderQuantity: residual,
            residualReorderQuantity: residual,
            residualEquipmentReorderCost: 0,
            residualMaterialReorderCost: residual * 10,
            residualReorderCost: residual * 10,
        }],
        sources: [],
        allocations: allocatedQuantity === 0 ? [] : [{
            candidateId: 'warehouse-lab',
            itemId: 'soil',
            sourcePropertyId: 'warehouse',
            destinationPropertyId: 'lab',
            quantity: allocatedQuantity,
            itemStackLimit: 20,
            stackCount: 1,
        }],
        totalRequestedReorderQuantity: 2,
        knownAllocatedQuantity: allocatedQuantity,
        unallocatedAfterKnownTransfersQuantity: residual,
        totalResidualReorderQuantity: residual,
        totalResidualMaterialReorderCost: residual * 10,
        totalResidualEquipmentReorderCost: 0,
        totalResidualReorderCost: residual * 10,
    };
}

interface PurchaseOverrides {
    readonly fulfillmentProof?: FinishedRecipePurchasePlan['fulfillmentProof'];
    readonly totalFinalUnallocatedQuantity?: number | null;
}

function purchasePlan(
    quantity: number,
    overrides: PurchaseOverrides = {}
): FinishedRecipePurchasePlan {
    const finalUnallocated = overrides.totalFinalUnallocatedQuantity === undefined
        ? 0
        : overrides.totalFinalUnallocatedQuantity;
    return {
        objective: 'maximize-supported-fulfillment-then-minimize-cost-per-item',
        tieBreak: 'unit-price-then-shop-code',
        routeOptimization: 'not-evaluated',
        timingProof: 'not-evaluated',
        demandProof: 'exact',
        sellerEvidenceProof: overrides.fulfillmentProof === 'seller-evidence-incomplete'
            ? 'incomplete'
            : 'exact',
        allocationProof: overrides.fulfillmentProof === 'seller-evidence-incomplete'
            ? 'minimum-cost-among-supported-sellers'
            : 'minimum-cost',
        fulfillmentProof: overrides.fulfillmentProof ?? 'exact',
        requirements: [{
            propertyId: 'lab',
            itemId: 'soil',
            materialQuantity: quantity,
            equipmentQuantity: 0,
            requestedQuantity: quantity,
        }],
        items: [{
            itemId: 'soil',
            requiredRank: null,
            itemEligibility: 'eligible',
            materialQuantity: quantity,
            equipmentQuantity: 0,
            requestedQuantity: quantity,
            sellerEvidenceProof: 'exact',
            allocationProof: 'minimum-cost',
            sellerOptions: [],
            allocations: [],
            knownAllocatedQuantity: finalUnallocated === 0 ? quantity : 0,
            unallocatedAfterSupportedPurchases: finalUnallocated ?? quantity,
            finalUnallocatedQuantity: finalUnallocated,
            knownAllocatedCost: finalUnallocated === 0 ? quantity * 10 : 0,
            minimumRequiredPurchaseCost: finalUnallocated === 0 ? quantity * 10 : null,
        }],
        allocations: [],
        totalRequestedQuantity: quantity,
        knownAllocatedQuantity: finalUnallocated === 0 ? quantity : 0,
        unallocatedAfterSupportedPurchases: finalUnallocated ?? quantity,
        totalFinalUnallocatedQuantity: finalUnallocated,
        knownAllocatedCost: finalUnallocated === 0 ? quantity * 10 : 0,
        minimumRequiredPurchaseCost: finalUnallocated === 0 ? quantity * 10 : null,
    };
}

function multiPropertyPurchasePlan(): FinishedRecipePurchasePlan {
    const base = purchasePlan(2);
    return {
        ...base,
        requirements: [
            ...base.requirements,
            {
                propertyId: 'barn',
                itemId: 'soil',
                materialQuantity: 1,
                equipmentQuantity: 0,
                requestedQuantity: 1,
            },
        ],
        items: base.items.map((item) => ({
            ...item,
            materialQuantity: 3,
            requestedQuantity: 3,
        })),
        totalRequestedQuantity: 3,
        knownAllocatedQuantity: 3,
    };
}

function physicalRoute(quantity: number, completionMinute: number): FinishedRecipeShoppingRouteResult {
    const allocation = shoppingAllocation('physical', quantity);
    return plannedRoute({
        allocation,
        physicalCompletionMinute: completionMinute,
        remoteCompletionMinute: 0,
        completionMinute,
        trips: [{
            tripIndex: 0,
            startMinute: 0,
            endMinute: completionMinute,
            elapsedMinutes: completionMinute,
            travelDistance: 2,
            peakCarriedLoadUnits: quantity,
            visits: [{
                shopCode: 'shop',
                leg: leg('out', 'depot', 'shop'),
                arrivalMinute: 1,
                waitingMinutes: 0,
                serviceStartMinute: 1,
                departureMinute: 1,
                pickedUp: [{ itemId: 'soil', quantity, loadUnits: quantity }],
                carriedLoadUnitsAfterVisit: quantity,
            }],
            returnLeg: leg('back', 'shop', 'depot'),
        }],
        remoteDeliveries: [],
    });
}

function remoteRoute(quantity: number, completionMinute: number): FinishedRecipeShoppingRouteResult {
    const allocation = shoppingAllocation('remote-delivery', quantity);
    return plannedRoute({
        allocation,
        physicalCompletionMinute: 0,
        remoteCompletionMinute: completionMinute,
        completionMinute,
        trips: [],
        remoteDeliveries: [{
            shopCode: 'shop',
            completionMinute,
            allocations: [allocation],
        }],
    });
}

interface PlannedRouteParts {
    readonly allocation: FinishedRecipeShoppingAllocation;
    readonly physicalCompletionMinute: number;
    readonly remoteCompletionMinute: number;
    readonly completionMinute: number;
    readonly trips: Extract<FinishedRecipeShoppingRouteResult, { kind: 'planned' }>['plan']['trips'];
    readonly remoteDeliveries: Extract<FinishedRecipeShoppingRouteResult, { kind: 'planned' }>['plan']['remoteDeliveries'];
}

function plannedRoute(parts: PlannedRouteParts): FinishedRecipeShoppingRouteResult {
    return {
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
            maximumStates: 100,
            allocations: [parts.allocation],
            trips: parts.trips,
            remoteDeliveries: parts.remoteDeliveries,
            totalPurchaseCost: parts.allocation.totalPrice,
            totalTravelDistance: parts.trips.reduce((total, trip) => total + trip.travelDistance, 0),
            physicalCompletionMinute: parts.physicalCompletionMinute,
            remoteCompletionMinute: parts.remoteCompletionMinute,
            completionMinute: parts.completionMinute,
            elapsedMinutes: parts.completionMinute,
        },
    };
}

function shoppingAllocation(
    access: FinishedRecipeShoppingAllocation['access'],
    quantity: number
): FinishedRecipeShoppingAllocation {
    return {
        shopCode: 'shop',
        itemId: 'soil',
        access,
        quantity,
        unitPrice: 10,
        totalPrice: quantity * 10,
    };
}

function leg(legId: string, fromLocationId: string, toLocationId: string) {
    return { legId, fromLocationId, toLocationId, distance: 1, durationMinutes: 1 };
}
