import type { Item } from '#core/data/item';
import type { ProductionCatalog } from '#core/data/production';

export type ProductionMethod =
    | 'cauldron'
    | 'mushroom-spawn'
    | 'oven'
    | 'seed-harvest'
    | 'shroom-harvest'
    | 'station-recipe';

export interface BasePurchaseMaterialCost {
    readonly kind: 'base-purchase-price';
    readonly itemId: string;
    readonly unitCost: number;
}

export interface ProductionMaterialInput {
    readonly acceptedItemIds: readonly string[];
    readonly itemId: string;
    readonly quantity: number;
    readonly unitCost: number;
    readonly totalCost: number;
    readonly cost: ProductionMaterialCost;
}

export interface ProducedMaterialCost {
    readonly kind: 'production';
    readonly itemId: string;
    readonly routeId: string;
    readonly method: ProductionMethod;
    readonly outputQuantity: number;
    readonly durationMinutesPerBatch: number;
    readonly acceptedEquipmentItemIds: readonly string[];
    readonly equipmentItemId: string | null;
    readonly growLightItemId: string | null;
    readonly additiveItemIds: readonly string[];
    readonly batchCost: number;
    readonly unitCost: number;
    readonly inputs: readonly ProductionMaterialInput[];
}

export type ProductionMaterialCost = BasePurchaseMaterialCost | ProducedMaterialCost;

export interface ProductionMaterialCostResolver {
    unitCost(itemId: string): number;
}

export interface ProductionMaterialCostOptions {
    readonly growContainerItemId?: string;
    readonly growLightItemId?: string;
    readonly additiveItemIds?: readonly string[];
}

interface RouteInput {
    readonly acceptedItemIds: readonly string[];
    readonly quantity: number;
}

interface ProductionRoute {
    readonly id: string;
    readonly method: ProductionMethod;
    readonly outputItemId: string;
    readonly outputQuantity: number;
    readonly durationMinutesPerBatch: number;
    readonly acceptedEquipmentItemIds: readonly string[];
    readonly equipmentItemId: string | null;
    readonly growLightItemId: string | null;
    readonly additiveItemIds: readonly string[];
    readonly inputs: readonly RouteInput[];
}

interface SelectedAdditive {
    readonly itemId: string;
    readonly yieldMultiplier: number;
    readonly instantGrowth: number;
}

export class ProductionMaterialCostEvaluator implements ProductionMaterialCostResolver {
    readonly #itemsById: ReadonlyMap<string, Item>;
    readonly #routesByOutput: ReadonlyMap<string, readonly ProductionRoute[]>;
    readonly #cache = new Map<string, ProductionMaterialCost>();

    constructor(
        itemsById: ReadonlyMap<string, Item>,
        catalog: ProductionCatalog,
        options: ProductionMaterialCostOptions = {}
    ) {
        this.#itemsById = itemsById;
        this.#routesByOutput = indexRoutes(productionRoutes(itemsById, catalog, options));
    }

    unitCost(itemId: string): number {
        return this.evaluate(itemId).unitCost;
    }

    evaluate(itemId: string): ProductionMaterialCost {
        if (!this.#itemsById.has(itemId)) throw new Error(`Unknown production item ${JSON.stringify(itemId)}`);
        const cost = this.#evaluate(itemId, new Set());
        if (cost === null) {
            throw new Error(`No complete material-cost route for ${JSON.stringify(itemId)}`);
        }
        return cost;
    }

    #evaluate(itemId: string, ancestors: ReadonlySet<string>): ProductionMaterialCost | null {
        const cached = this.#cache.get(itemId);
        if (cached !== undefined) return cached;
        if (ancestors.has(itemId)) return null;

        const routes = this.#routesByOutput.get(itemId) ?? [];
        if (routes.length === 0) return this.#purchaseCost(itemId);

        const nextAncestors = new Set(ancestors).add(itemId);
        const candidates = routes
            .map((route) => this.#routeCost(route, nextAncestors))
            .filter((cost): cost is ProducedMaterialCost => cost !== null)
            .sort(compareProducedCosts);
        const best = candidates[0] ?? null;
        if (best !== null) this.#cache.set(itemId, best);
        return best;
    }

    #purchaseCost(itemId: string): BasePurchaseMaterialCost | null {
        const item = this.#itemsById.get(itemId);
        if (item?.basePurchasePrice === null || item?.basePurchasePrice === undefined) return null;
        const cost: BasePurchaseMaterialCost = {
            kind: 'base-purchase-price',
            itemId,
            unitCost: item.basePurchasePrice,
        };
        this.#cache.set(itemId, cost);
        return cost;
    }

    #routeCost(
        route: ProductionRoute,
        ancestors: ReadonlySet<string>
    ): ProducedMaterialCost | null {
        const inputs: ProductionMaterialInput[] = [];
        for (const input of route.inputs) {
            const selected = input.acceptedItemIds
                .map((itemId) => this.#evaluate(itemId, ancestors))
                .filter((cost): cost is ProductionMaterialCost => cost !== null)
                .sort(compareMaterialCosts)[0];
            if (selected === undefined) return null;
            inputs.push({
                acceptedItemIds: input.acceptedItemIds,
                itemId: selected.itemId,
                quantity: input.quantity,
                unitCost: selected.unitCost,
                totalCost: selected.unitCost * input.quantity,
                cost: selected,
            });
        }
        const batchCost = inputs.reduce((total, input) => total + input.totalCost, 0);
        return {
            kind: 'production',
            itemId: route.outputItemId,
            routeId: route.id,
            method: route.method,
            outputQuantity: route.outputQuantity,
            durationMinutesPerBatch: route.durationMinutesPerBatch,
            acceptedEquipmentItemIds: route.acceptedEquipmentItemIds,
            equipmentItemId: route.equipmentItemId,
            growLightItemId: route.growLightItemId,
            additiveItemIds: route.additiveItemIds,
            batchCost,
            unitCost: batchCost / route.outputQuantity,
            inputs,
        };
    }
}

function productionRoutes(
    itemsById: ReadonlyMap<string, Item>,
    catalog: ProductionCatalog,
    options: ProductionMaterialCostOptions
): ProductionRoute[] {
    const routes: ProductionRoute[] = [];
    const selectedGrowContainer = selectGrowContainer(catalog, options.growContainerItemId);
    const selectedGrowLight = selectGrowLight(itemsById, catalog, options.growLightItemId);
    validateGrowLighting(selectedGrowContainer, selectedGrowLight);
    const selectedAdditives = selectAdditives(
        itemsById,
        selectedGrowContainer,
        options.additiveItemIds ?? []
    );
    for (const seed of catalog.seeds) {
        if (seed.soilItemIds.length === 0) {
            throw new Error(`Seed production ${JSON.stringify(seed.seedItemId)} has no soil`);
        }
        for (const product of seed.harvestProducts) {
            const soilItemIds = selectedGrowContainer
                ? seed.soilItemIds.filter((itemId) =>
                      selectedGrowContainer.allowedSoilIds.includes(itemId)
                  )
                : seed.soilItemIds;
            if (soilItemIds.length === 0) {
                throw new Error(
                    `Grow container ${JSON.stringify(selectedGrowContainer?.itemId)} accepts no soil for seed ${JSON.stringify(seed.seedItemId)}`
                );
            }
            for (const soilItemId of soilItemIds) {
                const routeId = [
                    'seed',
                    seed.seedItemId,
                    product.itemId,
                    soilItemId,
                    selectedGrowContainer?.itemId,
                    selectedGrowLight?.itemId,
                    ...selectedAdditives.map((additive) => additive.itemId),
                ]
                    .filter((part) => part !== undefined)
                    .join(':');
                const equipment = {
                    ...requireEquipment(
                        itemsById,
                        catalog.stations
                            .filter(
                                (station) =>
                                    station.kind === 'grow-container' &&
                                    station.allowedSoilIds.includes(soilItemId)
                            )
                            .map((station) => station.itemId),
                        routeId,
                        selectedGrowContainer?.itemId
                    ),
                    equipmentItemId: selectedGrowContainer?.itemId ?? null,
                };
                routes.push({
                    id: routeId,
                    method: 'seed-harvest',
                    outputItemId: product.itemId,
                    outputQuantity:
                        harvestCount(
                            seed.baseYieldQuantity,
                            stackedYieldMultiplier(
                                selectedGrowContainer?.yieldMultiplier ?? 1,
                                selectedAdditives
                            )
                        ) *
                        product.quantity,
                    durationMinutesPerBatch: adjustedGrowthMinutes(
                        seed.growthTimeMinutes,
                        selectedGrowContainer?.growSpeedMultiplier,
                        selectedGrowLight?.growSpeedMultiplier,
                        selectedAdditives.reduce(
                            (result, additive) => result + additive.instantGrowth,
                            0
                        )
                    ),
                    growLightItemId: selectedGrowLight?.itemId ?? null,
                    additiveItemIds: selectedAdditives.map((additive) => additive.itemId),
                    ...equipment,
                    inputs: [
                        { acceptedItemIds: [seed.seedItemId], quantity: 1 },
                        {
                            acceptedItemIds: [soilItemId],
                            quantity: soilUseQuantity(itemsById, soilItemId),
                        },
                        ...selectedAdditives.map((additive) => ({
                            acceptedItemIds: [additive.itemId],
                            quantity: 1,
                        })),
                    ],
                });
            }
        }
    }
    for (const shroom of catalog.shrooms) {
        if (shroom.soilItemIds.length === 0) {
            throw new Error(`Shroom production ${JSON.stringify(shroom.spawnItemId)} has no soil`);
        }
        for (const soilItemId of shroom.soilItemIds) {
            routes.push({
                id: `shroom:${shroom.spawnItemId}:${shroom.productItemId}:${soilItemId}`,
                method: 'shroom-harvest',
                outputItemId: shroom.productItemId,
                outputQuantity: shroom.baseYieldQuantity,
                durationMinutesPerBatch: shroom.growTimeMinutes,
                growLightItemId: null,
                additiveItemIds: [],
                ...requireEquipment(
                    itemsById,
                    shroom.acceptedEquipmentItemIds,
                    `shroom:${shroom.spawnItemId}:${shroom.productItemId}:${soilItemId}`
                ),
                inputs: [
                    { acceptedItemIds: [shroom.spawnItemId], quantity: 1 },
                    {
                        acceptedItemIds: [soilItemId],
                        quantity: soilUseQuantity(itemsById, soilItemId),
                    },
                ],
            });
        }
    }
    for (const recipe of catalog.stationRecipes) {
        routes.push({
            id: `recipe:${recipe.id}`,
            method: 'station-recipe',
            outputItemId: recipe.outputItemId,
            outputQuantity: recipe.outputQuantity,
            durationMinutesPerBatch: recipe.cookTimeMinutes,
            growLightItemId: null,
            additiveItemIds: [],
            ...requireEquipment(
                itemsById,
                recipe.acceptedEquipmentItemIds,
                `recipe:${recipe.id}`
            ),
            inputs: recipe.ingredients,
        });
    }
    for (const transform of catalog.ovenTransforms) {
        routes.push({
            id: `oven:${transform.inputItemId}:${transform.outputItemId}`,
            method: 'oven',
            outputItemId: transform.outputItemId,
            outputQuantity: transform.outputQuantity,
            durationMinutesPerBatch: transform.cookTimeMinutes,
            growLightItemId: null,
            additiveItemIds: [],
            ...requireEquipment(
                itemsById,
                catalog.stations
                    .filter((station) => station.kind === 'lab-oven')
                    .map((station) => station.itemId),
                `oven:${transform.inputItemId}:${transform.outputItemId}`
            ),
            inputs: [{ acceptedItemIds: [transform.inputItemId], quantity: 1 }],
        });
    }
    for (const station of catalog.stations) {
        if (station.kind === 'cauldron') {
            routes.push({
                id: `cauldron:${station.itemId}`,
                method: 'cauldron',
                outputItemId: station.outputItemId,
                outputQuantity: station.outputQuantity,
                durationMinutesPerBatch: station.cookTimeMinutes,
                growLightItemId: null,
                additiveItemIds: [],
                ...requireEquipment(
                    itemsById,
                    [station.itemId],
                    `cauldron:${station.itemId}`
                ),
                inputs: [
                    {
                        acceptedItemIds: [station.primaryInputItemId],
                        quantity: station.requiredPrimaryInputQuantity,
                    },
                    {
                        acceptedItemIds: [station.secondaryInputItemId],
                        quantity: station.secondaryInputQuantity,
                    },
                ],
            });
        }
        if (station.kind === 'mushroom-spawn') {
            for (const transform of station.sporeSyringes) {
                routes.push({
                    id: `mushroom-spawn:${station.itemId}:${transform.syringeItemId}`,
                    method: 'mushroom-spawn',
                    outputItemId: transform.outputSpawnItemId,
                    outputQuantity: transform.outputSpawnQuantity,
                    durationMinutesPerBatch: station.workTimeMinutes,
                    growLightItemId: null,
                    additiveItemIds: [],
                    ...requireEquipment(
                        itemsById,
                        [station.itemId],
                        `mushroom-spawn:${station.itemId}:${transform.syringeItemId}`
                    ),
                    inputs: [
                        {
                            acceptedItemIds: [station.grainBagItemId],
                            quantity: station.grainBagQuantity,
                        },
                        {
                            acceptedItemIds: [transform.syringeItemId],
                            quantity: transform.syringeQuantity,
                        },
                    ],
                });
            }
        }
    }
    return routes;
}

function soilUseQuantity(itemsById: ReadonlyMap<string, Item>, itemId: string): number {
    const soil = itemsById.get(itemId)?.soil;
    if (soil === null || soil === undefined || soil.uses <= 0) {
        throw new Error(`Production soil ${JSON.stringify(itemId)} has no positive use count`);
    }
    return 1 / soil.uses;
}

function requireEquipment(
    itemsById: ReadonlyMap<string, Item>,
    itemIds: readonly string[],
    routeId: string,
    selectedItemId?: string
): {
    readonly acceptedEquipmentItemIds: readonly string[];
    readonly equipmentItemId: string | null;
} {
    const acceptedEquipmentItemIds = [...new Set(itemIds)].sort();
    if (acceptedEquipmentItemIds.length === 0) {
        throw new Error(`Production route ${JSON.stringify(routeId)} has no equipment`);
    }
    for (const itemId of acceptedEquipmentItemIds) {
        if (!itemsById.has(itemId)) {
            throw new Error(
                `Production route ${JSON.stringify(routeId)} references unknown equipment ${JSON.stringify(itemId)}`
            );
        }
    }
    if (selectedItemId !== undefined && !acceptedEquipmentItemIds.includes(selectedItemId)) {
        throw new Error(
            `Production route ${JSON.stringify(routeId)} does not accept equipment ${JSON.stringify(selectedItemId)}`
        );
    }
    return {
        acceptedEquipmentItemIds,
        equipmentItemId:
            selectedItemId ?? (acceptedEquipmentItemIds.length === 1 ? acceptedEquipmentItemIds[0]! : null),
    };
}

function selectGrowContainer(
    catalog: ProductionCatalog,
    itemId: string | undefined
): Extract<ProductionCatalog['stations'][number], { readonly kind: 'grow-container' }> | null {
    if (itemId === undefined) return null;
    const station = catalog.stations.find((candidate) => candidate.itemId === itemId);
    if (station?.kind !== 'grow-container') {
        throw new Error(`Unknown grow container ${JSON.stringify(itemId)}`);
    }
    return station;
}

function selectGrowLight(
    itemsById: ReadonlyMap<string, Item>,
    catalog: ProductionCatalog,
    itemId: string | undefined
): Extract<ProductionCatalog['stations'][number], { readonly kind: 'grow-light' }> | null {
    if (itemId === undefined) return null;
    const station = catalog.stations.find((candidate) => candidate.itemId === itemId);
    if (station?.kind !== 'grow-light') throw new Error(`Unknown grow light ${JSON.stringify(itemId)}`);
    if (!itemsById.has(itemId)) throw new Error(`Unknown grow light equipment ${JSON.stringify(itemId)}`);
    return station;
}

function validateGrowLighting(
    container: Extract<ProductionCatalog['stations'][number], { readonly kind: 'grow-container' }> | null,
    light: Extract<ProductionCatalog['stations'][number], { readonly kind: 'grow-light' }> | null
): void {
    if (container === null) {
        if (light !== null) throw new Error('A grow light cannot be selected without a grow container');
        return;
    }
    if (container.requiresExternalGrowLight && light === null) {
        throw new Error(`Grow container ${JSON.stringify(container.itemId)} requires a grow light`);
    }
    if (!container.requiresExternalGrowLight && light !== null) {
        throw new Error(`Grow container ${JSON.stringify(container.itemId)} uses built-in lighting`);
    }
}

function selectAdditives(
    itemsById: ReadonlyMap<string, Item>,
    container: Extract<ProductionCatalog['stations'][number], { readonly kind: 'grow-container' }> | null,
    itemIds: readonly string[]
): readonly SelectedAdditive[] {
    if (itemIds.length === 0) return [];
    if (container === null) throw new Error('Additives cannot be selected without a grow container');

    const uniqueItemIds = new Set(itemIds);
    if (uniqueItemIds.size !== itemIds.length) throw new Error('A grow additive can only be selected once');

    return [...uniqueItemIds].sort().map((itemId) => {
        const additive = itemsById.get(itemId)?.additive;
        if (additive === null || additive === undefined) {
            throw new Error(`Unknown grow additive ${JSON.stringify(itemId)}`);
        }
        if (!container.allowedAdditiveIds.includes(itemId)) {
            throw new Error(
                `Grow container ${JSON.stringify(container.itemId)} does not accept additive ${JSON.stringify(itemId)}`
            );
        }
        return {
            itemId,
            yieldMultiplier: additive.yieldMultiplier,
            instantGrowth: additive.instantGrowth,
        };
    });
}

function stackedYieldMultiplier(
    initial: number,
    additives: readonly SelectedAdditive[]
): number {
    return additives.reduce(
        (result, additive) =>
            additive.yieldMultiplier === 0
                ? result
                : Math.max(0, result * additive.yieldMultiplier),
        initial
    );
}

function harvestCount(baseYieldQuantity: number, yieldMultiplier = 1): number {
    return Math.max(1, Math.round(baseYieldQuantity * yieldMultiplier));
}

function adjustedGrowthMinutes(
    growthTimeMinutes: number,
    containerSpeedMultiplier = 1,
    lightSpeedMultiplier = 1,
    instantGrowth = 0
): number {
    const remainingGrowth = Math.max(0, 1 - Math.max(0, instantGrowth));
    const duration =
        (growthTimeMinutes * remainingGrowth) / (containerSpeedMultiplier * lightSpeedMultiplier);
    const nearestMinute = Math.round(duration);
    return Math.abs(duration - nearestMinute) <= 1e-3 ? nearestMinute : Math.ceil(duration);
}

function indexRoutes(routes: readonly ProductionRoute[]): ReadonlyMap<string, readonly ProductionRoute[]> {
    const result = new Map<string, ProductionRoute[]>();
    for (const route of routes) {
        const current = result.get(route.outputItemId) ?? [];
        current.push(route);
        result.set(route.outputItemId, current);
    }
    for (const current of result.values()) current.sort((left, right) => left.id.localeCompare(right.id));
    return result;
}

function compareMaterialCosts(left: ProductionMaterialCost, right: ProductionMaterialCost): number {
    return left.unitCost - right.unitCost || left.itemId.localeCompare(right.itemId);
}

function compareProducedCosts(left: ProducedMaterialCost, right: ProducedMaterialCost): number {
    return left.unitCost - right.unitCost || left.routeId.localeCompare(right.routeId);
}
