import { type } from 'arktype';

import {
    PublicKeySchema,
    SlugSchema,
    Vector3Schema,
} from '#public-data/browser/common-schema';

const PublicTravelLimitationSchema = type({
    code: SlugSchema,
    label: 'string',
    explanation: 'string',
});

const PublicDealerRuntimeInputSchema = type("'current-dealer-origin'")
    .or("'delivery-window-start-time'")
    .or("'minutes-until-delivery-window-start'");

const PublicDealerHomeSchema = type({
    personKey: PublicKeySchema,
    label: 'string',
    position: Vector3Schema,
});

const PublicDeliveryLocationSchema = type({
    key: PublicKeySchema,
    position: Vector3Schema,
});

const PublicDealerTravelSchema = type({
    method: "'native-straight-line-walk-speed'",
    feasibilityPolicy: "'worst-case-regional-delivery-location'",
    currentOriginInput: "'caller-supplied-current-position'",
    staticHomeUsage: "'reference-only-not-current-position'",
    requiredRuntimeInputs: PublicDealerRuntimeInputSchema.array(),
    homes: PublicDealerHomeSchema.array(),
    regions: type({
        regionKey: SlugSchema,
        deliveryLocations: PublicDeliveryLocationSchema.array(),
    }).array(),
    limitations: PublicTravelLimitationSchema.array(),
    proof: {
        staticGameData: "'complete'",
        liveState: "'runtime-input-required'",
        resultContract: "'published-in-calculation-contract-catalog'",
    },
    counts: {
        dealerHomes: 'number',
        regions: 'number',
        distinctDeliveryLocations: 'number',
        regionalDeliveryLocationAssignments: 'number',
    },
});

const PublicVehicleRouteEndpointSchema = type({
    key: PublicKeySchema,
    graphRole: "'general' | 'road'",
    subjectKind: "'property-spawn' | 'shop-position' | 'delivery-bay'",
    propertyKey: PublicKeySchema.or('null'),
    shopKey: PublicKeySchema.or('null'),
    position: Vector3Schema,
    graphPosition: Vector3Schema,
    projectionMethod: "'triangle-surface' | 'node-position'",
    nodeCenterDistance: 'number',
    graphDistance: 'number',
});

const PublicVehicleRouteEstimateSchema = type({
    sourceEndpointKey: PublicKeySchema,
    destinationEndpointKey: PublicKeySchema,
    networkDistance: 'number',
    points: Vector3Schema.array(),
});

const PublicVehicleRouteResultSchema = type({
    propertyKey: PublicKeySchema,
    shopKey: PublicKeySchema,
    planningStatus: "'estimate-available' | 'estimate-unavailable'",
    unavailableReason: "'unmapped-endpoint' | 'directed-disconnection' | null",
    estimate: PublicVehicleRouteEstimateSchema.or('null'),
});

const PublicVehicleRouteLayerSchema = type({
    graphRole: "'general' | 'road'",
    label: 'string',
    explanation: 'string',
    results: PublicVehicleRouteResultSchema.array(),
    counts: {
        results: 'number',
        available: 'number',
        unavailable: 'number',
        routePoints: 'number',
    },
});

const PublicVehiclePropertyShopTravelSchema = type({
    routeKind: "'static-planning-estimate'",
    pairBasis: "'every-mapped-property-by-every-mapped-shop'",
    graphRoleSelection: "'caller-selected'",
    pathDirection: "'directed'",
    estimateSelection:
        "'minimum-network-distance-then-endpoint-order-within-selected-layer'",
    distanceMethod: "'node-center-euclidean-3d'",
    distanceScope: "'directed-graph-edges-only'",
    routeProofStatus: "'incomplete'",
    endpoints: PublicVehicleRouteEndpointSchema.array(),
    layers: PublicVehicleRouteLayerSchema.array(),
    unavailableReasons: PublicTravelLimitationSchema.array(),
    exclusions: PublicTravelLimitationSchema.array(),
    proof: {
        selectedEstimates: "'published'",
        unavailableResults: "'published'",
        endpointAccess: "'unproven'",
        layerComposition: "'excluded-selected-layer-only'",
        nativePathChoice: "'unproven'",
        rawCosts: "'not-used'",
        rawNavigationGraphs: "'not-published'",
        liveNavigation: "'not-published'",
        resultContract: "'published-in-calculation-contract-catalog'",
    },
    counts: {
        properties: 'number',
        shops: 'number',
        endpoints: 'number',
        layerResults: 'number',
        availableEstimates: 'number',
        unavailableResults: 'number',
        routePoints: 'number',
    },
});

export const PublicTravelSchema = type({
    dealer: PublicDealerTravelSchema,
    vehiclePropertyShop: PublicVehiclePropertyShopTravelSchema,
});
export type PublicTravel = typeof PublicTravelSchema.infer;
