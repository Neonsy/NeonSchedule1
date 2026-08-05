import {
    CustomerDrugTypeSchema,
    CustomerOfferEvaluator,
    CustomerQualitySchema,
    type Item,
} from '@neonschedule1/core';

import type { RawReport } from '#data-compiler/acquisition/types';
import { indexUnique, Integrity } from '#data-compiler/integrity';
import { numberField, objectArray, stringField } from '#data-compiler/json';
import {
    normalizeCurrentAffinities,
    type NormalizedCustomers,
} from '#data-compiler/normalize/customers';

const offerCaseDefinitions = [
    { id: 'discount-25-percent', quantity: 1, quality: 'Standard', priceMultiplier: 0.75 },
    { id: 'high-price-4x', quantity: 1, quality: 'Standard', priceMultiplier: 4 },
    { id: 'market-three-units', quantity: 3, quality: 'Standard', priceMultiplier: 3 },
    { id: 'markup-50-percent', quantity: 1, quality: 'Standard', priceMultiplier: 1.5 },
    { id: 'premium-market', quantity: 1, quality: 'Premium', priceMultiplier: 1 },
] as const;

export function validateCustomerOfferOracles(
    report: RawReport,
    normalized: NormalizedCustomers,
    items: readonly Item[],
    integrity: Integrity
): void {
    const evaluator = new CustomerOfferEvaluator(normalized.catalog);
    const rawCustomers = indexUnique(
        report.customers,
        'personId',
        'report.customers for offer validation',
        integrity
    );
    const customerIds = new Set(rawCustomers.keys());
    const people = indexUnique(
        report.people.filter((person) => {
            const id = person.id;
            return typeof id === 'string' && customerIds.has(id);
        }),
        'id',
        'report.people for offer validation',
        integrity
    );
    const products = new Map(
        items.flatMap((item) => {
            if (item.product === null) return [];
            return [
                [
                    item.id,
                    {
                        drugTypes: [CustomerDrugTypeSchema.assert(item.product.drugType)],
                        effectIds: item.product.effectIds,
                        marketValue: item.product.marketValue,
                    },
                ] as const,
            ];
        })
    );
    const multiplier = report.world.currentOrderLimitMultiplierInLoadedSave;
    integrity.check(
        'loaded-save customer order limit multiplier is positive',
        multiplier > 0,
        `Loaded-save customer order limit multiplier must be positive, found ${multiplier}`
    );

    let cases = 0;
    let firstMismatch: string | undefined;
    let firstIncompleteCaseSet: string | undefined;
    let firstInvalidCaseInput: string | undefined;
    const exportedChances = new Set<number>();
    for (const customer of normalized.customers) {
        const rawCustomer = rawCustomers.get(customer.id);
        const person = people.get(customer.id);
        if (rawCustomer === undefined || person === undefined) continue;

        const rawPath = `report.customers[${JSON.stringify(customer.id)}]`;
        const profile = {
            ...customer,
            drugAffinities: normalizeCurrentAffinities(
                rawCustomer,
                customer.id,
                integrity
            ),
        };
        const state = {
            addiction: numberField(
                rawCustomer,
                'currentAddictionInLoadedSave',
                rawPath
            ),
            relationship: numberField(
                person,
                'relationshipInLoadedSave',
                `report.people[${JSON.stringify(customer.id)}]`
            ),
            orderLimitMultiplier: multiplier,
        };
        const evaluations = indexUnique(
            objectArray(rawCustomer.productEvaluationBaseline, `${rawPath}.productEvaluationBaseline`),
            'productId',
            `${rawPath}.productEvaluationBaseline`,
            integrity
        );

        for (const [productId, raw] of evaluations) {
            const product = products.get(productId);
            if (product === undefined) {
                integrity.addError(
                    `Customer offer oracle references missing product ${JSON.stringify(productId)}`
                );
                continue;
            }

            const productPath = `${rawPath}.productEvaluationBaseline[${JSON.stringify(productId)}]`;
            const offerCases = indexUnique(
                objectArray(raw.offerCases, `${productPath}.offerCases`),
                'id',
                `${productPath}.offerCases`,
                integrity
            );
            if (
                firstIncompleteCaseSet === undefined &&
                (offerCases.size !== offerCaseDefinitions.length ||
                    !offerCaseDefinitions.every(({ id }) => offerCases.has(id)))
            ) {
                firstIncompleteCaseSet = productPath;
            }

            const baseline = {
                id: 'baseline',
                quality: stringField(raw, 'offerQuality', productPath),
                quantity: numberField(raw, 'quantity', productPath),
                askingPrice: numberField(raw, 'price', productPath),
                expected: numberField(raw, 'offerSuccessChance', productPath),
            };
            const unitPrice = Math.fround(
                Math.fround(baseline.askingPrice) / baseline.quantity
            );
            const inputs = [baseline];
            for (const definition of offerCaseDefinitions) {
                const offerCase = offerCases.get(definition.id);
                if (offerCase === undefined) continue;
                const casePath = `${productPath}.offerCases.${definition.id}`;
                const input = {
                    id: definition.id,
                    quality: stringField(offerCase, 'quality', casePath),
                    quantity: numberField(offerCase, 'quantity', casePath),
                    askingPrice: numberField(offerCase, 'price', casePath),
                    expected: numberField(offerCase, 'successChance', casePath),
                };
                const expectedPrice = Math.fround(
                    unitPrice * Math.fround(definition.priceMultiplier)
                );
                if (
                    firstInvalidCaseInput === undefined &&
                    (input.quantity !== definition.quantity ||
                        input.quality !== definition.quality ||
                        input.askingPrice !== expectedPrice)
                ) {
                    firstInvalidCaseInput = casePath;
                }
                inputs.push(input);
            }
            for (const input of inputs) {
                const actual = evaluator.evaluate(profile, product, state, {
                    quality: CustomerQualitySchema.assert(input.quality),
                    quantity: input.quantity,
                    askingPrice: input.askingPrice,
                });
                cases += 1;
                exportedChances.add(input.expected);
                const expected = Math.fround(input.expected);
                if (actual !== expected && firstMismatch === undefined) {
                    firstMismatch = `${customer.id}/${productId}/${input.id}: expected ${input.expected}, calculated ${actual}`;
                }
            }
        }
    }

    integrity.check(
        'every customer product defines the complete offer case matrix',
        firstIncompleteCaseSet === undefined,
        `Customer offer case matrix is incomplete at ${firstIncompleteCaseSet}`
    );
    integrity.check(
        'every customer offer case uses its declared terms',
        firstInvalidCaseInput === undefined,
        `Customer offer case terms differ at ${firstInvalidCaseInput}`
    );
    const expectedCases =
        normalized.customers.length * products.size * (offerCaseDefinitions.length + 1);
    integrity.check(
        `customer offer oracle contains ${expectedCases} cases`,
        cases === expectedCases,
        `Expected ${expectedCases} customer offer cases, found ${cases}`
    );

    integrity.check(
        `customer offer evaluator matches ${cases} packaged-product oracle cases`,
        firstMismatch === undefined,
        `Customer offer acceptance differs from the export at ${firstMismatch}`
    );
    integrity.check(
        'customer offer oracle contains meaningful probability variation',
        exportedChances.size > 1 || (exportedChances.size === 1 && !exportedChances.has(0)),
        'All exported customer offer chances are zero'
    );
}
