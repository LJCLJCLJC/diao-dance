import { Voice } from '../audio/voice';
import { Dance } from './dance';
import { sampleIdle } from './idle';
import { blendPose, copyPose, createPose, Pose } from './pose';

export type PlayerMode = 'idle' | 'single' | 'loop';

/** Seconds into a round when "叼你妈的" fires: 2.66 is the same moment as in the video, 0 = shout on click. */
export const VOICE_AT = 2.66;

/** Restart blend when a button interrupts a running dance. */
const RESTART_BLEND = 0.2;
/** Dance end (or "别刁了") back to the idle stance. */
const TO_IDLE_BLEND = 0.4;
/** In loop mode, end pose of round k -> start of round k+1. */
const LOOP_BLEND = 0.25;
/** Voices for upcoming loop rounds are queued this far ahead on the audio clock. */
const SCHEDULE_AHEAD = 1.5;

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/**
 * Three-state dance player (idle / single "刁一次" / loop "一直刁"). All dance timing reads
 * `voice.now()`, so the pose and the scheduled voice share one clock and cannot drift apart.
 */
export class DancePlayer {
  mode: PlayerMode = 'idle';
  onModeChange: ((mode: PlayerMode) => void) | null = null;
  voiceOffset = VOICE_AT;

  private origin = 0;
  private queuedRound = -1;
  private from = createPose();
  private fromStart = 0;
  private fromDur = 0;
  private target = createPose();
  private endPose = createPose();
  private last = createPose();
  private hasLast = false;
  private mouth = 0;

  constructor(private dance: Dance, private voice: Voice) {
    dance.sample(dance.duration, this.endPose);
  }

  get duration(): number {
    return this.dance.duration;
  }

  /** Current position inside the running round (null while idle). */
  roundTime(now = this.voice.now()): number | null {
    if (this.mode === 'idle') return null;
    const el = now - this.origin;
    return this.mode === 'loop' ? el - Math.floor(el / this.dance.duration) * this.dance.duration : el;
  }

  playOnce(): void {
    const now = this.voice.now();
    this.voice.stopAll();
    this.blendFromLast(now, RESTART_BLEND);
    this.origin = now;
    this.voice.play(now + this.voiceOffset);
    this.setMode('single');
  }

  startLoop(): void {
    const now = this.voice.now();
    this.voice.stopAll();
    this.blendFromLast(now, RESTART_BLEND);
    this.origin = now;
    this.queuedRound = -1;
    this.setMode('loop');
    this.queueVoices(now);
  }

  stop(): void {
    if (this.mode === 'idle') return;
    const now = this.voice.now();
    this.voice.stopAll();
    this.blendFromLast(now, TO_IDLE_BLEND);
    this.setMode('idle');
  }

  /** Writes this frame's pose into `out`; `idleTime` is a free-running clock for breathing. */
  update(idleTime: number, out: Pose): Pose {
    const now = this.voice.now();
    const D = this.dance.duration;

    if (this.mode === 'single' && now - this.origin >= D) {
      this.blendFromLast(now, TO_IDLE_BLEND);
      this.setMode('idle');
    }

    if (this.mode === 'idle') {
      sampleIdle(idleTime, this.target);
    } else if (this.mode === 'single') {
      this.dance.sample(now - this.origin, this.target);
    } else {
      this.queueVoices(now);
      const el = Math.max(0, now - this.origin);
      const k = Math.floor(el / D);
      const t = el - k * D;
      this.dance.sample(t, this.target);
      if (k > 0 && t < LOOP_BLEND) blendPose(this.target, this.endPose, this.target, smooth(t / LOOP_BLEND));
    }

    const w = this.fromDur > 0 ? (now - this.fromStart) / this.fromDur : 1;
    if (w < 1) blendPose(out, this.from, this.target, smooth(w));
    else copyPose(out, this.target);
    copyPose(this.last, out);
    this.hasLast = true;
    return out;
  }

  /** Keeps loop voices queued even when rendering is throttled; call from a timer as well as per frame. */
  tick(): void {
    if (this.mode === 'loop') this.queueVoices(this.voice.now());
  }

  /** 0..1 jaw/face blend driven by the audible voice, with a fast attack and softer release. */
  mouthOpen(dt: number): number {
    const lv = this.voice.level(this.voice.now());
    const rate = lv > this.mouth ? 40 : 14;
    this.mouth += (lv - this.mouth) * Math.min(1, dt * rate);
    return this.mouth;
  }

  private queueVoices(now: number): void {
    const D = this.dance.duration;
    for (;;) {
      const k = this.queuedRound + 1;
      const at = this.origin + k * D + this.voiceOffset;
      if (at - now > SCHEDULE_AHEAD) break;
      if (at > now) this.voice.play(at);
      this.queuedRound = k;
    }
  }

  private blendFromLast(now: number, dur: number): void {
    if (!this.hasLast) return;
    copyPose(this.from, this.last);
    this.fromStart = now;
    this.fromDur = dur;
  }

  private setMode(mode: PlayerMode): void {
    if (this.mode === mode && mode !== 'single') return;
    this.mode = mode;
    this.onModeChange?.(mode);
  }
}
