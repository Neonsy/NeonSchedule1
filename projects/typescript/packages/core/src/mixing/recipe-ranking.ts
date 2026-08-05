import type { RecipeEvaluation } from '#core/mixing/recipe';

export type RecipeSearchObjective = 'productValue' | 'netValue';

export function compareRecipeEvaluations(
    left: RecipeEvaluation,
    right: RecipeEvaluation,
    objective: RecipeSearchObjective
): number {
    return (
        recipeSearchScore(
            right.productValue,
            right.baseProductCost,
            right.ingredientCost,
            objective
        ) -
            recipeSearchScore(
                left.productValue,
                left.baseProductCost,
                left.ingredientCost,
                objective
            ) ||
        left.ingredientCost - right.ingredientCost ||
        left.ingredientIds.length - right.ingredientIds.length ||
        compareStrings(left.ingredientIds, right.ingredientIds) ||
        compareStrings(left.effectIds, right.effectIds) ||
        compareString(left.productId, right.productId)
    );
}

export function recipeSearchScore(
    productValue: number,
    baseProductCost: number,
    ingredientCost: number,
    objective: RecipeSearchObjective
): number {
    return objective === 'productValue'
        ? productValue
        : productValue - baseProductCost - ingredientCost;
}

function compareStrings(left: readonly string[], right: readonly string[]): number {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
        const leftValue = left[index];
        const rightValue = right[index];
        if (leftValue === undefined || rightValue === undefined || leftValue === rightValue) continue;
        return compareString(leftValue, rightValue);
    }
    return left.length - right.length;
}

function compareString(left: string, right: string): number {
    if (left === right) return 0;
    return left < right ? -1 : 1;
}
