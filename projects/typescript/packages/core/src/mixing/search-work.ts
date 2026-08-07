import type { RecipeSearchWorkEvidence } from '#core/mixing/search-evidence';

interface MutableRecipeSearchWorkEvidence {
    transitionEvaluations: number;
    boundTransitionEvaluations: number;
}

export interface MonotonicClock {
    now(): number;
}

export const systemMonotonicClock: MonotonicClock = Object.freeze({
    now: runtimeMonotonicNow,
});

export interface RecipeSearchTimeBudget {
    readonly maximumMs: number;
    readonly clock: MonotonicClock;
    readonly limitError: (maximumMs: number, elapsedMs: number) => Error;
}

const timeCheckTransitionInterval = 1_024;

export class RecipeSearchWorkBudget {
    readonly #maximum: number | undefined;
    readonly #evidence: MutableRecipeSearchWorkEvidence;
    readonly #limitError: (maximum: number) => Error;
    readonly #time: (RecipeSearchTimeBudget & { readonly startedAt: number }) | undefined;
    #used = 0;

    constructor(
        maximum: number | undefined,
        evidence: MutableRecipeSearchWorkEvidence,
        limitError: (maximum: number) => Error,
        time?: RecipeSearchTimeBudget
    ) {
        this.#maximum = maximum;
        this.#evidence = evidence;
        this.#limitError = limitError;
        this.#time = time === undefined
            ? undefined
            : { ...time, startedAt: readClock(time.clock) };
    }

    transition(): void {
        this.#consume(false);
    }

    boundTransition(): void {
        this.#consume(true);
    }

    checkpoint(): void {
        if (this.#time === undefined) return;
        const current = readClock(this.#time.clock);
        if (current < this.#time.startedAt) {
            throw new Error('Monotonic clock moved backwards during recipe search');
        }
        const elapsedMs = current - this.#time.startedAt;
        if (elapsedMs >= this.#time.maximumMs) {
            throw this.#time.limitError(this.#time.maximumMs, elapsedMs);
        }
    }

    #consume(bound: boolean): void {
        if (this.#time !== undefined &&
            this.#used % timeCheckTransitionInterval === 0) {
            this.checkpoint();
        }
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

function readClock(clock: MonotonicClock): number {
    const value = clock.now();
    if (!Number.isFinite(value)) {
        throw new Error('Monotonic clock must return a finite number');
    }
    return value;
}

function runtimeMonotonicNow(): number {
    const runtime = globalThis as typeof globalThis & {
        readonly performance?: { now(): number };
    };
    if (runtime.performance === undefined) {
        throw new Error('This runtime does not provide a monotonic performance clock');
    }
    return runtime.performance.now();
}
