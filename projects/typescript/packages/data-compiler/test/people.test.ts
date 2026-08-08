import { describe, expect, it } from 'vitest';

import type { VerifiedAssets } from '#data-compiler/acquisition/assets';
import type { RawReport } from '#data-compiler/acquisition/types';
import { Integrity } from '#data-compiler/integrity';
import { normalizePeople } from '#data-compiler/normalize/people';

const mugshotHash = 'a'.repeat(64);
const assets: VerifiedAssets = {
    files: [],
    directFileIdByPath: new Map([['assets/alice.png', mugshotHash]]),
    offlineFileIdsByMeshKey: new Map(),
    directFileCount: 1,
    offlineFileCount: 0,
};

describe('people normalization', () => {
    it('preserves logical people, physical instances, schedules, visuals, and graph edges', () => {
        const integrity = new Integrity();
        const normalized = normalizePeople(report(), assets, integrity);

        integrity.throwIfInvalid();
        expect(normalized.people.map((person) => person.id)).toEqual(['alice', 'carteldealer']);
        expect(normalized.people[0]).toMatchObject({
            id: 'alice',
            regions: ['Downtown'],
            roles: ['customer'],
            instances: [{
                key: 'alice:Alice',
                presentation: { mugshotFileId: mugshotHash },
                schedule: [{
                    startTime: 600,
                    duration: 60,
                    maxDuration: null,
                    location: { name: 'Cafe' },
                    targetResolution: null,
                }],
            }],
        });
        expect(normalized.people[0]).not.toHaveProperty('relationshipInLoadedSave');
        expect(normalized.people[1]).toMatchObject({
            id: 'carteldealer',
            regions: ['Docks', 'Westville'],
            instances: [
                {
                    key: 'carteldealer:Docks',
                    presentation: {
                        mugshotFileId: null,
                        modelMeshIds: ['mesh:body'],
                        modelMaterialIds: ['material:body'],
                    },
                },
                { key: 'carteldealer:Westville' },
            ],
        });
        expect(normalized.relationships).toEqual({
            schema: 'neonschedule1-relationship-catalog-1',
            personIds: ['alice', 'carteldealer'],
            edges: [{ sourceId: 'alice', targetId: 'carteldealer', bidirectional: true }],
        });
    });
});

function report(): RawReport {
    const people = [
        person('alice', 'Alice', 'Downtown', ['customer']),
        person('carteldealer', 'Benzies Dealer', 'Westville', ['dealer']),
        person('carteldealer', 'Benzies Dealer', 'Docks', ['dealer']),
    ];
    const discoveryPeople = [
        presentation('alice', 'alice:Alice', {
            relativePath: 'assets/alice.png',
            sha256: mugshotHash,
        }),
        presentation('carteldealer', 'carteldealer:Westville'),
        presentation('carteldealer', 'carteldealer:Docks'),
    ];
    const npcSchedules = [
        schedule('alice', 'alice:Alice', {
            runtimeType: 'NPCEvent_LocationBasedAction',
            name: 'Visit cafe',
            startTime: 600,
            endTime: 700,
            duration: 60,
            priority: 0,
            isEvent: true,
            isSignal: false,
            location: {
                member: 'Destination',
                objectName: 'Cafe',
                objectPath: 'Map/Cafe',
                position: { x: 1, y: 2, z: 3 },
                rotation: { x: 0, y: 90, z: 0 },
            },
            targetResolution: '',
        }),
        schedule('carteldealer', 'carteldealer:Docks', {
            runtimeType: 'NPCEvent_StayInBuilding',
            name: 'Stay in building',
            startTime: 0,
            endTime: 2359,
            duration: 1_439,
            priority: 0,
            isEvent: true,
            isSignal: false,
            targetResolution: 'explicit-destination-unset',
        }),
        schedule('carteldealer', 'carteldealer:Westville', {
            runtimeType: 'NPCSignal_DriveToCarPark',
            name: 'Drive',
            startTime: 900,
            endTime: 1000,
            maxDuration: 60,
            priority: 12,
            isEvent: false,
            isSignal: true,
            location: {
                member: 'ParkingLot',
                objectName: 'Parking',
                objectPath: 'Map/Parking',
                position: null,
                rotation: null,
            },
            targetResolution: '',
        }),
    ];
    return {
        peopleSources: {
            npcRegistryCount: 3,
            lockedCustomerCount: 1,
            unlockedCustomerCount: 0,
            uniquePersonCount: 2,
            uniqueCustomerCount: 1,
            directedConnectionCount: 2,
            uniqueRelationshipEdgeCount: 1,
        },
        people,
        relationshipEdges: [
            { sourceId: 'alice', targetId: 'carteldealer', bidirectional: true },
        ],
        discovery: {
            people: discoveryPeople,
            npcSchedules,
            uniquePersonArchetypeCount: 2,
            scheduleManagerCount: 3,
            scheduleActionCount: 3,
        },
    } as unknown as RawReport;
}

function person(id: string, fullName: string, region: string, roles: string[]) {
    return {
        id,
        firstName: fullName,
        lastName: '',
        fullName,
        region,
        roles,
        defaultRelationship: 0.4,
        displayRelationship: true,
        relationshipInLoadedSave: 2,
        unlockedInLoadedSave: false,
        unlockTypeInLoadedSave: 'Recommendation',
    };
}

function presentation(personId: string, instanceKey: string, mugshot: object | null = null) {
    return {
        personId,
        instanceKey,
        displayName: personId === 'alice' ? 'Alice' : 'Benzies Dealer',
        objectPath: instanceKey.slice(instanceKey.indexOf(':') + 1),
        sharesArchetypeId: personId === 'carteldealer',
        mugshot,
        modelVisuals: personId === 'alice'
            ? { meshes: [], renderers: [] }
            : {
                  meshes: [{ meshAssetReferenceKey: 'mesh:body' }],
                  renderers: [{ materialAssetReferenceKeys: ['material:body'] }],
              },
        positionInLoadedSave: { x: 0, y: 0, z: 0 },
    };
}

function schedule(personId: string, personInstanceKey: string, action: object) {
    return { personId, personInstanceKey, actions: [action] };
}
