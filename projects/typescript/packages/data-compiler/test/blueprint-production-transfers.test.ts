import { describe, expect, it } from 'vitest';

import {
    BlueprintProductionTransferAnalyzer,
    type BlueprintDocument,
    type BlueprintProductionEndpointAccessDataset,
    type Buildable,
    type Collider,
    type NavigationGraph,
    type ProductionBatchPlan,
    type ProductionCatalog,
    type Property,
    type PropertyLayout,
    type Transform,
    type Vector3,
} from '@neonschedule1/core';

const gameVersion = 'test';
const datasetSha256 = 'a'.repeat(64);

describe('blueprint production transfers', () => {
    it('derives conserved dependency quantities and every network route candidate', () => {
        const result = analyzer().analyze(layoutBlueprint(), plan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result).toMatchObject({
            quantityBasis: 'production-plan-and-scheduled-batch-assignments',
            sourceSupplyScope: 'producer-assignment-output-before-transfer-allocation',
            routeCandidateBasis: 'network-paths-between-endpoint-access-navigation-samples',
            quantityAllocation: 'not-evaluated',
            networkRouteSelection: 'not-evaluated',
            transferFeasibility: 'not-evaluated',
            endpointSnapTraversal: 'not-proven-walkable',
            staticClearanceSufficiency: 'not-evaluated',
            dynamicObstacleClearance: 'not-evaluated',
            transferTiming: 'not-evaluated',
            supplies: [
                {
                    producerStepIndex: 0,
                    itemId: 'intermediate',
                    producedQuantity: 6,
                    downstreamRequiredQuantity: 4,
                    targetRequiredQuantity: 0,
                    leftoverQuantity: 2,
                    assignments: [
                        { placementId: 'source-a', batchCount: 1, producedQuantity: 3 },
                        { placementId: 'source-b', batchCount: 1, producedQuantity: 3 },
                    ],
                },
                {
                    producerStepIndex: 1,
                    itemId: 'final',
                    producedQuantity: 2,
                    downstreamRequiredQuantity: 0,
                    targetRequiredQuantity: 2,
                    leftoverQuantity: 0,
                    assignments: [
                        { placementId: 'destination-a', batchCount: 1, producedQuantity: 1 },
                        { placementId: 'destination-b', batchCount: 1, producedQuantity: 1 },
                    ],
                },
            ],
            requirements: [{
                itemId: 'intermediate',
                producerStepIndex: 0,
                consumerStepIndex: 1,
                consumerInputIndexes: [0, 1],
                quantityPerConsumerBatch: 2,
                requiredQuantity: 4,
                destinationAssignments: [
                    { placementId: 'destination-a', batchCount: 1, requiredQuantity: 2 },
                    { placementId: 'destination-b', batchCount: 1, requiredQuantity: 2 },
                ],
            }],
        });
        const pairs = result.requirements[0]?.assignmentPairs;
        expect(pairs).toHaveLength(4);
        expect(pairs?.map((pair) => ({
            source: pair.sourcePlacementId,
            destination: pair.destinationPlacementId,
            sourceProducedQuantity: pair.sourceProducedQuantity,
            destinationRequiredQuantity: pair.destinationRequiredQuantity,
            status: pair.networkRouteCandidateStatus,
            routeCount: pair.networkRouteCandidates.length,
            distance: pair.networkRouteCandidates[0]?.path.networkDistance,
        }))).toEqual([
            {
                source: 'source-a',
                destination: 'destination-a',
                sourceProducedQuantity: 3,
                destinationRequiredQuantity: 2,
                status: 'available',
                routeCount: 1,
                distance: 8,
            },
            {
                source: 'source-a',
                destination: 'destination-b',
                sourceProducedQuantity: 3,
                destinationRequiredQuantity: 2,
                status: 'available',
                routeCount: 1,
                distance: 12,
            },
            {
                source: 'source-b',
                destination: 'destination-a',
                sourceProducedQuantity: 3,
                destinationRequiredQuantity: 2,
                status: 'available',
                routeCount: 1,
                distance: 4,
            },
            {
                source: 'source-b',
                destination: 'destination-b',
                sourceProducedQuantity: 3,
                destinationRequiredQuantity: 2,
                status: 'available',
                routeCount: 1,
                distance: 8,
            },
        ]);
        expect(pairs?.[0]?.networkRouteCandidates[0]).toMatchObject({
            sourcePlacementId: 'source-a',
            sourceAccessPointIndex: 0,
            sourceNetworkEndpoint: { sampleIndex: 1, snapDistance: 0, componentId: 0 },
            destinationPlacementId: 'destination-a',
            destinationAccessPointIndex: 0,
            destinationNetworkEndpoint: { sampleIndex: 3, snapDistance: 0, componentId: 0 },
            path: {
                kind: 'found',
                points: [{ sampleIndex: 1 }, { sampleIndex: 2 }, { sampleIndex: 3 }],
            },
        });
    });

    it('enumerates every reachable endpoint pairing without selecting one', () => {
        const result = analyzer({ multipleTransitPoints: true })
            .analyze(layoutBlueprint(), plan());

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        const pair = result.requirements[0]?.assignmentPairs.find((candidate) =>
            candidate.sourcePlacementId === 'source-a' &&
            candidate.destinationPlacementId === 'destination-a'
        );
        expect(pair?.networkRouteCandidates.map((candidate) => [
            candidate.sourceAccessPointIndex,
            candidate.destinationAccessPointIndex,
        ])).toEqual([
            [0, 0],
            [0, 1],
            [1, 0],
            [1, 1],
        ]);
    });

    it('reports assignment pairs without network-reachable transit endpoints', () => {
        const missingSource = analyzer({ missingSourceTransitPoint: true })
            .analyze(layoutBlueprint(), plan());
        expect(missingSource.kind).toBe('analyzed');
        if (missingSource.kind !== 'analyzed') return;
        expect(missingSource.requirements[0]?.assignmentPairs[0]).toMatchObject({
            networkRouteCandidateStatus: 'unavailable',
            unavailableReasons: ['source-has-no-network-reachable-transit-point'],
            networkRouteCandidates: [],
        });

        const noEmployees = analyzer({ employeeCapacity: 0 })
            .analyze(layoutBlueprint(), plan());
        expect(noEmployees.kind).toBe('analyzed');
        if (noEmployees.kind !== 'analyzed') return;
        expect(noEmployees.requirements[0]?.assignmentPairs[0]).toMatchObject({
            networkRouteCandidateStatus: 'unavailable',
            unavailableReasons: [
                'source-has-no-network-reachable-transit-point',
                'destination-has-no-network-reachable-transit-point',
            ],
            networkRouteCandidates: [],
        });
    });

    it('preserves schedule unavailability and blueprint rejection without transfers', () => {
        const unavailable = analyzer().analyze(blueprint([
            placement('source-a', 'source-station', 0),
        ]), plan());
        expect(unavailable).toMatchObject({
            kind: 'unavailable',
            supplies: [],
            requirements: [],
        });

        const rejected = analyzer().analyze(blueprint([
            placement('source-a', 'source-station', 99),
            placement('destination-a', 'destination-station', 2),
        ]), plan());
        expect(rejected).toMatchObject({
            kind: 'rejected',
            supplies: [],
            requirements: [],
        });
    });

    it('keeps a purchased-input target as external output without a transfer requirement', () => {
        const input = plan();
        const target = input.productionSteps[1]!;
        const result = analyzer().analyze(blueprint([
            placement('destination-a', 'destination-station', 2),
            placement('destination-b', 'destination-station', 3),
        ]), {
            ...input,
            totalProcessMinutes: target.totalProcessMinutes,
            productionSteps: [target],
        });

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.supplies).toMatchObject([{
            producerStepIndex: 0,
            itemId: 'final',
            downstreamRequiredQuantity: 0,
            targetRequiredQuantity: 2,
            producedQuantity: 2,
            leftoverQuantity: 0,
        }]);
        expect(result.requirements).toEqual([]);
    });

    it('rejects inconsistent produced, required, and leftover quantities', () => {
        const input = plan();
        const source = input.productionSteps[0]!;
        const target = input.productionSteps[1]!;
        const analyze = (changedSource: typeof source): void => {
            analyzer().analyze(layoutBlueprint(), {
                ...input,
                productionSteps: [changedSource, target],
            });
        };

        expect(() => analyze({ ...source, producedQuantity: 7 }))
            .toThrow('produced quantity is inconsistent');
        expect(() => analyze({ ...source, requiredQuantity: 5, leftoverQuantity: 1 }))
            .toThrow('required quantity conservation is inconsistent');
        expect(() => analyze({ ...source, leftoverQuantity: 1 }))
            .toThrow('leftover quantity is inconsistent');
    });
});

interface DatasetOptions {
    readonly employeeCapacity?: number;
    readonly missingSourceTransitPoint?: boolean;
    readonly multipleTransitPoints?: boolean;
}

function analyzer(options: DatasetOptions = {}): BlueprintProductionTransferAnalyzer {
    return new BlueprintProductionTransferAnalyzer(dataset(options));
}

function plan(): ProductionBatchPlan {
    return {
        dataset: { gameVersion, datasetSha256 },
        targetItemId: 'final',
        targetQuantity: 2,
        totalProcessMinutes: 10,
        requiredMaterialCost: 0,
        purchaseCost: 0,
        purchases: [],
        productionSteps: [
            {
                itemId: 'intermediate',
                routeId: 'recipe:intermediate',
                method: 'station-recipe',
                requiredQuantity: 4,
                batchCount: 2,
                outputQuantityPerBatch: 3,
                durationMinutesPerBatch: 2,
                acceptedEquipmentItemIds: ['source-station'],
                equipmentItemId: 'source-station',
                growLightItemId: null,
                additiveItemIds: [],
                quality: null,
                totalProcessMinutes: 4,
                producedQuantity: 6,
                leftoverQuantity: 2,
                inputs: [{ itemId: 'raw', quantityPerBatch: 1, totalQuantity: 2 }],
            },
            {
                itemId: 'final',
                routeId: 'recipe:final',
                method: 'station-recipe',
                requiredQuantity: 2,
                batchCount: 2,
                outputQuantityPerBatch: 1,
                durationMinutesPerBatch: 3,
                acceptedEquipmentItemIds: ['destination-station'],
                equipmentItemId: 'destination-station',
                growLightItemId: null,
                additiveItemIds: [],
                quality: null,
                totalProcessMinutes: 6,
                producedQuantity: 2,
                leftoverQuantity: 0,
                inputs: [
                    { itemId: 'intermediate', quantityPerBatch: 1, totalQuantity: 2 },
                    { itemId: 'intermediate', quantityPerBatch: 1, totalQuantity: 2 },
                ],
            },
        ],
    };
}

function layoutBlueprint(): BlueprintDocument {
    return blueprint([
        placement('source-b', 'source-station', 1),
        placement('destination-b', 'destination-station', 3),
        placement('source-a', 'source-station', 0),
        placement('destination-a', 'destination-station', 2),
    ]);
}

function blueprint(placements: BlueprintDocument['placements']): BlueprintDocument {
    return {
        schema: 'neonschedule1-blueprint-1',
        gameVersion,
        datasetSha256,
        propertyCode: 'warehouse',
        placements,
    };
}

function placement(
    id: string,
    itemId: string,
    x: number
): BlueprintDocument['placements'][number] {
    return { id, kind: 'grid', itemId, gridId: 'main', anchor: { x, y: 0 }, rotation: 0 };
}

function dataset(options: DatasetOptions): BlueprintProductionEndpointAccessDataset {
    const transitAccessPoints = options.multipleTransitPoints
        ? [transform('TransitAccess/[0]', 1), transform('TransitAccess/[1]', 1.5)]
        : [transform('TransitAccess', 1)];
    return {
        manifest: { gameVersion, datasetSha256 },
        properties: [property(options.employeeCapacity ?? 2)],
        buildables: [
            buildable(
                'source-station',
                options.missingSourceTransitPoint ? [] : transitAccessPoints
            ),
            buildable('destination-station', transitAccessPoints),
        ],
        propertyLayouts: [propertyLayout()],
        production: production(),
        navigation: navigation(),
    };
}

function production(): ProductionCatalog {
    return {
        schema: 'neonschedule1-production-catalog-5',
        quality: {
            basePlantLevel: 0.5,
            monetaryValueVariesByQuality: false,
            customerQualityMaxEffect: 0.3,
            tiers: [{ name: 'Standard', minimumLevelExclusive: null, customerScalar: 0.5 }],
        },
        seeds: [],
        shrooms: [],
        stationRecipes: [
            {
                schema: 'neonschedule1-station-recipe-2',
                id: 'intermediate',
                title: 'Intermediate',
                cookTimeMinutes: 2,
                cookTemperature: 100,
                cookTemperatureTolerance: 10,
                qualityCalculationMethod: 'Additive',
                acceptedEquipmentItemIds: ['source-station'],
                ingredients: [{ quantity: 1, acceptedItemIds: ['raw'] }],
                outputItemId: 'intermediate',
                outputQuantity: 3,
            },
            {
                schema: 'neonschedule1-station-recipe-2',
                id: 'final',
                title: 'Final',
                cookTimeMinutes: 3,
                cookTemperature: 100,
                cookTemperatureTolerance: 10,
                qualityCalculationMethod: 'Additive',
                acceptedEquipmentItemIds: ['destination-station'],
                ingredients: [
                    { quantity: 1, acceptedItemIds: ['intermediate'] },
                    { quantity: 1, acceptedItemIds: ['intermediate'] },
                ],
                outputItemId: 'final',
                outputQuantity: 1,
            },
        ],
        ovenTransforms: [],
        stations: [],
    };
}

function property(employeeCapacity: number): Property {
    return {
        schema: 'neonschedule1-property-1',
        code: 'warehouse',
        name: 'Warehouse',
        price: 0,
        employeeCapacity,
        loadingDockCount: 0,
        gridCount: 1,
        ambientTemperature: 20,
        ownedByDefault: false,
        position: vector(0, 0, 0),
        business: null,
        hasLayout: true,
    };
}

function buildable(itemId: string, transitAccessPoints: Transform[]): Buildable {
    return {
        schema: 'neonschedule1-buildable-4',
        itemId,
        runtimeType: 'Game.GridItem',
        placement: {
            kind: 'grid',
            holdDistance: 3,
            footprintWidth: 1,
            footprintHeight: 1,
            proceduralTileType: null,
            tileSharingRule: 'standard',
            tileSharingImplementation: 'Game.GridItem',
            allowRotation: null,
            rotationIncrement: null,
            validSurfaceTypes: [],
            buildPoint: transform('BuildPoint', 0),
            midAirCenterPoint: null,
            boundingCollider: collider(),
            footprintTiles: [{
                x: 0,
                y: 0,
                requiredOffset: 0,
                transform: transform('Footprint/[0,0]', 0),
                cornerObstacles: [],
            }],
        },
        componentTypes: [],
        colliders: [],
        storage: null,
        temperatureEmitters: [],
        interactionPoints: [],
        isTransitEntity: true,
        transitAccessPoints,
        proceduralTiles: [],
        visuals: { renderers: [], meshes: [] },
    };
}

function propertyLayout(): PropertyLayout {
    return {
        schema: 'neonschedule1-property-layout-4',
        propertyCode: 'warehouse',
        propertyName: 'Warehouse',
        worldPosition: vector(0, 0, 0),
        worldRotation: vector(0, 0, 0),
        spawnPoint: transform('Spawn', 0),
        interiorSpawnPoint: transform('InteriorSpawn', 0),
        npcSpawnPoint: transform('NpcSpawn', 0),
        boundingBox: null,
        boundaryColliders: [],
        fixedColliders: [],
        surfaceMeshes: [],
        surfaces: [],
        proceduralTiles: [],
        loadingDocks: [],
        grids: [{
            id: 'main',
            width: 4,
            height: 1,
            tileSize: 4,
            worldOrigin: vector(0, 0, 0),
            tiles: Array.from({ length: 4 }, (_, x) => ({
                x,
                y: 0,
                availableOffset: 0,
                worldPosition: vector(4 * x, 0, 0),
                worldRotation: vector(0, 0, 0),
            })),
        }],
        visuals: { renderers: [], meshes: [] },
    };
}

function navigation(): NavigationGraph {
    const positions = [0, 1, 5, 9, 13].map((x) => vector(x, 0, 0));
    return {
        schema: 'neonschedule1-navigation-graph-2',
        method: 'test',
        agent: {
            source: 'employee-prefabs',
            typeId: 7,
            name: 'Employee',
            radius: 0.35,
            height: 1.8,
            maximumSlope: 45,
            stepHeight: 0.4,
            employeeTypes: ['Botanist', 'Chemist'],
        },
        sampleSpacing: 2,
        queryHeight: 0,
        maxSampleDistance: 12,
        boundsMinimum: vector(-20, -20, -20),
        boundsMaximum: vector(20, 20, 20),
        gridWidth: positions.length,
        gridHeight: 1,
        samples: positions.map((position, index) => ({
            gridX: index,
            gridZ: 0,
            position,
            areaMask: 1,
        })),
        edges: positions.slice(1).map((_, index) => ({ sampleA: index, sampleB: index + 1 })),
    };
}

function collider(): Collider {
    const zero = vector(0, 0, 0);
    const one = vector(1, 1, 1);
    return {
        source: 'fixture',
        runtimeType: 'UnityEngine.BoxCollider',
        shape: 'box',
        enabled: true,
        isTrigger: false,
        layer: 0,
        layerName: 'Default',
        tag: 'Untagged',
        transform: transform('Bounds', 0),
        worldScale: one,
        worldBasis: { right: vector(1, 0, 0), up: vector(0, 1, 0), forward: vector(0, 0, 1) },
        worldBounds: { center: zero, size: one },
        localCenter: zero,
        localSize: one,
        radius: null,
        height: null,
        direction: null,
        meshName: null,
        meshId: null,
        meshIsReadable: null,
        isConvex: null,
    };
}

function transform(path: string, x: number): Transform {
    return {
        name: path,
        path,
        worldPosition: vector(x, 0, 0),
        localPosition: vector(x, 0, 0),
        worldRotation: vector(0, 0, 0),
        localScale: vector(1, 1, 1),
    };
}

function vector(x: number, y: number, z: number): Vector3 {
    return { x, y, z };
}
