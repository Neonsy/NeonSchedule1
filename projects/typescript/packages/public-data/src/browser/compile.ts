import {
    applicationDataPolicy,
    type Customer,
    type Effect,
    type Item,
    type Person,
    type Property,
    type Shop,
} from '@neonschedule1/core';

import type { BrowserPublicationSource } from '#public-data/browser/dataset';
import { compilePublicCalculationContracts } from '#public-data/browser/calculation-contracts';
import { compilePublicBlueprintGeometry } from '#public-data/browser/geometry';
import {
    createPublicKeyResolver,
    requireUnique,
} from '#public-data/browser/public-key';
import { compilePublicProductionBundle } from '#public-data/browser/production';
import { compilePublicTravel } from '#public-data/browser/travel';
import {
    BrowserDataArtifactSchema,
    type BrowserDataArtifact,
    type BrowserMap,
    type PublicCustomer,
    type PublicEffect,
    type PublicItem,
    type PublicPerson,
    type PublicProperty,
    type PublicShop,
} from '#public-data/browser/schema';
import { propertyPublicForms, shopPublicForms } from '#public-data/map/compile';
import type { MapPublicationInput, PublicMapOmission } from '#public-data/map/input';
import type {
    ProcessedPropertyAsset,
    ProcessedPropertyProvenance,
} from '#public-data/property/input';

const runtimeItemForms: Readonly<Record<string, string | null>> = {
    cuke_effects: null,
    defaultweed: 'OG Kush',
    energy_drink_effects: null,
};

const regionPublicForms: Readonly<Record<string, string>> = {
    Docks: 'docks',
    Downtown: 'downtown',
    Northtown: 'northtown',
    Suburbia: 'suburbia',
    Uptown: 'uptown',
    Westville: 'westville',
};

const omissionCodes: Readonly<Record<PublicMapOmission['sourceFamily'], string>> = {
    'world.locations.poi': 'private-runtime-markers',
    'world.locations.property-mirror': 'property-mirrors',
    'world.locations.shop-mirror': 'shop-mirrors',
    'world.locations.service-mirror': 'service-mirrors',
    'shops.unpositioned': 'map-unpositioned-shops',
    'world.services.visual-only': 'visual-only-services',
};

export function compileBrowserDataArtifact(
    source: BrowserPublicationSource,
    mapInput: MapPublicationInput,
    propertyVisuals: ProcessedPropertyProvenance
): BrowserDataArtifact {
    requireCompatibility(source, mapInput, propertyVisuals);

    const effectKey = createPublicKeyResolver('effect', source.effects.map((effect) => effect.id));
    const itemKey = createPublicKeyResolver('item', source.items.map((item) => item.id));
    const personKey = createPublicKeyResolver('person', source.people.map((person) => person.id));
    const customerKey = createPublicKeyResolver(
        'customer',
        source.customers.map((customer) => customer.id)
    );
    const propertyKey = createPublicKeyResolver(
        'property',
        source.properties.map((property) => property.code)
    );
    const shopKey = createPublicKeyResolver('shop', source.shops.map((shop) => shop.code));

    const peopleBySourceKey = new Map(source.people.map((person) => [person.id, person]));
    const effects = source.effects.map((effect) => compileEffect(effect, effectKey));
    const items = source.items.map((item) => compileItem(item, itemKey, effectKey));
    const people = source.people.map((person) => compilePerson(person, personKey));
    const customers = source.customers.map((customer) => compileCustomer(
        customer,
        peopleBySourceKey,
        customerKey,
        personKey,
        itemKey,
        effectKey
    ));
    const propertyVisualsByCode = requirePropertyVisuals(source, propertyVisuals);
    const properties = source.properties.map((property) =>
        compileProperty(property, propertyKey, propertyVisualsByCode.get(property.code)!)
    );
    const shops = source.shops.map((shop) => compileShop(shop, shopKey, itemKey, personKey));
    const production = compilePublicProductionBundle(source.production, source.logistics, itemKey);
    const blueprintGeometry = compilePublicBlueprintGeometry(
        source.buildables,
        source.propertyLayouts,
        itemKey,
        propertyKey
    );
    const travel = compilePublicTravel(source, {
        person: personKey,
        property: propertyKey,
        shop: shopKey,
    });
    const calculations = compilePublicCalculationContracts();
    const coverageKeys = new Set<string>(featureCoverage.map(({ key }) => key));
    const unknownCalculationFeature = calculations.families
        .flatMap(({ featureKeys }) => featureKeys)
        .find((key) => !coverageKeys.has(key));
    if (unknownCalculationFeature !== undefined) {
        throw new Error(
            `Calculation catalog references unknown feature ${unknownCalculationFeature}`
        );
    }

    sortBy(effects, (effect) => effect.label);
    sortBy(items, (item) => `${item.label ?? ''}\0${item.key}`);
    sortBy(people, (person) => person.label);
    sortBy(customers, (customer) => customer.label);
    sortBy(properties, (property) => property.label);
    sortBy(shops, (shop) => shop.label);
    requireUnique(effects.map((effect) => effect.slug), 'effect slugs');
    requireUnique(items.flatMap((item) => item.slug === null ? [] : [item.slug]), 'item slugs');
    requireUnique(people.map((person) => person.slug), 'person slugs');
    requireUnique(customers.map((customer) => customer.slug), 'customer slugs');
    requireUnique(properties.map((property) => property.slug), 'property slugs');
    requireUnique(shops.map((shop) => shop.slug), 'shop slugs');

    const dealerTypes = new Set(source.trade.dealers.map((dealer) => dealer.type));
    const unknownDealerTypes = [...dealerTypes]
        .filter((dealerType) => dealerType !== 'PlayerDealer' && dealerType !== 'CartelDealer');
    if (unknownDealerTypes.length > 0) {
        throw new Error(`Missing publication rule for dealer types: ${unknownDealerTypes.join(', ')}`);
    }
    const dealers = source.trade.dealers
        .filter((dealer) => dealer.type === 'PlayerDealer')
        .map((dealer) => ({
            personKey: personKey(dealer.personId),
            homeLabel: requirePublicText(dealer.homeName, `${dealer.personId} dealer home`),
            walkSpeed: dealer.walkSpeed,
            salesCutPercentage: dealer.salesCutPercentage,
            signingFee: dealer.signingFee,
            qualityTolerance: dealer.qualityTolerance,
        }));
    if (dealers.length !== 6) {
        throw new Error(`Expected 6 recruitable dealers, found ${dealers.length}`);
    }

    const artifact = {
        schema: 'neonschedule1-browser-data-1' as const,
        compatibility: {
            gameVersion: source.manifest.gameVersion,
            normalizerVersion: source.manifest.normalizerVersion,
            datasetSha256: source.manifest.datasetSha256,
            status: 'supported' as const,
            unsupportedVersionMessage:
                `This data supports Schedule I ${source.manifest.gameVersion}. ` +
                'Choose a matching data version before using calculations or plans.',
        },
        coverage: featureCoverage,
        applicationData: applicationDataPolicy,
        calculations,
        effects,
        items,
        mixing: {
            maxProperties: source.mixing.maxProperties,
            maxDeltaDifference: source.mixing.maxDeltaDifference,
            defaultProductKeys: source.mixing.defaultProductIds.map(itemKey),
            maps: source.mixing.maps.map((mixingMap) => ({
                drugType: mixingMap.drugType,
                drugTypeValue: mixingMap.drugTypeValue,
                radius: mixingMap.radius,
                effects: mixingMap.effects.map((effect) => ({
                    effectKey: effectKey(effect.effectId),
                    position: effect.position,
                    radius: effect.radius,
                })),
            })),
        },
        customerModel: {
            constants: source.customerCatalog.constants,
            qualityTiers: source.customerCatalog.qualityTiers,
            productEvaluationInputs: source.customerCatalog.productEvaluationInputs.map((input) => ({
                productKey: itemKey(input.productId),
                quantity: input.quantity,
                price: input.price,
                valueProposition: input.valueProposition,
            })),
        },
        customers,
        people,
        relationships: source.relationships.edges.map((edge) => ({
            sourceKey: personKey(edge.sourceId),
            targetKey: personKey(edge.targetId),
            bidirectional: edge.bidirectional,
        })),
        trade: {
            dealerMechanics: source.trade.dealerMechanics,
            dealers,
            suppliers: source.trade.suppliers.map((supplier) => ({
                personKey: personKey(supplier.personId),
                deadDropOrderLimit: supplier.deadDropOrderLimit,
                deliveryRelationshipRequirement: supplier.deliveryRelationshipRequirement,
                meetupRelationshipRequirement: supplier.meetupRelationshipRequirement,
                deadDropItemLimit: supplier.deadDropItemLimit,
                deadDropWaitPerItem: supplier.deadDropWaitPerItem,
                deadDropMaximumWait: supplier.deadDropMaximumWait,
                meetupDuration: supplier.meetupDuration,
                meetupCooldown: supplier.meetupCooldown,
                meetingEndDistance: supplier.meetingEndDistance,
                shopKeys: supplier.shopCodes.map(shopKey),
                deliveryListings: supplier.deliveryListings.map((listing) => ({
                    itemKey: itemKey(listing.itemId),
                    price: listing.price,
                })),
            })),
        },
        ranks: source.ranks.levels.map((level) => ({
            label: rankLabel(level.rank),
            tier: level.tier,
            totalXpRequired: level.totalXpRequired,
            orderLimitMultiplier: level.orderLimitMultiplier,
        })),
        production,
        blueprintGeometry,
        travel,
        properties,
        shops,
        map: compileBrowserMap(mapInput),
        counts: {
            effects: effects.length,
            items: items.length,
            playerFacingItems: items.filter((item) => item.access === 'player-facing').length,
            calculationOnlyItems: items.filter((item) => item.access === 'calculation-only').length,
            customers: customers.length,
            people: people.length,
            relationships: source.relationships.edges.length,
            dealers: dealers.length,
            suppliers: source.trade.suppliers.length,
            rankLevels: source.ranks.levels.length,
            seeds: production.catalog.seeds.length,
            stationRecipes: production.catalog.stationRecipes.length,
            productionStations: production.catalog.stations.length,
            logisticsStations: production.logistics.stations.length,
            employeeRoles: production.logistics.employeeRoles.length,
            buildables: blueprintGeometry.buildables.length,
            propertyLayouts: blueprintGeometry.properties.length,
            properties: properties.length,
            propertyVisuals: properties.length,
            shops: shops.length,
            mapMarkers: mapInput.markers.length,
            dealerHomes: travel.dealer.counts.dealerHomes,
            deliveryLocations: travel.dealer.counts.distinctDeliveryLocations,
            routeEndpoints: travel.vehiclePropertyShop.counts.endpoints,
            routeLayerResults: travel.vehiclePropertyShop.counts.layerResults,
            routeEstimates: travel.vehiclePropertyShop.counts.availableEstimates,
            unavailableRouteResults: travel.vehiclePropertyShop.counts.unavailableResults,
            routePoints: travel.vehiclePropertyShop.counts.routePoints,
        },
    };
    return BrowserDataArtifactSchema.assert(artifact);
}

function compileEffect(
    effect: Effect,
    effectKey: (sourceKey: string) => string
): PublicEffect {
    return {
        key: effectKey(effect.id),
        slug: slugify(effect.name),
        label: requirePublicText(effect.name, `${effect.id} effect name`),
        description: optionalPublicText(effect.presentation.description),
        tier: effect.tier,
        addictiveness: effect.addictiveness,
        predatesMixingRework: effect.implementedPriorMixingRework,
        value: effect.value,
        mixing: effect.mixing,
        colors: {
            product: effect.presentation.productColor.htmlRgba,
            label: effect.presentation.labelColor.htmlRgba,
        },
    };
}

function compileItem(
    item: Item,
    itemKey: (sourceKey: string) => string,
    effectKey: (sourceKey: string) => string
): PublicItem {
    const runtimeForm = runtimeItemForms[item.id];
    if (item.isRuntimeOnly !== (runtimeForm !== undefined)) {
        throw new Error(`Runtime item publication mapping drifted for ${item.id}`);
    }
    const label = item.isRuntimeOnly
        ? runtimeForm ?? null
        : requirePublicText(item.name, `${item.id} item name`);
    if (item.id === 'defaultweed' && item.name !== label) {
        throw new Error(`Default mixing product label changed from ${label} to ${item.name}`);
    }
    if ((item.requiredRank === null) !== (item.requiredRankTier === null)) {
        throw new Error(`Item ${item.id} has an incomplete rank requirement`);
    }
    return {
        key: itemKey(item.id),
        slug: item.isRuntimeOnly ? null : slugify(item.name),
        label,
        access: item.isRuntimeOnly ? 'calculation-only' : 'player-facing',
        category: item.category,
        description: item.isRuntimeOnly
            ? null
            : requirePublicText(item.presentation.description, `${item.id} item description`),
        stackLimit: item.stackLimit,
        storable: item.isStorable,
        basePurchasePrice: item.basePurchasePrice,
        resellMultiplier: item.resellMultiplier,
        requiredRank: item.requiredRank === null || item.requiredRankTier === null
            ? null
            : { label: rankLabel(item.requiredRank), tier: item.requiredRankTier },
        product: item.product === null ? null : {
            drugType: item.product.drugType,
            basePrice: item.product.basePrice,
            marketValue: item.product.marketValue,
            baseAddictiveness: item.product.baseAddictiveness,
            effectKeys: item.product.effectIds.map(effectKey),
            packagingKeys: item.product.validPackagingIds.map(itemKey),
        },
        packaging: item.packaging,
        additive: item.additive,
        soil: item.soil,
        mixingIngredient: item.mixingIngredient === null ? null : {
            effectKeys: item.mixingIngredient.effectIds.map(effectKey),
        },
        visualStatus: 'not-published',
    };
}

function compilePerson(
    person: Person,
    personKey: (sourceKey: string) => string
): PublicPerson {
    const roles = person.roles.map((role) => {
        if (role !== 'customer' && role !== 'dealer' && role !== 'supplier') {
            throw new Error(`Missing public person role mapping for ${role}`);
        }
        return role;
    });
    return {
        key: personKey(person.id),
        slug: slugify(person.name.full),
        label: requirePublicText(person.name.full, `${person.id} person name`),
        regionKeys: person.regions.map(regionKey),
        roles,
        defaultRelationship: person.defaultRelationship,
        displayRelationship: person.displayRelationship,
        scheduleStatus: 'not-published',
    };
}

function compileCustomer(
    customer: Customer,
    peopleBySourceKey: ReadonlyMap<string, Person>,
    customerKey: (sourceKey: string) => string,
    personKey: (sourceKey: string) => string,
    itemKey: (sourceKey: string) => string,
    effectKey: (sourceKey: string) => string
): PublicCustomer {
    const person = peopleBySourceKey.get(customer.id);
    if (person === undefined || person.name.full !== customer.name.full) {
        throw new Error(`Customer ${customer.id} does not match its person`);
    }
    return {
        key: customerKey(customer.id),
        personKey: personKey(customer.id),
        slug: slugify(customer.name.full),
        label: requirePublicText(customer.name.full, `${customer.id} customer name`),
        regionKey: regionKey(customer.region),
        standards: customer.standards,
        preferredEffectKeys: customer.preferredEffectIds.map(effectKey),
        drugAffinities: customer.drugAffinities,
        baseAddiction: customer.baseAddiction,
        dependenceMultiplier: customer.dependenceMultiplier,
        callPoliceChance: customer.callPoliceChance,
        canBeDirectlyApproached: customer.canBeDirectlyApproached,
        guaranteeFirstSampleSuccess: customer.guaranteeFirstSampleSuccess,
        weeklySpend: customer.weeklySpend,
        weeklyOrders: customer.weeklyOrders,
        preferredOrderDay: customer.preferredOrderDay,
        orderTime: customer.orderTime,
        mutualRelationshipRequirement: customer.mutualRelationshipRequirement,
        evaluation: customer.evaluationOracle.map((evaluation) => ({
            productKey: itemKey(evaluation.productId),
            productEnjoyment: evaluation.productEnjoyment,
            qualityEnjoyment: evaluation.qualityEnjoyment,
        })),
    };
}

function compileProperty(
    property: Property,
    propertyKey: (sourceKey: string) => string,
    visual: ProcessedPropertyAsset
): PublicProperty {
    const label = propertyPublicForms[property.code];
    if (label === undefined || property.name !== label) {
        throw new Error(`Missing or stale public property mapping for ${property.code}`);
    }
    if (!property.hasLayout) {
        throw new Error(`Property ${property.code} has no layout evidence`);
    }
    return {
        key: propertyKey(property.code),
        slug: slugify(label),
        label,
        price: property.price,
        employeeCapacity: property.employeeCapacity,
        loadingDockCount: property.loadingDockCount,
        gridCount: property.gridCount,
        ambientTemperature: property.ambientTemperature,
        ownedByDefault: property.ownedByDefault,
        business: property.business,
        layoutStatus: 'calculation-geometry-published',
        visual: {
            path: visual.path,
            sha256: visual.outputSha256,
            width: visual.width,
            height: visual.height,
            treatmentKey: visual.treatmentId,
        },
    };
}

function compileShop(
    shop: Shop,
    shopKey: (sourceKey: string) => string,
    itemKey: (sourceKey: string) => string,
    personKey: (sourceKey: string) => string
): PublicShop {
    const form = shopPublicForms[shop.code];
    if (form === undefined || shop.name !== form.label) {
        throw new Error(`Missing or stale public shop mapping for ${shop.code}`);
    }
    if (shop.paymentType !== 'Cash' && shop.paymentType !== 'Online') {
        throw new Error(`Missing public payment mapping for ${shop.paymentType}`);
    }
    const payment = shop.paymentType === 'Cash' ? 'cash' : 'online';
    return {
        key: shopKey(shop.code),
        slug: slugify(form.label),
        label: form.label,
        description: form.description,
        payment,
        holderPersonKey: shop.holderPersonId === null ? null : personKey(shop.holderPersonId),
        openTime: shop.openTime,
        closeTime: shop.closeTime,
        listings: shop.listings.map((listing) => ({
            itemKey: itemKey(listing.itemId),
            price: listing.price,
            defaultStock: listing.defaultStock,
            deliverable: listing.canBeDelivered,
        })),
    };
}

function compileBrowserMap(input: MapPublicationInput): BrowserMap {
    return {
        maps: input.maps.map((map) => ({
            key: map.id,
            label: map.label,
            markerCoverage: map.markerCoverage,
            asset: {
                path: map.image.path,
                sha256: map.image.outputSha256,
                width: map.image.width,
                height: map.image.height,
                treatmentKey: map.image.treatmentId,
            },
        })),
        canvas: input.canvas,
        projection: {
            mapKey: input.projection.mapId,
            origin: input.projection.origin,
            edge: input.projection.edge,
            mapDimensions: input.projection.mapDimensions,
            conversionFactor: input.projection.conversionFactor,
        },
        regions: input.regions.map((region) => ({
            mapKey: region.mapId,
            key: region.id,
            label: region.label,
            unlockedByDefault: region.unlockedByDefault,
            rankRequirement: region.rankRequirement === null
                ? null
                : rankLabel(region.rankRequirement),
            polygon: region.polygon,
        })),
        markerKinds: input.markerKinds,
        markers: input.markers.map((marker) => ({
            mapKey: marker.mapId,
            key: marker.id,
            kind: marker.kind,
            label: marker.label,
            description: marker.description,
            positions: marker.positions.map((position) => ({
                state: position.state,
                label: position.label,
                regionKey: position.regionId,
                position: position.position,
                worldPosition: position.worldPosition,
            })),
        })),
        limitations: input.omissions.map((omission) => ({
            code: omissionCodes[omission.sourceFamily],
            count: omission.count,
            reason: omission.reason,
        })),
    };
}

function requireCompatibility(
    source: BrowserPublicationSource,
    mapInput: MapPublicationInput,
    propertyVisuals: ProcessedPropertyProvenance
): void {
    const expected = source.manifest;
    const actual = mapInput.compatibility;
    if (
        actual.gameVersion !== expected.gameVersion ||
        actual.normalizerVersion !== expected.normalizerVersion ||
        actual.datasetSha256 !== expected.datasetSha256
    ) {
        throw new Error('Map publication input and normalized dataset are not compatible');
    }
    if (
        propertyVisuals.source.gameVersion !== expected.gameVersion ||
        propertyVisuals.source.datasetSha256 !== expected.datasetSha256
    ) {
        throw new Error('Property visual provenance and normalized dataset are not compatible');
    }
}

function requirePropertyVisuals(
    source: BrowserPublicationSource,
    provenance: ProcessedPropertyProvenance
): ReadonlyMap<string, ProcessedPropertyAsset> {
    const assets = new Map<string, ProcessedPropertyAsset>();
    const paths = new Set<string>();
    for (const asset of provenance.assets) {
        if (assets.has(asset.propertyCode)) {
            throw new Error(`Duplicate property visual for ${asset.propertyCode}`);
        }
        if (!paths.add(asset.path)) {
            throw new Error(`Duplicate property visual path ${asset.path}`);
        }
        assets.set(asset.propertyCode, asset);
    }
    const expected = new Set(source.properties.map((property) => property.code));
    const unknown = [...assets.keys()].filter((propertyCode) => !expected.has(propertyCode));
    const missing = [...expected].filter((propertyCode) => !assets.has(propertyCode));
    if (unknown.length > 0 || missing.length > 0 || assets.size !== expected.size) {
        throw new Error(
            `Property visual coverage mismatch: missing ${missing.sort().join(', ') || 'none'}; ` +
            `unknown ${unknown.sort().join(', ') || 'none'}`
        );
    }
    return assets;
}

function rankLabel(sourceRank: string): string {
    return requirePublicText(sourceRank.replaceAll('_', ' '), `rank ${sourceRank}`);
}

function regionKey(sourceRegion: string): string {
    const key = regionPublicForms[sourceRegion];
    if (key === undefined) {
        throw new Error(`Missing public region mapping for ${sourceRegion}`);
    }
    return key;
}

function slugify(label: string): string {
    const slug = label
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, '-')
        .replace(/^-|-$/gu, '');
    if (slug.length === 0) {
        throw new Error(`Cannot create a public slug for ${label}`);
    }
    return slug;
}

function requirePublicText(value: string, label: string): string {
    const result = value.trim();
    if (result.length === 0) {
        throw new Error(`${label} has no approved public text`);
    }
    return result;
}

function optionalPublicText(value: string): string | null {
    const result = value.trim();
    return result.length === 0 ? null : result;
}

function sortBy<T>(values: T[], key: (value: T) => string): void {
    values.sort((left, right) => key(left).localeCompare(key(right)));
}

const featureCoverage = [
    {
        key: 'recipe-calculator-search',
        label: 'Recipe calculator and search',
        artifactStatus: 'included',
        note: 'Inputs, search controls, results, proof classes, and limitations are included.',
    },
    {
        key: 'customer-planner',
        label: 'Customer planner',
        artifactStatus: 'included',
        note: 'All 66 profiles, shared evaluation constants, and result proof are included.',
    },
    {
        key: 'dealer-planner',
        label: 'Dealer planner',
        artifactStatus: 'included',
        note: 'Recruitable dealer mechanics, travel inputs, and result proof are included.',
    },
    {
        key: 'relationships-progression',
        label: 'Relationships and progression',
        artifactStatus: 'included',
        note: 'The person graph, thresholds, rank levels, eligibility results, and proof are included.',
    },
    {
        key: 'production-planner',
        label: 'Production planner',
        artifactStatus: 'included',
        note: 'Recipes, cycles, stations, operation rules, results, and proof are included.',
    },
    {
        key: 'inventory-logistics',
        label: 'Inventory and logistics',
        artifactStatus: 'included',
        note: 'Slots, filters, roles, priorities, scheduling, routes, results, and proof are included.',
    },
    {
        key: 'properties-businesses',
        label: 'Properties and businesses',
        artifactStatus: 'included',
        note: 'Facts, calculation-safe layouts, processed property visuals, results, and proof are included.',
    },
    {
        key: 'blueprint-builder',
        label: 'Blueprint builder',
        artifactStatus: 'included',
        note: 'Calculation inputs, results, proof, local save rules, and public blueprint interchange are included.',
    },
    {
        key: 'interactive-map',
        label: 'Interactive map',
        artifactStatus: 'included',
        note: 'Processed map images, regions, markers, and dealer states are included.',
    },
    {
        key: 'routes-travel',
        label: 'Routes and travel',
        artifactStatus: 'included',
        note: 'Bounded estimates, dealer inputs, results, proof, and exclusions are included; raw graphs and live navigation are not.',
    },
    {
        key: 'evidence-compatibility',
        label: 'Evidence and compatibility',
        artifactStatus: 'included',
        note: 'Version, dataset, request, proof, coverage, and incompatibility results are explicit.',
    },
    {
        key: 'saved-plans',
        label: 'Saved inventories, progression, checklists, and blueprints',
        artifactStatus: 'not-game-data',
        note: 'Versioned local profiles, private exports, optional explicit account sync, and deletion rules are included. User records are created by the application.',
    },
    {
        key: 'sharing-exports',
        label: 'Shareable recipes, blueprints, and exports',
        artifactStatus: 'not-game-data',
        note: 'Versioned content-addressed recipe and blueprint shares and private profile exports are included.',
    },
    {
        key: 'community-content',
        label: 'Community recipes and blueprints',
        artifactStatus: 'not-game-data',
        note: 'Authorship, visibility, deduplication, reporting, moderation, retention, and deletion contracts are included.',
    },
    {
        key: 'accounts',
        label: 'Accounts',
        artifactStatus: 'not-game-data',
        note: 'Opaque identity, external authentication and recovery, ownership, export, optional sync, and deletion contracts are included.',
    },
    {
        key: 'live-save-sync',
        label: 'Live save sync and mod connectivity',
        artifactStatus: 'not-game-data',
        note: 'Read-only observation, explicit reviewed apply, stale-state rejection, retry, retention, and deletion rules are included.',
    },
] as const;
