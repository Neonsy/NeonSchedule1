import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

import type { RecipeCorpusIndex } from '#solver/precompute-index';
import {
    RuntimeRecipeCorpusIndex,
    consumeRecipeCorpusIndexColumns,
    type CorpusPartitionIdentity,
    type PartitionOrdinals,
} from '#solver/runtime-index';

export interface BinaryRecipeCorpusIndexFile {
    readonly path: 'lookup.bin';
    readonly sha256: string;
    readonly byteLength: number;
}

interface PostingDescriptor {
    readonly key: string;
    readonly length: number;
}

interface BinaryHeader {
    readonly schema: 'neonschedule1-recipe-corpus-index-binary-2';
    readonly recordCount: number;
    readonly partitionOrdinalBytes: 1 | 2 | 4;
    readonly partitions: readonly CorpusPartitionIdentity[];
    readonly postings: {
        readonly products: readonly PostingDescriptor[];
        readonly effects: readonly PostingDescriptor[];
        readonly ingredients: readonly PostingDescriptor[];
    };
}

const magic = Buffer.from([0x4e, 0x53, 0x31, 0x49, 0x44, 0x58, 0x33, 0x00]);
const prefixLength = magic.length + Uint32Array.BYTES_PER_ELEMENT;
const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

export async function writeBinaryRecipeCorpusIndex(
    outputPath: string,
    source: RecipeCorpusIndex,
    partitions: readonly CorpusPartitionIdentity[]
): Promise<BinaryRecipeCorpusIndexFile> {
    const columns = consumeRecipeCorpusIndexColumns(source, partitions);
    const header: BinaryHeader = {
        schema: 'neonschedule1-recipe-corpus-index-binary-2',
        recordCount: columns.recipeIndexes.length,
        partitionOrdinalBytes: columns.partitionOrdinals.BYTES_PER_ELEMENT as 1 | 2 | 4,
        partitions,
        postings: {
            products: describePostings(columns.postings.products),
            effects: describePostings(columns.postings.effects),
            ingredients: describePostings(columns.postings.ingredients),
        },
    };
    const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
    if (headerBytes.byteLength > 0xffff_ffff) {
        throw new Error('Recipe index binary header is too large');
    }
    const prefix = Buffer.alloc(prefixLength);
    magic.copy(prefix);
    prefix.writeUInt32LE(headerBytes.byteLength, magic.length);

    const output = await open(outputPath, 'wx');
    const digest = createHash('sha256');
    let byteLength = 0;
    const write = async (content: Uint8Array): Promise<void> => {
        await output.writeFile(content);
        digest.update(content);
        byteLength += content.byteLength;
    };
    const align = async (alignment: number): Promise<void> => {
        const padding = paddingFor(byteLength, alignment);
        if (padding > 0) await write(Buffer.alloc(padding));
    };
    const writeColumn = async (column: PartitionOrdinals | Uint32Array | Float64Array) => {
        await align(column.BYTES_PER_ELEMENT);
        await write(littleEndianBytes(column));
    };
    try {
        await write(prefix);
        await write(headerBytes);
        await align(Float64Array.BYTES_PER_ELEMENT);
        await writeColumn(columns.partitionOrdinals);
        await writeColumn(columns.recipeIndexes);
        await writeColumn(columns.totalCosts);
        await writeColumn(columns.ingredientCounts);
        for (const descriptor of header.postings.products) {
            await writeColumn(columns.postings.products[descriptor.key]!);
        }
        for (const descriptor of header.postings.effects) {
            await writeColumn(columns.postings.effects[descriptor.key]!);
        }
        for (const descriptor of header.postings.ingredients) {
            await writeColumn(columns.postings.ingredients[descriptor.key]!);
        }
        await writeColumn(columns.rankings.productValue);
        await writeColumn(columns.rankings.netValue);
        await writeColumn(columns.totalCostOrder);
    } finally {
        await output.close();
    }
    return {
        path: 'lookup.bin',
        sha256: digest.digest('hex'),
        byteLength,
    };
}

export function readBinaryRecipeCorpusIndex(content: Buffer): RuntimeRecipeCorpusIndex {
    if (content.byteLength < prefixLength || !content.subarray(0, magic.length).equals(magic)) {
        throw new Error('Recipe index binary file has an unsupported contract');
    }
    const headerLength = content.readUInt32LE(magic.length);
    const headerEnd = prefixLength + headerLength;
    if (headerLength === 0 || headerEnd > content.byteLength) {
        throw new Error('Recipe index binary header is truncated');
    }
    const header = parseHeader(JSON.parse(content.toString('utf8', prefixLength, headerEnd)));
    let offset = aligned(headerEnd, Float64Array.BYTES_PER_ELEMENT);
    const take = <T>(
        length: number,
        bytesPerElement: number,
        view: (start: number, length: number) => T
    ): T => {
        offset = aligned(offset, bytesPerElement);
        const start = offset;
        const byteLength = length * bytesPerElement;
        offset += byteLength;
        if (!Number.isSafeInteger(byteLength) || offset > content.byteLength) {
            throw new Error('Recipe index binary column is truncated');
        }
        return view(start, length);
    };
    const partitionOrdinals = take(
        header.recordCount,
        header.partitionOrdinalBytes,
        (start, length) => partitionView(content, start, length, header.partitionOrdinalBytes)
    );
    const recipeIndexes = take(
        header.recordCount,
        Uint32Array.BYTES_PER_ELEMENT,
        (start, length) => uint32View(content, start, length)
    );
    const totalCosts = take(
        header.recordCount,
        Float64Array.BYTES_PER_ELEMENT,
        (start, length) => float64View(content, start, length)
    );
    const ingredientCounts = take(
        header.recordCount,
        Uint32Array.BYTES_PER_ELEMENT,
        (start, length) => uint32View(content, start, length)
    );
    const products = readPostings(header.postings.products, take, content);
    const effects = readPostings(header.postings.effects, take, content);
    const ingredients = readPostings(header.postings.ingredients, take, content);
    const productValue = take(
        header.recordCount,
        Uint32Array.BYTES_PER_ELEMENT,
        (start, length) => uint32View(content, start, length)
    );
    const netValue = take(
        header.recordCount,
        Uint32Array.BYTES_PER_ELEMENT,
        (start, length) => uint32View(content, start, length)
    );
    const totalCostOrder = take(
        header.recordCount,
        Uint32Array.BYTES_PER_ELEMENT,
        (start, length) => uint32View(content, start, length)
    );
    if (offset !== content.byteLength) {
        throw new Error('Recipe index binary file contains trailing bytes');
    }
    return RuntimeRecipeCorpusIndex.fromColumns({
        partitions: header.partitions,
        partitionOrdinals,
        recipeIndexes,
        totalCosts,
        ingredientCounts,
        postings: { products, effects, ingredients },
        rankings: { productValue, netValue },
        totalCostOrder,
    });
}

function describePostings(
    postings: Readonly<Record<string, Uint32Array>>
): PostingDescriptor[] {
    return Object.entries(postings).map(([key, values]) => ({ key, length: values.length }));
}

function readPostings(
    descriptors: readonly PostingDescriptor[],
    take: <T>(
        length: number,
        bytesPerElement: number,
        view: (start: number, length: number) => T
    ) => T,
    content: Buffer
): Readonly<Record<string, Uint32Array>> {
    return Object.fromEntries(descriptors.map((descriptor) => [
        descriptor.key,
        take(
            descriptor.length,
            Uint32Array.BYTES_PER_ELEMENT,
            (start, length) => uint32View(content, start, length)
        ),
    ]));
}

function parseHeader(value: unknown): BinaryHeader {
    const record = object(value, 'Recipe index binary header');
    if (record.schema !== 'neonschedule1-recipe-corpus-index-binary-2') {
        throw new Error('Recipe index binary file has an unsupported contract');
    }
    const recordCount = integer(record.recordCount, 'binary.recordCount');
    if (recordCount > 0xffff_ffff) throw new Error('Recipe index exceeds the ordinal range');
    const partitionOrdinalBytes = record.partitionOrdinalBytes;
    if (partitionOrdinalBytes !== 1 && partitionOrdinalBytes !== 2 &&
        partitionOrdinalBytes !== 4) {
        throw new Error('Recipe index has an unsupported partition column');
    }
    const partitions = array(record.partitions, 'binary.partitions').map((value_, index) => {
        const partition = object(value_, `binary.partitions[${index}]`);
        return {
            path: string(partition.path, `binary.partitions[${index}].path`),
            recipeCount: integer(
                partition.recipeCount,
                `binary.partitions[${index}].recipeCount`
            ),
        };
    });
    unique(partitions.map((partition) => partition.path), 'partition path');
    const postings = object(record.postings, 'binary.postings');
    return {
        schema: record.schema,
        recordCount,
        partitionOrdinalBytes,
        partitions,
        postings: {
            products: postingDescriptors(postings.products, 'binary.postings.products'),
            effects: postingDescriptors(postings.effects, 'binary.postings.effects'),
            ingredients: postingDescriptors(
                postings.ingredients,
                'binary.postings.ingredients'
            ),
        },
    };
}

function postingDescriptors(value: unknown, label: string): PostingDescriptor[] {
    const descriptors = array(value, label).map((value_, index) => {
        const descriptor = object(value_, `${label}[${index}]`);
        return {
            key: string(descriptor.key, `${label}[${index}].key`),
            length: integer(descriptor.length, `${label}[${index}].length`),
        };
    });
    unique(descriptors.map((descriptor) => descriptor.key), `${label} key`);
    return descriptors;
}

function partitionView(
    content: Buffer,
    start: number,
    length: number,
    bytes: 1 | 2 | 4
): PartitionOrdinals {
    if (bytes === 1) return uint8View(content, start, length);
    if (bytes === 2) return uint16View(content, start, length);
    return uint32View(content, start, length);
}

function uint8View(content: Buffer, start: number, length: number): Uint8Array {
    return new Uint8Array(content.buffer, content.byteOffset + start, length);
}

function uint16View(content: Buffer, start: number, length: number): Uint16Array {
    return typedView(content, start, length, Uint16Array.BYTES_PER_ELEMENT, Uint16Array, 16);
}

function uint32View(content: Buffer, start: number, length: number): Uint32Array {
    return typedView(content, start, length, Uint32Array.BYTES_PER_ELEMENT, Uint32Array, 32);
}

function float64View(content: Buffer, start: number, length: number): Float64Array {
    return typedView(content, start, length, Float64Array.BYTES_PER_ELEMENT, Float64Array, 64);
}

function typedView<T extends Uint16Array | Uint32Array | Float64Array>(
    content: Buffer,
    start: number,
    length: number,
    bytes: number,
    Type: new (buffer: ArrayBufferLike, byteOffset: number, length: number) => T,
    swapBits: 16 | 32 | 64
): T {
    const absolute = content.byteOffset + start;
    if (littleEndian && absolute % bytes === 0) {
        return new Type(content.buffer, absolute, length);
    }
    const arrayBuffer = new ArrayBuffer(length * bytes);
    const copy = Buffer.from(arrayBuffer);
    content.copy(copy, 0, start, start + length * bytes);
    if (!littleEndian) copy[`swap${swapBits}`]();
    return new Type(arrayBuffer, 0, length);
}

function littleEndianBytes(column: PartitionOrdinals | Uint32Array | Float64Array): Buffer {
    const content = Buffer.from(column.buffer, column.byteOffset, column.byteLength);
    if (littleEndian || column.BYTES_PER_ELEMENT === 1) return content;
    const copy = Buffer.from(content);
    if (column.BYTES_PER_ELEMENT === 2) copy.swap16();
    else if (column.BYTES_PER_ELEMENT === 4) copy.swap32();
    else copy.swap64();
    return copy;
}

function aligned(offset: number, alignment: number): number {
    return offset + paddingFor(offset, alignment);
}

function paddingFor(offset: number, alignment: number): number {
    return (alignment - offset % alignment) % alignment;
}

function unique(values: readonly string[], label: string): void {
    if (new Set(values).size !== values.length) throw new Error(`Duplicate recipe index ${label}`);
}

function object(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
    if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
    return value;
}

function string(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`${label} must be a non-empty string`);
    }
    return value;
}

function integer(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new Error(`${label} must be a non-negative safe integer`);
    }
    return value as number;
}
