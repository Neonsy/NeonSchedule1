import type { Item } from '#core/data/item';
import type { ProductionCatalog, ProductionStation } from '#core/data/production';

export interface FinishedRecipePackagingOptions {
    readonly stationItemId: string;
    readonly packagingItemId: string;
    readonly employeePackagingSpeedMultiplier: number;
    readonly employeeCurrentWorkSpeed: number;
}

export interface FinishedRecipePackagingStep {
    readonly position: 'after-optional-drying';
    readonly stationItemId: string;
    readonly stationKind: 'packaging' | 'packaging-mk2';
    readonly productItemId: string;
    readonly packagingItemId: string;
    readonly inputProductState: 'unpackaged';
    readonly outputProductState: 'packaged';
    readonly inputProductQuantity: number;
    readonly productQuantityPerPackage: number;
    readonly packageCount: number;
    readonly packagedProductQuantity: number;
    readonly unpackagedRemainderQuantity: number;
    readonly packagingMaterialQuantity: number;
    readonly outputSlotCapacityPackages: number;
    readonly outputBatchPackageCounts: readonly number[];
    readonly employeeBaseSecondsPerPackage: number;
    readonly employeePackagingSpeedMultiplier: number;
    readonly stationEmployeeSpeedMultiplier: number;
    readonly employeeCurrentWorkSpeed: number;
    readonly employeeSecondsPerPackage: number;
    readonly totalEmployeeRealSeconds: number;
}

export interface PackagingMaterialDemand {
    readonly itemId: string;
    readonly requiredQuantity: number;
    readonly unitCost: number;
}

type PackagingStation = Extract<
    ProductionStation,
    { readonly kind: 'packaging' | 'packaging-mk2' }
>;

export function isPackagingAvailable(
    itemsById: ReadonlyMap<string, Item>,
    productId: string
): boolean {
    const product = itemsById.get(productId)?.product;
    if (product === null || product === undefined) {
        throw new Error(`Recipe product ${JSON.stringify(productId)} is not a product`);
    }
    return product.validPackagingIds.length > 0;
}

export function planFinishedRecipePackaging(
    itemsById: ReadonlyMap<string, Item>,
    catalog: ProductionCatalog,
    productId: string,
    quantity: number,
    options: FinishedRecipePackagingOptions
): FinishedRecipePackagingStep {
    const productItem = itemsById.get(productId);
    const product = productItem?.product;
    if (productItem === undefined || product === null || product === undefined) {
        throw new Error(`Recipe product ${JSON.stringify(productId)} is not a product`);
    }
    const packagingItem = itemsById.get(options.packagingItemId);
    if (packagingItem?.packaging === null || packagingItem?.packaging === undefined) {
        throw new Error(`Unknown packaging item ${JSON.stringify(options.packagingItemId)}`);
    }
    if (!product.validPackagingIds.includes(packagingItem.id)) {
        throw new Error(
            `Packaging item ${JSON.stringify(packagingItem.id)} is not valid for product ${JSON.stringify(productId)}`
        );
    }
    const station = packagingStation(catalog, options.stationItemId);
    requirePositive(
        options.employeePackagingSpeedMultiplier,
        'Employee packaging speed multiplier'
    );
    requirePositive(options.employeeCurrentWorkSpeed, 'Employee current work speed');
    requirePositiveInteger(
        packagingItem.packaging.quantity,
        `Packaging item ${JSON.stringify(packagingItem.id)} product quantity`
    );
    requirePositiveInteger(
        productItem.stackLimit,
        `Product ${JSON.stringify(productId)} stack limit`
    );
    const productQuantityPerPackage = packagingItem.packaging.quantity;
    const packageCount = Math.floor(quantity / productQuantityPerPackage);
    if (packageCount === 0) {
        throw new Error(
            `Product quantity is insufficient for one ${JSON.stringify(packagingItem.id)} package`
        );
    }
    const packagedProductQuantity = packageCount * productQuantityPerPackage;
    const employeeBaseSecondsPerPackage = catalog.packaging.employeeBaseSecondsPerOperation;
    const employeeSecondsPerPackage =
        employeeBaseSecondsPerPackage /
        options.employeePackagingSpeedMultiplier /
        station.employeeSpeedMultiplier /
        options.employeeCurrentWorkSpeed;
    return {
        position: 'after-optional-drying',
        stationItemId: station.itemId,
        stationKind: station.kind,
        productItemId: productId,
        packagingItemId: packagingItem.id,
        inputProductState: 'unpackaged',
        outputProductState: 'packaged',
        inputProductQuantity: quantity,
        productQuantityPerPackage,
        packageCount,
        packagedProductQuantity,
        unpackagedRemainderQuantity: quantity - packagedProductQuantity,
        packagingMaterialQuantity: packageCount,
        outputSlotCapacityPackages: productItem.stackLimit,
        outputBatchPackageCounts: splitBatches(packageCount, productItem.stackLimit),
        employeeBaseSecondsPerPackage,
        employeePackagingSpeedMultiplier: options.employeePackagingSpeedMultiplier,
        stationEmployeeSpeedMultiplier: station.employeeSpeedMultiplier,
        employeeCurrentWorkSpeed: options.employeeCurrentWorkSpeed,
        employeeSecondsPerPackage,
        totalEmployeeRealSeconds: packageCount * employeeSecondsPerPackage,
    };
}

export function packagingMaterialDemand(
    itemsById: ReadonlyMap<string, Item>,
    step: FinishedRecipePackagingStep
): PackagingMaterialDemand {
    const unitCost = itemsById.get(step.packagingItemId)?.packaging?.basePurchasePrice;
    if (unitCost === undefined) {
        throw new Error(`Unknown packaging item ${JSON.stringify(step.packagingItemId)}`);
    }
    requireNonNegative(unitCost, `Packaging item ${JSON.stringify(step.packagingItemId)} price`);
    return {
        itemId: step.packagingItemId,
        requiredQuantity: step.packagingMaterialQuantity,
        unitCost,
    };
}

function packagingStation(catalog: ProductionCatalog, itemId: string): PackagingStation {
    const station = catalog.stations.find((candidate) => candidate.itemId === itemId);
    if (station?.kind !== 'packaging' && station?.kind !== 'packaging-mk2') {
        throw new Error(`Unknown packaging station ${JSON.stringify(itemId)}`);
    }
    requirePositive(
        station.employeeSpeedMultiplier,
        `Packaging station ${JSON.stringify(itemId)} employee speed multiplier`
    );
    return station;
}

function splitBatches(quantity: number, capacity: number): number[] {
    const batches: number[] = [];
    for (let remaining = quantity; remaining > 0; remaining -= capacity) {
        batches.push(Math.min(remaining, capacity));
    }
    return batches;
}

function requirePositive(value: number, label: string): void {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`);
}

function requirePositiveInteger(value: number, label: string): void {
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${label} must be a positive integer`);
    }
}

function requireNonNegative(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative`);
}
