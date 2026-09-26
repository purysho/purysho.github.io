import { RULES } from "../content/catalog.js";
import { SERVICES } from "./types.js";
export function availability(service, unboosted = false) {
    if (service.integrity === 0)
        return 0;
    const c = RULES.constants;
    const base = service.mode === "isolated"
        ? Math.min(service.integrity, service.backup ? c.isolationCapWithBackup : c.isolationCapWithoutBackup)
        : service.integrity;
    return Math.min(c.integrityMax, base + (unboosted ? 0 : service.support));
}
export function capacities(core, unboosted = false) {
    return Object.fromEntries(SERVICES.map(id => [id, availability(core.services[id], unboosted)]));
}
export function unmetRestoration(core) {
    const reasons = [];
    for (const id of SERVICES) {
        if (core.services[id].mode !== "regulated")
            reasons.push(id + ": oversight missing");
        if (availability(core.services[id], true) < RULES.constants.stableAvailability)
            reasons.push(id + ": lasting capacity below 4");
    }
    if (core.pending.length)
        reasons.push("Committed damage remains");
    return reasons;
}
export function blockedEndpoints(core, required) {
    return required.filter(id => core.services[id].mode !== "autonomous" || core.services[id].authorityHeld);
}
