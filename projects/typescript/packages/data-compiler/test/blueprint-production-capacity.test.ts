import { describe, expect, it } from 'vitest';

import {
    BRICK_PRESS_OPERATION_RULES,
    PACKAGING_OPERATION_RULES,
    BlueprintProductionCapacityAnalyzer,
    BlueprintProductionScheduleAnalyzer,
    ProductionBatchPlanner,
    ProductionMaterialCostEvaluator,
    type BlueprintDocument,
    type BlueprintProductionCapacityDataset,
    type Buildable,
    type Collider,
    type Item,
    type ProductionBatchPlan,
    type ProductionCatalog,
    type Property,
    type PropertyLayout,
    type Transform,
    type Vector3,
} from '@neonschedule1/core';

const gameVersion = '0.4.6f12';
const datasetSha256 = 'a'.repeat(64);

describe('blueprint production capacity', () => {
    it('reports installed equipment, process records, explicit limits, and tile temperatures', () => {
        const result = analyzer().analyze(blueprint([
            placement('cooler', 'cooler', 0),
            placement('pot', 'pot', 1),
            placement('dryer', 'dryer', 2),
            placement('mixer-two', 'mixer', 4),
            placement('mixer-one', 'mixer', 3),
            placement('chemistry', 'chemistry', 5),
            placement('mushroom-bed', 'mushroom-bed', 6),
            placement('decoration', 'decoration', 7),
        ]));

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.capacityScope).toBe('installed-production-equipment');
        expect(result.processValues).toBe('normalized-records');
        expect(result.parallelScheduling).toBe('not-evaluated');
        expect(result.effectiveTemperature).toBe('native-distance-weighted-tile-average');
        expect(result.equipment.map((entry) => entry.itemId)).toEqual([
            'chemistry',
            'dryer',
            'mixer',
            'mushroom-bed',
            'pot',
        ]);

        const pot = result.equipment.find((entry) => entry.itemId === 'pot')!;
        expect(pot).toMatchObject({
            installedUnitCount: 1,
            itemLimitPerUnit: null,
            installedItemLimit: null,
            processes: [{
                id: 'seed:seed:leaf',
                kind: 'seed-harvest',
                inputItemIds: ['seed', 'soil'],
                outputItemId: 'leaf',
                recordedOutputQuantity: 10,
                recordedItemLimit: null,
                recordedDuration: { kind: 'fixed', minutes: 60 },
                temperatureRule: {
                    kind: 'environmental-performance-range',
                    minimumTemperature: 20,
                    maximumTemperature: 40,
                    maximumMultiplier: 1.5,
                },
            }],
        });
        expect(pot.placements[0]?.temperature).toEqual({
            kind: 'property-grid-tiles',
            coverageProofStatus: 'exact',
            temperatureCombination: 'native-distance-weighted-emitter-blend',
            averageTemperature: 20,
            tiles: [{
                gridId: 'main',
                x: 1,
                y: 0,
                ambientTemperature: 20,
                effectiveTemperature: 20,
                sources: [{
                    placementId: 'cooler',
                    emitterIndex: 0,
                    temperature: 0,
                    distance: 2,
                    influence: 0,
                }],
            }],
        });

        const dryer = result.equipment.find((entry) => entry.itemId === 'dryer')!;
        expect(dryer).toMatchObject({
            installedUnitCount: 1,
            itemLimitPerUnit: 20,
            installedItemLimit: 20,
            processes: [{
                id: 'drying-rack:dryer',
                kind: 'drying-rack',
                recordedItemLimit: 20,
                recordedDuration: { kind: 'per-tier', minutes: 720 },
                temperatureRule: {
                    kind: 'environmental-performance-range',
                    minimumTemperature: 20,
                    maximumTemperature: 40,
                    maximumMultiplier: 1.5,
                },
            }],
        });
        expect(dryer.placements[0]?.temperature).toMatchObject({
            tiles: [{ x: 2, ambientTemperature: 20, sources: [] }],
        });

        const mixer = result.equipment.find((entry) => entry.itemId === 'mixer')!;
        expect(mixer).toMatchObject({
            installedUnitCount: 2,
            itemLimitPerUnit: 10,
            installedItemLimit: 20,
            placements: [
                { placementId: 'mixer-two' },
                { placementId: 'mixer-one' },
            ],
            processes: [{
                id: 'mixing:mixer',
                kind: 'mixing',
                recordedItemLimit: 10,
                recordedDuration: { kind: 'per-item', minutes: 6 },
            }],
        });

        const chemistry = result.equipment.find((entry) => entry.itemId === 'chemistry')!;
        expect(chemistry).toMatchObject({
            station: null,
            processes: [{
                id: 'recipe:liquid',
                kind: 'station-recipe',
                outputItemId: 'liquid',
                recordedOutputQuantity: 1,
                recordedDuration: { kind: 'fixed', minutes: 10 },
                temperatureRule: {
                    kind: 'internal-cook-setpoint',
                    temperature: 180,
                    tolerance: 25,
                },
            }],
        });

        const bed = result.equipment.find((entry) => entry.itemId === 'mushroom-bed')!;
        expect(bed).toMatchObject({
            station: null,
            processes: [{
                id: 'shroom:spawn:shroom',
                kind: 'shroom-harvest',
                outputItemId: 'shroom',
                recordedOutputQuantity: 16,
                recordedDuration: { kind: 'fixed', minutes: 1_080 },
                temperatureRule: {
                    kind: 'environmental-maximum',
                    maximumTemperature: 15,
                },
            }],
        });
    });

    it('reports brick pressing as a one-output transform without a packaging-material input', () => {
        const result = analyzer().analyze(blueprint([
            placement('brick-press', 'brick-press', 0),
        ]));

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.equipment).toHaveLength(1);
        expect(result.equipment[0]).toMatchObject({
            itemId: 'brick-press',
            processes: [{
                id: 'brick-press:brick-press',
                kind: 'brick-press',
                inputItemIds: [],
                outputItemId: null,
                recordedOutputQuantity: 1,
                recordedItemLimit: null,
                recordedDuration: { kind: 'not-recorded' },
            }],
        });
    });

    it('preserves blueprint rejection without reporting production capacity', () => {
        const result = analyzer().analyze(blueprint([
            placement('pot', 'pot', 99),
        ]));

        expect(result.kind).toBe('rejected');
        expect(result.equipment).toEqual([]);
        expect(result.temperature.kind).toBe('rejected');
    });

    it('combines overlapping emitters into the production placement temperature', () => {
        const source = dataset();
        const result = new BlueprintProductionCapacityAnalyzer({
            ...source,
            buildables: [
                ...source.buildables.map((entry) => entry.itemId === 'cooler'
                    ? buildable('cooler', [{
                        temperature: 0,
                        range: 4,
                        emissionPoint: vector(0, 0, 0),
                    }])
                    : entry),
                buildable('heater', [{
                    temperature: 30,
                    range: 4,
                    emissionPoint: vector(0, 0, 0),
                }]),
            ],
        }).analyze(blueprint([
            placement('cooler', 'cooler', 0),
            placement('pot', 'pot', 1),
            placement('heater', 'heater', 2),
        ]));

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.effectiveTemperature).toBe('native-distance-weighted-tile-average');
        expect(result.equipment[0]?.placements[0]?.temperature).toMatchObject({
            temperatureCombination: 'native-distance-weighted-emitter-blend',
            averageTemperature: 15,
            tiles: [{
                x: 1,
                effectiveTemperature: 15,
                sources: [
                    { placementId: 'cooler', temperature: 0, distance: 2, influence: 0.75 },
                    { placementId: 'heater', temperature: 30, distance: 2, influence: 0.75 },
                ],
            }],
        });
    });

    it('averages effective temperature across every occupied footprint tile', () => {
        const source = dataset();
        const pot = source.buildables.find((entry) => entry.itemId === 'pot')!;
        if (pot.placement.kind !== 'grid') throw new Error('Test pot must use grid placement');
        const footprint = pot.placement.footprintTiles[0]!;
        const result = new BlueprintProductionCapacityAnalyzer({
            ...source,
            buildables: source.buildables.map((entry) => {
                if (entry.itemId === 'cooler') {
                    return buildable('cooler', [{
                        temperature: 0,
                        range: 4,
                        emissionPoint: vector(0, 0, 0),
                    }]);
                }
                if (entry.itemId !== 'pot') return entry;
                return {
                    ...pot,
                    placement: {
                        ...pot.placement,
                        footprintWidth: 2,
                        footprintTiles: [
                            footprint,
                            {
                                ...footprint,
                                x: 1,
                                transform: transform('Footprint/[1,0]'),
                            },
                        ],
                    },
                };
            }),
        }).analyze(blueprint([
            placement('cooler', 'cooler', 0),
            placement('pot', 'pot', 1),
        ]));

        expect(result.kind).toBe('analyzed');
        if (result.kind !== 'analyzed') return;
        expect(result.equipment[0]?.placements[0]?.temperature).toMatchObject({
            averageTemperature: 12.5,
            tiles: [
                { x: 1, effectiveTemperature: 5 },
                { x: 2, effectiveTemperature: 20 },
            ],
        });
    });

    it('rejects duplicate production station identities', () => {
        const source = dataset();
        const pot = source.production.stations.find((station) => station.itemId === 'pot')!;

        expect(() => new BlueprintProductionCapacityAnalyzer({
            ...source,
            production: {
                ...source.production,
                stations: [...source.production.stations, pot],
            },
        })).toThrow('duplicate production station item ID "pot"');

        expect(() => new BlueprintProductionCapacityAnalyzer({
            ...source,
            production: {
                ...source.production,
                stations: source.production.stations.map((station) =>
                    station.kind === 'grow-container'
                        ? { ...station, maximumTemperatureThreshold: 10 }
                        : station
                ),
            },
        })).toThrow('Grow-container minimum temperature must be below its maximum');
    });

    it('schedules whole batches across installed units within each production step', () => {
        const result = new BlueprintProductionScheduleAnalyzer(dataset()).analyze(
            blueprint([
                placement('pot-b', 'pot', 1),
                placement('chemistry', 'chemistry', 2),
                placement('pot-a', 'pot', 0),
                placement('light', 'light', 7),
            ]),
            schedulePlan()
        );

        expect(result.kind).toBe('scheduled');
        if (result.kind !== 'scheduled') return;
        expect(result).toMatchObject({
            durationBasis: 'production-batch-plan-with-native-temperature-rate',
            schedulingAlgorithm: 'deterministic-critical-path-list-scheduling',
            optimality: 'not-proven',
            parallelScheduling: 'non-overlapping-whole-batch-equipment-calendars',
            crossStepConcurrency: 'production-dependency-and-equipment-constrained',
            batchPipelining: 'cumulative-plan-order-produced-quantity',
            routing: 'not-evaluated',
            employeeScheduling: 'not-evaluated-no-task-duration-contract',
            lightingCoverage: 'native-matched-standard-tile-exposure-with-conditional-partial-duration',
            effectiveTemperature: 'native-distance-weighted-tile-average',
            temperatureDuration: 'native-capped-linear-process-rate',
            constraintStatus: 'conditional',
            baseSerialProcessMinutes: 350,
            serialProcessMinutes: 350,
            temperatureTimeSavedMinutes: 0,
            scheduledElapsedMinutes: 190,
            parallelTimeSavedMinutes: 160,
            schedule: [
                {
                    stepIndex: 0,
                    itemId: 'leaf',
                    equipmentItemId: 'pot',
                    installedUnitCount: 2,
                    usedUnitCount: 2,
                    batchCount: 5,
                    durationMinutesPerBatch: 60,
                    startMinute: 0,
                    endMinute: 180,
                    elapsedMinutes: 180,
                    constraintStatus: 'conditional',
                    assignments: [
                        {
                            placementId: 'pot-a',
                            batchNumbers: [1, 3, 5],
                            batchCount: 3,
                            lighting: {
                                kind: 'selected-external-grow-light',
                                growLightItemId: 'light',
                                installedPlacementIds: ['light'],
                                physicalCoverage: 'not-evaluated',
                            },
                            temperature: {
                                kind: 'satisfied',
                                basis: 'native-effective-temperature',
                                ambientTemperature: 20,
                                effectiveTemperature: 20,
                                processMultiplier: 1,
                            },
                        },
                        {
                            placementId: 'pot-b',
                            batchNumbers: [2, 4],
                            batchCount: 2,
                        },
                    ],
                    batches: [
                        { batchNumber: 1, placementId: 'pot-a', startMinute: 0, endMinute: 60 },
                        { batchNumber: 2, placementId: 'pot-b', startMinute: 0, endMinute: 60 },
                        { batchNumber: 3, placementId: 'pot-a', startMinute: 60, endMinute: 120 },
                        { batchNumber: 4, placementId: 'pot-b', startMinute: 60, endMinute: 120 },
                        { batchNumber: 5, placementId: 'pot-a', startMinute: 120, endMinute: 180 },
                    ],
                },
                {
                    stepIndex: 1,
                    itemId: 'liquid',
                    equipmentItemId: 'chemistry',
                    installedUnitCount: 1,
                    usedUnitCount: 1,
                    batchCount: 5,
                    startMinute: 60,
                    endMinute: 190,
                    batches: [
                        { batchNumber: 1, dependencyReadyMinute: 60, startMinute: 60, endMinute: 70 },
                        { batchNumber: 2, dependencyReadyMinute: 60, startMinute: 70, endMinute: 80 },
                        { batchNumber: 3, dependencyReadyMinute: 120, startMinute: 120, endMinute: 130 },
                        { batchNumber: 4, dependencyReadyMinute: 120, startMinute: 130, endMinute: 140 },
                        { batchNumber: 5, dependencyReadyMinute: 180, startMinute: 180, endMinute: 190 },
                    ],
                },
            ],
        });
    });

    it('preserves blueprint rejection without producing a schedule', () => {
        const result = new BlueprintProductionScheduleAnalyzer(dataset()).analyze(
            blueprint([
                placement('pot', 'pot', 99),
                placement('chemistry', 'chemistry', 1),
            ]),
            schedulePlan()
        );

        expect(result.kind).toBe('rejected');
        expect(result.schedule).toEqual([]);
    });

    it('returns no partial schedule when compatible equipment is missing', () => {
        const result = new BlueprintProductionScheduleAnalyzer(dataset()).analyze(
            blueprint([
                placement('pot', 'pot', 0),
                placement('light', 'light', 7),
            ]),
            schedulePlan()
        );

        expect(result.kind).toBe('unavailable');
        if (result.kind !== 'unavailable') return;
        expect(result.schedule).toEqual([]);
        expect(result.issues).toEqual([{
            code: 'missing-compatible-equipment',
            stepIndex: 1,
            itemId: 'liquid',
            routeId: 'recipe:liquid',
            acceptedEquipmentItemIds: ['chemistry'],
            selectedEquipmentItemId: 'chemistry',
            compatibleInstalledEquipmentItemIds: [],
        }]);
    });

    it('requires the selected external grow light to be installed', () => {
        const result = new BlueprintProductionScheduleAnalyzer(dataset()).analyze(
            blueprint([
                placement('pot', 'pot', 0),
                placement('chemistry', 'chemistry', 1),
            ]),
            schedulePlan()
        );

        expect(result.kind).toBe('unavailable');
        if (result.kind !== 'unavailable') return;
        expect(result.issues).toEqual([{
            code: 'missing-selected-grow-light',
            stepIndex: 0,
            itemId: 'leaf',
            routeId: 'seed:seed:leaf:soil:pot:light',
            acceptedEquipmentItemIds: ['pot'],
            selectedEquipmentItemId: 'pot',
            selectedGrowLightItemId: 'light',
            equipmentPlacementIds: ['pot'],
        }]);
    });

    it('proves native grow-light coverage through matched rack and property-grid tiles', () => {
        const result = new BlueprintProductionScheduleAnalyzer(lightingDataset()).analyze(
            blueprint([
                placement('pot', 'pot', 0),
                placement('rack', 'rack', 0),
                proceduralLightPlacement('light', 'rack'),
            ]),
            seedSchedulePlan()
        );

        expect(result.kind).toBe('scheduled');
        if (result.kind !== 'scheduled') return;
        expect(result).toMatchObject({
            lightingCoverage: 'native-matched-standard-tile-exposure-with-conditional-partial-duration',
            constraintStatus: 'satisfied',
            schedule: [{
                constraintStatus: 'satisfied',
                assignments: [{
                    placementId: 'pot',
                    constraintStatus: 'satisfied',
                    lighting: {
                        kind: 'selected-external-grow-light',
                        growLightItemId: 'light',
                        installedPlacementIds: ['light'],
                        contributingPlacementIds: ['light'],
                        physicalCoverage: 'exact-native-matched-standard-tiles',
                        averageExposure: 1,
                    },
                }],
            }],
        });
        const light = result.capacity.equipment.find((entry) => entry.itemId === 'light')!;
        expect(light.placements[0]?.growLightCoverage).toEqual({
            kind: 'property-grid-tiles',
            coverageProofStatus: 'exact',
            coverageRule: 'native-matched-standard-tiles',
            tiles: [{ gridId: 'main', x: 0, y: 0 }],
        });
    });

    it('rejects a grow container outside the selected grow light matched tiles', () => {
        const result = new BlueprintProductionScheduleAnalyzer(lightingDataset()).analyze(
            blueprint([
                placement('pot', 'pot', 0),
                placement('rack', 'rack', 1),
                proceduralLightPlacement('light', 'rack'),
            ]),
            seedSchedulePlan()
        );

        expect(result.kind).toBe('unavailable');
        if (result.kind !== 'unavailable') return;
        expect(result.issues).toEqual([{
            code: 'grow-light-coverage-unsatisfied',
            stepIndex: 0,
            itemId: 'leaf',
            routeId: 'seed:seed:leaf:soil:pot:light',
            acceptedEquipmentItemIds: ['pot'],
            selectedEquipmentItemId: 'pot',
            selectedGrowLightItemId: 'light',
            installedGrowLightPlacementIds: ['light'],
            incompatiblePlacementIds: ['pot'],
        }]);
    });

    it('reports partial native light exposure without claiming exact planned duration', () => {
        const source = lightingDataset();
        const pot = source.buildables.find((entry) => entry.itemId === 'pot')!;
        const footprint = pot.placement.footprintTiles[0]!;
        const result = new BlueprintProductionScheduleAnalyzer({
            ...source,
            buildables: source.buildables.map((entry) => entry.itemId !== 'pot'
                ? entry
                : {
                    ...pot,
                    placement: {
                        ...pot.placement,
                        footprintWidth: 2,
                        footprintTiles: [
                            footprint,
                            {
                                ...footprint,
                                x: 1,
                                transform: transform('Footprint/[1,0]'),
                            },
                        ],
                    },
                }),
        }).analyze(
            blueprint([
                placement('pot', 'pot', 0),
                placement('rack', 'rack', 0),
                proceduralLightPlacement('light', 'rack'),
            ]),
            seedSchedulePlan()
        );

        expect(result.kind).toBe('scheduled');
        if (result.kind !== 'scheduled') return;
        expect(result).toMatchObject({
            constraintStatus: 'conditional',
            schedule: [{
                constraintStatus: 'conditional',
                assignments: [{
                    constraintStatus: 'conditional',
                    lighting: {
                        contributingPlacementIds: ['light'],
                        physicalCoverage: 'exact-native-matched-standard-tiles',
                        averageExposure: 0.5,
                    },
                }],
            }],
        });
    });

    it('allocates producer batches once across branching consumers', () => {
        const source = dataset();
        const recipe = source.production.stationRecipes[0]!;
        const result = new BlueprintProductionScheduleAnalyzer({
            ...source,
            production: {
                ...source.production,
                stationRecipes: [
                    { ...recipe, id: 'a', outputItemId: 'a' },
                    { ...recipe, id: 'b', outputItemId: 'b' },
                    {
                        ...recipe,
                        id: 'final',
                        outputItemId: 'final',
                        ingredients: [
                            { quantity: 1, acceptedItemIds: ['a'] },
                            { quantity: 1, acceptedItemIds: ['b'] },
                        ],
                    },
                ],
            },
        }).analyze(
            blueprint([
                placement('pot', 'pot', 0),
                placement('chemistry-a', 'chemistry', 1),
                placement('chemistry-b', 'chemistry', 2),
                placement('light', 'light', 7),
            ]),
            branchingSchedulePlan()
        );

        expect(result.kind).toBe('scheduled');
        if (result.kind !== 'scheduled') return;
        expect(result.scheduledElapsedMinutes).toBe(140);
        expect(result.schedule).toMatchObject([
            {
                itemId: 'leaf',
                batches: [
                    { batchNumber: 1, endMinute: 60 },
                    { batchNumber: 2, endMinute: 120 },
                ],
            },
            {
                itemId: 'a',
                batches: [{ batchNumber: 1, dependencyReadyMinute: 60, endMinute: 70 }],
            },
            {
                itemId: 'b',
                batches: [{ batchNumber: 1, dependencyReadyMinute: 120, endMinute: 130 }],
            },
            {
                itemId: 'final',
                batches: [{ batchNumber: 1, dependencyReadyMinute: 130, endMinute: 140 }],
            },
        ]);
    });

    it('rejects exact ambient temperature above a hard growth maximum', () => {
        const result = new BlueprintProductionScheduleAnalyzer(dataset()).analyze(
            blueprint([placement('mushroom-bed', 'mushroom-bed', 0)]),
            shroomSchedulePlan()
        );

        expect(result.kind).toBe('unavailable');
        if (result.kind !== 'unavailable') return;
        expect(result.issues).toEqual([{
            code: 'temperature-constraint-unsatisfied',
            stepIndex: 0,
            itemId: 'shroom',
            routeId: 'shroom:spawn:shroom:mushroom-soil',
            acceptedEquipmentItemIds: ['mushroom-bed'],
            selectedEquipmentItemId: 'mushroom-bed',
            incompatiblePlacementIds: ['mushroom-bed'],
            temperatureRule: {
                kind: 'environmental-maximum',
                maximumTemperature: 15,
            },
        }]);
    });

    it('uses emitter-adjusted temperature for hard growth feasibility', () => {
        const source = dataset();
        const result = new BlueprintProductionScheduleAnalyzer({
            ...source,
            buildables: source.buildables.map((entry) => entry.itemId === 'cooler'
                ? buildable('cooler', [{
                    temperature: 0,
                    range: 4,
                    emissionPoint: vector(0, 0, 0),
                }])
                : entry),
        }).analyze(
            blueprint([
                placement('cooler', 'cooler', 0),
                placement('mushroom-bed', 'mushroom-bed', 1),
            ]),
            shroomSchedulePlan()
        );

        expect(result.kind).toBe('scheduled');
        if (result.kind !== 'scheduled') return;
        expect(result.schedule[0]?.assignments[0]?.temperature).toEqual({
            kind: 'satisfied',
            basis: 'native-effective-temperature',
            ambientTemperature: 20,
            effectiveTemperature: 5,
            processMultiplier: 1,
            rule: {
                kind: 'environmental-maximum',
                maximumTemperature: 15,
            },
        });
    });

    it('caps native temperature acceleration above the performance range', () => {
        const source = dataset();
        const result = new BlueprintProductionScheduleAnalyzer({
            ...source,
            properties: [{ ...property(), ambientTemperature: 50 }],
        }).analyze(
            blueprint([
                placement('pot', 'pot', 0),
                placement('light', 'light', 7),
            ]),
            seedSchedulePlan()
        );

        expect(result.kind).toBe('scheduled');
        if (result.kind !== 'scheduled') return;
        expect(result).toMatchObject({
            baseSerialProcessMinutes: 60,
            serialProcessMinutes: 40,
            temperatureTimeSavedMinutes: 20,
            scheduledElapsedMinutes: 40,
            parallelTimeSavedMinutes: 0,
            schedule: [{
                durationMinutesPerBatch: 60,
                durationMinutesPerBatchBasis:
                    'production-batch-plan-before-placement-temperature',
                assignments: [{
                    temperature: {
                        kind: 'satisfied',
                        effectiveTemperature: 50,
                        processMultiplier: 1.5,
                    },
                }],
                batches: [{ durationMinutes: 40, startMinute: 0, endMinute: 40 }],
            }],
        });

        const coolResult = new BlueprintProductionScheduleAnalyzer({
            ...source,
            properties: [{ ...property(), ambientTemperature: 10 }],
        }).analyze(
            blueprint([
                placement('pot', 'pot', 0),
                placement('light', 'light', 7),
            ]),
            seedSchedulePlan()
        );
        expect(coolResult.kind).toBe('scheduled');
        if (coolResult.kind !== 'scheduled') return;
        expect(coolResult.schedule[0]).toMatchObject({
            assignments: [{
                temperature: {
                    kind: 'satisfied',
                    effectiveTemperature: 10,
                    processMultiplier: 1,
                },
            }],
            batches: [{ durationMinutes: 60, startMinute: 0, endMinute: 60 }],
        });
    });

    it('requires an equipment choice instead of combining heterogeneous station types', () => {
        const source = dataset();
        const recipe = source.production.stationRecipes[0]!;
        const plan = schedulePlan();
        const liquid = plan.productionSteps[1]!;
        const result = new BlueprintProductionScheduleAnalyzer({
            ...source,
            buildables: [...source.buildables, buildable('chemistry-mk2')],
            production: {
                ...source.production,
                stationRecipes: [{
                    ...recipe,
                    acceptedEquipmentItemIds: ['chemistry', 'chemistry-mk2'],
                }],
            },
        }).analyze(
            blueprint([
                placement('pot', 'pot', 0),
                placement('chemistry', 'chemistry', 1),
                placement('chemistry-mk2', 'chemistry-mk2', 2),
                placement('light', 'light', 7),
            ]),
            {
                ...plan,
                productionSteps: [
                    plan.productionSteps[0]!,
                    {
                        ...liquid,
                        acceptedEquipmentItemIds: ['chemistry', 'chemistry-mk2'],
                        equipmentItemId: null,
                    },
                ],
            }
        );

        expect(result.kind).toBe('unavailable');
        if (result.kind !== 'unavailable') return;
        expect(result.issues).toEqual([{
            code: 'equipment-selection-required',
            stepIndex: 1,
            itemId: 'liquid',
            routeId: 'recipe:liquid',
            acceptedEquipmentItemIds: ['chemistry', 'chemistry-mk2'],
            selectedEquipmentItemId: null,
            compatibleInstalledEquipmentItemIds: ['chemistry', 'chemistry-mk2'],
        }]);
    });

    it('rejects a batch plan whose produced dependency appears after its consumer', () => {
        const plan = schedulePlan();

        expect(() => new BlueprintProductionScheduleAnalyzer(dataset()).analyze(
            blueprint([
                placement('pot', 'pot', 0),
                placement('chemistry', 'chemistry', 1),
                placement('light', 'light', 7),
            ]),
            {
                ...plan,
                targetItemId: 'leaf',
                productionSteps: [...plan.productionSteps].reverse(),
            }
        )).toThrow('Production step "recipe:liquid" depends on later step item "leaf"');
    });

    it('rejects a batch plan from a different normalized dataset', () => {
        const plan = schedulePlan();

        expect(() => new BlueprintProductionScheduleAnalyzer(dataset()).analyze(
            blueprint([
                placement('pot', 'pot', 0),
                placement('chemistry', 'chemistry', 1),
                placement('light', 'light', 7),
            ]),
            {
                ...plan,
                dataset: { ...plan.dataset, datasetSha256: 'b'.repeat(64) },
            }
        )).toThrow('Production plan belongs to a different normalized dataset');
    });

    it('does not treat a different process route with the same output as compatible', () => {
        const plan = schedulePlan();
        const liquid = plan.productionSteps[1]!;
        const result = new BlueprintProductionScheduleAnalyzer(dataset()).analyze(
            blueprint([
                placement('pot', 'pot', 0),
                placement('chemistry', 'chemistry', 1),
                placement('light', 'light', 7),
            ]),
            {
                ...plan,
                productionSteps: [
                    plan.productionSteps[0]!,
                    { ...liquid, routeId: 'recipe:other' },
                ],
            }
        );

        expect(result.kind).toBe('unavailable');
        if (result.kind !== 'unavailable') return;
        expect(result.issues).toEqual([{
            code: 'missing-compatible-equipment',
            stepIndex: 1,
            itemId: 'liquid',
            routeId: 'recipe:other',
            acceptedEquipmentItemIds: ['chemistry'],
            selectedEquipmentItemId: 'chemistry',
            compatibleInstalledEquipmentItemIds: [],
        }]);
    });
});

function schedulePlan(): ProductionBatchPlan {
    const items = ['seed', 'soil', 'leaf', 'liquid', 'pot', 'chemistry', 'light']
        .map((itemId) => item(itemId, ['seed', 'soil'].includes(itemId) ? 1 : null));
    const catalog = production();
    const costs = new ProductionMaterialCostEvaluator(
        new Map(items.map((entry) => [entry.id, entry])),
        { ...catalog, shrooms: [] },
        { growContainerItemId: 'pot', growLightItemId: 'light' }
    );
    return new ProductionBatchPlanner(
        costs,
        { gameVersion, datasetSha256 }
    ).plan('liquid', 5);
}

function shroomSchedulePlan(): ProductionBatchPlan {
    const mushroomSoil = {
        ...item('mushroom-soil', 1),
        soil: { quality: 'Test', uses: 1 },
    };
    const items = [
        item('spawn', 1),
        mushroomSoil,
        item('shroom', null),
        item('mushroom-bed', null),
    ];
    const catalog = production();
    const costs = new ProductionMaterialCostEvaluator(
        new Map(items.map((entry) => [entry.id, entry])),
        { ...catalog, seeds: [], stationRecipes: [] }
    );
    return new ProductionBatchPlanner(
        costs,
        { gameVersion, datasetSha256 }
    ).plan('shroom', 16);
}

function seedSchedulePlan(): ProductionBatchPlan {
    const plan = schedulePlan();
    const step = plan.productionSteps[0]!;
    return {
        ...plan,
        targetItemId: step.itemId,
        targetQuantity: step.outputQuantityPerBatch,
        productionSteps: [{
            ...step,
            requiredQuantity: step.outputQuantityPerBatch,
            batchCount: 1,
            totalProcessMinutes: step.durationMinutesPerBatch,
            producedQuantity: step.outputQuantityPerBatch,
            leftoverQuantity: 0,
            inputs: step.inputs.map((input) => ({
                ...input,
                totalQuantity: input.quantityPerBatch,
            })),
        }],
        totalProcessMinutes: step.durationMinutesPerBatch,
    };
}

function branchingSchedulePlan(): ProductionBatchPlan {
    const leaf = schedulePlan().productionSteps[0]!;
    const recipeStep = (
        itemId: string,
        inputItemIds: readonly string[]
    ): ProductionBatchPlan['productionSteps'][number] => ({
        itemId,
        routeId: `recipe:${itemId}`,
        method: 'station-recipe',
        requiredQuantity: 1,
        batchCount: 1,
        outputQuantityPerBatch: 1,
        durationMinutesPerBatch: 10,
        acceptedEquipmentItemIds: ['chemistry'],
        equipmentItemId: 'chemistry',
        growLightItemId: null,
        additiveItemIds: [],
        quality: null,
        totalProcessMinutes: 10,
        producedQuantity: 1,
        leftoverQuantity: 0,
        inputs: inputItemIds.map((inputItemId) => ({
            itemId: inputItemId,
            quantityPerBatch: inputItemId === 'leaf' ? 10 : 1,
            totalQuantity: inputItemId === 'leaf' ? 10 : 1,
        })),
    });
    return {
        dataset: { gameVersion, datasetSha256 },
        targetItemId: 'final',
        targetQuantity: 1,
        totalProcessMinutes: 150,
        requiredMaterialCost: 0,
        purchaseCost: 0,
        purchases: [],
        productionSteps: [
            {
                ...leaf,
                requiredQuantity: 20,
                batchCount: 2,
                totalProcessMinutes: 120,
                producedQuantity: 20,
                leftoverQuantity: 0,
                inputs: leaf.inputs.map((input) => ({
                    ...input,
                    totalQuantity: input.quantityPerBatch * 2,
                })),
            },
            recipeStep('a', ['leaf']),
            recipeStep('b', ['leaf']),
            recipeStep('final', ['a', 'b']),
        ],
    };
}

function analyzer(): BlueprintProductionCapacityAnalyzer {
    return new BlueprintProductionCapacityAnalyzer(dataset());
}

function dataset(): BlueprintProductionCapacityDataset {
    return {
        manifest: { gameVersion, datasetSha256 },
        properties: [property()],
        buildables: [
            buildable('cooler', [{ temperature: 0, range: 2, emissionPoint: vector(0, 0, 0) }]),
            buildable('pot'),
            buildable('light'),
            buildable('dryer'),
            buildable('mixer'),
            buildable('chemistry'),
            buildable('mushroom-bed'),
            buildable('brick-press'),
            buildable('decoration'),
        ],
        propertyLayouts: [propertyLayout()],
        production: production(),
    };
}

function lightingDataset(): BlueprintProductionCapacityDataset {
    const source = dataset();
    return {
        ...source,
        buildables: [
            ...source.buildables.filter((entry) => entry.itemId !== 'light'),
            rackBuildable(),
            proceduralLightBuildable(),
        ],
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
        seeds: [{
            schema: 'neonschedule1-seed-production-3',
            seedItemId: 'seed',
            soilItemIds: ['soil'],
            plantRuntimeType: 'Game.Plant',
            growthTimeMinutes: 60,
            baseYieldQuantity: 10,
            harvestTarget: 'leaf',
            harvestProducts: [{ itemId: 'leaf', quantity: 1 }],
        }],
        shrooms: [{
            schema: 'neonschedule1-shroom-production-3',
            spawnItemId: 'spawn',
            soilItemIds: ['mushroom-soil'],
            productItemId: 'shroom',
            acceptedEquipmentItemIds: ['mushroom-bed'],
            growTimeMinutes: 1_080,
            baseYieldQuantity: 16,
            maximumTemperatureForGrowth: 15,
            minimumSoilMoistureForGrowth: 0,
        }],
        stationRecipes: [{
            schema: 'neonschedule1-station-recipe-2',
            id: 'liquid',
            title: 'Liquid',
            cookTimeMinutes: 10,
            cookTemperature: 180,
            cookTemperatureTolerance: 25,
            qualityCalculationMethod: 'Additive',
            acceptedEquipmentItemIds: ['chemistry'],
            ingredients: [{ quantity: 10, acceptedItemIds: ['leaf'] }],
            outputItemId: 'liquid',
            outputQuantity: 1,
        }],
        ovenTransforms: [],
        stations: [
            {
                schema: 'neonschedule1-production-station-3',
                itemId: 'pot',
                kind: 'grow-container',
                yieldMultiplier: 1,
                growSpeedMultiplier: 1,
                requiresExternalGrowLight: true,
                maxTemperatureGrowthMultiplier: 1.5,
                minimumTemperatureThreshold: 20,
                maximumTemperatureThreshold: 40,
                allowedSoilIds: ['soil'],
                allowedAdditiveIds: [],
            },
            {
                schema: 'neonschedule1-production-station-3',
                itemId: 'light',
                kind: 'grow-light',
                growSpeedMultiplier: 1,
            },
            {
                schema: 'neonschedule1-production-station-3',
                itemId: 'dryer',
                kind: 'drying-rack',
                capacity: 20,
                maxProcessMultiplier: 1.5,
                processMinutesPerTier: 720,
                minimumTemperatureThreshold: 20,
                maximumTemperatureThreshold: 40,
            },
            {
                schema: 'neonschedule1-production-station-3',
                itemId: 'mixer',
                kind: 'mixing',
                capacity: 10,
                timePerItem: 6,
                requiresManualIngredientInsertion: true,
            },
            {
                schema: 'neonschedule1-production-station-3',
                itemId: 'brick-press',
                kind: 'brick-press',
                packagingItemId: 'brick',
                packagingQuantity: 20,
            },
        ],
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

function proceduralLightPlacement(
    id: string,
    parentPlacementId: string
): BlueprintDocument['placements'][number] {
    return {
        id,
        kind: 'procedural-grid',
        itemId: 'light',
        parentPlacementId,
        tiles: [{ x: 0, y: 0, tileId: 'rack/light-tile' }],
    };
}

function property(): Property {
    return {
        schema: 'neonschedule1-property-1',
        code: 'warehouse',
        name: 'Warehouse',
        price: 0,
        employeeCapacity: 1,
        loadingDockCount: 0,
        gridCount: 1,
        ambientTemperature: 20,
        ownedByDefault: false,
        position: vector(0, 0, 0),
        business: null,
        hasLayout: true,
    };
}

function buildable(
    itemId: string,
    temperatureEmitters: Buildable['temperatureEmitters'] = []
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
            buildPoint: transform('BuildPoint'),
            midAirCenterPoint: null,
            boundingCollider: collider(),
            footprintTiles: [{
                x: 0,
                y: 0,
                requiredOffset: 0,
                transform: transform('Footprint/[0,0]'),
                cornerObstacles: [],
            }],
        },
        componentTypes: [],
        colliders: [],
        storage: null,
        temperatureEmitters,
        interactionPoints: [],
        isTransitEntity: false,
        transitAccessPoints: [],
        proceduralTiles: [],
        visuals: { renderers: [], meshes: [] },
    };
}

function rackBuildable(): Buildable {
    const rack = buildable('rack');
    return {
        ...rack,
        placement: {
            ...rack.placement,
            tileSharingRule: 'floor-rack',
        },
        proceduralTiles: [{
            id: 'rack/light-tile',
            type: 'Rack',
            transform: transform('Rack/LightTile'),
        }],
    };
}

function proceduralLightBuildable(): Buildable {
    const light = buildable('light');
    return {
        ...light,
        placement: {
            ...light.placement,
            kind: 'procedural-grid',
            proceduralTileType: 'Rack',
            tileSharingRule: null,
            tileSharingImplementation: null,
        },
    };
}

function item(id: string, basePurchasePrice: number | null): Item {
    return {
        schema: 'neonschedule1-item-3',
        id,
        name: id,
        category: 'Test',
        isRuntimeOnly: false,
        stackLimit: 20,
        isStorable: true,
        basePurchasePrice,
        resellMultiplier: 1,
        requiredRank: null,
        requiredRankTier: null,
        product: null,
        packaging: null,
        additive: null,
        soil: id === 'soil' ? { quality: 'Test', uses: 1 } : null,
        mixingIngredient: null,
        presentation: {
            description: '',
            iconFileId: null,
            visualKind: 'none',
            fallbackMeshIds: [],
            fallbackMaterialIds: [],
        },
    };
}

function propertyLayout(): PropertyLayout {
    return {
        schema: 'neonschedule1-property-layout-4',
        propertyCode: 'warehouse',
        propertyName: 'Warehouse',
        worldPosition: vector(0, 0, 0),
        worldRotation: vector(0, 0, 0),
        spawnPoint: transform('Spawn'),
        interiorSpawnPoint: transform('InteriorSpawn'),
        npcSpawnPoint: transform('NpcSpawn'),
        boundingBox: null,
        boundaryColliders: [],
        fixedColliders: [],
        surfaceMeshes: [],
        surfaces: [],
        proceduralTiles: [],
        loadingDocks: [],
        grids: [{
            id: 'main',
            width: 8,
            height: 1,
            tileSize: 2,
            worldOrigin: vector(0, 0, 0),
            tiles: Array.from({ length: 8 }, (_, x) => ({
                x,
                y: 0,
                availableOffset: 0,
                worldPosition: vector(2 * x, 0, 0),
                worldRotation: vector(0, 0, 0),
            })),
        }],
        visuals: { renderers: [], meshes: [] },
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
        transform: transform('Bounds'),
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

function transform(path: string): Transform {
    return {
        name: path,
        path,
        worldPosition: vector(0, 0, 0),
        localPosition: vector(0, 0, 0),
        worldRotation: vector(0, 0, 0),
        localScale: vector(1, 1, 1),
    };
}

function vector(x: number, y: number, z: number): Vector3 {
    return { x, y, z };
}
