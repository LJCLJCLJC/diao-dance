import * as THREE from 'three';
import {
  denimAlbedo, fbm, hairAlbedo, leatherAlbedo, normalMap, scalarMap, shirtAlbedo, skinAlbedo, twillHeight, weaveHeight,
} from './textures';

/** White-balanced palette (sneakers as the neutral reference), see .img2threejs/evidence/palette.json. */
export const PALETTE = {
  skin: '#e3bfb3',
  shirt: '#d8cfe4',
  denim: '#93a7c4',
  hair: '#16120f',
  sneaker: '#f1ece6',
  rubber: '#ece8e1',
  frame: '#1a1718',
  phone: '#141518',
};

export interface CharacterMaterials {
  skin: THREE.MeshStandardMaterial;
  shirt: THREE.MeshStandardMaterial;
  denim: THREE.MeshStandardMaterial;
  hair: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  button: THREE.MeshStandardMaterial;
  frame: THREE.MeshStandardMaterial;
  lens: THREE.MeshStandardMaterial;
  phone: THREE.MeshStandardMaterial;
  phoneScreen: THREE.MeshStandardMaterial;
}

export function createMaterials(skinTone = PALETTE.skin): CharacterMaterials {
  const weave = weaveHeight(256);
  const twill = twillHeight(256);

  const shirt = new THREE.MeshStandardMaterial({
    map: shirtAlbedo(),
    normalMap: normalMap(256, weave, 2.2, [10, 7]),
    normalScale: new THREE.Vector2(0.12, 0.12),
    roughnessMap: scalarMap(256, fbm(256, 101, 24, 3), 0.86, 0.08, [6, 4]),
    roughness: 1,
    vertexColors: true,
    side: THREE.DoubleSide,
  });

  const denim = new THREE.MeshStandardMaterial({
    map: denimAlbedo(),
    normalMap: normalMap(256, twill, 2.5, [8, 12]),
    normalScale: new THREE.Vector2(0.45, 0.45),
    roughnessMap: scalarMap(256, fbm(256, 111, 20, 3), 0.9, 0.06, [4, 6]),
    roughness: 1,
    vertexColors: true,
    side: THREE.DoubleSide,
  });

  const skin = new THREE.MeshStandardMaterial({
    map: skinAlbedo(skinTone),
    roughnessMap: scalarMap(256, fbm(256, 121, 40, 3), 0.5, 0.08, [2, 2]),
    roughness: 1,
    vertexColors: true,
  });

  const hair = new THREE.MeshStandardMaterial({
    map: hairAlbedo(),
    roughnessMap: scalarMap(256, fbm(256, 131, 24, 3, [1, 0.08]), 0.62, 0.15, [3, 1]),
    roughness: 1,
    vertexColors: true,
  });

  const leather = new THREE.MeshStandardMaterial({
    map: leatherAlbedo(),
    roughnessMap: scalarMap(256, fbm(256, 141, 40, 3), 0.55, 0.1, [2, 2]),
    roughness: 1,
    vertexColors: true,
  });

  const rubber = new THREE.MeshStandardMaterial({ color: PALETTE.rubber, roughness: 0.8 });
  const button = new THREE.MeshStandardMaterial({ color: '#efeae6', roughness: 0.35 });
  const frame = new THREE.MeshStandardMaterial({ color: PALETTE.frame, roughness: 0.35, metalness: 0.3 });
  const lens = new THREE.MeshStandardMaterial({
    color: '#cfd8e8', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.12, depthWrite: false,
  });
  const phone = new THREE.MeshStandardMaterial({ color: PALETTE.phone, roughness: 0.3, metalness: 0.4 });
  const phoneScreen = new THREE.MeshStandardMaterial({ color: '#08090c', roughness: 0.08, metalness: 0.2 });

  return { skin, shirt, denim, hair, leather, rubber, button, frame, lens, phone, phoneScreen };
}
