import witnessesData from "../../design/engine-witnesses-v0.2.json" with { type: "json" };
import originalTraces from "../../design/worked-traces-v0.1.json" with { type: "json" };
import { CONTENT_VERSION, RULES, SCENARIOS } from "../content/catalog.js";
import { applyCommand, createRun } from "./engine.js";
import { normalizeSeed, randomStream } from "./random.js";
import { deepFreeze, validOperation, validateScenario } from "./validate.js";
import { DIRECTIVES, SERVICES, TOOLS } from "./types.js";
export const GENERATOR_VERSION = "seeded-crisis-1";
export const MAX_GENERATION_ATTEMPTS = 24;
export const WITNESSES = [
    ...witnessesData.witnesses.map(w => ({ id: w.id, plans: w.plans })),
    { id: "overdrive-original", plans: originalTraces.cases[0].plans.map(plan => plan.map(op => ({ type: "act", ...op }))) }
];
for (const witness of WITNESSES) {
    if (witness.plans.length > 12 || witness.plans.some(plan => plan.length > 3 || !plan.every(validOperation)))
        throw new Error("Invalid recovery certificate template.");
}
deepFreeze(WITNESSES);
export function checkWitness(definition, plans) {
    let state = createRun(definition);
    for (const plan of plans) {
        if (state.core.phase === "terminal")
            return state.core.ending?.outcome === "win" ? state : null;
        if (state.core.phase === "draft") {
            const result = applyCommand(state, { type: "choose_tool", tool: null, expectedRevision: state.revision });
            if (!result.ok)
                return null;
            state = result.state;
        }
        for (const op of plan) {
            const result = applyCommand(state, { ...op, expectedRevision: state.revision });
            if (!result.ok)
                return null;
            state = result.state;
        }
        const result = applyCommand(state, { type: "commit_round", expectedRevision: state.revision });
        if (!result.ok)
            return null;
        state = result.state;
    }
    return state.core.ending?.outcome === "win" ? state : null;
}
export function generateRun(inputSeed) {
    const seed = normalizeSeed(inputSeed);
    const rng = randomStream(GENERATOR_VERSION + ":crisis:" + seed);
    const draftRng = randomStream(GENERATOR_VERSION + ":draft:" + seed);
    const offers = RULES.roguelike.draftRounds.map(() => draftRng.shuffle(TOOLS).slice(0, 3));
    const base = SCENARIOS[rng.int(SCENARIOS.length)];
    const definitionFor = (scenario) => ({
        schemaVersion: 1, rulesVersion: RULES.rulesVersion, contentVersion: CONTENT_VERSION,
        generatorVersion: GENERATOR_VERSION, descriptor: { kind: "seeded", seed }, scenario, offers
    });
    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
        const scenario = structuredClone(base);
        scenario.id = "seeded";
        scenario.name = "Crisis " + seed;
        scenario.description = base.description;
        for (const id of SERVICES)
            scenario.initial.integrity[id] = Math.max(2, Math.min(6, base.initial.integrity[id] + rng.int(3) - 1));
        scenario.initial.supplies = base.initial.supplies + rng.int(3);
        scenario.initial.strain = rng.int(3);
        scenario.rounds = [
            ...rng.shuffle(base.rounds.slice(0, 4)).map(round => [...round]),
            ...Array.from({ length: 8 }, () => rng.shuffle(DIRECTIVES).slice(0, 2))
        ];
        validateScenario(scenario);
        const definition = definitionFor(scenario);
        for (const witness of WITNESSES) {
            const solved = checkWitness(definition, witness.plans);
            if (solved)
                return {
                    state: createRun(definition),
                    certificate: { template: witness.id, plans: structuredClone(witness.plans.slice(0, solved.core.round)), winRound: solved.core.round },
                    diagnostics: { attempts: attempt, fallback: false, baseScenario: base.id }
                };
        }
    }
    // Bounded fallback: reuse an authored, engine-verified crisis. Never silently
    // present an unchecked candidate, and never loop indefinitely on an unlucky seed.
    const scenario = structuredClone(base);
    scenario.id = "seeded";
    scenario.name = "Crisis " + seed;
    const witness = WITNESSES.find(w => w.id === base.id);
    // Later threats can differ without invalidating this already demonstrated route.
    for (let round = witness.plans.length; round < 12; round++)
        scenario.rounds[round] = rng.shuffle(DIRECTIVES).slice(0, 2);
    const definition = definitionFor(scenario), solved = checkWitness(definition, witness.plans);
    if (!solved)
        throw new Error("Internal error: fallback recovery certificate failed.");
    return { state: createRun(definition), certificate: { template: witness.id, plans: structuredClone(witness.plans), winRound: solved.core.round },
        diagnostics: { attempts: MAX_GENERATION_ATTEMPTS, fallback: true, baseScenario: base.id } };
}
export function createSeededRun(seed) { return generateRun(seed).state; }
