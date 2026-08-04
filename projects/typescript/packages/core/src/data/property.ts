import { type } from 'arktype';

import { Vector3Schema } from '#core/data/common';

export const BusinessSchema = type({
    launderCapacity: 'number',
    minimumLaunderAmount: 'number',
});
export type Business = typeof BusinessSchema.infer;

export const PropertySchema = type({
    schema: "'neonschedule1-property-1'",
    code: 'string',
    name: 'string',
    price: 'number',
    employeeCapacity: 'number',
    loadingDockCount: 'number',
    gridCount: 'number',
    ambientTemperature: 'number',
    ownedByDefault: 'boolean',
    position: Vector3Schema,
    business: BusinessSchema.or('null'),
    hasLayout: 'boolean',
});
export type Property = typeof PropertySchema.infer;
