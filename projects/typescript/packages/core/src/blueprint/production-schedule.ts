import type { BlueprintDocument } from '#core/data/blueprint';
import type {
    ProductionBatchPlan,
    ProductionBatchStep,
} from '#core/production/plan';
import {
    BlueprintProductionCapacityAnalyzer,
    type BlueprintProductionCapacityDataset,
    type BlueprintProductionCapacityResult,
    type BlueprintProductionEquipmentCapacity,
} from '#core/blueprint/production-capacity';

export interface BlueprintProductionBatchAssignment {
    readonly equipmentItemId: string;
    readonly placementId: string;
    readonly firstBatchNumber: number;
    readonly lastBatchNumber: number;
    readonly batchCount: number;
    readonly startMinute: number;
    readonly endMinute: number;
}

export interface BlueprintProductionScheduledStep {
    readonly stepIndex: number;
    readonly itemId: string;
    readonly routeId: string;
    readonly equipmentItemId: string;
    readonly installedUnitCount: number;
    readonly usedUnitCount: number;
    readonly batchCount: number;
    readonly durationMinutesPerBatch: number;
    readonly waveCount: number;
    readonly startMinute: number;
    readonly endMinute: number;
    readonly elapsedMinutes: number;
    readonly assignments: readonly BlueprintProductionBatchAssignment[];
}

interface BlueprintProductionScheduleIssueBase {
    readonly stepIndex: number;
    readonly itemId: string;
    readonly routeId: string;
    readonly acceptedEquipmentItemIds: readonly string[];
    readonly selectedEquipmentItemId: string | null;
}

export type BlueprintProductionScheduleIssue =
    | BlueprintProductionScheduleIssueBase & {
        readonly code: 'missing-compatible-equipment';
        readonly compatibleInstalledEquipmentItemIds: readonly string[];
    }
    | BlueprintProductionScheduleIssueBase & {
        readonly code: 'equipment-selection-required';
        readonly compatibleInstalledEquipmentItemIds: readonly string[];
    };

export type BlueprintProductionScheduleResult =
    | {
        readonly kind: 'rejected';
        readonly capacity: Extract<BlueprintProductionCapacityResult, { readonly kind: 'rejected' }>;
        readonly schedule: readonly [];
    }
    | {
        readonly kind: 'unavailable';
        readonly capacity: Extract<BlueprintProductionCapacityResult, { readonly kind: 'analyzed' }>;
        readonly issues: readonly BlueprintProductionScheduleIssue[];
        readonly schedule: readonly [];
    }
    | {
        readonly kind: 'scheduled';
        readonly capacity: Extract<BlueprintProductionCapacityResult, { readonly kind: 'analyzed' }>;
        readonly durationBasis: 'production-batch-plan';
        readonly parallelScheduling: 'whole-batches-within-each-production-step';
        readonly crossStepConcurrency: 'not-evaluated';
        readonly batchPipelining: 'not-evaluated';
        readonly routing: 'not-evaluated';
        readonly lightingCoverage: 'not-evaluated';
        readonly effectiveTemperature: 'not-evaluated';
        readonly serialProcessMinutes: number;
        readonly scheduledElapsedMinutes: number;
        readonly parallelTimeSavedMinutes: number;
        readonly schedule: readonly BlueprintProductionScheduledStep[];
    };

interface ResolvedStepEquipment {
    readonly itemId: string;
    readonly placements: readonly { readonly placementId: string }[];
}

export class BlueprintProductionScheduleAnalyzer {
    readonly #capacity: BlueprintProductionCapacityAnalyzer;
    readonly #dataset: BlueprintProductionCapacityDataset['manifest'];

    constructor(dataset: BlueprintProductionCapacityDataset) {
        this.#capacity = new BlueprintProductionCapacityAnalyzer(dataset);
        this.#dataset = {
            gameVersion: dataset.manifest.gameVersion,
            datasetSha256: dataset.manifest.datasetSha256,
        };
    }

    analyze(
        blueprint: BlueprintDocument,
        plan: ProductionBatchPlan
    ): BlueprintProductionScheduleResult {
        validatePlan(plan);
        if (plan.dataset.gameVersion !== this.#dataset.gameVersion ||
            plan.dataset.datasetSha256 !== this.#dataset.datasetSha256) {
            throw new Error('Production plan belongs to a different normalized dataset');
        }
        const capacity = this.#capacity.analyze(blueprint);
        if (capacity.kind === 'rejected') {
            return { kind: 'rejected', capacity, schedule: [] };
        }

        const resolved: ResolvedStepEquipment[] = [];
        const issues: BlueprintProductionScheduleIssue[] = [];
        plan.productionSteps.forEach((step, stepIndex) => {
            const result = resolveStepEquipment(step, stepIndex, capacity.equipment);
            if ('code' in result) issues.push(result);
            else resolved.push(result);
        });
        if (issues.length > 0) {
            return {
                kind: 'unavailable',
                capacity,
                issues: issues.sort(compareIssues),
                schedule: [],
            };
        }

        const schedule: BlueprintProductionScheduledStep[] = [];
        let startMinute = 0;
        plan.productionSteps.forEach((step, stepIndex) => {
            const equipment = resolved[stepIndex];
            if (equipment === undefined) {
                throw new Error('Production schedule lost resolved equipment for a validated step');
            }
            const scheduled = scheduleStep(step, stepIndex, equipment, startMinute);
            schedule.push(scheduled);
            startMinute = scheduled.endMinute;
        });

        return {
            kind: 'scheduled',
            capacity,
            durationBasis: 'production-batch-plan',
            parallelScheduling: 'whole-batches-within-each-production-step',
            crossStepConcurrency: 'not-evaluated',
            batchPipelining: 'not-evaluated',
            routing: 'not-evaluated',
            lightingCoverage: 'not-evaluated',
            effectiveTemperature: 'not-evaluated',
            serialProcessMinutes: plan.totalProcessMinutes,
            scheduledElapsedMinutes: startMinute,
            parallelTimeSavedMinutes: cleanZero(plan.totalProcessMinutes - startMinute),
            schedule,
        };
    }
}

function resolveStepEquipment(
    step: ProductionBatchStep,
    stepIndex: number,
    equipment: readonly BlueprintProductionEquipmentCapacity[]
): ResolvedStepEquipment | BlueprintProductionScheduleIssue {
    const accepted = new Set(step.acceptedEquipmentItemIds);
    const compatible = equipment
        .filter((entry) => accepted.has(entry.itemId) && supportsStep(entry, step))
        .sort((left, right) => left.itemId.localeCompare(right.itemId));
    const compatibleInstalledEquipmentItemIds = compatible.map((entry) => entry.itemId);
    const selected = step.equipmentItemId;

    if (selected !== null) {
        const match = compatible.find((entry) => entry.itemId === selected);
        if (match !== undefined) return resolvedEquipment(match);
        return issue(
            'missing-compatible-equipment',
            step,
            stepIndex,
            compatibleInstalledEquipmentItemIds
        );
    }
    if (compatible.length === 0) {
        return issue(
            'missing-compatible-equipment',
            step,
            stepIndex,
            compatibleInstalledEquipmentItemIds
        );
    }
    if (compatible.length > 1) {
        return issue(
            'equipment-selection-required',
            step,
            stepIndex,
            compatibleInstalledEquipmentItemIds
        );
    }
    return resolvedEquipment(compatible[0]!);
}

function resolvedEquipment(
    equipment: BlueprintProductionEquipmentCapacity
): ResolvedStepEquipment {
    return {
        itemId: equipment.itemId,
        placements: equipment.placements
            .map((placement) => ({ placementId: placement.placementId }))
            .sort((left, right) => left.placementId.localeCompare(right.placementId)),
    };
}

function issue(
    code: BlueprintProductionScheduleIssue['code'],
    step: ProductionBatchStep,
    stepIndex: number,
    compatibleInstalledEquipmentItemIds: readonly string[]
): BlueprintProductionScheduleIssue {
    return {
        code,
        stepIndex,
        itemId: step.itemId,
        routeId: step.routeId,
        acceptedEquipmentItemIds: step.acceptedEquipmentItemIds,
        selectedEquipmentItemId: step.equipmentItemId,
        compatibleInstalledEquipmentItemIds,
    };
}

function supportsStep(
    equipment: BlueprintProductionEquipmentCapacity,
    step: ProductionBatchStep
): boolean {
    const kind = processKind(step);
    return equipment.processes.some((process) =>
        process.kind === kind &&
        process.outputItemId === step.itemId &&
        routeMatchesProcess(step, process.id)
    );
}

function routeMatchesProcess(step: ProductionBatchStep, processId: string): boolean {
    if (step.method === 'seed-harvest' || step.method === 'shroom-harvest') {
        return step.routeId === processId || step.routeId.startsWith(`${processId}:`);
    }
    return step.routeId === processId;
}

function processKind(
    step: ProductionBatchStep
): BlueprintProductionEquipmentCapacity['processes'][number]['kind'] {
    switch (step.method) {
        case 'seed-harvest':
        case 'shroom-harvest':
        case 'station-recipe':
            return step.method;
        case 'oven':
            return 'oven-transform';
        case 'cauldron':
        case 'mushroom-spawn':
            return step.method;
    }
}

function scheduleStep(
    step: ProductionBatchStep,
    stepIndex: number,
    equipment: ResolvedStepEquipment,
    startMinute: number
): BlueprintProductionScheduledStep {
    const usedUnitCount = Math.min(step.batchCount, equipment.placements.length);
    const waveCount = Math.ceil(step.batchCount / usedUnitCount);
    const elapsedMinutes = multiplyFinite(
        waveCount,
        step.durationMinutesPerBatch,
        `${step.routeId} elapsed duration`
    );
    const endMinute = addFinite(startMinute, elapsedMinutes, `${step.routeId} end minute`);
    const batchesPerUnit = Math.floor(step.batchCount / usedUnitCount);
    const remainder = step.batchCount % usedUnitCount;
    let firstBatchNumber = 1;
    const assignments = equipment.placements.slice(0, usedUnitCount).map((placement, index) => {
        const batchCount = batchesPerUnit + (index < remainder ? 1 : 0);
        const lastBatchNumber = firstBatchNumber + batchCount - 1;
        const assignmentEnd = addFinite(
            startMinute,
            multiplyFinite(
                batchCount,
                step.durationMinutesPerBatch,
                `${step.routeId} assignment duration`
            ),
            `${step.routeId} assignment end minute`
        );
        const assignment = {
            equipmentItemId: equipment.itemId,
            placementId: placement.placementId,
            firstBatchNumber,
            lastBatchNumber,
            batchCount,
            startMinute,
            endMinute: assignmentEnd,
        };
        firstBatchNumber = lastBatchNumber + 1;
        return assignment;
    });
    return {
        stepIndex,
        itemId: step.itemId,
        routeId: step.routeId,
        equipmentItemId: equipment.itemId,
        installedUnitCount: equipment.placements.length,
        usedUnitCount,
        batchCount: step.batchCount,
        durationMinutesPerBatch: step.durationMinutesPerBatch,
        waveCount,
        startMinute,
        endMinute,
        elapsedMinutes,
        assignments,
    };
}

function validatePlan(plan: ProductionBatchPlan): void {
    requireNonBlank(plan.dataset.gameVersion, 'Production plan dataset game version');
    requireSha256(plan.dataset.datasetSha256, 'Production plan dataset identity');
    requireNonBlank(plan.targetItemId, 'Production plan target item ID');
    requirePositiveInteger(plan.targetQuantity, 'Production plan target quantity');
    requireNonNegativeFinite(plan.totalProcessMinutes, 'Production plan total process minutes');
    const indexes = new Map<string, number>();
    let serialProcessMinutes = 0;
    plan.productionSteps.forEach((step, index) => {
        requireNonBlank(step.itemId, `Production step ${index} item ID`);
        requireNonBlank(step.routeId, `Production step ${index} route ID`);
        if (indexes.has(step.itemId)) {
            throw new Error(`Production plan repeats step item ${JSON.stringify(step.itemId)}`);
        }
        indexes.set(step.itemId, index);
        requirePositiveInteger(step.batchCount, `${step.routeId} batch count`);
        requirePositiveFinite(step.durationMinutesPerBatch, `${step.routeId} batch duration`);
        if (step.acceptedEquipmentItemIds.length === 0) {
            throw new Error(`Production step ${JSON.stringify(step.routeId)} has no accepted equipment`);
        }
        const accepted = new Set<string>();
        for (const itemId of step.acceptedEquipmentItemIds) {
            requireNonBlank(itemId, `${step.routeId} accepted equipment item ID`);
            if (accepted.has(itemId)) {
                throw new Error(
                    `Production step ${JSON.stringify(step.routeId)} repeats accepted equipment ` +
                        JSON.stringify(itemId)
                );
            }
            accepted.add(itemId);
        }
        if (step.equipmentItemId !== null && !accepted.has(step.equipmentItemId)) {
            throw new Error(
                `Production step ${JSON.stringify(step.routeId)} selects unaccepted equipment ` +
                    JSON.stringify(step.equipmentItemId)
            );
        }
        const expectedStepMinutes = multiplyFinite(
            step.batchCount,
            step.durationMinutesPerBatch,
            `${step.routeId} serial duration`
        );
        if (!sameNumber(step.totalProcessMinutes, expectedStepMinutes)) {
            throw new Error(`Production step ${JSON.stringify(step.routeId)} has inconsistent process time`);
        }
        serialProcessMinutes = addFinite(
            serialProcessMinutes,
            expectedStepMinutes,
            'Production plan serial process minutes'
        );
    });
    plan.productionSteps.forEach((step, index) => {
        for (const input of step.inputs) {
            requireNonBlank(input.itemId, `${step.routeId} input item ID`);
            requirePositiveFinite(input.quantityPerBatch, `${step.routeId} input quantity per batch`);
            requirePositiveFinite(input.totalQuantity, `${step.routeId} total input quantity`);
            const expectedTotalQuantity = multiplyFinite(
                input.quantityPerBatch,
                step.batchCount,
                `${step.routeId} expected total input quantity`
            );
            if (!sameNumber(input.totalQuantity, expectedTotalQuantity)) {
                throw new Error(
                    `Production step ${JSON.stringify(step.routeId)} has inconsistent input quantity for ` +
                        JSON.stringify(input.itemId)
                );
            }
            const producerIndex = indexes.get(input.itemId);
            if (producerIndex !== undefined && producerIndex >= index) {
                throw new Error(
                    `Production step ${JSON.stringify(step.routeId)} depends on later step item ` +
                        JSON.stringify(input.itemId)
                );
            }
        }
    });
    if (plan.productionSteps.length > 0 &&
        plan.productionSteps.at(-1)?.itemId !== plan.targetItemId) {
        throw new Error('Production plan target must be its final production step');
    }
    if (!sameNumber(plan.totalProcessMinutes, serialProcessMinutes)) {
        throw new Error('Production plan total process time differs from its steps');
    }
}

function compareIssues(
    left: BlueprintProductionScheduleIssue,
    right: BlueprintProductionScheduleIssue
): number {
    return left.stepIndex - right.stepIndex || left.code.localeCompare(right.code);
}

function requireNonBlank(value: string, label: string): void {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError(`${label} must not be blank`);
    }
}

function requireSha256(value: string, label: string): void {
    if (!/^[a-f0-9]{64}$/u.test(value)) {
        throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
    }
}

function requirePositiveInteger(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${label} must be a positive safe integer`);
    }
}

function requirePositiveFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`);
}

function requireNonNegativeFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be non-negative`);
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

function sameNumber(left: number, right: number): boolean {
    return Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));
}

function cleanZero(value: number): number {
    return Math.abs(value) <= 1e-9 ? 0 : value;
}
