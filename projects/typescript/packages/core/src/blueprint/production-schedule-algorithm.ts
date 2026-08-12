import type { ProductionBatchPlan, ProductionBatchStep } from '#core/production/plan';
import type {
    BlueprintProductionBatchAssignment,
    BlueprintProductionLightingAssessment,
    BlueprintProductionMoistureAssessment,
    BlueprintProductionScheduledBatch,
    BlueprintProductionScheduledStep,
    BlueprintProductionTemperatureAssessment,
} from '#core/blueprint/production-schedule-types';

export interface BlueprintProductionSchedulePlacement {
    readonly placementId: string;
    readonly lighting: BlueprintProductionLightingAssessment;
    readonly temperature: BlueprintProductionTemperatureAssessment;
    readonly moisture: BlueprintProductionMoistureAssessment;
    readonly lightingProcessMultiplier: number;
    readonly temperatureProcessMultiplier: number;
    readonly moistureProcessMultiplier: number;
    readonly processMultiplier: number;
    readonly constraintStatus: 'satisfied' | 'conditional';
}

export interface BlueprintProductionScheduleResolvedStep {
    readonly equipmentItemId: string;
    readonly installedUnitCount: number;
    readonly placements: readonly BlueprintProductionSchedulePlacement[];
}

export interface BlueprintProductionConstrainedSchedule {
    readonly constraintStatus: 'satisfied' | 'conditional';
    readonly lightingAdjustedSerialProcessMinutes: number;
    readonly serialProcessMinutes: number;
    readonly scheduledElapsedMinutes: number;
    readonly schedule: readonly BlueprintProductionScheduledStep[];
}

interface CalendarInterval {
    readonly startMinute: number;
    readonly endMinute: number;
}

interface PlacementChoice {
    readonly placement: BlueprintProductionSchedulePlacement;
    readonly startMinute: number;
    readonly lightingAdjustedDurationMinutes: number;
    readonly durationMinutes: number;
    readonly endMinute: number;
}

export function scheduleConstrainedProduction(
    plan: ProductionBatchPlan,
    resolved: readonly BlueprintProductionScheduleResolvedStep[]
): BlueprintProductionConstrainedSchedule {
    if (resolved.length !== plan.productionSteps.length) {
        throw new Error('Production scheduler received incomplete resolved equipment');
    }
    const producerIndexByItemId = new Map(
        plan.productionSteps.map((step, stepIndex) => [step.itemId, stepIndex])
    );
    const allocationOffsets = productionAllocationOffsets(plan, producerIndexByItemId);
    const dependencies = plan.productionSteps.map((step) => new Set(
        step.inputs.flatMap((input) => {
            const producerIndex = producerIndexByItemId.get(input.itemId);
            return producerIndex === undefined ? [] : [producerIndex];
        })
    ));
    const successors = plan.productionSteps.map(() => new Set<number>());
    dependencies.forEach((producerIndexes, consumerIndex) => {
        for (const producerIndex of producerIndexes) successors[producerIndex]!.add(consumerIndex);
    });
    const criticalMinutes = criticalPathMinutes(plan, resolved, successors);
    const calendars = new Map<string, CalendarInterval[]>();
    const scheduledByStep = new Map<number, BlueprintProductionScheduledStep>();
    const pending = new Set(plan.productionSteps.map((_, stepIndex) => stepIndex));

    while (pending.size > 0) {
        const ready = [...pending]
            .filter((stepIndex) => [...dependencies[stepIndex]!].every((dependency) =>
                scheduledByStep.has(dependency)
            ))
            .sort((left, right) =>
                criticalMinutes[right]! - criticalMinutes[left]! || left - right
            );
        const stepIndex = ready[0];
        if (stepIndex === undefined) throw new Error('Production scheduling dependencies contain a cycle');
        const step = plan.productionSteps[stepIndex]!;
        const equipment = resolved[stepIndex]!;
        const scheduled = scheduleStep(
            step,
            stepIndex,
            equipment,
            plan,
            producerIndexByItemId,
            allocationOffsets[stepIndex]!,
            scheduledByStep,
            calendars
        );
        scheduledByStep.set(stepIndex, scheduled);
        pending.delete(stepIndex);
    }

    const schedule = [...scheduledByStep.values()].sort((left, right) => left.stepIndex - right.stepIndex);
    return {
        constraintStatus: schedule.some((step) => step.constraintStatus === 'conditional')
            ? 'conditional'
            : 'satisfied',
        lightingAdjustedSerialProcessMinutes: schedule.reduce(
            (total, step) => addFinite(
                total,
                step.batches.reduce(
                    (stepTotal, batch) => addFinite(
                        stepTotal,
                        batch.lightingAdjustedDurationMinutes,
                        'Lighting-adjusted step serial process minutes'
                    ),
                    0
                ),
                'Lighting-adjusted serial process minutes'
            ),
            0
        ),
        serialProcessMinutes: schedule.reduce(
            (total, step) => addFinite(
                total,
                step.batches.reduce(
                    (stepTotal, batch) => addFinite(
                        stepTotal,
                        batch.durationMinutes,
                        'Scheduled step serial process minutes'
                    ),
                    0
                ),
                'Scheduled serial process minutes'
            ),
            0
        ),
        scheduledElapsedMinutes: schedule.reduce((maximum, step) => Math.max(maximum, step.endMinute), 0),
        schedule,
    };
}

function scheduleStep(
    step: ProductionBatchStep,
    stepIndex: number,
    equipment: BlueprintProductionScheduleResolvedStep,
    plan: ProductionBatchPlan,
    producerIndexByItemId: ReadonlyMap<string, number>,
    allocationOffsets: ReadonlyMap<number, number>,
    scheduledByStep: ReadonlyMap<number, BlueprintProductionScheduledStep>,
    calendars: Map<string, CalendarInterval[]>
): BlueprintProductionScheduledStep {
    const batches: BlueprintProductionScheduledBatch[] = [];
    for (let batchNumber = 1; batchNumber <= step.batchCount; batchNumber++) {
        const dependencyReadyMinute = batchDependencyReadyMinute(
            step,
            batchNumber,
            plan,
            producerIndexByItemId,
            allocationOffsets,
            scheduledByStep
        );
        const choice = choosePlacement(
            equipment.placements,
            dependencyReadyMinute,
            step.durationMinutesPerBatch,
            calendars
        );
        insertInterval(calendars, choice.placement.placementId, {
            startMinute: choice.startMinute,
            endMinute: choice.endMinute,
        });
        batches.push({
            batchNumber,
            equipmentItemId: equipment.equipmentItemId,
            placementId: choice.placement.placementId,
            dependencyReadyMinute,
            lightingAdjustedDurationMinutes: choice.lightingAdjustedDurationMinutes,
            durationMinutes: choice.durationMinutes,
            startMinute: choice.startMinute,
            endMinute: choice.endMinute,
        });
    }
    const assignments = summarizeAssignments(equipment, batches);
    const startMinute = Math.min(...batches.map((batch) => batch.startMinute));
    const endMinute = Math.max(...batches.map((batch) => batch.endMinute));
    return {
        stepIndex,
        itemId: step.itemId,
        routeId: step.routeId,
        equipmentItemId: equipment.equipmentItemId,
        installedUnitCount: equipment.installedUnitCount,
        usedUnitCount: assignments.length,
        batchCount: step.batchCount,
        durationMinutesPerBatch: step.durationMinutesPerBatch,
        durationMinutesPerBatchBasis:
            'production-batch-plan-before-placement-lighting-temperature-and-moisture',
        startMinute,
        endMinute,
        elapsedMinutes: subtractFinite(endMinute, startMinute, `${step.routeId} elapsed duration`),
        constraintStatus: assignments.some((assignment) => assignment.constraintStatus === 'conditional')
            ? 'conditional'
            : 'satisfied',
        assignments,
        batches,
    };
}

function batchDependencyReadyMinute(
    step: ProductionBatchStep,
    batchNumber: number,
    plan: ProductionBatchPlan,
    producerIndexByItemId: ReadonlyMap<string, number>,
    allocationOffsets: ReadonlyMap<number, number>,
    scheduledByStep: ReadonlyMap<number, BlueprintProductionScheduledStep>
): number {
    const quantityPerBatchByProducer = new Map<number, number>();
    for (const input of step.inputs) {
        const producerIndex = producerIndexByItemId.get(input.itemId);
        if (producerIndex === undefined) continue;
        quantityPerBatchByProducer.set(
            producerIndex,
            addFinite(
                quantityPerBatchByProducer.get(producerIndex) ?? 0,
                input.quantityPerBatch,
                `${step.routeId} produced input quantity per batch`
            )
        );
    }
    let readyMinute = 0;
    for (const [producerIndex, quantityPerBatch] of quantityPerBatchByProducer) {
        const producer = plan.productionSteps[producerIndex]!;
        const scheduled = scheduledByStep.get(producerIndex);
        if (scheduled === undefined) {
            throw new Error(`Production step ${JSON.stringify(step.routeId)} has an unscheduled dependency`);
        }
        const cumulativeRequiredQuantity = multiplyFinite(
            quantityPerBatch,
            batchNumber,
            `${step.routeId} cumulative dependency quantity`
        );
        const priorConsumerQuantity = allocationOffsets.get(producerIndex) ?? 0;
        const requiredProducerBatches = ceilRatio(
            addFinite(
                priorConsumerQuantity,
                cumulativeRequiredQuantity,
                `${step.routeId} allocated cumulative dependency quantity`
            ),
            producer.outputQuantityPerBatch,
            `${step.routeId} required producer batches`
        );
        const completionMinutes = scheduled.batches
            .map((batch) => batch.endMinute)
            .sort((left, right) => left - right);
        const dependencyCompletion = completionMinutes[requiredProducerBatches - 1];
        if (dependencyCompletion === undefined) {
            throw new Error(
                `Production step ${JSON.stringify(step.routeId)} requires unavailable output from ` +
                    JSON.stringify(producer.routeId)
            );
        }
        readyMinute = Math.max(readyMinute, dependencyCompletion);
    }
    return readyMinute;
}

function productionAllocationOffsets(
    plan: ProductionBatchPlan,
    producerIndexByItemId: ReadonlyMap<string, number>
): readonly ReadonlyMap<number, number>[] {
    const allocatedQuantityByProducer = new Map<number, number>();
    return plan.productionSteps.map((step) => {
        const offsets = new Map<number, number>();
        for (const input of step.inputs) {
            const producerIndex = producerIndexByItemId.get(input.itemId);
            if (producerIndex === undefined) continue;
            const allocatedQuantity = allocatedQuantityByProducer.get(producerIndex) ?? 0;
            if (!offsets.has(producerIndex)) offsets.set(producerIndex, allocatedQuantity);
            allocatedQuantityByProducer.set(
                producerIndex,
                addFinite(
                    allocatedQuantity,
                    input.totalQuantity,
                    `${plan.productionSteps[producerIndex]!.routeId} allocated consumer quantity`
                )
            );
        }
        return offsets;
    });
}

function choosePlacement(
    placements: readonly BlueprintProductionSchedulePlacement[],
    releaseMinute: number,
    durationMinutes: number,
    calendars: ReadonlyMap<string, readonly CalendarInterval[]>
): PlacementChoice {
    const satisfied = placements.filter((placement) => placement.constraintStatus === 'satisfied');
    const eligible = satisfied.length > 0 ? satisfied : placements;
    const choices = eligible.map((placement) => {
        const lightingAdjustedDurationMinutes = divideFinite(
            durationMinutes,
            placement.lightingProcessMultiplier,
            'Lighting-adjusted batch duration'
        );
        const adjustedDurationMinutes = divideFinite(
            lightingAdjustedDurationMinutes,
            multiplyFinite(
                placement.temperatureProcessMultiplier,
                placement.moistureProcessMultiplier,
                'Temperature and moisture process multiplier'
            ),
            'Temperature-and-moisture-adjusted batch duration'
        );
        const startMinute = earliestCalendarSlot(
            calendars.get(placement.placementId) ?? [],
            releaseMinute,
            adjustedDurationMinutes
        );
        return {
            placement,
            startMinute,
            lightingAdjustedDurationMinutes,
            durationMinutes: adjustedDurationMinutes,
            endMinute: addFinite(
                startMinute,
                adjustedDurationMinutes,
                'Scheduled batch end minute'
            ),
        };
    }).sort((left, right) =>
        left.endMinute - right.endMinute ||
        left.startMinute - right.startMinute ||
        left.placement.placementId.localeCompare(right.placement.placementId)
    );
    const selected = choices[0];
    if (selected === undefined) throw new Error('Production step has no eligible equipment placement');
    return selected;
}

function earliestCalendarSlot(
    intervals: readonly CalendarInterval[],
    releaseMinute: number,
    durationMinutes: number
): number {
    let startMinute = releaseMinute;
    for (const interval of intervals) {
        if (addFinite(startMinute, durationMinutes, 'Scheduled calendar candidate end') <=
            interval.startMinute) return startMinute;
        if (startMinute < interval.endMinute) startMinute = interval.endMinute;
    }
    return startMinute;
}

function insertInterval(
    calendars: Map<string, CalendarInterval[]>,
    placementId: string,
    interval: CalendarInterval
): void {
    const intervals = calendars.get(placementId) ?? [];
    intervals.push(interval);
    intervals.sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute);
    calendars.set(placementId, intervals);
}

function summarizeAssignments(
    equipment: BlueprintProductionScheduleResolvedStep,
    batches: readonly BlueprintProductionScheduledBatch[]
): BlueprintProductionBatchAssignment[] {
    const placementById = new Map(equipment.placements.map((placement) => [placement.placementId, placement]));
    const batchNumbersByPlacement = new Map<string, number[]>();
    for (const batch of batches) {
        const batchNumbers = batchNumbersByPlacement.get(batch.placementId) ?? [];
        batchNumbers.push(batch.batchNumber);
        batchNumbersByPlacement.set(batch.placementId, batchNumbers);
    }
    return [...batchNumbersByPlacement]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([placementId, batchNumbers]) => {
            const placement = placementById.get(placementId);
            if (placement === undefined) throw new Error('Scheduled batch references unavailable placement');
            return {
                equipmentItemId: equipment.equipmentItemId,
                placementId,
                batchNumbers,
                batchCount: batchNumbers.length,
                lighting: placement.lighting,
                temperature: placement.temperature,
                moisture: placement.moisture,
                constraintStatus: placement.constraintStatus,
            };
        });
}

function criticalPathMinutes(
    plan: ProductionBatchPlan,
    resolved: readonly BlueprintProductionScheduleResolvedStep[],
    successors: readonly ReadonlySet<number>[]
): readonly number[] {
    const result = Array.from({ length: plan.productionSteps.length }, () => 0);
    for (let stepIndex = plan.productionSteps.length - 1; stepIndex >= 0; stepIndex--) {
        const step = plan.productionSteps[stepIndex]!;
        const equipment = resolved[stepIndex]!;
        const baseOwnMinutes = multiplyFinite(
            Math.ceil(step.batchCount / equipment.placements.length),
            step.durationMinutesPerBatch,
            `${step.routeId} estimated elapsed duration`
        );
        const fastestMultiplier = Math.max(
            ...equipment.placements.map((placement) => placement.processMultiplier)
        );
        const ownMinutes = divideFinite(
            baseOwnMinutes,
            fastestMultiplier,
            `${step.routeId} placement-rate-adjusted estimated elapsed duration`
        );
        const downstreamMinutes = Math.max(
            0,
            ...[...successors[stepIndex]!].map((successorIndex) => result[successorIndex]!)
        );
        result[stepIndex] = addFinite(ownMinutes, downstreamMinutes, `${step.routeId} critical path`);
    }
    return result;
}

function ceilRatio(numerator: number, denominator: number, label: string): number {
    if (!Number.isFinite(numerator) || numerator <= 0 ||
        !Number.isFinite(denominator) || denominator <= 0) {
        throw new RangeError(`${label} inputs must be positive`);
    }
    const ratio = numerator / denominator;
    const nearest = Math.round(ratio);
    const result = Math.abs(ratio - nearest) <= 1e-9 * Math.max(1, Math.abs(ratio))
        ? nearest
        : Math.ceil(ratio);
    if (!Number.isSafeInteger(result) || result <= 0) {
        throw new RangeError(`${label} must be a positive safe integer`);
    }
    return result;
}

function multiplyFinite(left: number, right: number, label: string): number {
    const result = left * right;
    if (!Number.isFinite(result)) throw new RangeError(`${label} must be finite`);
    return result;
}

function addFinite(left: number, right: number, label: string): number {
    const result = left + right;
    if (!Number.isFinite(result)) throw new RangeError(`${label} must be finite`);
    return result;
}

function subtractFinite(left: number, right: number, label: string): number {
    const result = left - right;
    if (!Number.isFinite(result) || result < 0) throw new RangeError(`${label} must be non-negative`);
    return result;
}

function divideFinite(numerator: number, denominator: number, label: string): number {
    const result = numerator / denominator;
    if (!Number.isFinite(result) || result <= 0) throw new RangeError(`${label} must be positive`);
    return result;
}
