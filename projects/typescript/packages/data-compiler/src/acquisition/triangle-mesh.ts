import { readFile } from 'node:fs/promises';

import type { TriangleMesh, Vector3 } from '@neonschedule1/core';

export type ParsedTriangleMesh = Omit<TriangleMesh, 'meshId'>;

const glbMagic = 0x46546c67;
const jsonChunkType = 0x4e4f534a;
const binaryChunkType = 0x004e4942;

export async function readTriangleMesh(
    filePath: string,
    mediaType: string
): Promise<ParsedTriangleMesh> {
    const content = await readFile(filePath);
    switch (mediaType) {
        case 'model/gltf-binary': return parseGlbTriangleMesh(content);
        case 'model/obj': return parseObjTriangleMesh(content.toString('utf8'));
        default: throw new TypeError(`Unsupported triangle-mesh media type ${JSON.stringify(mediaType)}`);
    }
}

export function parseGlbTriangleMesh(content: Uint8Array): ParsedTriangleMesh {
    const buffer = Buffer.from(content.buffer, content.byteOffset, content.byteLength);
    if (buffer.length < 20 || buffer.readUInt32LE(0) !== glbMagic) {
        throw new TypeError('GLB has an invalid header');
    }
    if (buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length) {
        throw new TypeError('GLB must be a complete version 2 document');
    }
    let json: unknown;
    let binary: Buffer | undefined;
    for (let offset = 12; offset < buffer.length;) {
        if (offset + 8 > buffer.length) throw new TypeError('GLB has a truncated chunk header');
        const length = buffer.readUInt32LE(offset);
        const type = buffer.readUInt32LE(offset + 4);
        const end = offset + 8 + length;
        if (end > buffer.length) throw new TypeError('GLB has a truncated chunk');
        const chunk = buffer.subarray(offset + 8, end);
        if (type === jsonChunkType) {
            if (json !== undefined) throw new TypeError('GLB contains more than one JSON chunk');
            json = JSON.parse(chunk.toString('utf8').replace(/[\u0000\u0020]+$/u, ''));
        } else if (type === binaryChunkType) {
            if (binary !== undefined) throw new TypeError('GLB contains more than one binary chunk');
            binary = chunk;
        }
        offset = end;
    }
    if (json === undefined || binary === undefined) {
        throw new TypeError('GLB must contain JSON and binary chunks');
    }
    return triangleMeshFromGlb(asRecord(json, 'GLB JSON'), binary);
}

export function parseObjTriangleMesh(content: string): ParsedTriangleMesh {
    const vertices: Vector3[] = [];
    const triangles: number[] = [];
    for (const [lineIndex, rawLine] of content.split(/\r?\n/u).entries()) {
        const line = rawLine.trim();
        if (line === '' || line.startsWith('#')) continue;
        const parts = line.split(/\s+/u);
        if (parts[0] === 'v') {
            if (parts.length !== 4) throw new TypeError(`OBJ vertex on line ${lineIndex + 1} is invalid`);
            vertices.push(vector(parts.slice(1), `OBJ vertex on line ${lineIndex + 1}`));
        } else if (parts[0] === 'f') {
            if (parts.length < 4) throw new TypeError(`OBJ face on line ${lineIndex + 1} is invalid`);
            const indices = parts.slice(1).map((part) => {
                const index = Number(part.split('/')[0]);
                if (!Number.isSafeInteger(index) || index < 1 || index > vertices.length) {
                    throw new RangeError(`OBJ face index on line ${lineIndex + 1} is invalid`);
                }
                return index - 1;
            });
            for (let index = 1; index + 1 < indices.length; index++) {
                triangles.push(indices[0]!, indices[index]!, indices[index + 1]!);
            }
        }
    }
    return validatedMesh(vertices, triangles);
}

function triangleMeshFromGlb(document: Record<string, unknown>, binary: Buffer): ParsedTriangleMesh {
    const buffers = records(document.buffers, 'GLB buffers');
    if (buffers.length !== 1 || integer(buffers[0]!.byteLength, 'GLB buffer length') > binary.length) {
        throw new TypeError('GLB must contain one embedded binary buffer');
    }
    const nodes = records(document.nodes, 'GLB nodes');
    for (const node of nodes) {
        for (const field of ['matrix', 'translation', 'rotation', 'scale']) {
            if (node[field] !== undefined) throw new TypeError('GLB nodes must not contain transforms');
        }
    }
    const meshes = records(document.meshes, 'GLB meshes');
    const meshReferences = nodes
        .filter((node) => node.mesh !== undefined)
        .map((node) => integer(node.mesh, 'GLB node mesh'));
    const referencedMeshes = new Set(meshReferences);
    if (
        meshReferences.length !== meshes.length ||
        referencedMeshes.size !== meshes.length ||
        meshReferences.some((index) => index >= meshes.length)
    ) {
        throw new TypeError('Every GLB mesh must be referenced exactly once without instancing');
    }

    const accessors = records(document.accessors, 'GLB accessors');
    const views = records(document.bufferViews, 'GLB buffer views');
    const vertices: Vector3[] = [];
    const triangles: number[] = [];
    for (const mesh of meshes) {
        for (const primitive of records(mesh.primitives, 'GLB mesh primitives')) {
            if (primitive.mode !== undefined && integer(primitive.mode, 'GLB primitive mode') !== 4) {
                throw new TypeError('GLB collision geometry must use triangle primitives');
            }
            const attributes = asRecord(primitive.attributes, 'GLB primitive attributes');
            const positions = readPositions(
                accessor(accessors, attributes.POSITION, 'GLB POSITION'),
                views,
                binary
            );
            const indices = primitive.indices === undefined
                ? positions.map((_, index) => index)
                : readIndices(accessor(accessors, primitive.indices, 'GLB indices'), views, binary);
            if (indices.length % 3 !== 0 || indices.some((index) => index >= positions.length)) {
                throw new RangeError('GLB primitive contains invalid triangle indices');
            }
            const base = vertices.length;
            vertices.push(...positions);
            triangles.push(...indices.map((index) => base + index));
        }
    }
    return validatedMesh(vertices, triangles);
}

function readPositions(
    source: Record<string, unknown>,
    views: readonly Record<string, unknown>[],
    binary: Buffer
): Vector3[] {
    if (source.componentType !== 5126 || source.type !== 'VEC3' || source.sparse !== undefined) {
        throw new TypeError('GLB positions must be non-sparse float VEC3 values');
    }
    const count = integer(source.count, 'GLB position count');
    const { offset, stride } = accessorRange(source, views, binary, 12);
    return Array.from({ length: count }, (_, index) => ({
        x: normalizeZero(finite(-binary.readFloatLE(offset + index * stride), 'GLB position X')),
        y: finite(binary.readFloatLE(offset + index * stride + 4), 'GLB position Y'),
        z: finite(binary.readFloatLE(offset + index * stride + 8), 'GLB position Z'),
    }));
}

function readIndices(
    source: Record<string, unknown>,
    views: readonly Record<string, unknown>[],
    binary: Buffer
): number[] {
    if (source.type !== 'SCALAR' || source.sparse !== undefined) {
        throw new TypeError('GLB indices must be non-sparse scalar values');
    }
    const componentType = integer(source.componentType, 'GLB index component type');
    const width = componentType === 5121 ? 1 : componentType === 5123 ? 2 : componentType === 5125 ? 4 : 0;
    if (width === 0) throw new TypeError('GLB indices must be unsigned integers');
    const count = integer(source.count, 'GLB index count');
    const { offset, stride } = accessorRange(source, views, binary, width);
    return Array.from({ length: count }, (_, index) => {
        const position = offset + index * stride;
        return width === 1
            ? binary.readUInt8(position)
            : width === 2
                ? binary.readUInt16LE(position)
                : binary.readUInt32LE(position);
    });
}

function accessorRange(
    source: Record<string, unknown>,
    views: readonly Record<string, unknown>[],
    binary: Buffer,
    elementSize: number
): { readonly offset: number; readonly stride: number } {
    const view = accessor(views, source.bufferView, 'GLB buffer view');
    if (view.buffer !== 0) throw new TypeError('GLB buffer view must reference the embedded buffer');
    const stride = view.byteStride === undefined ? elementSize : integer(view.byteStride, 'GLB byte stride');
    if (stride < elementSize) throw new RangeError('GLB byte stride is smaller than its element');
    const offset = optionalInteger(view.byteOffset, 'GLB buffer-view offset') +
        optionalInteger(source.byteOffset, 'GLB accessor offset');
    const count = integer(source.count, 'GLB accessor count');
    const end = count === 0 ? offset : offset + (count - 1) * stride + elementSize;
    const viewEnd = optionalInteger(view.byteOffset, 'GLB buffer-view offset') +
        integer(view.byteLength, 'GLB buffer-view length');
    if (offset < 0 || end > viewEnd || end > binary.length) {
        throw new RangeError('GLB accessor exceeds its buffer view');
    }
    return { offset, stride };
}

function validatedMesh(vertices: Vector3[], triangles: number[]): ParsedTriangleMesh {
    if (vertices.length === 0 || triangles.length === 0 || triangles.length % 3 !== 0) {
        throw new TypeError('Triangle mesh must contain vertices and complete triangles');
    }
    if (triangles.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= vertices.length)) {
        throw new RangeError('Triangle mesh contains an invalid vertex index');
    }
    const minimum = { ...vertices[0]! };
    const maximum = { ...vertices[0]! };
    for (const vertex of vertices) {
        for (const axis of ['x', 'y', 'z'] as const) {
            minimum[axis] = Math.min(minimum[axis], vertex[axis]);
            maximum[axis] = Math.max(maximum[axis], vertex[axis]);
        }
    }
    return {
        vertices,
        triangles,
        bounds: {
            center: midpoint(minimum, maximum),
            size: subtract(maximum, minimum),
        },
    };
}

function accessor(
    values: readonly Record<string, unknown>[],
    rawIndex: unknown,
    label: string
): Record<string, unknown> {
    const index = integer(rawIndex, `${label} index`);
    const value = values[index];
    if (value === undefined) throw new RangeError(`${label} index is out of range`);
    return value;
}

function records(value: unknown, label: string): Record<string, unknown>[] {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
    return value.map((entry, index) => asRecord(entry, `${label}[${index}]`));
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function integer(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new RangeError(`${label} must be a non-negative safe integer`);
    }
    return value as number;
}

function optionalInteger(value: unknown, label: string): number {
    return value === undefined ? 0 : integer(value, label);
}

function finite(value: number, label: string): number {
    if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
    return value;
}

function normalizeZero(value: number): number {
    return Object.is(value, -0) ? 0 : value;
}

function vector(values: readonly string[], label: string): Vector3 {
    const [x, y, z] = values.map(Number);
    if (![x, y, z].every(Number.isFinite)) throw new TypeError(`${label} must be finite`);
    return { x: x!, y: y!, z: z! };
}

function midpoint(minimum: Vector3, maximum: Vector3): Vector3 {
    return {
        x: (minimum.x + maximum.x) / 2,
        y: (minimum.y + maximum.y) / 2,
        z: (minimum.z + maximum.z) / 2,
    };
}

function subtract(left: Vector3, right: Vector3): Vector3 {
    return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}
