import type { FinishedRecipeProductionPlan } from '#core/production/finished-recipe';
import { composeFinishedRecipeProductionReadiness } from '#core/production/finished-recipe-readiness';
import { REAL_SECONDS_PER_GAME_MINUTE } from '#core/production/time';
import type {
    FinishedRecipeElapsedLifecycleGap,
    FinishedRecipeElapsedLifecycleInput,
    FinishedRecipeElapsedLifecycleResult,
    FinishedRecipeLifecycleElapsedTiming,
    FinishedRecipeLifecycleProductionTiming,
    FinishedRecipeSaleCompletionEvidence,
    FinishedRecipeTerminalOperationTiming,
} from '#core/production/finished-recipe-lifecycle-types';

export type {
    FinishedRecipeElapsedLifecycleGap,
    FinishedRecipeElapsedLifecycleInput,
    FinishedRecipeElapsedLifecycleResult,
    FinishedRecipeLifecycleElapsedTiming,
    FinishedRecipeLifecycleProductionTiming,
    FinishedRecipeProductionExecutionEvidence,
    FinishedRecipeSaleCompletionEvidence,
    FinishedRecipeTerminalOperationTiming,
} from '#core/production/finished-recipe-lifecycle-types';

export function composeFinishedRecipeElapsedLifecycle(
    input: FinishedRecipeElapsedLifecycleInput
): FinishedRecipeElapsedLifecycleResult {
    const readiness = composeFinishedRecipeProductionReadiness(input.readiness);
    const plan = input.readiness.productionPlan;
    const modeledProcessMinutes = validateModeledProcessDuration(plan);
    const terminalOperation = terminalOperationTiming(plan);
    const gaps: FinishedRecipeElapsedLifecycleGap[] = [];
    if (
        readiness.status !== 'ready' ||
        readiness.readinessProof !== 'exact' ||
        readiness.productionInputsReadyMinute === null
    ) {
        gaps.push({ code: 'production-input-readiness-incomplete' });
    }
    if (modeledProcessMinutes === null) {
        gaps.push({ code: 'modeled-production-duration-incomplete' });
    }
    const execution = input.execution;
    if (execution === undefined) {
        gaps.push({ code: 'production-execution-not-established' });
    } else {
        validateExecution(execution);
    }
    const sale = input.sale === undefined ? null : validateAndCloneSale(input.sale, plan);
    if (sale === null) gaps.push({ code: 'sale-completion-not-established' });

    const production = productionTiming(
        readiness.productionInputsReadyMinute,
        modeledProcessMinutes,
        terminalOperation,
        execution
    );
    if (
        sale !== null &&
        production.completionMinute !== null &&
        sale.startMinute < production.completionMinute
    ) {
        throw new Error('Finished recipe sale starts before production completion');
    }
    const elapsed = elapsedTiming(
        readiness.productionInputsReadyMinute,
        production,
        sale
    );
    const details = {
        scope: 'production-input-readiness-through-completed-sale',
        clock: 'game-minutes',
        terminalClockConversion: 'core-real-seconds-per-game-minute',
        resourceAvailability: 'caller-supplied-exclusive-execution-or-unavailable',
        readiness,
        production,
        sale,
        elapsed,
        gaps,
    } as const;
    return elapsed === null || gaps.length > 0
        ? { status: 'unavailable', proof: 'incomplete', ...details }
        : { status: 'complete', proof: 'exact', ...details };
}

function validateModeledProcessDuration(plan: FinishedRecipeProductionPlan): number | null {
    requirePositiveSafeInteger(plan.finishedQuantity, 'Finished recipe lifecycle quantity');
    const duration = plan.duration;
    requireNonNegativeFinite(
        duration.baseProductProcessMinutes,
        'Finished recipe base-product process minutes'
    );
    if (duration.baseProductProcessMinutes !== plan.baseProductPlan.totalProcessMinutes) {
        throw new Error('Finished recipe base-product process duration is inconsistent');
    }
    const mixingMinutes = finiteSum(
        plan.mixingSteps.map((step) => step.totalProcessMinutes),
        'Finished recipe mixing process minutes'
    );
    if (
        duration.mixingProcessMinutes !== null &&
        duration.mixingProcessMinutes !== mixingMinutes
    ) {
        throw new Error('Finished recipe mixing process duration is inconsistent');
    }
    if (duration.mixingProcessMinutes !== null) {
        requireNonNegativeFinite(
            duration.mixingProcessMinutes,
            'Finished recipe mixing process minutes'
        );
    }
    const dryingMinutes = plan.dryingStep?.totalProcessMinutes ?? null;
    if (duration.dryingProcessMinutes !== dryingMinutes) {
        throw new Error('Finished recipe drying process duration is inconsistent');
    }
    if (dryingMinutes !== null) {
        requireNonNegativeFinite(dryingMinutes, 'Finished recipe drying process minutes');
    }
    const knownProcessMinutes = finiteSum([
        duration.baseProductProcessMinutes,
        duration.mixingProcessMinutes ?? 0,
        duration.dryingProcessMinutes ?? 0,
    ], 'Finished recipe known process minutes');
    if (duration.knownProcessMinutes !== knownProcessMinutes) {
        throw new Error('Finished recipe known process duration is inconsistent');
    }
    if (plan.evidence.modeledDurationProof === 'partial') {
        if (duration.mixingProcessMinutes !== null || duration.modeledTotalProcessMinutes !== null) {
            throw new Error('Partial finished recipe duration evidence is inconsistent');
        }
        return null;
    }
    if (plan.evidence.modeledDurationProof !== 'complete') {
        throw new Error('Finished recipe modeled duration proof is invalid');
    }
    if (
        duration.mixingProcessMinutes === null ||
        duration.modeledTotalProcessMinutes !== knownProcessMinutes
    ) {
        throw new Error('Complete finished recipe duration evidence is inconsistent');
    }
    return duration.modeledTotalProcessMinutes;
}

function terminalOperationTiming(
    plan: FinishedRecipeProductionPlan
): FinishedRecipeTerminalOperationTiming {
    if (!Number.isFinite(REAL_SECONDS_PER_GAME_MINUTE) || REAL_SECONDS_PER_GAME_MINUTE <= 0) {
        throw new Error('Finished recipe terminal clock conversion must be positive');
    }
    if (plan.packagingStep !== null && plan.brickPressingStep !== null) {
        throw new Error('Finished recipe cannot have packaging and brick pressing together');
    }
    if (plan.packagingStep !== null) {
        if (plan.duration.brickPressingEmployeeRealSeconds !== null) {
            throw new Error('Finished recipe brick-pressing duration has no selected operation');
        }
        return packagingTiming(plan);
    }
    if (plan.brickPressingStep !== null) {
        if (plan.duration.packagingEmployeeRealSeconds !== null) {
            throw new Error('Finished recipe packaging duration has no selected operation');
        }
        return brickPressingTiming(plan);
    }
    if (
        plan.duration.packagingEmployeeRealSeconds !== null ||
        plan.duration.brickPressingEmployeeRealSeconds !== null
    ) {
        throw new Error('Finished recipe terminal duration has no selected operation');
    }
    return {
        kind: 'none',
        processedQuantity: 0,
        remainderQuantity: plan.finishedQuantity,
        employeeRealSeconds: 0,
        gameMinutes: 0,
    };
}

function packagingTiming(plan: FinishedRecipeProductionPlan): FinishedRecipeTerminalOperationTiming {
    const step = plan.packagingStep;
    if (step === null) throw new Error('Finished recipe packaging step is unavailable');
    validateTerminalQuantities(
        plan.finishedQuantity,
        step.inputProductQuantity,
        step.packagedProductQuantity,
        step.unpackagedRemainderQuantity,
        'packaging'
    );
    const seconds = plan.duration.packagingEmployeeRealSeconds;
    if (seconds === null || seconds !== step.totalEmployeeRealSeconds) {
        throw new Error('Finished recipe packaging duration is inconsistent');
    }
    requireNonNegativeFinite(seconds, 'Finished recipe packaging employee real seconds');
    return {
        kind: 'packaging',
        processedQuantity: step.packagedProductQuantity,
        remainderQuantity: step.unpackagedRemainderQuantity,
        employeeRealSeconds: seconds,
        gameMinutes: divideFinite(
            seconds,
            REAL_SECONDS_PER_GAME_MINUTE,
            'Finished recipe packaging game minutes'
        ),
    };
}

function brickPressingTiming(
    plan: FinishedRecipeProductionPlan
): FinishedRecipeTerminalOperationTiming {
    const step = plan.brickPressingStep;
    if (step === null) throw new Error('Finished recipe brick-pressing step is unavailable');
    validateTerminalQuantities(
        plan.finishedQuantity,
        step.inputProductQuantity,
        step.pressedProductQuantity,
        step.unpackagedRemainderQuantity,
        'brick-pressing'
    );
    const seconds = plan.duration.brickPressingEmployeeRealSeconds;
    if (seconds === null || seconds !== step.totalEmployeeRealSeconds) {
        throw new Error('Finished recipe brick-pressing duration is inconsistent');
    }
    requireNonNegativeFinite(seconds, 'Finished recipe brick-pressing employee real seconds');
    return {
        kind: 'brick-pressing',
        processedQuantity: step.pressedProductQuantity,
        remainderQuantity: step.unpackagedRemainderQuantity,
        employeeRealSeconds: seconds,
        gameMinutes: divideFinite(
            seconds,
            REAL_SECONDS_PER_GAME_MINUTE,
            'Finished recipe brick-pressing game minutes'
        ),
    };
}

function validateTerminalQuantities(
    finishedQuantity: number,
    inputQuantity: number,
    processedQuantity: number,
    remainderQuantity: number,
    label: string
): void {
    requirePositiveSafeInteger(inputQuantity, `Finished recipe ${label} input quantity`);
    requirePositiveSafeInteger(processedQuantity, `Finished recipe ${label} processed quantity`);
    requireNonNegativeSafeInteger(remainderQuantity, `Finished recipe ${label} remainder quantity`);
    if (
        inputQuantity !== finishedQuantity ||
        safeAdd(processedQuantity, remainderQuantity, `Finished recipe ${label} output quantity`) !==
            finishedQuantity
    ) {
        throw new Error(`Finished recipe ${label} quantities are inconsistent`);
    }
}

function validateExecution(
    execution: NonNullable<FinishedRecipeElapsedLifecycleInput['execution']>
): void {
    if (execution.executionModel !== 'caller-supplied-exclusive-sequential-execution') {
        throw new Error('Finished recipe production execution model is invalid');
    }
    requireNonNegativeFinite(execution.startMinute, 'Finished recipe production start minute');
}

function productionTiming(
    inputReadyMinute: number | null,
    modeledProcessMinutes: number | null,
    terminalOperation: FinishedRecipeTerminalOperationTiming,
    execution: FinishedRecipeElapsedLifecycleInput['execution']
): FinishedRecipeLifecycleProductionTiming {
    if (execution === undefined) {
        return {
            executionModel: 'not-established',
            startMinute: null,
            modeledProcessMinutes,
            terminalOperation,
            totalElapsedMinutes: null,
            completionMinute: null,
        };
    }
    if (inputReadyMinute !== null && execution.startMinute < inputReadyMinute) {
        throw new Error('Finished recipe production starts before its inputs are ready');
    }
    if (inputReadyMinute === null || modeledProcessMinutes === null) {
        return {
            executionModel: execution.executionModel,
            startMinute: execution.startMinute,
            modeledProcessMinutes,
            terminalOperation,
            totalElapsedMinutes: null,
            completionMinute: null,
        };
    }
    const totalElapsedMinutes = addFinite(
        modeledProcessMinutes,
        terminalOperation.gameMinutes,
        'Finished recipe production elapsed minutes'
    );
    return {
        executionModel: execution.executionModel,
        startMinute: execution.startMinute,
        modeledProcessMinutes,
        terminalOperation,
        totalElapsedMinutes,
        completionMinute: addFinite(
            execution.startMinute,
            totalElapsedMinutes,
            'Finished recipe production completion minute'
        ),
    };
}

function validateAndCloneSale(
    sale: FinishedRecipeSaleCompletionEvidence,
    plan: FinishedRecipeProductionPlan
): FinishedRecipeSaleCompletionEvidence {
    requireNonBlank(sale.sellerId, 'Finished recipe sale seller ID');
    requireNonBlank(sale.destinationId, 'Finished recipe sale destination ID');
    requirePositiveSafeInteger(sale.quantity, 'Finished recipe sale quantity');
    if (sale.quantity !== plan.finishedQuantity) {
        throw new Error('Finished recipe sale quantity does not match planned output');
    }
    requireNonNegativeFinite(sale.startMinute, 'Finished recipe sale start minute');
    requireNonNegativeFinite(sale.completionMinute, 'Finished recipe sale completion minute');
    if (sale.kind === 'direct') {
        if (sale.completionRule !== 'caller-supplied-sale-confirmed-at-destination') {
            throw new Error('Finished recipe direct-sale completion rule is invalid');
        }
        validateSaleCompletion(sale.startMinute, sale.travelDurationMinutes, sale.completionMinute);
        return { ...sale };
    }
    if (sale.kind !== 'delivered') throw new Error('Finished recipe sale kind is invalid');
    if (sale.completionRule !== 'caller-supplied-delivery-confirmed-at-destination') {
        throw new Error('Finished recipe delivered-sale completion rule is invalid');
    }
    validateSaleCompletion(sale.startMinute, sale.deliveryDurationMinutes, sale.completionMinute);
    return { ...sale };
}

function validateSaleCompletion(
    startMinute: number,
    durationMinutes: number,
    completionMinute: number
): void {
    requireNonNegativeFinite(durationMinutes, 'Finished recipe sale duration minutes');
    if (
        completionMinute !== addFinite(
            startMinute,
            durationMinutes,
            'Finished recipe sale completion minute'
        )
    ) {
        throw new Error('Finished recipe sale completion minute is inconsistent');
    }
}

function elapsedTiming(
    inputReadyMinute: number | null,
    production: FinishedRecipeLifecycleProductionTiming,
    sale: FinishedRecipeSaleCompletionEvidence | null
): FinishedRecipeLifecycleElapsedTiming | null {
    if (
        inputReadyMinute === null ||
        production.startMinute === null ||
        production.totalElapsedMinutes === null ||
        production.completionMinute === null ||
        sale === null
    ) return null;
    const saleMinutes = sale.kind === 'direct'
        ? sale.travelDurationMinutes
        : sale.deliveryDurationMinutes;
    return {
        inputReadyToProductionStartMinutes: finiteDifference(
            production.startMinute,
            inputReadyMinute,
            'Finished recipe pre-production wait'
        ),
        productionMinutes: production.totalElapsedMinutes,
        productionCompletionToSaleStartMinutes: finiteDifference(
            sale.startMinute,
            production.completionMinute,
            'Finished recipe pre-sale wait'
        ),
        saleMinutes,
        inputReadyToSaleCompletionMinutes: finiteDifference(
            sale.completionMinute,
            inputReadyMinute,
            'Finished recipe elapsed lifecycle'
        ),
    };
}

function finiteSum(values: readonly number[], label: string): number {
    let result = 0;
    for (const value of values) {
        requireNonNegativeFinite(value, label);
        result = addFinite(result, value, label);
    }
    return result;
}

function finiteDifference(left: number, right: number, label: string): number {
    const result = left - right;
    if (!Number.isFinite(result) || result < 0) throw new Error(`${label} must be non-negative`);
    return result;
}

function divideFinite(left: number, right: number, label: string): number {
    const result = left / right;
    if (!Number.isFinite(result) || result < 0) throw new Error(`${label} must be non-negative`);
    return result;
}

function addFinite(left: number, right: number, label: string): number {
    const result = left + right;
    if (!Number.isFinite(result) || result < 0) throw new Error(`${label} must be non-negative`);
    return result;
}

function safeAdd(left: number, right: number, label: string): number {
    const result = left + right;
    if (!Number.isSafeInteger(result)) throw new Error(`${label} must be a safe integer`);
    return result;
}

function requireNonBlank(value: string, label: string): void {
    if (value.trim().length === 0) throw new Error(`${label} must not be blank`);
}

function requireNonNegativeFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative`);
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${label} must be a non-negative safe integer`);
    }
}

function requirePositiveSafeInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${label} must be a positive safe integer`);
    }
}
