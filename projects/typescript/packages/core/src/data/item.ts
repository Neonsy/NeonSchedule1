import { type } from 'arktype';

export const ProductSchema = type({
    drugType: 'string',
    basePrice: 'number',
    marketValue: 'number',
    baseAddictiveness: 'number',
    effectIds: 'string[]',
    validPackagingIds: 'string[]',
});
export type Product = typeof ProductSchema.infer;

export const PackagingSchema = type({
    quantity: 'number',
    basePurchasePrice: 'number',
});
export type Packaging = typeof PackagingSchema.infer;

export const AdditiveSchema = type({
    qualityChange: 'number',
    yieldMultiplier: 'number',
    instantGrowth: 'number',
});
export type Additive = typeof AdditiveSchema.infer;

export const SoilSchema = type({ quality: 'string', uses: 'number' });
export type Soil = typeof SoilSchema.infer;

export const MixingIngredientSchema = type({ effectIds: 'string[]' });
export type MixingIngredient = typeof MixingIngredientSchema.infer;

export const ItemPresentationSchema = type({
    description: 'string',
    iconFileId: 'string | null',
    visualKind: "'icon' | 'variant-dependent' | 'model' | 'none'",
    fallbackMeshIds: 'string[]',
    fallbackMaterialIds: 'string[]',
});
export type ItemPresentation = typeof ItemPresentationSchema.infer;

export const ItemSchema = type({
    schema: "'neonschedule1-item-3'",
    id: 'string',
    name: 'string',
    category: 'string',
    isRuntimeOnly: 'boolean',
    stackLimit: 'number',
    isStorable: 'boolean',
    basePurchasePrice: 'number | null',
    resellMultiplier: 'number',
    requiredRank: 'string | null',
    requiredRankTier: 'number | null',
    product: ProductSchema.or('null'),
    packaging: PackagingSchema.or('null'),
    additive: AdditiveSchema.or('null'),
    soil: SoilSchema.or('null'),
    mixingIngredient: MixingIngredientSchema.or('null'),
    presentation: ItemPresentationSchema,
});
export type Item = typeof ItemSchema.infer;
