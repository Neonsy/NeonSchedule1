import type {
    BlueprintProductionMoistureRule,
} from '#core/blueprint/production-capacity';
import type {
    BlueprintProductionMoistureAssessment,
} from '#core/blueprint/production-schedule-types';

export interface BlueprintProductionMoistureResolution {
    readonly assessment: BlueprintProductionMoistureAssessment;
    readonly processMultiplier: 1;
    readonly constraintStatus: 'satisfied' | 'conditional';
}

export function productionMoistureAssessment(
    rule: BlueprintProductionMoistureRule | null
): BlueprintProductionMoistureResolution {
    if (rule === null) {
        return {
            assessment: {
                kind: 'not-applicable',
                reason: 'process-has-no-moisture-rule',
                rule,
            },
            processMultiplier: 1,
            constraintStatus: 'satisfied',
        };
    }
    return {
        assessment: {
            kind: 'conditional',
            reason: 'mutable-soil-moisture-and-replenishment-not-recorded',
            normalizedMoisture: null,
            processMultiplier: null,
            rule,
        },
        processMultiplier: 1,
        constraintStatus: 'conditional',
    };
}
