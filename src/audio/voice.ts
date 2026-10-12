const ENV_RATE = 100;

interface Scheduled {
  src: AudioBufferSourceNode;
  gain: GainNode;
  start: number;
}

/**
 * The "叼你妈的" slice on the Web Audio clock. `now()` is the time currently reaching the speakers
 * (AudioContext output timestamp), so animation driven by it lines up with what is heard, and
 * voices scheduled with `play(at)` land exactly on that timeline however many rounds run.
 */
export class Voice {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private envelope: Float32Array = new Float32Array(0);
  private active: Scheduled[] = [];
  private last = 0;

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running' && this.buffer !== null;
  }

  /** Fetch + decode up front (an offline context needs no user gesture) and build the mouth envelope. */
  async load(url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`voice: HTTP ${res.status}`);
    const data = await res.arrayBuffer();
    const decoder = new OfflineAudioContext(1, 1, 44100);
    this.buffer = await decoder.decodeAudioData(data);
    this.envelope = buildEnvelope(this.buffer);
  }

  /** Must run inside a user gesture the first time (autoplay policy). */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  /** Seconds on the audible timeline (falls back to the page clock before audio is unlocked). */
  now(): number {
    const ctx = this.ctx;
    let t: number;
    if (ctx && ctx.state === 'running') {
      const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
      if (ts && ts.contextTime && ts.performanceTime) {
        t = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
      } else {
        t = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
      }
    } else {
      t = performance.now() / 1000;
    }
    if (t < this.last && this.last - t < 0.05) t = this.last;
    this.last = t;
    return t;
  }

  /** Schedules the slice to be heard at timeline time `at` (see `now`). */
  play(at: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.buffer || ctx.state !== 'running') return;
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    const gain = ctx.createGain();
    src.connect(gain).connect(ctx.destination);
    const startAt = Math.max(at, ctx.currentTime + 0.005);
    const offset = Math.max(0, startAt - at);
    if (offset >= this.buffer.duration) return;
    src.start(startAt, offset);
    const entry: Scheduled = { src, gain, start: at };
    src.onended = () => {
      this.active = this.active.filter((e) => e !== entry);
      gain.disconnect();
    };
    this.active.push(entry);
  }

  /** Stops every scheduled/playing slice with a short fade to avoid clicks. */
  stopAll(fade = 0.025): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const e of this.active) {
      e.gain.gain.cancelScheduledValues(t);
      e.gain.gain.setValueAtTime(e.gain.gain.value, t);
      e.gain.gain.linearRampToValueAtTime(0, t + fade);
      try {
        e.src.stop(t + fade + 0.01);
      } catch {
        /* already stopped */
      }
    }
    this.active = [];
  }

  /** Mouth openness 0..1 for whatever slice is audible at timeline time `at`. */
  level(at: number): number {
    let v = 0;
    for (const e of this.active) {
      const i = Math.floor((at - e.start) * ENV_RATE);
      if (i >= 0 && i < this.envelope.length) v = Math.max(v, this.envelope[i]);
    }
    return v;
  }

  /** Envelope lookup by offset into the slice (used by the compare scrubber, no audio needed). */
  levelAt(offset: number): number {
    const i = Math.floor(offset * ENV_RATE);
    return i >= 0 && i < this.envelope.length ? this.envelope[i] : 0;
  }
}

/** 20 ms RMS at 100 Hz, normalised to the loud syllables and shaped into a 0..1 jaw-open curve. */
function buildEnvelope(buf: AudioBuffer): Float32Array {
  const ch = buf.getChannelData(0);
  const hop = buf.sampleRate / ENV_RATE;
  const win = Math.round(buf.sampleRate * 0.02);
  const n = Math.ceil(buf.length / hop);
  const rms = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = Math.round(i * hop);
    let s = 0;
    let k = 0;
    for (let j = Math.max(0, c - win); j < Math.min(ch.length, c + win); j++, k++) s += ch[j] * ch[j];
    rms[i] = Math.sqrt(s / Math.max(1, k));
  }
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const ref = sorted[Math.floor(sorted.length * 0.95)] || 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = Math.min(1, rms[i] / ref);
    const t = Math.min(1, Math.max(0, (x - 0.1) / 0.55));
    out[i] = t * t * (3 - 2 * t);
  }
  return out;
}
