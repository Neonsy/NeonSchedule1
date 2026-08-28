import { createHash } from 'node:crypto';

import {
    projectWorldToMapPixel,
    type MapImage,
    type MapService,
    type Person,
    type Vector3,
    type WorldRegion,
} from '@neonschedule1/core';

import type { MapPublicationSource } from '#public-data/map/dataset';
import {
    MapPublicationInputSchema,
    type MapPublicationInput,
    type ProcessedMapAsset,
    type ProcessedMapProvenance,
    type PublicMapMarker,
    type PublicMapMarkerKind,
    type PublicMapMarkerPosition,
    type PublicMapOmission,
    type PublicMapRegion,
} from '#public-data/map/input';

const regionPublicForms = {
    Docks: { id: 'docks', label: 'Docks' },
    Downtown: { id: 'downtown', label: 'Downtown' },
    Northtown: { id: 'northtown', label: 'Northtown' },
    Suburbia: { id: 'suburbia', label: 'Suburbia' },
    Uptown: { id: 'uptown', label: 'Uptown' },
    Westville: { id: 'westville', label: 'Westville' },
} as const;

const markerKindLabels = [
    { kind: 'property', label: 'Properties' },
    { kind: 'shop', label: 'Shops' },
    { kind: 'customer', label: 'Customers' },
    { kind: 'dealer', label: 'Dealers' },
    { kind: 'atm', label: 'ATMs' },
    { kind: 'barbershop', label: 'Barbershops' },
    { kind: 'blackjack-table', label: 'Blackjack tables' },
    { kind: 'cash-for-trash', label: 'Cash for trash' },
    { kind: 'dead-drop', label: 'Dead drops' },
    { kind: 'parking', label: 'Parking' },
    { kind: 'pawn-shop', label: 'Pawn shops' },
    { kind: 'pay-phone', label: 'Pay phones' },
    { kind: 'skateboard-seller', label: 'Skateboard sellers' },
    { kind: 'slot-machine', label: 'Slot machines' },
    { kind: 'supplier-meetup', label: 'Supplier meetups' },
    { kind: 'supplier-stash', label: 'Supplier stashes' },
    { kind: 'tattoo-shop', label: 'Tattoo shops' },
    { kind: 'vehicle-dealership', label: 'Vehicle dealerships' },
    { kind: 'vehicle-repaint', label: 'Vehicle repainting' },
    { kind: 'vending-machine', label: 'Vending machines' },
] as const satisfies readonly { readonly kind: PublicMapMarkerKind; readonly label: string }[];

export interface ServicePublicContent {
    readonly kind: PublicMapMarkerKind;
    readonly label: string;
    readonly description: string | null;
}

const fixedServicePublicForms: Readonly<Record<string, ServicePublicContent>> = {
    atm: { kind: 'atm', label: 'ATM', description: null },
    barbershop: { kind: 'barbershop', label: 'Barbershop', description: null },
    'blackjack-table': { kind: 'blackjack-table', label: 'Blackjack table', description: null },
    'cash-for-trash': { kind: 'cash-for-trash', label: 'Cash for trash', description: null },
    'parking-lot': { kind: 'parking', label: 'Parking', description: null },
    'pawn-shop': { kind: 'pawn-shop', label: 'Pawn shop', description: null },
    'pay-phone': { kind: 'pay-phone', label: 'Pay phone', description: null },
    'skateboard-seller': {
        kind: 'skateboard-seller',
        label: 'Skateboard seller',
        description: null,
    },
    'slot-machine': { kind: 'slot-machine', label: 'Slot machine', description: null },
    'tattoo-shop': { kind: 'tattoo-shop', label: 'Tattoo shop', description: null },
    'vehicle-dealership': {
        kind: 'vehicle-dealership',
        label: 'Vehicle dealership',
        description: null,
    },
    'vehicle-repaint': {
        kind: 'vehicle-repaint',
        label: 'Vehicle repainting',
        description: null,
    },
    'vending-machine': {
        kind: 'vending-machine',
        label: 'Vending machine',
        description: null,
    },
};

const namedServiceKinds: Readonly<Record<string, PublicMapMarkerKind>> = {
    'dead-drop': 'dead-drop',
    'supplier-meetup': 'supplier-meetup',
    'supplier-stash': 'supplier-stash',
};

const propertyPublicForms: Readonly<Record<string, string>> = {
    barn: 'Barn',
    bungalow: 'Bungalow',
    carwash: 'Car Wash',
    dockswarehouse: 'Docks Warehouse',
    laundromat: 'Laundromat',
    manor: 'Hyland Manor',
    motelroom: 'Motel Room',
    postoffice: 'Post Office',
    rv: 'RV',
    seweroffice: 'Sewer Office',
    storageunit: 'Storage Unit',
    sweatshop: 'Sweatshop',
    tacoticklers: 'Taco Ticklers',
};

const shopPublicForms: Readonly<Record<string, {
    readonly label: string;
    readonly description: string | null;
}>> = {
    armsdealer: { label: 'Arms Dealer', description: 'Guns and ammo' },
    boutique: { label: "Bleuball's Boutique", description: 'General illegal supplies' },
    dans_hardware: { label: "Dan's Hardware", description: 'General legal supplies' },
    gas_mart_central: {
        label: 'Gas-Mart (Central)',
        description: 'Ingredients and packaging',
    },
    gas_mart_west: {
        label: 'Gas-Mart (West)',
        description: 'Ingredients and packaging',
    },
    handy_hanks: { label: "Handy Hank's Hardware", description: 'General legal supplies' },
    shop: { label: "Oscar's Store", description: 'General illegal supplies' },
    thrifty_threads: { label: 'Thrifty Threads', description: null },
};

export function compileMapPublicationInput(
    source: MapPublicationSource,
    provenance: ProcessedMapProvenance
): MapPublicationInput {
    const mainMap = requireMap(source.map.mainMap, 'main');
    const tutorialMap = requireMap(source.map.tutorialMap, 'tutorial');
    const assetsById = new Map(provenance.assets.map((asset) => [asset.mapId, asset]));
    if (provenance.assets.length !== 2 || assetsById.size !== provenance.assets.length) {
        throw new Error('Processed map provenance must contain two unique map assets');
    }
    const mainAsset = requireProcessedAsset(assetsById, 'hyland-point', mainMap);
    const tutorialAsset = requireProcessedAsset(assetsById, 'tutorial-area', tutorialMap);

    const regions = compileRegions(source.map.regions, source.map.projection, mainMap);
    const regionBySourceId = new Map(
        regions.map((region) => [region.source.regionId, region.id])
    );
    const peopleById = new Map(source.people.map((person) => [person.id, person]));
    if (peopleById.size !== source.people.length) {
        throw new Error('Person source IDs must be unique');
    }

    const markers: PublicMapMarker[] = [];
    for (const property of source.properties) {
        const label = propertyPublicForms[property.code];
        if (label === undefined) {
            throw new Error(`Missing public map property mapping for ${property.code}`);
        }
        if (property.name !== label) {
            throw new Error(
                `Property ${property.code} source name changed from ${label} to ${property.name}`
            );
        }
        markers.push(createMarker({
            family: 'property',
            sourceKey: property.code,
            kind: 'property',
            label,
            description: null,
            positions: [defaultPosition(property.position)],
            regions: source.map.regions,
            regionBySourceId,
            projection: source.map.projection,
            image: mainMap,
        }));
    }

    const unpositionedShops = source.shops.filter((shop) => shop.position === null);
    for (const shop of source.shops) {
        if (shop.position === null) continue;
        const publicForm = shopPublicForms[shop.code];
        if (publicForm === undefined) {
            throw new Error(`Missing public map shop mapping for ${shop.code}`);
        }
        if (shop.name !== publicForm.label) {
            throw new Error(
                `Shop ${shop.code} source name changed from ${publicForm.label} to ${shop.name}`
            );
        }
        markers.push(createMarker({
            family: 'shop',
            sourceKey: shop.code,
            kind: 'shop',
            label: publicForm.label,
            description: publicForm.description,
            positions: [defaultPosition(shop.position)],
            regions: source.map.regions,
            regionBySourceId,
            projection: source.map.projection,
            image: mainMap,
        }));
    }

    const npcLocations = source.locations.locations.filter(
        (location) => location.sourceKind === 'npc-poi'
    );
    const npcLocationsByPerson = Map.groupBy(npcLocations, (location) =>
        requirePublicText(location.personId ?? '', `NPC marker ${location.sourceId} person`)
    );
    for (const [personId, locations] of npcLocationsByPerson) {
        const person = peopleById.get(personId);
        if (person === undefined) {
            throw new Error(`NPC marker references unknown person ${personId}`);
        }
        markers.push(createMarker({
            family: 'person',
            sourceKey: person.id,
            kind: personMarkerKind(person),
            label: requirePublicText(person.name.full, `Person ${person.id} name`),
            description: null,
            positions: personMarkerPositions(person, locations),
            regions: source.map.regions,
            regionBySourceId,
            projection: source.map.projection,
            image: mainMap,
        }));
    }

    const visualOnlyServices = source.locations.services.filter(
        (service) => service.kind === 'pay-phone-visual'
    );
    for (const service of source.locations.services) {
        if (service.kind === 'pay-phone-visual') continue;
        const content = servicePublicContent(service);
        markers.push(createMarker({
            family: 'service',
            sourceKey: service.id,
            ...content,
            positions: [defaultPosition(service.position)],
            regions: source.map.regions,
            regionBySourceId,
            projection: source.map.projection,
            image: mainMap,
        }));
    }

    markers.sort((left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.label.localeCompare(right.label) ||
        left.id.localeCompare(right.id)
    );
    requireUnique(markers.map((marker) => marker.id), 'Public marker IDs');

    const genericLocations = source.locations.locations.filter(
        (location) => location.sourceKind === 'poi'
    );
    const serviceMirrorLocations = source.locations.locations.filter(
        (location) => location.sourceKind.startsWith('map-service-')
    );
    const propertyMirrorLocations = source.locations.locations.filter(
        (location) => location.sourceKind === 'property'
    );
    const shopMirrorLocations = source.locations.locations.filter(
        (location) => location.sourceKind === 'shop'
    );
    const knownLocationCount = genericLocations.length + serviceMirrorLocations.length +
        propertyMirrorLocations.length + shopMirrorLocations.length + npcLocations.length;
    if (knownLocationCount !== source.locations.locations.length) {
        const unknownKinds = [...new Set(source.locations.locations
            .filter((location) =>
                location.sourceKind !== 'poi' &&
                location.sourceKind !== 'npc-poi' &&
                location.sourceKind !== 'property' &&
                location.sourceKind !== 'shop' &&
                !location.sourceKind.startsWith('map-service-')
            )
            .map((location) => location.sourceKind))].sort();
        throw new Error(`Missing publication rules for world location kinds: ${unknownKinds.join(', ')}`);
    }
    const omissions: PublicMapOmission[] = [
        {
            sourceFamily: 'world.locations.poi',
            count: genericLocations.length,
            reason: 'Runtime, task, vehicle, and private player markers are not public map facts.',
        },
        {
            sourceFamily: 'world.locations.property-mirror',
            count: propertyMirrorLocations.length,
            reason: 'Property locations duplicate the canonical property records.',
        },
        {
            sourceFamily: 'world.locations.shop-mirror',
            count: shopMirrorLocations.length,
            reason: 'Shop locations duplicate the canonical shop records.',
        },
        {
            sourceFamily: 'world.locations.service-mirror',
            count: serviceMirrorLocations.length,
            reason: 'Service mirror locations duplicate the canonical service records.',
        },
        {
            sourceFamily: 'shops.unpositioned',
            count: unpositionedShops.length,
            reason: 'These shop records have no verified map position.',
        },
        {
            sourceFamily: 'world.services.visual-only',
            count: visualOnlyServices.length,
            reason: 'Visual-only pay phone models do not prove a working service.',
        },
    ];

    return MapPublicationInputSchema.assert({
        schema: 'neonschedule1-map-publication-input-1',
        compatibility: {
            gameVersion: source.manifest.gameVersion,
            normalizerVersion: source.manifest.normalizerVersion,
            datasetSha256: source.manifest.datasetSha256,
        },
        maps: [
            {
                id: 'hyland-point',
                label: 'Hyland Point',
                markerCoverage: 'mapped',
                image: publicAsset(mainAsset),
            },
            {
                id: 'tutorial-area',
                label: 'Tutorial area',
                markerCoverage: 'none',
                image: publicAsset(tutorialAsset),
            },
        ],
        canvas: { width: mainMap.width, height: mainMap.height },
        projection: {
            mapId: 'hyland-point',
            origin: { x: source.map.projection.origin.x, z: source.map.projection.origin.z },
            edge: { x: source.map.projection.edge.x, z: source.map.projection.edge.z },
            mapDimensions: source.map.projection.mapDimensions,
            conversionFactor: source.map.projection.conversionFactor,
        },
        regions,
        markerKinds: [...markerKindLabels],
        markers,
        omissions,
    } satisfies MapPublicationInput);
}

export function servicePublicContent(service: MapService): ServicePublicContent {
    const fixed = fixedServicePublicForms[service.kind];
    if (fixed !== undefined) return fixed;
    const kind = namedServiceKinds[service.kind];
    if (kind !== undefined) {
        return {
            kind,
            label: requirePublicText(service.name, `${service.kind} ${service.id} name`),
            description: requirePublicText(
                service.description,
                `${service.kind} ${service.id} description`
            ),
        };
    }
    throw new Error(`Missing public map service mapping for ${service.kind}`);
}

function compileRegions(
    sourceRegions: readonly WorldRegion[],
    projection: MapPublicationSource['map']['projection'],
    image: MapImage
): PublicMapRegion[] {
    const regions = sourceRegions.map((region): PublicMapRegion => {
        const publicForm = regionPublicForms[region.id as keyof typeof regionPublicForms];
        if (publicForm === undefined) {
            throw new Error(`Missing public map region mapping for ${region.id}`);
        }
        if (region.name !== publicForm.label) {
            throw new Error(
                `Region ${region.id} source name changed from ${publicForm.label} to ${region.name}`
            );
        }
        if (region.polygonPoints.length < 3) {
            throw new Error(`Region ${region.id} needs at least three polygon points`);
        }
        return {
            mapId: 'hyland-point',
            ...publicForm,
            unlockedByDefault: region.unlockedByDefault,
            rankRequirement: region.rankRequirement,
            polygon: region.polygonPoints.map((point) =>
                finitePixel(projectWorldToMapPixel(point, projection, image), `Region ${region.id}`)
            ),
            source: { regionId: region.id },
        };
    });
    requireUnique(regions.map((region) => region.id), 'Public region IDs');
    if (regions.length !== Object.keys(regionPublicForms).length) {
        throw new Error(
            `Expected ${Object.keys(regionPublicForms).length} mapped regions, found ${regions.length}`
        );
    }
    return regions.sort((left, right) => left.label.localeCompare(right.label));
}

interface CreateMarkerOptions extends ServicePublicContent {
    readonly family: PublicMapMarker['source']['family'];
    readonly sourceKey: string;
    readonly positions: readonly SourceMarkerPosition[];
    readonly regions: readonly WorldRegion[];
    readonly regionBySourceId: ReadonlyMap<string, string>;
    readonly projection: MapPublicationSource['map']['projection'];
    readonly image: MapImage;
}

function createMarker(options: CreateMarkerOptions): PublicMapMarker {
    if (options.positions.length === 0) {
        throw new Error(`${options.family} ${options.sourceKey} has no map position`);
    }
    const positions = options.positions.map((entry): PublicMapMarkerPosition => {
        const regionIds = options.regions
            .filter((region) => pointInPolygon(entry.position, region.polygonPoints))
            .map((region) => region.id);
        if (regionIds.length > 1) {
            throw new Error(
                `${options.family} ${options.sourceKey} belongs to multiple regions: ` +
                    `${regionIds.join(', ')}`
            );
        }
        const sourceRegionId = regionIds[0];
        const regionId = sourceRegionId === undefined
            ? null
            : options.regionBySourceId.get(sourceRegionId);
        if (sourceRegionId !== undefined && regionId === undefined) {
            throw new Error(`Missing public region identity for ${sourceRegionId}`);
        }
        return {
            state: entry.state,
            label: entry.label,
            regionId: regionId ?? null,
            position: checkedPixel(
                projectWorldToMapPixel(entry.position, options.projection, options.image),
                options.image,
                `${options.family} ${options.sourceKey}`
            ),
            worldPosition: { x: entry.position.x, z: entry.position.z },
        };
    });
    requireUnique(positions.map((position) => position.state), `${options.sourceKey} position states`);
    return {
        mapId: 'hyland-point',
        id: stableMarkerId(options.family, options.sourceKey),
        kind: options.kind,
        label: options.label,
        description: options.description,
        positions,
        source: { family: options.family, key: options.sourceKey },
    };
}

function personMarkerKind(person: Person): 'customer' | 'dealer' {
    if (person.roles.length !== 1) {
        throw new Error(`NPC marker person ${person.id} has ambiguous roles: ${person.roles.join(', ')}`);
    }
    if (person.roles[0] === 'customer') return 'customer';
    if (person.roles[0] === 'dealer') return 'dealer';
    throw new Error(`NPC marker person ${person.id} has unsupported role ${person.roles[0]}`);
}

interface SourceMarkerPosition {
    readonly state: PublicMapMarkerPosition['state'];
    readonly label: string | null;
    readonly position: Vector3;
}

function defaultPosition(position: Vector3): SourceMarkerPosition {
    return { state: 'default', label: null, position };
}

function personMarkerPositions(
    person: Person,
    locations: readonly MapPublicationSource['locations']['locations'][number][]
): SourceMarkerPosition[] {
    if (person.roles[0] === 'customer') {
        if (locations.length !== 1) {
            throw new Error(`Customer ${person.id} must have exactly one NPC marker`);
        }
        return [defaultPosition(requirePosition(
            locations[0]!.position,
            `NPC marker ${locations[0]!.sourceId}`
        ))];
    }
    if (person.roles[0] !== 'dealer' || locations.length !== 2) {
        throw new Error(`Dealer ${person.id} must have potential-dealer and dealer markers`);
    }
    return locations.map((location): SourceMarkerPosition => {
        const potentialName = `Potential Dealer\n${person.name.full}`;
        const dealerName = `${person.name.full}\n(Dealer)`;
        if (location.name === potentialName) {
            return {
                state: 'potential-dealer',
                label: 'Potential dealer',
                position: requirePosition(location.position, `NPC marker ${location.sourceId}`),
            };
        }
        if (location.name === dealerName) {
            return {
                state: 'dealer',
                label: 'Dealer',
                position: requirePosition(location.position, `NPC marker ${location.sourceId}`),
            };
        }
        throw new Error(`Dealer ${person.id} has an unknown NPC marker state`);
    }).sort((left, right) => left.state.localeCompare(right.state));
}

function pointInPolygon(point: Vector3, polygon: readonly Vector3[]): boolean {
    let inside = false;
    for (let currentIndex = 0, previousIndex = polygon.length - 1;
        currentIndex < polygon.length;
        previousIndex = currentIndex++) {
        const current = polygon[currentIndex]!;
        const previous = polygon[previousIndex]!;
        if (pointOnSegment(point, previous, current)) return true;
        const crosses = (current.z > point.z) !== (previous.z > point.z) &&
            point.x < (previous.x - current.x) * (point.z - current.z) /
                (previous.z - current.z) + current.x;
        if (crosses) inside = !inside;
    }
    return inside;
}

function pointOnSegment(point: Vector3, start: Vector3, end: Vector3): boolean {
    const cross = (point.z - start.z) * (end.x - start.x) -
        (point.x - start.x) * (end.z - start.z);
    if (Math.abs(cross) > 1e-8) return false;
    const dot = (point.x - start.x) * (end.x - start.x) +
        (point.z - start.z) * (end.z - start.z);
    if (dot < 0) return false;
    const squaredLength = (end.x - start.x) ** 2 + (end.z - start.z) ** 2;
    return dot <= squaredLength;
}

function checkedPixel(
    point: { readonly x: number; readonly y: number },
    image: MapImage,
    label: string
): { readonly x: number; readonly y: number } {
    if (
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < 0 ||
        point.y < 0 ||
        point.x > image.width ||
        point.y > image.height
    ) {
        throw new RangeError(`${label} projects outside the map image at ${point.x}, ${point.y}`);
    }
    return point;
}

function finitePixel(
    point: { readonly x: number; readonly y: number },
    label: string
): { readonly x: number; readonly y: number } {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        throw new RangeError(`${label} projects to a non-finite map position`);
    }
    return point;
}

function stableMarkerId(family: string, sourceKey: string): string {
    return `marker-${createHash('sha256')
        .update(`${family}\0${sourceKey}`, 'utf8')
        .digest('hex')
        .slice(0, 20)}`;
}

function requireMap(map: MapImage | null, label: string): MapImage {
    if (map === null) throw new Error(`Normalized dataset has no ${label} map`);
    return map;
}

function requireProcessedAsset(
    assets: ReadonlyMap<string, ProcessedMapAsset>,
    mapId: 'hyland-point' | 'tutorial-area',
    source: MapImage
): ProcessedMapAsset {
    const asset = assets.get(mapId);
    if (asset === undefined) throw new Error(`Processed map provenance has no ${mapId} asset`);
    if (asset.sourceSha256 !== source.fileId) {
        throw new Error(
            `${mapId} source mismatch: map has ${source.fileId}, provenance has ${asset.sourceSha256}`
        );
    }
    if (asset.width !== source.width || asset.height !== source.height) {
        throw new Error(
            `${mapId} dimensions changed from ${source.width}x${source.height} to ` +
                `${asset.width}x${asset.height}`
        );
    }
    return asset;
}

function publicAsset(asset: ProcessedMapAsset): ProcessedMapAsset {
    return {
        mapId: asset.mapId,
        path: asset.path,
        sourceSha256: asset.sourceSha256,
        outputSha256: asset.outputSha256,
        width: asset.width,
        height: asset.height,
        treatmentId: asset.treatmentId,
    };
}

function requirePosition(position: Vector3 | null, label: string): Vector3 {
    if (position === null) throw new Error(`${label} has no position`);
    return position;
}

function requirePublicText(value: string, label: string): string {
    const trimmed = value.trim();
    if (trimmed.length === 0) throw new Error(`${label} has no approved public text`);
    return trimmed;
}

function requireUnique(values: readonly string[], label: string): void {
    if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`);
}
