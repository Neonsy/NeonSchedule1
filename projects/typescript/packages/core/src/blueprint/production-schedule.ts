import type { BlueprintDocument } from '#core/data/blueprint';
import type { ProductionBatchPlan, ProductionBatchStep } from '#core/production/plan';
import type { ProductionStation } from '#core/data/production';
import {
    BlueprintProductionCapacityAnalyzer,
    type BlueprintProductionCapacityDataset,
    type BlueprintProductionEquipmentCapacity,
    type BlueprintProductionPlacementCapacity,
    type BlueprintProductionProcessCapacity,
    type BlueprintProductionTemperatureRule,
} from '#core/blueprint/production-capacity';
import {
    scheduleConstrainedProduction,
    type BlueprintProductionSchedulePlacement,
    type BlueprintProductionScheduleResolvedStep,
} from '#core/blueprint/production-schedule-algorithm';
import {
    productionScheduleProcessKind,
    type BlueprintProductionLightingAssessment,
    type BlueprintProductionScheduleIssue,
    type BlueprintProductionScheduleResult,
    type BlueprintProductionTemperatureAssessment,
} from '#core/blueprint/production-schedule-types';

export * from '#core/blueprint/production-schedule-types';

interface CompatibleEquipment {
    readonly equipment: BlueprintProductionEquipmentCapacity;
    readonly process: BlueprintProductionProcessCapacity;
}

type TemperatureResolution =
    | {
        readonly kind: 'eligible';
        readonly assessment: BlueprintProductionTemperatureAssessment;
    }
    | {
        readonly kind: 'unsatisfied';
        readonly rule: BlueprintProductionTemperatureRule;
    };

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

        const resolved: BlueprintProductionScheduleResolvedStep[] = [];
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

        const constrained = scheduleConstrainedProduction(plan, resolved);
        const savedMinutes = subtractFinite(
            plan.totalProcessMinutes,
            constrained.scheduledElapsedMinutes,
            'Production parallel time saved'
        );
        return {
            kind: 'scheduled',
            capacity,
            durationBasis: 'production-batch-plan',
            schedulingAlgorithm: 'deterministic-critical-path-list-scheduling',
            optimality: 'not-proven',
            parallelScheduling: 'non-overlapping-whole-batch-equipment-calendars',
            crossStepConcurrency: 'production-dependency-and-equipment-constrained',
            batchPipelining: 'cumulative-plan-order-produced-quantity',
            routing: 'not-evaluated',
            employeeScheduling: 'not-evaluated-no-task-duration-contract',
            lightingCoverage: 'built-in-or-selected-installed-physical-coverage-not-evaluated',
            effectiveTemperature: 'ambient-only-without-covering-emitters',
            constraintStatus: constrained.constraintStatus,
            serialProcessMinutes: plan.totalProcessMinutes,
            scheduledElapsedMinutes: constrained.scheduledElapsedMinutes,
            parallelTimeSavedMinutes: cleanZero(savedMinutes),
            schedule: constrained.schedule,
        };
    }
}

function resolveStepEquipment(
    step: ProductionBatchStep,
    stepIndex: number,
    equipment: readonly BlueprintProductionEquipmentCapacity[]
): BlueprintProductionScheduleResolvedStep | BlueprintProductionScheduleIssue {
    const accepted = new Set(step.acceptedEquipmentItemIds);
    const compatible = equipment
        .flatMap((entry): CompatibleEquipment[] => {
            if (!accepted.has(entry.itemId)) return [];
            const process = matchingProcess(entry, step);
            return process === null ? [] : [{ equipment: entry, process }];
        })
        .sort((left, right) => left.equipment.itemId.localeCompare(right.equipment.itemId));
    const compatibleInstalledEquipmentItemIds = compatible.map((entry) => entry.equipment.itemId);
    const selected = step.equipmentItemId;

    if (step.method === 'seed-harvest' && selected === null) {
        return equipmentIssue(
            'equipment-selection-required',
            step,
            stepIndex,
            compatibleInstalledEquipmentItemIds
        );
    }
    if (selected !== null) {
        const match = compatible.find((entry) => entry.equipment.itemId === selected);
        if (match === undefined) {
            return equipmentIssue(
                'missing-compatible-equipment',
                step,
                stepIndex,
                compatibleInstalledEquipmentItemIds
            );
        }
        return resolveCompatibleEquipment(match, step, stepIndex, equipment);
    }
    if (compatible.length === 0) {
        return equipmentIssue(
            'missing-compatible-equipment',
            step,
            stepIndex,
            compatibleInstalledEquipmentItemIds
        );
    }
    if (compatible.length > 1) {
        return equipmentIssue(
            'equipment-selection-required',
            step,
            stepIndex,
            compatibleInstalledEquipmentItemIds
        );
    }
    return resolveCompatibleEquipment(compatible[0]!, step, stepIndex, equipment);
}

function resolveCompatibleEquipment(
    match: CompatibleEquipment,
    step: ProductionBatchStep,
    stepIndex: number,
    allEquipment: readonly BlueprintProductionEquipmentCapacity[]
): BlueprintProductionScheduleResolvedStep | BlueprintProductionScheduleIssue {
    const lighting = lightingAssessment(match.equipment, step, stepIndex, allEquipment);
    if ('code' in lighting) return lighting;
    const placements: BlueprintProductionSchedulePlacement[] = [];
    const incompatiblePlacementIds: string[] = [];
    for (const placement of match.equipment.placements) {
        const temperature = temperatureAssessment(placement, match.process.temperatureRule);
        if (temperature.kind === 'unsatisfied') {
            incompatiblePlacementIds.push(placement.placementId);
            continue;
        }
        placements.push({
            placementId: placement.placementId,
            lighting,
            temperature: temperature.assessment,
            constraintStatus:
                lighting.kind === 'selected-external-grow-light' ||
                temperature.assessment.kind === 'conditional'
                    ? 'conditional'
                    : 'satisfied',
        });
    }
    if (placements.length === 0 && incompatiblePlacementIds.length > 0) {
        return {
            ...issueBase(step, stepIndex),
            code: 'temperature-constraint-unsatisfied',
            incompatiblePlacementIds: incompatiblePlacementIds.sort(),
            temperatureRule: match.process.temperatureRule!,
        };
    }
    return {
        equipmentItemId: match.equipment.itemId,
        installedUnitCount: match.equipment.installedUnitCount,
        placements: placements.sort((left, right) => left.placementId.localeCompare(right.placementId)),
    };
}

function lightingAssessment(
    equipment: BlueprintProductionEquipmentCapacity,
    step: ProductionBatchStep,
    stepIndex: number,
    allEquipment: readonly BlueprintProductionEquipmentCapacity[]
): BlueprintProductionLightingAssessment | BlueprintProductionScheduleIssue {
    if (step.method !== 'seed-harvest') return { kind: 'not-required' };
    const station = growContainer(equipment.station, equipment.itemId);
    if (!station.requiresExternalGrowLight) {
        if (step.growLightItemId !== null) {
            throw new Error(
                `Production step ${JSON.stringify(step.routeId)} selects a grow light for built-in lighting`
            );
        }
        return { kind: 'built-in', equipmentItemId: equipment.itemId };
    }
    if (step.growLightItemId === null) {
        return {
            ...issueBase(step, stepIndex),
            code: 'grow-light-selection-required',
            equipmentPlacementIds: equipment.placements.map((placement) => placement.placementId).sort(),
        };
    }
    const installed = allEquipment.find((candidate) => candidate.itemId === step.growLightItemId);
    const installedPlacementIds = installed?.station?.kind === 'grow-light'
        ? installed.placements
        .map((placement) => placement.placementId)
        .sort()
        : [];
    if (installedPlacementIds.length === 0) {
        return {
            ...issueBase(step, stepIndex),
            code: 'missing-selected-grow-light',
            selectedGrowLightItemId: step.growLightItemId,
            equipmentPlacementIds: equipment.placements.map((placement) => placement.placementId).sort(),
        };
    }
    return {
        kind: 'selected-external-grow-light',
        growLightItemId: step.growLightItemId,
        installedPlacementIds,
        physicalCoverage: 'not-evaluated',
    };
}

function temperatureAssessment(
    placement: BlueprintProductionPlacementCapacity,
    rule: BlueprintProductionTemperatureRule | null
): TemperatureResolution {
    if (rule === null) {
        return {
            kind: 'eligible',
            assessment: { kind: 'not-applicable', reason: 'process-has-no-temperature-rule', rule },
        };
    }
    if (rule.kind === 'internal-cook-setpoint') {
        return {
            kind: 'eligible',
            assessment: { kind: 'not-applicable', reason: 'internal-cook-setpoint', rule },
        };
    }
    if (placement.temperature.kind === 'not-evaluated') {
        return {
            kind: 'eligible',
            assessment: {
                kind: 'conditional',
                reason: 'placement-not-on-property-grid',
                ambientTemperature: null,
                rule,
            },
        };
    }
    const ambientTemperature = placement.temperature.tiles[0]?.ambientTemperature;
    if (ambientTemperature === undefined) {
        throw new Error('Property-grid production placement has no occupied temperature tiles');
    }
    if (placement.temperature.tiles.some((tile) => tile.sources.length > 0)) {
        return {
            kind: 'eligible',
            assessment: {
                kind: 'conditional',
                reason: 'effective-emitter-temperature-not-evaluated',
                ambientTemperature,
                rule,
            },
        };
    }
    if (rule.kind === 'environmental-maximum') {
        return ambientTemperature <= rule.maximumTemperature
            ? {
                kind: 'eligible',
                assessment: {
                    kind: 'satisfied',
                    basis: 'ambient-without-covering-emitters',
                    ambientTemperature,
                    rule,
                },
            }
            : { kind: 'unsatisfied', rule };
    }
    if (ambientTemperature >= rule.minimumTemperature &&
        ambientTemperature <= rule.maximumTemperature) {
        return {
            kind: 'eligible',
            assessment: {
                kind: 'satisfied',
                basis: 'ambient-without-covering-emitters',
                ambientTemperature,
                rule,
            },
        };
    }
    return {
        kind: 'eligible',
        assessment: {
            kind: 'conditional',
            reason: 'temperature-duration-multiplier-not-evaluated',
            ambientTemperature,
            rule,
        },
    };
}

function matchingProcess(
    equipment: BlueprintProductionEquipmentCapacity,
    step: ProductionBatchStep
): BlueprintProductionProcessCapacity | null {
    const kind = productionScheduleProcessKind(step);
    return equipment.processes.find((process) =>
        process.kind === kind &&
        process.outputItemId === step.itemId &&
        routeMatchesProcess(step, process.id)
    ) ?? null;
}

function routeMatchesProcess(step: ProductionBatchStep, processId: string): boolean {
    if (step.method === 'seed-harvest' || step.method === 'shroom-harvest') {
        return step.routeId === processId || step.routeId.startsWith(`${processId}:`);
    }
    return step.routeId === processId;
}

function growContainer(
    station: ProductionStation | null,
    itemId: string
): Extract<ProductionStation, { readonly kind: 'grow-container' }> {
    if (station?.kind !== 'grow-container') {
        throw new Error(`Seed production equipment ${JSON.stringify(itemId)} is not a grow container`);
    }
    return station;
}

function equipmentIssue(
    code: 'missing-compatible-equipment' | 'equipment-selection-required',
    step: ProductionBatchStep,
    stepIndex: number,
    compatibleInstalledEquipmentItemIds: readonly string[]
): BlueprintProductionScheduleIssue {
    return {
        ...issueBase(step, stepIndex),
        code,
        compatibleInstalledEquipmentItemIds,
    };
}

function issueBase(
    step: ProductionBatchStep,
    stepIndex: number
): {
    readonly stepIndex: number;
    readonly itemId: string;
    readonly routeId: string;
    readonly acceptedEquipmentItemIds: readonly string[];
    readonly selectedEquipmentItemId: string | null;
} {
    return {
        stepIndex,
        itemId: step.itemId,
        routeId: step.routeId,
        acceptedEquipmentItemIds: step.acceptedEquipmentItemIds,
        selectedEquipmentItemId: step.equipmentItemId,
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
        requirePositiveFinite(step.outputQuantityPerBatch, `${step.routeId} output quantity per batch`);
        if (step.growLightItemId !== null) {
            requireNonBlank(step.growLightItemId, `${step.routeId} grow-light item ID`);
            if (step.method !== 'seed-harvest') {
                throw new Error(`Production step ${JSON.stringify(step.routeId)} selects an inapplicable grow light`);
            }
        }
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

function subtractFinite(left: number, right: number, label: string): number {
    const result = left - right;
    if (!Number.isFinite(result) || result < -numberTolerance(left, right)) {
        throw new RangeError(`${label} must be non-negative`);
    }
    return result;
}

function sameNumber(left: number, right: number): boolean {
    return Math.abs(left - right) <= numberTolerance(left, right);
}

function numberTolerance(left: number, right: number): number {
    return 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));
}

function cleanZero(value: number): number {
    return Math.abs(value) <= 1e-9 ? 0 : value;
}
