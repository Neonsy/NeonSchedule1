import { shoppingRouteContext } from '#core/production/shopping-route-input';
import { searchShoppingRoutes } from '#core/production/shopping-route-search';
import type {
    FinishedRecipeShoppingRouteInput,
    FinishedRecipeShoppingRouteResult,
} from '#core/production/shopping-route-types';

export type {
    FinishedRecipeRemoteDeliveryAllocation,
    FinishedRecipeRemoteDeliveryEvidence,
    FinishedRecipeRemoteDeliveryFact,
    FinishedRecipeShoppingAllocation,
    FinishedRecipeShoppingEvidenceGap,
    FinishedRecipeShoppingMovementModel,
    FinishedRecipeShoppingObjective,
    FinishedRecipeShoppingRouteInput,
    FinishedRecipeShoppingRoutePlan,
    FinishedRecipeShoppingRouteResult,
    FinishedRecipeShoppingRouteVisit,
    FinishedRecipeShoppingTravelEvidence,
    FinishedRecipeShoppingTravelLeg,
    FinishedRecipeShoppingTrip,
} from '#core/production/shopping-route-types';

export function planFinishedRecipeShoppingRoute(
    input: FinishedRecipeShoppingRouteInput
): FinishedRecipeShoppingRouteResult {
    const context = shoppingRouteContext(input);
    if (context === 'purchase-demand-incomplete') {
        return {
            kind: 'not-planned',
            reason: context,
            proof: 'incomplete',
            evidenceGaps: [],
            visitedStates: 0,
            maximumStates: input.maximumStates,
        };
    }
    const result = searchShoppingRoutes(context);
    if (result.plan === null) {
        const exact = context.evidenceComplete && !result.exhausted;
        return {
            kind: 'not-planned',
            reason: result.exhausted
                ? 'search-limit-before-feasible-plan'
                : result.foundCompleteAllocation
                    ? 'no-known-feasible-route'
                    : 'no-supported-complete-fulfillment',
            proof: exact ? 'exact' : 'incomplete',
            evidenceGaps: context.evidenceGaps,
            visitedStates: result.visitedStates,
            maximumStates: input.maximumStates,
        };
    }
    const optimal = context.evidenceComplete && !result.exhausted;
    return {
        kind: 'planned',
        plan: {
            ...result.plan,
            proof: optimal ? 'optimal' : 'best-known-feasible',
            evidenceProof: context.evidenceComplete ? 'complete' : 'incomplete',
            searchProof: result.exhausted ? 'state-limit-reached' : 'exhaustive',
            visitedStates: result.visitedStates,
        },
    };
}
