import os from 'node:os';
import { performance } from 'node:perf_hooks';

import {
    canonicalJson,
    logicalDealerProfiles,
    type DealerCustomerAllocationEvidence,
} from '@neonschedule1/core';

import {
    generateAllocationBenchmarkRecommendations,
    onePerMixAllocationBenchmarkStock,
    requireAllocationBenchmarkRecommendation,
    selectAllocationBenchmarkCustomers,
    uniqueAllocationBenchmarkCustomers,
    type AllocationBenchmarkStockMode,
} from '#solver/allocation-benchmark';
import { CustomerRecommendationDealerAllocator } from '#solver/customer-dealer-allocation';
import type { SolverDataset } from '#solver/dataset';

export type JointAllocationSigningFeeState = 'paid' | 'unpaid';

export interface JointAllocationBenchmarkScenario {
    readonly id: string;
    readonly customerCount: number;
    readonly dealerCount: number;
    readonly signingFeeState: JointAllocationSigningFeeState;
    readonly productionBudgetFraction: number;
    readonly stockMode: AllocationBenchmarkStockMode;
}

export interface JointAllocationBenchmarkOptions {
    readonly scenarios: readonly JointAllocationBenchmarkScenario[];
    readonly iterations: number;
    readonly warmups: number;
    readonly maxIngredients: number;
    readonly recommendationLimit: number;
    readonly recipeMaxStates: number;
    readonly maximumOptionProductionCost: number;
    readonly maximumDealerSubsets: number;
    readonly maximumStatesPerDealerSubset: number;
}

export interface JointAllocationBenchmarkSample {
    readonly durationMs: number;
    readonly status: 'exact' | 'incomplete';
    readonly allocationCount: number;
    readonly productionCost: number;
    readonly expectedProfit: number;
    readonly evidence: DealerCustomerAllocationEvidence;
}

export interface JointAllocationBenchmarkCase extends JointAllocationBenchmarkScenario {
    readonly customerIds: readonly string[];
    readonly dealerIds: readonly string[];
    readonly optionCount: number;
    readonly maximumProductionCost: number;
    readonly warmupSamples: readonly JointAllocationBenchmarkSample[];
    readonly samples: readonly JointAllocationBenchmarkSample[];
    readonly duration: {
        readonly minimumMs: number;
        readonly medianMs: number;
        readonly maximumMs: number;
    };
}

export interface JointAllocationBenchmarkReport {
    readonly schema: 'neonschedule1-joint-allocation-benchmark-1';
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
    readonly configuration: JointAllocationBenchmarkOptions;
    readonly recommendationGeneration: {
        readonly customerIds: readonly string[];
        readonly productIds: readonly string[];
        readonly ingredientIds: readonly string[];
        readonly durationMs: number;
        readonly optionCount: number;
    };
    readonly cases: readonly JointAllocationBenchmarkCase[];
}

export function defaultJointAllocationBenchmarkOptions(): JointAllocationBenchmarkOptions {
    return {
        scenarios: [
            scenario('small-paid', 5, 1, 'paid', 1, 'production-only'),
            scenario('capacity-unpaid', 10, 1, 'unpaid', 0.75, 'production-only'),
            scenario('three-paid-stock', 10, 3, 'paid', 1, 'one-per-mix'),
            scenario('three-unpaid-cash', 20, 3, 'unpaid', 0.75, 'production-only'),
            scenario('all-paid-cash', 20, 6, 'paid', 1, 'production-only'),
            scenario('all-unpaid-stock', 20, 6, 'unpaid', 1, 'one-per-mix'),
        ],
        iterations: 2,
        warmups: 1,
        maxIngredients: 2,
        recommendationLimit: 5,
        recipeMaxStates: 100_000,
        maximumOptionProductionCost: 100,
        maximumDealerSubsets: 64,
        maximumStatesPerDealerSubset: 100_000,
    };
}

export function runJointAllocationBenchmark(
    dataset: SolverDataset,
    options: JointAllocationBenchmarkOptions,
    onCaseCompleted: (
        completed: number,
        total: number,
        result: JointAllocationBenchmarkCase
    ) => void = () => undefined
): JointAllocationBenchmarkReport {
    const playerDealers = logicalDealerProfiles(dataset.tradeCatalog)
        .filter(({ type }) => type === 'PlayerDealer');
    validateOptions(options, dataset.customers.length, playerDealers.length);
    const selections = new Map(options.scenarios.map(({ customerCount }) => [
        customerCount,
        selectAllocationBenchmarkCustomers(dataset.customers, customerCount),
    ]));
    const selectedCustomers = uniqueAllocationBenchmarkCustomers([...selections.values()].flat());
    const productIds = dataset.items
        .filter((item) => item.product !== null && !item.isRuntimeOnly)
        .map(({ id }) => id)
        .sort();
    const ingredientIds = dataset.items
        .filter((item) =>
            item.mixingIngredient !== null &&
            item.basePurchasePrice !== null &&
            !item.isRuntimeOnly
        )
        .map(({ id }) => id)
        .sort();
    if (productIds.length === 0 || ingredientIds.length === 0) {
        throw new Error('Joint allocation benchmark requires products and mixing ingredients');
    }

    const generatedAt = performance.now();
    const recommendationSets = generateAllocationBenchmarkRecommendations(
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
    const allocator = new CustomerRecommendationDealerAllocator(dataset.tradeCatalog);
    const cases = options.scenarios.map((definition, index): JointAllocationBenchmarkCase => {
        const customers = selections.get(definition.customerCount)!;
        const sets = customers.map((customer) => recommendationsByCustomer.get(customer.id)!);
        const dealers = playerDealers.slice(0, definition.dealerCount);
        const referenceCost = sets.reduce(
            (total, set) =>
                total + requireAllocationBenchmarkRecommendation(set).productionCost,
            0
        );
        const maximumProductionCost = referenceCost * definition.productionBudgetFraction;
        const execute = () => measure(() => allocator.allocate({
            datasetSha256: dataset.manifest.datasetSha256,
            dealers: dealers.map(({ personId }) => ({
                personId,
                signingFeePaid: definition.signingFeeState === 'paid',
            })),
            recommendationSets: sets,
            maximumProductionCost,
            ...(definition.stockMode === 'production-only'
                ? {}
                : { stock: onePerMixAllocationBenchmarkStock(
                      dataset.manifest.datasetSha256,
                      sets
                  ) }),
            maximumDealerSubsets: options.maximumDealerSubsets,
            maximumStatesPerDealerSubset: options.maximumStatesPerDealerSubset,
        }));
        const warmupSamples = Array.from({ length: options.warmups }, execute);
        const samples = Array.from({ length: options.iterations }, execute);
        requireDeterministicSamples([...warmupSamples, ...samples]);
        const durations = samples.map(({ durationMs }) => durationMs).sort(numberOrder);
        const result = {
            ...definition,
            customerIds: customers.map(({ id }) => id),
            dealerIds: dealers.map(({ personId }) => personId),
            optionCount: sets.reduce((total, set) => total + set.recommendations.length, 0),
            maximumProductionCost,
            warmupSamples,
            samples,
            duration: {
                minimumMs: durations[0]!,
                medianMs: median(durations),
                maximumMs: durations.at(-1)!,
            },
        };
        onCaseCompleted(index + 1, options.scenarios.length, result);
        return result;
    });

    return {
        schema: 'neonschedule1-joint-allocation-benchmark-1',
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

function measure(
    operation: () => ReturnType<CustomerRecommendationDealerAllocator['allocate']>
): JointAllocationBenchmarkSample {
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

function requireDeterministicSamples(samples: readonly JointAllocationBenchmarkSample[]): void {
    const [first, ...rest] = samples;
    if (first === undefined) return;
    const expected = canonicalJson({ ...first, durationMs: 0 });
    if (rest.some((sample) => canonicalJson({ ...sample, durationMs: 0 }) !== expected)) {
        throw new Error('Joint allocation benchmark produced non-deterministic results');
    }
}

function validateOptions(
    options: JointAllocationBenchmarkOptions,
    customerCount: number,
    dealerCount: number
): void {
    if (options.scenarios.length === 0) {
        throw new Error('Joint allocation benchmark requires scenarios');
    }
    const ids = new Set<string>();
    for (const definition of options.scenarios) {
        if (definition.id.trim().length === 0 || ids.has(definition.id)) {
            throw new Error('Joint allocation benchmark scenario IDs must be unique and non-blank');
        }
        ids.add(definition.id);
        requirePositiveInteger(definition.customerCount, 'Scenario customer count');
        requirePositiveInteger(definition.dealerCount, 'Scenario dealer count');
        if (definition.customerCount > customerCount || definition.dealerCount > dealerCount) {
            throw new Error(`Joint allocation benchmark scenario ${JSON.stringify(definition.id)} exceeds dataset capacity`);
        }
        if (!Number.isFinite(definition.productionBudgetFraction) ||
            definition.productionBudgetFraction <= 0) {
            throw new Error('Scenario production budget fraction must be positive');
        }
        if (definition.signingFeeState !== 'paid' && definition.signingFeeState !== 'unpaid') {
            throw new Error('Scenario signing-fee state is invalid');
        }
        if (definition.stockMode !== 'production-only' && definition.stockMode !== 'one-per-mix') {
            throw new Error('Scenario stock mode is invalid');
        }
    }
    requireNonNegativeInteger(options.warmups, 'Joint allocation benchmark warmups');
    for (const [value, label] of [
        [options.iterations, 'iterations'],
        [options.maxIngredients, 'maximum ingredients'],
        [options.recommendationLimit, 'recommendation limit'],
        [options.recipeMaxStates, 'recipe states'],
        [options.maximumDealerSubsets, 'dealer subsets'],
        [options.maximumStatesPerDealerSubset, 'states per dealer subset'],
    ] as const) requirePositiveInteger(value, `Joint allocation benchmark ${label}`);
    if (!Number.isFinite(options.maximumOptionProductionCost) ||
        options.maximumOptionProductionCost < 0) {
        throw new Error('Joint allocation benchmark option production cost must be non-negative');
    }
}

function scenario(
    id: string,
    customerCount: number,
    dealerCount: number,
    signingFeeState: JointAllocationSigningFeeState,
    productionBudgetFraction: number,
    stockMode: AllocationBenchmarkStockMode
): JointAllocationBenchmarkScenario {
    return {
        id,
        customerCount,
        dealerCount,
        signingFeeState,
        productionBudgetFraction,
        stockMode,
    };
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
