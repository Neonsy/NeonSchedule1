import type { RecipeSearchObjective } from '@neonschedule1/core';

import type {
    RecipeCorpusIndex,
    RecipeCorpusIndexRecord,
} from '#solver/precompute-index';

export type PartitionOrdinals = Uint8Array | Uint16Array | Uint32Array;

export interface CorpusPartitionIdentity {
    readonly path: string;
    readonly recipeCount: number;
}

export interface RuntimeRecipeCorpusIndexColumns {
    readonly partitions: readonly CorpusPartitionIdentity[];
    readonly partitionOrdinals: PartitionOrdinals;
    readonly recipeIndexes: Uint32Array;
    readonly totalCosts: Float64Array;
    readonly ingredientCounts: Uint32Array;
    readonly postings: {
        readonly products: Readonly<Record<string, Uint32Array>>;
        readonly effects: Readonly<Record<string, Uint32Array>>;
        readonly ingredients: Readonly<Record<string, Uint32Array>>;
    };
    readonly rankings: Readonly<Record<RecipeSearchObjective, Uint32Array>>;
    readonly totalCostOrder: Uint32Array;
}

interface MutableRecipeCorpusIndex {
    records: readonly RecipeCorpusIndexRecord[];
    postings: {
        products: Readonly<Record<string, readonly number[]>>;
        effects: Readonly<Record<string, readonly number[]>>;
        ingredients: Readonly<Record<string, readonly number[]>>;
    };
    rankings: Record<RecipeSearchObjective, readonly number[]>;
    totalCostOrder: readonly number[];
}

export class RuntimeRecipeCorpusIndex {
    readonly recordCount: number;
    readonly totalCosts: Float64Array;
    readonly ingredientCounts: Uint32Array;
    readonly postings: {
        readonly products: Readonly<Record<string, Uint32Array>>;
        readonly effects: Readonly<Record<string, Uint32Array>>;
        readonly ingredients: Readonly<Record<string, Uint32Array>>;
    };
    readonly rankings: Readonly<Record<RecipeSearchObjective, Uint32Array>>;
    readonly totalCostOrder: Uint32Array;
    readonly #partitions: readonly CorpusPartitionIdentity[];
    readonly #partitionOrdinals: PartitionOrdinals;
    readonly #recipeIndexes: Uint32Array;

    private constructor(columns: RuntimeRecipeCorpusIndexColumns) {
        this.recordCount = columns.recipeIndexes.length;
        this.#partitions = columns.partitions;
        this.#partitionOrdinals = columns.partitionOrdinals;
        this.#recipeIndexes = columns.recipeIndexes;
        this.totalCosts = columns.totalCosts;
        this.ingredientCounts = columns.ingredientCounts;
        this.postings = columns.postings;
        this.rankings = columns.rankings;
        this.totalCostOrder = columns.totalCostOrder;
    }

    static consume(
        source: RecipeCorpusIndex,
        partitions: readonly CorpusPartitionIdentity[]
    ): RuntimeRecipeCorpusIndex {
        return new RuntimeRecipeCorpusIndex(
            consumeRecipeCorpusIndexColumns(source, partitions)
        );
    }

    static fromColumns(columns: RuntimeRecipeCorpusIndexColumns): RuntimeRecipeCorpusIndex {
        verifyColumns(columns);
        return new RuntimeRecipeCorpusIndex(columns);
    }

    assertPartitions(partitions: readonly CorpusPartitionIdentity[]): void {
        if (partitions.length !== this.#partitions.length) {
            throw new Error('Recipe index partitions differ from the corpus manifest');
        }
        partitions.forEach((partition, ordinal) => {
            const indexed = this.#partitions[ordinal]!;
            if (partition.path !== indexed.path || partition.recipeCount !== indexed.recipeCount) {
                throw new Error('Recipe index partitions differ from the corpus manifest');
            }
        });
    }

    partitionPathAt(ordinal: number): string {
        return this.#partitions[this.#partitionOrdinals[ordinal]!]!.path;
    }

    recipeIndexAt(ordinal: number): number {
        return this.#recipeIndexes[ordinal]!;
    }

}

export function consumeRecipeCorpusIndexColumns(
    source: RecipeCorpusIndex,
    partitions: readonly CorpusPartitionIdentity[]
): RuntimeRecipeCorpusIndexColumns {
    if (source.records.length > 0xffff_ffff) {
        throw new Error('Recipe index exceeds the runtime ordinal range');
    }
    const mutable = source as unknown as MutableRecipeCorpusIndex;
    const recordCount = source.records.length;
    const recordPartitions = partitionOrdinals(recordCount, partitions.length);
    const recipeIndexes = new Uint32Array(recordCount);
    const totalCosts = new Float64Array(recordCount);
    const ingredientCounts = new Uint32Array(recordCount);
    copyRecords(
        source.records,
        partitions,
        recordPartitions,
        recipeIndexes,
        totalCosts,
        ingredientCounts
    );
    mutable.records = [];

    const products = ordinalRecord(source.postings.products);
    mutable.postings.products = {};
    const effects = ordinalRecord(source.postings.effects);
    mutable.postings.effects = {};
    const ingredients = ordinalRecord(source.postings.ingredients);
    mutable.postings.ingredients = {};
    const productValue = Uint32Array.from(source.rankings.productValue);
    mutable.rankings.productValue = [];
    const netValue = Uint32Array.from(source.rankings.netValue);
    mutable.rankings.netValue = [];
    const fewestSteps = Uint32Array.from(source.rankings.fewestSteps);
    mutable.rankings.fewestSteps = [];
    const lowestCost = Uint32Array.from(source.rankings.lowestCost);
    mutable.rankings.lowestCost = [];
    const returnOnCost = Uint32Array.from(source.rankings.returnOnCost);
    mutable.rankings.returnOnCost = [];
    const totalCostOrder = Uint32Array.from(source.totalCostOrder);
    mutable.totalCostOrder = [];
    return {
        partitions,
        partitionOrdinals: recordPartitions,
        recipeIndexes,
        totalCosts,
        ingredientCounts,
        postings: { products, effects, ingredients },
        rankings: { productValue, netValue, fewestSteps, lowestCost, returnOnCost },
        totalCostOrder,
    };
}

function copyRecords(
    records: readonly RecipeCorpusIndexRecord[],
    partitions: readonly CorpusPartitionIdentity[],
    recordPartitions: PartitionOrdinals,
    recipeIndexes: Uint32Array,
    totalCosts: Float64Array,
    ingredientCounts: Uint32Array
): void {
    const partitionOrdinals = new Map(
        partitions.map((partition, ordinal) => [partition.path, ordinal])
    );
    records.forEach((record, ordinal) => {
        const partitionOrdinal = partitionOrdinals.get(record.partitionPath);
        if (partitionOrdinal === undefined) {
            throw new Error(`Recipe index references unknown partition ${record.partitionPath}`);
        }
        if (!Number.isSafeInteger(record.recipeIndex) || record.recipeIndex < 0 ||
            record.recipeIndex > 0xffff_ffff ||
            record.recipeIndex >= partitions[partitionOrdinal]!.recipeCount) {
            throw new Error(`Recipe index contains invalid recipe index ${record.recipeIndex}`);
        }
        if (!Number.isFinite(record.totalCost) || record.totalCost < 0) {
            throw new Error('Recipe index contains an invalid total cost');
        }
        recordPartitions[ordinal] = partitionOrdinal;
        recipeIndexes[ordinal] = record.recipeIndex;
        totalCosts[ordinal] = record.totalCost;
        if (!Number.isSafeInteger(record.ingredientCount) || record.ingredientCount < 0 ||
            record.ingredientCount > 0xffff_ffff) {
            throw new Error('Recipe index contains an invalid ingredient count');
        }
        ingredientCounts[ordinal] = record.ingredientCount;
    });
}

function verifyColumns(columns: RuntimeRecipeCorpusIndexColumns): void {
    const count = columns.recipeIndexes.length;
    if (columns.partitionOrdinals.length !== count || columns.totalCosts.length !== count ||
        columns.ingredientCounts.length !== count ||
        columns.rankings.productValue.length !== count ||
        columns.rankings.netValue.length !== count ||
        columns.rankings.fewestSteps.length !== count ||
        columns.rankings.lowestCost.length !== count ||
        columns.rankings.returnOnCost.length !== count ||
        columns.totalCostOrder.length !== count) {
        throw new Error('Recipe index columns have inconsistent lengths');
    }
    for (let ordinal = 0; ordinal < count; ordinal++) {
        const partitionOrdinal = columns.partitionOrdinals[ordinal]!;
        const partition = columns.partitions[partitionOrdinal];
        if (partition === undefined || columns.recipeIndexes[ordinal]! >= partition.recipeCount) {
            throw new Error('Recipe index contains an invalid partition reference');
        }
        if (!Number.isFinite(columns.totalCosts[ordinal]) || columns.totalCosts[ordinal]! < 0) {
            throw new Error('Recipe index contains an invalid total cost');
        }
    }
    verifyPermutation(columns.rankings.productValue, count, 'product-value ranking');
    verifyPermutation(columns.rankings.netValue, count, 'net-value ranking');
    verifyPermutation(columns.rankings.fewestSteps, count, 'fewest-steps ranking');
    verifyPermutation(columns.rankings.lowestCost, count, 'lowest-cost ranking');
    verifyPermutation(columns.rankings.returnOnCost, count, 'return-on-cost ranking');
    verifyPermutation(columns.totalCostOrder, count, 'total-cost order');
    for (let position = 1; position < columns.totalCostOrder.length; position++) {
        const previous = columns.totalCostOrder[position - 1]!;
        const current = columns.totalCostOrder[position]!;
        if (columns.totalCosts[previous]! > columns.totalCosts[current]!) {
            throw new Error('Recipe index total-cost order is not ascending');
        }
    }
    for (const [kind, postings] of [
        ['product', columns.postings.products],
        ['effect', columns.postings.effects],
        ['ingredient', columns.postings.ingredients],
    ] as const) {
        for (const [key, ordinals] of Object.entries(postings)) {
            verifyPosting(ordinals, count, `${kind} posting ${JSON.stringify(key)}`);
        }
    }
}

function verifyPermutation(values: Uint32Array, count: number, label: string): void {
    const seen = new Uint8Array(count);
    for (const value of values) {
        if (value >= count) throw new Error(`Recipe index ${label} contains invalid ordinal ${value}`);
        if (seen[value] === 1) throw new Error(`Recipe index ${label} repeats ordinal ${value}`);
        seen[value] = 1;
    }
}

function verifyPosting(values: Uint32Array, count: number, label: string): void {
    for (let index = 0; index < values.length; index++) {
        const value = values[index]!;
        if (value >= count) throw new Error(`Recipe index ${label} contains invalid ordinal ${value}`);
        if (index > 0 && values[index - 1]! >= value) {
            throw new Error(`Recipe index ${label} must be sorted and unique`);
        }
    }
}

function partitionOrdinals(recordCount: number, partitionCount: number): PartitionOrdinals {
    if (partitionCount <= 0x100) return new Uint8Array(recordCount);
    if (partitionCount <= 0x1_0000) return new Uint16Array(recordCount);
    if (partitionCount <= 0xffff_ffff) return new Uint32Array(recordCount);
    throw new Error('Recipe corpus exceeds the runtime partition range');
}

function ordinalRecord(
    source: Readonly<Record<string, readonly number[]>>
): Readonly<Record<string, Uint32Array>> {
    return Object.fromEntries(
        Object.entries(source).map(([key, values]) => [key, Uint32Array.from(values)])
    );
}
