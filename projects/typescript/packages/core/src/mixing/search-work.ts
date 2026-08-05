import type { RecipeSearchWorkEvidence } from '#core/mixing/search-evidence';

interface MutableRecipeSearchWorkEvidence {
    transitionEvaluations: number;
    boundTransitionEvaluations: number;
}

export class RecipeSearchWorkBudget {
    readonly #maximum: number | undefined;
    readonly #evidence: MutableRecipeSearchWorkEvidence;
    readonly #limitError: (maximum: number) => Error;
    #used = 0;

    constructor(
        maximum: number | undefined,
        evidence: MutableRecipeSearchWorkEvidence,
        limitError: (maximum: number) => Error
    ) {
        this.#maximum = maximum;
        this.#evidence = evidence;
        this.#limitError = limitError;
    }

    transition(): void {
        this.#consume(false);
    }

    boundTransition(): void {
        this.#consume(true);
    }

    #consume(bound: boolean): void {
        if (this.#maximum !== undefined && this.#used >= this.#maximum) {
            throw this.#limitError(this.#maximum);
        }
        this.#used++;
        this.#evidence.transitionEvaluations++;
        if (bound) this.#evidence.boundTransitionEvaluations++;
    }
}

export function emptySearchWorkEvidence(): RecipeSearchWorkEvidence {
    return { transitionEvaluations: 0, boundTransitionEvaluations: 0 };
}
