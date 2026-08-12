import type { ProductionBatchStep } from '#core/production/plan';
import type { ProductionStation } from '#core/data/production';
import type {
    BlueprintProductionEquipmentCapacity,
    BlueprintProductionPlacementCapacity,
} from '#core/blueprint/production-capacity';
import type {
    BlueprintProductionLightingAssessment,
    BlueprintProductionScheduleIssue,
} from '#core/blueprint/production-schedule-types';

export type ProductionLightingContext =
    | BlueprintProductionLightingAssessment
    | {
        readonly kind: 'external-grow-light-context';
        readonly growLightItemId: string;
        readonly installed: BlueprintProductionEquipmentCapacity;
    };

export type ProductionLightingResolution =
    | { readonly kind: 'eligible'; readonly assessment: BlueprintProductionLightingAssessment }
    | { readonly kind: 'unsatisfied' };

export function productionLightingContext(
    equipment: BlueprintProductionEquipmentCapacity,
    step: ProductionBatchStep,
    stepIndex: number,
    allEquipment: readonly BlueprintProductionEquipmentCapacity[]
): ProductionLightingContext | BlueprintProductionScheduleIssue {
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
    if (installed?.station?.kind !== 'grow-light' || installed.placements.length === 0) {
        return {
            ...issueBase(step, stepIndex),
            code: 'missing-selected-grow-light',
            selectedGrowLightItemId: step.growLightItemId,
            equipmentPlacementIds: equipment.placements.map((placement) => placement.placementId).sort(),
        };
    }
    return {
        kind: 'external-grow-light-context',
        growLightItemId: step.growLightItemId,
        installed,
    };
}

export function productionLightingAssessment(
    context: ProductionLightingContext,
    equipmentPlacement: BlueprintProductionPlacementCapacity
): ProductionLightingResolution {
    if (context.kind !== 'external-grow-light-context') {
        return { kind: 'eligible', assessment: context };
    }
    const installedPlacementIds = context.installed.placements
        .map((placement) => placement.placementId)
        .sort();
    if (equipmentPlacement.temperature.kind !== 'property-grid-tiles') {
        return {
            kind: 'eligible',
            assessment: {
                kind: 'selected-external-grow-light',
                growLightItemId: context.growLightItemId,
                installedPlacementIds,
                physicalCoverage: 'not-evaluated',
            },
        };
    }
    const exact = context.installed.placements.flatMap((placement) => {
        const coverage = placement.growLightCoverage;
        return coverage?.kind === 'property-grid-tiles'
            ? [{ placementId: placement.placementId, tiles: coverage.tiles }]
            : [];
    });
    const unknown = exact.length !== context.installed.placements.length;
    const targetTileKeys = equipmentPlacement.temperature.tiles.map((tile) => gridTileKey(tile));
    const targetTileKeySet = new Set(targetTileKeys);
    const contributingPlacementIds = exact
        .filter((placement) => placement.tiles.some(
            (tile) => targetTileKeySet.has(gridTileKey(tile))
        ))
        .map((placement) => placement.placementId)
        .sort();
    const coveredTileKeys = new Set(exact.flatMap((placement) =>
        placement.tiles.map((tile) => gridTileKey(tile))
    ));
    const coveredTileCount = targetTileKeys.filter((key) => coveredTileKeys.has(key)).length;
    if (coveredTileCount > 0) {
        return {
            kind: 'eligible',
            assessment: {
                kind: 'selected-external-grow-light',
                growLightItemId: context.growLightItemId,
                installedPlacementIds,
                contributingPlacementIds,
                physicalCoverage: 'exact-native-matched-standard-tiles',
                averageExposure: coveredTileCount / targetTileKeys.length,
            },
        };
    }
    if (!unknown) return { kind: 'unsatisfied' };
    return {
        kind: 'eligible',
        assessment: {
            kind: 'selected-external-grow-light',
            growLightItemId: context.growLightItemId,
            installedPlacementIds,
            physicalCoverage: 'not-evaluated',
        },
    };
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

function gridTileKey(tile: { readonly gridId: string; readonly x: number; readonly y: number }): string {
    return `${tile.gridId}\u001f${tile.x}\u001f${tile.y}`;
}
