import {
    BuildableSchema,
    CustomerCatalogSchema,
    CustomerSchema,
    EffectSchema,
    ItemSchema,
    MixingRulesSchema,
    PersonSchema,
    ProductionCatalogSchema,
    ProductionLogisticsCatalogSchema,
    PropertyLayoutSchema,
    PropertySchema,
    RankCatalogSchema,
    RelationshipCatalogSchema,
    ShopSchema,
    TradeCatalogSchema,
    VehicleNavigationSchema,
    WorldLocationCatalogSchema,
    WorldMapSchema,
    type Buildable,
    type Customer,
    type CustomerCatalog,
    type DatasetManifest,
    type Effect,
    type Item,
    type MixingRules,
    type Person,
    type ProductionCatalog,
    type ProductionLogisticsCatalog,
    type Property,
    type PropertyLayout,
    type RankCatalog,
    type RelationshipCatalog,
    type Shop,
    type TradeCatalog,
    type VehicleNavigation,
    type WorldLocationCatalog,
    type WorldMap,
} from '@neonschedule1/core';

import { openNormalizedDataset } from '#public-data/normalized-dataset';

export interface BrowserPublicationSource {
    readonly manifest: DatasetManifest;
    readonly effects: readonly Effect[];
    readonly items: readonly Item[];
    readonly customerCatalog: CustomerCatalog;
    readonly customers: readonly Customer[];
    readonly mixing: MixingRules;
    readonly people: readonly Person[];
    readonly relationships: RelationshipCatalog;
    readonly trade: TradeCatalog;
    readonly vehicleNavigation: VehicleNavigation;
    readonly worldLocations: WorldLocationCatalog;
    readonly worldMap: WorldMap;
    readonly ranks: RankCatalog;
    readonly production: ProductionCatalog;
    readonly logistics: ProductionLogisticsCatalog;
    readonly buildables: readonly Buildable[];
    readonly propertyLayouts: readonly PropertyLayout[];
    readonly properties: readonly Property[];
    readonly shops: readonly Shop[];
}

export async function loadBrowserPublicationSource(
    directory: string
): Promise<BrowserPublicationSource> {
    const dataset = await openNormalizedDataset(directory);
    const loadMany = async <T>(
        pattern: RegExp,
        assertDocument: (input: unknown) => T
    ): Promise<T[]> => Promise.all(dataset.paths(pattern).map(async (relativePath) =>
        assertDocument(await dataset.readDocument(relativePath))
    ));

    const effects = await loadMany(/^effects\/[^/]+\.json$/u, (input) =>
        EffectSchema.assert(input)
    );
    const items = await loadMany(/^items\/[^/]+\.json$/u, (input) =>
        ItemSchema.assert(input)
    );
    const customers = await loadMany(/^customers\/(?!catalog\.json$)[^/]+\.json$/u, (input) =>
        CustomerSchema.assert(input)
    );
    const people = await loadMany(/^people\/(?!relationships\.json$|trade\.json$)[^/]+\.json$/u,
        (input) => PersonSchema.assert(input));
    const buildables = await loadMany(/^buildables\/[^/]+\.json$/u, (input) =>
        BuildableSchema.assert(input)
    );
    const properties = await loadMany(/^properties\/[^/]+\/summary\.json$/u, (input) =>
        PropertySchema.assert(input)
    );
    const propertyLayouts = await loadMany(/^properties\/[^/]+\/layout\.json$/u, (input) =>
        PropertyLayoutSchema.assert(input)
    );
    const shops = await loadMany(/^shops\/[^/]+\.json$/u, (input) =>
        ShopSchema.assert(input)
    );
    const customerCatalog = CustomerCatalogSchema.assert(
        await dataset.readDocument('customers/catalog.json')
    );
    const mixing = MixingRulesSchema.assert(await dataset.readDocument('mixing/rules.json'));
    const relationships = RelationshipCatalogSchema.assert(
        await dataset.readDocument('people/relationships.json')
    );
    const trade = TradeCatalogSchema.assert(await dataset.readDocument('people/trade.json'));
    const vehicleNavigation = VehicleNavigationSchema.assert(
        await dataset.readDocument('world/vehicle-navigation.json')
    );
    const worldLocations = WorldLocationCatalogSchema.assert(
        await dataset.readDocument('world/locations.json')
    );
    const worldMap = WorldMapSchema.assert(await dataset.readDocument('world/map.json'));
    const ranks = RankCatalogSchema.assert(await dataset.readDocument('progression/ranks.json'));
    const production = ProductionCatalogSchema.assert(
        await dataset.readDocument('production/catalog.json')
    );
    const logistics = ProductionLogisticsCatalogSchema.assert(
        await dataset.readDocument('production/logistics.json')
    );

    requireCount('effects', effects.length, dataset.manifest.counts.effects);
    requireCount('items', items.length, dataset.manifest.counts.items);
    requireCount('customers', customers.length, dataset.manifest.counts.customers);
    requireCount('buildables', buildables.length, dataset.manifest.counts.buildables ?? 0);
    requireCount('properties', properties.length, dataset.manifest.counts.properties);
    requireCount(
        'property layouts',
        propertyLayouts.length,
        dataset.manifest.counts.propertyLayouts ?? 0
    );
    requireCount('shops', shops.length, dataset.manifest.counts.shops);
    requireCount(
        'vehicle navigation graphs',
        vehicleNavigation.graphs.length,
        dataset.manifest.counts.vehicleNavigationGraphs ?? 0
    );
    requireCount(
        'vehicle navigation nodes',
        vehicleNavigation.graphs.reduce((count, graph) => count + graph.nodes.length, 0),
        dataset.manifest.counts.vehicleNavigationNodes ?? 0
    );
    requireCount(
        'vehicle navigation connections',
        vehicleNavigation.graphs.reduce((count, graph) => count + graph.connections.length, 0),
        dataset.manifest.counts.vehicleNavigationConnections ?? 0
    );
    requireCount(
        'vehicle navigation endpoint mappings',
        vehicleNavigation.endpointMappings.length,
        dataset.manifest.counts.vehicleNavigationEndpointMappings ?? 0
    );
    requireCount(
        'world locations',
        worldLocations.locations.length,
        dataset.manifest.counts.worldLocations ?? 0
    );
    requireCount(
        'world regions',
        worldMap.regions.length,
        dataset.manifest.counts.worldRegions ?? 0
    );
    requireCount('rank levels', ranks.levels.length, dataset.manifest.counts.rankLevels ?? 0);
    requireCount('seeds', production.seeds.length, dataset.manifest.counts.seeds);
    requireCount('shroom spawns', production.shrooms.length, dataset.manifest.counts.shroomSpawns);
    requireCount(
        'station recipes',
        production.stationRecipes.length,
        dataset.manifest.counts.stationRecipes
    );
    requireCount(
        'oven transforms',
        production.ovenTransforms.length,
        dataset.manifest.counts.ovenTransforms
    );
    requireCount(
        'production stations',
        production.stations.length,
        dataset.manifest.counts.productionStations
    );
    requireSameSet(
        'customer catalog',
        customerCatalog.customerIds,
        customers.map((customer) => customer.id)
    );
    requireSameSet(
        'relationship people',
        relationships.personIds,
        people.map((person) => person.id)
    );
    requireSameSet(
        'property layouts',
        properties.map((property) => property.code),
        propertyLayouts.map((layout) => layout.propertyCode)
    );

    return {
        manifest: dataset.manifest,
        effects,
        items,
        customerCatalog,
        customers,
        mixing,
        people,
        relationships,
        trade,
        vehicleNavigation,
        worldLocations,
        worldMap,
        ranks,
        production,
        logistics,
        buildables,
        propertyLayouts,
        properties,
        shops,
    };
}

function requireCount(label: string, actual: number, expected: number): void {
    if (actual !== expected) {
        throw new Error(`Expected ${expected} ${label}, loaded ${actual}`);
    }
}

function requireSameSet(label: string, expected: readonly string[], actual: readonly string[]): void {
    const expectedValues = [...new Set(expected)].sort();
    const actualValues = [...new Set(actual)].sort();
    if (
        expectedValues.length !== expected.length ||
        actualValues.length !== actual.length ||
        expectedValues.length !== actualValues.length ||
        expectedValues.some((value, index) => value !== actualValues[index])
    ) {
        throw new Error(`${label} do not match their documents`);
    }
}
