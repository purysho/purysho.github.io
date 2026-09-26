import { RULES } from "../content/catalog.js";
import { availability } from "./availability.js";
import { emit } from "./events.js";
import { ACTIONS, SERVICES } from "./types.js";
const error = (code, message) => ({ code, message });
export function operationError(core, op) {
    if (core.phase !== "planning")
        return error("wrong_phase", "Actions require an active planning round.");
    const c = RULES.constants;
    if (op.type === "use_tool") {
        if (core.toolUsed)
            return error("tool_used", "Use at most one emergency tool per round.");
        if (!core.inventory.includes(op.tool))
            return error("tool_missing", "This tool is not in your inventory.");
        if (op.tool === "supply_drop")
            return core.supplies === c.supplyCap ? error("stock_full", "Supplies are already full.") : null;
        if (op.tool === "civic_relief")
            return core.strain === 0 ? error("no_strain", "City strain is already zero.") : null;
        // Remaining tools require a service target.
        if (!("target" in op))
            return error("invalid_command", "A service target is required.");
        const s = core.services[op.target];
        switch (op.tool) {
            case "field_patch": return s.integrity === c.integrityMax ? error("full_integrity", "This service is already fully repaired.") : null;
            case "mobile_backup": return s.backup ? error("backup_exists", "This service already has a manual backup.") : null;
            case "surge_support": return supportError(s.integrity, availability(s), s.support);
            case "authority_lock": return s.mode !== "autonomous" || s.authorityHeld ? error("invalid_mode", "Only an autonomous service without a veto can be held.") : null;
        }
    }
    if (op.type !== "act")
        return error("invalid_command", "Unknown action.");
    const cost = RULES.actions[op.action];
    if (core.ap < cost.ap)
        return error("insufficient_ap", "Not enough action points.");
    if (core.supplies < cost.supplies)
        return error("insufficient_supplies", "Not enough supplies.");
    if (op.action === "resupply") {
        if (core.resupplyUsed)
            return error("resupply_used", "Resupply is available once per round.");
        if (core.supplies === c.supplyCap)
            return error("stock_full", "Supplies are already full.");
        return null;
    }
    const s = core.services[op.target];
    switch (op.action) {
        case "repair": return s.integrity === c.integrityMax ? error("full_integrity", "This service is already fully repaired.") : null;
        case "prepare_backup": return s.backup ? error("backup_exists", "This service already has a manual backup.") : null;
        case "isolate": return s.mode !== "autonomous" ? error("invalid_mode", "Only autonomous services can be isolated.") : null;
        case "restore_automation": return s.mode !== "isolated" ? error("invalid_mode", "Only isolated services can resume automation.") : null;
        case "enforce_oversight":
            if (s.mode === "regulated")
                return error("invalid_mode", "Oversight is already enforced.");
            if (!s.backup)
                return error("backup_required", "Prepare a manual backup first.");
            return s.integrity < c.regulationIntegrityMinimum ? error("integrity_low", "Oversight requires at least 3 integrity.") : null;
        case "emergency_support": return supportError(s.integrity, availability(s), s.support);
    }
}
function supportError(integrity, capacity, support) {
    if (integrity === 0)
        return error("integrity_zero", "Support cannot revive a service with zero integrity.");
    if (support > 0)
        return error("support_used", "Support is already assigned this round.");
    return capacity >= RULES.constants.integrityMax ? error("full_capacity", "This service is already at full capacity.") : null;
}
// Caller must validate first. Mutates only a newly cloned core.
export function executeOperation(core, op, events, cause) {
    const before = structuredClone(core);
    const c = RULES.constants;
    if (op.type === "act") {
        const cost = RULES.actions[op.action];
        core.ap -= cost.ap;
        core.supplies -= cost.supplies;
        if (op.action === "resupply") {
            const normal = availability(core.services.transit) >= c.resupplyTransitMinimum && availability(core.services.comms) >= c.resupplyCommsMinimum;
            core.supplies = Math.min(c.supplyCap, core.supplies + (normal ? c.resupplyNormal : c.resupplyDisrupted));
            core.resupplyUsed = true;
        }
        else {
            const s = core.services[op.target];
            switch (op.action) {
                case "repair":
                    s.integrity = Math.min(c.integrityMax, s.integrity + c.repairGain);
                    break;
                case "prepare_backup":
                    s.backup = true;
                    break;
                case "isolate":
                    s.mode = "isolated";
                    break;
                case "restore_automation":
                    s.mode = "autonomous";
                    break;
                case "enforce_oversight":
                    s.mode = "regulated";
                    break;
                case "emergency_support":
                    s.support = c.supportGain;
                    break;
            }
        }
    }
    else {
        core.inventory.splice(core.inventory.indexOf(op.tool), 1);
        core.toolUsed = true;
        if (op.tool === "supply_drop")
            core.supplies = Math.min(c.supplyCap, core.supplies + RULES.roguelike.supplyDropGain);
        else if (op.tool === "civic_relief")
            core.strain = Math.max(0, core.strain - RULES.roguelike.civicReliefGain);
        else if ("target" in op) {
            const s = core.services[op.target];
            switch (op.tool) {
                case "field_patch":
                    s.integrity = Math.min(c.integrityMax, s.integrity + RULES.roguelike.fieldPatchGain);
                    break;
                case "mobile_backup":
                    s.backup = true;
                    break;
                case "surge_support":
                    s.support = RULES.roguelike.surgeSupportGain;
                    break;
                case "authority_lock":
                    s.authorityHeld = true;
                    break;
            }
        }
        emit(events, core.round, "plan", "tool_consumed", cause, { target: op.tool, before: before.inventory.length, after: core.inventory.length });
    }
    emit(events, core.round, "plan", "action_accepted", cause, { detail: JSON.stringify(op) });
    coreChanges(before, core, events, cause);
}
export function coreChanges(before, after, events, cause) {
    for (const field of ["ap", "supplies", "strain", "toolUsed", "resupplyUsed"]) {
        if (before[field] !== after[field])
            emit(events, after.round, "plan", field, cause, { target: "city", before: before[field], after: after[field] });
    }
    for (const id of SERVICES) {
        for (const field of ["integrity", "mode", "backup", "support", "authorityHeld"]) {
            const a = before.services[id][field], b = after.services[id][field];
            if (a !== b)
                emit(events, after.round, "plan", field, cause, { target: id, before: a, after: b });
        }
    }
}
export function allOperations(core) {
    const ops = [];
    for (const action of ACTIONS) {
        if (action === "resupply")
            ops.push({ type: "act", action });
        else
            for (const target of SERVICES)
                ops.push({ type: "act", action, target });
    }
    for (const tool of new Set(core.inventory)) {
        if (tool === "supply_drop" || tool === "civic_relief")
            ops.push({ type: "use_tool", tool });
        else
            for (const target of SERVICES)
                ops.push({ type: "use_tool", tool, target });
    }
    return ops;
}
export function legalOperations(core) {
    return allOperations(core).filter(op => operationError(core, op) === null);
}
