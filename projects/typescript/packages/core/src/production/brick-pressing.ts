import type { Item } from '#core/data/item';
import type { ProductionCatalog, ProductionStation } from '#core/data/production';

export interface FinishedRecipeBrickPressingOptions {
    readonly stationItemId: string;
    readonly employeePackagingSpeedMultiplier: number;
    readonly employeeCurrentWorkSpeed: number;
}

export interface FinishedRecipeBrickPressingStep {
    readonly position: 'after-optional-drying';
    readonly stationItemId: string;
    readonly stationKind: 'brick-press';
    readonly productItemId: string;
    readonly outputPackagingItemId: string;
    readonly inputProductState: 'unpackaged';
    readonly outputProductState: 'packaged';
    readonly inputProductQuantity: number;
    readonly productQuantityPerBrick: number;
    readonly brickCount: number;
    readonly pressedProductQuantity: number;
    readonly unpackagedRemainderQuantity: number;
    readonly packagingMaterialConsumption: 'none';
    readonly outputSlotCapacityBricks: number;
    readonly outputBatchBrickCounts: readonly number[];
    readonly employeeBaseSecondsPerBrick: number;
    readonly employeeCompletionOverheadSecondsPerBrick: number;
    readonly employeePackagingSpeedMultiplier: number;
    readonly employeeCurrentWorkSpeed: number;
    readonly employeeSecondsPerBrick: number;
    readonly totalEmployeeRealSeconds: number;
    readonly manualDuration: 'interactive-not-fixed';
}

type BrickPressStation = Extract<ProductionStation, { readonly kind: 'brick-press' }>;

export function isBrickPressingAvailable(
    itemsById: ReadonlyMap<string, Item>,
    catalog: ProductionCatalog,
    productId: string
): boolean {
    const product = itemsById.get(productId)?.product;
    if (product === null || product === undefined) {
        throw new Error(`Recipe product ${JSON.stringify(productId)} is not a product`);
    }
    return catalog.stations.some(
        (station) =>
            station.kind === 'brick-press' &&
            product.validPackagingIds.includes(station.packagingItemId)
    );
}

export function planFinishedRecipeBrickPressing(
    itemsById: ReadonlyMap<string, Item>,
    catalog: ProductionCatalog,
    productId: string,
    quantity: number,
    options: FinishedRecipeBrickPressingOptions
): FinishedRecipeBrickPressingStep {
    const productItem = itemsById.get(productId);
    const product = productItem?.product;
    if (productItem === undefined || product === null || product === undefined) {
        throw new Error(`Recipe product ${JSON.stringify(productId)} is not a product`);
    }
    const station = brickPressStation(catalog, options.stationItemId);
    const packagingItem = itemsById.get(station.packagingItemId);
    if (packagingItem?.packaging === null || packagingItem?.packaging === undefined) {
        throw new Error(
            `Brick press ${JSON.stringify(station.itemId)} has unknown output packaging item ${JSON.stringify(station.packagingItemId)}`
        );
    }
    if (!product.validPackagingIds.includes(packagingItem.id)) {
        throw new Error(
            `Brick packaging item ${JSON.stringify(packagingItem.id)} is not valid for product ${JSON.stringify(productId)}`
        );
    }
    requirePositiveInteger(
        station.packagingQuantity,
        `Brick press ${JSON.stringify(station.itemId)} product quantity`
    );
    requirePositiveInteger(
        packagingItem.packaging.quantity,
        `Brick packaging item ${JSON.stringify(packagingItem.id)} product quantity`
    );
    if (station.packagingQuantity !== packagingItem.packaging.quantity) {
        throw new Error(
            `Brick press ${JSON.stringify(station.itemId)} product quantity does not match packaging item ${JSON.stringify(packagingItem.id)}`
        );
    }
    requirePositiveInteger(
        productItem.stackLimit,
        `Product ${JSON.stringify(productId)} stack limit`
    );
    requirePositive(
        options.employeePackagingSpeedMultiplier,
        'Employee packaging speed multiplier'
    );
    requirePositive(options.employeeCurrentWorkSpeed, 'Employee current work speed');

    const productQuantityPerBrick = station.packagingQuantity;
    const brickCount = Math.floor(quantity / productQuantityPerBrick);
    if (brickCount === 0) {
        throw new Error(
            `Product quantity is insufficient for one brick from ${JSON.stringify(station.itemId)}`
        );
    }
    const pressedProductQuantity = brickCount * productQuantityPerBrick;
    const employeeBaseSecondsPerBrick =
        catalog.brickPressing.employeeBaseSecondsPerOperation;
    const employeeCompletionOverheadSecondsPerBrick =
        catalog.brickPressing.employeeCompletionOverheadSecondsPerOperation;
    const employeeSecondsPerBrick =
        employeeBaseSecondsPerBrick /
            options.employeePackagingSpeedMultiplier /
            options.employeeCurrentWorkSpeed +
        employeeCompletionOverheadSecondsPerBrick;

    return {
        position: 'after-optional-drying',
        stationItemId: station.itemId,
        stationKind: station.kind,
        productItemId: productId,
        outputPackagingItemId: packagingItem.id,
        inputProductState: 'unpackaged',
        outputProductState: 'packaged',
        inputProductQuantity: quantity,
        productQuantityPerBrick,
        brickCount,
        pressedProductQuantity,
        unpackagedRemainderQuantity: quantity - pressedProductQuantity,
        packagingMaterialConsumption: catalog.brickPressing.packagingMaterialConsumption,
        outputSlotCapacityBricks: productItem.stackLimit,
        outputBatchBrickCounts: splitBatches(brickCount, productItem.stackLimit),
        employeeBaseSecondsPerBrick,
        employeeCompletionOverheadSecondsPerBrick,
        employeePackagingSpeedMultiplier: options.employeePackagingSpeedMultiplier,
        employeeCurrentWorkSpeed: options.employeeCurrentWorkSpeed,
        employeeSecondsPerBrick,
        totalEmployeeRealSeconds: brickCount * employeeSecondsPerBrick,
        manualDuration: catalog.brickPressing.manualDuration,
    };
}

function brickPressStation(catalog: ProductionCatalog, itemId: string): BrickPressStation {
    const station = catalog.stations.find((candidate) => candidate.itemId === itemId);
    if (station?.kind !== 'brick-press') {
        throw new Error(`Unknown brick press ${JSON.stringify(itemId)}`);
    }
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
