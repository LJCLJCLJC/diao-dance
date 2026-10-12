/**
 * Where the projected face texture sits on the head. Written by tools/build_face_textures.py into
 * public/tex/face_layout.json; the head mesh's UVs are an orthographic front projection of its
 * bind-pose vertices into `rect`, so geometry landmarks and texture landmarks share these numbers.
 */
export interface FaceLayout {
  rect: { x0: number; x1: number; y0: number; y1: number };
  texSize: [number, number];
  eyeX: number;
  eyeY: number;
  browY: number;
  noseTipY: number;
  mouthY: number;
  mouthHalfWidth: number;
  chinY: number;
  skinTone: string;
}

export const DEFAULT_FACE_LAYOUT: FaceLayout = {
  rect: { x0: -0.085, x1: 0.085, y0: 1.455, y1: 1.7 },
  texSize: [512, 738],
  eyeX: 0.032,
  eyeY: 1.585,
  browY: 1.604,
  noseTipY: 1.545,
  mouthY: 1.517,
  mouthHalfWidth: 0.024,
  chinY: 1.478,
  skinTone: '#e3bfb3',
};
