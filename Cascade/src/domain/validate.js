import { ACTIONS, DIRECTIVES, SERVICES, TOOLS } from "./types.js";
export function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function integer(value, min, max) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
export function member(list, value) {
    return typeof value === "string" && list.includes(value);
}
export function keys(value, expected) {
    return Object.keys(value).length === expected.length && expected.every(k => Object.hasOwn(value, k));
}
function requireValid(condition, message) {
    if (!condition)
        throw new Error("Invalid content: " + message);
}
export function validateScenario(value) {
    requireValid(record(value) && keys(value, ["id", "name", "description", "initial", "rounds"]), "scenario shape");
    requireValid(typeof value.id === "string" && /^[a-z0-9_-]{1,80}$/.test(value.id), "scenario ID");
    requireValid(typeof value.name === "string" && value.name.length > 0 && value.name.length <= 100, "scenario name");
    requireValid(typeof value.description === "string" && value.description.length <= 500, "scenario description");
    requireValid(record(value.initial) && keys(value.initial, ["integrity", "supplies", "strain"]), "initial state");
    const initial = value.initial;
    requireValid(record(initial.integrity) && keys(initial.integrity, [...SERVICES]), "integrity vector");
    for (const id of SERVICES)
        requireValid(integer(initial.integrity[id], 0, 6), "integrity " + id);
    requireValid(integer(initial.supplies, 0, 20) && integer(initial.strain, 0, 15), "resources");
    requireValid(Array.isArray(value.rounds) && value.rounds.length === 12, "twelve rounds required");
    for (const round of value.rounds) {
        requireValid(Array.isArray(round) && round.length <= 2, "round order budget");
        requireValid(round.every(id => member(DIRECTIVES, id)) && new Set(round).size === round.length, "directive IDs");
    }
}
export function validateRules(value) {
    requireValid(record(value) && value.schemaVersion === 1 && value.rulesVersion === "0.2.0", "rules version");
    const constantKeys = ["maxRounds", "actionsPerRound", "integrityMin", "integrityMax", "stableAvailability",
        "cascadeThresholdExclusive", "cascadeDamagePerEdge", "isolationCapWithoutBackup", "isolationCapWithBackup",
        "strainLossThreshold", "simultaneousOutageLossCount", "stableRoundsToWin", "strainRecoveryOnZeroDeficit",
        "supplyCap", "repairGain", "supportGain", "resupplyNormal", "resupplyDisrupted",
        "resupplyTransitMinimum", "resupplyCommsMinimum", "regulationIntegrityMinimum"];
    requireValid(record(value.constants) && keys(value.constants, constantKeys), "constants");
    for (const n of Object.values(value.constants))
        requireValid(integer(n, 0, 20), "bounded integer constants");
    requireValid(value.constants.maxRounds === 12 && value.constants.actionsPerRound === 3
        && value.constants.integrityMin === 0 && value.constants.integrityMax === 6 && value.constants.supplyCap === 20
        && value.constants.strainLossThreshold === 16, "engine bounds");
    requireValid(JSON.stringify(value.modes) === '["autonomous","isolated","regulated"]', "control modes");
    requireValid(Array.isArray(value.serviceOrder) && JSON.stringify(value.serviceOrder) === JSON.stringify(SERVICES), "service order");
    requireValid(Array.isArray(value.dependencies) && value.dependencies.length === 6, "dependency count");
    const edges = new Set();
    for (const edge of value.dependencies) {
        requireValid(Array.isArray(edge) && edge.length === 2 && edge.every(id => member(SERVICES, id)) && edge[0] !== edge[1], "dependency edge");
        edges.add(JSON.stringify(edge));
    }
    requireValid(edges.size === 6, "duplicate dependency edge");
    requireValid(record(value.actions) && keys(value.actions, [...ACTIONS]), "action IDs");
    for (const a of Object.values(value.actions)) {
        requireValid(record(a) && integer(a.ap, 1, 3) && integer(a.supplies, 0, 20) && typeof a.target === "string", "action costs");
    }
    requireValid(Array.isArray(value.directives) && value.directives.length === DIRECTIVES.length, "directive count");
    const ids = new Set();
    for (const d of value.directives) {
        requireValid(record(d) && member(DIRECTIVES, d.id) && !ids.has(d.id), "duplicate/unknown directive");
        ids.add(d.id);
        requireValid(typeof d.name === "string" && member(SERVICES, d.origin), "directive label/origin");
        requireValid(Array.isArray(d.requiresAutonomous) && d.requiresAutonomous.length > 0
            && d.requiresAutonomous.length <= 4 && d.requiresAutonomous.every(id => member(SERVICES, id))
            && new Set(d.requiresAutonomous).size === d.requiresAutonomous.length, "permissions");
        requireValid(record(d.integrityDelta), "deltas");
        for (const [id, n] of Object.entries(d.integrityDelta))
            requireValid(member(SERVICES, id) && integer(n, -6, 6), "delta");
        requireValid(integer(d.strainDelta, 0, 6) && integer(d.efficiencyPoints, 0, 10), "directive counters");
        requireValid(Array.isArray(d.delayed) && d.delayed.length <= 1, "delayed budget");
        for (const delay of d.delayed)
            requireValid(record(delay) && delay.afterRounds === 1
                && member(SERVICES, delay.target) && integer(delay.integrityDelta, -6, 0), "delay");
    }
    requireValid(record(value.roguelike) && JSON.stringify(value.roguelike.draftRounds) === "[1,5,9]"
        && value.roguelike.offerSize === 3 && value.roguelike.toolsPerRound === 1, "draft bounds");
    const roguelike = value.roguelike;
    for (const k of ["fieldPatchGain", "supplyDropGain", "civicReliefGain", "surgeSupportGain"])
        requireValid(integer(roguelike[k], 1, 6), "tool magnitude");
    requireValid(Array.isArray(roguelike.tools) && roguelike.tools.length === TOOLS.length, "tool count");
    const tools = new Set();
    for (const t of roguelike.tools) {
        requireValid(record(t) && member(TOOLS, t.id) && !tools.has(t.id)
            && typeof t.name === "string" && typeof t.description === "string", "tool definition");
        tools.add(t.id);
    }
}
export function validOperation(value) {
    if (!record(value))
        return false;
    if (value.type === "act" && member(ACTIONS, value.action)) {
        return value.action === "resupply" ? keys(value, ["type", "action"])
            : keys(value, ["type", "action", "target"]) && member(SERVICES, value.target);
    }
    if (value.type === "use_tool" && member(TOOLS, value.tool)) {
        return value.tool === "supply_drop" || value.tool === "civic_relief"
            ? keys(value, ["type", "tool"])
            : keys(value, ["type", "tool", "target"]) && member(SERVICES, value.target);
    }
    return false;
}
export function validCommand(value) {
    if (!record(value) || !integer(value.expectedRevision, 0, 1_000_000))
        return false;
    const { expectedRevision: _, ...command } = value;
    if (command.type === "undo" || command.type === "commit_round")
        return keys(command, ["type"]);
    if (command.type === "choose_tool")
        return keys(command, ["type", "tool"]) && (command.tool === null || member(TOOLS, command.tool));
    return validOperation(command);
}
export function canonical(value) {
    if (Array.isArray(value))
        return "[" + value.map(canonical).join(",") + "]";
    if (record(value))
        return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
    return JSON.stringify(value) ?? "null";
}
// A compatibility fingerprint, not an authentication or cryptographic check.
// Imports are separately reconstructed from installed content and legal commands.
export function fingerprint(value) {
    const input = canonical(value);
    let h = 0xcbf29ce484222325n;
    for (const byte of new TextEncoder().encode(input))
        h = BigInt.asUintN(64, (h ^ BigInt(byte)) * 0x100000001b3n);
    return h.toString(16).padStart(16, "0");
}
export function deepFreeze(value) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const nested of Object.values(value))
            deepFreeze(nested);
    }
    return value;
}
