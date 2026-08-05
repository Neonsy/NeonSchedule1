import {
    CustomerCatalogSchema,
    CustomerConstantsSchema,
    CustomerDrugAffinitySchema,
    CustomerOrderDaySchema,
    CustomerProductEvaluationOracleSchema,
    CustomerQualityEnjoymentSchema,
    CustomerQualityTierSchema,
    CustomerSchema,
    CustomerStandardsSchema,
    type Customer,
    type CustomerCatalog,
    type CustomerProductEvaluationInput,
    type CustomerProductEvaluationOracle,
    type CustomerQualityTier,
} from '@neonschedule1/core';

import type { RawReport } from '#data-compiler/acquisition/types';
import { indexUnique, Integrity, requireReferences } from '#data-compiler/integrity';
import {
    asArray,
    booleanField,
    numberField,
    objectArray,
    stringArrayField,
    stringField,
    type JsonObject,
} from '#data-compiler/json';

export interface NormalizedCustomers {
    readonly catalog: CustomerCatalog;
    readonly customers: readonly Customer[];
}

const numericConstantKeys = [
    'addictionDrainPerDay',
    'affinityMaxEffect',
    'approachChancePerDayMax',
    'approachMinimumAddiction',
    'approachMinimumCooldown',
    'approachMaximumCooldown',
    'dealCooldown',
    'minimumTravelTime',
    'maximumTravelTime',
    'minimumNormalizedRelationshipForRecommendation',
    'minimumOrderAppeal',
    'propertyMaxEffect',
    'qualityMaxEffect',
    'guaranteedDealerRecommendationRelationship',
    'guaranteedSupplierRecommendationRelationship',
    'minimumRelationship',
    'maximumRelationship',
    'maximumOrderQuantityPerProduct',
    'qualityTierTolerance',
    'attackDealCooldown',
    'customerUnlockedCartelInfluenceChange',
    'dealAttendanceTolerance',
    'dealRejectedRelationshipChange',
    'offerExpiryTimeMinutes',
    'relationshipThresholdToGiveDealToCartel',
] as const;

export function normalizeCustomers(
    report: RawReport,
    effectIds: ReadonlySet<string>,
    productIds: ReadonlySet<string>,
    integrity: Integrity
): NormalizedCustomers {
    const rawCustomers = indexUnique(report.customers, 'personId', 'report.customers', integrity);
    const customerIds = new Set(rawCustomers.keys());
    const rawPeople = report.people.filter((person, index) =>
        customerIds.has(stringField(person, 'id', `report.people[${index}]`))
    );
    const people = indexUnique(rawPeople, 'id', 'report.people for customers', integrity);

    integrity.check(
        'customer source count matches normalized customer identities',
        report.peopleSources.uniqueCustomerCount === rawCustomers.size,
        `Expected ${report.peopleSources.uniqueCustomerCount} unique customers, found ${rawCustomers.size}`
    );
    requireReferences(customerIds, new Set(people.keys()), 'customer person', integrity);

    const productInputs = new Map<string, CustomerProductEvaluationInput>();
    const qualityTiers = new Map<string, CustomerQualityTier>();
    const customers = [...rawCustomers.entries()]
        .map(([id, raw]) =>
            normalizeCustomer(
                id,
                raw,
                people.get(id),
                effectIds,
                productIds,
                productInputs,
                qualityTiers,
                integrity
            )
        )
        .sort((left, right) => left.id.localeCompare(right.id));

    const catalog = CustomerCatalogSchema.assert({
        schema: 'neonschedule1-customer-catalog-1',
        constants: normalizeConstants(report.customerConstants),
        qualityTiers: [...qualityTiers.values()].sort((left, right) => left.value - right.value),
        productEvaluationInputs: [...productInputs.values()].sort((left, right) =>
            left.productId.localeCompare(right.productId)
        ),
        customerIds: customers.map((customer) => customer.id),
    } satisfies CustomerCatalog);

    integrity.check(
        'customer evaluation inputs cover every base product',
        productInputs.size === productIds.size,
        `Expected ${productIds.size} customer product inputs, found ${productInputs.size}`
    );
    integrity.check(
        'customer evaluation oracle defines every quality tier',
        qualityTiers.size === 5,
        `Expected 5 customer quality tiers, found ${qualityTiers.size}`
    );
    integrity.check(
        'customer quality tiers have unique numeric values',
        new Set([...qualityTiers.values()].map((tier) => tier.value)).size === qualityTiers.size,
        'Customer quality tiers contain duplicate numeric values'
    );
    return { catalog, customers };
}

function normalizeCustomer(
    id: string,
    raw: JsonObject,
    person: JsonObject | undefined,
    effectIds: ReadonlySet<string>,
    productIds: ReadonlySet<string>,
    productInputs: Map<string, CustomerProductEvaluationInput>,
    qualityTiers: Map<string, CustomerQualityTier>,
    integrity: Integrity
): Customer {
    const path = `report.customers[${JSON.stringify(id)}]`;
    if (person === undefined) {
        integrity.addError(`${path} has no person record`);
    }
    const preferredEffectIds = stringArrayField(raw, 'preferredEffectIds', path);
    requireReferences(preferredEffectIds, effectIds, `customer ${id} preferred effect`, integrity);
    checkUnique(preferredEffectIds, `${path}.preferredEffectIds`, integrity);

    const drugAffinities = indexUnique(
        objectArray(raw.drugAffinities, `${path}.drugAffinities`),
        'drugType',
        `${path}.drugAffinities`,
        integrity
    );
    const normalizedAffinities = [...drugAffinities.entries()]
        .map(([drugType, affinity]) => {
            const value = numberField(affinity, 'affinity', `${path}.drugAffinities[${drugType}]`);
            checkRange(value, -1, 1, `${path}.drugAffinities[${drugType}].affinity`, integrity);
            return CustomerDrugAffinitySchema.assert({ drugType, affinity: value });
        })
        .sort((left, right) => left.drugType.localeCompare(right.drugType));

    const evaluations = normalizeEvaluations(
        raw,
        path,
        productIds,
        productInputs,
        qualityTiers,
        integrity
    );
    const minimumWeeklySpend = numberField(raw, 'minimumWeeklySpend', path);
    const maximumWeeklySpend = numberField(raw, 'maximumWeeklySpend', path);
    const minimumOrdersPerWeek = numberField(raw, 'minimumOrdersPerWeek', path);
    const maximumOrdersPerWeek = numberField(raw, 'maximumOrdersPerWeek', path);
    const minimumRelationship = numberField(raw, 'minimumMutualRelationshipRequirement', path);
    const maximumRelationship = numberField(raw, 'maximumMutualRelationshipRequirement', path);
    checkOrdered(minimumWeeklySpend, maximumWeeklySpend, `${path}.weeklySpend`, integrity);
    checkOrdered(minimumOrdersPerWeek, maximumOrdersPerWeek, `${path}.weeklyOrders`, integrity);
    checkOrdered(minimumRelationship, maximumRelationship, `${path}.mutualRelationshipRequirement`, integrity);
    integrity.check(
        `${id} weekly spend is non-negative`,
        minimumWeeklySpend >= 0,
        `${path}.weeklySpend cannot be negative`
    );
    integrity.check(
        `${id} weekly order limits are non-negative integers`,
        Number.isInteger(minimumOrdersPerWeek) &&
            Number.isInteger(maximumOrdersPerWeek) &&
            minimumOrdersPerWeek >= 0,
        `${path}.weeklyOrders must be non-negative integers`
    );

    const orderTime = numberField(raw, 'orderTime', path);
    integrity.check(
        `${id} order time is a valid HHMM value`,
        Number.isInteger(orderTime) && orderTime >= 0 && orderTime < 2400 && orderTime % 100 < 60,
        `${path}.orderTime is not a valid HHMM value: ${orderTime}`
    );
    const callPoliceChance = numberField(raw, 'callPoliceChance', path);
    checkRange(callPoliceChance, 0, 1, `${path}.callPoliceChance`, integrity);
    const baseAddiction = numberField(raw, 'baseAddiction', path);
    checkRange(baseAddiction, 0, 1, `${path}.baseAddiction`, integrity);
    const dependenceMultiplier = numberField(raw, 'dependenceMultiplier', path);
    integrity.check(
        `${id} dependence multiplier is non-negative`,
        dependenceMultiplier >= 0,
        `${path}.dependenceMultiplier cannot be negative`
    );

    const customer = {
        schema: 'neonschedule1-customer-1',
        id,
        name: {
            first: person === undefined ? '' : stringField(person, 'firstName', `${path}.person`),
            last: person === undefined ? '' : stringField(person, 'lastName', `${path}.person`),
            full: person === undefined ? '' : stringField(person, 'fullName', `${path}.person`),
        },
        region: person === undefined ? '' : stringField(person, 'region', `${path}.person`),
        standards: CustomerStandardsSchema.assert(stringField(raw, 'standards', path)),
        preferredEffectIds: [...preferredEffectIds].sort(),
        drugAffinities: normalizedAffinities,
        baseAddiction,
        dependenceMultiplier,
        callPoliceChance,
        canBeDirectlyApproached: booleanField(raw, 'canBeDirectlyApproached', path),
        guaranteeFirstSampleSuccess: booleanField(raw, 'guaranteeFirstSampleSuccess', path),
        weeklySpend: { minimum: minimumWeeklySpend, maximum: maximumWeeklySpend },
        weeklyOrders: { minimum: minimumOrdersPerWeek, maximum: maximumOrdersPerWeek },
        preferredOrderDay: CustomerOrderDaySchema.assert(
            stringField(raw, 'preferredOrderDay', path)
        ),
        orderTime,
        mutualRelationshipRequirement: {
            minimum: minimumRelationship,
            maximum: maximumRelationship,
        },
        evaluationOracle: evaluations,
    } satisfies Customer;
    return CustomerSchema.assert(customer);
}

function normalizeEvaluations(
    customer: JsonObject,
    customerPath: string,
    productIds: ReadonlySet<string>,
    productInputs: Map<string, CustomerProductEvaluationInput>,
    qualityTiers: Map<string, CustomerQualityTier>,
    integrity: Integrity
): CustomerProductEvaluationOracle[] {
    const exportedErrors = stringArrayField(customer, 'productEvaluationErrors', customerPath);
    integrity.check(
        `${customerPath} product evaluation completed without exporter errors`,
        exportedErrors.length === 0,
        `${customerPath}.productEvaluationErrors contains ${exportedErrors.length} error(s)`
    );
    const rawEvaluations = indexUnique(
        objectArray(customer.productEvaluationBaseline, `${customerPath}.productEvaluationBaseline`),
        'productId',
        `${customerPath}.productEvaluationBaseline`,
        integrity
    );
    requireReferences(rawEvaluations.keys(), productIds, `${customerPath} evaluation`, integrity);
    integrity.check(
        `${customerPath} evaluates every base product`,
        rawEvaluations.size === productIds.size,
        `${customerPath} evaluates ${rawEvaluations.size} of ${productIds.size} base products`
    );

    return [...rawEvaluations.entries()]
        .map(([productId, raw]) =>
            normalizeEvaluation(
                productId,
                raw,
                `${customerPath}.productEvaluationBaseline[${JSON.stringify(productId)}]`,
                productInputs,
                qualityTiers,
                integrity
            )
        )
        .sort((left, right) => left.productId.localeCompare(right.productId));
}

function normalizeEvaluation(
    productId: string,
    raw: JsonObject,
    path: string,
    productInputs: Map<string, CustomerProductEvaluationInput>,
    qualityTiers: Map<string, CustomerQualityTier>,
    integrity: Integrity
): CustomerProductEvaluationOracle {
    const errors = asArray(raw.errors, `${path}.errors`);
    integrity.check(
        `${path} completed without exporter errors`,
        errors.length === 0,
        `${path}.errors contains ${errors.length} error(s)`
    );
    const input = {
        productId,
        quantity: numberField(raw, 'quantity', path),
        price: numberField(raw, 'price', path),
        valueProposition: numberField(raw, 'valueProposition', path),
    } satisfies CustomerProductEvaluationInput;
    integrity.check(
        `${path} quantity is a positive integer`,
        Number.isInteger(input.quantity) && input.quantity > 0,
        `${path}.quantity must be a positive integer`
    );
    integrity.check(
        `${path} price is non-negative`,
        input.price >= 0,
        `${path}.price cannot be negative`
    );
    const existingInput = productInputs.get(productId);
    if (existingInput === undefined) {
        productInputs.set(productId, input);
    } else if (!sameInput(existingInput, input)) {
        integrity.addError(`${path} disagrees with the shared input for ${JSON.stringify(productId)}`);
    }

    const rawQualities = indexUnique(
        objectArray(raw.qualityEnjoyment, `${path}.qualityEnjoyment`),
        'quality',
        `${path}.qualityEnjoyment`,
        integrity
    );
    integrity.check(
        `${path} evaluates every quality tier`,
        rawQualities.size === 5,
        `${path} evaluates ${rawQualities.size} quality tiers instead of 5`
    );
    const qualities = [...rawQualities.entries()]
        .map(([quality, rawQuality]) => {
            const qualityPath = `${path}.qualityEnjoyment[${JSON.stringify(quality)}]`;
            const tier = CustomerQualityTierSchema.assert({
                name: quality,
                value: numberField(rawQuality, 'qualityValue', qualityPath),
            });
            const existingTier = qualityTiers.get(quality);
            if (existingTier === undefined) {
                qualityTiers.set(quality, tier);
            } else if (existingTier.value !== tier.value) {
                integrity.addError(`${qualityPath}.qualityValue disagrees with the shared tier value`);
            }
            const enjoyment = numberField(rawQuality, 'enjoyment', qualityPath);
            checkRange(enjoyment, 0, 1, `${qualityPath}.enjoyment`, integrity);
            return {
                value: CustomerQualityEnjoymentSchema.assert({ quality, enjoyment }),
                qualityValue: tier.value,
            };
        })
        .sort((left, right) => left.qualityValue - right.qualityValue)
        .map(({ value }) => value);
    const productEnjoyment = numberField(raw, 'productEnjoyment', path);
    checkRange(productEnjoyment, 0, 1, `${path}.productEnjoyment`, integrity);
    return CustomerProductEvaluationOracleSchema.assert({
        productId,
        productEnjoyment,
        qualityEnjoyment: qualities,
    });
}

function normalizeConstants(raw: JsonObject) {
    const path = 'report.customerConstants';
    const constants = Object.fromEntries(
        numericConstantKeys.map((key) => [key, numberField(raw, key, path)])
    );
    return CustomerConstantsSchema.assert({
        ...constants,
        sampleRequiresRecommendation: booleanField(raw, 'sampleRequiresRecommendation', path),
    });
}

function sameInput(
    left: CustomerProductEvaluationInput,
    right: CustomerProductEvaluationInput
): boolean {
    return (
        left.quantity === right.quantity &&
        left.price === right.price &&
        left.valueProposition === right.valueProposition
    );
}

function checkUnique(values: readonly string[], path: string, integrity: Integrity): void {
    integrity.check(
        `${path} contains unique values`,
        new Set(values).size === values.length,
        `${path} contains duplicate values`
    );
}

function checkOrdered(minimum: number, maximum: number, path: string, integrity: Integrity): void {
    integrity.check(
        `${path} minimum does not exceed maximum`,
        minimum <= maximum,
        `${path}.minimum ${minimum} exceeds maximum ${maximum}`
    );
}

function checkRange(
    value: number,
    minimum: number,
    maximum: number,
    path: string,
    integrity: Integrity
): void {
    integrity.check(
        `${path} is between ${minimum} and ${maximum}`,
        value >= minimum && value <= maximum,
        `${path} must be between ${minimum} and ${maximum}, found ${value}`
    );
}
