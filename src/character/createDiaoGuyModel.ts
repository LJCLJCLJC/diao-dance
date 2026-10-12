import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createMaterials, CharacterMaterials } from './materials';
import { createFaceMaterial, FaceAssets, FaceMaterial } from './faceTexture';
import { bindRigid } from './loft';
import {
  buildButtons, buildCollar, buildJeansLeg, buildNeck, buildShirtTorso, buildShirtTrim, buildSleeve,
} from './garments';
import { buildEar, buildGlasses, buildHair, buildHand, buildHead, buildPhone, buildSneaker } from './parts';
import { BONE_INDEX as B, BoneName, createRig, Rig } from './rig';

const SKINNED_ATTRS = ['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight'] as const;

function mergeSkinned(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((g) => {
    const geo = g.index ? g.toNonIndexed() : g;
    const out = new THREE.BufferGeometry();
    for (const name of SKINNED_ATTRS) {
      let attr = geo.getAttribute(name);
      if (!attr && name === 'color') attr = new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count * 3).fill(1), 3);
      if (!attr && name === 'uv') attr = new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2);
      if (!attr) throw new Error(`mergeSkinned: part is missing ${name}`);
      out.setAttribute(name, attr);
    }
    return out;
  });
  return mergeGeometries(flat, false)!;
}

function rigid(geo: THREE.BufferGeometry, bone: BoneName): THREE.BufferGeometry {
  bindRigid(geo, B[bone]);
  return geo;
}

export interface DiaoGuy {
  root: THREE.Group;
  rig: Rig;
  materials: CharacterMaterials;
  face: FaceMaterial;
  meshes: Record<string, THREE.SkinnedMesh>;
  /** 0..1, drives the closed/open face photo blend and the jaw bone */
  setMouthOpen(v: number): void;
}

export function createDiaoGuyModel(assets: FaceAssets): DiaoGuy {
  const L = assets.layout;
  const rig = createRig();
  const root = new THREE.Group();
  root.name = 'diao-guy';
  root.add(rig.rootBone);
  root.updateMatrixWorld(true);

  const materials = createMaterials(L.skinTone);
  const face = createFaceMaterial(assets);

  const [glassesFrame, lenses] = buildGlasses(L);
  const [upperL, soleL] = buildSneaker('l');
  const [upperR, soleR] = buildSneaker('r');
  const [phoneBody, phoneScreen] = buildPhone();
  for (const g of [phoneBody, phoneScreen]) {
    g.rotateZ(0.08);
    g.rotateY(-Math.PI / 2);
    g.translate(0.228, 0.79, 0.016);
  }

  const groups: Array<[string, THREE.BufferGeometry, THREE.Material]> = [
    ['shirt', mergeSkinned([buildShirtTorso(), buildSleeve('l'), buildSleeve('r'), buildCollar(), buildShirtTrim()]), materials.shirt],
    ['buttons', buildButtons(), materials.button],
    ['jeans', mergeSkinned([buildJeansLeg('l'), buildJeansLeg('r')]), materials.denim],
    ['skin', mergeSkinned([
      buildNeck(),
      rigid(buildEar('l', L), 'head'),
      rigid(buildEar('r', L), 'head'),
      rigid(buildHand('l'), 'hand-l'),
      rigid(buildHand('r'), 'hand-r'),
    ]), materials.skin],
    ['head', buildHead(L), face.material],
    ['hair', rigid(buildHair(L), 'head'), materials.hair],
    ['glasses', rigid(glassesFrame, 'head'), materials.frame],
    ['lenses', rigid(lenses, 'head'), materials.lens],
    ['sneakers', mergeSkinned([rigid(upperL, 'foot-l'), rigid(upperR, 'foot-r')]), materials.leather],
    ['soles', mergeSkinned([rigid(soleL, 'foot-l'), rigid(soleR, 'foot-r')]), materials.rubber],
    ['phone', rigid(phoneBody, 'hand-l'), materials.phone],
    ['phoneScreen', rigid(phoneScreen, 'hand-l'), materials.phoneScreen],
  ];

  const meshes: Record<string, THREE.SkinnedMesh> = {};
  for (const [name, geo, mat] of groups) {
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.name = name;
    mesh.castShadow = name !== 'lenses';
    mesh.receiveShadow = name !== 'lenses';
    mesh.frustumCulled = false;
    root.add(mesh);
    mesh.bind(rig.skeleton, new THREE.Matrix4());
    meshes[name] = mesh;
  }

  const jawRest = rig.bones.jaw.quaternion.clone();
  const jawOpen = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.09);
  const setMouthOpen = (v: number) => {
    face.setOpen(v);
    rig.bones.jaw.quaternion.copy(jawRest).slerp(jawOpen, THREE.MathUtils.clamp(v, 0, 1));
  };

  root.userData.sculptRuntime = {
    spec: 'character-sculpt-spec.json',
    skeleton: rig.skeleton,
    bones: rig.bones,
    meshes,
    parts: Object.keys(meshes),
    sockets: { 'grip-l': 'hand-l' },
    morphChannels: { faceOpen: 'uniform uFaceOpen on head material', jaw: 'bone jaw' },
  };

  return { root, rig, materials, face, meshes, setMouthOpen };
}
