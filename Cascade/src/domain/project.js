import { ORDERS, RULES } from "../content/catalog.js";
import { allOperations, operationError } from "./actions.js";
import { blockedEndpoints, capacities, unmetRestoration } from "./availability.js";
import { currentOffer, forecastCommit } from "./engine.js";
// Do not hand the UI a Definition or GameState: both contain the hidden schedule.
export function projectForPlayer(state) {
    const core = structuredClone(state.core);
    return {
        crisis: { id: state.definition.scenario.id, name: state.definition.scenario.name, description: state.definition.scenario.description },
        revision: state.revision,
        core,
        availability: capacities(core),
        lastingAvailability: capacities(core, true),
        directives: core.phase === "terminal" ? [] : state.definition.scenario.rounds[core.round - 1].map(id => ({
            ...structuredClone(ORDERS[id]), blockedBy: blockedEndpoints(core, ORDERS[id].requiresAutonomous)
        })),
        draftOffer: currentOffer(state).map(id => structuredClone(RULES.roguelike.tools.find(t => t.id === id))),
        actions: allOperations(core).map(operation => ({ operation, error: operationError(core, operation) })),
        canUndo: core.phase === "planning" && state.openPlan.length > 0,
        canCommit: core.phase === "planning",
        restorationMissing: unmetRestoration(core),
        forecast: core.phase === "planning" ? forecastCommit(state) : null
    };
}
