import os from 'node:os';

import {
    MixingEngine,
    type Customer,
    type CustomerQuality,
    type RecipeSearchEvidence,
} from '@neonschedule1/core';

import { benchmarkOperation } from '#solver/benchmark-operation';
import {
    requireTransitionBudgetPercentiles,
    summarizeTransitionBudget,
    transitionBudgetCandidates,
    transitionProbeDefinitions,
} from '#solver/benchmark-transition';
import type { SolverDataset } from '#solver/dataset';

export const recipeSearchAlgorithmVersion = '4';

export type BenchmarkCustomerState =
    | 'baseline'
    | 'maximum-addiction'
    | 'maximum-relationship';

export interface SearchBenchmarkOptions {
    readonly depths: readonly number[];
    readonly iterations: number;
    readonly warmups: number;
    readonly limit: number;
    readonly maxStates: number;
    readonly transitionBudgetPercentiles: readonly number[];
    readonly recipeCostCeilingFractions: readonly number[];
    readonly customerCount: number;
    readonly customerIds?: readonly string[];
    readonly customerStates: readonly BenchmarkCustomerState[];
    readonly quality: CustomerQuality;
    readonly quantity: number;
    readonly priceMultiplier: number;
    readonly maximumProductionCost: number;
}

export interface SearchBenchmarkReport {
    readonly schema: 'neonschedule1-search-benchmark-4';
    readonly createdAt: string;
    readonly algorithmVersion: string;
    readonly dataset: {
        readonly gameVersion: string;
        readonly datasetSha256: string;
        readonly normalizerVersion: string;
    };
    readonly machine: MachineDescription;
    readonly configuration: SearchBenchmarkOptions;
    readonly selection: {
        readonly productIds: readonly string[];
        readonly ingredientIds: readonly string[];
        readonly customerIds: readonly string[];
        readonly customerSelection: 'explicit' | 'weekly-spend-quantiles';
        readonly costCeilingBasis: {
            readonly kind: 'base-plus-maximum-ingredient-path-fraction';
            readonly maximumIngredientUnitCost: number;
        };
    };
    readonly cases: readonly SearchBenchmarkCase[];
    readonly transitionBudgetSweep: TransitionBudgetSweep | null;
}

export interface SearchBenchmarkCase {
    readonly id: string;
    readonly phase: 'baseline' | 'transition-probe' | 'transition-budget';
    readonly kind: 'recipe' | 'customer';
    readonly productId?: string;
    readonly customerId?: string;
    readonly objective?: 'productValue' | 'netValue';
    readonly costCeilingFraction?: number;
    readonly maximumTotalCost?: number;
    readonly depth: number;
    readonly customerState?: BenchmarkCustomerState;
    readonly productScope?: 'all' | 'single';
    readonly maxTransitionEvaluations?: number;
    readonly transitionBudgetPercentile?: number;
    readonly warmupSamples: readonly SearchBenchmarkSample[];
    readonly firstRun: {
        readonly durationMs: number;
        readonly deltaFromWarmedMedianMs: number;
    } | null;
    readonly samples: readonly SearchBenchmarkSample[];
    readonly duration: {
        readonly minimumMs: number;
        readonly medianMs: number;
        readonly maximumMs: number;
    };
}

export interface SearchBenchmarkSample {
    readonly durationMs: number;
    readonly status: 'completed' | 'state-limit' | 'work-limit';
    readonly resultCount: number;
    readonly evidence: RecipeSearchEvidence;
}

export interface TransitionBudgetSweep {
    readonly basis: 'per-product-transition-count-percentile';
    readonly probes: readonly SearchBenchmarkCase[];
    readonly candidates: readonly TransitionBudgetCandidate[];
    readonly cases: readonly SearchBenchmarkCase[];
}

export interface TransitionBudgetCandidate {
    readonly percentile: number;
    readonly maxTransitionEvaluations: number;
    readonly completedCases: number;
    readonly workLimitedCases: number;
    readonly stateLimitedCases: number;
    readonly completionRate: number;
    readonly medianDurationMs: number;
}

interface MachineDescription {
    readonly platform: NodeJS.Platform;
    readonly release: string;
    readonly architecture: string;
    readonly nodeVersion: string;
    readonly cpuModels: readonly string[];
    readonly logicalCpuCount: number;
    readonly availableParallelism: number;
    readonly totalMemoryBytes: number;
}

export function defaultSearchBenchmarkOptions(): SearchBenchmarkOptions {
    return {
        depths: [3, 4, 5],
        iterations: 3,
        warmups: 1,
        limit: 10,
        maxStates: 100_000,
        transitionBudgetPercentiles: [],
        recipeCostCeilingFractions: [0.25, 0.5],
        customerCount: 3,
        customerStates: ['baseline', 'maximum-addiction', 'maximum-relationship'],
        quality: 'Standard',
        quantity: 1,
        priceMultiplier: 1,
        maximumProductionCost: 100,
    };
}

export function runSearchBenchmark(
    dataset: SolverDataset,
    options: SearchBenchmarkOptions,
    onCaseCompleted: (completed: number, total: number, result: SearchBenchmarkCase) => void =
        () => undefined
): SearchBenchmarkReport {
    validateOptions(options);
    const itemsById = new Map(dataset.items.map((item) => [item.id, item]));
    const effectsById = new Map(dataset.effects.map((effect) => [effect.id, effect]));
    const engine = new MixingEngine(dataset.mixingRules, effectsById);
    const productIds = dataset.items
        .filter((item) => item.product !== null && !item.isRuntimeOnly)
        .map((item) => item.id)
        .sort((left, right) => left.localeCompare(right));
    const ingredientIds = dataset.items
        .filter(
            (item) =>
                item.mixingIngredient !== null &&
                item.basePurchasePrice !== null &&
                !item.isRuntimeOnly
        )
        .map((item) => item.id)
        .sort((left, right) => left.localeCompare(right));
    if (productIds.length === 0) throw new Error('Benchmark dataset contains no user-facing products');
    if (ingredientIds.length === 0) throw new Error('Benchmark dataset contains no mixing ingredients');

    const customers = selectCustomers(dataset.customers, options);
    const baseCostByProductId = new Map(
        productIds.map((productId) => ([
            productId,
            benchmarkCost(
                itemsById.get(productId)?.basePurchasePrice,
                'product',
                productId
            ),
        ] as const))
    );
    const ingredientCosts = ingredientIds.map((ingredientId) =>
        benchmarkCost(
            itemsById.get(ingredientId)?.basePurchasePrice,
            'mixing ingredient',
            ingredientId
        )
    );
    const maximumIngredientUnitCost = Math.max(...ingredientCosts);
    const definitions: BenchmarkDefinition[] = [];
    for (const depth of options.depths) {
        for (const productId of productIds) {
            for (const objective of ['productValue', 'netValue'] as const) {
                definitions.push({ phase: 'baseline', kind: 'recipe', depth, productId, objective });
                for (const costCeilingFraction of options.recipeCostCeilingFractions) {
                    definitions.push({
                        phase: 'baseline',
                        kind: 'recipe',
                        depth,
                        productId,
                        objective,
                        costCeilingFraction,
                        maximumTotalCost:
                            baseCostByProductId.get(productId)! +
                            maximumIngredientUnitCost * depth * costCeilingFraction,
                    });
                }
            }
        }
        for (const customer of customers) {
            for (const customerState of options.customerStates) {
                definitions.push({
                    phase: 'baseline',
                    kind: 'customer',
                    depth,
                    customer,
                    customerState,
                });
            }
        }
    }

    const probeDefinitions = options.transitionBudgetPercentiles.length === 0
        ? []
        : transitionProbeDefinitions(options, productIds, customers);
    const totalCaseCount = definitions.length +
        probeDefinitions.length * (1 + options.transitionBudgetPercentiles.length);
    let completedCaseCount = 0;
    const runDefinition = (
        definition: BenchmarkDefinition,
        warmups = options.warmups,
        iterations = options.iterations
    ): SearchBenchmarkCase => {
        const execute = benchmarkOperation(
            engine,
            itemsById,
            dataset.customerCatalog,
            definition,
            productIds,
            ingredientIds,
            options
        );
        const warmupSamples = Array.from({ length: warmups }, execute);
        const samples = Array.from({ length: iterations }, execute);
        requireDeterministicSamples(definitionId(definition), [...warmupSamples, ...samples]);
        const result = benchmarkCase(definition, warmupSamples, samples);
        onCaseCompleted(++completedCaseCount, totalCaseCount, result);
        return result;
    };

    const cases: SearchBenchmarkCase[] = [];
    for (const definition of definitions) cases.push(runDefinition(definition));

    const probes = probeDefinitions.map((definition) => runDefinition(definition, 0, 1));
    const candidateLimits = transitionBudgetCandidates(
        options.transitionBudgetPercentiles,
        probes
    );
    const transitionCases: SearchBenchmarkCase[] = [];
    const candidates: TransitionBudgetCandidate[] = [];
    for (const candidate of candidateLimits) {
        const candidateCases = probeDefinitions.map((definition) =>
            runDefinition({
                ...definition,
                phase: 'transition-budget',
                maxTransitionEvaluations: candidate.maxTransitionEvaluations,
                transitionBudgetPercentile: candidate.percentile,
            })
        );
        transitionCases.push(...candidateCases);
        candidates.push(summarizeTransitionBudget(candidate, candidateCases));
    }

    return {
        schema: 'neonschedule1-search-benchmark-4',
        createdAt: new Date().toISOString(),
        algorithmVersion: recipeSearchAlgorithmVersion,
        dataset: {
            gameVersion: dataset.manifest.gameVersion,
            datasetSha256: dataset.manifest.datasetSha256,
            normalizerVersion: dataset.manifest.normalizerVersion,
        },
        machine: machineDescription(),
        configuration: options,
        selection: {
            productIds,
            ingredientIds,
            customerIds: customers.map((customer) => customer.id),
            customerSelection:
                options.customerIds === undefined ? 'weekly-spend-quantiles' : 'explicit',
            costCeilingBasis: {
                kind: 'base-plus-maximum-ingredient-path-fraction',
                maximumIngredientUnitCost,
            },
        },
        cases,
        transitionBudgetSweep: options.transitionBudgetPercentiles.length === 0
            ? null
            : {
                  basis: 'per-product-transition-count-percentile',
                  probes,
                  candidates,
                  cases: transitionCases,
              },
    };
}

export interface BenchmarkDefinitionBase {
    readonly phase: 'baseline' | 'transition-probe' | 'transition-budget';
    readonly depth: number;
    readonly maxTransitionEvaluations?: number;
    readonly transitionBudgetPercentile?: number;
}

export type BenchmarkDefinition = BenchmarkDefinitionBase & (
    | {
          readonly kind: 'recipe';
          readonly productId: string;
          readonly objective: 'productValue' | 'netValue';
          readonly costCeilingFraction?: number;
          readonly maximumTotalCost?: number;
      }
    | {
          readonly kind: 'customer';
          readonly customer: Customer;
          readonly customerState: BenchmarkCustomerState;
          readonly productId?: string;
      }
);

function benchmarkCase(
    definition: BenchmarkDefinition,
    warmupSamples: readonly SearchBenchmarkSample[],
    samples: readonly SearchBenchmarkSample[]
): SearchBenchmarkCase {
    const durations = samples.map((sample) => sample.durationMs).sort((left, right) => left - right);
    const warmedMedianMs = median(durations);
    const firstRunDurationMs = warmupSamples[0]?.durationMs;
    const base = {
        id: definitionId(definition),
        phase: definition.phase,
        kind: definition.kind,
        depth: definition.depth,
        ...(definition.maxTransitionEvaluations === undefined
            ? {}
            : { maxTransitionEvaluations: definition.maxTransitionEvaluations }),
        ...(definition.transitionBudgetPercentile === undefined
            ? {}
            : { transitionBudgetPercentile: definition.transitionBudgetPercentile }),
        warmupSamples,
        firstRun: firstRunDurationMs === undefined
            ? null
            : {
                  durationMs: firstRunDurationMs,
                  deltaFromWarmedMedianMs: roundedMilliseconds(
                      firstRunDurationMs - warmedMedianMs
                  ),
              },
        samples,
        duration: {
            minimumMs: durations[0]!,
            medianMs: warmedMedianMs,
            maximumMs: durations[durations.length - 1]!,
        },
    } as const;
    return definition.kind === 'recipe'
        ? {
              ...base,
              productId: definition.productId,
              objective: definition.objective,
              ...(definition.costCeilingFraction === undefined
                  ? {}
                  : { costCeilingFraction: definition.costCeilingFraction }),
              ...(definition.maximumTotalCost === undefined
                  ? {}
                  : { maximumTotalCost: definition.maximumTotalCost }),
          }
        : {
              ...base,
              customerId: definition.customer.id,
              customerState: definition.customerState,
              ...(definition.productId === undefined
                  ? { productScope: 'all' as const }
                  : { productId: definition.productId, productScope: 'single' as const }),
          };
}

function roundedMilliseconds(value: number): number {
    return Math.round(value * 10) / 10;
}

function selectCustomers(
    customers: readonly Customer[],
    options: SearchBenchmarkOptions
): Customer[] {
    if (options.customerIds !== undefined) {
        const customersById = new Map(customers.map((customer) => [customer.id, customer]));
        return options.customerIds.map((customerId) => {
            const customer = customersById.get(customerId);
            if (customer === undefined) throw new Error(`Unknown benchmark customer ${JSON.stringify(customerId)}`);
            return customer;
        });
    }
    if (customers.length === 0) throw new Error('Benchmark dataset contains no customers');
    const ranked = [...customers].sort(
        (left, right) =>
            left.weeklySpend.maximum - right.weeklySpend.maximum || left.id.localeCompare(right.id)
    );
    const count = Math.min(options.customerCount, ranked.length);
    if (count === 1) return [ranked[Math.floor((ranked.length - 1) / 2)]!];
    return Array.from({ length: count }, (_, index) => {
        const rankedIndex = Math.round((index * (ranked.length - 1)) / (count - 1));
        return ranked[rankedIndex]!;
    });
}

function requireDeterministicSamples(id: string, samples: readonly SearchBenchmarkSample[]): void {
    const expected = sampleFingerprint(samples[0]!);
    if (samples.some((sample) => sampleFingerprint(sample) !== expected)) {
        throw new Error(`Benchmark case ${id} produced inconsistent search evidence`);
    }
}

function sampleFingerprint(sample: SearchBenchmarkSample): string {
    return JSON.stringify({
        status: sample.status,
        resultCount: sample.resultCount,
        evidence: sample.evidence,
    });
}

function definitionId(definition: BenchmarkDefinition): string {
    const phase = definition.phase === 'baseline'
        ? ''
        : `${definition.phase}:`;
    const budget = definition.maxTransitionEvaluations === undefined
        ? ''
        : `:p-${definition.transitionBudgetPercentile}:limit-${definition.maxTransitionEvaluations}`;
    if (definition.kind === 'recipe') {
        const ceiling = definition.costCeilingFraction === undefined
            ? ''
            : `:cost-${definition.costCeilingFraction}`;
        return `${phase}recipe:${definition.productId}:${definition.objective}${ceiling}:depth-${definition.depth}${budget}`;
    }
    const state = definition.customerState === 'baseline'
        ? ''
        : `:${definition.customerState}`;
    const product = definition.productId === undefined ? '' : `:product-${definition.productId}`;
    return `${phase}customer:${definition.customer.id}${state}${product}:depth-${definition.depth}${budget}`;
}

function validateOptions(options: SearchBenchmarkOptions): void {
    if (options.depths.length === 0) throw new Error('Benchmark depths must not be empty');
    for (const depth of options.depths) requireInteger(depth, 'depth', 0);
    requireInteger(options.iterations, 'iterations', 1);
    requireInteger(options.warmups, 'warmups', 0);
    requireInteger(options.limit, 'limit', 1);
    requireInteger(options.maxStates, 'maxStates', 1);
    requireTransitionBudgetPercentiles(options.transitionBudgetPercentiles);
    requireFractions(options.recipeCostCeilingFractions);
    requireInteger(options.customerCount, 'customerCount', 1);
    if (options.customerStates.length === 0) {
        throw new Error('Benchmark customerStates must not be empty');
    }
    requireInteger(options.quantity, 'quantity', 1);
    if (!Number.isFinite(options.priceMultiplier) || options.priceMultiplier < 0) {
        throw new Error('priceMultiplier must be a finite non-negative number');
    }
    if (!Number.isFinite(options.maximumProductionCost) || options.maximumProductionCost < 0) {
        throw new Error('maximumProductionCost must be a finite non-negative number');
    }
    if (new Set(options.depths).size !== options.depths.length) {
        throw new Error('Benchmark depths must not contain duplicates');
    }
    if (new Set(options.customerStates).size !== options.customerStates.length) {
        throw new Error('Benchmark customerStates must not contain duplicates');
    }
    if (
        options.customerIds !== undefined &&
        new Set(options.customerIds).size !== options.customerIds.length
    ) {
        throw new Error('Benchmark customers must not contain duplicates');
    }
}

function requireFractions(fractions: readonly number[]): void {
    if (fractions.length === 0) throw new Error('Benchmark recipe cost fractions must not be empty');
    for (const fraction of fractions) {
        if (!Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) {
            throw new Error('Benchmark recipe cost fractions must be finite numbers between zero and one');
        }
    }
    if (new Set(fractions).size !== fractions.length) {
        throw new Error('Benchmark recipe cost fractions must not contain duplicates');
    }
}

function benchmarkCost(
    value: number | null | undefined,
    role: string,
    itemId: string
): number {
    if (value === null || value === undefined) {
        throw new Error(`Benchmark ${role} ${JSON.stringify(itemId)} has no purchase price`);
    }
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Benchmark ${role} ${JSON.stringify(itemId)} has an invalid purchase price`);
    }
    return value;
}

function machineDescription(): MachineDescription {
    const processors = os.cpus();
    return {
        platform: process.platform,
        release: os.release(),
        architecture: process.arch,
        nodeVersion: process.version,
        cpuModels: [...new Set(processors.map((processor) => processor.model.trim()))],
        logicalCpuCount: processors.length,
        availableParallelism: os.availableParallelism(),
        totalMemoryBytes: os.totalmem(),
    };
}

function median(sorted: readonly number[]): number {
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? milliseconds((sorted[middle - 1]! + sorted[middle]!) / 2)
        : sorted[middle]!;
}

function milliseconds(value: number): number {
    return Math.round(value * 10) / 10;
}

function requireInteger(value: number, name: string, minimum: number): void {
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new Error(`${name} must be a safe integer greater than or equal to ${minimum}`);
    }
}
