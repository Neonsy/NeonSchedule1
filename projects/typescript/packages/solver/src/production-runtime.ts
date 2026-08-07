import type { MonotonicClock } from '@neonschedule1/core';

import type { SolverDataset } from '#solver/dataset';
import { LiveFallbackRunner } from '#solver/live-fallback';
import {
    loadPackagedRecipeCorpusProduction,
} from '#solver/precompute-package';
import type { LoadedRecipeCorpusProduction } from '#solver/precompute-production';
import { ProductionRequestRouter } from '#solver/production-router';
import { ProductionSolver } from '#solver/production-solver';

export interface ProductionRuntimeOptions {
    readonly packageDirectory: string;
    readonly clock?: MonotonicClock;
}

export interface LoadedProductionRuntime {
    readonly production: LoadedRecipeCorpusProduction;
    readonly solver: ProductionSolver;
}

export async function loadProductionRuntime(
    dataset: SolverDataset,
    options: ProductionRuntimeOptions
): Promise<LoadedProductionRuntime> {
    const production = await loadPackagedRecipeCorpusProduction(
        dataset,
        options.packageDirectory
    );
    const router = new ProductionRequestRouter(production);
    const fallback = new LiveFallbackRunner(
        dataset,
        production,
        options.clock
    );
    return {
        production,
        solver: new ProductionSolver(router, fallback),
    };
}
