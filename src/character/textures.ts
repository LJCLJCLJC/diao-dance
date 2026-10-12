import * as THREE from 'three';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value-noise fBm sampled on a size x size grid, values in [0, 1]. */
export function fbm(size: number, seed: number, baseCells: number, octaves: number, stretch: [number, number] = [1, 1]): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cx = Math.max(1, Math.round(baseCells * stretch[0] * 2 ** o));
    const cy = Math.max(1, Math.round(baseCells * stretch[1] * 2 ** o));
    const rnd = mulberry32(seed * 7919 + o * 104729);
    const lattice = new Float32Array(cx * cy);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rnd();
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * cy;
      const y0 = Math.floor(gy);
      const ty = gy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % cy) * cx;
      const r1 = ((y0 + 1) % cy) * cx;
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * cx;
        const x0 = Math.floor(gx);
        const tx = gx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % cx;
        const c1 = (x0 + 1) % cx;
        const top = lattice[r0 + c0] + (lattice[r0 + c1] - lattice[r0 + c0]) * sx;
        const bot = lattice[r1 + c0] + (lattice[r1 + c1] - lattice[r1 + c0]) * sx;
        out[y * size + x] += (top + (bot - top) * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function hexRgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r * 255, c.g * 255, c.b * 255];
}

function canvasTexture(size: number, paint: (img: ImageData) => void, srgb: boolean, repeat: [number, number] = [1, 1]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  paint(img);
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 8;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return tex;
}

/** Greyscale map (roughness etc.): base +/- variation * noise. */
export function scalarMap(size: number, field: Float32Array, base: number, variation: number, repeat: [number, number] = [1, 1]): THREE.CanvasTexture {
  return canvasTexture(size, (img) => {
    for (let i = 0; i < field.length; i++) {
      const v = THREE.MathUtils.clamp(base + (field[i] - 0.5) * 2 * variation, 0, 1) * 255;
      img.data.set([v, v, v, 255], i * 4);
    }
  }, false, repeat);
}

/** Tangent-space normal map from a height field (Sobel). */
export function normalMap(size: number, height: Float32Array, strength: number, repeat: [number, number] = [1, 1]): THREE.CanvasTexture {
  return canvasTexture(size, (img) => {
    const h = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x - 1, y) - h(x - 1, y + 1)) * strength;
        const dy = (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x, y - 1) - h(x + 1, y - 1)) * strength;
        const len = Math.hypot(dx, dy, 1);
        img.data.set([((-dx / len) * 0.5 + 0.5) * 255, ((dy / len) * 0.5 + 0.5) * 255, (1 / len) * 255, 255], (y * size + x) * 4);
      }
    }
  }, false, repeat);
}

/** Light lavender cotton with alternating blue-violet / pink pinstripes running along v. */
export function shirtAlbedo(size = 512): THREE.CanvasTexture {
  const base = hexRgb('#d8cfe4');
  const stripeA = hexRgb('#8f86bf');
  const stripeB = hexRgb('#c79bb0');
  const fuzz = fbm(size, 11, 6, 4);
  const pitch = size / 16;
  return canvasTexture(size, (img) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const k = x % pitch;
        const stripe = Math.floor(x / pitch) % 2 === 0 ? stripeA : stripeB;
        const s = k < 1.2 ? 0.42 : k < 2.2 ? 0.15 : 0;
        const n = (fuzz[i] - 0.5) * 10;
        img.data.set([
          base[0] + (stripe[0] - base[0]) * s + n,
          base[1] + (stripe[1] - base[1]) * s + n,
          base[2] + (stripe[2] - base[2]) * s + n,
          255,
        ], i * 4);
      }
    }
  }, true, [9, 6]);
}

/** Plain weave height (rows + columns) for the shirt's normal/roughness maps. */
export function weaveHeight(size = 256): Float32Array {
  const h = new Float32Array(size * size);
  const noise = fbm(size, 23, 24, 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = Math.sin((x / size) * Math.PI * 2 * 32) * Math.sin((y / size) * Math.PI * 2 * 32);
      h[y * size + x] = 0.5 + 0.15 * a + (noise[y * size + x] - 0.5) * 0.6;
    }
  }
  return h;
}

/** Light-blue denim: diagonal twill lines, speckle, and broad fading. */
export function denimAlbedo(size = 512): THREE.CanvasTexture {
  const base = hexRgb('#93a7c4');
  const dark = hexRgb('#62759a');
  const light = hexRgb('#c2cfe2');
  const fade = fbm(size, 31, 3, 3);
  const speck = fbm(size, 37, 64, 2);
  return canvasTexture(size, (img) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const tw = ((x + y) % 6) / 6;
        const twill = tw < 0.5 ? 1 : 0;
        const f = fade[i];
        const mix = (a: number, b: number, t: number) => a + (b - a) * t;
        let r = mix(base[0], light[0], f * 0.55);
        let g = mix(base[1], light[1], f * 0.55);
        let b = mix(base[2], light[2], f * 0.55);
        const d = twill * 0.12 + (speck[i] - 0.5) * 0.25;
        r = mix(r, dark[0], d);
        g = mix(g, dark[1], d);
        b = mix(b, dark[2], d);
        img.data.set([r, g, b, 255], i * 4);
      }
    }
  }, true, [4, 6]);
}

export function twillHeight(size = 256): Float32Array {
  const h = new Float32Array(size * size);
  const noise = fbm(size, 41, 32, 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tw = ((x + y) % 4) / 4;
      h[y * size + x] = 0.5 + 0.4 * Math.sin(tw * Math.PI * 2) + (noise[y * size + x] - 0.5) * 0.3;
    }
  }
  return h;
}

/** Subtle skin tone variation (warm/cool blotches + pores). */
export function skinAlbedo(hex: string, size = 256): THREE.CanvasTexture {
  const base = hexRgb(hex);
  const blotch = fbm(size, 51, 4, 3);
  const pores = fbm(size, 53, 48, 2);
  return canvasTexture(size, (img) => {
    for (let i = 0; i < size * size; i++) {
      const b = (blotch[i] - 0.5) * 18;
      const p = (pores[i] - 0.5) * 8;
      img.data.set([base[0] + b + p, base[1] + p - b * 0.3, base[2] + p - b * 0.2, 255], i * 4);
    }
  }, true, [2, 2]);
}

/** Hair: streaks stretched along v. */
export function hairAlbedo(size = 256): THREE.CanvasTexture {
  const base = hexRgb('#16120f');
  const hi = hexRgb('#3a2e26');
  const streak = fbm(size, 61, 24, 3, [1, 0.08]);
  return canvasTexture(size, (img) => {
    for (let i = 0; i < size * size; i++) {
      const s = Math.pow(streak[i], 3) * 1.6;
      img.data.set([base[0] + (hi[0] - base[0]) * s, base[1] + (hi[1] - base[1]) * s, base[2] + (hi[2] - base[2]) * s, 255], i * 4);
    }
  }, true, [3, 1]);
}

export function leatherAlbedo(size = 256): THREE.CanvasTexture {
  const base = hexRgb('#f1ece6');
  const grain = fbm(size, 71, 40, 3);
  return canvasTexture(size, (img) => {
    for (let i = 0; i < size * size; i++) {
      const g = (grain[i] - 0.5) * 16;
      img.data.set([base[0] + g, base[1] + g, base[2] + g, 255], i * 4);
    }
  }, true, [2, 2]);
}
