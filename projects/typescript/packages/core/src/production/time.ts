export type GameTimeDisplay = 'game' | 'real';

export const REAL_SECONDS_PER_GAME_MINUTE = 1;

export function formatGameMinutes(
    gameMinutes: number,
    display: GameTimeDisplay = 'game'
): string {
    requireNonNegativeFinite(gameMinutes, 'gameMinutes');
    switch (display) {
        case 'game':
            return formatSeconds(gameMinutes * 60, 'm');
        case 'real':
            return formatSeconds(gameMinutes * REAL_SECONDS_PER_GAME_MINUTE, 's');
        default:
            throw new Error(`Unsupported game-time display ${JSON.stringify(display)}`);
    }
}

function formatSeconds(value: number, zeroUnit: 'm' | 's'): string {
    const totalSeconds = Math.round(value);
    if (totalSeconds === 0) return `0${zeroUnit}`;

    const hours = Math.floor(totalSeconds / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;
    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0) parts.push(`${seconds}s`);
    return parts.join(' ');
}

function requireNonNegativeFinite(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${label} must be a non-negative finite number`);
    }
}
