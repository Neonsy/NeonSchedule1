export function temperatureProcessMultiplier(
    temperature: number,
    minimumTemperature: number,
    maximumTemperature: number,
    maximumMultiplier: number,
    label: string
): number {
    requireFinite(temperature, `${label} temperature`);
    requireFinite(minimumTemperature, `${label} minimum temperature`);
    requireFinite(maximumTemperature, `${label} maximum temperature`);
    requireFinite(maximumMultiplier, `${label} maximum multiplier`);
    if (minimumTemperature >= maximumTemperature) {
        throw new RangeError(`${label} minimum temperature must be below its maximum`);
    }
    if (maximumMultiplier < 1) {
        throw new RangeError(`${label} maximum multiplier must be at least one`);
    }
    if (temperature <= minimumTemperature) return 1;
    const progress = Math.min(
        1,
        Math.max(
            0,
            (temperature - minimumTemperature) /
                (maximumTemperature - minimumTemperature)
        )
    );
    return 1 + progress * (maximumMultiplier - 1);
}

function requireFinite(value: number, label: string): void {
    if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
}
