import { describe, expect, it } from 'vitest';

import {
    parseGlbTriangleMesh,
    parseObjTriangleMesh,
} from '#data-compiler/acquisition/triangle-mesh';

describe('triangle mesh acquisition', () => {
    it('decodes indexed GLB triangles back into Unity local coordinates', () => {
        const result = parseGlbTriangleMesh(glbTriangle());

        expect(result.vertices).toEqual([
            { x: 1, y: 0, z: 0 },
            { x: -1, y: 0, z: 0 },
            { x: 0, y: 1, z: 0 },
        ]);
        expect(result.triangles).toEqual([0, 1, 2]);
        expect(result.bounds).toEqual({
            center: { x: 0, y: 0.5, z: 0 },
            size: { x: 2, y: 1, z: 0 },
        });
    });

    it('decodes exporter OBJ faces without changing Unity coordinates', () => {
        const result = parseObjTriangleMesh([
            'v -1 0 0',
            'v 1 0 0',
            'v 0 1 0',
            'f 1/1/1 2/2/2 3/3/3',
        ].join('\n'));

        expect(result.vertices[0]).toEqual({ x: -1, y: 0, z: 0 });
        expect(result.triangles).toEqual([0, 1, 2]);
    });
});

function glbTriangle(): Buffer {
    const binary = Buffer.alloc(44);
    const positions = [
        -1, 0, 0,
        1, 0, 0,
        0, 1, 0,
    ];
    positions.forEach((value, index) => binary.writeFloatLE(value, index * 4));
    [0, 1, 2].forEach((value, index) => binary.writeUInt16LE(value, 36 + index * 2));
    const document = {
        asset: { version: '2.0' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
        accessors: [
            { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
            { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
        ],
        bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: 36 },
            { buffer: 0, byteOffset: 36, byteLength: 6 },
        ],
        buffers: [{ byteLength: 42 }],
    };
    const rawJson = Buffer.from(JSON.stringify(document));
    const json = Buffer.concat([rawJson, Buffer.alloc((4 - rawJson.length % 4) % 4, 0x20)]);
    const result = Buffer.alloc(12 + 8 + json.length + 8 + binary.length);
    result.writeUInt32LE(0x46546c67, 0);
    result.writeUInt32LE(2, 4);
    result.writeUInt32LE(result.length, 8);
    result.writeUInt32LE(json.length, 12);
    result.writeUInt32LE(0x4e4f534a, 16);
    json.copy(result, 20);
    const binaryHeader = 20 + json.length;
    result.writeUInt32LE(binary.length, binaryHeader);
    result.writeUInt32LE(0x004e4942, binaryHeader + 4);
    binary.copy(result, binaryHeader + 8);
    return result;
}
