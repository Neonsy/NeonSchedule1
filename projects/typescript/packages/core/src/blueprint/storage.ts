import type { BlueprintDocument } from '#core/data/blueprint';
import { BuildableSchema, type Buildable } from '#core/data/buildable';
import {
    BlueprintValidator,
    type BlueprintDataset,
    type BlueprintValidationResult,
} from '#core/blueprint/validation';

export interface BlueprintStoragePlacementSummary {
    readonly placementId: string;
    readonly itemId: string;
    readonly storageName: string;
    readonly storageSubtitle: string;
    readonly slotCount: number;
    readonly displayRowCount: number;
    readonly slotsAreFilterable: boolean;
    readonly maximumAccessDistance: number;
    readonly currentContentsBasis: 'not-evaluated-blueprint-has-no-runtime-contents';
    readonly occupiedSlotCount: null;
    readonly availableSlotCount: null;
}

export type BlueprintStorageSummary =
    | {
        readonly kind: 'rejected';
        readonly validation: BlueprintValidationResult;
        readonly slotCapacityProofStatus: 'not-applicable';
        readonly capacityScope: 'not-applicable';
        readonly storagePlacements: readonly [];
        readonly nonStoragePlacementIds: readonly [];
    }
    | {
        readonly kind: 'summarized';
        readonly validation: BlueprintValidationResult;
        readonly slotCapacityProofStatus: 'exact';
        readonly capacityScope: 'normalized-storage-on-valid-blueprint-placements';
        readonly currentContentsBasis: 'not-evaluated-blueprint-has-no-runtime-contents';
        readonly placementCount: number;
        readonly storagePlacementCount: number;
        readonly totalSlotCount: number;
        readonly occupiedSlotCount: null;
        readonly availableSlotCount: null;
        readonly storagePlacements: readonly BlueprintStoragePlacementSummary[];
        readonly nonStoragePlacementIds: readonly string[];
    };

export class BlueprintStorageSummarizer {
    readonly #validator: BlueprintValidator;
    readonly #buildableByItemId: ReadonlyMap<string, Buildable>;

    constructor(dataset: BlueprintDataset) {
        this.#validator = new BlueprintValidator(dataset);
        this.#buildableByItemId = indexUnique(
            dataset.buildables.map((input) => {
                const buildable = BuildableSchema.assert(input);
                if (buildable.storage !== null) validateStorage(buildable);
                return buildable;
            }),
            (buildable) => buildable.itemId,
            'buildable item ID'
        );
    }

    summarize(input: BlueprintDocument): BlueprintStorageSummary {
        const validation = this.#validator.validate(input);
        if (!validation.valid) {
            return {
                kind: 'rejected',
                validation,
                slotCapacityProofStatus: 'not-applicable',
                capacityScope: 'not-applicable',
                storagePlacements: [],
                nonStoragePlacementIds: [],
            };
        }

        const storagePlacements: BlueprintStoragePlacementSummary[] = [];
        const nonStoragePlacementIds: string[] = [];
        let totalSlotCount = 0;
        for (const placement of validation.resolvedPlacements) {
            const buildable = this.#buildableByItemId.get(placement.itemId);
            if (buildable === undefined) {
                throw new Error(
                    `Validated blueprint references unavailable buildable ${JSON.stringify(placement.itemId)}`
                );
            }
            const storage = buildable.storage;
            if (storage === null) {
                nonStoragePlacementIds.push(placement.id);
                continue;
            }
            totalSlotCount = addSlotCounts(totalSlotCount, storage.slotCount);
            storagePlacements.push({
                placementId: placement.id,
                itemId: placement.itemId,
                storageName: storage.name,
                storageSubtitle: storage.subtitle,
                slotCount: storage.slotCount,
                displayRowCount: storage.displayRowCount,
                slotsAreFilterable: storage.slotsAreFilterable,
                maximumAccessDistance: storage.maxAccessDistance,
                currentContentsBasis: 'not-evaluated-blueprint-has-no-runtime-contents',
                occupiedSlotCount: null,
                availableSlotCount: null,
            });
        }

        return {
            kind: 'summarized',
            validation,
            slotCapacityProofStatus: 'exact',
            capacityScope: 'normalized-storage-on-valid-blueprint-placements',
            currentContentsBasis: 'not-evaluated-blueprint-has-no-runtime-contents',
            placementCount: validation.resolvedPlacements.length,
            storagePlacementCount: storagePlacements.length,
            totalSlotCount,
            occupiedSlotCount: null,
            availableSlotCount: null,
            storagePlacements,
            nonStoragePlacementIds,
        };
    }
}

function validateStorage(buildable: Buildable): void {
    const storage = buildable.storage!;
    requireNonNegativeSafeInteger(
        storage.slotCount,
        `Buildable ${JSON.stringify(buildable.itemId)} storage slot count`
    );
    requireNonNegativeSafeInteger(
        storage.displayRowCount,
        `Buildable ${JSON.stringify(buildable.itemId)} storage display row count`
    );
    if (!Number.isFinite(storage.maxAccessDistance) || storage.maxAccessDistance < 0) {
        throw new RangeError(
            `Buildable ${JSON.stringify(buildable.itemId)} storage maximum access distance ` +
                'must be non-negative and finite'
        );
    }
}

function addSlotCounts(left: number, right: number): number {
    const result = left + right;
    if (!Number.isSafeInteger(result)) {
        throw new RangeError('Blueprint total storage slot count exceeds the safe integer range');
    }
    return result;
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${label} must be a non-negative safe integer`);
    }
}

function indexUnique<T>(
    values: readonly T[],
    keyFor: (value: T) => string,
    label: string
): ReadonlyMap<string, T> {
    const result = new Map<string, T>();
    for (const value of values) {
        const key = keyFor(value);
        if (result.has(key)) {
            throw new Error(`Dataset contains duplicate ${label} ${JSON.stringify(key)}`);
        }
        result.set(key, value);
    }
    return result;
}
