export function canonicalJson(value: unknown): string {
    return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortJson);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, child]) => [key, sortJson(child)])
        );
    }
    return value;
}
