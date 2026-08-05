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

            const expected = numberField(raw, 'offerSuccessChance', `${rawPath}.${productId}`);
            const actual = evaluator.evaluate(profile, product, state, {
                quality: CustomerQualitySchema.assert(
                    stringField(raw, 'offerQuality', `${rawPath}.${productId}`)
                ),
                quantity: numberField(raw, 'quantity', `${rawPath}.${productId}`),
                askingPrice: numberField(raw, 'price', `${rawPath}.${productId}`),
            });
            cases += 1;
            exportedChances.add(expected);
            if (actual !== Math.fround(expected) && firstMismatch === undefined) {
                firstMismatch = `${customer.id}/${productId}: expected ${expected}, calculated ${actual}`;
            }
        }
    }

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
