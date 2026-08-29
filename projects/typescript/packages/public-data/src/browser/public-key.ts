import { createHash } from 'node:crypto';

export function createPublicKeyResolver(
    namespace: string,
    sourceKeys: readonly string[]
): (sourceKey: string) => string {
    requireUnique(sourceKeys, `${namespace} source keys`);
    const publicKeys = new Map(sourceKeys.map((sourceKey) => [
        sourceKey,
        `${namespace}-${createHash('sha256')
            .update(`${namespace}\0${sourceKey}`, 'utf8')
            .digest('hex')
            .slice(0, 20)}`,
    ]));
    requireUnique([...publicKeys.values()], `${namespace} public keys`);
    return (sourceKey) => {
        const publicKey = publicKeys.get(sourceKey);
        if (publicKey === undefined) {
            throw new Error(`Unknown ${namespace} source key: ${sourceKey}`);
        }
        return publicKey;
    };
}

export function requireUnique(values: readonly string[], label: string): void {
    if (new Set(values).size !== values.length) {
        throw new Error(`${label} must be unique`);
    }
}
