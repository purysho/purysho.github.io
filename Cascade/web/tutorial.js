import { createAuthoredRun, createRun, } from "../src/index.js";
const emptyRounds = () => Array.from({ length: 12 }, () => []);
export const TUTORIALS = [
    {
        id: "read_danger",
        title: "Read the danger",
        task: "Read the live AI order and exact forecast, then end the round without intervening. Watch a locally efficient choice transfer harm to emergency response.",
        focus: "grid",
        hints: [
            "The orange order card says EXECUTES. Compare Grid and Emergency in the forecast before committing.",
            "Spend no action points. End the round and watch Grid improve while Emergency loses integrity.",
        ],
        scenario: {
            id: "tutorial_read_danger",
            name: "Training — Read the danger",
            description: "A locally efficient grid order transfers harm to emergency response.",
            initial: { integrity: { grid: 4, transit: 4, comms: 4, emergency: 4 }, supplies: 10, strain: 0 },
            rounds: [["G1"], ...emptyRounds().slice(1)],
        },
    },
    {
        id: "break_cascade",
        title: "Break the cascade",
        task: "The grid is below the dependency threshold. Repair it before ending the round, then confirm the forecast no longer shows downstream cascade links.",
        focus: "grid",
        hints: [
            "Before acting, the exact forecast shows three dependency failures leaving Grid.",
            "Use Repair on Power Grid. Integrity rises by 2, which removes those dependency failures. Then end the round.",
        ],
        scenario: {
            id: "tutorial_break_cascade",
            name: "Training — Break the cascade",
            description: "A weak grid will propagate damage unless repaired before commitment.",
            initial: { integrity: { grid: 2, transit: 4, comms: 4, emergency: 4 }, supplies: 10, strain: 0 },
            rounds: emptyRounds(),
        },
    },
    {
        id: "contain_safely",
        title: "Contain safely",
        task: "Prepare a manual backup for Transit, then isolate it. End the round and watch the live AI order get blocked while Transit keeps reduced service.",
        focus: "transit",
        hints: [
            "Isolation blocks orders that require Transit to stay autonomous, but an unprepared isolated service would fall to capacity 1.",
            "Use Prepare backup on Transit first, then Isolate. With backup, isolated Transit keeps capacity 3. End the round to see the order blocked.",
        ],
        scenario: {
            id: "tutorial_contain_safely",
            name: "Training — Contain safely",
            description: "A transit optimisation threatens emergency response; manual fallback makes containment safer.",
            initial: { integrity: { grid: 4, transit: 4, comms: 4, emergency: 4 }, supplies: 10, strain: 0 },
            rounds: [["T1"], ...emptyRounds().slice(1)],
        },
    },
    {
        id: "restore_control",
        title: "Restore control",
        task: "Prepare a backup for Communications, then install permanent human oversight. Read the restoration checklist to see what the whole city still needs.",
        focus: "comms",
        hints: [
            "Permanent oversight requires a manual backup and at least 3 integrity.",
            "Use Prepare backup on Communications, then Enforce oversight. Together they consume all 3 action points.",
        ],
        scenario: {
            id: "tutorial_restore_control",
            name: "Training — Restore control",
            description: "Build the fallback prerequisite and replace autonomous control with permanent human oversight.",
            initial: { integrity: { grid: 4, transit: 4, comms: 4, emergency: 4 }, supplies: 10, strain: 0 },
            rounds: emptyRounds(),
        },
    },
];
export function createTutorialState(id) {
    const spec = TUTORIALS.find(item => item.id === id);
    if (!spec)
        throw new Error("Unknown tutorial: " + id);
    // Reuse the installed Stage 2 rules/content identity. Tutorial states are
    // session-only and never exported as campaign replays.
    const baseline = createAuthoredRun("overdrive");
    return createRun({
        ...baseline.definition,
        descriptor: { kind: "authored", id: "overdrive" },
        scenario: structuredClone(spec.scenario),
        offers: [],
    });
}
