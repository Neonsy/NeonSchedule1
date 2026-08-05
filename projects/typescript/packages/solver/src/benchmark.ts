import os from 'node:os';
import { performance } from 'node:perf_hooks';

import {
    CustomerRecipeSearch,
    MixingEngine,
    RecipeSearch,
    RecipeSearchLimitError,
    type Customer,
    type CustomerOfferState,
    type CustomerQuality,
    type RecipeSearchEvidence,
} from '@neonschedule1/core';

import type { SolverDataset } from '#solver/dataset';

export const recipeSearchAlgorithmVersion = '2';

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
    readonly schema: 'neonschedule1-search-benchmark-2';
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
}

export interface SearchBenchmarkCase {
    readonly id: string;
    readonly kind: 'recipe' | 'customer';
    readonly productId?: string;
    readonly customerId?: string;
    readonly objective?: 'productValue' | 'netValue';
    readonly costCeilingFraction?: number;
    readonly maximumTotalCost?: number;
    readonly depth: number;
    readonly customerState?: BenchmarkCustomerState;
    readonly samples: readonly SearchBenchmarkSample[];
    readonly duration: {
        readonly minimumMs: number;
        readonly medianMs: number;
        readonly maximumMs: number;
    };
}

export interface SearchBenchmarkSample {
    readonly durationMs: number;
    readonly status: 'completed' | 'state-limit';
    readonly resultCount: number;
    readonly evidence: RecipeSearchEvidence;
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
    const recipeSearch = new RecipeSearch(engine, itemsById, { maxStates: options.maxStates });
    const customerSearch = new CustomerRecipeSearch(
        engine,
        itemsById,
        dataset.customerCatalog,
        { maxStates: options.maxStates }
    );
    const definitions: BenchmarkDefinition[] = [];
    for (const depth of options.depths) {
        for (const productId of productIds) {
            for (const objective of ['productValue', 'netValue'] as const) {
                definitions.push({ kind: 'recipe', depth, productId, objective });
                for (const costCeilingFraction of options.recipeCostCeilingFractions) {
                    definitions.push({
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
                definitions.push({ kind: 'customer', depth, customer, customerState });
            }
        }
    }

    const cases: SearchBenchmarkCase[] = [];
    for (const definition of definitions) {
        const execute = (): SearchBenchmarkSample =>
            definition.kind === 'recipe'
                ? measure(() => {
                      const result = recipeSearch.search({
                          productId: definition.productId,
                          availableIngredientIds: ingredientIds,
                          maxIngredients: definition.depth,
                          limit: options.limit,
                          objective: definition.objective,
                          ...(definition.maximumTotalCost === undefined
                              ? {}
                              : { maximumTotalCost: definition.maximumTotalCost }),
                      });
                      return { resultCount: result.recipes.length, evidence: result.evidence };
                  })
                : measure(() => {
                      const result = customerSearch.search({
                          productIds,
                          availableIngredientIds: ingredientIds,
                          maxIngredients: definition.depth,
                          profile: definition.customer,
                          state: benchmarkCustomerState(
                              definition.customerState,
                              definition.customer,
                              dataset.customerCatalog.constants.maximumRelationship
                          ),
                          quality: options.quality,
                          quantity: options.quantity,
                          priceMultiplier: options.priceMultiplier,
                          maximumProductionCost: options.maximumProductionCost,
                          limit: options.limit,
                      });
                      return {
                          resultCount: result.recommendations.length,
                          evidence: result.evidence,
                      };
                  });
        for (let index = 0; index < options.warmups; index++) execute();
        const samples = Array.from({ length: options.iterations }, execute);
        requireDeterministicSamples(definitionId(definition), samples);
        const result = benchmarkCase(definition, samples);
        cases.push(result);
        onCaseCompleted(cases.length, definitions.length, result);
    }

    return {
        schema: 'neonschedule1-search-benchmark-2',
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
    };
}

type BenchmarkDefinition =
    | {
          readonly kind: 'recipe';
          readonly depth: number;
          readonly productId: string;
          readonly objective: 'productValue' | 'netValue';
          readonly costCeilingFraction?: number;
          readonly maximumTotalCost?: number;
      }
    | {
          readonly kind: 'customer';
          readonly depth: number;
          readonly customer: Customer;
          readonly customerState: BenchmarkCustomerState;
      };

function measure(
    operation: () => { readonly resultCount: number; readonly evidence: RecipeSearchEvidence }
): SearchBenchmarkSample {
    const startedAt = performance.now();
    try {
        const result = operation();
        return {
            durationMs: milliseconds(performance.now() - startedAt),
            status: 'completed',
            resultCount: result.resultCount,
            evidence: result.evidence,
        };
    } catch (error) {
        if (!(error instanceof RecipeSearchLimitError)) throw error;
        return {
            durationMs: milliseconds(performance.now() - startedAt),
            status: 'state-limit',
            resultCount: 0,
            evidence: error.evidence,
        };
    }
}

function benchmarkCase(
    definition: BenchmarkDefinition,
    samples: readonly SearchBenchmarkSample[]
): SearchBenchmarkCase {
    const durations = samples.map((sample) => sample.durationMs).sort((left, right) => left - right);
    const base = {
        id: definitionId(definition),
        kind: definition.kind,
        depth: definition.depth,
        samples,
        duration: {
            minimumMs: durations[0]!,
            medianMs: median(durations),
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
          };
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
    if (definition.kind === 'recipe') {
        const ceiling = definition.costCeilingFraction === undefined
            ? ''
            : `:cost-${definition.costCeilingFraction}`;
        return `recipe:${definition.productId}:${definition.objective}${ceiling}:depth-${definition.depth}`;
    }
    const state = definition.customerState === 'baseline'
        ? ''
        : `:${definition.customerState}`;
    return `customer:${definition.customer.id}${state}:depth-${definition.depth}`;
}

function validateOptions(options: SearchBenchmarkOptions): void {
    if (options.depths.length === 0) throw new Error('Benchmark depths must not be empty');
    for (const depth of options.depths) requireInteger(depth, 'depth', 0);
    requireInteger(options.iterations, 'iterations', 1);
    requireInteger(options.warmups, 'warmups', 0);
    requireInteger(options.limit, 'limit', 1);
    requireInteger(options.maxStates, 'maxStates', 1);
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

function benchmarkCustomerState(
    name: BenchmarkCustomerState,
    customer: Customer,
    maximumRelationship: number
): CustomerOfferState {
    switch (name) {
        case 'baseline':
            return { addiction: customer.baseAddiction, relationship: 0, orderLimitMultiplier: 1 };
        case 'maximum-addiction':
            return { addiction: 1, relationship: 0, orderLimitMultiplier: 1 };
        case 'maximum-relationship':
            return {
                addiction: customer.baseAddiction,
                relationship: maximumRelationship,
                orderLimitMultiplier: 1,
            };
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
