/** Original procedural score and sound design for SKYBOUND. No external audio assets. */
const STORAGE_KEY = 'skybound-audio-v1';
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const midi = note => 440 * 2 ** ((note - 69) / 12);
const DEFAULTS = Object.freeze({musicEnabled: true, sfxEnabled: true, musicVolume: .42, sfxVolume: .7});
const CHORDS = [[52, 59, 66, 67], [48, 55, 62, 64], [55, 59, 62, 69], [50, 57, 64, 66], [52, 59, 62, 67], [48, 55, 59, 64], [57, 60, 64, 67], [50, 57, 62, 66]];
const MELODY = [[76, null, 79, 78, 74, null, 71, null], [72, null, 76, null, 79, 76, 74, null], [71, 74, null, 79, 81, null, 78, null], [78, null, 76, 74, 69, null, 74, null], [76, null, 83, 81, 79, null, 78, null], [76, 79, null, 84, 83, null, 79, null], [81, null, 79, 76, 72, null, 76, null], [78, 76, 74, null, 69, null, 71, 74]];

export function createFlightAudio() {
  const preferences = {...DEFAULTS};
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      for (const key of ['musicEnabled', 'sfxEnabled']) if (typeof saved[key] === 'boolean') preferences[key] = saved[key];
      for (const key of ['musicVolume', 'sfxVolume']) if (Number.isFinite(saved[key])) preferences[key] = clamp(saved[key]);
    }
  } catch { /* A blocked or damaged local save never prevents flight. */ }

  let context, master, musicBus, sfxBus, engineBus, padFilter, engineFilter, windFilter, engineTone, turbineTone, engineNoise, windNoise, analyser;
  let timer = null, nextNoteAt = 0, eighth = 0, disposed = false, unavailable = false, scheduledNotes = 0, musicActive = false;
  let engineGain, turbineGain, rumbleGain, windGain;
  let state = {playing: false, paused: false, finished: false, hidden: false, speed: 0, throttle: 0, boosting: false, lowPass: false, intensity: 0};
  const voices = new Set(), continuous = [], infrastructure = [], lastCues = new Map();
  let noiseBuffer;
  const analysisData = new Float32Array(256);

  function track(node) { infrastructure.push(node); return node; }
  function gain(value, destination) {
    const node = track(context.createGain()); node.gain.value = value;
    if (destination) node.connect(destination);
    return node;
  }
  function ramp(param, value, seconds = .12) {
    if (!context || !param) return;
    param.setTargetAtTime(value, context.currentTime, seconds);
  }
  function build() {
    if (context || disposed || unavailable) return !!context;
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Audio) { unavailable = true; return false; }
    try {
      context = new Audio({latencyHint: 'interactive'});
      const compressor = track(context.createDynamicsCompressor());
      compressor.threshold.value = -18; compressor.knee.value = 18; compressor.ratio.value = 3;
      compressor.attack.value = .008; compressor.release.value = .22;
      analyser = track(context.createAnalyser()); analyser.fftSize = 256;
      master = gain(.8, compressor); compressor.connect(analyser); analyser.connect(context.destination);
      musicBus = gain(0, master); sfxBus = gain(0, master); engineBus = gain(0, sfxBus);
      padFilter = track(context.createBiquadFilter()); padFilter.type = 'lowpass'; padFilter.frequency.value = 2400; padFilter.Q.value = .45; padFilter.connect(musicBus);
      const delay = track(context.createDelay(.8)), feedback = gain(.23), echo = gain(.16, musicBus);
      delay.delayTime.value = .45; delay.connect(feedback); feedback.connect(delay); delay.connect(echo);
      padFilter.connect(delay);
      noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * 3), context.sampleRate);
      const data = noiseBuffer.getChannelData(0); let previous = 0;
      for (let i = 0; i < data.length; i++) { previous = previous * .94 + (Math.random() * 2 - 1) * .06; data[i] = previous * 2.5; }

      engineFilter = track(context.createBiquadFilter()); engineFilter.type = 'lowpass'; engineFilter.frequency.value = 440; engineFilter.Q.value = .6; engineFilter.connect(engineBus);
      engineGain = gain(0, engineFilter); turbineGain = gain(0, engineFilter); rumbleGain = gain(0, engineFilter);
      windFilter = track(context.createBiquadFilter()); windFilter.type = 'highpass'; windFilter.frequency.value = 650; windFilter.Q.value = .3; windFilter.connect(engineBus);
      windGain = gain(0, windFilter);
      engineTone = context.createOscillator(); engineTone.type = 'sawtooth'; engineTone.frequency.value = 72; engineTone.connect(engineGain);
      turbineTone = context.createOscillator(); turbineTone.type = 'sine'; turbineTone.frequency.value = 148; turbineTone.connect(turbineGain);
      engineNoise = context.createBufferSource(); engineNoise.buffer = noiseBuffer; engineNoise.loop = true; engineNoise.connect(rumbleGain);
      windNoise = context.createBufferSource(); windNoise.buffer = noiseBuffer; windNoise.loop = true; windNoise.playbackRate.value = 1.37; windNoise.connect(windGain);
      continuous.push(engineTone, turbineTone, engineNoise, windNoise);
      continuous.forEach(source => source.start());
      context.addEventListener('statechange', () => { if (!disposed) sync(); });
      return true;
    } catch {
      unavailable = true;
      context?.close().catch(() => {});
      context = null;
      return false;
    }
  }
  function remember(source, nodes, category) {
    const voice = {source, nodes, category}; voices.add(voice);
    source.onended = () => {
      voices.delete(voice);
      source.disconnect(); nodes.forEach(node => node.disconnect());
    };
    return source;
  }
  function tone(frequency, at, duration, amplitude, type = 'sine', destination = padFilter, category = 'music', pan = 0) {
    if (!context || voices.size >= 96) return;
    const oscillator = context.createOscillator(), envelope = context.createGain();
    envelope.gain.value = .00001;
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, at);
    envelope.gain.setValueAtTime(.00001, at);
    envelope.gain.exponentialRampToValueAtTime(Math.max(.0001, amplitude), at + Math.min(.045, duration * .13));
    envelope.gain.exponentialRampToValueAtTime(Math.max(.0001, amplitude * .5), at + duration * .6);
    envelope.gain.exponentialRampToValueAtTime(.00001, at + duration);
    const nodes = [envelope]; oscillator.connect(envelope);
    if (context.createStereoPanner && pan) {
      const panner = context.createStereoPanner(); panner.pan.value = pan; envelope.connect(panner); panner.connect(destination); nodes.push(panner);
    } else envelope.connect(destination);
    remember(oscillator, nodes, category); oscillator.start(at); oscillator.stop(at + duration + .035);
    return oscillator;
  }
  function noise(at, duration, amplitude, frequency, category = 'music', destination = musicBus) {
    if (!context || voices.size >= 96) return;
    const source = context.createBufferSource(), envelope = context.createGain(), filter = context.createBiquadFilter();
    envelope.gain.value = .00001;
    source.buffer = noiseBuffer; filter.type = 'bandpass'; filter.frequency.value = frequency; filter.Q.value = .65;
    envelope.gain.setValueAtTime(.00001, at); envelope.gain.exponentialRampToValueAtTime(amplitude, at + .012); envelope.gain.exponentialRampToValueAtTime(.00001, at + duration);
    source.connect(filter).connect(envelope).connect(destination); remember(source, [envelope, filter], category);
    source.start(at, Math.random()); source.stop(at + duration + .025);
  }
  function stopVoices(category) {
    if (!context) return;
    for (const voice of voices) if (!category || voice.category === category) {
      // Gain ramps avoid a hard discontinuity, including notes queued in the lookahead window.
      for (const node of voice.nodes) if (node.gain) {
        node.gain.cancelScheduledValues(context.currentTime);
        node.gain.setTargetAtTime(.00001, context.currentTime, .018);
      }
      try { voice.source.stop(context.currentTime + .08); } catch {}
    }
  }
  function scheduleEighth(at, step) {
    const bar = Math.floor(step / 8), beat = step % 8, chord = CHORDS[bar % 8];
    const inFlight = state.playing && !state.finished;
    const pressure = inFlight ? clamp(Number(state.intensity) || 0, 0, 1) : 0;
    const energetic = inFlight && (state.boosting || state.lowPass || pressure > .55);
    if (beat === 0) {
      chord.forEach((note, index) => tone(midi(note), at, 2.75, .035, 'triangle', padFilter, 'music', (index - 1.5) * .25));
      tone(midi(chord[0] - 12), at, inFlight ? .65 : 1.7, .11, 'sine');
    }
    // A 16-bar phrase changes octave and leaves breathing room in alternate bars.
    const melody = MELODY[bar % 8][beat];
    if (melody !== null && (inFlight || beat % 2 === 0)) {
      const octave = Math.floor(bar / 8) % 2 === 1 && beat < 4 ? -12 : 0;
      tone(midi(melody + octave), at, .58 + (beat % 2 ? .12 : 0), inFlight ? .075 : .052, 'triangle', padFilter, 'music', Math.sin(bar * .8) * .28);
    }
    if (inFlight && beat % 2 === 0) {
      const kick = tone(95, at, .2, energetic ? .19 : .13, 'sine', musicBus);
      kick?.frequency.exponentialRampToValueAtTime(38, at + .16);
      if (beat === 4) tone(midi(chord[0] - 12), at, .5, .1, 'sine');
    }
    if (inFlight && beat % 4 === 2) noise(at, .12, .07, 1800);
    if (energetic || (inFlight && beat % 2 === 1)) noise(at, .045, energetic ? .035 : .023, 6400);
    if (energetic && beat % 2 === 1) tone(midi(chord[(beat + bar) % chord.length] + 12), at, .24, .035, 'sine', padFilter, 'music', beat < 4 ? -.32 : .32);
    scheduledNotes++;
  }
  function schedule() {
    timer = null;
    if (!context || context.state !== 'running' || disposed || !musicActive) return;
    // Never catch up notes after OS suspension or a background timer delay.
    if (nextNoteAt < context.currentTime - .1) nextNoteAt = context.currentTime + .035;
    while (nextNoteAt < context.currentTime + .16) {
      scheduleEighth(nextNoteAt, eighth++); nextNoteAt += .3; // 100 BPM; audio clock is the only transport clock.
    }
    timer = setTimeout(schedule, 35);
  }
  function sync() {
    if (!context || disposed) return;
    const audible = !state.hidden;
    const activeFlight = audible && state.playing && !state.paused && !state.finished;
    const shouldPlay = audible && !state.paused && preferences.musicEnabled && preferences.musicVolume > 0 && context.state === 'running';
    ramp(master.gain, audible ? .8 : 0, .035);
    ramp(musicBus.gain, preferences.musicEnabled ? preferences.musicVolume * .62 * (state.finished ? .75 : 1) : 0, .18);
    ramp(sfxBus.gain, preferences.sfxEnabled ? preferences.sfxVolume : 0, .06);
    ramp(engineBus.gain, activeFlight ? 1 : 0, .09);
    const throttle = clamp(Number(state.throttle) || 0), speed = clamp((Number(state.speed) || 0) / 430);
    ramp(engineGain.gain, .025 + throttle * .025 + (state.boosting ? .013 : 0));
    ramp(turbineGain.gain, .012 + throttle * .012);
    ramp(rumbleGain.gain, .11 + throttle * .1 + (state.boosting ? .1 : 0));
    ramp(windGain.gain, speed * speed * .23 + (state.lowPass ? .025 : 0));
    ramp(engineTone.frequency, 63 + throttle * 65 + speed * 38);
    ramp(turbineTone.frequency, 185 + throttle * 150 + speed * 200);
    ramp(engineFilter.frequency, 390 + throttle * 550 + (state.boosting ? 450 : 0));
    ramp(padFilter.frequency, activeFlight ? 2600 + (state.boosting ? 1500 : 0) : 1700, .4);
    if (shouldPlay && !musicActive) {
      musicActive = true; nextNoteAt = context.currentTime + .04;
      // Resume at the next complete bar instead of reviving cut-off notes.
      eighth = Math.ceil(eighth / 8) * 8; schedule();
    } else if (!shouldPlay && musicActive) {
      musicActive = false; clearTimeout(timer); timer = null; stopVoices('music');
    }
  }
  async function unlock() {
    if (!build()) return false;
    try {
      // Call resume inside the actual gesture even if a previous autoplay request is pending.
      if (context.state !== 'running') await context.resume();
      sync(); return context.state === 'running';
    } catch { return false; }
  }
  function update(next = {}) {
    const wasBlocked = state.hidden || state.paused;
    const wasPlaying = state.playing && !state.finished;
    state = {...state, ...next};
    if ((state.hidden || state.paused) && !wasBlocked) stopVoices();
    if (wasPlaying && (!state.playing || state.finished)) stopVoices('music');
    sync();
  }
  function setPreferences(patch = {}) {
    for (const key of ['musicEnabled', 'sfxEnabled']) if (typeof patch[key] === 'boolean') preferences[key] = patch[key];
    for (const key of ['musicVolume', 'sfxVolume']) if (Number.isFinite(patch[key])) preferences[key] = clamp(patch[key]);
    try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(preferences)); } catch {}
    if (!preferences.sfxEnabled) stopVoices('sfx');
    sync();
    return {...preferences};
  }
  function cue(name) {
    if (!context || context.state !== 'running' || !preferences.sfxEnabled || !preferences.sfxVolume || state.hidden || state.paused || disposed) return false;
    const at = context.currentTime + .008, debounce = name === 'warning' ? 2.5 : name === 'sonic' ? 3 : .12;
    if (at - (lastCues.get(name) ?? -Infinity) < debounce) return false;
    lastCues.set(name, at);
    const notes = name === 'complete' ? [64, 67, 71, 76] : name === 'checkpoint' ? [76, 83] : name === 'start' ? [64, 71, 76] : null;
    if (notes) notes.forEach((note, index) => tone(midi(note), at + index * .12, name === 'complete' ? .8 : .34, .1, 'sine', sfxBus, 'sfx'));
    else if (name === 'warning') {
      tone(680, at, .16, .075, 'triangle', sfxBus, 'sfx'); tone(510, at + .23, .19, .065, 'triangle', sfxBus, 'sfx');
    } else if (name === 'crash') {
      noise(at, .7, .55, 160, 'sfx', sfxBus);
      const impact = tone(85, at, .6, .2, 'sine', sfxBus, 'sfx'); impact?.frequency.exponentialRampToValueAtTime(28, at + .5);
    } else if (name === 'sonic') {
      noise(at, .45, .42, 290, 'sfx', sfxBus); tone(56, at + .025, .5, .14, 'sine', sfxBus, 'sfx');
    } else return false;
    return true;
  }
  function diagnostics() {
    let outputRms = 0;
    if (analyser && context?.state === 'running') {
      analyser.getFloatTimeDomainData(analysisData);
      outputRms = Math.sqrt(analysisData.reduce((sum, sample) => sum + sample * sample, 0) / analysisData.length);
    }
    return {contextState: context?.state || (unavailable ? 'unavailable' : 'not-created'), musicActive, schedulerCount: timer === null ? 0 : 1, musicVoices: [...voices].filter(voice => voice.category === 'music').length, effectVoices: [...voices].filter(voice => voice.category === 'sfx').length, continuousSources: continuous.length, scheduledNotes, outputRms, preferences: {...preferences}};
  }
  function dispose() {
    disposed = true; clearTimeout(timer); timer = null; musicActive = false;
    if (!context) return;
    for (const voice of voices) { try { voice.source.stop(); } catch {} }
    continuous.forEach(source => { try { source.stop(); source.disconnect(); } catch {} });
    infrastructure.forEach(node => node.disconnect());
    context.close().catch(() => {});
  }
  return {preferences, unlock, update, setPreferences, cue, dispose, diagnostics};
}
