import os from 'node:os';
import { performance } from 'node:perf_hooks';

import {
    canonicalJson,
    CustomerRecipeSearch,
    MixingEngine,
    RecipeSearchLimitError,
    RecipeSearchWorkLimitError,
    type Customer,
    type CustomerAllocationEvidence,
    type CustomerRecommendation,
} from '@neonschedule1/core';

import {
    CustomerRecommendationAllocator,
    customerRecommendationStockResourceId,
    type CustomerRecommendationSet,
} from '#solver/customer-allocation';
import type { SolverDataset } from '#solver/dataset';

export type AllocationBenchmarkStockMode = 'production-only' | 'one-per-mix';

export interface AllocationBenchmarkOptions {
    readonly customerCounts: readonly number[];
    readonly productionBudgetFractions: readonly number[];
    readonly stockModes: readonly AllocationBenchmarkStockMode[];
    readonly iterations: number;
    readonly warmups: number;
    readonly maxIngredients: number;
    readonly recommendationLimit: number;
    readonly recipeMaxStates: number;
    readonly maximumOptionProductionCost: number;
    readonly allocationMaxStates: number;
}

export interface AllocationBenchmarkSample {
    readonly durationMs: number;
    readonly status: 'exact' | 'state-limit';
    readonly allocationCount: number;
    readonly productionCost: number;
    readonly expectedProfit: number;
    readonly evidence: CustomerAllocationEvidence;
}

export interface AllocationBenchmarkCase {
    readonly id: string;
    readonly customerCount: number;
    readonly customerIds: readonly string[];
    readonly optionCount: number;
    readonly productionBudgetFraction: number;
    readonly maximumProductionCost: number;
    readonly stockMode: AllocationBenchmarkStockMode;
    readonly warmupSamples: readonly AllocationBenchmarkSample[];
    readonly samples: readonly AllocationBenchmarkSample[];
    readonly duration: {
        readonly minimumMs: number;
        readonly medianMs: number;
        readonly maximumMs: number;
    };
}

export interface AllocationBenchmarkReport {
    readonly schema: 'neonschedule1-allocation-benchmark-1';
    readonly createdAt: string;
    readonly dataset: {
        readonly gameVersion: string;
        readonly datasetSha256: string;
        readonly normalizerVersion: string;
    };
    readonly machine: {
        readonly nodeVersion: string;
        readonly cpuModels: readonly string[];
        readonly logicalCpuCount: number;
        readonly totalMemoryBytes: number;
    };
    readonly configuration: AllocationBenchmarkOptions;
    readonly recommendationGeneration: {
        readonly customerIds: readonly string[];
        readonly productIds: readonly string[];
        readonly ingredientIds: readonly string[];
        readonly durationMs: number;
        readonly optionCount: number;
    };
    readonly cases: readonly AllocationBenchmarkCase[];
}

export function defaultAllocationBenchmarkOptions(): AllocationBenchmarkOptions {
    return {
        customerCounts: [5, 10, 20],
        productionBudgetFractions: [0.5, 1],
        stockModes: ['production-only', 'one-per-mix'],
        iterations: 3,
        warmups: 1,
        maxIngredients: 2,
        recommendationLimit: 5,
        recipeMaxStates: 100_000,
        maximumOptionProductionCost: 100,
        allocationMaxStates: 1_000_000,
    };
}

export function runAllocationBenchmark(
    dataset: SolverDataset,
    options: AllocationBenchmarkOptions,
    onCaseCompleted: (completed: number, total: number, result: AllocationBenchmarkCase) => void =
        () => undefined
): AllocationBenchmarkReport {
    validateOptions(options, dataset.customers.length);
    const selections = new Map(
        options.customerCounts.map((count) => [count, selectCustomers(dataset.customers, count)])
    );
    const selectedCustomers = uniqueCustomers([...selections.values()].flat());
    const productIds = dataset.items
        .filter((item) => item.product !== null && !item.isRuntimeOnly)
        .map((item) => item.id)
        .sort();
    const ingredientIds = dataset.items
        .filter((item) =>
            item.mixingIngredient !== null &&
            item.basePurchasePrice !== null &&
            !item.isRuntimeOnly
        )
        .map((item) => item.id)
        .sort();
    if (productIds.length === 0 || ingredientIds.length === 0) {
        throw new Error('Allocation benchmark requires products and mixing ingredients');
    }

    const generatedAt = performance.now();
    const recommendationSets = generateRecommendations(
        dataset,
        selectedCustomers,
        productIds,
        ingredientIds,
        options
    );
    const generationDurationMs = milliseconds(performance.now() - generatedAt);
    const recommendationsByCustomer = new Map(
        recommendationSets.map((set) => [set.customerId, set])
    );
    const allocator = new CustomerRecommendationAllocator();
    const totalCases = options.customerCounts.length *
        options.productionBudgetFractions.length *
        options.stockModes.length;
    let completed = 0;
    const cases: AllocationBenchmarkCase[] = [];

    for (const customerCount of options.customerCounts) {
        const customers = selections.get(customerCount)!;
        const sets = customers.map((customer) => recommendationsByCustomer.get(customer.id)!);
        const referenceCost = sets.reduce(
            (total, set) => total + requireRecommendation(set).productionCost,
            0
        );
        for (const productionBudgetFraction of options.productionBudgetFractions) {
            const maximumProductionCost = referenceCost * productionBudgetFraction;
            for (const stockMode of options.stockModes) {
                const execute = () => measure(() => allocator.allocate({
                    datasetSha256: dataset.manifest.datasetSha256,
                    recommendationSets: sets,
                    maximumProductionCost,
                    ...(stockMode === 'production-only'
                        ? {}
                        : { stock: onePerMix(dataset.manifest.datasetSha256, sets) }),
                    maximumStates: options.allocationMaxStates,
                }));
                const warmupSamples = Array.from({ length: options.warmups }, execute);
                const samples = Array.from({ length: options.iterations }, execute);
                requireDeterministicSamples([...warmupSamples, ...samples]);
                const durations = samples.map(({ durationMs }) => durationMs).sort(numberOrder);
                const result: AllocationBenchmarkCase = {
                    id: `${customerCount}:${productionBudgetFraction}:${stockMode}`,
                    customerCount,
                    customerIds: customers.map(({ id }) => id),
                    optionCount: sets.reduce(
                        (total, set) => total + set.recommendations.length,
                        0
                    ),
                    productionBudgetFraction,
                    maximumProductionCost,
                    stockMode,
                    warmupSamples,
                    samples,
                    duration: {
                        minimumMs: durations[0]!,
                        medianMs: median(durations),
                        maximumMs: durations.at(-1)!,
                    },
                };
                cases.push(result);
                onCaseCompleted(++completed, totalCases, result);
            }
        }
    }

    return {
        schema: 'neonschedule1-allocation-benchmark-1',
        createdAt: new Date().toISOString(),
        dataset: {
            gameVersion: dataset.manifest.gameVersion,
            datasetSha256: dataset.manifest.datasetSha256,
            normalizerVersion: dataset.manifest.normalizerVersion,
        },
        machine: {
            nodeVersion: process.version,
            cpuModels: [...new Set(os.cpus().map(({ model }) => model))].sort(),
            logicalCpuCount: os.cpus().length,
            totalMemoryBytes: os.totalmem(),
        },
        configuration: options,
        recommendationGeneration: {
            customerIds: selectedCustomers.map(({ id }) => id),
            productIds,
            ingredientIds,
            durationMs: generationDurationMs,
            optionCount: recommendationSets.reduce(
                (total, set) => total + set.recommendations.length,
                0
            ),
        },
        cases,
    };
}

function generateRecommendations(
    dataset: SolverDataset,
    customers: readonly Customer[],
    productIds: readonly string[],
    ingredientIds: readonly string[],
    options: AllocationBenchmarkOptions
): CustomerRecommendationSet[] {
    const itemsById = new Map(dataset.items.map((item) => [item.id, item]));
    const effectsById = new Map(dataset.effects.map((effect) => [effect.id, effect]));
    const search = new CustomerRecipeSearch(
        new MixingEngine(dataset.mixingRules, effectsById),
        itemsById,
        dataset.customerCatalog,
        { maxStates: options.recipeMaxStates }
    );
    return customers.map((customer) => {
        try {
            const result = search.search({
                productIds,
                availableIngredientIds: ingredientIds,
                maxIngredients: options.maxIngredients,
                profile: customer,
                state: {
                    addiction: customer.baseAddiction,
                    relationship: 0,
                    orderLimitMultiplier: 1,
                },
                quality: 'Standard',
                quantity: 1,
                priceMultiplier: 1,
                maximumProductionCost: options.maximumOptionProductionCost,
                limit: options.recommendationLimit,
            });
            if (result.recommendations.length === 0) {
                throw new Error(`No allocation recommendations for customer ${JSON.stringify(customer.id)}`);
            }
            return { customerId: customer.id, recommendations: result.recommendations };
        } catch (error) {
            if (error instanceof RecipeSearchLimitError || error instanceof RecipeSearchWorkLimitError) {
                throw new Error(
                    `Recommendation search did not complete for customer ${JSON.stringify(customer.id)}`,
                    { cause: error }
                );
            }
            throw error;
        }
    });
}

function onePerMix(
    datasetSha256: string,
    sets: readonly CustomerRecommendationSet[]
): { readonly resourceId: string; readonly quantity: number }[] {
    return [...new Set(sets.flatMap(({ recommendations }) =>
        recommendations.map((recommendation) =>
            customerRecommendationStockResourceId(datasetSha256, recommendation)
        )
    ))].sort().map((resourceId) => ({ resourceId, quantity: 1 }));
}

function measure(
    operation: () => ReturnType<CustomerRecommendationAllocator['allocate']>
): AllocationBenchmarkSample {
    const startedAt = performance.now();
    const allocation = operation();
    return {
        durationMs: milliseconds(performance.now() - startedAt),
        status: allocation.result.status,
        allocationCount: allocation.result.allocations.length,
        productionCost: allocation.result.productionCost,
        expectedProfit: allocation.result.expectedProfit,
        evidence: allocation.result.evidence,
    };
}

function selectCustomers(customers: readonly Customer[], count: number): Customer[] {
    const ordered = [...customers].sort((left, right) =>
        weeklySpendMidpoint(left) - weeklySpendMidpoint(right) ||
        left.id.localeCompare(right.id)
    );
    if (count === 1) return [ordered[Math.floor((ordered.length - 1) / 2)]!];
    return Array.from({ length: count }, (_, index) =>
        ordered[Math.round(index * (ordered.length - 1) / (count - 1))]!
    );
}

function uniqueCustomers(customers: readonly Customer[]): Customer[] {
    return [...new Map(customers.map((customer) => [customer.id, customer])).values()]
        .sort((left, right) => left.id.localeCompare(right.id));
}

function weeklySpendMidpoint(customer: Customer): number {
    return (customer.weeklySpend.minimum + customer.weeklySpend.maximum) / 2;
}

function requireRecommendation(set: CustomerRecommendationSet): CustomerRecommendation {
    const recommendation = set.recommendations[0];
    if (recommendation === undefined) {
        throw new Error(`No recommendation for customer ${JSON.stringify(set.customerId)}`);
    }
    return recommendation;
}

function requireDeterministicSamples(samples: readonly AllocationBenchmarkSample[]): void {
    const [first, ...rest] = samples;
    if (first === undefined) return;
    const expected = canonicalJson({ ...first, durationMs: 0 });
    if (rest.some((sample) => canonicalJson({ ...sample, durationMs: 0 }) !== expected)) {
        throw new Error('Allocation benchmark produced non-deterministic results');
    }
}

function validateOptions(options: AllocationBenchmarkOptions, customerCount: number): void {
    requireUniquePositiveIntegers(options.customerCounts, 'customer counts');
    if (options.customerCounts.some((count) => count > customerCount)) {
        throw new Error(`Allocation benchmark has only ${customerCount} customers`);
    }
    requireUniquePositiveNumbers(options.productionBudgetFractions, 'production budget fractions');
    if (
        options.stockModes.length === 0 ||
        new Set(options.stockModes).size !== options.stockModes.length ||
        options.stockModes.some(
            (mode) => mode !== 'production-only' && mode !== 'one-per-mix'
        )
    ) {
        throw new Error('Allocation benchmark stock modes must be unique and non-empty');
    }
    requireNonNegativeInteger(options.warmups, 'Allocation benchmark warmups');
    for (const [value, label] of [
        [options.iterations, 'iterations'],
        [options.maxIngredients, 'maximum ingredients'],
        [options.recommendationLimit, 'recommendation limit'],
        [options.recipeMaxStates, 'recipe states'],
        [options.allocationMaxStates, 'allocation states'],
    ] as const) requirePositiveInteger(value, `Allocation benchmark ${label}`);
    if (!Number.isFinite(options.maximumOptionProductionCost) ||
        options.maximumOptionProductionCost < 0) {
        throw new Error('Allocation benchmark option production cost must be non-negative');
    }
}

function requireUniquePositiveIntegers(values: readonly number[], label: string): void {
    if (values.length === 0 || new Set(values).size !== values.length ||
        values.some((value) => !Number.isSafeInteger(value) || value < 1)) {
        throw new Error(`Allocation benchmark ${label} must be unique positive integers`);
    }
}

function requireUniquePositiveNumbers(values: readonly number[], label: string): void {
    if (values.length === 0 || new Set(values).size !== values.length ||
        values.some((value) => !Number.isFinite(value) || value <= 0)) {
        throw new Error(`Allocation benchmark ${label} must be unique positive numbers`);
    }
}

function requirePositiveInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be positive`);
}

function requireNonNegativeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be non-negative`);
}

function median(sorted: readonly number[]): number {
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? milliseconds((sorted[middle - 1]! + sorted[middle]!) / 2)
        : sorted[middle]!;
}

function numberOrder(left: number, right: number): number {
    return left - right;
}

function milliseconds(value: number): number {
    return Math.round(value * 1_000) / 1_000;
}
