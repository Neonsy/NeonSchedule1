import { type } from 'arktype';

import { Vector3Schema } from '#core/data/common';
import { ColliderSchema, SceneVisualsSchema, TransformSchema } from '#core/data/geometry';

export const BuildableFootprintTileSchema = type({
    x: 'number',
    y: 'number',
    requiredOffset: 'number',
    transform: TransformSchema,
});
export type BuildableFootprintTile = typeof BuildableFootprintTileSchema.infer;

export const BuildablePlacementSchema = type({
    kind: 'string',
    holdDistance: 'number',
    footprintWidth: 'number | null',
    footprintHeight: 'number | null',
    proceduralTileType: 'string | null',
    allowRotation: 'boolean | null',
    rotationIncrement: 'number | null',
    validSurfaceTypes: 'string[]',
    buildPoint: TransformSchema,
    midAirCenterPoint: TransformSchema.or('null'),
    boundingCollider: ColliderSchema,
    footprintTiles: BuildableFootprintTileSchema.array(),
});
export type BuildablePlacement = typeof BuildablePlacementSchema.infer;

export const BuildableStorageSchema = type({
    name: 'string',
    subtitle: 'string',
    slotCount: 'number',
    displayRowCount: 'number',
    slotsAreFilterable: 'boolean',
    maxAccessDistance: 'number',
    transform: TransformSchema,
});
export type BuildableStorage = typeof BuildableStorageSchema.infer;

export const TemperatureEmitterSchema = type({
    temperature: 'number',
    range: 'number',
    emissionPoint: Vector3Schema,
});
export type TemperatureEmitter = typeof TemperatureEmitterSchema.infer;

export const InteractionPointSchema = type({
    componentType: 'string',
    member: 'string',
    role: 'string',
    transform: TransformSchema,
});
export type InteractionPoint = typeof InteractionPointSchema.infer;

export const BuildableSchema = type({
    schema: "'neonschedule1-buildable-2'",
    itemId: 'string',
    runtimeType: 'string',
    placement: BuildablePlacementSchema,
    componentTypes: 'string[]',
    colliders: ColliderSchema.array(),
    storage: BuildableStorageSchema.or('null'),
    temperatureEmitters: TemperatureEmitterSchema.array(),
    interactionPoints: InteractionPointSchema.array(),
    visuals: SceneVisualsSchema,
});
export type Buildable = typeof BuildableSchema.infer;
