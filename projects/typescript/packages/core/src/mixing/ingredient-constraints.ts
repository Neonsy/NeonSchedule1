import type { Item } from '#core/data/item';

export interface FinalIngredientConstraintInput {
    readonly requiredIngredientIds?: readonly string[];
    readonly forbiddenIngredientIds?: readonly string[];
    readonly minimumIngredientCount?: number;
    readonly exactIngredientCount?: number;
}

export class FinalIngredientConstraints {
    readonly #requiredIds: readonly string[];
    readonly #forbiddenIds: ReadonlySet<string>;
    readonly #minimumCount: number;
    readonly #exactCount: number | undefined;
    readonly #includeDepthInState: boolean;
    readonly maximumIngredientCount: number;

    constructor(
        itemsById: ReadonlyMap<string, Item>,
        availableIngredientIds: readonly string[],
        maxIngredients: number,
        input: FinalIngredientConstraintInput
    ) {
        requireNonNegativeSafeInteger(maxIngredients, 'maxIngredients');
        const available = new Set(availableIngredientIds);
        this.#requiredIds = ingredientIds(
            itemsById,
            input.requiredIngredientIds ?? [],
            'required'
        );
        this.#forbiddenIds = new Set(ingredientIds(
            itemsById,
            input.forbiddenIngredientIds ?? [],
            'forbidden'
        ));
        for (const ingredientId of this.#requiredIds) {
            if (!available.has(ingredientId)) {
                throw new Error(
                    `Required mixing ingredient ${JSON.stringify(ingredientId)} is not available`
                );
            }
            if (this.#forbiddenIds.has(ingredientId)) {
                throw new Error(
                    `Mixing ingredient ${JSON.stringify(ingredientId)} cannot be both required and forbidden`
                );
            }
        }

        this.#minimumCount = input.minimumIngredientCount ?? 0;
        this.#exactCount = input.exactIngredientCount;
        requireNonNegativeSafeInteger(
            this.#minimumCount,
            'minimumIngredientCount'
        );
        if (this.#exactCount !== undefined) {
            requireNonNegativeSafeInteger(this.#exactCount, 'exactIngredientCount');
            if (this.#exactCount > maxIngredients) {
                throw new Error('exactIngredientCount cannot exceed maxIngredients');
            }
            if (this.#minimumCount > this.#exactCount) {
                throw new Error(
                    'minimumIngredientCount cannot exceed exactIngredientCount'
                );
            }
        } else if (this.#minimumCount > maxIngredients) {
            throw new Error('minimumIngredientCount cannot exceed maxIngredients');
        }
        this.maximumIngredientCount = this.#exactCount ?? maxIngredients;
        if (this.#requiredIds.length > this.maximumIngredientCount) {
            throw new Error(
                'Required mixing ingredient count exceeds the final ingredient-count limit'
            );
        }
        this.#includeDepthInState =
            this.#minimumCount > 0 || this.#exactCount !== undefined;
    }

    allows(ingredientId: string): boolean {
        return !this.#forbiddenIds.has(ingredientId);
    }

    matches(ingredientIds: readonly string[]): boolean {
        if (ingredientIds.length < this.#minimumCount) return false;
        if (this.#exactCount !== undefined && ingredientIds.length !== this.#exactCount) {
            return false;
        }
        return this.#requiredIds.every((ingredientId) =>
            ingredientIds.includes(ingredientId)
        );
    }

    canStillMatch(
        ingredientIds: readonly string[],
        remainingIngredients: number
    ): boolean {
        if (ingredientIds.length > this.maximumIngredientCount) return false;
        if (ingredientIds.length + remainingIngredients < this.#minimumCount) return false;
        if (this.#exactCount !== undefined &&
            ingredientIds.length + remainingIngredients < this.#exactCount) {
            return false;
        }
        let missingRequired = 0;
        for (const ingredientId of this.#requiredIds) {
            if (!ingredientIds.includes(ingredientId)) missingRequired++;
        }
        return missingRequired <= remainingIngredients;
    }

    stateKey(
        effectIds: readonly string[],
        ingredientIds: readonly string[]
    ): string {
        const requiredProgress = this.#requiredIds.map((ingredientId) =>
            ingredientIds.includes(ingredientId) ? 1 : 0
        );
        return JSON.stringify([
            effectIds,
            requiredProgress,
            ...(this.#includeDepthInState ? [ingredientIds.length] : []),
        ]);
    }
}

function ingredientIds(
    itemsById: ReadonlyMap<string, Item>,
    input: readonly string[],
    kind: 'required' | 'forbidden'
): string[] {
    if (!Array.isArray(input)) {
        throw new TypeError(`${kind}IngredientIds must be an array`);
    }
    const result = [...input].sort();
    for (let index = 0; index < result.length; index++) {
        const ingredientId = result[index]!;
        if (typeof ingredientId !== 'string' || ingredientId.length === 0) {
            throw new TypeError(`${kind}IngredientIds must contain non-empty strings`);
        }
        if (index > 0 && result[index - 1] === ingredientId) {
            throw new Error(
                `Duplicate ${kind} mixing ingredient ${JSON.stringify(ingredientId)}`
            );
        }
        const item = itemsById.get(ingredientId);
        if (item === undefined) {
            throw new Error(`Unknown ${kind} mixing ingredient ${JSON.stringify(ingredientId)}`);
        }
        if (item.mixingIngredient === null) {
            throw new Error(`Item ${JSON.stringify(ingredientId)} is not a mixing ingredient`);
        }
    }
    return result;
}

function requireNonNegativeSafeInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${name} must be a non-negative safe integer`);
    }
}
