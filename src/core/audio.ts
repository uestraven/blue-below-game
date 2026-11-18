/**
 * Procedurally synthesised audio. Every sound in the release build is generated
 * at runtime from oscillators and noise buffers, so there are no external audio
 * files to approve, mirror, or lose. See ASSET_MANIFEST.md (AUDIO section).
 *
 * Spatial cues (the demon, facility machinery, wall knocks) use PannerNodes so
 * the player can judge direction and distance by ear, which the design relies
 * on for deciding when to move.
 */

export type SfxName =
  | 'step_concrete'
  | 'step_metal'
  | 'step_tile'
  | 'knock'
  | 'relay'
  | 'clunk'
  | 'latch'
  | 'denied'
  | 'accept'
  | 'beep'
  | 'switch'
  | 'pickup'
  | 'shimmer'
  | 'gunshot'
  | 'dryfire'
  | 'roar'
  | 'scream'
  | 'hit'
  | 'demon_die'
  | 'rumble'
  | 'drip'
  | 'rat'
  | 'draught'
  | 'flare_fire'
  | 'demon_ignite'
  | 'ritual';

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  private droneGain: GainNode | null = null;
  private humGain: GainNode | null = null;
  private humPanner: PannerNode | null = null;
  private growlGain: GainNode | null = null;
  private growlPanner: PannerNode | null = null;
  private growlFilter: BiquadFilterNode | null = null;
  private heartGain: GainNode | null = null;
  private heartTimer = 0;
  private heartRate = 0;

  private masterVolume = 0.8;
  private sfxVolume = 1;
  started = false;
  /** Silences one-shots without tearing down the graph. */
  muted = false;

  /** Must be called from a user gesture (click / keypress). Idempotent. */
  start(): void {
    if (this.started) return;
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.masterVolume;
    this.master.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxVolume;
    this.sfxBus.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 1;
    this.musicBus.connect(this.master);

    this.noise = this.makeNoise(2.0);
    if (ctx.listener.forwardZ === undefined) {
      // Older listener API; orientation set via setOrientation in setListener().
    }
    this.buildAmbience();
    this.started = true;
    void ctx.resume();
  }

  /** 'no-context' when the browser refused to give us one at all. */
  get contextState(): string {
    return this.ctx ? this.ctx.state : 'no-context';
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  setVolumes(masterVolume: number, sfxVolume: number): void {
    this.masterVolume = masterVolume;
    this.sfxVolume = sfxVolume;
    if (this.master) this.master.gain.value = masterVolume;
    if (this.sfxBus) this.sfxBus.gain.value = sfxVolume;
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx as AudioContext;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < n; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (s / 0x3fffffff - 1) * 0.9;
    }
    return buf;
  }

  // ---------------------------------------------------------------- ambience

  private buildAmbience(): void {
    const ctx = this.ctx as AudioContext;

    // Low sustained drone: two detuned saws through a steep lowpass.
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneGain.connect(this.musicBus as GainNode);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    lp.Q.value = 0.8;
    lp.connect(this.droneGain);
    for (const f of [41.2, 41.9, 61.7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.22;
      o.connect(g).connect(lp);
      o.start();
    }
    // Slow breathing LFO on the drone so it never sits perfectly still.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 60;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();

    // Generator-room machinery hum, positioned in the world.
    this.humPanner = ctx.createPanner();
    this.configurePanner(this.humPanner, 60);
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.humGain.connect(this.humPanner).connect(this.sfxBus as GainNode);
    const humSrc = ctx.createBufferSource();
    humSrc.buffer = this.noise as AudioBuffer;
    humSrc.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 120;
    bp.Q.value = 6;
    const humOsc = ctx.createOscillator();
    humOsc.type = 'triangle';
    humOsc.frequency.value = 60;
    const humOscGain = ctx.createGain();
    humOscGain.gain.value = 0.3;
    humSrc.connect(bp).connect(this.humGain);
    humOsc.connect(humOscGain).connect(this.humGain);
    humSrc.start();
    humOsc.start();

    // Demon growl: looped noise through a resonant lowpass, positioned.
    this.growlPanner = ctx.createPanner();
    this.configurePanner(this.growlPanner, 90);
    this.growlGain = ctx.createGain();
    this.growlGain.gain.value = 0;
    this.growlFilter = ctx.createBiquadFilter();
    this.growlFilter.type = 'lowpass';
    this.growlFilter.frequency.value = 300;
    this.growlFilter.Q.value = 7;
    const gsrc = ctx.createBufferSource();
    gsrc.buffer = this.noise as AudioBuffer;
    gsrc.loop = true;
    gsrc.playbackRate.value = 0.55;
    const sub = ctx.createOscillator();
    sub.type = 'sawtooth';
    sub.frequency.value = 47;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    gsrc.connect(this.growlFilter);
    sub.connect(subGain).connect(this.growlFilter);
    this.growlFilter.connect(this.growlGain).connect(this.growlPanner).connect(this.sfxBus as GainNode);
    gsrc.start();
    sub.start();

    // Heartbeat bus (non-positional; it is the player's own pulse).
    this.heartGain = ctx.createGain();
    this.heartGain.gain.value = 0.9;
    this.heartGain.connect(this.sfxBus as GainNode);
  }

  private configurePanner(p: PannerNode, maxDistance: number): void {
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 3;
    p.maxDistance = maxDistance;
    p.rolloffFactor = 1.4;
  }

  // ------------------------------------------------------------------ mixing

  setListener(pos: Vec3, forward: Vec3, up: Vec3): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setTargetAtTime(pos.x, t, 0.02);
      l.positionY.setTargetAtTime(pos.y, t, 0.02);
      l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(forward.x, t, 0.02);
      l.forwardY.setTargetAtTime(forward.y, t, 0.02);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02);
      l.upY.setTargetAtTime(up.y, t, 0.02);
      l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      const legacy = l as unknown as {
        setPosition(x: number, y: number, z: number): void;
        setOrientation(fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void;
      };
      legacy.setPosition(pos.x, pos.y, pos.z);
      legacy.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  setDrone(level: number): void {
    if (this.droneGain && this.ctx) {
      this.droneGain.gain.setTargetAtTime(level * 0.5, this.ctx.currentTime, 0.6);
    }
  }

  setHum(level: number, at: Vec3): void {
    if (this.humGain && this.ctx) {
      this.humGain.gain.setTargetAtTime(level * 0.26, this.ctx.currentTime, 0.4);
      this.setPannerPos(this.humPanner, at);
    }
  }

  /** `level` 0..1 and the demon's world position; drives the directional cue. */
  setGrowl(level: number, at: Vec3, agitation: number): void {
    if (!this.ctx || !this.growlGain || !this.growlFilter) return;
    const t = this.ctx.currentTime;
    this.growlGain.gain.setTargetAtTime(level * 0.5, t, 0.15);
    this.growlFilter.frequency.setTargetAtTime(220 + agitation * 520, t, 0.25);
    this.setPannerPos(this.growlPanner, at);
  }

  /** Beats per minute; 0 silences the heartbeat. */
  setHeartbeat(bpm: number): void {
    this.heartRate = bpm;
  }

  private setPannerPos(p: PannerNode | null, at: Vec3): void {
    if (!p || !this.ctx) return;
    const t = this.ctx.currentTime;
    if (p.positionX) {
      p.positionX.setTargetAtTime(at.x, t, 0.05);
      p.positionY.setTargetAtTime(at.y, t, 0.05);
      p.positionZ.setTargetAtTime(at.z, t, 0.05);
    } else {
      (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(at.x, at.y, at.z);
    }
  }

  update(dt: number): void {
    if (!this.ctx || this.heartRate <= 0) {
      this.heartTimer = 0;
      return;
    }
    this.heartTimer -= dt;
    if (this.heartTimer <= 0) {
      this.heartTimer = 60 / this.heartRate;
      this.thump(0.0, 0.5);
      this.thump(0.17, 0.3);
    }
  }

  private thump(delay: number, amp: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.heartGain) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.2);
    o.connect(g).connect(this.heartGain);
    o.start(t);
    o.stop(t + 0.25);
  }

  // ------------------------------------------------------------------- shots

  /** Fire a one-shot. `at` makes it positional; omit for a UI / first-person sound. */
  play(name: SfxName, at?: Vec3, gain = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;
    // While the context is suspended `currentTime` does not advance, so every
    // scheduled node would pile up on the same instant. Drop the sound instead.
    if (ctx.state !== 'running' || this.muted) return;
    let dest: AudioNode = this.sfxBus;
    if (at) {
      const p = ctx.createPanner();
      this.configurePanner(p, 120);
      this.setPannerPos(p, at);
      p.connect(this.sfxBus);
      dest = p;
    }
    const t = ctx.currentTime;
    switch (name) {
      case 'step_concrete':
        this.noiseBurst(dest, t, 0.075, 900, 2.2, 0.1 * gain, 'lowpass');
        break;
      case 'step_metal':
        this.noiseBurst(dest, t, 0.09, 2600, 3.5, 0.085 * gain, 'bandpass');
        this.tone(dest, t, 'sine', 420, 300, 0.05 * gain, 0.08);
        break;
      case 'step_tile':
        this.noiseBurst(dest, t, 0.055, 1700, 2.0, 0.095 * gain, 'highpass');
        break;
      case 'knock':
        // "something knocked from inside the walls"
        this.tone(dest, t, 'sine', 95, 48, 0.5 * gain, 0.3);
        this.noiseBurst(dest, t, 0.14, 240, 1.4, 0.22 * gain, 'lowpass');
        this.tone(dest, t + 0.19, 'sine', 88, 44, 0.36 * gain, 0.26);
        break;
      case 'relay':
        this.noiseBurst(dest, t, 0.04, 3200, 6, 0.3 * gain, 'bandpass');
        this.tone(dest, t, 'square', 180, 120, 0.1 * gain, 0.05);
        break;
      case 'clunk':
        this.tone(dest, t, 'triangle', 150, 70, 0.3 * gain, 0.16);
        this.noiseBurst(dest, t, 0.1, 600, 1.6, 0.18 * gain, 'lowpass');
        break;
      case 'latch':
        this.noiseBurst(dest, t, 0.06, 1500, 4, 0.3 * gain, 'bandpass');
        this.tone(dest, t + 0.05, 'triangle', 300, 110, 0.22 * gain, 0.2);
        this.tone(dest, t + 0.28, 'sine', 70, 48, 0.3 * gain, 0.4);
        break;
      case 'denied':
        this.tone(dest, t, 'square', 180, 110, 0.18 * gain, 0.18);
        this.tone(dest, t + 0.14, 'square', 120, 80, 0.18 * gain, 0.22);
        break;
      case 'accept':
        this.tone(dest, t, 'square', 520, 520, 0.12 * gain, 0.08);
        this.tone(dest, t + 0.09, 'square', 780, 780, 0.12 * gain, 0.12);
        break;
      case 'beep':
        this.tone(dest, t, 'square', 880, 880, 0.08 * gain, 0.045);
        break;
      case 'switch':
        this.noiseBurst(dest, t, 0.035, 2200, 5, 0.22 * gain, 'bandpass');
        break;
      case 'pickup':
        this.tone(dest, t, 'triangle', 300, 600, 0.14 * gain, 0.16);
        break;
      case 'shimmer':
        for (let i = 0; i < 4; i++) {
          this.tone(dest, t + i * 0.055, 'sine', 1200 + i * 420, 1400 + i * 460, 0.05 * gain, 0.5);
        }
        break;
      case 'gunshot':
        this.noiseBurst(dest, t, 0.22, 2400, 0.9, 0.95 * gain, 'lowpass');
        this.tone(dest, t, 'sawtooth', 160, 42, 0.55 * gain, 0.3);
        this.noiseBurst(dest, t + 0.03, 0.5, 700, 0.7, 0.2 * gain, 'lowpass');
        break;
      case 'dryfire':
        this.noiseBurst(dest, t, 0.035, 2800, 7, 0.26 * gain, 'bandpass');
        this.tone(dest, t + 0.02, 'square', 240, 180, 0.08 * gain, 0.05);
        break;
      case 'roar':
        this.tone(dest, t, 'sawtooth', 120, 48, 0.5 * gain, 1.5);
        this.tone(dest, t + 0.05, 'sawtooth', 84, 36, 0.42 * gain, 1.7);
        this.noiseBurst(dest, t, 1.4, 420, 1.1, 0.4 * gain, 'lowpass');
        break;
      case 'scream':
        this.tone(dest, t, 'sawtooth', 820, 180, 0.3 * gain, 0.9);
        this.noiseBurst(dest, t, 0.8, 1800, 2.2, 0.3 * gain, 'bandpass');
        break;
      case 'hit':
        this.noiseBurst(dest, t, 0.25, 500, 1.2, 0.6 * gain, 'lowpass');
        this.tone(dest, t, 'sawtooth', 220, 60, 0.4 * gain, 0.4);
        break;
      case 'demon_die':
        this.tone(dest, t, 'sawtooth', 180, 24, 0.5 * gain, 2.4);
        this.noiseBurst(dest, t, 2.2, 600, 0.9, 0.35 * gain, 'lowpass');
        this.tone(dest, t + 0.3, 'sine', 60, 20, 0.4 * gain, 2.0);
        break;
      case 'rumble':
        this.tone(dest, t, 'sine', 46, 28, 0.5 * gain, 2.6);
        this.noiseBurst(dest, t, 2.4, 160, 1.0, 0.25 * gain, 'lowpass');
        break;
      case 'drip':
        this.tone(dest, t, 'sine', 1500, 700, 0.1 * gain, 0.09);
        break;
      case 'rat':
        this.noiseBurst(dest, t, 0.12, 4200, 5, 0.1 * gain, 'highpass');
        break;
      case 'flare_fire':
        // A hollow thump and a hiss, not a gunshot.
        this.tone(dest, t, 'square', 320, 90, 0.4 * gain, 0.12);
        this.noiseBurst(dest, t, 0.1, 1800, 1.4, 0.5 * gain, 'lowpass');
        this.noiseBurst(dest, t + 0.05, 1.1, 3200, 0.8, 0.16 * gain, 'highpass');
        break;
      case 'demon_ignite':
        // Ignition, then something large going away at speed.
        this.noiseBurst(dest, t, 0.35, 900, 0.9, 0.7 * gain, 'lowpass');
        this.noiseBurst(dest, t + 0.1, 2.2, 2600, 0.7, 0.3 * gain, 'highpass');
        this.tone(dest, t, 'sawtooth', 240, 40, 0.5 * gain, 1.6);
        this.tone(dest, t + 0.4, 'sawtooth', 120, 28, 0.3 * gain, 1.8);
        break;
      case 'ritual':
        // Low swell, a struck bell, and the floor taking something back.
        this.tone(dest, t, 'sine', 48, 36, 0.5 * gain, 2.8);
        for (let i = 0; i < 5; i++) {
          this.tone(dest, t + 0.1 + i * 0.13, 'sine', 660 + i * 180, 620 + i * 160, 0.12 * gain, 1.4);
        }
        this.noiseBurst(dest, t + 0.5, 2.4, 300, 1.0, 0.3 * gain, 'lowpass');
        this.tone(dest, t + 1.1, 'sawtooth', 90, 20, 0.4 * gain, 2.2);
        break;
      case 'draught':
        // Air pulling through a gap in masonry. The only cue that the false
        // wall is a wall with somewhere behind it.
        this.noiseBurst(dest, t, 1.6, 1100, 1.1, 0.085 * gain, 'bandpass');
        this.noiseBurst(dest, t + 0.25, 1.3, 2600, 0.9, 0.05 * gain, 'highpass');
        break;
    }
  }

  private noiseBurst(
    dest: AudioNode,
    t: number,
    dur: number,
    freq: number,
    q: number,
    amp: number,
    type: BiquadFilterType,
  ): void {
    const ctx = this.ctx as AudioContext;
    const src = ctx.createBufferSource();
    src.buffer = this.noise as AudioBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + Math.min(0.01, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  private tone(
    dest: AudioNode,
    t: number,
    type: OscillatorType,
    f0: number,
    f1: number,
    amp: number,
    dur: number,
  ): void {
    const ctx = this.ctx as AudioContext;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(8, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + Math.min(0.015, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}
