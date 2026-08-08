import {
    NavigationGraphSchema,
    WorldLocationCatalogSchema,
    WorldMapSchema,
    isNavigationSegmentLocallyTraversable,
    type MapImage,
    type MapService,
    type NavigationEdge,
    type NavigationGraph,
    type NavigationSample,
    type TimedAccessZone,
    type WorldLocation,
    type WorldLocationCatalog,
    type WorldMap,
    type WorldRegion,
} from '@neonschedule1/core';

import type { VerifiedAssets } from '#data-compiler/acquisition/assets';
import type { RawReport } from '#data-compiler/acquisition/types';
import { indexUnique, Integrity, requireReferences } from '#data-compiler/integrity';
import {
    asArray,
    asObject,
    booleanField,
    nullableStringField,
    numberField,
    objectArray,
    stringArrayField,
    stringField,
    vector3,
    type JsonObject,
} from '#data-compiler/json';
import {
    fileIdForDescriptor,
    nullableVector3,
} from '#data-compiler/normalize/shared';

export interface NormalizedWorld {
    readonly map: WorldMap;
    readonly locations: WorldLocationCatalog;
    readonly navigation: NavigationGraph;
}

export function normalizeWorld(
    report: RawReport,
    assets: VerifiedAssets,
    personIds: ReadonlySet<string>,
    shopCodes: ReadonlySet<string>,
    integrity: Integrity
): NormalizedWorld {
    const map = normalizeMap(report.discovery.map, assets, integrity);
    const regionIds = new Set(map.regions.map((region) => region.id));
    const locations = normalizeLocations(
        report,
        assets,
        regionIds,
        personIds,
        shopCodes,
        integrity
    );
    const navigation = normalizeNavigation(report.discovery.navigation, integrity);
    return { map, locations, navigation };
}

function normalizeMap(raw: JsonObject, assets: VerifiedAssets, integrity: Integrity): WorldMap {
    const regions = indexUnique(
        objectArray(raw.regions, 'report.discovery.map.regions'),
        'id',
        'report.discovery.map.regions',
        integrity
    );
    const normalizedRegions = [...regions.entries()]
        .map(([id, region]) => normalizeRegion(id, region, assets, integrity))
        .sort((left, right) => left.id.localeCompare(right.id));
    const regionIds = new Set(regions.keys());
    for (const region of normalizedRegions) {
        requireReferences(region.adjacentRegionIds, regionIds, `region ${region.id}`, integrity);
        for (const adjacentId of region.adjacentRegionIds) {
            const adjacent = normalizedRegions.find((candidate) => candidate.id === adjacentId);
            if (adjacent !== undefined && !adjacent.adjacentRegionIds.includes(region.id)) {
                integrity.addError(`Region adjacency ${region.id} -> ${adjacentId} is not reciprocal`);
            }
        }
    }
    integrity.check(
        'map contains regions',
        normalizedRegions.length > 0,
        'The exported map contains no regions'
    );

    const members = asObject(raw.positionUtilityMembers, 'report.discovery.map.positionUtilityMembers');
    const map: WorldMap = {
        schema: 'neonschedule1-world-map-1',
        mainMap: normalizeMapImage(raw.mainMapSprite, 'report.discovery.map.mainMapSprite', assets, integrity),
        tutorialMap: normalizeMapImage(
            raw.tutorialMapSprite,
            'report.discovery.map.tutorialMapSprite',
            assets,
            integrity
        ),
        projection: {
            origin: positionFromMember(
                stringField(members, 'OriginPoint', 'report.discovery.map.positionUtilityMembers'),
                'report.discovery.map.positionUtilityMembers.OriginPoint'
            ),
            edge: positionFromMember(
                stringField(members, 'EdgePoint', 'report.discovery.map.positionUtilityMembers'),
                'report.discovery.map.positionUtilityMembers.EdgePoint'
            ),
            mapDimensions: numericMember(members, 'MapDimensions'),
            conversionFactor: numericMember(members, 'conversionFactor'),
        },
        regions: normalizedRegions,
    };
    const edgeDistance = Math.hypot(
        map.projection.origin.x - map.projection.edge.x,
        map.projection.origin.z - map.projection.edge.z
    );
    const projectedHalfSpan = edgeDistance * map.projection.conversionFactor;
    integrity.check(
        'map projection calibration spans half the map',
        Math.abs(projectedHalfSpan - map.projection.mapDimensions / 2) <= 0.01,
        `Map origin-to-edge span projects to ${projectedHalfSpan}, expected ${map.projection.mapDimensions / 2}`
    );
    return WorldMapSchema.assert(map);
}

function normalizeMapImage(
    value: unknown,
    descriptorPath: string,
    assets: VerifiedAssets,
    integrity: Integrity
): MapImage | null {
    if (value === undefined || value === null) return null;
    const descriptor = asObject(value, descriptorPath);
    const fileId = fileIdForDescriptor(descriptor, descriptorPath, assets, integrity);
    if (fileId === null) return null;
    return {
        fileId,
        width: numberField(descriptor, 'width', descriptorPath),
        height: numberField(descriptor, 'height', descriptorPath),
    };
}

function normalizeRegion(
    id: string,
    raw: JsonObject,
    assets: VerifiedAssets,
    integrity: Integrity
): WorldRegion {
    const path = `report.discovery.map.regions[${JSON.stringify(id)}]`;
    return {
        id,
        name: stringField(raw, 'name', path),
        unlockedByDefault: booleanField(raw, 'unlockedByDefault', path),
        rankRequirement: nullableStringField(raw, 'rankRequirement', path),
        spriteFileId: fileIdForDescriptor(raw.sprite, `${path}.sprite`, assets, integrity),
        boundsPointA: nullableVector3(raw, 'boundsPointA', path),
        boundsPointB: nullableVector3(raw, 'boundsPointB', path),
        isClosed: booleanField(raw, 'isClosed', path),
        verticalSize: numberField(raw, 'verticalSize', path),
        polygonPoints: objectArray(raw.polygonPoints, `${path}.polygonPoints`).map((point, index) =>
            vector3(point, `${path}.polygonPoints[${index}]`)
        ),
        adjacentRegionIds: [...new Set(stringArrayField(raw, 'adjacentRegionIds', path))].sort(),
    };
}

function normalizeLocations(
    report: RawReport,
    assets: VerifiedAssets,
    regionIds: ReadonlySet<string>,
    personIds: ReadonlySet<string>,
    shopCodes: ReadonlySet<string>,
    integrity: Integrity
): WorldLocationCatalog {
    const locations = report.discovery.locations
        .filter((raw) => stringField(raw, 'kind', 'report.discovery.locations') !== 'person-position-in-loaded-save')
        .map((raw, index) => normalizeLocation(raw, index, assets, personIds, integrity))
        .sort(compareLocations);
    const services = report.discovery.mapServices
        .map((raw, index) => normalizeService(raw, index, regionIds, personIds, integrity))
        .sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
    validateUniqueServices(services, integrity);
    const timedAccessZones = report.discovery.timedAccessZones
        .map((raw, index) => normalizeTimedAccessZone(raw, index, shopCodes, integrity))
        .sort((left, right) => left.id.localeCompare(right.id));

    return WorldLocationCatalogSchema.assert({
        schema: 'neonschedule1-world-location-catalog-1',
        locations,
        services,
        timedAccessZones,
    } satisfies WorldLocationCatalog);
}

function normalizeLocation(
    raw: JsonObject,
    index: number,
    assets: VerifiedAssets,
    personIds: ReadonlySet<string>,
    integrity: Integrity
): WorldLocation {
    const path = `report.discovery.locations[${index}]`;
    const personId = nullableStringField(raw, 'personId', path);
    if (personId !== null) requireReferences([personId], personIds, `location ${index}`, integrity);
    const icons = objectArray(raw.icons, `${path}.icons`)
        .map((icon, iconIndex) => fileIdForDescriptor(icon, `${path}.icons[${iconIndex}]`, assets, integrity))
        .filter((fileId): fileId is string => fileId !== null);
    return {
        sourceKind: stringField(raw, 'kind', path),
        sourceId: stringField(raw, 'id', path),
        name: stringField(raw, 'name', path),
        description: stringField(raw, 'description', path),
        sceneName: stringField(raw, 'sceneName', path),
        position: nullableVector3(raw, 'position', path),
        rotation: nullableVector3(raw, 'rotation', path),
        personId,
        iconFileIds: [...new Set(icons)].sort(),
    };
}

function normalizeService(
    raw: JsonObject,
    index: number,
    regionIds: ReadonlySet<string>,
    personIds: ReadonlySet<string>,
    integrity: Integrity
): MapService {
    const path = `report.discovery.mapServices[${index}]`;
    const regionId = nullableStringField(raw, 'region', path);
    const linkedPersonId = nullableStringField(raw, 'linkedPersonId', path);
    if (regionId !== null) requireReferences([regionId], regionIds, `map service ${index}`, integrity);
    if (linkedPersonId !== null) {
        requireReferences([linkedPersonId], personIds, `map service ${index}`, integrity);
    }
    const accessPoint = raw.accessPoint === undefined || raw.accessPoint === null
        ? null
        : asObject(raw.accessPoint, `${path}.accessPoint`);
    return {
        kind: stringField(raw, 'kind', path),
        id: stringField(raw, 'id', path),
        name: stringField(raw, 'name', path),
        description: stringField(raw, 'description', path),
        sceneName: stringField(raw, 'sceneName', path),
        regionId,
        position: vector3(raw.position, `${path}.position`),
        rotation: vector3(raw.rotation, `${path}.rotation`),
        accessPointPosition: accessPoint === null ? null : vector3(accessPoint.position, `${path}.accessPoint.position`),
        accessPointRotation: accessPoint === null ? null : vector3(accessPoint.rotation, `${path}.accessPoint.rotation`),
        locationSource: stringField(raw, 'locationSource', path),
        linkedPersonId,
    };
}

function normalizeTimedAccessZone(
    raw: JsonObject,
    index: number,
    shopCodes: ReadonlySet<string>,
    integrity: Integrity
): TimedAccessZone {
    const path = `report.discovery.timedAccessZones[${index}]`;
    const nearestShops = objectArray(raw.nearestShops, `${path}.nearestShops`)
        .map((shop, shopIndex) => {
            const shopPath = `${path}.nearestShops[${shopIndex}]`;
            const shopCode = stringField(shop, 'shopCode', shopPath);
            requireReferences([shopCode], shopCodes, `timed access zone ${index}`, integrity);
            return { shopCode, distance: numberField(shop, 'distance', shopPath) };
        })
        .sort((left, right) => left.shopCode.localeCompare(right.shopCode));
    return {
        id: stringField(raw, 'id', path),
        openTime: numberField(raw, 'openTime', path),
        closeTime: numberField(raw, 'closeTime', path),
        allowExitWhenClosed: booleanField(raw, 'allowExitWhenClosed', path),
        autoCloseDoor: booleanField(raw, 'autoCloseDoor', path),
        position: vector3(raw.position, `${path}.position`),
        rotation: vector3(raw.rotation, `${path}.rotation`),
        sceneName: stringField(raw, 'sceneName', path),
        doorCount: numberField(raw, 'doorCount', path),
        nearestShops,
    };
}

function normalizeNavigation(raw: JsonObject, integrity: Integrity): NavigationGraph {
    const path = 'report.discovery.navigation';
    integrity.check('navigation sampling completed', stringField(raw, 'error', path) === '', 'Navigation sampling failed');
    integrity.check('navigation edge validation completed', stringField(raw, 'edgeError', path) === '', 'Navigation edge validation failed');
    const rawAgent = asObject(raw.agent, `${path}.agent`);
    const agentPath = `${path}.agent`;
    const employeeTypes = stringArrayField(rawAgent, 'employeeTypes', agentPath).sort();
    const agentName = stringField(rawAgent, 'name', agentPath);
    const radius = numberField(rawAgent, 'radius', agentPath);
    const height = numberField(rawAgent, 'height', agentPath);
    const maximumSlope = numberField(rawAgent, 'maximumSlope', agentPath);
    const stepHeight = numberField(rawAgent, 'stepHeight', agentPath);
    integrity.check(
        'navigation agent is derived from employee prefabs',
        stringField(rawAgent, 'source', agentPath) === 'employee-prefabs',
        'Navigation agent source is not employee-prefabs'
    );
    integrity.check(
        'navigation agent has employee types',
        employeeTypes.length > 0 && employeeTypes.every((value) => value.trim().length > 0) &&
            new Set(employeeTypes).size === employeeTypes.length,
        'Navigation agent employee types are missing, blank, or duplicated'
    );
    integrity.check(
        'navigation agent has a name',
        agentName.trim().length > 0,
        'Navigation agent name is blank'
    );
    integrity.check(
        'navigation agent dimensions are valid',
        radius > 0 && height > 0 && maximumSlope >= 0 && maximumSlope < 90 && stepHeight >= 0,
        'Navigation agent dimensions are invalid'
    );
    const agent: NavigationGraph['agent'] = {
        source: 'employee-prefabs',
        typeId: integerField(rawAgent, 'typeId', agentPath),
        name: agentName,
        radius,
        height,
        maximumSlope,
        stepHeight,
        employeeTypes,
    };
    const samples = objectArray(raw.samples, `${path}.samples`).map<NavigationSample>((sample, index) => ({
        gridX: integerField(sample, 'gridX', `${path}.samples[${index}]`),
        gridZ: integerField(sample, 'gridZ', `${path}.samples[${index}]`),
        position: vector3(sample.position, `${path}.samples[${index}].position`),
        areaMask: integerField(sample, 'areaMask', `${path}.samples[${index}]`),
    }));
    const gridKeys = new Set(samples.map((sample) => `${sample.gridX}\0${sample.gridZ}`));
    integrity.check(
        'navigation samples use unique grid coordinates',
        gridKeys.size === samples.length,
        'Navigation samples contain duplicate grid coordinates'
    );
    const rawEdges = asArray(raw.edges, `${path}.edges`);
    integrity.check(
        'navigation edge array contains complete pairs',
        rawEdges.length % 2 === 0,
        `Navigation edge array contains ${rawEdges.length} values`
    );
    const edges: NavigationEdge[] = [];
    const edgeKeys = new Set<string>();
    for (let index = 0; index + 1 < rawEdges.length; index += 2) {
        const sampleA = integerValue(rawEdges[index], `${path}.edges[${index}]`);
        const sampleB = integerValue(rawEdges[index + 1], `${path}.edges[${index + 1}]`);
        if (sampleA < 0 || sampleA >= samples.length || sampleB < 0 || sampleB >= samples.length) {
            integrity.addError(`Navigation edge ${index / 2} references a missing sample`);
        } else if (!isNavigationSegmentLocallyTraversable(
            agent,
            samples[sampleA]!.position,
            samples[sampleB]!.position
        )) {
            integrity.addError(`Navigation edge ${index / 2} exceeds employee movement limits`);
        }
        if (sampleA === sampleB) integrity.addError(`Navigation edge ${index / 2} is a self-edge`);
        const edgeKey = sampleA < sampleB ? `${sampleA}\0${sampleB}` : `${sampleB}\0${sampleA}`;
        if (edgeKeys.has(edgeKey)) integrity.addError(`Navigation edge ${index / 2} is a duplicate`);
        edgeKeys.add(edgeKey);
        edges.push({ sampleA, sampleB });
    }
    integrity.check('navigation contains samples', samples.length > 0, 'Navigation contains no samples');

    return NavigationGraphSchema.assert({
        schema: 'neonschedule1-navigation-graph-2',
        method: stringField(raw, 'method', path),
        agent,
        sampleSpacing: numberField(raw, 'sampleSpacing', path),
        queryHeight: numberField(raw, 'queryHeight', path),
        maxSampleDistance: numberField(raw, 'maxSampleDistance', path),
        boundsMinimum: vector3(raw.boundsMinimum, `${path}.boundsMinimum`),
        boundsMaximum: vector3(raw.boundsMaximum, `${path}.boundsMaximum`),
        gridWidth: integerField(raw, 'gridWidth', path),
        gridHeight: integerField(raw, 'gridHeight', path),
        samples,
        edges,
    } satisfies NavigationGraph);
}

function positionFromMember(value: string, path: string) {
    const match = /@\((-?(?:\d+(?:\.\d+)?|\.\d+)),(-?(?:\d+(?:\.\d+)?|\.\d+)),(-?(?:\d+(?:\.\d+)?|\.\d+))\)$/u.exec(value);
    if (match === null) throw new TypeError(`${path} does not contain a world position`);
    return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
}

function numericMember(members: JsonObject, key: string): number {
    const path = 'report.discovery.map.positionUtilityMembers';
    const value = Number(stringField(members, key, path));
    if (!Number.isFinite(value)) throw new TypeError(`${path}.${key} must contain a finite number`);
    return value;
}

function integerField(object: JsonObject, key: string, path: string): number {
    return integerValue(numberField(object, key, path), `${path}.${key}`);
}

function integerValue(value: unknown, path: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        throw new TypeError(`${path} must be a safe integer`);
    }
    return value;
}

function validateUniqueServices(services: readonly MapService[], integrity: Integrity): void {
    const identities = new Set<string>();
    for (const service of services) {
        const identity = `${service.kind}\0${service.id}`;
        if (identities.has(identity)) {
            integrity.addError(`Map services contain duplicate identity ${service.kind}/${service.id}`);
        }
        identities.add(identity);
    }
}

function compareLocations(left: WorldLocation, right: WorldLocation): number {
    return left.sourceKind.localeCompare(right.sourceKind) ||
        left.sourceId.localeCompare(right.sourceId) ||
        comparePositions(left.position, right.position) ||
        left.name.localeCompare(right.name);
}

function comparePositions(left: WorldLocation['position'], right: WorldLocation['position']): number {
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    return left.x - right.x || left.y - right.y || left.z - right.z;
}
