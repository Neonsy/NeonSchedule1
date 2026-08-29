import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { canonicalJson } from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

import {
    BrowserDataArtifactSchema,
    type BrowserDataArtifact,
} from '#public-data/browser/schema';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const artifactPath = path.join(packageRoot, 'artifacts', '0.4.6f13', 'data.json');

describe('browser data artifact', () => {
    it('is strict, canonical, and explicitly compatible', async () => {
        const content = await readFile(artifactPath, 'utf8');
        const artifact = BrowserDataArtifactSchema.assert(JSON.parse(content) as unknown);

        expect(content).toBe(canonicalJson(artifact));
        expect(artifact.compatibility).toEqual({
            gameVersion: '0.4.6f13',
            normalizerVersion: '0.0.40',
            datasetSha256: '5ee8e697d8ba3eaad5e1eed7ddb2a2ebfa39bb591fc629290d0d05d609190a90',
            status: 'supported',
            unsupportedVersionMessage:
                'This data supports Schedule I 0.4.6f13. Choose a matching data version before ' +
                'using calculations or plans.',
        });
        expect(() => BrowserDataArtifactSchema.assert({ ...artifact, unexpected: true }))
            .toThrow();
    });

    it('publishes the controls, proof, and limitations for every calculation family', async () => {
        const { calculations } = await readArtifact();

        expect(calculations.requestPolicy).toEqual({
            compatibility: 'matching-game-and-dataset-required',
            persistence: 'request-local-not-stored',
            sourceSelection: 'explicit-no-automatic-merge',
            unknownValues: 'preserved-not-assumed',
            invalidRequests: 'rejected-before-calculation',
            identifiers: 'opaque-public-keys-only',
            applicationTransport: 'not-defined',
        });
        expect(calculations.counts).toEqual({
            proofClasses: 6,
            searchModes: 4,
            recipeObjectives: 5,
            stateSources: 2,
            inventorySources: 3,
            families: 10,
            requestInputs: 46,
            outcomes: 52,
            gaps: 74,
            limits: 16,
        });
        expect(calculations.proofClasses.map(({ key, resultUse }) => [key, resultUse]))
            .toEqual([
                ['exact', 'complete'],
                ['conditional', 'condition-dependent'],
                ['incomplete', 'partial-only'],
                ['unsupported', 'none'],
                ['unavailable', 'none'],
                ['not-applicable', 'none'],
            ]);
        expect(calculations.controls.searchModes.map((mode) => ({
            key: mode.key,
            execution: mode.execution,
            maximumIngredients: mode.maximumIngredients,
            advisoryDuration: mode.advisoryDuration,
            possibleOutcomeKeys: mode.possibleOutcomeKeys,
        }))).toEqual([
            {
                key: 'quick',
                execution: 'live-bounded-after-coverage-miss',
                maximumIngredients: 3,
                advisoryDuration: {
                    minimumMs: 5,
                    maximumMs: 100,
                    scope: 'per-product-search',
                },
                possibleOutcomeKeys: ['precomputed-exact', 'live-exact', 'live-incomplete'],
            },
            {
                key: 'balanced',
                execution: 'live-bounded-after-coverage-miss',
                maximumIngredients: 4,
                advisoryDuration: {
                    minimumMs: 50,
                    maximumMs: 500,
                    scope: 'per-product-search',
                },
                possibleOutcomeKeys: ['precomputed-exact', 'live-exact', 'live-incomplete'],
            },
            {
                key: 'precise',
                execution: 'live-bounded-after-coverage-miss',
                maximumIngredients: 5,
                advisoryDuration: {
                    minimumMs: 550,
                    maximumMs: 4_000,
                    scope: 'per-product-search',
                },
                possibleOutcomeKeys: ['precomputed-exact', 'live-exact', 'live-incomplete'],
            },
            {
                key: 'exhaustive',
                execution: 'verified-precomputed-only',
                maximumIngredients: null,
                advisoryDuration: null,
                possibleOutcomeKeys: ['precomputed-exact', 'coverage-miss'],
            },
        ]);
        expect(calculations.controls.recipeObjectives.map(({ key, direction }) => [
            key,
            direction,
        ])).toEqual([
            ['product-value', 'highest-first'],
            ['net-value', 'highest-first'],
            ['fewest-steps', 'lowest-first'],
            ['lowest-cost', 'lowest-first'],
            ['return-on-cost', 'highest-first'],
        ]);
        expect(calculations.controls.stateSources.map(({ key }) => key)).toEqual([
            'manual-state',
            'latest-observation',
        ]);
        expect(calculations.controls.inventorySources.map(({ key }) => key)).toEqual([
            'no-inventory',
            'selected-manual-inventories',
            'latest-observation-inventories',
        ]);
        expect(calculations.families.map(({ key }) => key)).toEqual([
            'recipe-search',
            'customer-planner',
            'dealer-planner',
            'progression-eligibility',
            'production-planner',
            'inventory-logistics',
            'property-business',
            'blueprint-builder',
            'route-travel',
            'evidence-compatibility',
        ]);

        const proofKeys = new Set(calculations.proofClasses.map(({ key }) => key));
        const controlKeys = new Set([
            'search-mode',
            'recipe-objective',
            'state-source',
            'inventory-source',
        ]);
        const coveredFeatureKeys = calculations.families.flatMap(({ featureKeys }) => featureKeys);
        expect(coveredFeatureKeys).toEqual([
            'recipe-calculator-search',
            'customer-planner',
            'dealer-planner',
            'relationships-progression',
            'production-planner',
            'inventory-logistics',
            'properties-businesses',
            'blueprint-builder',
            'routes-travel',
            'evidence-compatibility',
        ]);
        for (const family of calculations.families) {
            expect(family.requestInputs.length).toBeGreaterThan(0);
            expect(family.outcomes.length).toBeGreaterThan(0);
            expect(family.limits.length).toBeGreaterThan(0);
            expect(family.controlKeys.every((key) => controlKeys.has(key))).toBe(true);
            expect(family.outcomes.every(({ proofKey }) => proofKeys.has(proofKey))).toBe(true);
            expect(family.gaps.every(({ proofKey }) => proofKeys.has(proofKey))).toBe(true);
        }
        for (const value of stringValues(calculations)) {
            expect(value.trim()).not.toBe('');
        }
    });

    it('contains the complete selected static catalogs', async () => {
        const artifact = await readArtifact();

        expect(artifact.counts).toEqual({
            effects: 35,
            items: 196,
            playerFacingItems: 193,
            calculationOnlyItems: 3,
            customers: 66,
            people: 98,
            relationships: 109,
            dealers: 6,
            suppliers: 4,
            rankLevels: 55,
            seeds: 5,
            stationRecipes: 4,
            productionStations: 18,
            logisticsStations: 13,
            employeeRoles: 4,
            buildables: 62,
            propertyLayouts: 13,
            properties: 13,
            shops: 12,
            mapMarkers: 229,
            dealerHomes: 6,
            deliveryLocations: 45,
            routeEndpoints: 58,
            routeLayerResults: 208,
            routeEstimates: 200,
            unavailableRouteResults: 8,
            routePoints: 12_968,
        });
        expect(artifact.map.regions).toHaveLength(6);
        expect(artifact.map.markers).toHaveLength(229);
        expect(artifact.map.markers.flatMap((marker) => marker.positions)).toHaveLength(235);
        expect(artifact.items.filter((item) => item.access === 'calculation-only')
            .map((item) => [item.slug, item.label])).toEqual([
            [null, null],
            [null, null],
            [null, 'OG Kush'],
        ]);
    });

    it('keeps all browser joins on opaque public keys', async () => {
        const artifact = await readArtifact();
        const effectKeys = new Set(artifact.effects.map((effect) => effect.key));
        const itemKeys = new Set(artifact.items.map((item) => item.key));
        const personKeys = new Set(artifact.people.map((person) => person.key));
        const customerKeys = new Set(artifact.customers.map((customer) => customer.key));
        const propertyKeys = new Set(artifact.properties.map((property) => property.key));
        const shopKeys = new Set(artifact.shops.map((shop) => shop.key));
        const rankLevels = new Set(artifact.ranks.map((rank) => `${rank.label}\0${rank.tier}`));

        for (const keys of [
            effectKeys,
            itemKeys,
            personKeys,
            customerKeys,
            propertyKeys,
            shopKeys,
        ]) {
            expect([...keys].every((key) => /^[a-z]+-[0-9a-f]{20}$/u.test(key))).toBe(true);
        }
        for (const item of artifact.items) {
            expectReferences(item.product?.effectKeys ?? [], effectKeys);
            expectReferences(item.product?.packagingKeys ?? [], itemKeys);
            expectReferences(item.mixingIngredient?.effectKeys ?? [], effectKeys);
            if (item.requiredRank !== null) {
                expect(rankLevels.has(
                    `${item.requiredRank.label}\0${item.requiredRank.tier}`
                )).toBe(true);
            }
        }
        expectReferences(artifact.mixing.defaultProductKeys, itemKeys);
        for (const mixingMap of artifact.mixing.maps) {
            expectReferences(mixingMap.effects.map((effect) => effect.effectKey), effectKeys);
        }
        for (const customer of artifact.customers) {
            expect(personKeys.has(customer.personKey)).toBe(true);
            expectReferences(customer.preferredEffectKeys, effectKeys);
            expectReferences(customer.evaluation.map((entry) => entry.productKey), itemKeys);
        }
        for (const relationship of artifact.relationships) {
            expect(personKeys.has(relationship.sourceKey)).toBe(true);
            expect(personKeys.has(relationship.targetKey)).toBe(true);
        }
        for (const dealer of artifact.trade.dealers) {
            expect(personKeys.has(dealer.personKey)).toBe(true);
        }
        for (const supplier of artifact.trade.suppliers) {
            expect(personKeys.has(supplier.personKey)).toBe(true);
            expectReferences(supplier.shopKeys, shopKeys);
            expectReferences(
                supplier.deliveryListings.map((listing) => listing.itemKey),
                itemKeys
            );
        }
        for (const shop of artifact.shops) {
            if (shop.holderPersonKey !== null) {
                expect(personKeys.has(shop.holderPersonKey)).toBe(true);
            }
            expectReferences(shop.listings.map((listing) => listing.itemKey), itemKeys);
        }
        expectReferences([...namedPublicKeys(artifact.production, 'ItemKey')], itemKeys);
        expectReferences([...namedPublicKeys(artifact.production, 'ItemKeys')], itemKeys);
        expectReferences(
            artifact.blueprintGeometry.buildables.map((buildable) => buildable.itemKey),
            itemKeys
        );
        expectReferences(
            artifact.blueprintGeometry.properties.map((property) => property.propertyKey),
            propertyKeys
        );
        expectReferences(
            artifact.travel.dealer.homes.map((home) => home.personKey),
            personKeys
        );
        for (const result of artifact.travel.vehiclePropertyShop.layers.flatMap(
            (layer) => layer.results
        )) {
            expect(propertyKeys.has(result.propertyKey)).toBe(true);
            expect(shopKeys.has(result.shopKey)).toBe(true);
        }
        for (const property of artifact.blueprintGeometry.properties) {
            const meshKeys = new Set(property.surfaceMeshes.map((mesh) => mesh.key));
            expectReferences(
                property.surfaces.flatMap((surface) => surface.colliderGroups)
                    .flatMap((group) => group.colliders)
                    .flatMap((collider) => collider.meshKey === null ? [] : [collider.meshKey]),
                meshKeys
            );
        }
        const taskKeys = new Set(
            artifact.production.logistics.taskCatalog.map((task) => task.key)
        );
        const legKeys = new Set(
            artifact.production.logistics.movementLegCatalog.map((leg) => leg.key)
        );
        expectReferences([
            ...artifact.production.logistics.handlerTaskPriority,
            ...artifact.production.logistics.employeeScheduling.botanistTaskPriority,
            ...artifact.production.logistics.employeeScheduling.chemistTaskPriority,
            ...artifact.production.logistics.employeeScheduling.cleanerTaskPriority,
        ], taskKeys);
        expectReferences([...namedPublicKeys(artifact.production.logistics, 'taskKeys')], taskKeys);
        expectReferences([...namedPublicKeys(artifact.production.logistics, 'legKeys')], legKeys);
    });

    it('publishes complete calculation-safe blueprint and property geometry', async () => {
        const artifact = await readArtifact();
        const geometry = artifact.blueprintGeometry;

        expect(geometry.proof).toEqual({
            status: 'blueprint-calculation-input-complete',
            renderAssets: 'not-published',
            sourceRuntimeMetadata: 'not-published',
        });
        expect(geometry.counts).toEqual({
            buildables: 62,
            properties: 13,
            buildableColliders: 1192,
            footprintTiles: 268,
            interactionPoints: 346,
            transitAccessPoints: 97,
            propertyFixedColliders: 8254,
            propertyBoundaryColliders: 16,
            propertySurfaceColliders: 196,
            surfaceMeshes: 11,
            surfaces: 154,
            proceduralTiles: 12,
            loadingDocks: 9,
            grids: 29,
            gridTiles: 5678,
        });
        expect(countBy(
            geometry.buildables,
            (buildable) => buildable.placement.kind
        )).toEqual({
            grid: 47,
            'procedural-grid': 3,
            surface: 12,
        });
        expect(countBy(
            geometry.properties.flatMap((property) => property.surfaces),
            (surface) => surface.type
        )).toEqual({ roof: 15, wall: 139 });

        const colliders = [
            ...geometry.buildables.flatMap((buildable) => [
                buildable.placement.boundingCollider,
                ...buildable.colliders,
            ]),
            ...geometry.properties.flatMap((property) => [
                ...(property.boundingCollider === null ? [] : [property.boundingCollider]),
                ...property.boundaryColliders,
                ...property.fixedColliders,
                ...property.surfaces.flatMap((surface) =>
                    surface.colliderGroups.flatMap((group) => group.colliders)
                ),
            ]),
        ];
        expect(new Set(colliders.map((collider) => collider.key)).size).toBe(colliders.length);
        for (const collider of colliders) {
            expect(collider.box === null || collider.box.halfAxes.length === 3).toBe(true);
            expect(collider.shape === 'box' ? collider.box !== null : collider.box === null).toBe(true);
            expect(collider.meshKey === null).toBe(collider.meshFrame === null);
            expect(collider.meshKey === null).toBe(collider.convex === null);
        }
        for (const property of geometry.properties) {
            expect(new Set(property.grids.map((grid) => grid.key)).size)
                .toBe(property.grids.length);
            expect(new Set(property.surfaces.map((surface) => surface.key)).size)
                .toBe(property.surfaces.length);
            for (const surface of property.surfaces) {
                expect(surface.colliderGroups.every((group) => group.colliders.length > 0))
                    .toBe(true);
            }
        }
    });

    it('publishes complete production and logistics mechanics', async () => {
        const artifact = await readArtifact();
        const production = artifact.production.catalog;
        const logistics = artifact.production.logistics;

        expect(production.seeds).toHaveLength(5);
        expect(production.shrooms).toHaveLength(1);
        expect(production.stationRecipes).toHaveLength(4);
        expect(production.ovenTransforms).toHaveLength(2);
        expect(countBy(production.stations, (station) => station.kind)).toEqual({
            'brick-press': 1,
            cauldron: 1,
            'drying-rack': 1,
            'grow-container': 4,
            'grow-light': 3,
            'lab-oven': 1,
            mixing: 1,
            'mixing-mk2': 1,
            'mushroom-spawn': 1,
            packaging: 1,
            'packaging-mk2': 1,
            sprinkler: 2,
        });
        expect(production.packaging.employeeTiming).toEqual({
            baseSeconds: 5,
            usesEmployeePackagingSpeed: true,
            usesStationSpeed: true,
            usesEmployeeCurrentWorkSpeed: true,
            completionOverheadSeconds: 0,
        });
        expect(production.brickPressing.employeeTiming).toEqual({
            baseSeconds: 15,
            usesEmployeePackagingSpeed: true,
            usesStationSpeed: false,
            usesEmployeeCurrentWorkSpeed: true,
            completionOverheadSeconds: 1.2,
        });
        expect(logistics.employeeRoles.map((role) => [role.key, role.dailyWage])).toEqual([
            ['botanist', 200],
            ['chemist', 300],
            ['cleaner', 100],
            ['handler', 200],
        ]);
        expect(logistics.taskCatalog).toHaveLength(33);
        expect(logistics.movementLegCatalog).toHaveLength(6);
        expect(logistics.stations).toHaveLength(13);
        expect(countBy(
            logistics.stations.flatMap((station) => [
                ...station.inputSlots,
                ...station.outputSlots,
            ]).flatMap((slot) => slot.filters),
            (filter) => filter.kind
        )).toEqual({
            'dryable-product': 1,
            'item-category': 2,
            'item-list': 7,
            'mixing-ingredient': 2,
            'packaged-product': 2,
            'unpackaged-product': 6,
        });
        expect(logistics.employeeScheduling).toMatchObject({
            authority: 'authoritative-game-state',
            prerequisite: 'available-and-idle',
            taskSelection: 'first-ready-in-listed-order',
            taskReadiness: 'live-state-not-published',
        });
    });

    it('publishes bounded route estimates and dealer travel inputs', async () => {
        const artifact = await readArtifact();
        const travel = artifact.travel;

        expect(travel.dealer).toMatchObject({
            method: 'native-straight-line-walk-speed',
            feasibilityPolicy: 'worst-case-regional-delivery-location',
            currentOriginInput: 'caller-supplied-current-position',
            staticHomeUsage: 'reference-only-not-current-position',
            proof: {
                staticGameData: 'complete',
                liveState: 'runtime-input-required',
                resultContract: 'published-in-calculation-contract-catalog',
            },
            counts: {
                dealerHomes: 6,
                regions: 6,
                distinctDeliveryLocations: 45,
                regionalDeliveryLocationAssignments: 47,
            },
        });
        expect(travel.dealer.regions.map((region) => [
            region.regionKey,
            region.deliveryLocations.length,
        ])).toEqual([
            ['docks', 5],
            ['downtown', 8],
            ['northtown', 11],
            ['suburbia', 8],
            ['uptown', 6],
            ['westville', 9],
        ]);
        const deliveryLocationKeys = new Set(travel.dealer.regions.flatMap((region) =>
            region.deliveryLocations.map((location) => location.key)));
        expect(deliveryLocationKeys.size).toBe(45);

        const vehicle = travel.vehiclePropertyShop;
        expect(vehicle).toMatchObject({
            routeKind: 'static-planning-estimate',
            graphRoleSelection: 'caller-selected',
            pathDirection: 'directed',
            routeProofStatus: 'incomplete',
            proof: {
                selectedEstimates: 'published',
                unavailableResults: 'published',
                endpointAccess: 'unproven',
                layerComposition: 'excluded-selected-layer-only',
                nativePathChoice: 'unproven',
                rawCosts: 'not-used',
                rawNavigationGraphs: 'not-published',
                liveNavigation: 'not-published',
                resultContract: 'published-in-calculation-contract-catalog',
            },
            counts: {
                properties: 13,
                shops: 8,
                endpoints: 58,
                layerResults: 208,
                availableEstimates: 200,
                unavailableResults: 8,
                routePoints: 12_968,
            },
        });
        expect(vehicle.layers.map((layer) => [layer.graphRole, layer.counts])).toEqual([
            ['general', { results: 104, available: 96, unavailable: 8, routePoints: 10_875 }],
            ['road', { results: 104, available: 104, unavailable: 0, routePoints: 2_093 }],
        ]);
        const endpointKeys = new Set(vehicle.endpoints.map((endpoint) => endpoint.key));
        expect(endpointKeys.size).toBe(58);
        expect([...endpointKeys].every((key) => /^routeendpoint-[0-9a-f]{20}$/u.test(key)))
            .toBe(true);
        const results = vehicle.layers.flatMap((layer) => layer.results);
        const unavailable = results.filter((result) =>
            result.planningStatus === 'estimate-unavailable');
        expect(unavailable).toHaveLength(8);
        expect(unavailable.every((result) =>
            result.unavailableReason === 'directed-disconnection' && result.estimate === null
        )).toBe(true);
        for (const result of results.filter((entry) => entry.estimate !== null)) {
            expect(result.unavailableReason).toBeNull();
            expect(endpointKeys.has(result.estimate!.sourceEndpointKey)).toBe(true);
            expect(endpointKeys.has(result.estimate!.destinationEndpointKey)).toBe(true);
            expect(result.estimate!.networkDistance).toBeGreaterThanOrEqual(0);
            expect(result.estimate!.points.length).toBeGreaterThan(0);
        }
        expect(vehicle.exclusions.map(({ code }) => code)).toEqual([
            'endpoint-access-unproven',
            'graph-layer-composition-excluded',
            'native-path-selection-unproven',
            'parking-not-modeled',
            'collision-avoidance-not-modeled',
            'traffic-not-modeled',
            'dynamic-obstacles-not-modeled',
            'live-driving-not-modeled',
        ]);
    });

    it('contains no source references, runtime types, or machine paths', async () => {
        const artifact = await readArtifact();
        const forbiddenKeys = new Set([
            'source',
            'sourceId',
            'sourceKind',
            'sourcePaths',
            'sourceSha256',
            'sourceFamily',
            'personId',
            'itemId',
            'effectId',
            'shopCode',
            'propertyCode',
            'runtimeType',
            'plantRuntimeType',
            'nativeType',
            'objectPath',
            'instanceKey',
            'fileId',
            'meshId',
            'materialId',
            'nodeIndex',
            'guid',
            'steamId',
            'playerId',
            'userId',
            'username',
        ]);
        expect([...objectKeys(artifact)].filter((key) => forbiddenKeys.has(key))).toEqual([]);
        expect([...stringValues(artifact)].filter((value) =>
            /ScheduleOne\.|Il2Cpp|UnityEngine|^[a-zA-Z]:[\\/]/u.test(value)
        )).toEqual([]);
        expect(artifact.map.maps.map((map) => map.asset.path)).toEqual([
            'assets/map/hyland-point.png',
            'assets/map/tutorial-area.png',
        ]);
    });

    it('states the boundary for all 16 planned features', async () => {
        const artifact = await readArtifact();

        expect(artifact.coverage).toHaveLength(16);
        expect(new Set(artifact.coverage.map((feature) => feature.key)).size).toBe(16);
        expect(Object.fromEntries(artifact.coverage.map((feature) => [
            feature.key,
            feature.artifactStatus,
        ]))).toMatchObject({
            'recipe-calculator-search': 'included',
            'customer-planner': 'included',
            'dealer-planner': 'included',
            'relationships-progression': 'included',
            'production-planner': 'included',
            'inventory-logistics': 'included',
            'properties-businesses': 'partial',
            'blueprint-builder': 'partial',
            'interactive-map': 'included',
            'routes-travel': 'included',
            'evidence-compatibility': 'included',
            'saved-plans': 'not-game-data',
            'sharing-exports': 'not-game-data',
            'community-content': 'not-game-data',
            'accounts-teams': 'not-game-data',
            'live-save-sync': 'not-game-data',
        });
    });
});

async function readArtifact(): Promise<BrowserDataArtifact> {
    return BrowserDataArtifactSchema.assert(JSON.parse(
        await readFile(artifactPath, 'utf8')
    ) as unknown);
}

function expectReferences(values: readonly string[], available: ReadonlySet<string>): void {
    expect(values.filter((value) => !available.has(value))).toEqual([]);
}

function* namedPublicKeys(value: unknown, propertyName: string): Iterable<string> {
    if (Array.isArray(value)) {
        for (const item of value) yield* namedPublicKeys(item, propertyName);
        return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        if (key.endsWith(propertyName)) {
            if (typeof child === 'string') yield child;
            if (Array.isArray(child)) {
                for (const item of child) if (typeof item === 'string') yield item;
            }
        }
        yield* namedPublicKeys(child, propertyName);
    }
}

function countBy<T>(values: readonly T[], key: (value: T) => string): Record<string, number> {
    const result: Record<string, number> = {};
    for (const value of values) {
        const entry = key(value);
        result[entry] = (result[entry] ?? 0) + 1;
    }
    return result;
}

function* objectKeys(value: unknown): Iterable<string> {
    if (Array.isArray(value)) {
        for (const item of value) yield* objectKeys(item);
        return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        yield key;
        yield* objectKeys(child);
    }
}

function* stringValues(value: unknown): Iterable<string> {
    if (typeof value === 'string') {
        yield value;
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) yield* stringValues(item);
        return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const child of Object.values(value)) yield* stringValues(child);
}
