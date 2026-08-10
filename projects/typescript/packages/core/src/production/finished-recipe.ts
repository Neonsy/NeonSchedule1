import type { Item } from '#core/data/item';
import type { ProductionCatalog, ProductionStation } from '#core/data/production';
import type { RecipeEvaluation } from '#core/mixing/recipe';
import {
    type ProductionBatchPlan,
    type ProductionPlanDataset,
    type ProductionPurchase,
    ProductionBatchPlanner,
} from '#core/production/plan';

export interface FinishedRecipeProductionOptions {
    readonly mixingStationItemId?: string;
}

export interface FinishedRecipeIngredientDemand {
    readonly itemId: string;
    readonly occurrencesPerFinishedItem: number;
    readonly requiredQuantity: number;
    readonly unitCost: number;
    readonly requiredCost: number;
}

export interface FinishedRecipeMixingStep {
    readonly sequence: number;
    readonly ingredientId: string;
    readonly stationItemId: string;
    readonly stationKind: 'mixing' | 'mixing-mk2';
    readonly capacityPerBatch: number;
    readonly batchQuantities: readonly number[];
    readonly inputProductQuantity: number;
    readonly ingredientQuantity: number;
    readonly outputProductQuantity: number;
    readonly durationMinutesPerItem: number;
    readonly totalProcessMinutes: number;
    readonly requiresManualIngredientInsertion: boolean;
}

export type FinishedRecipeUnmodeledOperation =
    | 'finished-product-additives'
    | 'drying'
    | 'packaging'
    | 'brick-pressing'
    | 'equipment-purchase'
    | 'transport';

export interface FinishedRecipeUnmodeledOperationEvidence {
    readonly operation: FinishedRecipeUnmodeledOperation;
    readonly applicability: 'not-established';
    readonly materialCost: null;
    readonly processMinutes: null;
}

export interface FinishedRecipeProductionEvidence {
    readonly modeledScope: 'base-product-and-ordered-mixing';
    readonly modeledQuantityProof: 'exact';
    readonly materialCostCoverage: 'modeled-materials-only';
    readonly modeledDurationProof: 'complete' | 'partial';
    readonly finishedLifecycleProof: 'partial';
    readonly missingFacts: readonly 'mixing-station'[];
    readonly unmodeledOperations: readonly FinishedRecipeUnmodeledOperationEvidence[];
}

export interface FinishedRecipeProductionDuration {
    readonly baseProductProcessMinutes: number;
    readonly mixingProcessMinutes: number | null;
    readonly knownProcessMinutes: number;
    readonly modeledTotalProcessMinutes: number | null;
}

export interface FinishedRecipeProductionCost {
    readonly recipeEstimatedUnitMaterialCost: number;
    readonly recipeEstimatedMaterialCost: number;
    readonly requiredMaterialCost: number;
    readonly purchaseCost: number;
}

export interface FinishedRecipeProductionPlan {
    readonly dataset: ProductionPlanDataset;
    readonly recipe: RecipeEvaluation;
    readonly finishedQuantity: number;
    readonly baseProductPlan: ProductionBatchPlan;
    readonly ingredientDemands: readonly FinishedRecipeIngredientDemand[];
    readonly purchases: readonly ProductionPurchase[];
    readonly mixingSteps: readonly FinishedRecipeMixingStep[];
    readonly duration: FinishedRecipeProductionDuration;
    readonly cost: FinishedRecipeProductionCost;
    readonly evidence: FinishedRecipeProductionEvidence;
}

type MixingStation = Extract<
    ProductionStation,
    { readonly kind: 'mixing' | 'mixing-mk2' }
>;

const unmodeledOperationKinds: readonly FinishedRecipeUnmodeledOperation[] = [
    'finished-product-additives',
    'drying',
    'packaging',
    'brick-pressing',
    'equipment-purchase',
    'transport',
];

const unmodeledOperations: readonly FinishedRecipeUnmodeledOperationEvidence[] =
    unmodeledOperationKinds.map((operation) => ({
        operation,
        applicability: 'not-established',
        materialCost: null,
        processMinutes: null,
    }));

export class FinishedRecipeProductionPlanner {
    readonly #baseProducts: ProductionBatchPlanner;
    readonly #itemsById: ReadonlyMap<string, Item>;
    readonly #catalog: ProductionCatalog;

    constructor(
        baseProducts: ProductionBatchPlanner,
        itemsById: ReadonlyMap<string, Item>,
        catalog: ProductionCatalog
    ) {
        this.#baseProducts = baseProducts;
        this.#itemsById = itemsById;
        this.#catalog = catalog;
    }

    plan(
        recipe: RecipeEvaluation,
        finishedQuantity: number,
        options: FinishedRecipeProductionOptions = {}
    ): FinishedRecipeProductionPlan {
        requirePositiveInteger(finishedQuantity, 'finishedQuantity');
        const ingredientDemands = this.#ingredientDemands(recipe, finishedQuantity);
        const baseProductPlan = this.#baseProducts.plan(recipe.productId, finishedQuantity);
        assertCompatibleCostBasis(recipe, baseProductPlan);
        const station = this.#mixingStation(options.mixingStationItemId);
        const needsMixing = recipe.ingredientIds.length > 0;
        const mixingSteps = station === null
            ? []
            : recipe.ingredientIds.map((ingredientId, sequence) =>
                  mixingStep(station, ingredientId, sequence, finishedQuantity)
              );
        const mixingProcessMinutes = needsMixing && station === null
            ? null
            : mixingSteps.reduce((total, step) => total + step.totalProcessMinutes, 0);
        const purchaseDemands = mergePurchases(baseProductPlan.purchases, ingredientDemands);
        const requiredMaterialCost = purchaseDemands.reduce(
            (total, purchase) => total + purchase.requiredCost,
            0
        );
        const purchaseCost = purchaseDemands.reduce(
            (total, purchase) => total + purchase.purchaseCost,
            0
        );
        const knownProcessMinutes =
            baseProductPlan.totalProcessMinutes + (mixingProcessMinutes ?? 0);

        return {
            dataset: { ...baseProductPlan.dataset },
            recipe: cloneRecipe(recipe),
            finishedQuantity,
            baseProductPlan,
            ingredientDemands,
            purchases: purchaseDemands,
            mixingSteps,
            duration: {
                baseProductProcessMinutes: baseProductPlan.totalProcessMinutes,
                mixingProcessMinutes,
                knownProcessMinutes,
                modeledTotalProcessMinutes:
                    mixingProcessMinutes === null ? null : knownProcessMinutes,
            },
            cost: {
                recipeEstimatedUnitMaterialCost: recipe.totalCost,
                recipeEstimatedMaterialCost: recipe.totalCost * finishedQuantity,
                requiredMaterialCost,
                purchaseCost,
            },
            evidence: {
                modeledScope: 'base-product-and-ordered-mixing',
                modeledQuantityProof: 'exact',
                materialCostCoverage: 'modeled-materials-only',
                modeledDurationProof: mixingProcessMinutes === null ? 'partial' : 'complete',
                finishedLifecycleProof: 'partial',
                missingFacts: mixingProcessMinutes === null ? ['mixing-station'] : [],
                unmodeledOperations: unmodeledOperations.map((operation) => ({ ...operation })),
            },
        };
    }

    #ingredientDemands(
        recipe: RecipeEvaluation,
        finishedQuantity: number
    ): FinishedRecipeIngredientDemand[] {
        if (recipe.ingredientCount !== recipe.ingredientIds.length) {
            throw new Error('Recipe ingredient count does not match its ordered ingredient IDs');
        }
        const occurrences = new Map<string, number>();
        for (const ingredientId of recipe.ingredientIds) {
            const item = this.#itemsById.get(ingredientId);
            if (item === undefined) {
                throw new Error(`Unknown mixing ingredient ${JSON.stringify(ingredientId)}`);
            }
            if (item.mixingIngredient === null) {
                throw new Error(`Item ${JSON.stringify(ingredientId)} is not a mixing ingredient`);
            }
            if (item.basePurchasePrice === null) {
                throw new Error(
                    `Mixing ingredient ${JSON.stringify(ingredientId)} has no purchase price`
                );
            }
            occurrences.set(ingredientId, (occurrences.get(ingredientId) ?? 0) + 1);
        }

        const demands = [...occurrences]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([itemId, occurrencesPerFinishedItem]) => {
                const unitCost = this.#itemsById.get(itemId)?.basePurchasePrice;
                if (unitCost === null || unitCost === undefined) {
                    throw new Error(
                        `Mixing ingredient ${JSON.stringify(itemId)} has no purchase price`
                    );
                }
                const requiredQuantity = occurrencesPerFinishedItem * finishedQuantity;
                return {
                    itemId,
                    occurrencesPerFinishedItem,
                    requiredQuantity,
                    unitCost,
                    requiredCost: requiredQuantity * unitCost,
                };
            });
        const evaluatedCost = demands.reduce(
            (total, demand) => total + demand.unitCost * demand.occurrencesPerFinishedItem,
            0
        );
        requireClose(evaluatedCost, recipe.ingredientCost, 'Recipe ingredient cost');
        requireClose(
            recipe.baseProductCost + recipe.ingredientCost,
            recipe.totalCost,
            'Recipe total cost'
        );
        return demands;
    }

    #mixingStation(itemId: string | undefined): MixingStation | null {
        if (itemId === undefined) return null;
        const station = this.#catalog.stations.find((candidate) => candidate.itemId === itemId);
        if (station?.kind !== 'mixing' && station?.kind !== 'mixing-mk2') {
            throw new Error(`Unknown mixing station ${JSON.stringify(itemId)}`);
        }
        requirePositiveInteger(
            station.capacity,
            `Mixing station ${JSON.stringify(itemId)} capacity`
        );
        requirePositive(
            station.timePerItem,
            `Mixing station ${JSON.stringify(itemId)} time per item`
        );
        return station;
    }
}

function mixingStep(
    station: MixingStation,
    ingredientId: string,
    sequence: number,
    quantity: number
): FinishedRecipeMixingStep {
    return {
        sequence,
        ingredientId,
        stationItemId: station.itemId,
        stationKind: station.kind,
        capacityPerBatch: station.capacity,
        batchQuantities: splitBatches(quantity, station.capacity),
        inputProductQuantity: quantity,
        ingredientQuantity: quantity,
        outputProductQuantity: quantity,
        durationMinutesPerItem: station.timePerItem,
        totalProcessMinutes: quantity * station.timePerItem,
        requiresManualIngredientInsertion: station.requiresManualIngredientInsertion,
    };
}

function splitBatches(quantity: number, capacity: number): number[] {
    const batches: number[] = [];
    for (let remaining = quantity; remaining > 0; remaining -= capacity) {
        batches.push(Math.min(remaining, capacity));
    }
    return batches;
}

function mergePurchases(
    basePurchases: readonly ProductionPurchase[],
    ingredientDemands: readonly FinishedRecipeIngredientDemand[]
): ProductionPurchase[] {
    const requiredByItem = new Map<string, { requiredQuantity: number; unitCost: number }>();
    for (const purchase of basePurchases) {
        addPurchaseDemand(
            requiredByItem,
            purchase.itemId,
            purchase.requiredQuantity,
            purchase.unitCost
        );
    }
    for (const demand of ingredientDemands) {
        addPurchaseDemand(requiredByItem, demand.itemId, demand.requiredQuantity, demand.unitCost);
    }
    return [...requiredByItem]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([itemId, demand]) => {
            const purchaseQuantity = ceilWhole(demand.requiredQuantity);
            return {
                itemId,
                requiredQuantity: demand.requiredQuantity,
                purchaseQuantity,
                leftoverQuantity: cleanZero(purchaseQuantity - demand.requiredQuantity),
                unitCost: demand.unitCost,
                requiredCost: demand.requiredQuantity * demand.unitCost,
                purchaseCost: purchaseQuantity * demand.unitCost,
            };
        });
}

function addPurchaseDemand(
    demands: Map<string, { requiredQuantity: number; unitCost: number }>,
    itemId: string,
    requiredQuantity: number,
    unitCost: number
): void {
    const current = demands.get(itemId);
    if (current !== undefined) {
        requireClose(current.unitCost, unitCost, `Purchase price for ${JSON.stringify(itemId)}`);
    }
    demands.set(itemId, {
        requiredQuantity: (current?.requiredQuantity ?? 0) + requiredQuantity,
        unitCost,
    });
}

function assertCompatibleCostBasis(
    recipe: RecipeEvaluation,
    baseProductPlan: ProductionBatchPlan
): void {
    const basis = baseProductPlan.productionSteps.length === 0
        ? 'base-purchase-price'
        : 'production-materials';
    if (recipe.baseProductCostBasis !== basis) {
        throw new Error(
            `Recipe base-product cost basis ${JSON.stringify(recipe.baseProductCostBasis)} does not match production plan basis ${JSON.stringify(basis)}`
        );
    }
}

function cloneRecipe(recipe: RecipeEvaluation): RecipeEvaluation {
    return {
        ...recipe,
        ingredientIds: [...recipe.ingredientIds],
        effectIds: [...recipe.effectIds],
    };
}

function ceilWhole(value: number): number {
    const nearest = Math.round(value);
    return Math.abs(value - nearest) <= 1e-9 ? nearest : Math.ceil(value);
}

function cleanZero(value: number): number {
    return Math.abs(value) <= 1e-9 ? 0 : value;
}

function requirePositive(value: number, label: string): void {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`);
}

function requirePositiveInteger(value: number, label: string): void {
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${label} must be a positive integer`);
    }
}

function requireClose(actual: number, expected: number, label: string): void {
    const tolerance = Math.max(1, Math.abs(actual), Math.abs(expected)) * 1e-9;
    if (
        !Number.isFinite(actual) ||
        !Number.isFinite(expected) ||
        Math.abs(actual - expected) > tolerance
    ) {
        throw new Error(`${label} is incompatible with normalized item prices`);
    }
}
