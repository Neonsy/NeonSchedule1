import {
    resolvePersonScheduleAtTime,
    type Person,
    type PersonScheduleAction,
    type PersonScheduleLocation,
} from '@neonschedule1/core';
import { describe, expect, it } from 'vitest';

describe('person schedule resolution', () => {
    it('uses daily start-inclusive and end-exclusive boundaries', () => {
        const person = scheduledPerson([
            event('Work', 600, 700, 0, location('Workplace')),
        ]);

        expect(instanceAt(person, 559).kind).toBe('no-scheduled-action');
        expect(instanceAt(person, 600)).toMatchObject({
            kind: 'unique-highest-priority',
            highestPriorityCandidate: { action: { name: 'Work' } },
        });
        expect(instanceAt(person, 659).kind).toBe('unique-highest-priority');
        expect(instanceAt(person, 700).kind).toBe('no-scheduled-action');
    });

    it('handles cross-midnight, full-day, and native one-minute ranges', () => {
        const overnight = scheduledPerson([
            event('Sleep', 2300, 100, 0, location('Home')),
        ]);
        expect(instanceAt(overnight, 2259).kind).toBe('no-scheduled-action');
        expect(instanceAt(overnight, 2300).kind).toBe('unique-highest-priority');
        expect(instanceAt(overnight, 0).kind).toBe('unique-highest-priority');
        expect(instanceAt(overnight, 59).kind).toBe('unique-highest-priority');
        expect(instanceAt(overnight, 100).kind).toBe('no-scheduled-action');

        const fullDay = scheduledPerson([
            event('Always', 1200, 1200, 0, location('Home')),
        ]);
        expect(instanceAt(fullDay, 0).kind).toBe('unique-highest-priority');
        expect(instanceAt(fullDay, 2359).kind).toBe('unique-highest-priority');

        const oneMinute = scheduledPerson([
            event('Native equal-endpoint range', 1200, 1201, 0, location('Somewhere')),
        ]);
        expect(instanceAt(oneMinute, 1159).kind).toBe('unique-highest-priority');
        expect(instanceAt(oneMinute, 1200).kind).toBe('unique-highest-priority');
        expect(instanceAt(oneMinute, 1201).kind).toBe('unique-highest-priority');
    });

    it('selects a unique highest-priority candidate while retaining lower priorities', () => {
        const result = instanceAt(scheduledPerson([
            event('Base location', 900, 1400, 0, location('Building')),
            signal('Drive', 900, 1000, 12, location('Parking')),
        ]), 930);

        expect(result).toMatchObject({
            kind: 'unique-highest-priority',
            candidates: [
                { actionIndex: 1, action: { name: 'Drive', priority: 12 } },
                { actionIndex: 0, action: { name: 'Base location', priority: 0 } },
            ],
            highestPriorityCandidates: [{ action: { name: 'Drive' } }],
            highestPriorityCandidate: { action: { name: 'Drive' } },
        });
    });

    it('does not invent a winner for equal-priority overlaps', () => {
        const result = instanceAt(scheduledPerson([
            event('Restaurant', 2300, 100, 0, location('Restaurant')),
            event('Home', 2300, 730, 0, location('Home')),
        ]), 30);

        expect(result).toMatchObject({
            kind: 'ambiguous-highest-priority',
            highestPriorityCandidates: [
                { actionIndex: 0, action: { name: 'Restaurant' } },
                { actionIndex: 1, action: { name: 'Home' } },
            ],
            highestPriorityCandidate: null,
        });
    });

    it('keeps missing schedules, empty schedules, and unresolved targets distinct', () => {
        const missing = personWithInstances([
            instance('missing', null),
            instance('empty', []),
            instance('runtime-target', [signal('ATM', 0, 100, 1, null, 'runtime-selected-atm')]),
        ]);
        const result = resolvePersonScheduleAtTime(missing, 30);

        expect(result).toMatchObject({
            recurrence: 'daily',
            intervalModel: 'native-start-through-end-minus-one-minute-inclusive',
            precedence: 'highest-priority',
            runtimeActionEligibility: 'not-evaluated',
            instances: [
                { instanceKey: 'empty', kind: 'no-scheduled-action', scheduleProof: 'exact' },
                { instanceKey: 'missing', kind: 'schedule-missing', scheduleProof: 'incomplete' },
                {
                    instanceKey: 'runtime-target',
                    kind: 'unique-highest-priority',
                    highestPriorityCandidate: {
                        location: {
                            kind: 'unresolved',
                            targetResolution: 'runtime-selected-atm',
                        },
                    },
                },
            ],
        });
    });

    it('resolves every physical instance independently and deterministically', () => {
        const person = personWithInstances([
            instance('west', [event('West shift', 800, 900, 0, location('West'))]),
            instance('east', [event('East shift', 800, 900, 0, location('East'))]),
        ]);

        expect(resolvePersonScheduleAtTime(person, 830).instances.map((entry) => ({
            key: entry.instanceKey,
            action: entry.highestPriorityCandidate?.action.name,
        }))).toEqual([
            { key: 'east', action: 'East shift' },
            { key: 'west', action: 'West shift' },
        ]);
    });

    it('rejects malformed times, action kinds, targets, and instance identities', () => {
        expect(() => resolvePersonScheduleAtTime(scheduledPerson([
            event('Bad time', 1260, 1300, 0, location('Somewhere')),
        ]), 0)).toThrow('must be a valid HHMM game time');
        expect(() => resolvePersonScheduleAtTime(scheduledPerson([{
            ...event('Bad kind', 100, 200, 0, location('Somewhere')),
            isSignal: true,
            maxDuration: 60,
        }]), 0)).toThrow('must be exactly one of event or signal');
        expect(() => resolvePersonScheduleAtTime(scheduledPerson([
            event('No target', 100, 200, 0, null),
        ]), 0)).toThrow('has neither a location nor target resolution');
        expect(() => resolvePersonScheduleAtTime(personWithInstances([
            instance('same', []),
            instance('same', []),
        ]), 0)).toThrow('Duplicate person instance');
        expect(() => resolvePersonScheduleAtTime(scheduledPerson([]), 2360))
            .toThrow('must be a valid HHMM game time');
    });
});

function instanceAt(person: Person, atTime: number) {
    return resolvePersonScheduleAtTime(person, atTime).instances[0]!;
}

function scheduledPerson(schedule: readonly PersonScheduleAction[]): Person {
    return personWithInstances([instance('person:instance', schedule)]);
}

function personWithInstances(instances: Person['instances']): Person {
    return {
        schema: 'neonschedule1-person-1',
        id: 'person',
        name: { first: 'Test', last: 'Person', full: 'Test Person' },
        regions: ['Test'],
        roles: ['customer'],
        defaultRelationship: null,
        displayRelationship: null,
        instances,
    };
}

function instance(
    key: string,
    schedule: readonly PersonScheduleAction[] | null
): Person['instances'][number] {
    return {
        key,
        objectPath: key,
        presentation: { mugshotFileId: null, modelMeshIds: [], modelMaterialIds: [] },
        schedule: schedule === null ? null : [...schedule],
    };
}

function event(
    name: string,
    startTime: number,
    endTime: number,
    priority: number,
    destination: PersonScheduleLocation | null,
    targetResolution: string | null = null
): PersonScheduleAction {
    return {
        runtimeType: 'ScheduleOne.NPCs.Schedules.NPCEvent_LocationBasedAction',
        name,
        startTime,
        endTime,
        duration: 60,
        maxDuration: null,
        priority,
        isEvent: true,
        isSignal: false,
        location: destination,
        targetResolution,
    };
}

function signal(
    name: string,
    startTime: number,
    endTime: number,
    priority: number,
    destination: PersonScheduleLocation | null,
    targetResolution: string | null = null
): PersonScheduleAction {
    return {
        runtimeType: 'ScheduleOne.NPCs.Schedules.NPCSignal_WalkToLocation',
        name,
        startTime,
        endTime,
        duration: null,
        maxDuration: 60,
        priority,
        isEvent: false,
        isSignal: true,
        location: destination,
        targetResolution,
    };
}

function location(name: string): PersonScheduleLocation {
    return {
        member: 'Destination',
        name,
        objectPath: `Map/${name}`,
        position: { x: 1, y: 2, z: 3 },
        rotation: { x: 0, y: 90, z: 0 },
    };
}
