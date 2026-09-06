(() => {
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const START_MIDI = 48; // C3
  const END_MIDI = 84; // C6
  const SAMPLE_BASE = "https://tonejs.github.io/audio/salamander/";
  const SAMPLE_NAMES = [
    "A2",
    "C3",
    "Ds3",
    "Fs3",
    "A3",
    "C4",
    "Ds4",
    "Fs4",
    "A4",
    "C5",
    "Ds5",
    "Fs5",
    "A5",
    "C6",
  ];

  const BINDINGS = {
    KeyA: { root: "A", midi: 69 },
    KeyB: { root: "B", midi: 71 },
    KeyC: { root: "C", midi: 60 },
    KeyD: { root: "D", midi: 62 },
    KeyE: { root: "E", midi: 64 },
    KeyF: { root: "F", midi: 65 },
    KeyG: { root: "G", midi: 67 },
    Digit1: { root: "C#", midi: 61 },
    Digit2: { root: "D#", midi: 63 },
    Digit3: { root: "F#", midi: 66 },
    Digit4: { root: "G#", midi: 68 },
    Digit5: { root: "A#", midi: 70 },
  };

  const MAP_ROWS = [
    { codes: ["KeyA"], label: "A", root: "A" },
    { codes: ["KeyB"], label: "B", root: "B" },
    { codes: ["KeyC"], label: "C", root: "C" },
    { codes: ["KeyD"], label: "D", root: "D" },
    { codes: ["KeyE"], label: "E", root: "E" },
    { codes: ["KeyF"], label: "F", root: "F" },
    { codes: ["KeyG"], label: "G", root: "G" },
    { codes: ["Digit1"], label: "1", root: "C#" },
    { codes: ["Digit2"], label: "2", root: "D#" },
    { codes: ["Digit3"], label: "3", root: "F#" },
    { codes: ["Digit4"], label: "4", root: "G#" },
    { codes: ["Digit5"], label: "5", root: "A#" },
  ];

  const keyboardEl = document.getElementById("keyboard");
  const statusEl = document.getElementById("status");
  const startBtn = document.getElementById("start-btn");
  const mapListEl = document.getElementById("map-list");

  const keyEls = new Map();
  const heldChords = new Map();
  const heldSingles = new Map();
  const activeMidis = new Map();
  const samples = new Map();
  const rawSamples = new Map();
  let samplePrefetch = null;

  let audioCtx = null;
  let master = null;
  let samplesReady = false;
  let loadPromise = null;

  function midiToNoteName(midi) {
    return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
  }

  function midiToFreq(midi) {
    return 440 * 2 ** ((midi - 69) / 12);
  }

  function displayNote(name) {
    return name.replace("#", "♯");
  }

  function chordMidis(rootMidi, quality) {
    const third = quality === "major" ? 4 : 3;
    return [rootMidi, rootMidi + third, rootMidi + 7];
  }

  function chordLabel(root, quality) {
    return `${displayNote(root)} ${quality}`;
  }

  function isWhite(midi) {
    return [0, 2, 4, 5, 7, 9, 11].includes(midi % 12);
  }

  function parseSampleName(name) {
    const match = name.match(/^([A-G])(s?)(\d)$/);
    const letter = match[1] + (match[2] ? "#" : "");
    const octave = Number(match[3]);
    return 12 * (octave + 1) + NOTE_NAMES.indexOf(letter);
  }

  function nearestSample(midi) {
    let best = null;
    let bestDist = Infinity;
    for (const [sampleMidi, buffer] of samples) {
      const dist = Math.abs(sampleMidi - midi);
      if (dist < bestDist) {
        best = { midi: sampleMidi, buffer };
        bestDist = dist;
      }
    }
    return best;
  }

  async function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new AudioContext();
      master = audioCtx.createGain();
      master.gain.value = 0.9;
      master.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }
    if (!samplesReady) {
      setStatus("Loading piano");
      await loadSamples();
    }
    startBtn.textContent = "Piano is ready";
    startBtn.classList.add("is-ready");
    if (statusEl.textContent === "Waiting for the first note" || statusEl.textContent === "Loading piano") {
      setStatus("Press E for E minor");
    }
  }

  function prefetchSamples() {
    if (samplePrefetch) return samplePrefetch;
    samplePrefetch = Promise.allSettled(
      SAMPLE_NAMES.map(async (name) => {
        const response = await fetch(`${SAMPLE_BASE}${name}.mp3`);
        if (!response.ok) throw new Error(name);
        rawSamples.set(name, await response.arrayBuffer());
      })
    );
    return samplePrefetch;
  }

  async function loadSamples() {
    if (samplesReady) return;
    if (loadPromise) {
      await loadPromise;
      return;
    }
    loadPromise = (async () => {
      await prefetchSamples();
      const decodes = await Promise.allSettled(
        [...rawSamples.entries()].map(async ([name, raw]) => {
          const buffer = await audioCtx.decodeAudioData(raw.slice(0));
          samples.set(parseSampleName(name), buffer);
        })
      );
      samplesReady = decodes.some((result) => result.status === "fulfilled");
    })();
    try {
      await loadPromise;
    } finally {
      if (!samplesReady) loadPromise = null;
    }
  }

  function playVoice(midi, velocity = 0.85) {
    const now = audioCtx.currentTime;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(velocity, now + 0.012);
    gain.connect(master);

    const sample = samplesReady ? nearestSample(midi) : null;
    let source = null;

    if (sample) {
      source = audioCtx.createBufferSource();
      source.buffer = sample.buffer;
      source.playbackRate.value = midiToFreq(midi) / midiToFreq(sample.midi);
      source.connect(gain);
      source.start(now);
    } else {
      startSynthVoice(midi, gain, now);
    }

    return { source, gain };
  }

  function startSynthVoice(midi, gain, now) {
    const freq = midiToFreq(midi);
    const partials = [1, 2, 3, 4.02, 5.04, 6.08];
    const amps = [0.55, 0.22, 0.12, 0.07, 0.04, 0.025];
    partials.forEach((ratio, index) => {
      const osc = audioCtx.createOscillator();
      osc.type = index < 2 ? "triangle" : "sine";
      osc.frequency.value = freq * ratio;
      const part = audioCtx.createGain();
      part.gain.value = amps[index];
      osc.connect(part);
      part.connect(gain);
      osc.start(now);
      osc.stop(now + 6);
    });
  }

  function releaseVoice(voice, decay = 0.38) {
    if (!voice) return;
    const now = audioCtx.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), now);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    window.setTimeout(() => {
      try {
        voice.source?.stop();
      } catch {
        /* already stopped */
      }
      voice.gain.disconnect();
    }, decay * 1000 + 40);
  }

  function markMidi(midi, on) {
    const count = (activeMidis.get(midi) || 0) + (on ? 1 : -1);
    if (count <= 0) {
      activeMidis.delete(midi);
      keyEls.get(midi)?.classList.remove("is-on");
    } else {
      activeMidis.set(midi, count);
      keyEls.get(midi)?.classList.add("is-on");
    }
  }

  function setStatus(text) {
    statusEl.textContent = text;
    statusEl.classList.remove("is-swap");
    void statusEl.offsetWidth;
    statusEl.classList.add("is-swap");
  }

  async function playChord(id, root, rootMidi, quality) {
    if (heldChords.has(id)) return;
    heldChords.set(id, null);
    await ensureAudio();
    if (!heldChords.has(id)) return;
    const midis = chordMidis(rootMidi, quality);
    const voices = midis.map((midi, index) => {
      markMidi(midi, true);
      return playVoice(midi, 0.78 - index * 0.06);
    });
    heldChords.set(id, { midis, voices });
    setStatus(chordLabel(root, quality));
    highlightMap(root, quality, true);
  }

  function releaseChord(id) {
    if (!heldChords.has(id)) return;
    const held = heldChords.get(id);
    heldChords.delete(id);
    if (held) {
      held.voices.forEach((voice) => releaseVoice(voice));
      held.midis.forEach((midi) => markMidi(midi, false));
    }
    highlightMap(null, null, false);
    if (heldChords.size === 0 && heldSingles.size === 0) {
      setStatus("Ready");
    }
  }

  async function playSingle(midi) {
    if (heldSingles.has(midi)) return;
    heldSingles.set(midi, null);
    await ensureAudio();
    if (!heldSingles.has(midi)) return;
    markMidi(midi, true);
    heldSingles.set(midi, playVoice(midi, 0.82));
    setStatus(displayNote(midiToNoteName(midi)));
  }

  function releaseSingle(midi) {
    if (!heldSingles.has(midi)) return;
    const voice = heldSingles.get(midi);
    heldSingles.delete(midi);
    if (voice) {
      releaseVoice(voice);
      markMidi(midi, false);
    }
    if (heldChords.size === 0 && heldSingles.size === 0) {
      setStatus("Ready");
    }
  }

  function highlightMap(root, quality, on) {
    mapListEl.querySelectorAll(".map-row").forEach((row) => {
      const match = on && row.dataset.root === root;
      row.classList.toggle("is-on", Boolean(match));
      if (match) {
        row.dataset.quality = quality;
      } else {
        delete row.dataset.quality;
      }
    });
  }

  function bindingFromEvent(event) {
    return BINDINGS[event.code] || null;
  }

  function qualityFromEvent(event) {
    return event.shiftKey ? "major" : "minor";
  }

  async function onKeyDown(event) {
    if (event.repeat) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const binding = bindingFromEvent(event);
    if (!binding) return;
    event.preventDefault();
    await playChord(event.code, binding.root, binding.midi, qualityFromEvent(event));
  }

  function onKeyUp(event) {
    if (BINDINGS[event.code]) {
      releaseChord(event.code);
    }
  }

  function buildKeyboard() {
    const whites = [];
    for (let midi = START_MIDI; midi <= END_MIDI; midi += 1) {
      if (isWhite(midi)) whites.push(midi);
    }

    whites.forEach((midi) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "white-key";
      btn.dataset.midi = String(midi);
      btn.setAttribute("aria-label", midiToNoteName(midi));
      const name = midiToNoteName(midi);
      if (name.startsWith("C")) {
        const label = document.createElement("span");
        label.className = "key-label";
        label.textContent = name;
        btn.appendChild(label);
      }
      bindPointer(btn, midi);
      keyboardEl.appendChild(btn);
      keyEls.set(midi, btn);
    });

    const whiteWidth = 100 / whites.length;

    for (let midi = START_MIDI; midi <= END_MIDI; midi += 1) {
      if (isWhite(midi)) continue;
      const leftWhite = whites.indexOf(midi - 1);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "black-key";
      btn.dataset.midi = String(midi);
      btn.setAttribute("aria-label", midiToNoteName(midi));
      btn.style.width = `${whiteWidth * 0.58}%`;
      btn.style.left = `${(leftWhite + 0.71) * whiteWidth}%`;
      bindPointer(btn, midi);
      keyboardEl.appendChild(btn);
      keyEls.set(midi, btn);
    }
  }

  function bindPointer(el, midi) {
    const down = (event) => {
      event.preventDefault();
      playSingle(midi);
    };
    const up = () => releaseSingle(midi);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointerleave", up);
    el.addEventListener("pointercancel", up);
  }

  function buildMap() {
    MAP_ROWS.forEach((row) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "map-row";
      btn.dataset.root = row.root;
      btn.innerHTML = `
        <span class="map-key">${row.label}</span>
        <span class="map-minor">${displayNote(row.root)} minor</span>
        <span class="map-major">Shift ${row.label.toLowerCase()} · ${displayNote(row.root)} major</span>
      `;
      const binding = BINDINGS[row.codes[0]];
      btn.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        const quality = event.shiftKey ? "major" : "minor";
        playChord(`map-${row.root}`, binding.root, binding.midi, quality);
      });
      btn.addEventListener("pointerup", () => releaseChord(`map-${row.root}`));
      btn.addEventListener("pointerleave", () => releaseChord(`map-${row.root}`));
      btn.addEventListener("pointercancel", () => releaseChord(`map-${row.root}`));
      mapListEl.appendChild(btn);
    });
  }

  function releaseAll() {
    [...heldChords.keys()].forEach(releaseChord);
    [...heldSingles.keys()].forEach(releaseSingle);
  }

  startBtn.addEventListener("click", () => {
    ensureAudio();
  });

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseAll();
  });

  buildKeyboard();
  buildMap();
  prefetchSamples();
})();
