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
    readonly batchCost: number;
    readonly unitCost: number;
    readonly inputs: readonly ProductionMaterialInput[];
}

export type ProductionMaterialCost = BasePurchaseMaterialCost | ProducedMaterialCost;

export interface ProductionMaterialCostResolver {
    unitCost(itemId: string): number;
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
    readonly inputs: readonly RouteInput[];
}

export class ProductionMaterialCostEvaluator implements ProductionMaterialCostResolver {
    readonly #itemsById: ReadonlyMap<string, Item>;
    readonly #routesByOutput: ReadonlyMap<string, readonly ProductionRoute[]>;
    readonly #cache = new Map<string, ProductionMaterialCost>();

    constructor(itemsById: ReadonlyMap<string, Item>, catalog: ProductionCatalog) {
        this.#itemsById = itemsById;
        this.#routesByOutput = indexRoutes(productionRoutes(itemsById, catalog));
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
            batchCost,
            unitCost: batchCost / route.outputQuantity,
            inputs,
        };
    }
}

function productionRoutes(
    itemsById: ReadonlyMap<string, Item>,
    catalog: ProductionCatalog
): ProductionRoute[] {
    const routes: ProductionRoute[] = [];
    for (const seed of catalog.seeds) {
        if (seed.soilItemIds.length === 0) {
            throw new Error(`Seed production ${JSON.stringify(seed.seedItemId)} has no soil`);
        }
        for (const product of seed.harvestProducts) {
            for (const soilItemId of seed.soilItemIds) {
                routes.push({
                    id: `seed:${seed.seedItemId}:${product.itemId}:${soilItemId}`,
                    method: 'seed-harvest',
                    outputItemId: product.itemId,
                    outputQuantity: seed.baseYieldQuantity * product.quantity,
                    durationMinutesPerBatch: seed.growthTimeMinutes,
                    inputs: [
                        { acceptedItemIds: [seed.seedItemId], quantity: 1 },
                        {
                            acceptedItemIds: [soilItemId],
                            quantity: soilUseQuantity(itemsById, soilItemId),
                        },
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
