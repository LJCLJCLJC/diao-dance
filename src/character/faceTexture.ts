import * as THREE from 'three';
import { DEFAULT_FACE_LAYOUT, FaceLayout } from './faceLayout';
import { fbm, scalarMap } from './textures';

export interface FaceAssets {
  layout: FaceLayout;
  closed: THREE.Texture | null;
  open: THREE.Texture | null;
}

export async function loadFaceAssets(base = './tex/'): Promise<FaceAssets> {
  let layout = DEFAULT_FACE_LAYOUT;
  try {
    const res = await fetch(`${base}face_layout.json`);
    if (res.ok) layout = { ...DEFAULT_FACE_LAYOUT, ...(await res.json()) };
  } catch {
    /* fall back to the canonical layout */
  }
  const loader = new THREE.TextureLoader();
  const load = (name: string) =>
    loader.loadAsync(`${base}${name}`).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return t;
    }).catch(() => null);
  const [closed, open] = await Promise.all([load('face_closed.webp'), load('face_open.webp')]);
  return { layout, closed, open };
}

export interface FaceMaterial {
  material: THREE.MeshStandardMaterial;
  /** 0 = closed-mouth photo, 1 = open-mouth photo */
  setOpen(v: number): void;
}

/**
 * Skin-toned standard material whose map slot carries the closed-mouth face and whose extra
 * uniform carries the open-mouth face. Photo alpha (face oval) x aFront (front-facing bind
 * normal) decides where the photo replaces the base skin.
 */
export function createFaceMaterial(assets: FaceAssets): FaceMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: assets.layout.skinTone,
    roughnessMap: scalarMap(256, fbm(256, 151, 40, 3), 0.48, 0.06, [3, 3]),
    roughness: 1,
    vertexColors: true,
    map: assets.closed ?? undefined,
  });
  const uniforms = {
    uFaceOpenMap: { value: assets.open ?? assets.closed },
    uFaceOpen: { value: 0 },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFront;\nvarying float vFront;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFront = aFront;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uFaceOpenMap;\nuniform float uFaceOpen;\nvarying float vFront;')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 faceC = texture2D( map, vMapUv );
          vec4 faceO = texture2D( uFaceOpenMap, vMapUv );
          vec4 face = mix( faceC, faceO, uFaceOpen );
          diffuseColor.rgb = mix( diffuseColor.rgb, face.rgb, face.a * vFront );
        #endif`,
      );
  };
  material.customProgramCacheKey = () => 'diao-face-v1';
  return {
    material,
    setOpen(v: number) {
      uniforms.uFaceOpen.value = THREE.MathUtils.clamp(v, 0, 1);
    },
  };
}
