export type RecipeSearchStopReason =
    | 'completed'
    | 'state-limit'
    | 'work-limit'
    | 'time-limit';

export type RecipeSearchLimitReason = Exclude<RecipeSearchStopReason, 'completed'>;

export interface RecipeSearchEvidence {
    readonly proofStatus: 'exact' | 'incomplete';
    readonly stopReason: RecipeSearchStopReason;
    /** Unique canonical states admitted to the search frontier. */
    readonly exploredStates: number;
    /** Frontier or candidate states rejected before expansion or admission. */
    readonly prunedStates: number;
    /** Highest ingredient depth fully completed when the search stopped. */
    readonly completedDepth: number;
    /** Mixing transitions evaluated by producers that support work accounting. */
    readonly transitionEvaluations?: number;
    /** Transition evaluations performed only to calculate pruning bounds. */
    readonly boundTransitionEvaluations?: number;
}

export interface RecipeSearchWorkEvidence {
    readonly transitionEvaluations: number;
    readonly boundTransitionEvaluations: number;
}

export function exactSearchEvidence(
    exploredStates: number,
    prunedStates: number,
    completedDepth: number,
    work?: RecipeSearchWorkEvidence
): RecipeSearchEvidence {
    return {
        proofStatus: 'exact',
        stopReason: 'completed',
        exploredStates,
        prunedStates,
        completedDepth,
        ...work,
    };
}

export function incompleteSearchEvidence(
    stopReason: RecipeSearchLimitReason,
    exploredStates: number,
    prunedStates: number,
    completedDepth: number,
    work?: RecipeSearchWorkEvidence
): RecipeSearchEvidence {
    return {
        proofStatus: 'incomplete',
        stopReason,
        exploredStates,
        prunedStates,
        completedDepth,
        ...work,
    };
}

export abstract class RecipeSearchInterruptedError extends Error {
    abstract readonly evidence: RecipeSearchEvidence;
}

export class RecipeSearchLimitError extends RecipeSearchInterruptedError {
    readonly depth: number;
    readonly maxStates: number;
    readonly evidence: RecipeSearchEvidence;

    constructor(
        depth: number,
        maxStates: number,
        exploredStates: number,
        prunedStates: number,
        work?: RecipeSearchWorkEvidence
    ) {
        super(`Recipe search exceeded the ${maxStates}-state limit while building depth ${depth}`);
        this.name = 'RecipeSearchLimitError';
        this.depth = depth;
        this.maxStates = maxStates;
        this.evidence = incompleteSearchEvidence(
            'state-limit',
            exploredStates,
            prunedStates,
            depth - 1,
            work
        );
    }
}

export class RecipeSearchWorkLimitError extends RecipeSearchInterruptedError {
    readonly depth: number;
    readonly maxTransitionEvaluations: number;
    readonly evidence: RecipeSearchEvidence;

    constructor(
        depth: number,
        maxTransitionEvaluations: number,
        exploredStates: number,
        prunedStates: number,
        work: RecipeSearchWorkEvidence
    ) {
        super(
            `Recipe search exceeded the ${maxTransitionEvaluations}-transition work limit while building depth ${depth}`
        );
        this.name = 'RecipeSearchWorkLimitError';
        this.depth = depth;
        this.maxTransitionEvaluations = maxTransitionEvaluations;
        this.evidence = incompleteSearchEvidence(
            'work-limit',
            exploredStates,
            prunedStates,
            depth - 1,
            work
        );
    }
}

export class RecipeSearchTimeLimitError extends RecipeSearchInterruptedError {
    readonly depth: number;
    readonly maxDurationMs: number;
    readonly elapsedMs: number;
    readonly evidence: RecipeSearchEvidence;

    constructor(
        depth: number,
        maxDurationMs: number,
        elapsedMs: number,
        exploredStates: number,
        prunedStates: number,
        completedDepth: number,
        work: RecipeSearchWorkEvidence
    ) {
        super(
            `Recipe search reached the ${maxDurationMs}-millisecond time limit at depth ${depth}`
        );
        this.name = 'RecipeSearchTimeLimitError';
        this.depth = depth;
        this.maxDurationMs = maxDurationMs;
        this.elapsedMs = elapsedMs;
        this.evidence = incompleteSearchEvidence(
            'time-limit',
            exploredStates,
            prunedStates,
            completedDepth,
            work
        );
    }
}
