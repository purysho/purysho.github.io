import { CONTENT_HASH } from "../content/catalog.js";
import { applyCommand, createAuthoredRun } from "./engine.js";
import { createSeededRun } from "./generate.js";
import { normalizeSeed } from "./random.js";
import { canonical, fingerprint, integer, keys, member, record, validOperation } from "./validate.js";
import { TOOLS } from "./types.js";
export const MAX_REPLAY_BYTES = 256 * 1024;
export function exportReplay(state) {
    return JSON.stringify({ schemaVersion: 1, contentHash: CONTENT_HASH, definitionHash: fingerprint(state.definition),
        definition: state.definition, history: state.history, openPlan: state.openPlan, choices: state.choices, revision: state.revision }, null, 2);
}
function valid(condition, message) {
    if (!condition)
        throw new Error("Invalid replay: " + message);
}
function boundedParse(text) {
    valid(typeof text === "string", "expected JSON text");
    valid(text.length <= MAX_REPLAY_BYTES && new TextEncoder().encode(text).length <= MAX_REPLAY_BYTES, "file exceeds 256 KiB");
    let depth = 0, quoted = false, escaped = false;
    for (const ch of text) {
        if (quoted) {
            if (escaped)
                escaped = false;
            else if (ch === "\\")
                escaped = true;
            else if (ch === '"')
                quoted = false;
        }
        else if (ch === '"')
            quoted = true;
        else if (ch === "{" || ch === "[") {
            depth++;
            valid(depth <= 24, "nesting too deep");
        }
        else if (ch === "}" || ch === "]")
            depth--;
    }
    return JSON.parse(text);
}
export function importReplay(text) {
    try {
        const data = boundedParse(text);
        valid(record(data) && keys(data, ["schemaVersion", "contentHash", "definitionHash", "definition", "history", "openPlan", "choices", "revision"]), "record shape");
        valid(data.schemaVersion === 1 && data.contentHash === CONTENT_HASH, "incompatible content version");
        valid(record(data.definition) && record(data.definition.descriptor), "missing run descriptor");
        const descriptor = data.definition.descriptor;
        let state;
        if (descriptor.kind === "authored") {
            valid(keys(descriptor, ["kind", "id"]) && typeof descriptor.id === "string", "authored descriptor");
            state = createAuthoredRun(descriptor.id);
        }
        else {
            valid(descriptor.kind === "seeded" && keys(descriptor, ["kind", "seed"]) && typeof descriptor.seed === "string", "seed descriptor");
            valid(normalizeSeed(descriptor.seed) === descriptor.seed, "seed must use its canonical form");
            state = createSeededRun(descriptor.seed);
        }
        // A supplied hash alone never authorises a custom scenario or edited resources.
        valid(canonical(data.definition) === canonical(state.definition) && data.definitionHash === fingerprint(state.definition), "run snapshot does not match installed content");
        valid(Array.isArray(data.history) && data.history.length <= 12, "round history limit");
        valid(Array.isArray(data.openPlan) && data.openPlan.length <= 4 && data.openPlan.every(validOperation), "open plan");
        valid(Array.isArray(data.choices) && data.choices.length <= 3, "draft choices");
        valid(integer(data.revision, 0, 1_000_000), "revision");
        const history = [];
        for (const [index, entry] of data.history.entries()) {
            valid(record(entry) && keys(entry, ["round", "operations"]) && entry.round === index + 1
                && Array.isArray(entry.operations) && entry.operations.length <= 4 && entry.operations.every(validOperation), "round record");
            history.push({ round: entry.round, operations: entry.operations });
        }
        const choices = [];
        for (const choice of data.choices) {
            valid(record(choice) && keys(choice, ["round", "tool"]) && integer(choice.round, 1, 9)
                && (choice.tool === null || member(TOOLS, choice.tool)), "draft choice");
            choices.push({ round: choice.round, tool: choice.tool });
        }
        let choiceIndex = 0;
        const apply = (command) => {
            const result = applyCommand(state, { ...command, expectedRevision: state.revision });
            valid(result.ok, result.ok ? "" : result.error.message);
            state = result.state;
        };
        const draftIfRecorded = () => {
            const choice = choices[choiceIndex];
            if (state.core.phase === "draft" && choice?.round === state.core.round) {
                apply({ type: "choose_tool", tool: choice.tool });
                choiceIndex++;
            }
        };
        for (const round of history) {
            valid(state.core.round === round.round, "round sequence");
            draftIfRecorded();
            for (const op of round.operations)
                apply(op);
            apply({ type: "commit_round" });
        }
        draftIfRecorded();
        for (const op of data.openPlan)
            apply(op);
        valid(choiceIndex === choices.length, "extra or out-of-order draft choice");
        valid(data.revision >= state.revision, "revision predates accepted history");
        // Undo increments revisions but disappears from the canonical open plan.
        state.revision = data.revision;
        return { ok: true, state };
    }
    catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Invalid replay." };
    }
}
