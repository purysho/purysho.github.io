import { RULES, SCENARIOS, SERVICES, applyCommand, createAuthoredRun, createSeededRun, exportReplay, importReplay, projectForPlayer, } from "../src/index.js";
import { TUTORIALS, createTutorialState } from "./tutorial.js";
import { createAudioController } from "./audio.js";
const SERVICE_META = {
    grid: { name: "Power Grid", short: "GRID", icon: "⚡", description: "Electricity and generation" },
    transit: { name: "Transit", short: "MOVE", icon: "◆", description: "Routes, fleet and logistics" },
    comms: { name: "Communications", short: "COMMS", icon: "⌁", description: "Networks, alerts and routing" },
    emergency: { name: "Emergency", short: "RESP", icon: "+", description: "Dispatch and response capacity" },
};
const ACTION_LABELS = {
    repair: { title: "Repair", hint: "Restore integrity" },
    prepare_backup: { title: "Prepare backup", hint: "Unlock safer isolation and oversight" },
    isolate: { title: "Isolate", hint: "Block AI orders; capacity falls" },
    restore_automation: { title: "Reconnect", hint: "Return an isolated service to automation" },
    enforce_oversight: { title: "Enforce oversight", hint: "Permanent human control" },
    emergency_support: { title: "Surge support", hint: "Temporary capacity this round" },
    resupply: { title: "Resupply", hint: "Restock through transit and comms" },
};
const SAVE_KEY = "cascade.save.v1";
const SAVE_META_KEY = "cascade.save.meta.v1";
const SETTINGS_KEY = "cascade.settings.v1";
const CHATGPT_ICON_URL = "https://images.ctfassets.net/j22is2dtoxu1/intercom-img-d177d076c9a5453052925143/49d5d812b0a6fcc20a14faa8c629d9fb/icon-ios-1024_401x.png?fm=webp&q=80&w=1024";
const TAB_ID = (() => {
    const values = new Uint32Array(2);
    crypto.getRandomValues(values);
    return `${values[0].toString(36)}-${values[1].toString(36)}`;
})();
const reducedBySystem = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let motionEnabled = !reducedBySystem;
let soundEnabled = true;
const audio = createAudioController(soundEnabled);
let state = null;
let view = null;
let selected = "grid";
let lastEvents = [];
let buildings = [];
let vehicles = [];
let toastTimer = 0;
let saveWarningShown = false;
let pendingResume = null;
let observedSaveToken = null;
let saveConflictShown = false;
let tutorialIndex = null;
let tutorialHintLevel = 0;
let feedbackPulses = [];
let feedbackTimer = 0;
let helpReturnFocus = null;
function must(selector) {
    const element = document.querySelector(selector);
    if (!element)
        throw new Error(`Missing required element: ${selector}`);
    return element;
}
const canvas = must("#city");
const context = canvas.getContext("2d", { alpha: false });
if (!context)
    throw new Error("Canvas 2D is required.");
const ctx = context;
const startScreen = must("#start-screen");
const draftModal = must("#draft-modal");
const helpModal = must("#help-modal");
const resultModal = must("#result-modal");
const serviceRail = must("#service-rail");
const actionList = must("#action-list");
const toolList = must("#tool-list");
const orderList = must("#order-list");
const eventLog = must("#event-log");
const forecastBody = must("#forecast-body");
const forecastPanel = must("#forecast-panel");
const coach = must("#coach");
const tutorialPanel = must("#tutorial-panel");
function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
function prettyMode(mode) {
    if (mode === "regulated")
        return "HUMAN OVERSIGHT";
    if (mode === "isolated")
        return "ISOLATED";
    return "AI AUTONOMY";
}
function seededRandom(seedText) {
    let h = 2166136261;
    for (let i = 0; i < seedText.length; i++) {
        h ^= seedText.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return () => {
        h += 0x6d2b79f5;
        let t = h;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function rebuildCity(seedText) {
    const random = seededRandom(seedText);
    buildings = Array.from({ length: 92 }, (_, index) => {
        const district = index % 4;
        const quadrants = [
            [0.08, 0.08, 0.36, 0.36],
            [0.56, 0.08, 0.36, 0.36],
            [0.08, 0.56, 0.36, 0.36],
            [0.56, 0.56, 0.36, 0.36],
        ];
        const q = quadrants[district];
        return {
            x: q[0] + random() * q[2],
            y: q[1] + random() * q[3],
            w: 0.012 + random() * 0.024,
            h: 0.018 + random() * 0.055,
            district,
            phase: random() * Math.PI * 2,
        };
    });
    vehicles = Array.from({ length: 28 }, (_, index) => ({ route: index % 4, phase: random(), lane: index % 2 }));
}
function makeSeed() {
    const values = new Uint32Array(2);
    crypto.getRandomValues(values);
    return `CITY-${values[0].toString(36)}-${values[1].toString(36)}`.toUpperCase();
}
function activeTutorial() {
    return tutorialIndex === null ? null : TUTORIALS[tutorialIndex] ?? null;
}
function descriptorLabel(game) {
    const tutorial = activeTutorial();
    if (tutorial)
        return `TRAINING-${tutorial.id.toUpperCase()}`;
    return game.definition.descriptor.kind === "seeded"
        ? game.definition.descriptor.seed
        : `PRACTICE-${game.definition.descriptor.id.toUpperCase()}`;
}
function startSeeded(seedText) {
    tutorialIndex = null;
    tutorialHintLevel = 0;
    const chosen = seedText?.trim() || makeSeed();
    begin(createSeededRun(chosen));
}
function startAuthored(id) {
    tutorialIndex = null;
    tutorialHintLevel = 0;
    begin(createAuthoredRun(id));
}
function startTutorial(index = 0) {
    const tutorial = TUTORIALS[index];
    if (!tutorial)
        return;
    tutorialIndex = index;
    tutorialHintLevel = 0;
    begin(createTutorialState(tutorial.id));
}
function begin(game) {
    state = game;
    selected = activeTutorial()?.focus ?? "grid";
    lastEvents = [];
    clearResolutionFeedback();
    rebuildCity(descriptorLabel(game));
    startScreen.classList.add("hidden");
    resultModal.close();
    refresh();
    saveGame();
}
function resume(game) {
    tutorialIndex = null;
    tutorialHintLevel = 0;
    state = game;
    selected = "grid";
    lastEvents = [];
    clearResolutionFeedback();
    rebuildCity(descriptorLabel(game));
    startScreen.classList.add("hidden");
    refresh();
}
function restartSame() {
    if (!state)
        return;
    if (tutorialIndex !== null) {
        startTutorial(tutorialIndex);
        return;
    }
    const descriptor = state.definition.descriptor;
    if (descriptor.kind === "seeded")
        startSeeded(descriptor.seed);
    else
        startAuthored(descriptor.id);
}
function dispatch(command) {
    if (!state)
        return;
    const result = applyCommand(state, { ...command, expectedRevision: state.revision });
    if (!result.ok) {
        showToast(result.error.message, "danger");
        return;
    }
    state = result.state;
    lastEvents = result.events;
    if (command.type === "act" || command.type === "use_tool")
        audio.playUi("action");
    else if (command.type === "undo")
        audio.playUi("undo");
    else if (command.type === "choose_tool")
        audio.playUi("draft");
    refresh();
    saveGame();
    if (result.resolution)
        announceResolution(result.resolution.events);
    if (state.core.phase === "terminal")
        openResults();
}
function refresh() {
    if (!state)
        return;
    view = projectForPlayer(state);
    renderHud();
    renderServices();
    renderSelectedService();
    renderOrders();
    renderForecast();
    renderEvents();
    renderCoach();
    renderTutorial();
    renderDraft();
    must("#undo").disabled = !view.canUndo;
    must("#commit").disabled = !view.canCommit;
    must("#run-code").textContent = descriptorLabel(state);
}
function renderHud() {
    if (!view)
        return;
    const core = view.core;
    must("#round-value").textContent = `${core.round}/${RULES.constants.maxRounds}`;
    must("#ap-value").textContent = `${core.ap}/${RULES.constants.actionsPerRound}`;
    must("#supply-value").textContent = String(core.supplies);
    must("#strain-value").textContent = `${core.strain}/${RULES.constants.strainLossThreshold}`;
    must("#ai-value").textContent = String(core.points);
    must("#streak-value").textContent = `${core.stableStreak}/${RULES.constants.stableRoundsToWin}`;
    const objective = must("#objective-status");
    if (view.restorationMissing.length === 0) {
        objective.innerHTML = `<strong>Control restored.</strong> Hold the city stable for ${Math.max(0, RULES.constants.stableRoundsToWin - core.stableStreak)} more round${core.stableStreak === 1 ? "" : "s"}.`;
        objective.className = "objective-status ready";
    }
    else {
        const controls = SERVICES.filter(id => core.services[id].mode === "regulated").length;
        objective.innerHTML = `<strong>${controls}/4 services regulated.</strong> ${view.restorationMissing.length} restoration condition${view.restorationMissing.length === 1 ? "" : "s"} remain.`;
        objective.className = "objective-status";
    }
}
function renderServices() {
    if (!view)
        return;
    serviceRail.innerHTML = SERVICES.map(id => {
        const service = view.core.services[id];
        const capacity = view.availability[id];
        const lasting = view.lastingAvailability[id];
        const activeOrders = view.directives.filter(d => d.requiresAutonomous.includes(id) && d.blockedBy.length === 0).length;
        const selectedClass = id === selected ? " selected" : "";
        const dangerClass = capacity < 3 ? " danger" : capacity < 4 ? " warning" : "";
        return `<button class="service-card${selectedClass}${dangerClass}" data-service="${id}" aria-pressed="${id === selected}">
      <span class="service-icon">${SERVICE_META[id].icon}</span>
      <span class="service-card-copy"><strong>${SERVICE_META[id].name}</strong><small>${prettyMode(service.mode)}</small></span>
      <span class="service-capacity"><b>${capacity}</b><small>/6</small></span>
      <span class="mini-meter"><i style="width:${Math.round(capacity / 6 * 100)}%"></i></span>
      <span class="service-flags">${service.backup ? "BACKUP " : ""}${service.authorityHeld ? "VETO " : ""}${service.support ? `+${service.support} SURGE ` : ""}${lasting !== capacity ? `TEMP ${capacity - lasting > 0 ? "+" : ""}${capacity - lasting}` : ""}${activeOrders ? `${activeOrders} AI ORDER${activeOrders > 1 ? "S" : ""}` : ""}</span>
    </button>`;
    }).join("");
    serviceRail.querySelectorAll("[data-service]").forEach(button => {
        button.addEventListener("click", () => {
            selected = button.dataset.service;
            renderServices();
            renderSelectedService();
        });
    });
}
function operationForSelected(entry) {
    const op = entry.operation;
    if (op.type === "act" && op.action === "resupply")
        return true;
    if (op.type === "use_tool" && (op.tool === "supply_drop" || op.tool === "civic_relief"))
        return true;
    return "target" in op && op.target === selected;
}
function renderSelectedService() {
    if (!view)
        return;
    const service = view.core.services[selected];
    const capacity = view.availability[selected];
    const lasting = view.lastingAvailability[selected];
    must("#service-title").textContent = SERVICE_META[selected].name;
    must("#service-subtitle").textContent = SERVICE_META[selected].description;
    must("#integrity-value").textContent = `${service.integrity}/6`;
    must("#capacity-value").textContent = `${capacity}/6`;
    must("#lasting-value").textContent = `${lasting}/6`;
    must("#mode-value").textContent = prettyMode(service.mode);
    const actions = view.actions.filter(entry => entry.operation.type === "act" && operationForSelected(entry));
    actionList.innerHTML = actions.map((entry, index) => {
        const op = entry.operation;
        if (op.type !== "act")
            return "";
        const meta = ACTION_LABELS[op.action] ?? { title: op.action, hint: "" };
        const cost = RULES.actions[op.action];
        const disabled = entry.error ? " disabled" : "";
        const reason = entry.error ? `<small class="disabled-reason">${escapeHtml(entry.error.message)}</small>` : `<small>${escapeHtml(meta.hint)}</small>`;
        return `<button class="action-button${disabled}" data-action-index="${index}" data-action="${escapeHtml(op.action)}" data-target="${escapeHtml("target" in op ? op.target : "city")}" ${entry.error ? "disabled" : ""}>
      <span><strong>${escapeHtml(meta.title)}</strong>${reason}</span>
      <span class="cost"><b>${cost.ap} AP</b>${cost.supplies ? `<em>${cost.supplies} SUP</em>` : ""}</span>
    </button>`;
    }).join("");
    actionList.querySelectorAll("[data-action-index]").forEach(button => {
        button.addEventListener("click", () => {
            const entry = actions[Number(button.dataset.actionIndex)];
            if (entry && !entry.error)
                dispatch(entry.operation);
        });
    });
    const tools = view.actions.filter(entry => entry.operation.type === "use_tool" && operationForSelected(entry));
    if (view.core.inventory.length === 0) {
        toolList.innerHTML = `<p class="empty-state">No emergency tools held. New drafts arrive on rounds 5 and 9.</p>`;
    }
    else {
        toolList.innerHTML = tools.map((entry, index) => {
            const op = entry.operation;
            if (op.type !== "use_tool")
                return "";
            const tool = RULES.roguelike.tools.find(item => item.id === op.tool);
            const disabled = entry.error ? " disabled" : "";
            return `<button class="tool-button${disabled}" data-tool-index="${index}" ${entry.error ? "disabled" : ""}>
        <span><strong>${escapeHtml(tool?.name ?? op.tool)}</strong><small>${escapeHtml(entry.error?.message ?? tool?.description ?? "One-use emergency asset")}</small></span>
        <span class="one-shot">ONE-SHOT</span>
      </button>`;
        }).join("");
        toolList.querySelectorAll("[data-tool-index]").forEach(button => {
            button.addEventListener("click", () => {
                const entry = tools[Number(button.dataset.toolIndex)];
                if (entry && !entry.error)
                    dispatch(entry.operation);
            });
        });
    }
}
function renderOrders() {
    if (!view)
        return;
    if (view.directives.length === 0) {
        orderList.innerHTML = `<p class="empty-state">No active directives.</p>`;
        return;
    }
    orderList.innerHTML = view.directives.map(directive => {
        const blocked = directive.blockedBy.length > 0;
        const impacts = SERVICES
            .filter(id => directive.integrityDelta[id] !== undefined && directive.integrityDelta[id] !== 0)
            .map(id => `${SERVICE_META[id].short} ${directive.integrityDelta[id] > 0 ? "+" : ""}${directive.integrityDelta[id]}`)
            .join(" · ");
        return `<article class="order-card ${blocked ? "blocked" : "live"}">
      <header><span class="order-origin">${SERVICE_META[directive.origin].short}</span><strong>${escapeHtml(directive.name)}</strong><b>${blocked ? "BLOCKED" : "EXECUTES"}</b></header>
      <p>${impacts || "No immediate integrity change"}${directive.strainDelta ? ` · STRAIN +${directive.strainDelta}` : ""}${directive.delayed.length ? ` · ${directive.delayed.length} delayed effect${directive.delayed.length > 1 ? "s" : ""}` : ""}</p>
      <small>${blocked ? `Stopped by ${directive.blockedBy.map(id => SERVICE_META[id].name).join(", ")}` : `AI efficiency +${directive.efficiencyPoints}`}</small>
    </article>`;
    }).join("");
}
function renderForecast() {
    if (!view || !view.forecast) {
        forecastBody.innerHTML = `<p class="empty-state">Finish the current draft to forecast this round.</p>`;
        return;
    }
    const forecast = view.forecast;
    const integrityRows = SERVICES.map(id => {
        const before = view.core.services[id].integrity;
        const after = forecast.end.services[id].integrity;
        const delta = after - before;
        if (delta === 0)
            return "";
        return `<li><span>${SERVICE_META[id].name}</span><b class="${delta < 0 ? "negative" : "positive"}">${delta > 0 ? "+" : ""}${delta}</b></li>`;
    }).join("");
    const failures = forecast.events.filter(event => event.kind === "dependency_failure");
    const executed = forecast.events.filter(event => event.kind === "order_executed").length;
    const blocked = forecast.events.filter(event => event.kind === "order_blocked").length;
    const queued = forecast.events.filter(event => event.kind === "effect_queued").length;
    forecastBody.innerHTML = `<div class="forecast-summary">
      <div><small>ROUND END STRAIN</small><strong>${forecast.end.strain}</strong><span>${forecast.end.strain - view.core.strain >= 0 ? "+" : ""}${forecast.end.strain - view.core.strain}</span></div>
      <div><small>AI ORDERS</small><strong>${executed}</strong><span>${blocked} blocked</span></div>
      <div><small>CASCADE LINKS</small><strong>${failures.length}</strong><span>${queued} delayed</span></div>
    </div>
    ${integrityRows ? `<ul class="forecast-deltas">${integrityRows}</ul>` : `<p class="forecast-safe">No service loses integrity if you end the round now.</p>`}
    ${forecast.end.ending ? `<p class="forecast-ending">This commitment reaches: <strong>${escapeHtml(forecast.end.ending.outcome.toUpperCase())}</strong></p>` : ""}`;
}
function renderEvents() {
    if (!view)
        return;
    const source = lastEvents.length ? lastEvents : view.forecast?.events.filter(event => event.phase === "due") ?? [];
    const entries = source.slice(-7).reverse();
    if (entries.length === 0) {
        eventLog.innerHTML = `<p class="empty-state">Commit a round to see the city consequence trace.</p>`;
        return;
    }
    eventLog.innerHTML = entries.map(event => `<li class="event ${event.phase}">
    <span>${escapeHtml(event.phase.toUpperCase())}</span>
    <p><strong>${escapeHtml(eventTitle(event))}</strong><small>${escapeHtml(event.detail ?? eventDelta(event))}</small></p>
  </li>`).join("");
}
function eventTitle(event) {
    if (event.kind === "order_executed")
        return `AI order executed`;
    if (event.kind === "order_blocked")
        return `AI order blocked`;
    if (event.kind === "dependency_failure")
        return `Failure propagated to ${serviceName(event.target)}`;
    if (event.kind === "effect_queued")
        return `Damage committed to ${serviceName(event.target)}`;
    if (event.kind === "effect_applied")
        return `Delayed damage arrived at ${serviceName(event.target)}`;
    if (event.kind === "integrity")
        return `${serviceName(event.target)} integrity changed`;
    if (event.kind === "city_strain")
        return `Public strain updated`;
    if (event.kind === "win")
        return `Human control restored`;
    if (event.kind === "collapse")
        return `City overwhelmed`;
    if (event.kind === "deadline")
        return `Crisis unresolved`;
    return event.kind.replaceAll("_", " ");
}
function eventDelta(event) {
    if (event.before !== undefined && event.after !== undefined)
        return `${String(event.before)} → ${String(event.after)}`;
    return event.cause;
}
function serviceName(target) {
    if (target && SERVICES.includes(target))
        return SERVICE_META[target].name;
    return target ?? "city";
}
function renderCoach() {
    if (!view)
        return;
    const core = view.core;
    const threatened = view.directives.filter(d => d.blockedBy.length === 0);
    let message = activeTutorial()
        ? "Training uses the same engine and costs as a real crisis. Complete the live checklist in the operations console."
        : "Select a district, inspect the round forecast, then spend up to three action points.";
    if (core.phase === "draft")
        message = "Choose one emergency tool. It is consumable, and you can use at most one tool this round.";
    else if (threatened.length > 0 && core.round === 1)
        message = "Unchecked AI orders resolve when you end the round. Isolation or a veto can stop an order, but durable oversight is the long-term objective.";
    else if (view.restorationMissing.length === 0)
        message = `The city meets every lasting condition. Hold stability for ${Math.max(0, 2 - core.stableStreak)} more round${core.stableStreak === 1 ? "" : "s"}.`;
    else if (core.ap === 0)
        message = "No action points remain. Review the forecast, undo if needed, or end the round.";
    else if (core.strain >= 10)
        message = "Public strain is high. Protect service availability now; collapse occurs at strain 16 or two simultaneous outages.";
    coach.textContent = message;
}
function tutorialStatus() {
    if (!state || !view)
        return null;
    const tutorial = activeTutorial();
    if (!tutorial)
        return null;
    const roundOne = state.history.find(record => record.round === 1);
    if (tutorial.id === "read_danger") {
        const liveOrder = state.history.length > 0 || view.directives.some(directive => directive.id === "G1" && directive.blockedBy.length === 0);
        const forecastShowsTransfer = state.history.length > 0 || Boolean(view.forecast
            && view.forecast.end.services.grid.integrity > view.core.services.grid.integrity
            && view.forecast.end.services.emergency.integrity < view.core.services.emergency.integrity);
        const observed = Boolean(roundOne)
            && state.core.services.grid.integrity === 5
            && state.core.services.emergency.integrity === 2
            && lastEvents.some(event => event.kind === "order_executed");
        return {
            complete: observed,
            checks: [
                { done: liveOrder, label: "Find the live grid order marked EXECUTES" },
                { done: forecastShowsTransfer, label: "Compare Grid gain with Emergency harm in the exact forecast" },
                { done: observed, label: "End the round without intervening and observe the transfer" },
            ],
        };
    }
    if (tutorial.id === "break_cascade") {
        const repairPlanned = state.openPlan.some(op => op.type === "act" && op.action === "repair" && op.target === "grid")
            || Boolean(roundOne?.operations.some(op => op.type === "act" && op.action === "repair" && op.target === "grid"));
        const safeForecast = Boolean(roundOne) || (repairPlanned
            && (view.forecast?.events.filter(event => event.kind === "dependency_failure").length ?? 0) === 0);
        const committedSafe = Boolean(roundOne)
            && repairPlanned
            && !lastEvents.some(event => event.kind === "dependency_failure");
        return {
            complete: committedSafe,
            checks: [
                { done: repairPlanned, label: "Repair the Power Grid before commitment" },
                { done: safeForecast, label: "Confirm the exact forecast has no dependency-failure links" },
                { done: committedSafe, label: "End the round without a downstream cascade" },
            ],
        };
    }
    if (tutorial.id === "contain_safely") {
        const plannedBackup = state.core.services.transit.backup
            || Boolean(roundOne?.operations.some(op => op.type === "act" && op.action === "prepare_backup" && op.target === "transit"));
        const plannedIsolation = state.core.services.transit.mode === "isolated"
            || Boolean(roundOne?.operations.some(op => op.type === "act" && op.action === "isolate" && op.target === "transit"));
        const blockedNow = Boolean(roundOne) || (plannedIsolation
            && view.availability.transit === 3
            && view.directives.some(directive => directive.id === "T1" && directive.blockedBy.includes("transit")));
        const observedBlock = Boolean(roundOne) && lastEvents.some(event => event.kind === "order_blocked");
        return {
            complete: observedBlock,
            checks: [
                { done: plannedBackup, label: "Prepare a manual backup for Transit" },
                { done: plannedIsolation && blockedNow, label: "Isolate Transit and see capacity 3/6 with the order blocked" },
                { done: observedBlock, label: "End the round and observe the blocked AI order" },
            ],
        };
    }
    const backup = state.core.services.comms.backup;
    const regulated = state.core.services.comms.mode === "regulated";
    return {
        complete: backup && regulated,
        checks: [
            { done: backup, label: "Prepare a manual backup for Communications" },
            { done: regulated, label: "Use the remaining 2 AP to enforce permanent oversight" },
            { done: regulated && view.restorationMissing.length > 0, label: "Read what the whole-city restoration checklist still requires" },
        ],
    };
}
function renderTutorial() {
    const tutorial = activeTutorial();
    if (!tutorial) {
        tutorialPanel.classList.add("hidden");
        return;
    }
    const status = tutorialStatus();
    if (!status)
        return;
    tutorialPanel.classList.remove("hidden");
    tutorialPanel.classList.toggle("complete", status.complete);
    must("#tutorial-step").textContent = `TRAINING ${(tutorialIndex ?? 0) + 1} / ${TUTORIALS.length}`;
    must("#tutorial-title").textContent = tutorial.title;
    must("#tutorial-task").textContent = tutorial.task;
    must("#tutorial-checks").innerHTML = status.checks.map(check => `<li class="${check.done ? "done" : ""}"><span>${check.done ? "✓" : "○"}</span>${escapeHtml(check.label)}</li>`).join("");
    const hint = must("#tutorial-hint");
    if (tutorialHintLevel > 0) {
        hint.classList.remove("hidden");
        hint.textContent = tutorial.hints[Math.min(tutorialHintLevel - 1, tutorial.hints.length - 1)] ?? "";
    }
    else {
        hint.classList.add("hidden");
        hint.textContent = "";
    }
    const next = must("#tutorial-next");
    next.disabled = !status.complete;
    next.textContent = tutorialIndex === TUTORIALS.length - 1 ? "START GENERATED CRISIS →" : "NEXT EXERCISE →";
    must("#tutorial-help").textContent = tutorialHintLevel >= tutorial.hints.length ? "Hint shown" : "Hint";
    const objective = must("#objective-status");
    objective.className = status.complete ? "objective-status ready" : "objective-status";
    objective.innerHTML = status.complete
        ? `<strong>Exercise complete.</strong> Continue when ready.`
        : `<strong>Training objective:</strong> ${escapeHtml(tutorial.title)}.`;
}
function leaveTutorial() {
    tutorialIndex = null;
    tutorialHintLevel = 0;
    state = null;
    view = null;
    lastEvents = [];
    clearResolutionFeedback();
    tutorialPanel.classList.add("hidden");
    if (draftModal.open)
        draftModal.close();
    if (resultModal.open)
        resultModal.close();
    startScreen.classList.remove("hidden");
}
function renderDraft() {
    if (!view)
        return;
    if (view.core.phase !== "draft") {
        if (draftModal.open)
            draftModal.close();
        return;
    }
    const cards = must("#draft-cards");
    cards.innerHTML = view.draftOffer.map(tool => `<button class="draft-card" data-tool="${tool.id}">
    <span class="draft-kicker">EMERGENCY ASSET</span><strong>${escapeHtml(tool.name)}</strong><p>${escapeHtml(tool.description)}</p><span class="draft-choose">ADD TO INVENTORY →</span>
  </button>`).join("");
    cards.querySelectorAll("[data-tool]").forEach(button => {
        button.addEventListener("click", () => dispatch({ type: "choose_tool", tool: button.dataset.tool }));
    });
    if (!draftModal.open)
        draftModal.showModal();
}
function announceResolution(events) {
    const executed = events.filter(event => event.kind === "order_executed").length;
    const cascades = events.filter(event => event.kind === "dependency_failure").length;
    const blocked = events.filter(event => event.kind === "order_blocked").length;
    audio.playResolution(events);
    showResolutionFeedback(events);
    if (cascades > 0)
        showToast(`${cascades} infrastructure link${cascades > 1 ? "s" : ""} failed. Watch the city map.`, "danger");
    else if (executed > 0)
        showToast(`${executed} AI order${executed > 1 ? "s" : ""} executed; ${blocked} blocked.`, "warning");
    else if (blocked > 0)
        showToast(`All ${blocked} AI order${blocked > 1 ? "s" : ""} blocked this round.`, "success");
}
function showResolutionFeedback(events) {
    const kinds = new Set(events.map(event => event.kind));
    const cascades = events.filter(event => event.kind === "dependency_failure").length;
    const executed = events.filter(event => event.kind === "order_executed").length;
    const blocked = events.filter(event => event.kind === "order_blocked").length;
    const delayed = events.filter(event => event.kind === "effect_applied").length;
    let tone = "neutral";
    let kicker = "ROUND RESOLVED";
    let title = "City state updated";
    let detail = "No major disruption registered.";
    if (kinds.has("win")) {
        tone = "success";
        kicker = "CONTROL RECOVERED";
        title = "Human oversight holds";
        detail = "All durable restoration conditions survived resolution.";
    }
    else if (kinds.has("collapse")) {
        tone = "danger";
        kicker = "CASCADE CRITICAL";
        title = "City systems overwhelmed";
        detail = "The incident crossed a terminal failure threshold.";
    }
    else if (kinds.has("deadline")) {
        tone = "warning";
        kicker = "DEADLINE REACHED";
        title = "Crisis remains unresolved";
        detail = "The recovery window closed before durable control was restored.";
    }
    else if (cascades > 0 || delayed > 0) {
        tone = "danger";
        kicker = "CASCADE PROPAGATED";
        title = cascades > 0 ? `${cascades} infrastructure link${cascades === 1 ? "" : "s"} failed` : "Committed damage arrived";
        detail = delayed > 0 ? `${delayed} delayed impact${delayed === 1 ? "" : "s"} landed this round.` : "A weak supplier damaged dependent services.";
    }
    else if (executed > 0) {
        tone = "warning";
        kicker = "AI ORDER EXECUTED";
        title = `${executed} unchecked order${executed === 1 ? "" : "s"} resolved`;
        detail = blocked > 0 ? `${blocked} additional order${blocked === 1 ? "" : "s"} were blocked.` : "The optimisation system changed the city before human control was restored.";
    }
    else if (blocked > 0) {
        tone = "success";
        kicker = "CONTAINMENT HELD";
        title = `${blocked} AI order${blocked === 1 ? "" : "s"} blocked`;
        detail = "Current safeguards prevented the unsafe optimisation from executing.";
    }
    else if (events.some(event => event.kind === "city_strain")) {
        tone = "neutral";
        title = "Public strain recalculated";
        detail = "The city absorbed this round without a new AI order or cascade.";
    }
    const panel = must("#resolution-feedback");
    must("#resolution-feedback-kicker").textContent = kicker;
    must("#resolution-feedback-title").textContent = title;
    must("#resolution-feedback-detail").textContent = detail;
    panel.className = `resolution-feedback show ${tone}`;
    const now = performance.now();
    feedbackPulses = events
        .filter(event => ["order_executed", "order_blocked", "dependency_failure", "effect_applied", "win", "collapse", "deadline"].includes(event.kind))
        .slice(-8)
        .map(event => ({
        target: event.target && SERVICES.includes(event.target) ? event.target : null,
        tone: event.kind === "order_blocked" || event.kind === "win" ? "success"
            : event.kind === "order_executed" || event.kind === "deadline" ? "warning"
                : "danger",
        startedAt: now,
        duration: event.kind === "win" || event.kind === "collapse" ? 1500 : 1050,
    }));
    window.clearTimeout(feedbackTimer);
    feedbackTimer = window.setTimeout(() => panel.classList.remove("show"), 1800);
}
function clearResolutionFeedback() {
    feedbackPulses = [];
    window.clearTimeout(feedbackTimer);
    const panel = document.querySelector("#resolution-feedback");
    if (panel)
        panel.className = "resolution-feedback";
}
function openResults() {
    if (!state || !view || !state.core.ending)
        return;
    const ending = state.core.ending;
    const title = ending.outcome === "win" ? "CONTROL RESTORED" : ending.outcome === "collapse" ? "CITY OVERWHELMED" : "CRISIS UNRESOLVED";
    const resultTitle = must("#result-title");
    resultTitle.textContent = title;
    resultTitle.className = ending.outcome;
    must("#result-copy").textContent = ending.reasons.join(" · ");
    must("#result-stats").innerHTML = `
    <div><small>ROUND</small><strong>${state.core.round}</strong></div>
    <div><small>STRAIN</small><strong>${state.core.strain}</strong></div>
    <div><small>AI SCORE</small><strong>${state.core.points}</strong></div>
    <div><small>OVERSIGHT</small><strong>${SERVICES.filter(id => state.core.services[id].mode === "regulated").length}/4</strong></div>`;
    const decisive = lastEvents.filter(event => ["order_executed", "order_blocked", "dependency_failure", "effect_applied", "win", "collapse", "deadline"].includes(event.kind)).slice(-6);
    must("#result-events").innerHTML = decisive.map(event => `<li><b>${escapeHtml(eventTitle(event))}</b><span>${escapeHtml(event.detail ?? eventDelta(event))}</span></li>`).join("") || `<li><b>Final state recorded.</b><span>Replay the same crisis to test a different recovery plan.</span></li>`;
    if (!resultModal.open)
        resultModal.showModal();
}
function parseSaveMeta(raw) {
    if (!raw)
        return null;
    try {
        const value = JSON.parse(raw);
        if (typeof value.token !== "string" || typeof value.tabId !== "string"
            || typeof value.revision !== "number" || !Number.isInteger(value.revision)
            || typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt))
            return null;
        return { token: value.token, tabId: value.tabId, revision: value.revision, savedAt: value.savedAt };
    }
    catch {
        return null;
    }
}
function saveGame() {
    if (!state || tutorialIndex !== null)
        return;
    try {
        const currentMeta = parseSaveMeta(localStorage.getItem(SAVE_META_KEY));
        if (currentMeta && currentMeta.tabId !== TAB_ID && currentMeta.token !== observedSaveToken) {
            if (!saveConflictShown) {
                saveConflictShown = true;
                showToast("A newer browser tab changed this save. Autosave is paused here; reload to resume the newer copy.", "warning");
            }
            return;
        }
        const replay = exportReplay(state);
        const savedAt = Date.now();
        const token = `${savedAt.toString(36)}-${TAB_ID}-${state.revision}`;
        const meta = { token, tabId: TAB_ID, revision: state.revision, savedAt };
        localStorage.setItem(SAVE_KEY, replay);
        localStorage.setItem(SAVE_META_KEY, JSON.stringify(meta));
        observedSaveToken = token;
        saveConflictShown = false;
    }
    catch {
        if (!saveWarningShown) {
            saveWarningShown = true;
            showToast("Browser storage is unavailable. This run will continue in memory only.", "warning");
        }
    }
}
function loadResume() {
    try {
        observedSaveToken = parseSaveMeta(localStorage.getItem(SAVE_META_KEY))?.token ?? null;
        const text = localStorage.getItem(SAVE_KEY);
        if (!text)
            return;
        const imported = importReplay(text);
        if (!imported.ok || imported.state.core.phase === "terminal")
            return;
        pendingResume = imported.state;
        const button = must("#resume-game");
        button.hidden = false;
        button.querySelector("small").textContent = `${imported.state.definition.scenario.name} · Round ${imported.state.core.round}`;
    }
    catch {
        pendingResume = null;
    }
}
function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw)
            return;
        const parsed = JSON.parse(raw);
        if (typeof parsed.motion === "boolean")
            motionEnabled = parsed.motion && !reducedBySystem;
        if (typeof parsed.sound === "boolean")
            soundEnabled = parsed.sound;
    }
    catch {
        // Ignore malformed optional settings.
    }
    audio.setEnabled(soundEnabled);
    updateMotionButton();
    updateSoundButton();
}
function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ motion: motionEnabled, sound: soundEnabled }));
    }
    catch {
        // Optional presentation settings do not affect the run.
    }
}
function updateMotionButton() {
    const button = must("#motion-toggle");
    button.textContent = `Motion: ${motionEnabled ? "On" : "Reduced"}`;
    button.setAttribute("aria-pressed", String(motionEnabled));
}
function updateSoundButton() {
    const label = `Sound: ${soundEnabled ? "On" : "Muted"}`;
    for (const selector of ["#sound-toggle", "#start-sound-toggle"]) {
        const button = must(selector);
        button.textContent = label;
        button.setAttribute("aria-pressed", String(soundEnabled));
    }
}
function toggleSound() {
    soundEnabled = !soundEnabled;
    audio.setEnabled(soundEnabled);
    saveSettings();
    updateSoundButton();
    if (soundEnabled)
        audio.playUi("confirm");
}
function showToast(message, tone = "neutral") {
    const toast = must("#toast");
    toast.textContent = message;
    toast.className = `toast show ${tone}`;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3600);
}
function toggleForecast() {
    forecastPanel.classList.toggle("open");
    must("#forecast-toggle").setAttribute("aria-expanded", String(forecastPanel.classList.contains("open")));
}
function openHelp(invoker) {
    helpReturnFocus = invoker;
    helpModal.showModal();
}
function drawCity(time) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width;
    const h = rect.height;
    const t = motionEnabled ? time / 1000 : 0;
    const background = ctx.createLinearGradient(0, 0, 0, h);
    background.addColorStop(0, "#07131b");
    background.addColorStop(0.55, "#0b1d26");
    background.addColorStop(1, "#071017");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
    drawGroundGrid(w, h);
    drawRoads(w, h);
    drawBuildings(w, h, t);
    drawDependencies(w, h, t);
    drawTraffic(w, h, t);
    drawComms(w, h, t);
    drawEmergency(w, h, t);
    drawDirectives(w, h, t);
    drawServices(w, h, t);
    drawPending(w, h);
    drawResolutionPulses(w, h, time);
    drawStrainVignette(w, h, t);
    requestAnimationFrame(drawCity);
}
function pointFor(id, w, h) {
    const points = {
        grid: [0.37, 0.30],
        comms: [0.61, 0.28],
        transit: [0.30, 0.73],
        emergency: [0.66, 0.72],
    };
    const p = points[id];
    return { x: p[0] * w, y: p[1] * h };
}
function drawGroundGrid(w, h) {
    ctx.save();
    ctx.strokeStyle = "rgba(108, 164, 179, .055)";
    ctx.lineWidth = 1;
    const step = Math.max(38, w / 24);
    for (let x = -h; x < w + h; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + h, h);
        ctx.stroke();
    }
    for (let x = 0; x < w + h * 2; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x - h, h);
        ctx.stroke();
    }
    ctx.restore();
}
function drawRoads(w, h) {
    const routes = roadRoutes(w, h);
    ctx.save();
    ctx.lineCap = "round";
    for (const route of routes) {
        ctx.strokeStyle = "rgba(16, 26, 32, .96)";
        ctx.lineWidth = 18;
        path(route);
        ctx.stroke();
        ctx.strokeStyle = "rgba(119, 151, 159, .18)";
        ctx.lineWidth = 1;
        ctx.setLineDash([9, 14]);
        path(route);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    ctx.restore();
}
function roadRoutes(w, h) {
    const g = pointFor("grid", w, h), c = pointFor("comms", w, h), tr = pointFor("transit", w, h), e = pointFor("emergency", w, h);
    return [
        [{ x: w * .03, y: h * .5 }, { x: w * .97, y: h * .5 }],
        [{ x: w * .5, y: h * .04 }, { x: w * .5, y: h * .96 }],
        [g, { x: w * .5, y: h * .5 }, e],
        [tr, { x: w * .5, y: h * .5 }, c],
    ];
}
function path(points) {
    ctx.beginPath();
    points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
}
function drawBuildings(w, h, t) {
    const gridAvailability = view?.availability.grid ?? 5;
    const powerRatio = gridAvailability / 6;
    for (const building of buildings) {
        const x = building.x * w;
        const y = building.y * h;
        const bw = building.w * w;
        const bh = building.h * h;
        if (Math.abs(x - w * .5) < 30 || Math.abs(y - h * .5) < 26)
            continue;
        const lit = seededFlicker(building.phase, t, powerRatio);
        ctx.fillStyle = `rgba(${18 + building.district * 3}, ${38 + building.district * 3}, ${48 + building.district * 5}, .94)`;
        ctx.fillRect(x, y - bh, bw, bh);
        ctx.fillStyle = `rgba(35, 69, 80, .42)`;
        ctx.fillRect(x + bw, y - bh - bw * .24, bw * .24, bh + bw * .24);
        if (lit) {
            ctx.fillStyle = powerRatio > .45 ? "rgba(178, 223, 188, .34)" : "rgba(243, 165, 90, .24)";
            const rows = Math.max(1, Math.floor(bh / 11));
            for (let row = 0; row < rows; row++) {
                if ((row + Math.floor(building.phase * 10)) % 2 === 0)
                    ctx.fillRect(x + 3, y - bh + 5 + row * 10, Math.max(2, bw - 6), 3);
            }
        }
    }
}
function seededFlicker(phase, t, ratio) {
    if (ratio >= .75)
        return true;
    if (ratio <= .05)
        return false;
    const wave = (Math.sin(t * (4 + phase % 3) + phase * 7) + 1) / 2;
    return wave < ratio;
}
function drawDependencies(w, h, t) {
    if (!view)
        return;
    const failing = new Set(view.forecast?.events.filter(event => event.kind === "dependency_failure").map(event => event.cause) ?? []);
    ctx.save();
    for (const [source, target] of RULES.dependencies) {
        const a = pointFor(source, w, h), b = pointFor(target, w, h);
        const key = `${source}-to-${target}`;
        const isFailing = failing.has(key);
        ctx.strokeStyle = isFailing ? `rgba(255, 105, 75, ${.55 + Math.sin(t * 5) * .2})` : "rgba(88, 176, 188, .18)";
        ctx.lineWidth = isFailing ? 3 : 1.5;
        ctx.setLineDash(isFailing ? [5, 8] : []);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
    }
    ctx.restore();
}
function drawTraffic(w, h, t) {
    const availability = view?.availability.transit ?? 5;
    const speed = .018 + availability / 6 * .045;
    const routes = roadRoutes(w, h);
    ctx.save();
    vehicles.forEach(vehicle => {
        const route = routes[vehicle.route];
        const progress = availability === 0 ? vehicle.phase : (vehicle.phase + t * speed) % 1;
        const position = along(route, progress);
        ctx.translate(position.x, position.y + (vehicle.lane ? 5 : -5));
        ctx.fillStyle = availability < 3 ? "rgba(239, 128, 78, .82)" : "rgba(174, 213, 217, .65)";
        ctx.fillRect(-4, -2, 8, 4);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    });
    ctx.restore();
}
function along(points, progress) {
    const lengths = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        lengths.push(length);
        total += length;
    }
    let target = progress * total;
    for (let i = 0; i < lengths.length; i++) {
        const length = lengths[i];
        if (target <= length) {
            const a = points[i], b = points[i + 1];
            const ratio = length === 0 ? 0 : target / length;
            return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
        }
        target -= length;
    }
    return points.at(-1);
}
function drawComms(w, h, t) {
    if (!view)
        return;
    const availability = view.availability.comms;
    const source = pointFor("comms", w, h);
    const targets = ["grid", "transit", "emergency"];
    ctx.save();
    for (const [index, targetId] of targets.entries()) {
        const target = pointFor(targetId, w, h);
        const progress = ((t * (.16 + availability * .02)) + index * .28) % 1;
        const x = source.x + (target.x - source.x) * progress;
        const y = source.y + (target.y - source.y) * progress;
        ctx.fillStyle = availability < 3 ? "rgba(255, 109, 88, .55)" : "rgba(100, 221, 217, .48)";
        ctx.beginPath();
        ctx.arc(x, y, 2 + availability * .22, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}
function drawEmergency(w, h, t) {
    if (!view)
        return;
    const availability = view.availability.emergency;
    if (availability <= 0)
        return;
    const route = roadRoutes(w, h)[2];
    const progress = (.1 + t * (.025 + availability * .008)) % 1;
    const position = along(route, progress);
    ctx.save();
    ctx.translate(position.x, position.y);
    ctx.fillStyle = "rgba(229, 238, 234, .92)";
    ctx.fillRect(-8, -4, 16, 8);
    ctx.fillStyle = Math.sin(t * 12) > 0 ? "rgba(91, 196, 255, .95)" : "rgba(255, 92, 78, .95)";
    ctx.fillRect(-2, -6, 4, 2);
    ctx.restore();
}
function drawDirectives(w, h, t) {
    if (!view)
        return;
    for (const [index, directive] of view.directives.entries()) {
        const source = pointFor(directive.origin, w, h);
        const blocked = directive.blockedBy.length > 0;
        const pulse = (t * .55 + index * .31) % 1;
        ctx.save();
        ctx.strokeStyle = blocked ? "rgba(102, 221, 188, .55)" : "rgba(255, 111, 75, .68)";
        ctx.lineWidth = blocked ? 2 : 3;
        ctx.setLineDash(blocked ? [4, 6] : []);
        ctx.beginPath();
        ctx.arc(source.x, source.y, 32 + pulse * 54, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        if (!blocked) {
            for (const targetId of SERVICES) {
                const delta = directive.integrityDelta[targetId];
                if (delta === undefined || delta >= 0)
                    continue;
                const target = pointFor(targetId, w, h);
                const p = (pulse + .15) % 1;
                const x = source.x + (target.x - source.x) * p;
                const y = source.y + (target.y - source.y) * p;
                ctx.fillStyle = "rgba(255, 111, 75, .82)";
                ctx.beginPath();
                ctx.arc(x, y, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();
    }
}
function drawServices(w, h, t) {
    if (!view)
        return;
    for (const id of SERVICES) {
        const p = pointFor(id, w, h);
        const service = view.core.services[id];
        const capacity = view.availability[id];
        const isSelected = id === selected;
        const radius = isSelected ? 34 : 29;
        ctx.save();
        ctx.translate(p.x, p.y);
        if (service.mode === "autonomous") {
            ctx.strokeStyle = `rgba(255, 137, 78, ${.34 + Math.sin(t * 2.4) * .1})`;
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 7]);
            ctx.beginPath();
            ctx.arc(0, 0, radius + 12, t, t + Math.PI * 1.55);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        else if (service.mode === "regulated") {
            ctx.strokeStyle = "rgba(91, 226, 181, .74)";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, radius + 10, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.fillStyle = capacity < 3 ? "rgba(92, 34, 31, .94)" : "rgba(12, 33, 42, .96)";
        ctx.strokeStyle = isSelected ? "rgba(229, 244, 242, .95)" : capacity < 4 ? "rgba(255, 157, 94, .75)" : "rgba(104, 190, 187, .58)";
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(234, 245, 242, .94)";
        ctx.font = "700 11px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(SERVICE_META[id].short, 0, -3);
        ctx.font = "800 16px system-ui";
        ctx.fillText(`${capacity}/6`, 0, 16);
        if (service.backup) {
            ctx.fillStyle = "rgba(109, 204, 215, .95)";
            ctx.fillRect(radius - 7, -radius + 2, 9, 9);
        }
        if (service.authorityHeld) {
            ctx.strokeStyle = "rgba(238, 219, 120, .95)";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, radius - 7, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    }
}
function drawPending(w, h) {
    if (!view)
        return;
    for (const pending of view.core.pending) {
        const p = pointFor(pending.target, w, h);
        const rounds = Math.max(0, pending.dueRound - view.core.round);
        ctx.save();
        ctx.translate(p.x + 27, p.y + 31);
        ctx.fillStyle = "rgba(91, 20, 24, .94)";
        ctx.strokeStyle = "rgba(255, 120, 91, .85)";
        ctx.lineWidth = 1;
        roundedRect(-15, -10, 30, 20, 7);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "white";
        ctx.font = "700 10px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(`-${Math.abs(pending.delta)} R${rounds}`, 0, 4);
        ctx.restore();
    }
}
function roundedRect(x, y, width, height, radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
}
function drawResolutionPulses(w, h, time) {
    if (feedbackPulses.length === 0)
        return;
    feedbackPulses = feedbackPulses.filter(pulse => time - pulse.startedAt < pulse.duration);
    for (const pulse of feedbackPulses) {
        const elapsed = Math.max(0, time - pulse.startedAt);
        const progress = motionEnabled ? Math.min(1, elapsed / pulse.duration) : 0.48;
        const anchor = pulse.target ? pointFor(pulse.target, w, h) : { x: w / 2, y: h / 2 };
        const radius = pulse.target ? 36 + progress * 74 : Math.min(w, h) * (0.16 + progress * 0.42);
        const alpha = Math.max(0, (1 - progress) * 0.72);
        const color = pulse.tone === "success" ? `rgba(107, 217, 189, ${alpha})`
            : pulse.tone === "warning" ? `rgba(241, 178, 109, ${alpha})`
                : pulse.tone === "danger" ? `rgba(255, 101, 93, ${alpha})`
                    : `rgba(150, 205, 211, ${alpha})`;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(anchor.x, anchor.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        if (!pulse.target) {
            ctx.globalAlpha = alpha * 0.12;
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, w, h);
        }
        ctx.restore();
    }
}
function drawStrainVignette(w, h, t) {
    const strain = view?.core.strain ?? 0;
    if (strain < 7)
        return;
    const ratio = Math.min(1, strain / RULES.constants.strainLossThreshold);
    const alpha = .08 + ratio * .16 + (motionEnabled ? Math.sin(t * 2) * .018 : 0);
    const gradient = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * .25, w / 2, h / 2, Math.max(w, h) * .72);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(1, `rgba(150, 20, 15, ${alpha})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
}
canvas.addEventListener("pointerdown", event => {
    if (!view)
        return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    let nearest = null;
    for (const id of SERVICES) {
        const p = pointFor(id, rect.width, rect.height);
        const distance = Math.hypot(x - p.x, y - p.y);
        if (!nearest || distance < nearest.distance)
            nearest = { id, distance };
    }
    if (nearest && nearest.distance < 55) {
        selected = nearest.id;
        renderServices();
        renderSelectedService();
    }
});
must("#start-generated").addEventListener("click", () => startSeeded(must("#seed-input").value));
must("#start-tutorial").addEventListener("click", () => startTutorial(0));
must("#random-seed").addEventListener("click", () => { must("#seed-input").value = makeSeed(); });
must("#resume-game").addEventListener("click", () => { if (pendingResume)
    resume(pendingResume); });
must("#practice-list").innerHTML = SCENARIOS.map(scenario => `<button data-scenario="${scenario.id}"><strong>${escapeHtml(scenario.name)}</strong><small>${escapeHtml(scenario.description)}</small></button>`).join("");
must("#practice-list").querySelectorAll("[data-scenario]").forEach(button => button.addEventListener("click", () => startAuthored(button.dataset.scenario)));
must("#undo").addEventListener("click", () => dispatch({ type: "undo" }));
must("#commit").addEventListener("click", () => dispatch({ type: "commit_round" }));
must("#forecast-toggle").addEventListener("click", toggleForecast);
const helpButton = must("#help");
const startHelpButton = must("#start-help");
helpButton.addEventListener("click", () => openHelp(helpButton));
startHelpButton.addEventListener("click", () => openHelp(startHelpButton));
must("#close-help").addEventListener("click", () => helpModal.close());
helpModal.addEventListener("close", () => {
    helpReturnFocus?.focus();
    helpReturnFocus = null;
});
must("#decline-tool").addEventListener("click", () => dispatch({ type: "choose_tool", tool: null }));
must("#result-same").addEventListener("click", restartSame);
must("#result-new").addEventListener("click", () => startSeeded());
must("#result-menu").addEventListener("click", () => {
    tutorialIndex = null;
    resultModal.close();
    tutorialPanel.classList.add("hidden");
    startScreen.classList.remove("hidden");
    state = null;
    view = null;
    clearResolutionFeedback();
});
must("#tutorial-reset").addEventListener("click", () => {
    if (tutorialIndex !== null)
        startTutorial(tutorialIndex);
});
must("#tutorial-help").addEventListener("click", () => {
    const tutorial = activeTutorial();
    if (!tutorial)
        return;
    tutorialHintLevel = Math.min(tutorialHintLevel + 1, tutorial.hints.length);
    renderTutorial();
});
must("#tutorial-next").addEventListener("click", () => {
    const status = tutorialStatus();
    if (!status?.complete || tutorialIndex === null)
        return;
    if (tutorialIndex >= TUTORIALS.length - 1)
        startSeeded();
    else
        startTutorial(tutorialIndex + 1);
});
must("#tutorial-exit").addEventListener("click", leaveTutorial);
must("#sound-toggle").addEventListener("click", toggleSound);
must("#start-sound-toggle").addEventListener("click", toggleSound);
must("#motion-toggle").addEventListener("click", () => {
    motionEnabled = !motionEnabled && !reducedBySystem;
    saveSettings();
    updateMotionButton();
});
window.addEventListener("storage", event => {
    if (event.key !== SAVE_META_KEY || !state || tutorialIndex !== null)
        return;
    const meta = parseSaveMeta(event.newValue);
    if (!meta || meta.tabId === TAB_ID || meta.token === observedSaveToken)
        return;
    saveConflictShown = true;
    showToast("Another browser tab saved a newer incident. Autosave is paused here; reload to resume it.", "warning");
});
loadSettings();
loadResume();
must("#seed-input").value = makeSeed();
const bootScreen = document.querySelector("#boot-screen");
const chatgptLogo = document.querySelector("#chatgpt-credit-logo");
if (chatgptLogo && location.protocol !== "file:") {
    chatgptLogo.src = CHATGPT_ICON_URL;
    chatgptLogo.addEventListener("load", () => { chatgptLogo.hidden = false; }, { once: true });
}
window.setTimeout(() => bootScreen?.classList.add("loaded"), reducedBySystem ? 80 : 1350);
requestAnimationFrame(drawCity);
