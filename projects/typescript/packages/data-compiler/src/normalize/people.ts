import {
    PersonSchema,
    RelationshipCatalogSchema,
    type Person,
    type PersonInstance,
    type PersonScheduleAction,
    type RelationshipCatalog,
    type RelationshipEdge,
} from '@neonschedule1/core';

import type { VerifiedAssets } from '#data-compiler/acquisition/assets';
import type { RawReport } from '#data-compiler/acquisition/types';
import { indexUnique, Integrity, requireReferences } from '#data-compiler/integrity';
import {
    asObject,
    booleanField,
    nullableNumberField,
    nullableStringField,
    numberField,
    objectArray,
    stringArrayField,
    stringField,
    type JsonObject,
} from '#data-compiler/json';
import { fileIdForDescriptor, nullableVector3 } from '#data-compiler/normalize/shared';

export interface NormalizedPeople {
    readonly people: readonly Person[];
    readonly relationships: RelationshipCatalog;
}

export function normalizePeople(
    report: RawReport,
    assets: VerifiedAssets,
    integrity: Integrity
): NormalizedPeople {
    const peopleById = groupBy(report.people, 'id', 'report.people');
    const presentationsById = groupBy(
        report.discovery.people,
        'personId',
        'report.discovery.people'
    );
    const presentationsByKey = indexUnique(
        report.discovery.people,
        'instanceKey',
        'report.discovery.people',
        integrity
    );
    const schedulesByKey = indexUnique(
        report.discovery.npcSchedules,
        'personInstanceKey',
        'report.discovery.npcSchedules',
        integrity
    );
    const personIds = new Set(peopleById.keys());

    requireReferences(presentationsById.keys(), personIds, 'person presentation', integrity);
    requireReferences(
        report.discovery.npcSchedules.map((schedule, index) =>
            stringField(schedule, 'personId', `report.discovery.npcSchedules[${index}]`)
        ),
        personIds,
        'person schedule',
        integrity
    );
    requireReferences(schedulesByKey.keys(), new Set(presentationsByKey.keys()), 'person schedule instance', integrity);
    validateSourceCounts(report, peopleById.size, schedulesByKey.size, integrity);

    const people = [...peopleById.entries()]
        .map(([id, sources]) =>
            normalizePerson(
                id,
                sources,
                presentationsById.get(id) ?? [],
                schedulesByKey,
                assets,
                integrity
            )
        )
        .sort((left, right) => left.id.localeCompare(right.id));
    return {
        people,
        relationships: normalizeRelationships(report, personIds, integrity),
    };
}

function normalizePerson(
    id: string,
    sources: readonly JsonObject[],
    presentations: readonly JsonObject[],
    schedulesByKey: ReadonlyMap<string, JsonObject>,
    assets: VerifiedAssets,
    integrity: Integrity
): Person {
    const path = `report.people[${JSON.stringify(id)}]`;
    const source = sources[0];
    if (source === undefined) throw new Error(`${path} has no source record`);
    if (id.trim() === '') integrity.addError(`${path}.id must not be blank`);

    const first = stringField(source, 'firstName', path);
    const last = stringField(source, 'lastName', path);
    const full = stringField(source, 'fullName', path);
    const sourceRoles = stringArrayField(source, 'roles', path);
    const roles = sortedUnique(sourceRoles);
    const defaultRelationship = nullableNumberField(source, 'defaultRelationship', path);
    const displayRelationship = nullableBooleanField(source, 'displayRelationship', path);
    for (const [index, candidate] of sources.entries()) {
        const candidatePath = `${path}.instances[${index}]`;
        const candidateSourceRoles = stringArrayField(candidate, 'roles', candidatePath);
        const candidateRoles = sortedUnique(candidateSourceRoles);
        if (candidateRoles.length !== candidateSourceRoles.length) {
            integrity.addError(`${candidatePath}.roles contains duplicates`);
        }
        if (
            stringField(candidate, 'firstName', candidatePath) !== first ||
            stringField(candidate, 'lastName', candidatePath) !== last ||
            stringField(candidate, 'fullName', candidatePath) !== full ||
            !sameStrings(candidateRoles, roles) ||
            nullableNumberField(candidate, 'defaultRelationship', candidatePath) !== defaultRelationship ||
            nullableBooleanField(candidate, 'displayRelationship', candidatePath) !== displayRelationship
        ) {
            integrity.addError(`${path} has conflicting records for one logical person`);
        }
    }
    if (sources.length !== presentations.length) {
        integrity.addError(
            `${path} has ${sources.length} source instances but ${presentations.length} presentations`
        );
    }

    const instances = presentations
        .map((presentation, index) =>
            normalizeInstance(
                id,
                full,
                presentation,
                `${path}.presentations[${index}]`,
                sources.length > 1,
                schedulesByKey,
                assets,
                integrity
            )
        )
        .sort((left, right) => left.key.localeCompare(right.key));
    return PersonSchema.assert({
        schema: 'neonschedule1-person-1',
        id,
        name: { first, last, full },
        regions: sortedUnique(
            sources.map((candidate, index) =>
                stringField(candidate, 'region', `${path}.instances[${index}]`)
            )
        ),
        roles,
        defaultRelationship,
        displayRelationship,
        instances,
    } satisfies Person);
}

function normalizeInstance(
    personId: string,
    fullName: string,
    raw: JsonObject,
    path: string,
    sharesArchetypeId: boolean,
    schedulesByKey: ReadonlyMap<string, JsonObject>,
    assets: VerifiedAssets,
    integrity: Integrity
): PersonInstance {
    const key = stringField(raw, 'instanceKey', path);
    if (stringField(raw, 'personId', path) !== personId) {
        integrity.addError(`${path}.personId differs from its person`);
    }
    if (stringField(raw, 'displayName', path) !== fullName) {
        integrity.addError(`${path}.displayName differs from its person`);
    }
    if (booleanField(raw, 'sharesArchetypeId', path) !== sharesArchetypeId) {
        integrity.addError(`${path}.sharesArchetypeId differs from the instance count`);
    }

    const model = asObject(raw.modelVisuals, `${path}.modelVisuals`);
    const modelMeshIds = sortedUnique(
        objectArray(model.meshes, `${path}.modelVisuals.meshes`)
            .map((mesh, index) =>
                stringField(
                    mesh,
                    'meshAssetReferenceKey',
                    `${path}.modelVisuals.meshes[${index}]`
                )
            )
            .filter(Boolean)
    );
    const modelMaterialIds = sortedUnique(
        objectArray(model.renderers, `${path}.modelVisuals.renderers`).flatMap(
            (renderer, index) =>
                stringArrayField(
                    renderer,
                    'materialAssetReferenceKeys',
                    `${path}.modelVisuals.renderers[${index}]`
                )
        ).filter(Boolean)
    );
    const mugshotFileId = fileIdForDescriptor(raw.mugshot, `${path}.mugshot`, assets, integrity);
    if (mugshotFileId === null && modelMeshIds.length === 0 && modelMaterialIds.length === 0) {
        integrity.addError(`${path} has neither a mugshot nor model presentation`);
    }

    const schedule = schedulesByKey.get(key);
    return {
        key,
        objectPath: stringField(raw, 'objectPath', path),
        presentation: { mugshotFileId, modelMeshIds, modelMaterialIds },
        schedule:
            schedule === undefined
                ? null
                : normalizeSchedule(personId, key, schedule, `${path}.schedule`, integrity),
    };
}

function normalizeSchedule(
    personId: string,
    instanceKey: string,
    raw: JsonObject,
    path: string,
    integrity: Integrity
): PersonScheduleAction[] {
    if (stringField(raw, 'personId', path) !== personId) {
        integrity.addError(`${path}.personId differs from its person`);
    }
    if (stringField(raw, 'personInstanceKey', path) !== instanceKey) {
        integrity.addError(`${path}.personInstanceKey differs from its instance`);
    }
    const actions = objectArray(raw.actions, `${path}.actions`).map((action, index) =>
        normalizeScheduleAction(action, `${path}.actions[${index}]`, integrity)
    );
    if (actions.some((action, index) => {
        const previous = actions[index - 1];
        return previous !== undefined &&
            (action.startTime < previous.startTime ||
                (action.startTime === previous.startTime && action.priority < previous.priority));
    })) {
        integrity.addError(`${path}.actions are not ordered by start time and priority`);
    }
    return actions;
}

function normalizeScheduleAction(
    raw: JsonObject,
    path: string,
    integrity: Integrity
): PersonScheduleAction {
    const startTime = numberField(raw, 'startTime', path);
    const endTime = numberField(raw, 'endTime', path);
    const duration = nullableNumberField(raw, 'duration', path);
    const maxDuration = nullableNumberField(raw, 'maxDuration', path);
    const priority = numberField(raw, 'priority', path);
    const isEvent = booleanField(raw, 'isEvent', path);
    const isSignal = booleanField(raw, 'isSignal', path);
    const targetResolution = nullableStringField(raw, 'targetResolution', path);
    const location = raw.location === undefined || raw.location === null
        ? null
        : normalizeLocation(asObject(raw.location, `${path}.location`), `${path}.location`);

    if (!isHhmm(startTime) || !isHhmm(endTime)) {
        integrity.addError(`${path} contains an invalid HHMM time`);
    }
    if (!Number.isInteger(priority)) integrity.addError(`${path}.priority must be an integer`);
    if (isEvent === isSignal || isEvent !== (duration !== null) || isSignal !== (maxDuration !== null)) {
        integrity.addError(`${path} has inconsistent event, signal, and duration fields`);
    }
    if (
        (duration !== null && (!Number.isInteger(duration) || duration < 0)) ||
        (maxDuration !== null && (!Number.isInteger(maxDuration) || maxDuration < 0))
    ) {
        integrity.addError(`${path} has an invalid duration`);
    }
    if (location === null && targetResolution === null) {
        integrity.addError(`${path} has neither a location nor a target resolution`);
    }
    return {
        runtimeType: stringField(raw, 'runtimeType', path),
        name: stringField(raw, 'name', path),
        startTime,
        endTime,
        duration,
        maxDuration,
        priority,
        isEvent,
        isSignal,
        location,
        targetResolution,
    };
}

function normalizeLocation(raw: JsonObject, path: string) {
    return {
        member: stringField(raw, 'member', path),
        name: stringField(raw, 'objectName', path),
        objectPath: stringField(raw, 'objectPath', path),
        position: nullableVector3(raw, 'position', path),
        rotation: nullableVector3(raw, 'rotation', path),
    };
}

function normalizeRelationships(
    report: RawReport,
    personIds: ReadonlySet<string>,
    integrity: Integrity
): RelationshipCatalog {
    const seen = new Set<string>();
    const edges = report.relationshipEdges.map<RelationshipEdge>((raw, index) => {
        const path = `report.relationshipEdges[${index}]`;
        const sourceId = stringField(raw, 'sourceId', path);
        const targetId = stringField(raw, 'targetId', path);
        const key = `${sourceId}\u0000${targetId}`;
        if (sourceId === targetId) integrity.addError(`${path} is a self-reference`);
        if (seen.has(key)) integrity.addError(`${path} duplicates an earlier edge`);
        seen.add(key);
        return { sourceId, targetId, bidirectional: booleanField(raw, 'bidirectional', path) };
    });
    requireReferences(edges.flatMap((edge) => [edge.sourceId, edge.targetId]), personIds, 'relationship', integrity);
    integrity.check(
        'relationship edge count matches its source summary',
        edges.length === report.peopleSources.uniqueRelationshipEdgeCount,
        `Expected ${report.peopleSources.uniqueRelationshipEdgeCount} relationship edges, found ${edges.length}`
    );
    const directedCount = edges.reduce((count, edge) => count + (edge.bidirectional ? 2 : 1), 0);
    integrity.check(
        'directed relationship count matches its source summary',
        directedCount === report.peopleSources.directedConnectionCount,
        `Expected ${report.peopleSources.directedConnectionCount} directed relationships, found ${directedCount}`
    );
    return RelationshipCatalogSchema.assert({
        schema: 'neonschedule1-relationship-catalog-1',
        personIds: [...personIds].sort(),
        edges: edges.sort(
            (left, right) =>
                left.sourceId.localeCompare(right.sourceId) ||
                left.targetId.localeCompare(right.targetId)
        ),
    } satisfies RelationshipCatalog);
}

function validateSourceCounts(
    report: RawReport,
    personCount: number,
    scheduleCount: number,
    integrity: Integrity
): void {
    const instanceCount = report.people.length;
    integrity.check(
        'person registry count matches its source summary',
        instanceCount === report.peopleSources.npcRegistryCount,
        `Expected ${report.peopleSources.npcRegistryCount} person instances, found ${instanceCount}`
    );
    integrity.check(
        'logical person count matches both source summaries',
        personCount === report.peopleSources.uniquePersonCount &&
            personCount === report.discovery.uniquePersonArchetypeCount,
        `Expected ${report.peopleSources.uniquePersonCount} logical people, found ${personCount}`
    );
    integrity.check(
        'person presentation count matches the registry',
        report.discovery.people.length === instanceCount,
        `Expected ${instanceCount} person presentations, found ${report.discovery.people.length}`
    );
    integrity.check(
        'person schedule count matches its source summary',
        scheduleCount === report.discovery.scheduleManagerCount,
        `Expected ${report.discovery.scheduleManagerCount} schedules, found ${scheduleCount}`
    );
    const actionCount = report.discovery.npcSchedules.reduce(
        (count, schedule, index) =>
            count + objectArray(schedule.actions, `report.discovery.npcSchedules[${index}].actions`).length,
        0
    );
    integrity.check(
        'person schedule action count matches its source summary',
        actionCount === report.discovery.scheduleActionCount,
        `Expected ${report.discovery.scheduleActionCount} schedule actions, found ${actionCount}`
    );
}

function groupBy(
    records: readonly JsonObject[],
    key: string,
    path: string
): Map<string, JsonObject[]> {
    const groups = new Map<string, JsonObject[]>();
    records.forEach((record, index) => {
        const id = stringField(record, key, `${path}[${index}]`);
        const group = groups.get(id) ?? [];
        group.push(record);
        groups.set(id, group);
    });
    return groups;
}

function nullableBooleanField(object: JsonObject, key: string, path: string): boolean | null {
    const value = object[key];
    if (value === null || value === undefined) return null;
    return booleanField(object, key, path);
}

function isHhmm(value: number): boolean {
    return Number.isInteger(value) && value >= 0 && value < 2_400 && value % 100 < 60;
}

function sortedUnique(values: readonly string[]): string[] {
    return [...new Set(values)].sort();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
