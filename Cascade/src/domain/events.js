export function emit(events, round, phase, kind, cause, fields = {}) {
    events.push({ id: "r" + round + ":" + cause + ":" + events.length, round, phase, kind, cause, ...fields });
}
