import { type } from 'arktype';

import type { Item } from '#core/data/item';
import type { MixingRules } from '#core/data/mixing';

export const MixSeedDocumentSchema = type({
    schema: "'neonschedule1-mix-seed-1'",
    gameVersion: 'string',
    datasetSha256: 'string',
    productId: 'string',
    ingredientIds: 'string[]',
});
export type MixSeedDocument = typeof MixSeedDocumentSchema.infer;

export interface MixSeedDataset {
    readonly manifest: {
        readonly gameVersion: string;
        readonly datasetSha256: string;
    };
    readonly items: readonly Item[];
    readonly mixingRules: MixingRules;
}

const tokenPrefix = 'n1m1.';
const maximumTokenLength = 4_096;
const sha256Pattern = /^[a-f0-9]{64}$/u;

export function encodeMixSeed(input: MixSeedDocument): string {
    const document = validateDocument(MixSeedDocumentSchema.assert(input));
    const payload = JSON.stringify([
        document.gameVersion,
        document.datasetSha256,
        document.productId,
        document.ingredientIds,
    ]);
    const token = `${tokenPrefix}${encodeURIComponent(payload)}`;
    if (token.length > maximumTokenLength) {
        throw new RangeError(`Mix seed exceeds ${maximumTokenLength} characters`);
    }
    return token;
}

export function decodeMixSeed(token: string): MixSeedDocument {
    if (!token.startsWith(tokenPrefix)) {
        throw new TypeError('Mix seed has an unsupported version');
    }
    if (token.length > maximumTokenLength) {
        throw new RangeError(`Mix seed exceeds ${maximumTokenLength} characters`);
    }

    let payload: unknown;
    try {
        payload = JSON.parse(decodeURIComponent(token.slice(tokenPrefix.length))) as unknown;
    } catch (error) {
        throw new TypeError('Mix seed payload is malformed', { cause: error });
    }
    if (
        !Array.isArray(payload) ||
        payload.length !== 4 ||
        typeof payload[0] !== 'string' ||
        typeof payload[1] !== 'string' ||
        typeof payload[2] !== 'string' ||
        !Array.isArray(payload[3]) ||
        !payload[3].every((ingredientId) => typeof ingredientId === 'string')
    ) {
        throw new TypeError('Mix seed payload has an invalid structure');
    }

    return validateDocument(MixSeedDocumentSchema.assert({
        schema: 'neonschedule1-mix-seed-1',
        gameVersion: payload[0],
        datasetSha256: payload[1],
        productId: payload[2],
        ingredientIds: payload[3],
    }));
}

export function validateMixSeedForDataset(
    input: MixSeedDocument,
    dataset: MixSeedDataset
): MixSeedDocument {
    const document = validateDocument(MixSeedDocumentSchema.assert(input));
    if (document.gameVersion !== dataset.manifest.gameVersion) {
        throw new Error(
            `Mix seed game version ${JSON.stringify(document.gameVersion)} does not match ` +
            `${JSON.stringify(dataset.manifest.gameVersion)}`
        );
    }
    if (document.datasetSha256 !== dataset.manifest.datasetSha256) {
        throw new Error('Mix seed dataset identity does not match the loaded dataset');
    }

    const itemsById = new Map(dataset.items.map((item) => [item.id, item]));
    const product = itemsById.get(document.productId);
    const productDefinition = product?.product;
    if (
        product === undefined ||
        product.isRuntimeOnly ||
        productDefinition === null ||
        productDefinition === undefined
    ) {
        throw new Error(`Mix seed product ${JSON.stringify(document.productId)} is unavailable`);
    }
    if (!dataset.mixingRules.maps.some((map) => map.drugType === productDefinition.drugType)) {
        throw new Error(
            `Mix seed product ${JSON.stringify(document.productId)} has no mixing map`
        );
    }

    document.ingredientIds.forEach((ingredientId, index) => {
        const ingredient = itemsById.get(ingredientId);
        if (
            ingredient === undefined ||
            ingredient.isRuntimeOnly ||
            ingredient.mixingIngredient?.effectIds[0] === undefined ||
            ingredient.basePurchasePrice === null
        ) {
            throw new Error(
                `Mix seed ingredient ${JSON.stringify(ingredientId)} at index ${index} is unavailable`
            );
        }
    });
    return document;
}

function validateDocument(document: MixSeedDocument): MixSeedDocument {
    requireNonBlank(document.gameVersion, 'game version');
    if (!sha256Pattern.test(document.datasetSha256)) {
        throw new TypeError('Mix seed dataset identity must be a lowercase SHA-256');
    }
    requireNonBlank(document.productId, 'product ID');
    document.ingredientIds.forEach((ingredientId, index) =>
        requireNonBlank(ingredientId, `ingredient ID at index ${index}`)
    );
    return {
        schema: document.schema,
        gameVersion: document.gameVersion,
        datasetSha256: document.datasetSha256,
        productId: document.productId,
        ingredientIds: [...document.ingredientIds],
    };
}

function requireNonBlank(value: string, name: string): void {
    if (value.trim().length === 0) throw new TypeError(`Mix seed ${name} must not be blank`);
}
