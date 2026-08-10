import { describe, expect, it } from 'vitest';

import {
    BRICK_PRESS_OPERATION_RULES,
    PACKAGING_OPERATION_RULES,
    BlueprintProductionEndpointAccessAnalyzer,
    type BlueprintDocument,
    type BlueprintProductionEndpointAccessDataset,
    type Buildable,
    type Collider,
    type ColliderShape,
    type NavigationGraph,
    type ProductionCatalog,
    type Property,
    type PropertyLayout,
    type Transform,
    type Vector3,
} from '@neonschedule1/core';

const gameVersion = 'test';
const datasetSha256 = 'a'.repeat(64);

describe('blueprint production endpoint access', () => {
    it('attaches exact static clearance and a reachable employee route', () => {
        const result = analyzer().analyze(blueprint([
            placement('station', 'station', 0),
            placement('blocker', 'decoration', 1),
        ]));

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result).toMatchObject({
            staticClearanceProofStatus: 'exact',
            staticClearanceScope: 'blueprint-placements-and-property-fixed-geometry',
            staticClearanceLimitations: [],
            staticClearanceSufficiency: 'not-evaluated',
            employeeReachabilityBasis: {
                kind: 'property-spawn-to-production-transit-point',
                propertyCode: 'warehouse',
                propertyEmployeeCapacity: 1,
                origin: vector(0, 0, 0),
                navigationAgentTypeId: 7,
                navigationAgentName: 'Employee',
                navigationEmployeeTypes: ['Botanist', 'Chemist'],
                navigationAgentRadius: 0.35,
                navigationAgentHeight: 1.8,
                navigationAgentMaximumSlope: 45,
                navigationAgentStepHeight: 0.4,
                maximumStartSnapDistance: 2,
                maximumEndpointSnapDistance: 2,
                networkDistanceScope: 'navigation-graph-edges-only',
                endpointSnapTraversal: 'not-proven-walkable',
                navigationObstacleScope:
                    'normalized-navigation-graph-without-blueprint-placement-rebake',
            },
            productionTransferConnectivity: 'not-evaluated',
            itemFlowDirection: 'not-evaluated',
            dynamicObstacleClearance: 'not-evaluated',
            placements: [{
                placementId: 'station',
                itemId: 'station',
                transitAccessPoints: [{
                    accessPointIndex: 0,
                    transform: { path: 'TransitAccess', worldPosition: vector(2, 0, 0) },
                    staticClearance: {
                        placementId: 'station',
                        accessPointIndex: 0,
                        path: 'TransitAccess',
                        worldPosition: vector(2, 0, 0),
                        minimumClearance: 1,
                        nearestObstacles: [{ kind: 'placement', placementId: 'blocker' }],
                    },
                    employeeReachability: {
                        kind: 'reachable',
                        path: {
                            kind: 'found',
                            start: { sampleIndex: 0, snapDistance: 0, componentId: 0 },
                            end: { sampleIndex: 1, snapDistance: 0, componentId: 0 },
                            points: [{ sampleIndex: 0 }, { sampleIndex: 1 }],
                            networkDistance: 2,
                        },
                    },
                }],
            }],
        });
    });

    it('keeps incomplete static proof separate from employee reachability', () => {
        const result = analyzer({ fixedShape: 'sphere' }).analyze(blueprint([
            placement('station', 'station', 0),
        ]));

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.staticClearanceProofStatus).toBe('incomplete');
        expect(result.staticClearanceLimitations).toEqual([{
            code: 'unsupported-obstacle-geometry',
            placementId: 'station',
            accessPointIndex: 0,
            obstacle: { kind: 'property-fixed', index: 0, path: 'Fixed', shape: 'sphere' },
        }]);
        expect(result.placements[0]?.transitAccessPoints[0]).toMatchObject({
            staticClearance: { minimumClearance: null, nearestObstacles: [] },
            employeeReachability: { kind: 'reachable' },
        });
    });

    it('distinguishes an unreachable endpoint from a property with no employee capacity', () => {
        const unreachable = analyzer({
            endpointX: 6,
            navigationPositions: [vector(0, 0, 0)],
            navigationEdges: [],
        }).analyze(blueprint([placement('station', 'station', 0)]));
        expect(unreachable.kind).toBe('analyzed');
        if (unreachable.kind !== 'analyzed') return;
        expect(unreachable.placements[0]?.transitAccessPoints[0]?.employeeReachability)
            .toMatchObject({
                kind: 'unreachable',
                path: { kind: 'unreachable', reason: 'end-outside-reachable-network' },
            });

        const outsideNetwork = analyzer({ spawnX: 20 }).analyze(blueprint([
            placement('station', 'station', 0),
        ]));
        expect(outsideNetwork.kind).toBe('analyzed');
        if (outsideNetwork.kind !== 'analyzed') return;
        expect(outsideNetwork.placements[0]?.transitAccessPoints[0]?.employeeReachability)
            .toMatchObject({
                kind: 'unreachable',
                path: { kind: 'unreachable', reason: 'start-outside-network' },
            });

        const unavailable = analyzer({ employeeCapacity: 0 }).analyze(blueprint([
            placement('station', 'station', 0),
        ]));
        expect(unavailable.kind).toBe('analyzed');
        if (unavailable.kind !== 'analyzed') return;
        expect(unavailable.placements[0]?.transitAccessPoints[0]?.employeeReachability)
            .toEqual({
                kind: 'not-applicable',
                reason: 'property-has-no-employee-capacity',
            });
        expect(() => analyzer({ employeeCapacity: -1 }))
            .toThrow('employee capacity must be a non-negative safe integer');
    });

    it('preserves missing transit evidence and blueprint rejection', () => {
        const withoutPoint = analyzer({ missingTransitPoint: true }).analyze(blueprint([
            placement('station', 'station', 0),
        ]));
        expect(withoutPoint.kind).toBe('analyzed');
        if (withoutPoint.kind !== 'analyzed') return;
        expect(withoutPoint.staticClearanceProofStatus).toBe('incomplete');
        expect(withoutPoint.staticClearanceLimitations).toEqual([{
            code: 'missing-transit-access-points',
            placementId: 'station',
            accessPointIndex: null,
            obstacle: null,
        }]);
        expect(withoutPoint.placements[0]?.transitAccessPoints).toEqual([]);

        const rejected = analyzer().analyze(blueprint([
            placement('station', 'station', 99),
        ]));
        expect(rejected).toMatchObject({
            kind: 'rejected',
            staticClearanceProofStatus: 'not-applicable',
            employeeReachabilityBasis: 'not-applicable',
            placements: [],
        });
    });
});

interface AnalyzerOptions {
    readonly endpointX?: number;
    readonly employeeCapacity?: number;
    readonly fixedShape?: ColliderShape | null;
    readonly missingTransitPoint?: boolean;
    readonly spawnX?: number;
    readonly navigationPositions?: readonly Vector3[];
    readonly navigationEdges?: readonly (readonly [number, number])[];
}

function analyzer(options: AnalyzerOptions = {}): BlueprintProductionEndpointAccessAnalyzer {
    return new BlueprintProductionEndpointAccessAnalyzer(dataset(options));
}

function dataset(options: AnalyzerOptions): BlueprintProductionEndpointAccessDataset {
    const endpointX = options.endpointX ?? 2;
    return {
        manifest: { gameVersion, datasetSha256 },
        properties: [property(options.employeeCapacity ?? 1)],
        buildables: [
            buildable(
                'station',
                true,
                options.missingTransitPoint ? [] : [transform('TransitAccess', endpointX)]
            ),
            buildable('decoration', true, []),
        ],
        propertyLayouts: [propertyLayout(options.fixedShape ?? null, options.spawnX ?? 0)],
        production: production(),
        navigation: navigation(
            options.navigationPositions ?? [vector(0, 0, 0), vector(2, 0, 0)],
            options.navigationEdges ?? [[0, 1]]
        ),
    };
}

function blueprint(placements: BlueprintDocument['placements']): BlueprintDocument {
    return {
        schema: 'neonschedule1-blueprint-3',
        gameVersion,
        datasetSha256,
        propertyCode: 'warehouse',
        productionLogistics: { employees: [], supplies: [] },
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

function buildable(
    itemId: string,
    isTransitEntity: boolean,
    transitAccessPoints: Transform[]
): Buildable {
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
            boundingCollider: collider('Bounds', vector(0, 0, 0), 'box'),
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
        isTransitEntity,
        transitAccessPoints,
        proceduralTiles: [],
        visuals: { renderers: [], meshes: [] },
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

function propertyLayout(fixedShape: ColliderShape | null, spawnX: number): PropertyLayout {
    return {
        schema: 'neonschedule1-property-layout-4',
        propertyCode: 'warehouse',
        propertyName: 'Warehouse',
        worldPosition: vector(0, 0, 0),
        worldRotation: vector(0, 0, 0),
        spawnPoint: transform('Spawn', spawnX),
        interiorSpawnPoint: transform('InteriorSpawn', 0),
        npcSpawnPoint: transform('NpcSpawn', 0),
        boundingBox: null,
        boundaryColliders: [],
        fixedColliders: fixedShape === null
            ? []
            : [collider('Fixed', vector(2, 0, 0), fixedShape)],
        surfaceMeshes: [],
        surfaces: [],
        proceduralTiles: [],
        loadingDocks: [],
        grids: [{
            id: 'main',
            width: 2,
            height: 1,
            tileSize: 4,
            worldOrigin: vector(0, 0, 0),
            tiles: [0, 1].map((x) => ({
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

function dryingRules(): ProductionCatalog['drying'] {
    return {
        schema: 'neonschedule1-drying-operation-rules-1',
        requiresUnpackagedProduct: true,
        acceptedProductDrugTypes: ['Cocaine', 'Marijuana', 'Methamphetamine'],
        specialQualityItemIdSubstring: 'cocaleaf',
        specialItemRequiresQualityInstance: true,
        maximumQualityTier: 'Heavenly',
        itemIdTransformation: 'preserved',
        quantityTransformation: 'preserved',
        qualityTierIncrement: 1,
    };
}

function production(): ProductionCatalog {
    return {
        schema: 'neonschedule1-production-catalog-8',
        drying: dryingRules(),
        packaging: { ...PACKAGING_OPERATION_RULES },
        brickPressing: { ...BRICK_PRESS_OPERATION_RULES },
        quality: {
            basePlantLevel: 0.5,
            monetaryValueVariesByQuality: false,
            customerQualityMaxEffect: 0.3,
            tiers: [{ name: 'Standard', minimumLevelExclusive: null, customerScalar: 0.5 }],
        },
        seeds: [],
        shrooms: [],
        stationRecipes: [],
        ovenTransforms: [],
        stations: [{
            schema: 'neonschedule1-production-station-3',
            itemId: 'station',
            kind: 'grow-container',
            yieldMultiplier: 1,
            growSpeedMultiplier: 1,
            requiresExternalGrowLight: true,
            maxTemperatureGrowthMultiplier: 1.5,
            minimumTemperatureThreshold: 20,
            maximumTemperatureThreshold: 40,
            allowedSoilIds: [],
            allowedAdditiveIds: [],
        }],
    };
}

function navigation(
    positions: readonly Vector3[],
    edges: readonly (readonly [number, number])[]
): NavigationGraph {
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
        edges: edges.map(([sampleA, sampleB]) => ({ sampleA, sampleB })),
    };
}

function collider(path: string, position: Vector3, shape: ColliderShape): Collider {
    const size = vector(2, 2, 2);
    return {
        source: 'fixture',
        runtimeType: `UnityEngine.${shape}Collider`,
        shape,
        enabled: true,
        isTrigger: false,
        layer: 0,
        layerName: 'Default',
        tag: 'Untagged',
        transform: transform(path, position.x, position),
        worldScale: vector(1, 1, 1),
        worldBasis: {
            right: vector(1, 0, 0),
            up: vector(0, 1, 0),
            forward: vector(0, 0, 1),
        },
        worldBounds: { center: position, size },
        localCenter: shape === 'box' ? vector(0, 0, 0) : null,
        localSize: shape === 'box' ? size : null,
        radius: shape === 'sphere' ? 1 : null,
        height: null,
        direction: null,
        meshName: null,
        meshId: null,
        meshIsReadable: null,
        isConvex: null,
    };
}

function transform(path: string, x: number, worldPosition = vector(x, 0, 0)): Transform {
    return {
        name: path,
        path,
        worldPosition,
        localPosition: vector(x, 0, 0),
        worldRotation: vector(0, 0, 0),
        localScale: vector(1, 1, 1),
    };
}

function vector(x: number, y: number, z: number): Vector3 {
    return { x, y, z };
}
