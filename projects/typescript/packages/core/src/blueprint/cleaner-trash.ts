import type { BlueprintDocument } from '#core/data/blueprint';
import { BuildableSchema, type Buildable } from '#core/data/buildable';
import {
    ProductionLogisticsCatalogSchema,
    type ProductionLogisticsCatalog,
    type ProductionLogisticsCleanerRules,
    type ProductionLogisticsEmployeeScheduling,
} from '#core/data/production-logistics';
import {
    BlueprintValidator,
    type BlueprintDataset,
    type BlueprintValidationResult,
} from '#core/blueprint/validation';

export interface BlueprintCleanerTrashDataset extends BlueprintDataset {
    readonly productionLogistics: ProductionLogisticsCatalog;
}

export type BlueprintCleanerTrashIssueCode =
    | 'cleaner-role-unavailable'
    | 'cleaner-scheduling-unavailable'
    | 'cleaner-assignment-limit-exceeded'
    | 'assigned-bin-unavailable'
    | 'assigned-buildable-unavailable'
    | 'assigned-buildable-not-trash-container'
    | 'assigned-bin-not-usable-by-cleaners'
    | 'assigned-bin-has-no-transit-access-point';

export interface BlueprintCleanerTrashIssue {
    readonly code: BlueprintCleanerTrashIssueCode;
    readonly message: string;
    readonly employeeId: string;
    readonly placementId: string | null;
}

export interface BlueprintCleanerTrashBinCoverage {
    readonly placementId: string;
    readonly itemId: string | null;
    readonly usableByCleaners: boolean | null;
    readonly transitAccessPointCount: number | null;
    readonly collectionCoverage: 'configured' | 'unavailable';
    readonly endpointReachability: 'not-evaluated';
    readonly dynamicCollectionCompletion: 'not-evaluated';
}

export interface BlueprintCleanerTrashEmployeeAnalysis {
    readonly employeeId: string;
    readonly dailyWage: number | null;
    readonly baseWorkSpeed: number | null;
    readonly walkSpeed: number | null;
    readonly inventorySlotCount: number | null;
    readonly assignmentLimit: number | null;
    readonly assignedBinCount: number;
    readonly configuredBinCount: number;
    readonly bins: readonly BlueprintCleanerTrashBinCoverage[];
}

export type BlueprintCleanerTrashAnalysisResult =
    | {
        readonly kind: 'rejected';
        readonly validation: BlueprintValidationResult;
        readonly employees: readonly [];
        readonly issues: readonly [];
    }
    | {
        readonly kind: 'analyzed';
        readonly validation: BlueprintValidationResult;
        readonly valid: boolean;
        readonly rules: ProductionLogisticsCleanerRules | null;
        readonly taskPriority: ProductionLogisticsEmployeeScheduling['cleanerTaskPriority'];
        readonly coverageScope: 'assigned-cleaner-usable-trash-bins';
        readonly binOrderOrigin: 'current-cleaner-position-at-task-selection';
        readonly currentTrashState: 'not-evaluated';
        readonly endpointReachability: 'not-evaluated';
        readonly employees: readonly BlueprintCleanerTrashEmployeeAnalysis[];
        readonly issues: readonly BlueprintCleanerTrashIssue[];
    };

export class BlueprintCleanerTrashAnalyzer {
    readonly #validator: BlueprintValidator;
    readonly #catalog: ProductionLogisticsCatalog;
    readonly #buildableByItemId: ReadonlyMap<string, Buildable>;

    constructor(dataset: BlueprintCleanerTrashDataset) {
        this.#validator = new BlueprintValidator(dataset);
        this.#catalog = ProductionLogisticsCatalogSchema.assert(dataset.productionLogistics);
        this.#buildableByItemId = indexUnique(
            dataset.buildables.map((buildable) => BuildableSchema.assert(buildable)),
            (buildable) => buildable.itemId,
            'buildable item ID'
        );
    }

    analyze(input: BlueprintDocument): BlueprintCleanerTrashAnalysisResult {
        const validation = this.#validator.validate(input);
        if (!validation.valid) {
            return { kind: 'rejected', validation, employees: [], issues: [] };
        }

        const issues: BlueprintCleanerTrashIssue[] = [];
        const placementById = new Map(
            validation.document.placements.map((placement) => [placement.id, placement])
        );
        const role = this.#catalog.employeeRoles.find(
            (candidate) => candidate.employeeType === 'Cleaner'
        );
        const scheduling = this.#catalog.employeeScheduling;
        const employees = validation.document.productionLogistics.employees
            .filter((employee) => employee.employeeType === 'Cleaner')
            .map((employee): BlueprintCleanerTrashEmployeeAnalysis => {
                if (role === undefined) {
                    issues.push(issue(
                        'cleaner-role-unavailable',
                        `Employee ${JSON.stringify(employee.id)} requires unavailable Cleaner role data`,
                        employee.id
                    ));
                } else if (employee.assignedBinPlacementIds.length > role.assignmentLimit) {
                    issues.push(issue(
                        'cleaner-assignment-limit-exceeded',
                        `Employee ${JSON.stringify(employee.id)} has ${employee.assignedBinPlacementIds.length} assigned bins, but Cleaner supports ${role.assignmentLimit}`,
                        employee.id
                    ));
                }
                if (scheduling === null) {
                    issues.push(issue(
                        'cleaner-scheduling-unavailable',
                        `Employee ${JSON.stringify(employee.id)} requires unavailable Cleaner scheduling data`,
                        employee.id
                    ));
                }

                const bins = employee.assignedBinPlacementIds.map((placementId) =>
                    this.#analyzeBin(employee.id, placementId, placementById, issues)
                );
                return {
                    employeeId: employee.id,
                    dailyWage: role?.dailyWage ?? null,
                    baseWorkSpeed: role?.baseWorkSpeed ?? null,
                    walkSpeed: role?.walkSpeed ?? null,
                    inventorySlotCount: role?.inventorySlotCount ?? null,
                    assignmentLimit: role?.assignmentLimit ?? null,
                    assignedBinCount: bins.length,
                    configuredBinCount: bins.filter(
                        (bin) => bin.collectionCoverage === 'configured'
                    ).length,
                    bins,
                };
            });
        return {
            kind: 'analyzed',
            validation,
            valid: issues.length === 0,
            rules: scheduling?.cleanerRules ?? null,
            taskPriority: scheduling?.cleanerTaskPriority ?? [],
            coverageScope: 'assigned-cleaner-usable-trash-bins',
            binOrderOrigin: 'current-cleaner-position-at-task-selection',
            currentTrashState: 'not-evaluated',
            endpointReachability: 'not-evaluated',
            employees,
            issues,
        };
    }

    #analyzeBin(
        employeeId: string,
        placementId: string,
        placementById: ReadonlyMap<string, BlueprintDocument['placements'][number]>,
        issues: BlueprintCleanerTrashIssue[]
    ): BlueprintCleanerTrashBinCoverage {
        const placement = placementById.get(placementId);
        if (placement === undefined) {
            issues.push(issue(
                'assigned-bin-unavailable',
                `Cleaner ${JSON.stringify(employeeId)} references unavailable bin placement ${JSON.stringify(placementId)}`,
                employeeId,
                placementId
            ));
            return unavailableBin(placementId);
        }
        const buildable = this.#buildableByItemId.get(placement.itemId);
        if (buildable === undefined) {
            issues.push(issue(
                'assigned-buildable-unavailable',
                `Assigned bin placement ${JSON.stringify(placementId)} uses unavailable buildable ${JSON.stringify(placement.itemId)}`,
                employeeId,
                placementId
            ));
            return unavailableBin(placementId, placement.itemId);
        }
        if (buildable.trash === null) {
            issues.push(issue(
                'assigned-buildable-not-trash-container',
                `Assigned bin placement ${JSON.stringify(placementId)} is not a normalized trash container`,
                employeeId,
                placementId
            ));
        } else if (!buildable.trash.usableByCleaners) {
            issues.push(issue(
                'assigned-bin-not-usable-by-cleaners',
                `Assigned bin placement ${JSON.stringify(placementId)} is not usable by Cleaners`,
                employeeId,
                placementId
            ));
        }
        if (buildable.trash?.usableByCleaners === true &&
            buildable.transitAccessPoints.length === 0) {
            issues.push(issue(
                'assigned-bin-has-no-transit-access-point',
                `Assigned bin placement ${JSON.stringify(placementId)} has no normalized transit access point`,
                employeeId,
                placementId
            ));
        }
        const configured = buildable.trash?.usableByCleaners === true &&
            buildable.transitAccessPoints.length > 0;
        return {
            placementId,
            itemId: placement.itemId,
            usableByCleaners: buildable.trash?.usableByCleaners ?? null,
            transitAccessPointCount: buildable.transitAccessPoints.length,
            collectionCoverage: configured ? 'configured' : 'unavailable',
            endpointReachability: 'not-evaluated',
            dynamicCollectionCompletion: 'not-evaluated',
        };
    }
}

function unavailableBin(
    placementId: string,
    itemId: string | null = null
): BlueprintCleanerTrashBinCoverage {
    return {
        placementId,
        itemId,
        usableByCleaners: null,
        transitAccessPointCount: null,
        collectionCoverage: 'unavailable',
        endpointReachability: 'not-evaluated',
        dynamicCollectionCompletion: 'not-evaluated',
    };
}

function issue(
    code: BlueprintCleanerTrashIssueCode,
    message: string,
    employeeId: string,
    placementId: string | null = null
): BlueprintCleanerTrashIssue {
    return { code, message, employeeId, placementId };
}

function indexUnique<T>(
    values: readonly T[],
    keyFor: (value: T) => string,
    label: string
): ReadonlyMap<string, T> {
    const result = new Map<string, T>();
    for (const value of values) {
        const key = keyFor(value);
        if (result.has(key)) {
            throw new Error(`Dataset contains duplicate ${label} ${JSON.stringify(key)}`);
        }
        result.set(key, value);
    }
    return result;
}
