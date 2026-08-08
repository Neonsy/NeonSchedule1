import type { BlueprintGridCoordinate } from '#core/data/blueprint';
import type {
    BlueprintValidationResult,
    ResolvedBlueprintGridPlacement,
} from '#core/blueprint/validation';

export interface BlueprintConstructionConstraint {
    readonly beforePlacementId: string;
    readonly afterPlacementId: string;
    readonly gridId: string;
    readonly cornerTiles: readonly BlueprintGridCoordinate[];
}

interface BlueprintConstructionResultBase {
    readonly validation: BlueprintValidationResult;
    readonly occupancyScope: 'blueprint-placements-only';
    readonly constraints: readonly BlueprintConstructionConstraint[];
}

export interface InvalidBlueprintConstructionResult extends BlueprintConstructionResultBase {
    readonly kind: 'invalid-blueprint';
}

export interface OrderedBlueprintConstructionResult extends BlueprintConstructionResultBase {
    readonly kind: 'ordered';
    readonly placementIds: readonly string[];
}

export interface CyclicBlueprintConstructionResult extends BlueprintConstructionResultBase {
    readonly kind: 'cyclic';
    readonly placeablePrefixIds: readonly string[];
    readonly blockedPlacementIds: readonly string[];
}

export type BlueprintConstructionResult =
    | InvalidBlueprintConstructionResult
    | OrderedBlueprintConstructionResult
    | CyclicBlueprintConstructionResult;

export function planBlueprintConstructionOrder(
    validation: BlueprintValidationResult
): BlueprintConstructionResult {
    if (!validation.valid) {
        return {
            kind: 'invalid-blueprint',
            validation,
            occupancyScope: 'blueprint-placements-only',
            constraints: [],
        };
    }

    const gridPlacements = validation.resolvedPlacements.filter(
        (placement): placement is ResolvedBlueprintGridPlacement => placement.kind === 'grid'
    );
    const constraints = constructionConstraints(gridPlacements);
    const originalIndex = new Map(
        validation.document.placements.map((placement, index) => [placement.id, index])
    );
    const placementIds = validation.resolvedPlacements.map((placement) => placement.id);
    const outgoing = new Map(placementIds.map((id) => [id, new Set<string>()]));
    const incomingCount = new Map(placementIds.map((id) => [id, 0]));
    for (const constraint of constraints) {
        const targets = outgoing.get(constraint.beforePlacementId)!;
        if (targets.has(constraint.afterPlacementId)) continue;
        targets.add(constraint.afterPlacementId);
        incomingCount.set(
            constraint.afterPlacementId,
            incomingCount.get(constraint.afterPlacementId)! + 1
        );
    }

    const order: string[] = [];
    const ready = placementIds.filter((id) => incomingCount.get(id) === 0);
    sortPlacementIds(ready, originalIndex);
    while (ready.length > 0) {
        const id = ready.shift()!;
        order.push(id);
        for (const target of outgoing.get(id)!) {
            const remaining = incomingCount.get(target)! - 1;
            incomingCount.set(target, remaining);
            if (remaining === 0) {
                ready.push(target);
                sortPlacementIds(ready, originalIndex);
            }
        }
    }

    if (order.length === placementIds.length) {
        return {
            kind: 'ordered',
            validation,
            occupancyScope: 'blueprint-placements-only',
            constraints,
            placementIds: order,
        };
    }
    const placed = new Set(order);
    return {
        kind: 'cyclic',
        validation,
        occupancyScope: 'blueprint-placements-only',
        constraints,
        placeablePrefixIds: order,
        blockedPlacementIds: placementIds
            .filter((id) => !placed.has(id))
            .sort((left, right) => comparePlacementIds(left, right, originalIndex)),
    };
}

function constructionConstraints(
    placements: readonly ResolvedBlueprintGridPlacement[]
): BlueprintConstructionConstraint[] {
    const constraints = new Map<string, BlueprintConstructionConstraint>();
    const occupiedByPlacementId = new Map(
        placements.map((placement) => [
            placement.id,
            new Set(placement.occupiedTiles.map(coordinateKey)),
        ])
    );
    for (const candidate of placements) {
        for (const corner of candidate.cornerObstacles) {
            for (const blocker of placements) {
                if (blocker.id === candidate.id || blocker.gridId !== candidate.gridId) continue;
                const occupied = occupiedByPlacementId.get(blocker.id)!;
                if (!corner.neighbouringTiles.every((tile) => occupied.has(coordinateKey(tile)))) continue;
                const constraint = {
                    beforePlacementId: candidate.id,
                    afterPlacementId: blocker.id,
                    gridId: candidate.gridId,
                    cornerTiles: corner.neighbouringTiles,
                };
                constraints.set(constraintKey(constraint), constraint);
            }
        }
    }
    return [...constraints.values()].sort((left, right) =>
        left.beforePlacementId.localeCompare(right.beforePlacementId) ||
        left.afterPlacementId.localeCompare(right.afterPlacementId) ||
        left.gridId.localeCompare(right.gridId) ||
        compareCoordinates(left.cornerTiles[0]!, right.cornerTiles[0]!)
    );
}

function sortPlacementIds(ids: string[], originalIndex: ReadonlyMap<string, number>): void {
    ids.sort((left, right) => comparePlacementIds(left, right, originalIndex));
}

function comparePlacementIds(
    left: string,
    right: string,
    originalIndex: ReadonlyMap<string, number>
): number {
    return originalIndex.get(left)! - originalIndex.get(right)! || left.localeCompare(right);
}

function constraintKey(constraint: BlueprintConstructionConstraint): string {
    return JSON.stringify([
        constraint.beforePlacementId,
        constraint.afterPlacementId,
        constraint.gridId,
        constraint.cornerTiles.map(coordinateKey),
    ]);
}

function coordinateKey(coordinate: BlueprintGridCoordinate): string {
    return `${coordinate.x},${coordinate.y}`;
}

function compareCoordinates(left: BlueprintGridCoordinate, right: BlueprintGridCoordinate): number {
    return left.x - right.x || left.y - right.y;
}
