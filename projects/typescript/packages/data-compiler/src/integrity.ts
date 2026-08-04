import type { JsonObject } from './json.js';
import { stringField } from './json.js';

export class IntegrityError extends Error {
    readonly issues: readonly string[];

    constructor(issues: readonly string[]) {
        super(`Integrity validation failed with ${issues.length} issue(s)`);
        this.name = 'IntegrityError';
        this.issues = issues;
    }
}

export class Integrity {
    readonly checks: string[] = [];
    readonly errors: string[] = [];

    check(name: string, condition: boolean, failure: string): void {
        if (condition) {
            this.checks.push(name);
            return;
        }
        this.errors.push(failure);
    }

    addError(message: string): void {
        this.errors.push(message);
    }

    throwIfInvalid(): void {
        if (this.errors.length > 0) {
            throw new IntegrityError(this.errors);
        }
    }
}

export function indexUnique(
    records: readonly JsonObject[],
    key: string,
    path: string,
    integrity: Integrity
): Map<string, JsonObject> {
    const index = new Map<string, JsonObject>();
    records.forEach((record, position) => {
        const id = stringField(record, key, `${path}[${position}]`);
        if (index.has(id)) {
            integrity.addError(`${path} contains duplicate ${key} ${JSON.stringify(id)}`);
            return;
        }
        index.set(id, record);
    });
    return index;
}

export function requireReferences(
    references: Iterable<string>,
    targets: ReadonlySet<string>,
    label: string,
    integrity: Integrity
): void {
    for (const reference of references) {
        if (reference !== '' && !targets.has(reference)) {
            integrity.addError(`${label} references missing id ${JSON.stringify(reference)}`);
        }
    }
}
