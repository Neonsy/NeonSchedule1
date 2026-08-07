import type { RecipeSearchObjective } from '@neonschedule1/core';

import type {
    RecipeCorpusIndex,
    RecipeCorpusIndexRecord,
} from '#solver/precompute-index';

type PartitionOrdinals = Uint8Array | Uint16Array | Uint32Array;

interface CorpusPartitionIdentity {
    readonly path: string;
    readonly recipeCount: number;
}

interface MutableRecipeCorpusIndex {
    records: readonly RecipeCorpusIndexRecord[];
    postings: {
        products: Readonly<Record<string, readonly number[]>>;
        effects: Readonly<Record<string, readonly number[]>>;
    };
    rankings: Record<RecipeSearchObjective, readonly number[]>;
    totalCostOrder: readonly number[];
}

export class RuntimeRecipeCorpusIndex {
    readonly recordCount: number;
    readonly totalCosts: Float64Array;
    readonly postings: {
        readonly products: Readonly<Record<string, Uint32Array>>;
        readonly effects: Readonly<Record<string, Uint32Array>>;
    };
    readonly rankings: Readonly<Record<RecipeSearchObjective, Uint32Array>>;
    readonly totalCostOrder: Uint32Array;
    readonly #partitionPaths: readonly string[];
    readonly #partitionOrdinals: PartitionOrdinals;
    readonly #recipeIndexes: Uint32Array;

    private constructor(
        source: RecipeCorpusIndex,
        partitions: readonly CorpusPartitionIdentity[]
    ) {
        if (source.records.length > 0xffff_ffff) {
            throw new Error('Recipe index exceeds the runtime ordinal range');
        }
        const mutable = source as unknown as MutableRecipeCorpusIndex;
        this.recordCount = source.records.length;
        this.#partitionPaths = partitions.map((partition) => partition.path);
        this.#partitionOrdinals = partitionOrdinals(
            this.recordCount,
            this.#partitionPaths.length
        );
        this.#recipeIndexes = new Uint32Array(this.recordCount);
        this.totalCosts = new Float64Array(this.recordCount);
        this.#copyRecords(source.records, partitions);
        mutable.records = [];

        const products = ordinalRecord(source.postings.products);
        mutable.postings.products = {};
        const effects = ordinalRecord(source.postings.effects);
        mutable.postings.effects = {};
        this.postings = { products, effects };

        const productValue = Uint32Array.from(source.rankings.productValue);
        mutable.rankings.productValue = [];
        const netValue = Uint32Array.from(source.rankings.netValue);
        mutable.rankings.netValue = [];
        this.rankings = { productValue, netValue };
        this.totalCostOrder = Uint32Array.from(source.totalCostOrder);
        mutable.totalCostOrder = [];
    }

    static consume(
        source: RecipeCorpusIndex,
        partitions: readonly CorpusPartitionIdentity[]
    ): RuntimeRecipeCorpusIndex {
        return new RuntimeRecipeCorpusIndex(source, partitions);
    }

    partitionPathAt(ordinal: number): string {
        return this.#partitionPaths[this.#partitionOrdinals[ordinal]!]!;
    }

    recipeIndexAt(ordinal: number): number {
        return this.#recipeIndexes[ordinal]!;
    }

    #copyRecords(
        records: readonly RecipeCorpusIndexRecord[],
        partitions: readonly CorpusPartitionIdentity[]
    ): void {
        const partitionOrdinals = new Map(
            partitions.map((partition, ordinal) => [partition.path, ordinal])
        );
        records.forEach((record, ordinal) => {
            const partitionOrdinal = partitionOrdinals.get(record.partitionPath);
            if (partitionOrdinal === undefined) {
                throw new Error(
                    `Recipe index references unknown partition ${record.partitionPath}`
                );
            }
            if (!Number.isSafeInteger(record.recipeIndex) || record.recipeIndex < 0 ||
                record.recipeIndex > 0xffff_ffff ||
                record.recipeIndex >= partitions[partitionOrdinal]!.recipeCount) {
                throw new Error(
                    `Recipe index contains invalid recipe index ${record.recipeIndex}`
                );
            }
            if (!Number.isFinite(record.totalCost) || record.totalCost < 0) {
                throw new Error('Recipe index contains an invalid total cost');
            }
            this.#partitionOrdinals[ordinal] = partitionOrdinal;
            this.#recipeIndexes[ordinal] = record.recipeIndex;
            this.totalCosts[ordinal] = record.totalCost;
        });
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
