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
        readonly planGrowSpeedMultiplier: number;
        readonly installed: BlueprintProductionEquipmentCapacity;
    };

export type ProductionLightingResolution =
    | {
        readonly kind: 'eligible';
        readonly assessment: BlueprintProductionLightingAssessment;
        readonly processMultiplier: number;
    }
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
        planGrowSpeedMultiplier: installed.station.growSpeedMultiplier,
        installed,
    };
}

export function productionLightingAssessment(
    context: ProductionLightingContext,
    equipmentPlacement: BlueprintProductionPlacementCapacity
): ProductionLightingResolution {
    if (context.kind !== 'external-grow-light-context') {
        return { kind: 'eligible', assessment: context, processMultiplier: 1 };
    }
    const installedPlacementIds = context.installed.placements
        .map((placement) => placement.placementId)
        .sort();
    if (equipmentPlacement.temperature.kind !== 'property-grid-tiles') {
        return {
            kind: 'eligible',
            processMultiplier: 1,
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
    if (unknown) {
        return {
            kind: 'eligible',
            processMultiplier: 1,
            assessment: {
                kind: 'selected-external-grow-light',
                growLightItemId: context.growLightItemId,
                installedPlacementIds,
                physicalCoverage: 'not-evaluated',
            },
        };
    }
    const sourceCountByTileKey = new Map<string, number>();
    for (const placement of exact) {
        for (const tile of placement.tiles) {
            const key = gridTileKey(tile);
            if (!targetTileKeySet.has(key)) continue;
            sourceCountByTileKey.set(key, (sourceCountByTileKey.get(key) ?? 0) + 1);
        }
    }
    const totalExposure = [...sourceCountByTileKey.values()].reduce(
        (total, sourceCount) => total + sourceCount,
        0
    );
    if (totalExposure > 0) {
        const averageExposure = totalExposure / targetTileKeys.length;
        const averageGrowSpeedMultiplier = (
            1 + sourceCountByTileKey.size * context.planGrowSpeedMultiplier
        ) / targetTileKeys.length;
        const processMultiplier = (
            averageExposure * averageGrowSpeedMultiplier
        ) / context.planGrowSpeedMultiplier;
        return {
            kind: 'eligible',
            processMultiplier,
            assessment: {
                kind: 'selected-external-grow-light',
                growLightItemId: context.growLightItemId,
                installedPlacementIds,
                contributingPlacementIds,
                physicalCoverage: 'exact-native-matched-standard-tiles',
                averageExposure,
                averageGrowSpeedMultiplier,
                planGrowSpeedMultiplier: context.planGrowSpeedMultiplier,
                planRelativeProcessMultiplier: processMultiplier,
            },
        };
    }
    return { kind: 'unsatisfied' };
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
