import type { Item } from '#core/data/item';
import type { ProductionCatalog, ProductionStation } from '#core/data/production';
import type { RecipeEvaluation } from '#core/mixing/recipe';
import {
    isBrickPressingAvailable,
    planFinishedRecipeBrickPressing,
    type FinishedRecipeBrickPressingOptions,
    type FinishedRecipeBrickPressingStep,
} from '#core/production/brick-pressing';
export type {
    FinishedRecipeBrickPressingOptions,
    FinishedRecipeBrickPressingStep,
} from '#core/production/brick-pressing';
import {
    planFinishedRecipeEquipment,
    type FinishedRecipeEquipmentPlan,
    type FinishedRecipeOwnedEquipment,
} from '#core/production/equipment';
export type {
    FinishedRecipeEquipmentPlan,
    FinishedRecipeEquipmentRequirement,
    FinishedRecipeEquipmentRole,
    FinishedRecipeOwnedEquipment,
} from '#core/production/equipment';
import {
    isPackagingAvailable,
    packagingMaterialDemand,
    planFinishedRecipePackaging,
    type FinishedRecipePackagingOptions,
    type FinishedRecipePackagingStep,
    type PackagingMaterialDemand,
} from '#core/production/packaging';
export type {
    FinishedRecipePackagingOptions,
    FinishedRecipePackagingStep,
} from '#core/production/packaging';
import {
    type ProductionBatchPlan,
    type ProductionPlanDataset,
    type ProductionPurchase,
    ProductionBatchPlanner,
} from '#core/production/plan';

export interface FinishedRecipeProductionOptions {
    readonly mixingStationItemId?: string;
    readonly drying?: FinishedRecipeDryingOptions;
    readonly packaging?: FinishedRecipePackagingOptions;
    readonly brickPressing?: FinishedRecipeBrickPressingOptions;
    readonly ownedEquipment?: readonly FinishedRecipeOwnedEquipment[];
}

export interface FinishedRecipeDryingOptions {
    readonly stationItemId: string;
    readonly startingQuality: string;
    readonly targetQuality: string;
    readonly averageTemperature: number;
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

export interface FinishedRecipeGrowAdditiveStep {
    readonly position: 'during-base-product-growth';
    readonly productionItemId: string;
    readonly growContainerItemId: string;
    readonly additiveItemId: string;
    readonly batchCount: number;
    readonly applicationCount: number;
    readonly materialQuantity: number;
    readonly qualityChange: number;
    readonly yieldMultiplier: number;
    readonly instantGrowth: number;
    readonly manualApplicationDuration: 'interactive-not-fixed';
}

export interface FinishedRecipeDryingStep {
    readonly position: 'after-ordered-mixing';
    readonly stationItemId: string;
    readonly itemId: string;
    readonly startingQuality: string;
    readonly targetQuality: string;
    readonly qualityTierCount: number;
    readonly capacityPerBatch: number;
    readonly batchQuantities: readonly number[];
    readonly inputQuantity: number;
    readonly outputQuantity: number;
    readonly averageTemperature: number;
    readonly processMultiplier: number;
    readonly baseMinutesPerTier: number;
    readonly effectiveMinutesPerTier: number;
    readonly minutesPerBatch: number;
    readonly totalProcessMinutes: number;
}

export type FinishedRecipeUnmodeledOperation =
    | 'drying'
    | 'packaging'
    | 'brick-pressing'
    | 'equipment-purchase'
    | 'transport';

export interface FinishedRecipeUnmodeledOperationEvidence {
    readonly operation: FinishedRecipeUnmodeledOperation;
    readonly applicability: 'not-established' | 'available-not-selected';
    readonly materialCost: null;
    readonly processMinutes: null;
}

export interface FinishedRecipeProductionEvidence {
    readonly modeledScope:
        | 'base-product-and-ordered-mixing'
        | 'base-product-ordered-mixing-and-selected-drying'
        | 'base-product-ordered-mixing-and-selected-packaging'
        | 'base-product-ordered-mixing-selected-drying-and-packaging'
        | 'base-product-ordered-mixing-and-selected-brick-pressing'
        | 'base-product-ordered-mixing-selected-drying-and-brick-pressing';
    readonly modeledQuantityProof: 'exact';
    readonly materialCostCoverage: 'modeled-materials-only';
    readonly modeledDurationProof: 'complete' | 'partial';
    readonly finishedLifecycleProof: 'partial';
    readonly missingFacts: readonly (
        | 'mixing-station'
        | 'production-equipment-selection'
        | 'equipment-ownership'
        | 'equipment-purchase-price'
    )[];
    readonly dryingApplicability: 'selected' | 'available-not-selected' | 'not-applicable';
    readonly packagingApplicability: 'selected' | 'available-not-selected' | 'not-applicable';
    readonly brickPressingApplicability:
        | 'selected'
        | 'available-not-selected'
        | 'not-applicable';
    readonly unmodeledOperations: readonly FinishedRecipeUnmodeledOperationEvidence[];
}

export interface FinishedRecipeProductionDuration {
    readonly baseProductProcessMinutes: number;
    readonly mixingProcessMinutes: number | null;
    readonly dryingProcessMinutes: number | null;
    readonly packagingEmployeeRealSeconds: number | null;
    readonly brickPressingEmployeeRealSeconds: number | null;
    readonly knownProcessMinutes: number;
    readonly modeledTotalProcessMinutes: number | null;
}

export interface FinishedRecipeProductionCost {
    readonly recipeEstimatedUnitMaterialCost: number;
    readonly recipeEstimatedMaterialCost: number;
    readonly requiredMaterialCost: number;
    readonly materialPurchaseCost: number;
    readonly equipmentPurchaseCost: number | null;
    readonly combinedPurchaseCost: number | null;
}

export interface FinishedRecipeProductionPlan {
    readonly dataset: ProductionPlanDataset;
    readonly recipe: RecipeEvaluation;
    readonly finishedQuantity: number;
    readonly baseProductPlan: ProductionBatchPlan;
    readonly growAdditiveSteps: readonly FinishedRecipeGrowAdditiveStep[];
    readonly ingredientDemands: readonly FinishedRecipeIngredientDemand[];
    readonly purchases: readonly ProductionPurchase[];
    readonly mixingSteps: readonly FinishedRecipeMixingStep[];
    readonly dryingStep: FinishedRecipeDryingStep | null;
    readonly packagingStep: FinishedRecipePackagingStep | null;
    readonly brickPressingStep: FinishedRecipeBrickPressingStep | null;
    readonly equipment: FinishedRecipeEquipmentPlan;
    readonly duration: FinishedRecipeProductionDuration;
    readonly cost: FinishedRecipeProductionCost;
    readonly evidence: FinishedRecipeProductionEvidence;
}

type MixingStation = Extract<
    ProductionStation,
    { readonly kind: 'mixing' | 'mixing-mk2' }
>;

type DryingRackStation = Extract<ProductionStation, { readonly kind: 'drying-rack' }>;

const unmodeledOperationKinds: readonly FinishedRecipeUnmodeledOperation[] = [
    'drying',
    'packaging',
    'brick-pressing',
    'equipment-purchase',
    'transport',
];

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
        if (options.packaging !== undefined && options.brickPressing !== undefined) {
            throw new Error('Finished recipe cannot select packaging and brick pressing together');
        }
        const ingredientDemands = this.#ingredientDemands(recipe, finishedQuantity);
        const baseProductPlan = this.#baseProducts.plan(recipe.productId, finishedQuantity);
        assertCompatibleCostBasis(recipe, baseProductPlan);
        const growAdditiveSteps = finishedRecipeGrowAdditiveSteps(
            this.#itemsById,
            this.#catalog,
            baseProductPlan
        );
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
        const dryingAvailable = this.#isDryingAvailable(recipe.productId);
        const dryingStep = options.drying === undefined
            ? null
            : this.#dryingStep(recipe.productId, finishedQuantity, options.drying);
        const dryingApplicability = dryingStep !== null
            ? 'selected'
            : dryingAvailable
              ? 'available-not-selected'
              : 'not-applicable';
        const dryingProcessMinutes = dryingStep?.totalProcessMinutes ?? null;
        const packagingStep = options.packaging === undefined
            ? null
            : planFinishedRecipePackaging(
                  this.#itemsById,
                  this.#catalog,
                  recipe.productId,
                  finishedQuantity,
                  options.packaging
              );
        const packagingApplicability = packagingStep !== null
            ? 'selected'
            : options.brickPressing !== undefined
              ? 'not-applicable'
              : isPackagingAvailable(this.#itemsById, recipe.productId)
                ? 'available-not-selected'
                : 'not-applicable';
        const brickPressingStep = options.brickPressing === undefined
            ? null
            : planFinishedRecipeBrickPressing(
                  this.#itemsById,
                  this.#catalog,
                  recipe.productId,
                  finishedQuantity,
                  options.brickPressing
              );
        const brickPressingApplicability = brickPressingStep !== null
            ? 'selected'
            : options.packaging !== undefined
              ? 'not-applicable'
              : isBrickPressingAvailable(this.#itemsById, this.#catalog, recipe.productId)
                ? 'available-not-selected'
                : 'not-applicable';
        const packagingDemand = packagingStep === null
            ? []
            : [packagingMaterialDemand(this.#itemsById, packagingStep)];
        const equipment = planFinishedRecipeEquipment(
            this.#itemsById,
            baseProductPlan,
            {
                mixingStationItemId: mixingSteps[0]?.stationItemId ?? null,
                dryingStationItemId: dryingStep?.stationItemId ?? null,
                packagingStationItemId: packagingStep?.stationItemId ?? null,
                brickPressItemId: brickPressingStep?.stationItemId ?? null,
            },
            options.ownedEquipment
        );
        const purchaseDemands = mergePurchases(
            baseProductPlan.purchases,
            ingredientDemands,
            packagingDemand
        );
        const requiredMaterialCost = purchaseDemands.reduce(
            (total, purchase) => total + purchase.requiredCost,
            0
        );
        const materialPurchaseCost = purchaseDemands.reduce(
            (total, purchase) => total + purchase.purchaseCost,
            0
        );
        const equipmentPurchaseCost = equipment.totalMissingPurchaseCost;
        const knownProcessMinutes =
            baseProductPlan.totalProcessMinutes +
            (mixingProcessMinutes ?? 0) +
            (dryingProcessMinutes ?? 0);

        return {
            dataset: { ...baseProductPlan.dataset },
            recipe: cloneRecipe(recipe),
            finishedQuantity,
            baseProductPlan,
            growAdditiveSteps,
            ingredientDemands,
            purchases: purchaseDemands,
            mixingSteps,
            dryingStep,
            packagingStep,
            brickPressingStep,
            equipment,
            duration: {
                baseProductProcessMinutes: baseProductPlan.totalProcessMinutes,
                mixingProcessMinutes,
                dryingProcessMinutes,
                packagingEmployeeRealSeconds: packagingStep?.totalEmployeeRealSeconds ?? null,
                brickPressingEmployeeRealSeconds:
                    brickPressingStep?.totalEmployeeRealSeconds ?? null,
                knownProcessMinutes,
                modeledTotalProcessMinutes:
                    mixingProcessMinutes === null ? null : knownProcessMinutes,
            },
            cost: {
                recipeEstimatedUnitMaterialCost: recipe.totalCost,
                recipeEstimatedMaterialCost: recipe.totalCost * finishedQuantity,
                requiredMaterialCost,
                materialPurchaseCost,
                equipmentPurchaseCost,
                combinedPurchaseCost:
                    equipmentPurchaseCost === null
                        ? null
                        : materialPurchaseCost + equipmentPurchaseCost,
            },
            evidence: {
                modeledScope: modeledScope(
                    dryingStep !== null,
                    packagingStep !== null,
                    brickPressingStep !== null
                ),
                modeledQuantityProof: 'exact',
                materialCostCoverage: 'modeled-materials-only',
                modeledDurationProof: mixingProcessMinutes === null ? 'partial' : 'complete',
                finishedLifecycleProof: 'partial',
                missingFacts: missingFacts(mixingProcessMinutes, equipment),
                dryingApplicability,
                packagingApplicability,
                brickPressingApplicability,
                unmodeledOperations: unmodeledOperationKinds
                    .filter(
                        (operation) =>
                            (operation !== 'drying' ||
                                dryingApplicability === 'available-not-selected') &&
                            (operation !== 'packaging' ||
                                packagingApplicability === 'available-not-selected') &&
                            (operation !== 'brick-pressing' ||
                                brickPressingApplicability === 'available-not-selected') &&
                            (operation !== 'equipment-purchase' ||
                                equipment.purchaseCostProof !== 'exact')
                    )
                    .map((operation) => ({
                        operation,
                        applicability:
                            operation === 'drying' ||
                            operation === 'packaging' ||
                            operation === 'brick-pressing'
                            ? 'available-not-selected'
                            : 'not-established',
                        materialCost: null,
                        processMinutes: null,
                    })),
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

    #isDryingAvailable(productId: string): boolean {
        const product = this.#itemsById.get(productId)?.product;
        if (product === null || product === undefined) {
            throw new Error(`Recipe product ${JSON.stringify(productId)} is not a product`);
        }
        return this.#catalog.drying.acceptedProductDrugTypes.includes(product.drugType);
    }

    #dryingStep(
        productId: string,
        quantity: number,
        options: FinishedRecipeDryingOptions
    ): FinishedRecipeDryingStep {
        if (!this.#isDryingAvailable(productId)) {
            throw new Error(`Product ${JSON.stringify(productId)} is not dryable`);
        }
        const station = this.#dryingStation(options.stationItemId);
        const qualityTierCount = dryingTierCount(
            this.#catalog,
            options.startingQuality,
            options.targetQuality
        );
        const processMultiplier = dryingProcessMultiplier(station, options.averageTemperature);
        const effectiveMinutesPerTier = station.processMinutesPerTier / processMultiplier;
        const batchQuantities = splitBatches(quantity, station.capacity);
        const minutesPerBatch = qualityTierCount * effectiveMinutesPerTier;
        return {
            position: 'after-ordered-mixing',
            stationItemId: station.itemId,
            itemId: productId,
            startingQuality: options.startingQuality,
            targetQuality: options.targetQuality,
            qualityTierCount,
            capacityPerBatch: station.capacity,
            batchQuantities,
            inputQuantity: quantity,
            outputQuantity: quantity,
            averageTemperature: options.averageTemperature,
            processMultiplier,
            baseMinutesPerTier: station.processMinutesPerTier,
            effectiveMinutesPerTier,
            minutesPerBatch,
            totalProcessMinutes: batchQuantities.length * minutesPerBatch,
        };
    }

    #dryingStation(itemId: string): DryingRackStation {
        const station = this.#catalog.stations.find((candidate) => candidate.itemId === itemId);
        if (station?.kind !== 'drying-rack') {
            throw new Error(`Unknown drying rack ${JSON.stringify(itemId)}`);
        }
        requirePositiveInteger(station.capacity, `Drying rack ${JSON.stringify(itemId)} capacity`);
        requirePositive(
            station.processMinutesPerTier,
            `Drying rack ${JSON.stringify(itemId)} process minutes per tier`
        );
        requirePositive(
            station.maxProcessMultiplier,
            `Drying rack ${JSON.stringify(itemId)} maximum process multiplier`
        );
        return station;
    }
}

function finishedRecipeGrowAdditiveSteps(
    itemsById: ReadonlyMap<string, Item>,
    catalog: ProductionCatalog,
    baseProductPlan: ProductionBatchPlan
): FinishedRecipeGrowAdditiveStep[] {
    return baseProductPlan.productionSteps.flatMap((productionStep) =>
        productionStep.additiveItemIds.map((additiveItemId) => {
            if (productionStep.method !== 'seed-harvest') {
                throw new Error(
                    `Production step ${JSON.stringify(productionStep.routeId)} applies grow additives outside seed harvest`
                );
            }
            const growContainer = catalog.stations.find(
                (station) => station.itemId === productionStep.equipmentItemId
            );
            if (growContainer?.kind !== 'grow-container') {
                throw new Error(
                    `Production step ${JSON.stringify(productionStep.routeId)} applies grow additives without a grow container`
                );
            }
            if (!growContainer.allowedAdditiveIds.includes(additiveItemId)) {
                throw new Error(
                    `Grow container ${JSON.stringify(growContainer.itemId)} does not accept additive ${JSON.stringify(additiveItemId)}`
                );
            }
            const additive = itemsById.get(additiveItemId)?.additive;
            if (additive === null || additive === undefined) {
                throw new Error(`Unknown grow additive ${JSON.stringify(additiveItemId)}`);
            }
            const input = productionStep.inputs.find(
                (candidate) => candidate.itemId === additiveItemId
            );
            if (
                input === undefined ||
                input.quantityPerBatch !== 1 ||
                input.totalQuantity !== productionStep.batchCount
            ) {
                throw new Error(
                    `Grow additive ${JSON.stringify(additiveItemId)} material demand does not match one application per batch`
                );
            }
            return {
                position: 'during-base-product-growth',
                productionItemId: productionStep.itemId,
                growContainerItemId: growContainer.itemId,
                additiveItemId,
                batchCount: productionStep.batchCount,
                applicationCount: productionStep.batchCount,
                materialQuantity: input.totalQuantity,
                qualityChange: additive.qualityChange,
                yieldMultiplier: additive.yieldMultiplier,
                instantGrowth: additive.instantGrowth,
                manualApplicationDuration: 'interactive-not-fixed',
            };
        })
    );
}

function modeledScope(
    selectedDrying: boolean,
    selectedPackaging: boolean,
    selectedBrickPressing: boolean
): FinishedRecipeProductionEvidence['modeledScope'] {
    if (selectedDrying && selectedPackaging) {
        return 'base-product-ordered-mixing-selected-drying-and-packaging';
    }
    if (selectedDrying && selectedBrickPressing) {
        return 'base-product-ordered-mixing-selected-drying-and-brick-pressing';
    }
    if (selectedDrying) return 'base-product-ordered-mixing-and-selected-drying';
    if (selectedPackaging) return 'base-product-ordered-mixing-and-selected-packaging';
    if (selectedBrickPressing) {
        return 'base-product-ordered-mixing-and-selected-brick-pressing';
    }
    return 'base-product-and-ordered-mixing';
}

function missingFacts(
    mixingProcessMinutes: number | null,
    equipment: FinishedRecipeEquipmentPlan
): FinishedRecipeProductionEvidence['missingFacts'] {
    const result: FinishedRecipeProductionEvidence['missingFacts'][number][] = [];
    if (mixingProcessMinutes === null) result.push('mixing-station');
    if (equipment.selectionProof === 'partial') {
        result.push('production-equipment-selection');
    }
    if (equipment.ownershipProof === 'not-supplied') result.push('equipment-ownership');
    if (equipment.purchaseCostProof === 'equipment-price-not-recorded') {
        result.push('equipment-purchase-price');
    }
    return result;
}

function dryingTierCount(
    catalog: ProductionCatalog,
    startingQuality: string,
    targetQuality: string
): number {
    const tiers = catalog.quality.tiers.map((tier) => tier.name);
    const startingIndex = tiers.indexOf(startingQuality);
    if (startingIndex < 0) {
        throw new Error(`Unknown starting quality ${JSON.stringify(startingQuality)}`);
    }
    const targetIndex = tiers.indexOf(targetQuality);
    if (targetIndex < 0) {
        throw new Error(`Unknown target quality ${JSON.stringify(targetQuality)}`);
    }
    const maximumIndex = tiers.indexOf(catalog.drying.maximumQualityTier);
    if (maximumIndex < 0) throw new Error('Drying maximum quality is not a normalized quality tier');
    if (maximumIndex !== tiers.length - 1) {
        throw new Error('Drying maximum quality must be the final normalized quality tier');
    }
    if (targetIndex > maximumIndex) {
        throw new Error('Drying target quality exceeds the supported maximum');
    }
    if (targetIndex <= startingIndex) {
        throw new Error('Drying target quality must be higher than starting quality');
    }
    return targetIndex - startingIndex;
}

function dryingProcessMultiplier(station: DryingRackStation, temperature: number): number {
    if (!Number.isFinite(temperature)) throw new Error('Drying average temperature must be finite');
    const minimum = station.minimumTemperatureThreshold;
    const maximum = station.maximumTemperatureThreshold;
    if (
        !Number.isFinite(minimum) ||
        !Number.isFinite(maximum) ||
        minimum <= 0 ||
        !close(maximum, minimum * 2)
    ) {
        throw new Error('Drying rack temperature thresholds are invalid');
    }
    if (temperature <= minimum) return 1;
    const progress = Math.min(1, Math.max(0, (temperature - minimum) / minimum));
    return 1 + progress * station.maxProcessMultiplier;
}

function close(left: number, right: number): boolean {
    return Math.abs(left - right) <= Math.max(1, Math.abs(left), Math.abs(right)) * 1e-9;
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
    ingredientDemands: readonly FinishedRecipeIngredientDemand[],
    packagingDemands: readonly PackagingMaterialDemand[]
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
    for (const demand of packagingDemands) {
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
