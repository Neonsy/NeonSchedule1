import { PropertySchema, type Business, type Property } from '@neonschedule1/core';

import type { RawReport } from '../acquisition/types.js';
import { indexUnique, Integrity, requireReferences } from '../integrity.js';
import { booleanField, numberField, stringField, vector3, type JsonObject } from '../json.js';

export function normalizeProperties(report: RawReport, integrity: Integrity): Property[] {
    const properties = indexUnique(report.world.properties, 'code', 'report.world.properties', integrity);
    const businesses = indexUnique(report.world.businesses, 'propertyCode', 'report.world.businesses', integrity);
    const layouts = indexUnique(
        report.discovery.propertyLayouts,
        'propertyCode',
        'report.discovery.propertyLayouts',
        integrity
    );
    const propertyCodes = new Set(properties.keys());
    requireReferences(businesses.keys(), propertyCodes, 'business', integrity);
    requireReferences(layouts.keys(), propertyCodes, 'property layout', integrity);
    integrity.check(
        'every property has one layout record',
        layouts.size === properties.size,
        `Expected ${properties.size} property layouts, found ${layouts.size}`
    );

    return [...properties.entries()]
        .map(([code, raw]) => {
            const path = `report.world.properties[${JSON.stringify(code)}]`;
            const isBusiness = booleanField(raw, 'isBusiness', path);
            const business = businesses.get(code);
            if (isBusiness !== (business !== undefined)) {
                integrity.addError(`Property ${JSON.stringify(code)} business flag and business record differ`);
            }
            const property: Property = {
                schema: 'neonschedule1-property-1',
                code,
                name: stringField(raw, 'name', path),
                price: numberField(raw, 'price', path),
                employeeCapacity: numberField(raw, 'employeeCapacity', path),
                loadingDockCount: numberField(raw, 'loadingDockCount', path),
                gridCount: numberField(raw, 'gridCount', path),
                ambientTemperature: numberField(raw, 'ambientTemperature', path),
                ownedByDefault: booleanField(raw, 'ownedByDefault', path),
                position: vector3(raw.position, `${path}.position`),
                business: business === undefined ? null : normalizeBusiness(business, `${path}.business`),
                hasLayout: layouts.has(code),
            };
            return PropertySchema.assert(property);
        })
        .sort((left, right) => left.code.localeCompare(right.code));
}

function normalizeBusiness(raw: JsonObject, path: string): Business {
    return {
        launderCapacity: numberField(raw, 'launderCapacity', path),
        minimumLaunderAmount: numberField(raw, 'minimumLaunderAmount', path),
    };
}
