import type { ProductionBatchStep } from '#core/production/plan';
import type {
    BlueprintProductionCapacityResult,
    BlueprintProductionMoistureRule,
    BlueprintProductionTemperatureRule,
} from '#core/blueprint/production-capacity';

export type BlueprintProductionLightingAssessment =
    | {
        readonly kind: 'not-required';
    }
    | {
        readonly kind: 'built-in';
        readonly equipmentItemId: string;
    }
    | {
        readonly kind: 'selected-external-grow-light';
        readonly growLightItemId: string;
        readonly installedPlacementIds: readonly string[];
        readonly physicalCoverage: 'not-evaluated';
    }
    | {
        readonly kind: 'selected-external-grow-light';
        readonly growLightItemId: string;
        readonly installedPlacementIds: readonly string[];
        readonly contributingPlacementIds: readonly string[];
        readonly physicalCoverage: 'exact-native-matched-standard-tiles';
        readonly averageExposure: number;
        readonly averageGrowSpeedMultiplier: number;
        readonly planGrowSpeedMultiplier: number;
        readonly planRelativeProcessMultiplier: number;
    };

export type BlueprintProductionTemperatureAssessment =
    | {
        readonly kind: 'not-applicable';
        readonly reason: 'process-has-no-temperature-rule' | 'internal-cook-setpoint';
        readonly rule: BlueprintProductionTemperatureRule | null;
    }
    | {
        readonly kind: 'satisfied';
        readonly basis: 'native-effective-temperature';
        readonly ambientTemperature: number;
        readonly effectiveTemperature: number;
        readonly processMultiplier: number;
        readonly rule: Exclude<
            BlueprintProductionTemperatureRule,
            { readonly kind: 'internal-cook-setpoint' }
        >;
    }
    | {
        readonly kind: 'conditional';
        readonly reason: 'placement-not-on-property-grid';
        readonly ambientTemperature: number | null;
        readonly effectiveTemperature: number | null;
        readonly processMultiplier: null;
        readonly rule: Exclude<
            BlueprintProductionTemperatureRule,
            { readonly kind: 'internal-cook-setpoint' }
        >;
    };

export type BlueprintProductionMoistureAssessment =
    | {
        readonly kind: 'not-applicable';
        readonly reason: 'process-has-no-moisture-rule';
        readonly rule: null;
    }
    | {
        readonly kind: 'conditional';
        readonly reason: 'mutable-soil-moisture-and-replenishment-not-recorded';
        readonly normalizedMoisture: null;
        readonly processMultiplier: null;
        readonly rule: BlueprintProductionMoistureRule;
    };

export interface BlueprintProductionBatchAssignment {
    readonly equipmentItemId: string;
    readonly placementId: string;
    readonly batchNumbers: readonly number[];
    readonly batchCount: number;
    readonly lighting: BlueprintProductionLightingAssessment;
    readonly temperature: BlueprintProductionTemperatureAssessment;
    readonly moisture: BlueprintProductionMoistureAssessment;
    readonly constraintStatus: 'satisfied' | 'conditional';
}

export interface BlueprintProductionScheduledBatch {
    readonly batchNumber: number;
    readonly equipmentItemId: string;
    readonly placementId: string;
    readonly dependencyReadyMinute: number;
    readonly lightingAdjustedDurationMinutes: number;
    readonly durationMinutes: number;
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
    readonly durationMinutesPerBatchBasis:
        'production-batch-plan-before-placement-lighting-temperature-and-moisture';
    readonly startMinute: number;
    readonly endMinute: number;
    readonly elapsedMinutes: number;
    readonly constraintStatus: 'satisfied' | 'conditional';
    readonly assignments: readonly BlueprintProductionBatchAssignment[];
    readonly batches: readonly BlueprintProductionScheduledBatch[];
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
    }
    | BlueprintProductionScheduleIssueBase & {
        readonly code: 'grow-light-selection-required';
        readonly equipmentPlacementIds: readonly string[];
    }
    | BlueprintProductionScheduleIssueBase & {
        readonly code: 'missing-selected-grow-light';
        readonly selectedGrowLightItemId: string;
        readonly equipmentPlacementIds: readonly string[];
    }
    | BlueprintProductionScheduleIssueBase & {
        readonly code: 'grow-light-coverage-unsatisfied';
        readonly selectedGrowLightItemId: string;
        readonly installedGrowLightPlacementIds: readonly string[];
        readonly incompatiblePlacementIds: readonly string[];
    }
    | BlueprintProductionScheduleIssueBase & {
        readonly code: 'temperature-constraint-unsatisfied';
        readonly incompatiblePlacementIds: readonly string[];
        readonly temperatureRule: BlueprintProductionTemperatureRule;
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
        readonly durationBasis:
            'production-batch-plan-with-native-light-exposure-temperature-and-conditional-moisture-rate';
        readonly schedulingAlgorithm: 'deterministic-critical-path-list-scheduling';
        readonly optimality: 'not-proven';
        readonly parallelScheduling: 'non-overlapping-whole-batch-equipment-calendars';
        readonly crossStepConcurrency: 'production-dependency-and-equipment-constrained';
        readonly batchPipelining: 'cumulative-plan-order-produced-quantity';
        readonly routing: 'not-evaluated';
        readonly employeeScheduling: 'not-applied-reported-by-production-logistics';
        readonly lightingCoverage: 'native-matched-standard-tile-exposure-and-duration';
        readonly effectiveTemperature: 'native-distance-weighted-tile-average';
        readonly temperatureDuration: 'native-capped-linear-process-rate';
        readonly moistureDuration: 'native-binary-threshold-with-conditional-mutable-state';
        readonly constraintStatus: 'satisfied' | 'conditional';
        readonly baseSerialProcessMinutes: number;
        readonly lightingAdjustedSerialProcessMinutes: number;
        readonly lightingTimeAddedMinutes: number;
        readonly lightingTimeSavedMinutes: number;
        readonly serialProcessMinutes: number;
        readonly temperatureTimeSavedMinutes: number;
        readonly scheduledElapsedMinutes: number;
        readonly parallelTimeSavedMinutes: number;
        readonly schedule: readonly BlueprintProductionScheduledStep[];
    };

export type BlueprintProductionScheduleProcessKind =
    | 'seed-harvest'
    | 'shroom-harvest'
    | 'station-recipe'
    | 'oven-transform'
    | 'cauldron'
    | 'mushroom-spawn';

export function productionScheduleProcessKind(
    step: ProductionBatchStep
): BlueprintProductionScheduleProcessKind {
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
