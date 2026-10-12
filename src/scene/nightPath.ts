import * as THREE from 'three';
import { fbm, normalMap, scalarMap } from '../character/textures';

function asphaltTexture(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const broad = fbm(size, 201, 4, 3);
  const grit = fbm(size, 203, 96, 2);
  for (let i = 0; i < size * size; i++) {
    const v = 70 + (broad[i] - 0.5) * 26 + (grit[i] - 0.5) * 60 + (grit[i] > 0.78 ? 40 : 0);
    img.data.set([v * 0.98, v, v * 1.02, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,220,160,1)');
  g.addColorStop(0.25, 'rgba(255,180,100,0.55)');
  g.addColorStop(1, 'rgba(255,150,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function leafTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(32, 2);
  ctx.bezierCurveTo(58, 18, 54, 50, 32, 62);
  ctx.bezierCurveTo(10, 50, 6, 18, 32, 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(32, 6);
  ctx.lineTo(32, 58);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Dense privet-like hedge: dark inner masses covered by instanced leaf cards. */
function createHedge(highQuality: boolean): THREE.Group {
  const hedge = new THREE.Group();
  let seed = 9;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const clusters: Array<[THREE.Vector3, number]> = [];
  for (let x = -10; x <= 10; x += 0.55) {
    for (const yBase of [0.45, 1.05, 1.6]) {
      const r = 0.42 + rnd() * 0.2;
      clusters.push([new THREE.Vector3(x + (rnd() - 0.5) * 0.3, yBase + (rnd() - 0.5) * 0.25, -2.25 - rnd() * 0.35 - (yBase > 1.5 ? 0.15 : 0)), r]);
    }
  }
  const core = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: '#16230d', roughness: 1 }),
    clusters.length,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  clusters.forEach(([c, r], i) => {
    m.compose(c, q.identity(), s.setScalar(r * 0.92));
    core.setMatrixAt(i, m);
  });
  hedge.add(core);

  const perCluster = highQuality ? 150 : 95;
  const leaves = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7 }),
    clusters.length * perCluster,
  );
  const color = new THREE.Color();
  const dir = new THREE.Vector3();
  const up = new THREE.Vector3(0, 0, 1);
  let k = 0;
  for (const [c, r] of clusters) {
    for (let i = 0; i < perCluster; i++) {
      dir.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
      if (dir.z < -0.3) dir.z *= -0.5;
      const p = c.clone().addScaledVector(dir, r * (0.85 + rnd() * 0.2));
      q.setFromUnitVectors(up, dir).multiply(new THREE.Quaternion().setFromAxisAngle(up, rnd() * Math.PI * 2));
      const size = 0.085 + rnd() * 0.06;
      m.compose(p, q, s.set(size * 0.6, size, size));
      leaves.setMatrixAt(k, m);
      color.setHSL(0.22 + rnd() * 0.08, 0.45 + rnd() * 0.25, 0.1 + rnd() * 0.16);
      leaves.setColorAt(k, color);
      k++;
    }
  }
  leaves.receiveShadow = true;
  hedge.add(leaves);
  return hedge;
}

export interface NightPath {
  group: THREE.Group;
  key: THREE.DirectionalLight;
}

export function createNightPath(scene: THREE.Scene, highQuality: boolean): NightPath {
  const group = new THREE.Group();
  group.name = 'night-path';
  scene.background = new THREE.Color('#07080b');
  scene.fog = new THREE.FogExp2('#0a0b0e', 0.075);

  const grit = fbm(256, 205, 48, 3);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({
      map: asphaltTexture(),
      roughnessMap: scalarMap(256, grit, 0.92, 0.06, [40, 40]),
      normalMap: normalMap(256, grit, 1.5, [40, 40]),
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughness: 1,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const curbMat = new THREE.MeshStandardMaterial({ color: '#8b8a80', roughness: 0.85 });
  const curb = new THREE.Mesh(new THREE.BoxGeometry(24, 0.14, 0.24), curbMat);
  curb.position.set(0, 0.07, -1.55);
  curb.castShadow = curb.receiveShadow = true;
  group.add(curb);
  const soil = new THREE.Mesh(new THREE.BoxGeometry(24, 0.12, 1.6), new THREE.MeshStandardMaterial({ color: '#1d1610', roughness: 1 }));
  soil.position.set(0, 0.06, -2.45);
  group.add(soil);

  group.add(createHedge(highQuality));

  const glow = glowTexture();
  const bulbMat = new THREE.MeshBasicMaterial({ color: '#ffd7a0' });
  const bulbGeo = new THREE.SphereGeometry(0.035, 8, 6);
  for (let i = 0; i < 18; i++) {
    const t = i / 17;
    const x = -6 + t * 12;
    const y = 2.55 - Math.sin(t * Math.PI * 3) ** 2 * 0.25;
    const z = -3.6;
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.set(x, y, z);
    group.add(bulb);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    sprite.position.copy(bulb.position);
    sprite.scale.setScalar(0.55);
    group.add(sprite);
  }

  // Warm street light, but only mildly amber: the phone's white balance renders his shirt near-white.
  const key = new THREE.DirectionalLight('#ffdcbc', 3.2);
  key.position.set(1.8, 4.2, 3.2);
  key.target.position.set(0, 0.9, 0);
  key.castShadow = true;
  key.shadow.mapSize.setScalar(highQuality ? 2048 : 1024);
  key.shadow.camera.left = -2;
  key.shadow.camera.right = 2;
  key.shadow.camera.top = 2.5;
  key.shadow.camera.bottom = -1;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 12;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 3;
  group.add(key, key.target);

  group.add(new THREE.HemisphereLight('#56627c', '#463626', 0.95));
  const front = new THREE.SpotLight('#ffeedd', 9, 9, 0.5, 0.8, 1.2);
  front.position.set(-0.4, 1.7, 3.6);
  front.target.position.set(0, 0.95, 0);
  group.add(front, front.target);
  const rim = new THREE.PointLight('#ffcf8a', 6, 0, 2);
  rim.position.set(-1.2, 2.3, -2.2);
  group.add(rim);

  scene.add(group);
  return { group, key };
}
