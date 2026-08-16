import type { FinishedRecipeProductionReadinessInput } from '#core/production/finished-recipe-readiness-types';
import type { FinishedRecipeProductionReadinessResult } from '#core/production/finished-recipe-readiness-types';

export interface FinishedRecipeProductionExecutionEvidence {
    readonly startMinute: number;
    readonly executionModel: 'caller-supplied-exclusive-sequential-execution';
}

interface FinishedRecipeSaleEvidenceBase {
    readonly sellerId: string;
    readonly destinationId: string;
    readonly quantity: number;
    readonly startMinute: number;
    readonly completionMinute: number;
}

export type FinishedRecipeSaleCompletionEvidence =
    | FinishedRecipeSaleEvidenceBase & {
        readonly kind: 'direct';
        readonly travelDurationMinutes: number;
        readonly completionRule: 'caller-supplied-sale-confirmed-at-destination';
    }
    | FinishedRecipeSaleEvidenceBase & {
        readonly kind: 'delivered';
        readonly deliveryDurationMinutes: number;
        readonly completionRule: 'caller-supplied-delivery-confirmed-at-destination';
    };

export interface FinishedRecipeElapsedLifecycleInput {
    readonly readiness: FinishedRecipeProductionReadinessInput;
    readonly execution?: FinishedRecipeProductionExecutionEvidence;
    readonly sale?: FinishedRecipeSaleCompletionEvidence;
}

export type FinishedRecipeTerminalOperationTiming =
    | {
        readonly kind: 'none';
        readonly processedQuantity: 0;
        readonly remainderQuantity: number;
        readonly employeeRealSeconds: 0;
        readonly gameMinutes: 0;
    }
    | {
        readonly kind: 'packaging';
        readonly processedQuantity: number;
        readonly remainderQuantity: number;
        readonly employeeRealSeconds: number;
        readonly gameMinutes: number;
    }
    | {
        readonly kind: 'brick-pressing';
        readonly processedQuantity: number;
        readonly remainderQuantity: number;
        readonly employeeRealSeconds: number;
        readonly gameMinutes: number;
    };

export interface FinishedRecipeLifecycleProductionTiming {
    readonly executionModel:
        | 'caller-supplied-exclusive-sequential-execution'
        | 'not-established';
    readonly startMinute: number | null;
    readonly modeledProcessMinutes: number | null;
    readonly terminalOperation: FinishedRecipeTerminalOperationTiming;
    readonly totalElapsedMinutes: number | null;
    readonly completionMinute: number | null;
}

export interface FinishedRecipeLifecycleElapsedTiming {
    readonly inputReadyToProductionStartMinutes: number;
    readonly productionMinutes: number;
    readonly productionCompletionToSaleStartMinutes: number;
    readonly saleMinutes: number;
    readonly inputReadyToSaleCompletionMinutes: number;
}

export interface FinishedRecipeElapsedLifecycleGap {
    readonly code:
        | 'production-input-readiness-incomplete'
        | 'modeled-production-duration-incomplete'
        | 'production-execution-not-established'
        | 'sale-completion-not-established';
}

interface FinishedRecipeElapsedLifecycleDetails {
    readonly scope: 'production-input-readiness-through-completed-sale';
    readonly clock: 'game-minutes';
    readonly terminalClockConversion: 'core-real-seconds-per-game-minute';
    readonly resourceAvailability: 'caller-supplied-exclusive-execution-or-unavailable';
    readonly readiness: FinishedRecipeProductionReadinessResult;
    readonly production: FinishedRecipeLifecycleProductionTiming;
    readonly sale: FinishedRecipeSaleCompletionEvidence | null;
    readonly elapsed: FinishedRecipeLifecycleElapsedTiming | null;
    readonly gaps: readonly FinishedRecipeElapsedLifecycleGap[];
}

export type FinishedRecipeElapsedLifecycleResult =
    FinishedRecipeElapsedLifecycleDetails & (
        | {
            readonly status: 'complete';
            readonly proof: 'exact';
        }
        | {
            readonly status: 'unavailable';
            readonly proof: 'incomplete';
        }
    );
