import {
    ItemSchema,
    type Additive,
    type Item,
    type ItemPresentation,
    type MixingIngredient,
    type Packaging,
    type Product,
    type Soil,
} from '@neonschedule1/core';

import type { VerifiedAssets } from '#data-compiler/acquisition/assets';
import type { RawReport } from '#data-compiler/acquisition/types';
import { indexUnique, Integrity, requireReferences } from '#data-compiler/integrity';
import {
    asObject,
    booleanField,
    nullableNumberField,
    numberField,
    objectArray,
    stringArrayField,
    stringField,
    type JsonObject,
} from '#data-compiler/json';
import { fileIdForDescriptor } from '#data-compiler/normalize/shared';

const runtimeOnlyItemIds = new Set(['cuke_effects', 'defaultweed', 'energy_drink_effects']);

export function normalizeItems(report: RawReport, assets: VerifiedAssets, integrity: Integrity): Item[] {
    const itemIndex = indexUnique(report.items, 'id', 'report.items', integrity);
    const productIndex = indexUnique(report.products, 'id', 'report.products', integrity);
    const packagingIndex = indexUnique(report.packaging, 'itemId', 'report.packaging', integrity);
    const additiveIndex = indexUnique(report.additives, 'itemId', 'report.additives', integrity);
    const soilIndex = indexUnique(report.soils, 'itemId', 'report.soils', integrity);
    const mixingIngredientIndex = indexUnique(
        report.mixing.ingredients,
        'id',
        'report.mixing.ingredients',
        integrity
    );
    const presentationIndex = indexUnique(
        report.discovery.itemPresentations,
        'itemId',
        'report.discovery.itemPresentations',
        integrity
    );
    const itemIds = new Set(itemIndex.keys());

    requireReferences(productIndex.keys(), itemIds, 'product', integrity);
    requireReferences(packagingIndex.keys(), itemIds, 'packaging', integrity);
    requireReferences(additiveIndex.keys(), itemIds, 'additive', integrity);
    requireReferences(soilIndex.keys(), itemIds, 'soil', integrity);
    requireReferences(mixingIngredientIndex.keys(), itemIds, 'mixing ingredient', integrity);
    requireReferences(presentationIndex.keys(), itemIds, 'item presentation', integrity);
    integrity.check(
        'every item has one presentation',
        presentationIndex.size === itemIndex.size,
        `Expected ${itemIndex.size} item presentations, found ${presentationIndex.size}`
    );

    const items = [...itemIndex.entries()]
        .map(([id, raw]) => {
            const rawPath = `report.items[${JSON.stringify(id)}]`;
            const requiresRank = booleanField(raw, 'requiresLevelToPurchase', rawPath);
            const category = stringField(raw, 'category', rawPath);
            const product = productIndex.get(id);
            const packaging = packagingIndex.get(id);
            const additive = additiveIndex.get(id);
            const soil = soilIndex.get(id);
            const mixingIngredient = mixingIngredientIndex.get(id);
            const presentation = presentationIndex.get(id);
            if (presentation === undefined) {
                integrity.addError(`Item ${JSON.stringify(id)} has no presentation`);
            }

            const isRuntimeOnly = runtimeOnlyItemIds.has(id);
            if (category === 'Product' && product === undefined && !isRuntimeOnly) {
                integrity.addError(`Product-category item ${JSON.stringify(id)} has no product record`);
            }
            if (isRuntimeOnly && (category !== 'Product' || product !== undefined)) {
                integrity.addError(`Runtime-only item ${JSON.stringify(id)} no longer matches its verified shape`);
            }
            const item: Item = {
                schema: 'neonschedule1-item-3',
                id,
                name: stringField(raw, 'name', rawPath),
                category,
                isRuntimeOnly,
                stackLimit: numberField(raw, 'stackLimit', rawPath),
                isStorable: booleanField(raw, 'isStorable', rawPath),
                basePurchasePrice: nullableNumberField(raw, 'basePurchasePrice', rawPath),
                resellMultiplier: numberField(raw, 'resellMultiplier', rawPath),
                requiredRank: requiresRank ? stringField(raw, 'requiredRank', rawPath) : null,
                requiredRankTier: requiresRank ? numberField(raw, 'requiredRankTier', rawPath) : null,
                product: product === undefined ? null : normalizeProduct(product, `${rawPath}.product`),
                packaging: packaging === undefined ? null : normalizePackaging(packaging, `${rawPath}.packaging`),
                additive: additive === undefined ? null : normalizeAdditive(additive, `${rawPath}.additive`),
                soil: soil === undefined ? null : normalizeSoil(soil, `${rawPath}.soil`),
                mixingIngredient:
                    mixingIngredient === undefined
                        ? null
                        : normalizeMixingIngredient(
                              mixingIngredient,
                              `report.mixing.ingredients[${JSON.stringify(id)}]`
                          ),
                presentation: normalizePresentation(
                    presentation,
                    `${rawPath}.presentation`,
                    packaging !== undefined,
                    isRuntimeOnly,
                    assets,
                    integrity
                ),
            };
            if (item.product !== null) {
                requireReferences(item.product.validPackagingIds, itemIds, `product ${id}`, integrity);
                if (product !== undefined) validateProductEconomics(id, product, item, integrity);
            }
            if (mixingIngredient !== undefined) {
                validateMixingIngredient(id, mixingIngredient, item, integrity);
            }
            return ItemSchema.assert(item);
        })
        .sort((left, right) => left.id.localeCompare(right.id));

    integrity.check(
        'normalized item count matches the report',
        items.length === report.items.length,
        `Expected ${report.items.length} normalized items, produced ${items.length}`
    );
    integrity.check(
        'every mixing ingredient is attached to one item',
        items.filter((item) => item.mixingIngredient !== null).length === mixingIngredientIndex.size,
        `Expected ${mixingIngredientIndex.size} mixing ingredients on items`
    );
    validatePackagingContracts(items, integrity);
    return items;
}

function validatePackagingContracts(items: readonly Item[], integrity: Integrity): void {
    const packagingById = new Map(
        items
            .filter((item) => item.packaging !== null)
            .map((item) => [item.id, item.packaging] as const)
    );
    for (const item of items) {
        if (item.packaging !== null) {
            integrity.check(
                `packaging ${item.id} contains a positive integer product quantity`,
                Number.isInteger(item.packaging.quantity) && item.packaging.quantity > 0,
                `Packaging ${JSON.stringify(item.id)} quantity must be a positive integer`
            );
            integrity.check(
                `packaging ${item.id} has a non-negative purchase price`,
                Number.isFinite(item.packaging.basePurchasePrice) &&
                    item.packaging.basePurchasePrice >= 0,
                `Packaging ${JSON.stringify(item.id)} purchase price must be non-negative`
            );
            integrity.check(
                `packaging ${item.id} purchase price matches its item`,
                item.packaging.basePurchasePrice === item.basePurchasePrice,
                `Packaging ${JSON.stringify(item.id)} basePurchasePrice differs from its item`
            );
        }
        if (item.product === null) continue;
        integrity.check(
            `product ${item.id} valid packaging IDs are unique`,
            new Set(item.product.validPackagingIds).size === item.product.validPackagingIds.length,
            `Product ${JSON.stringify(item.id)} has duplicate valid packaging IDs`
        );
        for (const packagingId of item.product.validPackagingIds) {
            integrity.check(
                `product ${item.id} packaging ${packagingId} is a packaging definition`,
                packagingById.has(packagingId),
                `Product ${JSON.stringify(item.id)} references non-packaging item ${JSON.stringify(packagingId)}`
            );
        }
    }
}

function normalizePresentation(
    raw: JsonObject | undefined,
    path: string,
    isPackaging: boolean,
    isRuntimeOnly: boolean,
    assets: VerifiedAssets,
    integrity: Integrity
): ItemPresentation {
    if (raw === undefined) {
        return {
            description: '',
            iconFileId: null,
            visualKind: 'none',
            fallbackMeshIds: [],
            fallbackMaterialIds: [],
        };
    }

    const iconFileId = fileIdForDescriptor(raw.icon, `${path}.icon`, assets, integrity);
    const fallback =
        raw.fallbackVisuals === undefined ? null : asObject(raw.fallbackVisuals, `${path}.fallbackVisuals`);
    const fallbackMeshIds = fallback === null
        ? []
        : objectArray(fallback.meshes, `${path}.fallbackVisuals.meshes`)
              .map((mesh, index) =>
                  stringField(mesh, 'meshAssetReferenceKey', `${path}.fallbackVisuals.meshes[${index}]`)
              )
              .filter(Boolean);
    const fallbackMaterialIds = fallback === null
        ? []
        : objectArray(fallback.renderers, `${path}.fallbackVisuals.renderers`).flatMap((renderer, index) =>
              stringArrayField(renderer, 'materialAssetReferenceKeys', `${path}.fallbackVisuals.renderers[${index}]`)
          );
    const uniqueMeshIds = [...new Set(fallbackMeshIds)].sort();
    const uniqueMaterialIds = [...new Set(fallbackMaterialIds)].sort();
    const hasModel = uniqueMeshIds.length > 0 || uniqueMaterialIds.length > 0;
    let visualKind: ItemPresentation['visualKind'] = 'none';
    if (iconFileId !== null) visualKind = 'icon';
    else if (!isRuntimeOnly && isPackaging) visualKind = 'variant-dependent';
    else if (!isRuntimeOnly && hasModel) visualKind = 'model';

    if (visualKind === 'none' && !isRuntimeOnly) {
        integrity.addError(`${path} has no icon, variant presentation, or fallback model`);
    }

    return {
        description: stringField(raw, 'description', path),
        iconFileId,
        visualKind,
        fallbackMeshIds: uniqueMeshIds,
        fallbackMaterialIds: uniqueMaterialIds,
    };
}

function normalizeProduct(raw: JsonObject, path: string): Product {
    return {
        drugType: stringField(raw, 'drugType', path),
        basePrice: numberField(raw, 'basePrice', path),
        marketValue: numberField(raw, 'marketValue', path),
        baseAddictiveness: numberField(raw, 'baseAddictiveness', path),
        effectIds: stringArrayField(raw, 'effectIds', path),
        validPackagingIds: stringArrayField(raw, 'validPackagingIds', path).sort(),
    };
}

function validateProductEconomics(id: string, raw: JsonObject, item: Item, integrity: Integrity): void {
    const path = `report.products[${JSON.stringify(id)}]`;
    const productPurchasePrice = numberField(raw, 'basePurchasePrice', path);
    if (productPurchasePrice !== item.basePurchasePrice) {
        integrity.addError(`Product ${JSON.stringify(id)} basePurchasePrice differs from its item`);
    }
}

function normalizePackaging(raw: JsonObject, path: string): Packaging {
    return {
        quantity: numberField(raw, 'quantity', path),
        basePurchasePrice: numberField(raw, 'basePurchasePrice', path),
    };
}

function normalizeAdditive(raw: JsonObject, path: string): Additive {
    return {
        qualityChange: numberField(raw, 'qualityChange', path),
        yieldMultiplier: numberField(raw, 'yieldMultiplier', path),
        instantGrowth: numberField(raw, 'instantGrowth', path),
    };
}

function normalizeSoil(raw: JsonObject, path: string): Soil {
    return {
        quality: stringField(raw, 'quality', path),
        uses: numberField(raw, 'uses', path),
    };
}

function normalizeMixingIngredient(raw: JsonObject, path: string): MixingIngredient {
    return { effectIds: stringArrayField(raw, 'effectIds', path) };
}

function validateMixingIngredient(
    id: string,
    raw: JsonObject,
    item: Item,
    integrity: Integrity
): void {
    const path = `report.mixing.ingredients[${JSON.stringify(id)}]`;
    const comparisons = [
        ['name', stringField(raw, 'name', path), item.name],
        ['basePurchasePrice', numberField(raw, 'basePurchasePrice', path), item.basePurchasePrice],
        ['resellMultiplier', numberField(raw, 'resellMultiplier', path), item.resellMultiplier],
    ] as const;
    for (const [field, ingredientValue, itemValue] of comparisons) {
        if (ingredientValue !== itemValue) {
            integrity.addError(`Mixing ingredient ${JSON.stringify(id)} ${field} differs from its item`);
        }
    }
}
