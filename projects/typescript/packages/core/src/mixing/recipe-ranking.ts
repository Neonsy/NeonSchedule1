import type { RecipeEvaluation } from '#core/mixing/recipe';

/**
 * Rankings apply to the canonical cheapest recipe representative for each ordered effect state.
 * Product value and return on cost sort high to low; fewest steps and lowest cost sort low to high.
 * Return on cost is product value divided by total cost and excludes a zero total cost.
 */
export const recipeSearchObjectives = [
    'productValue',
    'netValue',
    'fewestSteps',
    'lowestCost',
    'returnOnCost',
] as const;

export type RecipeSearchObjective = typeof recipeSearchObjectives[number];

export interface RecipeRankingKey {
    readonly productId: string;
    readonly ingredientIds: readonly string[];
    readonly effectIds: readonly string[];
    readonly productValue: number;
    readonly baseProductCost: number;
    readonly ingredientCost: number;
}

export function compareRecipeEvaluations(
    left: RecipeEvaluation,
    right: RecipeEvaluation,
    objective: RecipeSearchObjective
): number {
    return compareRecipeRankingKeys(left, right, objective);
}

export function compareRecipeRankingKeys(
    left: RecipeRankingKey,
    right: RecipeRankingKey,
    objective: RecipeSearchObjective
): number {
    const objectiveComparison = compareObjectiveScores(
        recipeSearchScore(
            left.productValue,
            left.baseProductCost,
            left.ingredientCost,
            left.ingredientIds.length,
            objective
        ),
        recipeSearchScore(
            right.productValue,
            right.baseProductCost,
            right.ingredientCost,
            right.ingredientIds.length,
            objective
        )
    );
    if (objectiveComparison !== 0) return objectiveComparison;

    const tieComparison = objectiveTieComparison(left, right, objective);
    return tieComparison ||
        compareStrings(left.ingredientIds, right.ingredientIds) ||
        compareStrings(left.effectIds, right.effectIds) ||
        compareString(left.productId, right.productId);
}

export function recipeSearchScore(
    productValue: number,
    baseProductCost: number,
    ingredientCost: number,
    ingredientCount: number,
    objective: RecipeSearchObjective
): number | null {
    const totalCost = baseProductCost + ingredientCost;
    switch (objective) {
        case 'productValue': return productValue;
        case 'netValue': return productValue - totalCost;
        case 'fewestSteps': return -ingredientCount;
        case 'lowestCost': return -totalCost;
        case 'returnOnCost': return totalCost === 0 ? null : productValue / totalCost;
    }
}

export function isRecipeRankable(
    totalCost: number,
    objective: RecipeSearchObjective
): boolean {
    return objective !== 'returnOnCost' || totalCost > 0;
}

export function requireRecipeSearchObjective(objective: string): RecipeSearchObjective {
    if (objective === 'profitOverTime') {
        throw new Error(
            'Recipe profit-over-time ranking is unsupported because recipe results do not establish complete production duration'
        );
    }
    if (!(recipeSearchObjectives as readonly string[]).includes(objective)) {
        throw new Error(`Unknown recipe search objective ${JSON.stringify(objective)}`);
    }
    return objective as RecipeSearchObjective;
}

function compareObjectiveScores(left: number | null, right: number | null): number {
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    if (left === right) return 0;
    return left > right ? -1 : 1;
}

function objectiveTieComparison(
    left: RecipeRankingKey,
    right: RecipeRankingKey,
    objective: RecipeSearchObjective
): number {
    const leftTotalCost = left.baseProductCost + left.ingredientCost;
    const rightTotalCost = right.baseProductCost + right.ingredientCost;
    switch (objective) {
        case 'productValue':
        case 'netValue':
            return left.ingredientCost - right.ingredientCost ||
                left.ingredientIds.length - right.ingredientIds.length;
        case 'fewestSteps':
            return leftTotalCost - rightTotalCost || right.productValue - left.productValue;
        case 'lowestCost':
            return left.ingredientIds.length - right.ingredientIds.length ||
                right.productValue - left.productValue;
        case 'returnOnCost':
            return (
                (right.productValue - rightTotalCost) -
                    (left.productValue - leftTotalCost) ||
                leftTotalCost - rightTotalCost ||
                left.ingredientIds.length - right.ingredientIds.length
            );
    }
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
