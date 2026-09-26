import { ORDERS, RULES } from "../content/catalog.js";
import { blockedEndpoints, capacities, unmetRestoration } from "./availability.js";
import { emit } from "./events.js";
import { SERVICES } from "./types.js";
const emptyVector = () => ({ grid: 0, transit: 0, comms: 0, emergency: 0 });
function applyDeltas(core, deltas, events, phase, cause) {
    for (const id of SERVICES) {
        const delta = deltas[id];
        if (delta === undefined || delta === 0)
            continue;
        const s = core.services[id], before = s.integrity;
        s.integrity = Math.max(RULES.constants.integrityMin, Math.min(RULES.constants.integrityMax, before + delta));
        emit(events, core.round, phase, "integrity", cause, { target: id, before, after: s.integrity, detail: "Requested delta " + delta });
    }
}
export function resolveRound(input, directiveIds) {
    if (input.phase !== "planning")
        throw new Error("Only a planning round can resolve.");
    const end = structuredClone(input), events = [], c = RULES.constants;
    const due = end.pending.filter(p => p.dueRound <= end.round);
    const dueDeltas = emptyVector();
    for (const p of due) {
        dueDeltas[p.target] += p.delta;
        emit(events, end.round, "due", "effect_applied", p.id, { target: p.target, detail: p.source + ": committed in round " + p.originatingRound + ", delta " + p.delta });
    }
    applyDeltas(end, dueDeltas, events, "due", "due-total");
    end.pending = end.pending.filter(p => p.dueRound > end.round);
    let directStrain = 0;
    for (const [index, id] of directiveIds.entries()) {
        const d = ORDERS[id], cause = "order-" + index + "-" + id;
        const blockers = blockedEndpoints(end, d.requiresAutonomous);
        if (blockers.length) {
            emit(events, end.round, "orders", "order_blocked", cause, { detail: blockers.map(s => s + ": " + (end.services[s].mode !== "autonomous" ? end.services[s].mode : "independent veto")).join(", ") });
            continue;
        }
        emit(events, end.round, "orders", "order_executed", cause, { detail: d.name });
        applyDeltas(end, d.integrityDelta, events, "orders", cause);
        const pointsBefore = end.points;
        end.points += d.efficiencyPoints;
        directStrain += d.strainDelta;
        emit(events, end.round, "orders", "optimisation_points", cause, { target: "city", before: pointsBefore, after: end.points });
        if (d.strainDelta)
            emit(events, end.round, "orders", "direct_strain", cause, { target: "city", before: directStrain - d.strainDelta, after: directStrain });
        for (const [delayIndex, delay] of d.delayed.entries()) {
            const p = { id: "r" + end.round + "-" + cause + "-delay-" + delayIndex, source: id,
                originatingRound: end.round, dueRound: end.round + delay.afterRounds, target: delay.target, delta: delay.integrityDelta };
            end.pending.push(p);
            emit(events, end.round, "orders", "effect_queued", p.id, { target: p.target, detail: "Due round " + p.dueRound + ": " + p.delta });
        }
    }
    const snapshot = capacities(end), damage = emptyVector();
    for (const [source, target] of RULES.dependencies) {
        if (snapshot[source] < c.cascadeThresholdExclusive) {
            damage[target] -= c.cascadeDamagePerEdge;
            emit(events, end.round, "cascade", "dependency_failure", source + "-to-" + target, { target, detail: source + " availability " + snapshot[source] + " below " + c.cascadeThresholdExclusive });
        }
    }
    applyDeltas(end, damage, events, "cascade", "dependency-total");
    const capacity = capacities(end);
    const deficit = SERVICES.reduce((n, id) => n + Math.max(0, c.stableAvailability - capacity[id]), 0);
    const recovery = deficit === 0 ? c.strainRecoveryOnZeroDeficit : 0;
    const strainBefore = end.strain;
    end.strain = Math.max(0, end.strain + directStrain + deficit - recovery);
    emit(events, end.round, "impact", "city_strain", "public-impact", { target: "city", before: strainBefore, after: end.strain,
        detail: "Direct " + directStrain + "; deficit " + deficit + "; recovery " + recovery });
    const outages = SERVICES.filter(id => capacity[id] === 0);
    const collapse = [];
    if (end.strain >= c.strainLossThreshold)
        collapse.push("City strain reached " + end.strain);
    if (outages.length >= c.simultaneousOutageLossCount)
        collapse.push("Simultaneous outages: " + outages.join(", "));
    if (collapse.length) {
        end.stableStreak = 0;
        end.ending = { outcome: "collapse", reasons: collapse };
    }
    else {
        const missing = unmetRestoration(end);
        end.stableStreak = missing.length === 0 ? end.stableStreak + 1 : 0;
        if (end.stableStreak >= c.stableRoundsToWin)
            end.ending = { outcome: "win", reasons: ["Human oversight and lasting capacity confirmed for two rounds."] };
        else if (end.round === c.maxRounds)
            end.ending = { outcome: "deadline",
                reasons: [...missing, ...(end.stableStreak < c.stableRoundsToWin ? ["Two stable rounds not yet completed"] : [])] };
    }
    emit(events, end.round, "ending", "stable_streak", "restoration-check", { target: "city", before: input.stableStreak, after: end.stableStreak });
    if (end.ending) {
        end.phase = "terminal";
        emit(events, end.round, "ending", end.ending.outcome, "ending", { detail: end.ending.reasons.join("; ") });
    }
    return { end, events };
}
