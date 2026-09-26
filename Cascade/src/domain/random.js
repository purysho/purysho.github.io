// Versioned Mulberry32 stream. Integer arithmetic only; never Math.random().
export function randomStream(seed) {
    let state = 2166136261;
    for (let i = 0; i < seed.length; i++)
        state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
    return {
        next() {
            state = (state + 0x6d2b79f5) | 0;
            let t = Math.imul(state ^ (state >>> 15), 1 | state);
            t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        },
        int(maxExclusive) {
            if (!Number.isInteger(maxExclusive) || maxExclusive < 1)
                throw new Error("Invalid random bound");
            return Math.floor(this.next() * maxExclusive);
        },
        shuffle(input) {
            const out = [...input];
            for (let i = out.length - 1; i > 0; i--) {
                const j = this.int(i + 1);
                [out[i], out[j]] = [out[j], out[i]];
            }
            return out;
        }
    };
}
export function normalizeSeed(value) {
    if (typeof value !== "string")
        throw new Error("Seed must be text.");
    const seed = value.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9 _-]{0,47}$/.test(seed))
        throw new Error("Use a seed of 1–48 letters, numbers, spaces, hyphens or underscores.");
    return seed;
}
