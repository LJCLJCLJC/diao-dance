import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createDiaoGuyModel } from './character/createDiaoGuyModel';
import { loadFaceAssets } from './character/faceTexture';
import { createNightPath } from './scene/nightPath';
import { applyPose, createPose, poseFromDegrees } from './anim/pose';
import { PROBES } from './anim/probes';
import { loadDance } from './anim/dance';
import { HemSprings } from './anim/secondary';
import { DancePlayer, PlayerMode } from './anim/player';
import { Voice } from './audio/voice';

/** Dev-only: the source video is kept out of the repo and the build, Vite serves it from the project root. */
const REFERENCE_VIDEO = './reference/IMG_0562.mp4';

const params = new URLSearchParams(location.search);
const compareMode = params.has('compare');
if (compareMode) document.body.classList.add('compare');

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const highQuality = Math.min(window.devicePixelRatio, 2) * Math.max(innerWidth, innerHeight) > 1400 && !/Mobi/i.test(navigator.userAgent);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 60);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 1.4;
controls.maxDistance = 7;
controls.maxPolarAngle = Math.PI * 0.53;
controls.minAzimuthAngle = -Math.PI * 0.75;
controls.maxAzimuthAngle = Math.PI * 0.75;
controls.target.set(0, 0.86, 0);
/** The curb and hedge start ~1.4 m behind him; keep the orbiting camera in front of them. */
const BACK_LIMIT_Z = -1.25;
function keepOutOfHedge(): void {
  const dz = camera.position.z - controls.target.z;
  if (camera.position.z < BACK_LIMIT_Z && dz < 0) {
    const s = (BACK_LIMIT_Z - controls.target.z) / dz;
    camera.position.sub(controls.target).multiplyScalar(s).add(controls.target);
  }
}
camera.position.set(0.35, 1.3, 3.9);

createNightPath(scene, highQuality);

function resize(): void {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = camera.aspect < 0.6 ? 46 : camera.aspect < 0.8 ? 40 : 30;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

/** Small handheld wobble while dancing, applied around the render so OrbitControls stays in charge. */
function shakeOffset(t: number, amp: number, outPos: THREE.Vector3, outRot: THREE.Euler): void {
  const n = (a: number, b: number, c: number) => Math.sin(t * a + c) * 0.6 + Math.sin(t * b + c * 1.7) * 0.4;
  outPos.set(n(7.1, 12.3, 0.3) * 0.006, n(8.3, 13.7, 1.1) * 0.005, 0).multiplyScalar(amp);
  outRot.set(n(5.3, 11.9, 2.2) * 0.0035 * amp, n(6.1, 10.7, 0.7) * 0.0035 * amp, n(4.7, 9.1, 1.9) * 0.0045 * amp);
}

async function boot(): Promise<void> {
  const voice = new Voice();
  const [assets, dance] = await Promise.all([
    loadFaceAssets(),
    loadDance(),
    voice.load('./audio/diao.m4a').catch((err) => console.warn('voice slice unavailable:', err)),
  ]);
  const guy = createDiaoGuyModel(assets);
  scene.add(guy.root);
  const restHips = guy.rig.bones.hips.position.clone();
  const hem = new HemSprings(guy.rig);
  const player = new DancePlayer(dance, voice);
  const pose = createPose();

  const onceBtn = document.getElementById('btn-once') as HTMLButtonElement;
  const loopBtn = document.getElementById('btn-loop') as HTMLButtonElement;
  const video = document.getElementById('compare-video') as HTMLVideoElement;
  const scrubber = document.getElementById('compare-scrub') as HTMLInputElement;
  const scrubLabel = document.getElementById('compare-time') as HTMLElement;
  let scrubTime: number | null = null;

  player.onModeChange = (mode: PlayerMode) => {
    const looping = mode === 'loop';
    loopBtn.setAttribute('aria-pressed', String(looping));
    loopBtn.textContent = looping ? '别刁了' : '一直刁';
    if (compareMode && mode === 'idle') video.pause();
  };

  const unlock = () => voice.unlock().catch((err) => console.warn('audio unlock failed:', err));
  onceBtn.addEventListener('click', async () => {
    await unlock();
    scrubTime = null;
    player.playOnce();
  });
  loopBtn.addEventListener('click', async () => {
    await unlock();
    scrubTime = null;
    if (player.mode === 'loop') player.stop();
    else player.startLoop();
  });
  setInterval(() => player.tick(), 250);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && player.mode === 'loop') player.stop();
    if (!document.hidden) hem.reset();
  });

  if (compareMode) {
    document.getElementById('compare')!.hidden = false;
    video.preload = 'auto';
    video.src = REFERENCE_VIDEO;
    scrubber.max = String(dance.duration);
    scrubber.addEventListener('input', () => {
      player.stop();
      scrubTime = Number(scrubber.value);
      video.pause();
      video.currentTime = scrubTime;
    });
    camera.position.set(0.25, 1.35, 3.6);
    controls.target.set(0, 0.85, 0);
    resize();
  }

  const clock = new THREE.Clock();
  const shakePos = new THREE.Vector3();
  const shakeRot = new THREE.Euler();
  const savedPos = new THREE.Vector3();
  const savedQuat = new THREE.Quaternion();
  let idleTime = 0;
  let shakeAmp = 0;

  function step(dt: number): void {
    idleTime += dt;
    if (scrubTime !== null && player.mode === 'idle') dance.sample(scrubTime, pose);
    else player.update(idleTime, pose);
    applyPose(guy.rig, pose, restHips);
    hem.update(dt);
    const mouth = scrubTime !== null && player.mode === 'idle'
      ? voice.levelAt(scrubTime - player.voiceOffset)
      : player.mouthOpen(dt);
    guy.setMouthOpen(mouth);
  }

  function render(dt: number): void {
    shakeAmp += ((player.mode === 'idle' ? 0 : 1) - shakeAmp) * Math.min(1, dt * 3);
    controls.update();
    keepOutOfHedge();
    if (shakeAmp > 0.01) {
      savedPos.copy(camera.position);
      savedQuat.copy(camera.quaternion);
      shakeOffset(idleTime, shakeAmp, shakePos, shakeRot);
      camera.position.add(shakePos.applyQuaternion(camera.quaternion));
      camera.quaternion.multiply(new THREE.Quaternion().setFromEuler(shakeRot));
      renderer.render(scene, camera);
      camera.position.copy(savedPos);
      camera.quaternion.copy(savedQuat);
    } else {
      renderer.render(scene, camera);
    }
  }

  function syncCompare(): void {
    const t = player.roundTime();
    if (t !== null && t < dance.duration) {
      if (video.paused) video.play().catch(() => {});
      if (Math.abs(video.currentTime - t) > 0.06) video.currentTime = t;
    } else if (!video.paused) {
      video.pause();
    }
    const shown = scrubTime ?? t;
    if (shown !== null) {
      scrubLabel.textContent = `${shown.toFixed(2)} s`;
      if (t !== null) scrubber.value = String(Math.min(t, dance.duration));
    }
  }

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    step(dt);
    render(dt);
    if (compareMode) syncCompare();
  });

  document.getElementById('loading')!.classList.add('done');
  document.getElementById('ui')!.hidden = false;

  (window as unknown as Record<string, unknown>).__DIAO__ = {
    THREE, scene, camera, controls, renderer, guy, player, voice, dance, hem,
    setView(pos: [number, number, number], target: [number, number, number], fov?: number) {
      controls.minDistance = 0.2;
      camera.position.set(...pos);
      controls.target.set(...target);
      if (fov) camera.fov = fov;
      camera.updateProjectionMatrix();
      controls.update();
      renderer.render(scene, camera);
    },
    render() {
      renderer.render(scene, camera);
    },
    probe(name: string) {
      const p = PROBES[name];
      applyPose(guy.rig, poseFromDegrees(p.bones, p.hips), restHips);
      guy.root.updateMatrixWorld(true);
      renderer.render(scene, camera);
    },
    /** Freeze on dance time `t`, letting the hem springs settle over the preceding 0.6 s. */
    seek(t: number) {
      player.stop();
      hem.reset();
      for (let tt = Math.max(0, t - 0.6); tt <= t + 1e-6; tt += 1 / 60) {
        scrubTime = tt;
        dance.sample(tt, pose);
        applyPose(guy.rig, pose, restHips);
        hem.update(1 / 60);
      }
      scrubTime = t;
      guy.setMouthOpen(voice.levelAt(t - player.voiceOffset));
      renderer.render(scene, camera);
    },
    release() {
      scrubTime = null;
    },
    /** Renders one frame and returns it as a data URL (works while the tab is in the background). */
    snap(type = 'image/jpeg', quality = 0.9): string {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL(type, quality);
    },
  };
}

boot();
