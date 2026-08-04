import { describe, expect, it } from 'vitest';

import { formatGameMinutes } from '@neonschedule1/core';

describe('production time display', () => {
    it('formats the same duration as in-game or real time', () => {
        expect(formatGameMinutes(2_160)).toBe('36h');
        expect(formatGameMinutes(2_160, 'real')).toBe('36m');
        expect(formatGameMinutes(360)).toBe('6h');
        expect(formatGameMinutes(360, 'real')).toBe('6m');
        expect(formatGameMinutes(6)).toBe('6m');
        expect(formatGameMinutes(6, 'real')).toBe('6s');
    });

    it('keeps useful precision for fractional game minutes', () => {
        expect(formatGameMinutes(90.5)).toBe('1h 30m 30s');
        expect(formatGameMinutes(90.5, 'real')).toBe('1m 31s');
    });

    it('rejects invalid durations', () => {
        expect(() => formatGameMinutes(-1)).toThrow('gameMinutes must be a non-negative finite number');
    });

    it('rejects an unsupported display from untyped callers', () => {
        expect(() => formatGameMinutes(1, 'clock' as never)).toThrow(
            'Unsupported game-time display "clock"'
        );
    });
});
