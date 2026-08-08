import { createHash } from 'node:crypto';

import {
    canonicalJson,
    CustomerAllocationOptimizer,
    type CustomerAllocationResourceLimit,
    type CustomerAllocationResult,
    type CustomerRecommendation,
} from '@neonschedule1/core';

export interface CustomerRecommendationSet {
    readonly customerId: string;
    readonly recommendations: readonly CustomerRecommendation[];
}

export interface CustomerRecommendationStock {
    readonly resourceId: string;
    readonly quantity: number;
}

export interface CustomerRecommendationAllocationInput {
    readonly datasetSha256: string;
    readonly recommendationSets: readonly CustomerRecommendationSet[];
    readonly maximumProductionCost: number;
    readonly stock?: readonly CustomerRecommendationStock[];
    readonly maximumStates: number;
}

export interface ResolvedCustomerAllocation {
    readonly customerId: string;
    readonly optionId: string;
    readonly stockResourceId: string;
    readonly recommendation: CustomerRecommendation;
}

export interface CustomerRecommendationAllocationResult {
    readonly result: CustomerAllocationResult;
    readonly allocations: readonly ResolvedCustomerAllocation[];
}

interface IndexedRecommendation {
    readonly customerId: string;
    readonly optionId: string;
    readonly stockResourceId: string;
    readonly recommendation: CustomerRecommendation;
}

const sha256Pattern = /^[a-f0-9]{64}$/u;

export class CustomerRecommendationAllocator {
    readonly #optimizer = new CustomerAllocationOptimizer();

    allocate(
        input: CustomerRecommendationAllocationInput
    ): CustomerRecommendationAllocationResult {
        assertCustomerAllocationDatasetIdentity(input.datasetSha256);
        const customerIds = uniqueCustomerIds(input.recommendationSets);
        const indexed = input.recommendationSets.flatMap(({ customerId, recommendations }) =>
            recommendations.map((recommendation) => indexRecommendation(
                input.datasetSha256,
                customerId,
                recommendation
            ))
        );
        const byOptionId = new Map(indexed.map((entry) => [entry.optionId, entry]));
        if (byOptionId.size !== indexed.length) {
            throw new Error('Customer recommendations contain duplicate allocation options');
        }
        const hasStock = input.stock !== undefined;
        const resourceLimits = hasStock
            ? customerRecommendationStockLimits(
                  input.stock,
                  indexed.map(({ stockResourceId }) => stockResourceId)
              )
            : [];
        const result = this.#optimizer.optimize({
            customerIds,
            options: indexed.map((entry) => ({
                optionId: entry.optionId,
                customerId: entry.customerId,
                productionCost: entry.recommendation.productionCost,
                expectedProfit: entry.recommendation.expectedProfit,
                resourceUsage: hasStock
                    ? [{
                          resourceId: entry.stockResourceId,
                          quantity: entry.recommendation.quantity,
                      }]
                    : [],
            })),
            maximumProductionCost: input.maximumProductionCost,
            resourceLimits,
            maximumStates: input.maximumStates,
        });

        return {
            result,
            allocations: result.allocations.map(({ customerId, optionId }) => {
                const entry = byOptionId.get(optionId);
                if (entry === undefined || entry.customerId !== customerId) {
                    throw new Error(`Allocation option ${JSON.stringify(optionId)} cannot be resolved`);
                }
                return entry;
            }),
        };
    }
}

export function customerRecommendationStockResourceId(
    datasetSha256: string,
    recommendation: CustomerRecommendation
): string {
    assertCustomerAllocationDatasetIdentity(datasetSha256);
    return `mix:${digest({
        datasetSha256,
        quality: recommendation.quality,
        productId: recommendation.recipe.productId,
        ingredientIds: recommendation.recipe.ingredientIds,
    })}`;
}

export function customerRecommendationAllocationOptionId(
    datasetSha256: string,
    customerId: string,
    recommendation: CustomerRecommendation
): string {
    assertCustomerAllocationDatasetIdentity(datasetSha256);
    requireId(customerId, 'Customer');
    const stockResourceId = customerRecommendationStockResourceId(datasetSha256, recommendation);
    return `offer:${digest({
        customerId,
        stockResourceId,
        quantity: recommendation.quantity,
        askingPrice: recommendation.askingPrice,
        productionCost: recommendation.productionCost,
        expectedProfit: recommendation.expectedProfit,
    })}`;
}

function indexRecommendation(
    datasetSha256: string,
    customerId: string,
    recommendation: CustomerRecommendation
): IndexedRecommendation {
    requireId(customerId, 'Customer');
    const stockResourceId = customerRecommendationStockResourceId(
        datasetSha256,
        recommendation
    );
    return {
        customerId,
        stockResourceId,
        optionId: customerRecommendationAllocationOptionId(
            datasetSha256,
            customerId,
            recommendation
        ),
        recommendation,
    };
}

export function customerRecommendationStockLimits(
    entries: readonly CustomerRecommendationStock[],
    knownResourceIdsInput: Iterable<string>
): CustomerAllocationResourceLimit[] {
    const knownResourceIds = new Set(knownResourceIdsInput);
    const result = new Map<string, number>();
    for (const entry of entries) {
        requireId(entry.resourceId, 'Stock resource');
        if (!knownResourceIds.has(entry.resourceId)) {
            throw new Error(`Unknown recommendation stock resource ${JSON.stringify(entry.resourceId)}`);
        }
        if (!Number.isSafeInteger(entry.quantity) || entry.quantity < 0) {
            throw new Error(
                `Stock resource ${JSON.stringify(entry.resourceId)} quantity must be a non-negative safe integer`
            );
        }
        if (result.has(entry.resourceId)) {
            throw new Error(`Duplicate recommendation stock resource ${JSON.stringify(entry.resourceId)}`);
        }
        result.set(entry.resourceId, entry.quantity);
    }
    return [...knownResourceIds]
        .sort()
        .map((resourceId) => ({ resourceId, quantity: result.get(resourceId) ?? 0 }));
}

function uniqueCustomerIds(sets: readonly CustomerRecommendationSet[]): string[] {
    const result = new Set<string>();
    for (const { customerId } of sets) {
        requireId(customerId, 'Customer');
        if (result.has(customerId)) {
            throw new Error(`Duplicate customer recommendation set ${JSON.stringify(customerId)}`);
        }
        result.add(customerId);
    }
    return [...result].sort();
}

function digest(value: unknown): string {
    return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export function assertCustomerAllocationDatasetIdentity(value: string): void {
    if (!sha256Pattern.test(value)) {
        throw new Error('Customer allocation dataset identity must be a lowercase SHA-256');
    }
}

function requireId(value: string, label: string): void {
    if (value.trim().length === 0) throw new Error(`${label} ID must not be blank`);
}
