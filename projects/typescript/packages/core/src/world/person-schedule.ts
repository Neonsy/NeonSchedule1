import {
    PersonSchema,
    type Person,
    type PersonScheduleAction,
    type PersonScheduleLocation,
} from '#core/data/person';

export interface PersonScheduleActionCandidate {
    readonly actionIndex: number;
    readonly action: PersonScheduleAction;
    readonly location:
        | { readonly kind: 'explicit'; readonly value: PersonScheduleLocation }
        | { readonly kind: 'unresolved'; readonly targetResolution: string };
}

export type PersonInstanceScheduleAtTime = {
    readonly instanceKey: string;
    readonly objectPath: string;
    readonly scheduleProof: 'exact' | 'incomplete';
    readonly candidates: readonly PersonScheduleActionCandidate[];
    readonly highestPriorityCandidates: readonly PersonScheduleActionCandidate[];
    readonly highestPriorityCandidate: PersonScheduleActionCandidate | null;
} & (
    | { readonly kind: 'schedule-missing' }
    | { readonly kind: 'no-scheduled-action' }
    | { readonly kind: 'unique-highest-priority' }
    | { readonly kind: 'ambiguous-highest-priority' }
);

export interface PersonScheduleAtTimeResult {
    readonly personId: string;
    readonly atTime: number;
    readonly recurrence: 'daily';
    readonly intervalModel: 'native-start-through-end-minus-one-minute-inclusive';
    readonly precedence: 'highest-priority';
    /** Live action GameObject and one-shot signal state are not normalized. */
    readonly runtimeActionEligibility: 'not-evaluated';
    readonly instances: readonly PersonInstanceScheduleAtTime[];
}

/**
 * Resolves portable schedule evidence. It does not claim which action is active in a live save.
 */
export function resolvePersonScheduleAtTime(
    personInput: Person,
    atTime: number
): PersonScheduleAtTimeResult {
    const person = PersonSchema.assert(personInput);
    requireNonBlank(person.id, 'Person ID');
    requireGameTime(atTime, 'Person schedule time');

    const instanceKeys = new Set<string>();
    const instances = person.instances.map((instance) => {
        requireNonBlank(instance.key, 'Person instance key');
        if (instanceKeys.has(instance.key)) {
            throw new Error(`Duplicate person instance ${JSON.stringify(instance.key)}`);
        }
        instanceKeys.add(instance.key);
        if (instance.schedule === null) {
            return {
                instanceKey: instance.key,
                objectPath: instance.objectPath,
                kind: 'schedule-missing',
                scheduleProof: 'incomplete',
                candidates: [],
                highestPriorityCandidates: [],
                highestPriorityCandidate: null,
            } satisfies PersonInstanceScheduleAtTime;
        }

        const scheduled = instance.schedule.map((action, actionIndex) => {
            validateAction(action, instance.key, actionIndex);
            return { action, actionIndex };
        }).filter(({ action }) => isScheduledAt(action, atTime));
        const candidates = scheduled.map(({ action, actionIndex }) => ({
            actionIndex,
            action: copyAction(action),
            location: locationResolution(action),
        })).sort(compareCandidates);
        const highestPriority = candidates[0]?.action.priority;
        const highestPriorityCandidates = highestPriority === undefined
            ? []
            : candidates.filter((candidate) => candidate.action.priority === highestPriority);
        const highestPriorityCandidate = highestPriorityCandidates.length === 1
            ? highestPriorityCandidates[0]!
            : null;
        const kind = candidates.length === 0
            ? 'no-scheduled-action'
            : highestPriorityCandidate === null
                ? 'ambiguous-highest-priority'
                : 'unique-highest-priority';
        return {
            instanceKey: instance.key,
            objectPath: instance.objectPath,
            kind,
            scheduleProof: 'exact',
            candidates,
            highestPriorityCandidates,
            highestPriorityCandidate,
        } satisfies PersonInstanceScheduleAtTime;
    }).sort((left, right) => left.instanceKey.localeCompare(right.instanceKey));

    return {
        personId: person.id,
        atTime,
        recurrence: 'daily',
        intervalModel: 'native-start-through-end-minus-one-minute-inclusive',
        precedence: 'highest-priority',
        runtimeActionEligibility: 'not-evaluated',
        instances,
    };
}

function validateAction(
    action: PersonScheduleAction,
    instanceKey: string,
    actionIndex: number
): void {
    const label = `Person instance ${JSON.stringify(instanceKey)} action ${actionIndex}`;
    requireGameTime(action.startTime, `${label} start time`);
    requireGameTime(action.endTime, `${label} end time`);
    if (!Number.isSafeInteger(action.priority)) {
        throw new RangeError(`${label} priority must be a safe integer`);
    }
    if (action.isEvent === action.isSignal) {
        throw new Error(`${label} must be exactly one of event or signal`);
    }
    requireDuration(action.duration, `${label} duration`);
    requireDuration(action.maxDuration, `${label} maximum duration`);
    if (action.isEvent !== (action.duration !== null)) {
        throw new Error(`${label} has inconsistent event duration`);
    }
    if (action.isSignal !== (action.maxDuration !== null)) {
        throw new Error(`${label} has inconsistent signal duration`);
    }
    if (action.location === null) {
        if (action.targetResolution === null) {
            throw new Error(`${label} has neither a location nor target resolution`);
        }
        requireNonBlank(action.targetResolution, `${label} target resolution`);
    }
}

function isScheduledAt(action: PersonScheduleAction, atTime: number): boolean {
    const start = hhmmToMinutes(action.startTime);
    const inclusiveEnd = (hhmmToMinutes(action.endTime) + 1439) % 1440;
    const time = hhmmToMinutes(atTime);
    if (inclusiveEnd <= start) return time >= start || time <= inclusiveEnd;
    return time >= start && time <= inclusiveEnd;
}

function locationResolution(
    action: PersonScheduleAction
): PersonScheduleActionCandidate['location'] {
    return action.location === null
        ? { kind: 'unresolved', targetResolution: action.targetResolution! }
        : { kind: 'explicit', value: copyLocation(action.location) };
}

function copyAction(action: PersonScheduleAction): PersonScheduleAction {
    return {
        ...action,
        location: action.location === null ? null : copyLocation(action.location),
    };
}

function copyLocation(location: PersonScheduleLocation): PersonScheduleLocation {
    return {
        ...location,
        position: location.position === null ? null : { ...location.position },
        rotation: location.rotation === null ? null : { ...location.rotation },
    };
}

function compareCandidates(
    left: PersonScheduleActionCandidate,
    right: PersonScheduleActionCandidate
): number {
    return right.action.priority - left.action.priority || left.actionIndex - right.actionIndex;
}

function requireGameTime(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 2359 || value % 100 >= 60) {
        throw new RangeError(`${label} must be a valid HHMM game time`);
    }
}

function requireDuration(value: number | null, label: string): void {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
        throw new RangeError(`${label} must be a non-negative safe integer or null`);
    }
}

function requireNonBlank(value: string, label: string): void {
    if (value.trim().length === 0) throw new Error(`${label} must not be blank`);
}

function hhmmToMinutes(value: number): number {
    return Math.floor(value / 100) * 60 + value % 100;
}
