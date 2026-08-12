import type { Buildable, ProceduralTile } from '#core/data/buildable';
import type {
    BlueprintProductionGridTile,
    BlueprintProductionGrowLightCoverage,
} from '#core/blueprint/production-capacity';
import type {
    ResolvedBlueprintPlacement,
} from '#core/blueprint/validation';

const positionTolerance = 1e-3;

export function productionGrowLightCoverage(
    placement: ResolvedBlueprintPlacement,
    resolvedPlacementById: ReadonlyMap<string, ResolvedBlueprintPlacement>,
    buildableByItemId: ReadonlyMap<string, Buildable>
): BlueprintProductionGrowLightCoverage {
    if (placement.kind !== 'procedural-grid' || placement.parentPlacementId === null) {
        return unavailableCoverage();
    }
    const parent = resolvedPlacementById.get(placement.parentPlacementId);
    if (parent?.kind !== 'grid') return unavailableCoverage();
    const parentBuildable = buildableByItemId.get(parent.itemId);
    if (parentBuildable === undefined) return unavailableCoverage();

    const proceduralTileById = new Map(
        parentBuildable.proceduralTiles.map((tile) => [tile.id, tile])
    );
    const coveredFootprintCoordinates = new Set<string>();
    for (const tile of placement.tiles) {
        const proceduralTile = proceduralTileById.get(tile.tileId);
        if (proceduralTile === undefined) return unavailableCoverage();
        const footprintTile = matchedFootprintTile(proceduralTile, parentBuildable);
        if (footprintTile === null) return unavailableCoverage();
        coveredFootprintCoordinates.add(`${footprintTile.x},${footprintTile.y}`);
    }
    if (
        coveredFootprintCoordinates.size !== parentBuildable.placement.footprintTiles.length ||
        coveredFootprintCoordinates.size !== parent.occupiedTiles.length
    ) return unavailableCoverage();
    return {
        kind: 'property-grid-tiles',
        coverageProofStatus: 'exact',
        coverageRule: 'native-matched-standard-tiles',
        tiles: parent.occupiedTiles.map((tile) => ({
            gridId: parent.gridId,
            x: tile.x,
            y: tile.y,
        })).sort(compareTiles),
    };
}

function matchedFootprintTile(
    proceduralTile: ProceduralTile,
    parentBuildable: Buildable
): Buildable['placement']['footprintTiles'][number] | null {
    const matches = parentBuildable.placement.footprintTiles.filter((footprintTile) =>
        Math.hypot(
            proceduralTile.transform.worldPosition.x - footprintTile.transform.worldPosition.x,
            proceduralTile.transform.worldPosition.z - footprintTile.transform.worldPosition.z
        ) <= positionTolerance
    );
    return matches.length === 1 ? matches[0] ?? null : null;
}

function unavailableCoverage(): BlueprintProductionGrowLightCoverage {
    return {
        kind: 'not-evaluated',
        reason: 'placement-not-on-grid-backed-procedural-tiles',
        tiles: [],
    };
}

function compareTiles(left: BlueprintProductionGridTile, right: BlueprintProductionGridTile): number {
    return left.gridId.localeCompare(right.gridId) || left.x - right.x || left.y - right.y;
}
