import type { BlueprintDocument } from '#core/data/blueprint';
import { canonicalJson } from '#core/data/canonical-json';
import type { Shop } from '#core/data/shop';
import type { ProductionBatchPlan } from '#core/production/plan';
import {
    composeFinishedRecipeRealizedProfit,
    type FinishedRecipeRealizedProfitInput,
    type FinishedRecipeRealizedProfitResult,
} from '#core/production/finished-recipe-profit';
import {
    BlueprintItemCostSummarizer,
    type BlueprintItemCostSummary,
} from '#core/blueprint/item-cost';
import {
    BlueprintProductionLogisticsAnalyzer,
    type BlueprintProductionLogisticsDataset,
    type BlueprintProductionLogisticsResult,
    type BlueprintProductionUnallocatedMovementRequirement,
} from '#core/blueprint/production-logistics';
import type { BlueprintProductionScheduleResult } from '#core/blueprint/production-schedule';
import {
    BlueprintValidator,
    type BlueprintValidationResult,
} from '#core/blueprint/validation';

export interface BlueprintProductionBusinessDataset
    extends BlueprintProductionLogisticsDataset {
    readonly shops: readonly Shop[];
}

export type BlueprintConstructionCostAssessment =
    | {
        readonly status: 'unavailable';
        readonly proof: 'incomplete';
        readonly source: 'blueprint-item-cost-summary';
        readonly pricingBasis: null;
        readonly pricedSubtotal: null;
        readonly minimumListedCost: null;
        readonly unlistedItemIds: readonly [];
    }
    | {
        readonly status: 'complete' | 'incomplete';
        readonly proof: 'exact-minimum-listed-cost' | 'partial-listed-subtotal';
        readonly source: 'blueprint-item-cost-summary';
        readonly pricingBasis: 'minimum-listed-price-per-item';
        readonly pricedSubtotal: number;
        readonly minimumListedCost: number | null;
        readonly unlistedItemIds: readonly string[];
    };

export interface BlueprintConfiguredEmployeeWage {
    readonly employeeId: string;
    readonly employeeType: string;
    readonly dailyWage: number | null;
}

export type BlueprintConfiguredLaborAssessment =
    | {
        readonly status: 'unavailable';
        readonly proof: 'incomplete';
        readonly source: 'normalized-configured-employee-daily-wages';
        readonly employees: readonly [];
        readonly knownDailyWage: null;
        readonly totalDailyWage: null;
        readonly missingWageEmployeeIds: readonly [];
    }
    | {
        readonly status: 'complete' | 'incomplete';
        readonly proof: 'exact' | 'incomplete';
        readonly source: 'normalized-configured-employee-daily-wages';
        readonly employees: readonly BlueprintConfiguredEmployeeWage[];
        readonly knownDailyWage: number;
        readonly totalDailyWage: number | null;
        readonly missingWageEmployeeIds: readonly string[];
    };

export interface BlueprintInstalledEquipmentBusinessCapacity {
    readonly itemId: string;
    readonly installedUnitCount: number;
    readonly itemLimitPerUnit: number | null;
    readonly installedItemLimit: number | null;
    readonly itemLimitProof: 'normalized' | 'not-recorded';
}

export type BlueprintInstalledCapacityAssessment =
    | {
        readonly status: 'unavailable';
        readonly proof: 'incomplete';
        readonly source: 'blueprint-production-schedule-capacity';
        readonly totalInstalledUnitCount: null;
        readonly equipment: readonly [];
    }
    | {
        readonly status: 'complete' | 'partial';
        readonly proof: 'exact-installed-unit-counts';
        readonly source: 'blueprint-production-schedule-capacity';
        readonly totalInstalledUnitCount: number;
        readonly equipment: readonly BlueprintInstalledEquipmentBusinessCapacity[];
    };

export type BlueprintScheduledDurationAssessment =
    | {
        readonly status: 'unavailable';
        readonly proof: 'incomplete';
        readonly source: 'blueprint-production-schedule';
        readonly scheduledElapsedMinutes: null;
        readonly selectedScheduleOptimality: null;
        readonly employeeExecutionComposition: 'not-applied';
    }
    | {
        readonly status: 'complete' | 'conditional';
        readonly proof: 'exact-selected-schedule' | 'conditional';
        readonly source: 'blueprint-production-schedule';
        readonly scheduledElapsedMinutes: number;
        readonly selectedScheduleOptimality: 'not-proven';
        readonly employeeExecutionComposition: 'not-applied';
    };

export type BlueprintProductionProfitAssessment =
    | {
        readonly status: 'not-supplied';
        readonly proof: 'incomplete';
        readonly source: 'not-supplied';
        readonly expectationBasis: 'not-modeled-realized-sale-evidence-only';
        readonly inputCompatibility: null;
        readonly constructionCostTreatment: 'independent-not-automatically-attributed';
        readonly recordedRevenue: null;
        readonly attributedCost: null;
        readonly realizedProfit: null;
        readonly profitPerGameMinute: null;
    }
    | {
        readonly status: 'complete' | 'unavailable';
        readonly proof: 'exact' | 'incomplete';
        readonly source: 'finished-recipe-realized-profit';
        readonly expectationBasis: 'not-modeled-realized-sale-evidence-only';
        readonly inputCompatibility: 'canonical-base-product-plan-and-property';
        readonly constructionCostTreatment: 'independent-not-automatically-attributed';
        readonly recordedRevenue: number;
        readonly attributedCost: number;
        readonly realizedProfit: number | null;
        readonly profitPerGameMinute: number | null;
    };

export type BlueprintProductionOperationalLimitation =
    | 'runtime-storage-contents-not-evaluated'
    | 'employee-task-sequence-and-readiness-not-evaluated'
    | 'aggregate-movement-time-not-composed'
    | 'dynamic-obstacles-not-evaluated';

export interface BlueprintProductionOperationalFeasibility {
    readonly status: 'clear' | 'incomplete' | 'blocked';
    readonly placement: 'clear' | 'blocked';
    readonly placementIssueCodes: readonly string[];
    readonly schedule: 'clear' | 'incomplete' | 'blocked';
    readonly scheduleIssueCodes: readonly string[];
    readonly logistics: 'clear' | 'blocked';
    readonly logisticsIssueCodes: readonly string[];
    readonly movement: 'clear' | 'incomplete' | 'blocked' | 'not-applicable';
    readonly unallocatedMovementRequirements:
        readonly BlueprintProductionUnallocatedMovementRequirement[];
    readonly physical: 'clear' | 'incomplete' | 'blocked' | 'not-applicable';
    readonly limitations: readonly BlueprintProductionOperationalLimitation[];
}

export interface BlueprintProductionBusinessAssessment {
    readonly scope: 'blueprint-base-production-business-assessment';
    readonly constructionCost: BlueprintConstructionCostAssessment;
    readonly configuredLabor: BlueprintConfiguredLaborAssessment;
    readonly installedCapacity: BlueprintInstalledCapacityAssessment;
    readonly scheduledDuration: BlueprintScheduledDurationAssessment;
    readonly profit: BlueprintProductionProfitAssessment;
    readonly operationalFeasibility: BlueprintProductionOperationalFeasibility;
    readonly sourceResults: {
        readonly itemCost: BlueprintItemCostSummary;
        readonly logistics: BlueprintProductionLogisticsResult;
        readonly realizedProfit: FinishedRecipeRealizedProfitResult | null;
    };
}

export class BlueprintProductionBusinessAssessmentAnalyzer {
    readonly #validator: BlueprintValidator;
    readonly #itemCost: BlueprintItemCostSummarizer;
    readonly #logistics: BlueprintProductionLogisticsAnalyzer;

    constructor(dataset: BlueprintProductionBusinessDataset) {
        this.#validator = new BlueprintValidator(dataset);
        this.#itemCost = new BlueprintItemCostSummarizer(dataset.shops);
        this.#logistics = new BlueprintProductionLogisticsAnalyzer(dataset);
    }

    analyze(
        blueprint: BlueprintDocument,
        plan: ProductionBatchPlan,
        profitInput: FinishedRecipeRealizedProfitInput | null = null
    ): BlueprintProductionBusinessAssessment {
        const validation = this.#validator.validate(blueprint);
        const itemCost = this.#itemCost.summarize(validation);
        const logistics = this.#logistics.analyze(blueprint, plan);
        const realizedProfit = profitInput === null
            ? null
            : this.#realizedProfit(blueprint, plan, profitInput);
        const schedule = logistics.transfers.schedule;
        return {
            scope: 'blueprint-base-production-business-assessment',
            constructionCost: constructionCostAssessment(itemCost),
            configuredLabor: configuredLaborAssessment(logistics),
            installedCapacity: installedCapacityAssessment(schedule),
            scheduledDuration: scheduledDurationAssessment(schedule),
            profit: profitAssessment(realizedProfit),
            operationalFeasibility: operationalFeasibility(validation, logistics),
            sourceResults: { itemCost, logistics, realizedProfit },
        };
    }

    #realizedProfit(
        blueprint: BlueprintDocument,
        plan: ProductionBatchPlan,
        input: FinishedRecipeRealizedProfitInput
    ): FinishedRecipeRealizedProfitResult {
        const production = input.lifecycleInput.readiness.productionPlan;
        if (canonicalJson(production.baseProductPlan) !== canonicalJson(plan)) {
            throw new Error('Realized profit base-product plan does not match the blueprint production plan');
        }
        if (input.lifecycleInput.readiness.propertyId !== blueprint.propertyCode) {
            throw new Error('Realized profit production property does not match the blueprint property');
        }
        return composeFinishedRecipeRealizedProfit(input);
    }
}

function constructionCostAssessment(
    result: BlueprintItemCostSummary
): BlueprintConstructionCostAssessment {
    if (result.kind === 'invalid-blueprint') {
        return {
            status: 'unavailable',
            proof: 'incomplete',
            source: 'blueprint-item-cost-summary',
            pricingBasis: null,
            pricedSubtotal: null,
            minimumListedCost: null,
            unlistedItemIds: [],
        };
    }
    return {
        status: result.minimumListedCost === null ? 'incomplete' : 'complete',
        proof: result.minimumListedCost === null
            ? 'partial-listed-subtotal'
            : 'exact-minimum-listed-cost',
        source: 'blueprint-item-cost-summary',
        pricingBasis: result.pricingBasis,
        pricedSubtotal: result.pricedSubtotal,
        minimumListedCost: result.minimumListedCost,
        unlistedItemIds: result.unlistedItemIds,
    };
}

function configuredLaborAssessment(
    result: BlueprintProductionLogisticsResult
): BlueprintConfiguredLaborAssessment {
    const configuration = result.configuration;
    if (configuration === null) {
        return {
            status: 'unavailable',
            proof: 'incomplete',
            source: 'normalized-configured-employee-daily-wages',
            employees: [],
            knownDailyWage: null,
            totalDailyWage: null,
            missingWageEmployeeIds: [],
        };
    }
    const employees = configuration.employees.map((employee) => ({
        employeeId: employee.employeeId,
        employeeType: employee.employeeType,
        dailyWage: employee.dailyWage,
    }));
    const missingWageEmployeeIds = employees
        .filter((employee) => employee.dailyWage === null)
        .map((employee) => employee.employeeId);
    const knownDailyWage = sumFinite(
        employees.flatMap((employee) => employee.dailyWage === null ? [] : [employee.dailyWage]),
        'Configured employee daily wage'
    );
    return {
        status: missingWageEmployeeIds.length === 0 ? 'complete' : 'incomplete',
        proof: missingWageEmployeeIds.length === 0 ? 'exact' : 'incomplete',
        source: 'normalized-configured-employee-daily-wages',
        employees,
        knownDailyWage,
        totalDailyWage: missingWageEmployeeIds.length === 0 ? knownDailyWage : null,
        missingWageEmployeeIds,
    };
}

function installedCapacityAssessment(
    schedule: BlueprintProductionScheduleResult
): BlueprintInstalledCapacityAssessment {
    if (schedule.kind === 'rejected') {
        return {
            status: 'unavailable',
            proof: 'incomplete',
            source: 'blueprint-production-schedule-capacity',
            totalInstalledUnitCount: null,
            equipment: [],
        };
    }
    const equipment = schedule.capacity.equipment.map((entry) => ({
        itemId: entry.itemId,
        installedUnitCount: entry.installedUnitCount,
        itemLimitPerUnit: entry.itemLimitPerUnit,
        installedItemLimit: entry.installedItemLimit,
        itemLimitProof: entry.installedItemLimit === null
            ? 'not-recorded' as const
            : 'normalized' as const,
    }));
    return {
        status: equipment.some((entry) => entry.itemLimitProof === 'not-recorded')
            ? 'partial'
            : 'complete',
        proof: 'exact-installed-unit-counts',
        source: 'blueprint-production-schedule-capacity',
        totalInstalledUnitCount: sumFinite(
            equipment.map((entry) => entry.installedUnitCount),
            'Installed production unit count'
        ),
        equipment,
    };
}

function scheduledDurationAssessment(
    schedule: BlueprintProductionScheduleResult
): BlueprintScheduledDurationAssessment {
    if (schedule.kind !== 'scheduled') {
        return {
            status: 'unavailable',
            proof: 'incomplete',
            source: 'blueprint-production-schedule',
            scheduledElapsedMinutes: null,
            selectedScheduleOptimality: null,
            employeeExecutionComposition: 'not-applied',
        };
    }
    return {
        status: schedule.constraintStatus === 'satisfied' ? 'complete' : 'conditional',
        proof: schedule.constraintStatus === 'satisfied'
            ? 'exact-selected-schedule'
            : 'conditional',
        source: 'blueprint-production-schedule',
        scheduledElapsedMinutes: schedule.scheduledElapsedMinutes,
        selectedScheduleOptimality: schedule.optimality,
        employeeExecutionComposition: 'not-applied',
    };
}

function profitAssessment(
    result: FinishedRecipeRealizedProfitResult | null
): BlueprintProductionProfitAssessment {
    if (result === null) {
        return {
            status: 'not-supplied',
            proof: 'incomplete',
            source: 'not-supplied',
            expectationBasis: 'not-modeled-realized-sale-evidence-only',
            inputCompatibility: null,
            constructionCostTreatment: 'independent-not-automatically-attributed',
            recordedRevenue: null,
            attributedCost: null,
            realizedProfit: null,
            profitPerGameMinute: null,
        };
    }
    return {
        status: result.status,
        proof: result.proof,
        source: 'finished-recipe-realized-profit',
        expectationBasis: 'not-modeled-realized-sale-evidence-only',
        inputCompatibility: 'canonical-base-product-plan-and-property',
        constructionCostTreatment: 'independent-not-automatically-attributed',
        recordedRevenue: result.revenue.recordedRevenue,
        attributedCost: result.costs.knownTotalCost,
        realizedProfit: result.economics?.realizedProfit ?? null,
        profitPerGameMinute: result.economics?.profitPerGameMinute ?? null,
    };
}

function operationalFeasibility(
    validation: BlueprintValidationResult,
    logistics: BlueprintProductionLogisticsResult
): BlueprintProductionOperationalFeasibility {
    const schedule = logistics.transfers.schedule;
    const placement = validation.valid ? 'clear' as const : 'blocked' as const;
    const scheduleStatus = schedule.kind !== 'scheduled'
        ? 'blocked' as const
        : schedule.constraintStatus === 'conditional'
            ? 'incomplete' as const
            : 'clear' as const;
    const logisticsStatus = logistics.kind === 'analyzed' ? 'clear' as const : 'blocked' as const;
    const movement = movementStatus(logistics);
    const physical = logistics.kind === 'analyzed'
        ? logistics.movementPhysicalFeasibility.status
        : 'not-applicable' as const;
    const limitations = logistics.kind === 'analyzed'
        ? operationalLimitations(logistics)
        : [];
    const statuses = [placement, scheduleStatus, logisticsStatus, movement, physical];
    return {
        status: statuses.includes('blocked')
            ? 'blocked'
            : statuses.includes('incomplete') || limitations.length > 0
                ? 'incomplete'
                : 'clear',
        placement,
        placementIssueCodes: validation.issues.map((issue) => issue.code),
        schedule: scheduleStatus,
        scheduleIssueCodes: schedule.kind === 'unavailable'
            ? schedule.issues.map((issue) => issue.code)
            : [],
        logistics: logisticsStatus,
        logisticsIssueCodes: logistics.configuration?.issues.map((issue) => issue.code) ?? [],
        movement,
        unallocatedMovementRequirements: logistics.kind === 'analyzed'
            ? logistics.movementPlan.unallocatedRequirements
            : [],
        physical,
        limitations,
    };
}

function movementStatus(
    logistics: BlueprintProductionLogisticsResult
): BlueprintProductionOperationalFeasibility['movement'] {
    if (logistics.kind !== 'analyzed') return 'not-applicable';
    const plan = logistics.movementPlan;
    if (plan.allocations.length === 0 && plan.unallocatedRequirements.length === 0) {
        return 'not-applicable';
    }
    if (plan.status === 'complete') return 'clear';
    const incompleteReasons = new Set([
        'destination-capacity-evidence-unavailable',
        'employee-inventory-capacity-unavailable',
    ]);
    return plan.unallocatedRequirements.some((requirement) =>
        requirement.reasons.some((reason) => !incompleteReasons.has(reason))
    ) ? 'blocked' : 'incomplete';
}

function operationalLimitations(
    logistics: Extract<BlueprintProductionLogisticsResult, { readonly kind: 'analyzed' }>
): BlueprintProductionOperationalLimitation[] {
    const hasMovement = logistics.movementPlan.allocations.length > 0 ||
        logistics.movementPlan.unallocatedRequirements.length > 0;
    const hasEmployeeWork = logistics.employeeExecution.assignments.length > 0 || hasMovement;
    return [
        ...(hasMovement
            ? ['runtime-storage-contents-not-evaluated' as const]
            : []),
        ...(hasEmployeeWork
            ? ['employee-task-sequence-and-readiness-not-evaluated' as const]
            : []),
        ...(hasMovement
            ? ['aggregate-movement-time-not-composed' as const]
            : []),
        ...(logistics.movementPhysicalFeasibility.allocations.length > 0
            ? ['dynamic-obstacles-not-evaluated' as const]
            : []),
    ];
}

function sumFinite(values: readonly number[], label: string): number {
    let total = 0;
    for (const value of values) {
        if (!Number.isFinite(value) || value < 0) {
            throw new RangeError(`${label} values must be non-negative and finite`);
        }
        total += value;
        if (!Number.isFinite(total)) throw new RangeError(`${label} must be finite`);
    }
    return total;
}
