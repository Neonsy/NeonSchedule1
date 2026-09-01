import {
    PlannerProfileBundleSchema,
    type PlannerBlueprintDocument,
    type PlannerChecklistDocument,
    type PlannerCompatibility,
    type PlannerDocumentMetadata,
    type PlannerEmployeeStateSetValue,
    type PlannerInventoryDocument,
    type PlannerInventorySnapshot,
    type PlannerMixingRuleProfileValue,
    type PlannerNumberValue,
    type PlannerObservationDocument,
    type PlannerProfileBundle,
    type PlannerProfileManifest,
    type PlannerPropertyStateSetValue,
    type PlannerRankValue,
    type PlannerRelationshipSetValue,
    type PlannerStateSnapshot,
    type PlannerStringSetValue,
    type PlannerVector3Value,
    type PlannerDealerStateSetValue,
    type PlannerCustomerStateSetValue,
} from '#core/data/planner-profile';
import { normalizeMixingRuleProfile } from '#core/data/mixing';

export interface PlannerProfileDatasetIdentity {
    readonly gameVersion: string;
    readonly datasetSha256: string;
}

const sha256Pattern = /^[a-f0-9]{64}$/u;

export function validatePlannerProfileBundle(input: unknown): PlannerProfileBundle {
    const bundle = PlannerProfileBundleSchema.assert(input);
    validateManifest(bundle.manifest);
    validatePlannerManualStateDocument(bundle.manualState);
    bundle.inventories.forEach(validatePlannerInventoryDocument);
    bundle.checklists.forEach(validatePlannerChecklistDocument);
    bundle.blueprints.forEach(validatePlannerBlueprintDocument);
    if (bundle.observation !== null) {
        validatePlannerObservationDocument(bundle.observation);
    }
    validateOwnership(bundle);
    return bundle;
}

export function validatePlannerProfileBundleForDataset(
    input: unknown,
    dataset: PlannerProfileDatasetIdentity
): PlannerProfileBundle {
    const bundle = validatePlannerProfileBundle(input);
    validateCompatibility(dataset, 'Loaded dataset');
    if (!sameCompatibility(bundle.manifest.compatibility, dataset)) {
        throw new Error('Planner profile is incompatible with the loaded dataset');
    }
    return bundle;
}

function validateManifest(manifest: PlannerProfileManifest): void {
    requireId(manifest.profileId, 'Planner profile ID');
    requireNonBlank(manifest.name, 'Planner profile name');
    validateTimestamp(manifest.createdAt, 'Planner profile createdAt');
    validateTimestamp(manifest.updatedAt, 'Planner profile updatedAt');
    requireChronology(manifest.createdAt, manifest.updatedAt, 'Planner profile');
    validateCompatibility(manifest.compatibility, 'Planner profile');
    requireId(manifest.documents.manualStateDocumentId, 'Manual state document ID');
    requireCanonicalIds(manifest.documents.inventoryDocumentIds, 'Inventory document IDs');
    requireCanonicalIds(manifest.documents.checklistDocumentIds, 'Checklist document IDs');
    requireCanonicalIds(manifest.documents.blueprintDocumentIds, 'Blueprint document IDs');
    if (manifest.documents.latestObservationDocumentId !== null) {
        requireId(
            manifest.documents.latestObservationDocumentId,
            'Latest observation document ID'
        );
    }
}

export function validatePlannerManualStateDocument(
    document: PlannerProfileBundle['manualState']
): void {
    validateMetadata(document.metadata, 'Manual state document');
    validatePlannerStateSnapshot(document.state, 'Manual state');
}

export function validatePlannerInventoryDocument(document: PlannerInventoryDocument): void {
    validateMetadata(document.metadata, 'Inventory document');
    validatePlannerInventorySnapshot(document.inventory, 'Inventory document');
}

export function validatePlannerChecklistDocument(document: PlannerChecklistDocument): void {
    validateMetadata(document.metadata, 'Checklist document');
    requireNonBlank(document.title, 'Checklist title');
    requireUnique(
        document.items,
        ({ id }) => {
            requireId(id, 'Checklist item ID');
            return id;
        },
        'Checklist item IDs'
    );
    document.items.forEach(({ label }) => requireNonBlank(label, 'Checklist item label'));
}

export function validatePlannerBlueprintDocument(document: PlannerBlueprintDocument): void {
    validateMetadata(document.metadata, 'Blueprint document');
    requireNonBlank(document.title, 'Blueprint title');
    requireNonBlank(document.blueprint.gameVersion, 'Blueprint game version');
    requireSha256(document.blueprint.datasetSha256, 'Blueprint dataset identity');
    if (!sameCompatibility(document.metadata.compatibility, document.blueprint)) {
        throw new Error('Blueprint document compatibility differs from its blueprint payload');
    }
}

export function validatePlannerObservationDocument(document: PlannerObservationDocument): void {
    validateMetadata(document.metadata, 'Observation document');
    validateTimestamp(document.source.observedAt, 'Observation observedAt');
    requireNonBlank(document.source.connectorVersion, 'Observation connector version');
    validatePlannerStateSnapshot(document.state, 'Observation state');
    requireUnique(
        document.inventories,
        ({ owner }, index) => {
            validatePlannerInventorySnapshot(
                document.inventories[index]!,
                `Observation inventory ${index}`
            );
            return `${owner.kind}\0${owner.id}`;
        },
        'Observation inventory owners'
    );
}

function validateOwnership(bundle: PlannerProfileBundle): void {
    const { manifest } = bundle;
    const documents = [
        bundle.manualState,
        ...bundle.inventories,
        ...bundle.checklists,
        ...bundle.blueprints,
        ...(bundle.observation === null ? [] : [bundle.observation]),
    ];
    requireUnique(
        documents,
        ({ metadata }) => metadata.documentId,
        'Planner profile document IDs'
    );
    for (const document of documents) {
        if (document.metadata.profileId !== manifest.profileId) {
            throw new Error(
                `Planner document ${JSON.stringify(document.metadata.documentId)} belongs to ` +
                'a different profile'
            );
        }
        if (!sameCompatibility(document.metadata.compatibility, manifest.compatibility)) {
            throw new Error(
                `Planner document ${JSON.stringify(document.metadata.documentId)} has ` +
                'incompatible game data'
            );
        }
    }
    requireExactReferences(
        manifest.documents.manualStateDocumentId,
        bundle.manualState.metadata.documentId,
        'manual state document'
    );
    requireExactDocumentSet(
        manifest.documents.inventoryDocumentIds,
        bundle.inventories,
        'inventory documents'
    );
    requireExactDocumentSet(
        manifest.documents.checklistDocumentIds,
        bundle.checklists,
        'checklist documents'
    );
    requireExactDocumentSet(
        manifest.documents.blueprintDocumentIds,
        bundle.blueprints,
        'blueprint documents'
    );
    requireExactReferences(
        manifest.documents.latestObservationDocumentId,
        bundle.observation?.metadata.documentId ?? null,
        'latest observation document'
    );
}

export function validatePlannerStateSnapshot(
    state: PlannerStateSnapshot,
    label = 'Planner state'
): void {
    validateMixingRuleProfileValue(state.mixingRuleProfile, `${label} mixing profile`);
    validateRankValue(state.currentRank, `${label} current rank`);
    validateStringSet(state.unlockedPersonIds, `${label} unlocked person IDs`);
    validateRelationshipSet(state.relationships, `${label} relationships`);
    validateStringSet(state.recommendedDealerIds, `${label} recommended dealer IDs`);
    validateStringSet(state.recruitedDealerIds, `${label} recruited dealer IDs`);
    validateCustomerStates(state.customers, `${label} customer states`);
    validateDealerStates(state.dealers, `${label} dealer states`);
    validateNumberValue(state.availableCash, `${label} available cash`, nonNegative);
    validateNumberValue(state.gameMinute, `${label} game minute`, nonNegative);
    validatePropertyStates(state.properties, `${label} property states`);
    validateEmployeeStates(state.employees, `${label} employee states`);
}

function validateMixingRuleProfileValue(
    input: PlannerMixingRuleProfileValue,
    label: string
): void {
    if (input.status === 'known') {
        try {
            normalizeMixingRuleProfile(input.value);
        } catch (error) {
            throw new TypeError(`${label} is invalid`, { cause: error });
        }
    }
}

function validateRankValue(input: PlannerRankValue, label: string): void {
    if (input.status === 'unknown') return;
    requireNonBlank(input.value.rank, `${label} name`);
    requireNonNegativeSafeInteger(input.value.tier, `${label} tier`);
}

function validateStringSet(input: PlannerStringSetValue, label: string): void {
    if (input.status === 'known') requireCanonicalIds(input.values, label);
}

function validateRelationshipSet(input: PlannerRelationshipSetValue, label: string): void {
    if (input.status === 'unknown') return;
    requireCanonicalEntries(input.values, ({ personId, relationship }) => {
        requireId(personId, `${label} person ID`);
        requireFinite(relationship, `${label} value`);
        return personId;
    }, label);
}

function validateCustomerStates(input: PlannerCustomerStateSetValue, label: string): void {
    if (input.status === 'unknown') return;
    requireCanonicalEntries(input.values, (entry) => {
        requireId(entry.customerId, `${label} customer ID`);
        validateNumberValue(entry.addiction, `${label} addiction`, unitInterval);
        validateNumberValue(
            entry.orderLimitMultiplier,
            `${label} order-limit multiplier`,
            positive
        );
        if (entry.drugAffinities.status === 'known') {
            requireCanonicalEntries(entry.drugAffinities.values, (affinity) => {
                requireId(affinity.drugType, `${label} affinity drug type`);
                requireFinite(affinity.affinity, `${label} affinity value`);
                return affinity.drugType;
            }, `${label} affinities for ${entry.customerId}`);
        }
        return entry.customerId;
    }, label);
}

function validateDealerStates(input: PlannerDealerStateSetValue, label: string): void {
    if (input.status === 'unknown') return;
    requireCanonicalEntries(input.values, (entry) => {
        requireId(entry.personId, `${label} person ID`);
        return entry.personId;
    }, label);
}

function validatePropertyStates(input: PlannerPropertyStateSetValue, label: string): void {
    if (input.status === 'unknown') return;
    requireCanonicalEntries(input.values, (property) => {
        requireId(property.propertyCode, `${label} property code`);
        if (property.placements.status === 'known') {
            requireCanonicalEntries(property.placements.values, (placement) => {
                requireId(placement.placementId, `${label} placement ID`);
                if (placement.itemId.status === 'known') {
                    requireId(placement.itemId.value, `${label} placement item ID`);
                }
                validateVector3Value(placement.position, `${label} placement position`);
                validateVector3Value(placement.rotation, `${label} placement rotation`);
                validateNumberValue(
                    placement.moisture,
                    `${label} placement moisture`,
                    unitInterval
                );
                validateNumberValue(
                    placement.trashQuantity,
                    `${label} placement trash quantity`,
                    nonNegative
                );
                return placement.placementId;
            }, `${label} placements for ${property.propertyCode}`);
        }
        return property.propertyCode;
    }, label);
}

function validateEmployeeStates(input: PlannerEmployeeStateSetValue, label: string): void {
    if (input.status === 'unknown') return;
    requireCanonicalEntries(input.values, (employee) => {
        requireId(employee.employeeId, `${label} employee ID`);
        validateVector3Value(employee.position, `${label} position`);
        validateNumberValue(
            employee.currentWorkSpeed,
            `${label} current work speed`,
            nonNegative
        );
        return employee.employeeId;
    }, label);
}

export function validatePlannerInventorySnapshot(
    inventory: PlannerInventorySnapshot,
    label = 'Planner inventory'
): void {
    requireId(inventory.owner.id, `${label} owner ID`);
    requireCanonicalEntries(inventory.entries, (entry) => {
        requireId(entry.itemId, `${label} item ID`);
        validateNumberValue(
            entry.currentQuantity,
            `${label} item quantity`,
            nonNegative
        );
        validateNumberValue(
            entry.currentStackCount,
            `${label} item stack count`,
            nonNegativeSafeInteger
        );
        return entry.itemId;
    }, `${label} entries`);
}

function validateNumberValue(
    input: PlannerNumberValue,
    label: string,
    predicate: (value: number) => boolean
): void {
    if (input.status === 'known' && !predicate(input.value)) {
        throw new RangeError(`${label} is outside its supported range`);
    }
}

function validateVector3Value(input: PlannerVector3Value, label: string): void {
    if (input.status === 'unknown') return;
    if (![input.value.x, input.value.y, input.value.z].every(Number.isFinite)) {
        throw new RangeError(`${label} must contain finite coordinates`);
    }
}

function validateMetadata(metadata: PlannerDocumentMetadata, label: string): void {
    requireId(metadata.documentId, `${label} ID`);
    requireId(metadata.profileId, `${label} profile ID`);
    validateTimestamp(metadata.createdAt, `${label} createdAt`);
    validateTimestamp(metadata.updatedAt, `${label} updatedAt`);
    requireChronology(metadata.createdAt, metadata.updatedAt, label);
    validateCompatibility(metadata.compatibility, label);
}

function validateCompatibility(input: PlannerCompatibility, label: string): void {
    requireNonBlank(input.gameVersion, `${label} game version`);
    requireSha256(input.datasetSha256, `${label} dataset identity`);
}

function requireExactDocumentSet(
    expected: readonly string[],
    documents: readonly { readonly metadata: PlannerDocumentMetadata }[],
    label: string
): void {
    const actual = documents.map(({ metadata }) => metadata.documentId).sort();
    if (!sameStrings(expected, actual)) {
        throw new Error(`Planner profile ${label} differ from its manifest references`);
    }
}

function requireExactReferences(
    expected: string | null,
    actual: string | null,
    label: string
): void {
    if (expected !== actual) {
        throw new Error(`Planner profile ${label} differs from its manifest reference`);
    }
}

function requireCanonicalIds(values: readonly string[], label: string): void {
    requireCanonicalEntries(values, (value) => {
        requireId(value, label);
        return value;
    }, label);
}

function requireCanonicalEntries<T>(
    values: readonly T[],
    key: (value: T, index: number) => string,
    label: string
): void {
    let previous: string | null = null;
    values.forEach((value, index) => {
        const current = key(value, index);
        if (previous !== null && previous >= current) {
            throw new Error(`${label} must be sorted and unique`);
        }
        previous = current;
    });
}

function requireUnique<T>(
    values: readonly T[],
    key: (value: T, index: number) => string,
    label: string
): void {
    const seen = new Set<string>();
    values.forEach((value, index) => {
        const current = key(value, index);
        if (seen.has(current)) throw new Error(`${label} contain duplicate ${JSON.stringify(current)}`);
        seen.add(current);
    });
}

function requireId(value: string, label: string): void {
    requireNonBlank(value, label);
    if (value.includes('\0')) throw new TypeError(`${label} must not contain a null character`);
}

function requireNonBlank(value: string, label: string): void {
    if (value.trim().length === 0) throw new TypeError(`${label} must not be blank`);
}

function requireSha256(value: string, label: string): void {
    if (!sha256Pattern.test(value)) throw new TypeError(`${label} must be a lowercase SHA-256`);
}

function validateTimestamp(value: string, label: string): void {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
        throw new TypeError(`${label} must be a canonical UTC timestamp`);
    }
}

function requireChronology(createdAt: string, updatedAt: string, label: string): void {
    if (updatedAt < createdAt) throw new RangeError(`${label} updatedAt precedes createdAt`);
}

function requireFinite(value: number, label: string): void {
    if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
    if (!nonNegativeSafeInteger(value)) {
        throw new RangeError(`${label} must be a non-negative safe integer`);
    }
}

function finite(value: number): boolean {
    return Number.isFinite(value);
}

function nonNegative(value: number): boolean {
    return finite(value) && value >= 0;
}

function positive(value: number): boolean {
    return finite(value) && value > 0;
}

function unitInterval(value: number): boolean {
    return finite(value) && value >= 0 && value <= 1;
}

function nonNegativeSafeInteger(value: number): boolean {
    return Number.isSafeInteger(value) && value >= 0;
}

function sameCompatibility(
    left: PlannerCompatibility,
    right: PlannerProfileDatasetIdentity
): boolean {
    return left.gameVersion === right.gameVersion &&
        left.datasetSha256 === right.datasetSha256;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
