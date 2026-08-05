export interface RecipeSearchEvidence {
    readonly proofStatus: 'exact' | 'incomplete';
    readonly stopReason: 'completed' | 'state-limit';
    /** Unique canonical states admitted to the search frontier. */
    readonly exploredStates: number;
    /** Frontier or candidate states rejected before expansion or admission. */
    readonly prunedStates: number;
    /** Highest ingredient depth fully completed when the search stopped. */
    readonly completedDepth: number;
}

export function exactSearchEvidence(
    exploredStates: number,
    prunedStates: number,
    completedDepth: number
): RecipeSearchEvidence {
    return {
        proofStatus: 'exact',
        stopReason: 'completed',
        exploredStates,
        prunedStates,
        completedDepth,
    };
}

export class RecipeSearchLimitError extends Error {
    readonly depth: number;
    readonly maxStates: number;
    readonly evidence: RecipeSearchEvidence;

    constructor(
        depth: number,
        maxStates: number,
        exploredStates: number,
        prunedStates: number
    ) {
        super(`Recipe search exceeded the ${maxStates}-state limit while building depth ${depth}`);
        this.name = 'RecipeSearchLimitError';
        this.depth = depth;
        this.maxStates = maxStates;
        this.evidence = {
            proofStatus: 'incomplete',
            stopReason: 'state-limit',
            exploredStates,
            prunedStates,
            completedDepth: depth - 1,
        };
    }
}
