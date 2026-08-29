import { type } from 'arktype';

import { SlugSchema } from '#public-data/browser/common-schema';

export const PublicCalculationProofKeySchema = type("'exact'")
    .or("'conditional'")
    .or("'incomplete'")
    .or("'unsupported'")
    .or("'unavailable'")
    .or("'not-applicable'");
export type PublicCalculationProofKey = typeof PublicCalculationProofKeySchema.infer;

const PublicCalculationProofClassSchema = type({
    key: PublicCalculationProofKeySchema,
    label: 'string',
    resultUse: "'complete' | 'condition-dependent' | 'partial-only' | 'none'",
    explanation: 'string',
});

const PublicCalculationSearchModeSchema = type({
    key: "'quick' | 'balanced' | 'precise' | 'exhaustive'",
    label: 'string',
    execution: "'live-bounded-after-coverage-miss' | 'verified-precomputed-only'",
    maximumIngredients: 'number | null',
    advisoryDuration: type({
        minimumMs: 'number',
        maximumMs: 'number',
        scope: "'per-product-search'",
    }).or('null'),
    possibleOutcomeKeys: SlugSchema.array(),
    explanation: 'string',
});

const PublicRecipeObjectiveSchema = type({
    key: SlugSchema,
    label: 'string',
    direction: "'highest-first' | 'lowest-first'",
    explanation: 'string',
});

const PublicCalculationSourceChoiceSchema = type({
    key: SlugSchema,
    label: 'string',
    explanation: 'string',
});

const PublicCalculationInputSchema = type({
    key: SlugSchema,
    label: 'string',
    ownership: type("'static-game-data'")
        .or("'user-choice'")
        .or("'local-user-state'")
        .or("'live-runtime-evidence'")
        .or("'generated-plan'"),
    requirement: "'required' | 'conditional' | 'optional'",
    explanation: 'string',
});

const PublicCalculationOutcomeSchema = type({
    key: SlugSchema,
    label: 'string',
    proofKey: PublicCalculationProofKeySchema,
    resultAvailability: "'complete' | 'partial' | 'none'",
    explanation: 'string',
});

const PublicCalculationGapSchema = type({
    key: SlugSchema,
    label: 'string',
    proofKey: PublicCalculationProofKeySchema,
    explanation: 'string',
});

const PublicCalculationLimitSchema = type({
    key: SlugSchema,
    label: 'string',
    explanation: 'string',
});

const PublicCalculationFamilySchema = type({
    key: SlugSchema,
    label: 'string',
    featureKeys: SlugSchema.array(),
    calculatorOwner: "'core' | 'solver-and-core'",
    requestInputs: PublicCalculationInputSchema.array(),
    controlKeys: SlugSchema.array(),
    outcomes: PublicCalculationOutcomeSchema.array(),
    gaps: PublicCalculationGapSchema.array(),
    limits: PublicCalculationLimitSchema.array(),
});

export const PublicCalculationContractsSchema = type({
    schema: "'neonschedule1-public-calculation-contracts-1'",
    requestPolicy: {
        compatibility: "'matching-game-and-dataset-required'",
        persistence: "'request-local-not-stored'",
        sourceSelection: "'explicit-no-automatic-merge'",
        unknownValues: "'preserved-not-assumed'",
        invalidRequests: "'rejected-before-calculation'",
        identifiers: "'opaque-public-keys-only'",
        applicationTransport: "'not-defined'",
    },
    proofClasses: PublicCalculationProofClassSchema.array(),
    controls: {
        searchModes: PublicCalculationSearchModeSchema.array(),
        recipeObjectives: PublicRecipeObjectiveSchema.array(),
        stateSources: PublicCalculationSourceChoiceSchema.array(),
        inventorySources: PublicCalculationSourceChoiceSchema.array(),
    },
    families: PublicCalculationFamilySchema.array(),
    counts: {
        proofClasses: 'number',
        searchModes: 'number',
        recipeObjectives: 'number',
        stateSources: 'number',
        inventorySources: 'number',
        families: 'number',
        requestInputs: 'number',
        outcomes: 'number',
        gaps: 'number',
        limits: 'number',
    },
});
export type PublicCalculationContracts = typeof PublicCalculationContractsSchema.infer;
