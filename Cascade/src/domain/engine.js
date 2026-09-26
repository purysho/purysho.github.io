import { CONTENT_VERSION, RULES, SCENARIOS } from "../content/catalog.js";
import { coreChanges, executeOperation, operationError } from "./actions.js";
import { emit } from "./events.js";
import { resolveRound } from "./resolve.js";
import { deepFreeze, member, validCommand, validateScenario } from "./validate.js";
import { SERVICES, TOOLS } from "./types.js";
export function createRun(definition) {
    validateScenario(definition.scenario);
    if (definition.schemaVersion !== 1 || definition.rulesVersion !== RULES.rulesVersion || definition.contentVersion !== CONTENT_VERSION)
        throw new Error("Incompatible run definition.");
    if (definition.offers.length !== 0 && definition.offers.length !== RULES.roguelike.draftRounds.length)
        throw new Error("Three draft offers required.");
    for (const offer of definition.offers) {
        if (offer.length !== 3 || new Set(offer).size !== 3 || !offer.every(id => member(TOOLS, id)))
            throw new Error("Invalid draft offer.");
    }
    const core = {
        round: 1, phase: definition.offers.length ? "draft" : "planning",
        services: Object.fromEntries(SERVICES.map(id => [id, { integrity: definition.scenario.initial.integrity[id],
                mode: "autonomous", backup: false, support: 0, authorityHeld: false }])),
        supplies: definition.scenario.initial.supplies, strain: definition.scenario.initial.strain,
        points: 0, ap: RULES.constants.actionsPerRound, resupplyUsed: false, toolUsed: false,
        pending: [], stableStreak: 0, inventory: [], ending: null
    };
    return { definition: deepFreeze(structuredClone(definition)), revision: 0, core, roundStart: structuredClone(core),
        history: [], openPlan: [], choices: [] };
}
export function createAuthoredRun(id) {
    const scenario = SCENARIOS.find(s => s.id === id);
    if (!scenario)
        throw new Error("Unknown authored crisis: " + id);
    return createRun({ schemaVersion: 1, rulesVersion: RULES.rulesVersion, contentVersion: CONTENT_VERSION,
        generatorVersion: null, descriptor: { kind: "authored", id }, scenario, offers: [] });
}
export function currentOffer(state) {
    if (state.core.phase !== "draft")
        return [];
    const index = RULES.roguelike.draftRounds.indexOf(state.core.round);
    return [...(state.definition.offers[index] ?? [])];
}
export function forecastCommit(state) {
    return resolveRound(state.core, state.definition.scenario.rounds[state.core.round - 1]);
}
export function applyCommand(state, input) {
    const fail = (code, message) => ({ ok: false, state, error: { code, message } });
    if (!validCommand(input))
        return fail("invalid_command", "Malformed or unknown command.");
    if (input.expectedRevision !== state.revision)
        return fail("stale_revision", "This command belongs to an older state.");
    if (state.core.phase === "terminal")
        return fail("terminal_state", "This crisis has ended.");
    if (state.revision >= 1_000_000)
        return fail("revision_limit", "Start a new crisis after one million planning changes.");
    const events = [], cause = "revision-" + (state.revision + 1);
    if (input.type === "choose_tool") {
        if (state.core.phase !== "draft")
            return fail("wrong_phase", "No tool draft is active.");
        if (input.tool !== null && !currentOffer(state).includes(input.tool))
            return fail("tool_not_offered", "Choose one of the offered tools.");
        const core = structuredClone(state.core);
        if (input.tool !== null)
            core.inventory.push(input.tool);
        core.phase = "planning";
        emit(events, core.round, "plan", "tool_drafted", cause, { detail: input.tool ?? "declined" });
        return { ok: true, state: { ...state, revision: state.revision + 1, core, roundStart: structuredClone(core),
                choices: [...state.choices, { round: core.round, tool: input.tool }] }, events };
    }
    if (state.core.phase !== "planning")
        return fail("wrong_phase", "Finish the emergency-tool draft first.");
    if (input.type === "undo") {
        if (state.openPlan.length === 0)
            return fail("nothing_to_undo", "No uncommitted action to undo.");
        const openPlan = state.openPlan.slice(0, -1), core = structuredClone(state.roundStart);
        for (const op of openPlan)
            executeOperation(core, op, [], "rebuild");
        emit(events, core.round, "plan", "undo", cause);
        coreChanges(state.core, core, events, cause);
        if (state.core.inventory.length !== core.inventory.length)
            emit(events, core.round, "plan", "inventory_restored", cause, { target: "city", before: state.core.inventory.length, after: core.inventory.length });
        return { ok: true, state: { ...state, revision: state.revision + 1, core, openPlan }, events };
    }
    if (input.type === "commit_round") {
        const resolution = forecastCommit(state), core = structuredClone(resolution.end);
        const history = [...state.history, { round: state.core.round, operations: structuredClone(state.openPlan) }];
        if (core.phase !== "terminal") {
            core.round++;
            core.ap = RULES.constants.actionsPerRound;
            core.resupplyUsed = false;
            core.toolUsed = false;
            for (const id of SERVICES) {
                core.services[id].support = 0;
                core.services[id].authorityHeld = false;
            }
            core.phase = state.definition.offers.length && RULES.roguelike.draftRounds.includes(core.round) ? "draft" : "planning";
        }
        return { ok: true, state: { ...state, revision: state.revision + 1, core, history, openPlan: [], roundStart: structuredClone(core) },
            events: resolution.events, resolution };
    }
    const { expectedRevision: _, ...op } = input;
    const problem = operationError(state.core, op);
    if (problem)
        return { ok: false, state, error: problem };
    const core = structuredClone(state.core);
    executeOperation(core, op, events, cause);
    return { ok: true, state: { ...state, revision: state.revision + 1, core, openPlan: [...state.openPlan, structuredClone(op)] }, events };
}
export function perform(state, operation) {
    const result = applyCommand(state, { ...operation, expectedRevision: state.revision });
    if (!result.ok)
        throw new Error(result.error.code + ": " + result.error.message);
    return result.state;
}
