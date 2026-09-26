export function createAudioController(initialEnabled = true) {
    let enabled = initialEnabled;
    let context = null;
    let master = null;
    function ensureContext() {
        if (!enabled)
            return null;
        const Ctor = window.AudioContext;
        if (!Ctor)
            return null;
        if (!context) {
            context = new Ctor();
            master = context.createGain();
            master.gain.value = 0.12;
            master.connect(context.destination);
        }
        if (context.state === "suspended")
            void context.resume();
        return context;
    }
    function tone(frequency, duration, offset = 0, gain = 0.25, type = "sine", endFrequency) {
        const audio = ensureContext();
        if (!audio || !master)
            return;
        const start = audio.currentTime + Math.max(0, offset);
        const stop = start + Math.max(0.025, duration);
        const oscillator = audio.createOscillator();
        const envelope = audio.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, start);
        if (endFrequency !== undefined) {
            oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), stop);
        }
        envelope.gain.setValueAtTime(0.0001, start);
        envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + Math.min(0.018, duration * 0.25));
        envelope.gain.exponentialRampToValueAtTime(0.0001, stop);
        oscillator.connect(envelope);
        envelope.connect(master);
        oscillator.start(start);
        oscillator.stop(stop + 0.02);
    }
    function noise(duration, offset = 0, gain = 0.13) {
        const audio = ensureContext();
        if (!audio || !master)
            return;
        const sampleRate = audio.sampleRate;
        const length = Math.max(1, Math.floor(sampleRate * duration));
        const buffer = audio.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
        }
        const source = audio.createBufferSource();
        const filter = audio.createBiquadFilter();
        const envelope = audio.createGain();
        filter.type = "lowpass";
        filter.frequency.value = 900;
        const start = audio.currentTime + Math.max(0, offset);
        envelope.gain.setValueAtTime(Math.max(0.0002, gain), start);
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        source.buffer = buffer;
        source.connect(filter);
        filter.connect(envelope);
        envelope.connect(master);
        source.start(start);
    }
    function playUi(cue) {
        if (!enabled)
            return;
        if (cue === "action") {
            tone(520, 0.07, 0, 0.11, "triangle", 690);
            return;
        }
        if (cue === "undo") {
            tone(420, 0.09, 0, 0.10, "triangle", 300);
            return;
        }
        if (cue === "draft") {
            tone(330, 0.08, 0, 0.10, "sine", 460);
            tone(550, 0.10, 0.07, 0.08, "sine", 680);
            return;
        }
        tone(620, 0.08, 0, 0.08, "sine", 820);
    }
    function playResolution(events) {
        if (!enabled || events.length === 0)
            return;
        const kinds = new Set(events.map(event => event.kind));
        if (kinds.has("win")) {
            tone(392, 0.16, 0, 0.15, "sine", 523);
            tone(523, 0.18, 0.12, 0.14, "sine", 659);
            tone(659, 0.28, 0.25, 0.13, "sine", 784);
            return;
        }
        if (kinds.has("collapse")) {
            noise(0.22, 0, 0.18);
            tone(150, 0.35, 0, 0.20, "sawtooth", 62);
            tone(86, 0.42, 0.14, 0.16, "sine", 42);
            return;
        }
        if (kinds.has("deadline")) {
            tone(220, 0.18, 0, 0.12, "square", 175);
            tone(165, 0.26, 0.18, 0.10, "square", 125);
            return;
        }
        if (kinds.has("dependency_failure") || kinds.has("effect_applied")) {
            noise(0.12, 0, 0.13);
            tone(190, 0.20, 0, 0.17, "sawtooth", 92);
            tone(128, 0.18, 0.12, 0.11, "triangle", 76);
            return;
        }
        if (kinds.has("order_executed") || kinds.has("effect_queued")) {
            tone(410, 0.11, 0, 0.12, "square", 260);
            tone(260, 0.17, 0.09, 0.10, "triangle", 180);
            return;
        }
        if (kinds.has("order_blocked")) {
            tone(300, 0.08, 0, 0.09, "triangle", 420);
            tone(520, 0.14, 0.07, 0.10, "sine", 650);
            return;
        }
        if (kinds.has("city_strain")) {
            tone(230, 0.11, 0, 0.07, "sine", 190);
        }
    }
    return {
        setEnabled(next) {
            enabled = next;
            if (!enabled && context?.state === "running")
                void context.suspend();
        },
        isEnabled() {
            return enabled;
        },
        playUi,
        playResolution,
    };
}
