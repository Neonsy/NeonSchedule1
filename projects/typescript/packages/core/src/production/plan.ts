import type {
    ProductionMaterialCostEvaluator,
    BasePurchaseMaterialCost,
    ProducedMaterialCost,
    ProductionMaterialCost,
    ProductionMethod,
} from '#core/production/cost';

export interface ProductionStepInput {
    readonly itemId: string;
    readonly quantityPerBatch: number;
    readonly totalQuantity: number;
}

export interface ProductionBatchStep {
    readonly itemId: string;
    readonly routeId: string;
    readonly method: ProductionMethod;
    readonly requiredQuantity: number;
    readonly batchCount: number;
    readonly outputQuantityPerBatch: number;
    readonly durationMinutesPerBatch: number;
    readonly totalProcessMinutes: number;
    readonly producedQuantity: number;
    readonly leftoverQuantity: number;
    readonly inputs: readonly ProductionStepInput[];
}

export interface ProductionPurchase {
    readonly itemId: string;
    readonly requiredQuantity: number;
    readonly purchaseQuantity: number;
    readonly leftoverQuantity: number;
    readonly unitCost: number;
    readonly requiredCost: number;
    readonly purchaseCost: number;
}

export interface ProductionBatchPlan {
    readonly targetItemId: string;
    readonly targetQuantity: number;
    readonly productionSteps: readonly ProductionBatchStep[];
    readonly purchases: readonly ProductionPurchase[];
    readonly totalProcessMinutes: number;
    readonly requiredMaterialCost: number;
    readonly purchaseCost: number;
}

interface IndexedCosts {
    readonly all: ReadonlyMap<string, ProductionMaterialCost>;
    readonly produced: ReadonlyMap<string, ProducedMaterialCost>;
}

export class ProductionBatchPlanner {
    readonly #costs: ProductionMaterialCostEvaluator;

    constructor(costs: ProductionMaterialCostEvaluator) {
        this.#costs = costs;
    }

    plan(targetItemId: string, targetQuantity: number): ProductionBatchPlan {
        requirePositiveInteger(targetQuantity, 'targetQuantity');
        const indexed = indexCosts(this.#costs.evaluate(targetItemId));
        const expansion = expandProduction(targetItemId, targetQuantity, indexed.produced);
        const purchases = [...indexed.all.values()]
            .filter((cost): cost is BasePurchaseMaterialCost => cost.kind === 'base-purchase-price')
            .map((cost) => purchase(cost, expansion.demands.get(cost.itemId) ?? 0))
            .filter((entry) => entry.requiredQuantity > 0)
            .sort((left, right) => left.itemId.localeCompare(right.itemId));

        return {
            targetItemId,
            targetQuantity,
            productionSteps: [...expansion.steps].reverse(),
            purchases,
            totalProcessMinutes: expansion.steps.reduce(
                (total, step) => total + step.totalProcessMinutes,
                0
            ),
            requiredMaterialCost: purchases.reduce((total, entry) => total + entry.requiredCost, 0),
            purchaseCost: purchases.reduce((total, entry) => total + entry.purchaseCost, 0),
        };
    }
}

function indexCosts(root: ProductionMaterialCost): IndexedCosts {
    const all = new Map<string, ProductionMaterialCost>();
    const produced = new Map<string, ProducedMaterialCost>();
    const pending = [root];
    while (pending.length > 0) {
        const cost = pending.pop();
        if (cost === undefined || all.has(cost.itemId)) continue;
        all.set(cost.itemId, cost);
        if (cost.kind === 'production') {
            produced.set(cost.itemId, cost);
            pending.push(...cost.inputs.map((input) => input.cost));
        }
    }
    return { all, produced };
}

function expandProduction(
    targetItemId: string,
    targetQuantity: number,
    produced: ReadonlyMap<string, ProducedMaterialCost>
): { readonly steps: readonly ProductionBatchStep[]; readonly demands: ReadonlyMap<string, number> } {
    const children = productionChildren(produced);
    const pendingParents = new Map([...produced.keys()].map((itemId) => [itemId, 0]));
    for (const childIds of children.values()) {
        for (const childId of childIds) pendingParents.set(childId, (pendingParents.get(childId) ?? 0) + 1);
    }

    const ready = [...pendingParents]
        .filter(([, parentCount]) => parentCount === 0)
        .map(([itemId]) => itemId)
        .sort();
    const demands = new Map([[targetItemId, targetQuantity]]);
    const steps: ProductionBatchStep[] = [];

    while (ready.length > 0) {
        const itemId = ready.shift();
        if (itemId === undefined) break;
        const route = produced.get(itemId);
        if (route === undefined) throw new Error(`Missing production route for ${JSON.stringify(itemId)}`);
        requirePositive(route.outputQuantity, `${route.routeId} output quantity`);
        requirePositive(route.durationMinutesPerBatch, `${route.routeId} duration`);
        const requiredQuantity = demands.get(itemId) ?? 0;
        requirePositive(requiredQuantity, `${itemId} required quantity`);
        const batchCount = ceilWhole(requiredQuantity / route.outputQuantity);
        const inputs = route.inputs.map((input): ProductionStepInput => {
            const totalQuantity = input.quantity * batchCount;
            demands.set(input.itemId, (demands.get(input.itemId) ?? 0) + totalQuantity);
            return {
                itemId: input.itemId,
                quantityPerBatch: input.quantity,
                totalQuantity,
            };
        });
        const producedQuantity = route.outputQuantity * batchCount;
        steps.push({
            itemId,
            routeId: route.routeId,
            method: route.method,
            requiredQuantity,
            batchCount,
            outputQuantityPerBatch: route.outputQuantity,
            durationMinutesPerBatch: route.durationMinutesPerBatch,
            totalProcessMinutes: route.durationMinutesPerBatch * batchCount,
            producedQuantity,
            leftoverQuantity: cleanZero(producedQuantity - requiredQuantity),
            inputs,
        });

        for (const childId of children.get(itemId) ?? []) {
            const remaining = (pendingParents.get(childId) ?? 0) - 1;
            pendingParents.set(childId, remaining);
            if (remaining === 0) {
                ready.push(childId);
                ready.sort();
            }
        }
    }

    if (steps.length !== produced.size) throw new Error('Selected production routes contain a cycle');
    return { steps, demands };
}

function productionChildren(
    produced: ReadonlyMap<string, ProducedMaterialCost>
): ReadonlyMap<string, readonly string[]> {
    return new Map(
        [...produced].map(([itemId, route]) => [
            itemId,
            [...new Set(route.inputs.map((input) => input.itemId).filter((id) => produced.has(id)))].sort(),
        ])
    );
}

function purchase(cost: BasePurchaseMaterialCost, requiredQuantity: number): ProductionPurchase {
    const purchaseQuantity = ceilWhole(requiredQuantity);
    return {
        itemId: cost.itemId,
        requiredQuantity,
        purchaseQuantity,
        leftoverQuantity: cleanZero(purchaseQuantity - requiredQuantity),
        unitCost: cost.unitCost,
        requiredCost: requiredQuantity * cost.unitCost,
        purchaseCost: purchaseQuantity * cost.unitCost,
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
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
}
