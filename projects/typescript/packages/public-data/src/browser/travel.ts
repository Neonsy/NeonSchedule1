import {
    DealerTravelFeasibilityResolver,
    planStaticVehiclePropertyShopRoutes,
    type VehicleNavigationEndpointMapping,
    type VehicleRouteEndpoint,
    type VehicleRoutePlanExclusion,
    type VehiclePropertyShopRoutePlanReport,
    type WorldLocation,
} from '@neonschedule1/core';

import type { BrowserPublicationSource } from '#public-data/browser/dataset';
import {
    createPublicKeyResolver,
    requireUnique,
} from '#public-data/browser/public-key';
import type { PublicTravel } from '#public-data/browser/travel-schema';

interface TravelKeyResolvers {
    readonly person: (sourceKey: string) => string;
    readonly property: (sourceKey: string) => string;
    readonly shop: (sourceKey: string) => string;
}

type TravelPublicationSource = Pick<
    BrowserPublicationSource,
    'people' | 'trade' | 'vehicleNavigation' | 'worldLocations' | 'worldMap'
>;

const graphRoles = ['general', 'road'] as const;

const regionPublicForms: Readonly<Record<string, string>> = {
    Docks: 'docks',
    Downtown: 'downtown',
    Northtown: 'northtown',
    Suburbia: 'suburbia',
    Uptown: 'uptown',
    Westville: 'westville',
};

const graphRoleContent = {
    general: {
        label: 'General vehicle layer',
        explanation: 'Uses only the selected general vehicle graph layer.',
    },
    road: {
        label: 'Road vehicle layer',
        explanation: 'Uses only the selected road vehicle graph layer.',
    },
} as const;

const unavailableReasonContent = [
    {
        code: 'unmapped-endpoint',
        label: 'Endpoint not mapped',
        explanation: 'The selected layer has no mapped source or destination endpoint.',
    },
    {
        code: 'directed-disconnection',
        label: 'No directed connection',
        explanation: 'No directed graph path connects the mapped endpoints in this layer.',
    },
] as const;

const exclusionContent: Readonly<Record<VehicleRoutePlanExclusion, {
    readonly label: string;
    readonly explanation: string;
}>> = {
    'endpoint-access-unproven': {
        label: 'Endpoint access unproven',
        explanation:
            'The graph route does not prove travel between each real endpoint and its mapped ' +
            'graph position.',
    },
    'graph-layer-composition-excluded': {
        label: 'Graph-layer composition excluded',
        explanation: 'Each estimate stays within one caller-selected graph layer.',
    },
    'native-path-selection-unproven': {
        label: 'Native path selection unproven',
        explanation:
            'The shortest geometric path is not claimed to match the game\'s native path choice.',
    },
    'parking-not-modeled': {
        label: 'Parking not modeled',
        explanation: 'The estimate does not choose or enter a parking location.',
    },
    'collision-avoidance-not-modeled': {
        label: 'Collision avoidance not modeled',
        explanation: 'The estimate does not model collision-avoidance behavior.',
    },
    'traffic-not-modeled': {
        label: 'Traffic not modeled',
        explanation: 'The estimate does not model traffic.',
    },
    'dynamic-obstacles-not-modeled': {
        label: 'Dynamic obstacles not modeled',
        explanation: 'The estimate does not model moving or temporary obstacles.',
    },
    'live-driving-not-modeled': {
        label: 'Live driving not modeled',
        explanation: 'The estimate is not live driving or turn-by-turn navigation.',
    },
};

export function compilePublicTravel(
    source: TravelPublicationSource,
    keys: TravelKeyResolvers
): PublicTravel {
    return {
        dealer: compileDealerTravel(source, keys.person),
        vehiclePropertyShop: compileVehiclePropertyShopTravel(source, keys),
    };
}

function compileDealerTravel(
    source: TravelPublicationSource,
    personKey: (sourceKey: string) => string
): PublicTravel['dealer'] {
    new DealerTravelFeasibilityResolver(source.trade, source.worldMap);
    const peopleById = new Map(source.people.map((person) => [person.id, person]));
    const npcLocationsByPerson = Map.groupBy(
        source.worldLocations.locations.filter((location) =>
            location.sourceKind === 'npc-poi' && location.personId !== null),
        (location) => location.personId!
    );
    const recruitableDealers = source.trade.dealers.filter(({ type }) => type === 'PlayerDealer');
    const homes = recruitableDealers.map((dealer) => {
        const person = peopleById.get(dealer.personId);
        if (person === undefined) {
            throw new Error(`Recruitable dealer references unknown person ${dealer.personId}`);
        }
        const home = requireDealerHome(
            person.name.full,
            npcLocationsByPerson.get(dealer.personId) ?? []
        );
        return {
            personKey: personKey(dealer.personId),
            label: requirePublicText(dealer.homeName, `${dealer.personId} dealer home`),
            position: home.position!,
        };
    }).sort((left, right) => left.personKey.localeCompare(right.personKey));
    requireUnique(homes.map(({ personKey: key }) => key), 'dealer travel home people');

    const distinctLocations = new Map<string, { x: number; y: number; z: number }>();
    for (const region of source.worldMap.regions) {
        for (const location of region.deliveryLocations) {
            const previous = distinctLocations.get(location.id);
            if (previous !== undefined && !samePosition(previous, location.position)) {
                throw new Error(`Delivery location ${location.id} has inconsistent positions`);
            }
            distinctLocations.set(location.id, location.position);
        }
    }
    const deliveryLocationKey = createPublicKeyResolver(
        'deliverylocation',
        [...distinctLocations.keys()].sort((left, right) => left.localeCompare(right))
    );
    const regions = source.worldMap.regions.map((region) => ({
        regionKey: requireRegionKey(region.id),
        deliveryLocations: region.deliveryLocations.map((location) => ({
            key: deliveryLocationKey(location.id),
            position: location.position,
        })).sort((left, right) => left.key.localeCompare(right.key)),
    })).sort((left, right) => left.regionKey.localeCompare(right.regionKey));

    return {
        method: 'native-straight-line-walk-speed',
        feasibilityPolicy: 'worst-case-regional-delivery-location',
        currentOriginInput: 'caller-supplied-current-position',
        staticHomeUsage: 'reference-only-not-current-position',
        requiredRuntimeInputs: [
            'current-dealer-origin',
            'delivery-window-start-time',
            'minutes-until-delivery-window-start',
        ],
        homes,
        regions,
        limitations: [
            {
                code: 'current-dealer-origin-required',
                label: 'Current dealer origin required',
                explanation: 'Feasibility requires the dealer\'s current runtime position.',
            },
            {
                code: 'home-position-reference-only',
                label: 'Home position is reference-only',
                explanation:
                    'A static home marker is not treated as the dealer\'s current position.',
            },
            {
                code: 'straight-line-not-pathfinding',
                label: 'Straight-line estimate',
                explanation: 'Dealer travel time uses straight-line distance, not pathfinding.',
            },
        ],
        proof: {
            staticGameData: 'complete',
            liveState: 'runtime-input-required',
            resultContract: 'published-in-calculation-contract-catalog',
        },
        counts: {
            dealerHomes: homes.length,
            regions: regions.length,
            distinctDeliveryLocations: distinctLocations.size,
            regionalDeliveryLocationAssignments: regions.reduce(
                (count, region) => count + region.deliveryLocations.length,
                0
            ),
        },
    };
}

function compileVehiclePropertyShopTravel(
    source: TravelPublicationSource,
    keys: TravelKeyResolvers
): PublicTravel['vehiclePropertyShop'] {
    const endpointSourceKeys = source.vehicleNavigation.endpointMappings.map((endpoint) =>
        endpointIdentity(endpoint.graphRole, endpoint));
    const endpointKey = createPublicKeyResolver('routeendpoint', endpointSourceKeys);
    const endpoints = source.vehicleNavigation.endpointMappings.map((endpoint) => ({
        key: endpointKey(endpointIdentity(endpoint.graphRole, endpoint)),
        graphRole: endpoint.graphRole,
        subjectKind: requireEndpointKind(endpoint.subjectKind),
        propertyKey: endpoint.subjectKind === 'property-spawn'
            ? keys.property(endpoint.subjectCode)
            : null,
        shopKey: endpoint.subjectKind === 'property-spawn'
            ? null
            : keys.shop(endpoint.subjectCode),
        position: endpoint.position,
        graphPosition: endpoint.graphPosition,
        projectionMethod: requireProjectionMethod(endpoint.projectionMethod),
        nodeCenterDistance: endpoint.nodeCenterDistance,
        graphDistance: endpoint.graphDistance,
    })).sort((left, right) => left.key.localeCompare(right.key));

    const reports = graphRoles.map((graphRole) =>
        planStaticVehiclePropertyShopRoutes(source.vehicleNavigation, graphRole));
    const layers = reports.map((report) => compileVehicleLayer(report, endpointKey, keys));
    const excludedBehavior = reports[0]!.excludedBehavior;
    for (const report of reports) requireSameValues(
        'vehicle route exclusions',
        excludedBehavior,
        report.excludedBehavior
    );
    const exclusions = excludedBehavior.map((code) => ({ code, ...exclusionContent[code] }));
    const counts = {
        properties: reports[0]!.propertyCodes.length,
        shops: reports[0]!.shopCodes.length,
        endpoints: endpoints.length,
        layerResults: layers.reduce((count, layer) => count + layer.counts.results, 0),
        availableEstimates: layers.reduce((count, layer) => count + layer.counts.available, 0),
        unavailableResults: layers.reduce((count, layer) => count + layer.counts.unavailable, 0),
        routePoints: layers.reduce((count, layer) => count + layer.counts.routePoints, 0),
    };

    return {
        routeKind: reports[0]!.routeKind,
        pairBasis: reports[0]!.pairBasis,
        graphRoleSelection: reports[0]!.graphRoleSelection,
        pathDirection: reports[0]!.pathDirection,
        estimateSelection: reports[0]!.estimateSelection,
        distanceMethod: reports[0]!.distanceMethod,
        distanceScope: reports[0]!.distanceScope,
        routeProofStatus: reports[0]!.routeProofStatus,
        endpoints,
        layers,
        unavailableReasons: unavailableReasonContent.map((reason) => ({ ...reason })),
        exclusions,
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
        counts,
    };
}

function compileVehicleLayer(
    report: VehiclePropertyShopRoutePlanReport,
    endpointKey: (sourceKey: string) => string,
    keys: TravelKeyResolvers
): PublicTravel['vehiclePropertyShop']['layers'][number] {
    const results = report.pairs.map((pair) => {
        const base = {
            propertyKey: keys.property(pair.propertyCode),
            shopKey: keys.shop(pair.shopCode),
            planningStatus: pair.planningStatus,
            unavailableReason: pair.unavailableReason,
        };
        if (pair.planningStatus === 'estimate-unavailable') {
            return { ...base, estimate: null };
        }
        return {
            ...base,
            estimate: {
                sourceEndpointKey: endpointKey(endpointIdentity(
                    report.graphRole,
                    pair.selectedEstimate.source
                )),
                destinationEndpointKey: endpointKey(
                    endpointIdentity(report.graphRole, pair.selectedEstimate.destination)
                ),
                networkDistance: pair.selectedEstimate.networkDistance,
                points: pair.selectedEstimate.points.map(({ position }) => position),
            },
        };
    });
    const available = results.filter(({ planningStatus }) =>
        planningStatus === 'estimate-available');
    return {
        graphRole: report.graphRole,
        ...graphRoleContent[report.graphRole],
        results,
        counts: {
            results: results.length,
            available: available.length,
            unavailable: results.length - available.length,
            routePoints: available.reduce(
                (count, result) => count + result.estimate!.points.length,
                0
            ),
        },
    };
}

function requireDealerHome(
    personName: string,
    locations: readonly WorldLocation[]
): WorldLocation {
    const expectedName = `${personName}\n(Dealer)`;
    const matching = locations.filter(({ name, position }) =>
        name === expectedName && position !== null);
    if (matching.length !== 1) {
        throw new Error(`${personName} must have exactly one positioned dealer home marker`);
    }
    return matching[0]!;
}

function endpointIdentity(
    graphRole: 'general' | 'road',
    endpoint: VehicleNavigationEndpointMapping | VehicleRouteEndpoint
): string {
    return [
        graphRole,
        endpoint.subjectKind,
        endpoint.subjectCode,
        endpoint.subjectInstanceKey,
        endpoint.endpointIndex,
    ].join('\0');
}

function requireEndpointKind(
    value: string
): 'property-spawn' | 'shop-position' | 'delivery-bay' {
    if (value === 'property-spawn' || value === 'shop-position' || value === 'delivery-bay') {
        return value;
    }
    throw new Error(`Unsupported public route endpoint kind ${value}`);
}

function requireProjectionMethod(value: string): 'triangle-surface' | 'node-position' {
    if (value === 'triangle-surface' || value === 'node-position') return value;
    throw new Error(`Unsupported public route projection method ${value}`);
}

function requireRegionKey(sourceId: string): string {
    const key = regionPublicForms[sourceId];
    if (key === undefined) throw new Error(`Missing public region mapping for ${sourceId}`);
    return key;
}

function requirePublicText(value: string, label: string): string {
    const result = value.trim();
    if (result.length === 0) throw new Error(`${label} has no approved public text`);
    return result;
}

function samePosition(
    left: { readonly x: number; readonly y: number; readonly z: number },
    right: { readonly x: number; readonly y: number; readonly z: number }
): boolean {
    return left.x === right.x && left.y === right.y && left.z === right.z;
}

function requireSameValues(
    label: string,
    expected: readonly string[],
    actual: readonly string[]
): void {
    if (
        expected.length !== actual.length ||
        expected.some((value, index) => value !== actual[index])
    ) {
        throw new Error(`${label} changed between graph layers`);
    }
}
