import * as THREE from 'three';
import { PALETTE } from '../palette.ts';

/** Faceted toy look: low-segment primitives, flat shading and a hand-cut wobble. */
export class Kit {
  private owned: { dispose(): void }[] = [];

  own<T extends { dispose(): void }>(item: T): T {
    this.owned.push(item);
    return item;
  }

  toy(
    color: THREE.ColorRepresentation,
    options: THREE.MeshStandardMaterialParameters = {},
  ) {
    return this.own(
      new THREE.MeshStandardMaterial({
        color,
        flatShading: true,
        roughness: 0.78,
        metalness: 0,
        ...options,
      }),
    );
  }

  glossy(
    color: THREE.ColorRepresentation,
    options: THREE.MeshStandardMaterialParameters = {},
  ) {
    return this.own(
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.18,
        metalness: 0.05,
        ...options,
      }),
    );
  }

  glow(color: THREE.ColorRepresentation, opacity = 1) {
    return this.own(
      new THREE.MeshBasicMaterial({
        color,
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity >= 1,
      }),
    );
  }

  geometry<T extends THREE.BufferGeometry>(
    geometry: T,
    wobble = 0,
    seed = 1,
  ): T {
    if (wobble) jitter(geometry, wobble, seed);
    geometry.computeVertexNormals();
    return this.own(geometry);
  }

  dispose() {
    for (const item of this.owned.splice(0)) item.dispose();
  }
}

/** Moves each vertex by a small seeded offset; seam duplicates move together. */
export function jitter(
  geometry: THREE.BufferGeometry,
  amount: number,
  seed: number,
) {
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      y = position.getY(i),
      z = position.getZ(i);
    const key =
      (Math.round(x * 1000) * 73856093) ^
      (Math.round(y * 1000) * 19349663) ^
      (Math.round(z * 1000) * 83492791) ^
      seed;
    position.setXYZ(
      i,
      x + (hash(key) - 0.5) * amount,
      y + (hash(key + 1) - 0.5) * amount,
      z + (hash(key + 2) - 0.5) * amount,
    );
  }
  position.needsUpdate = true;
}

export function hash(seed: number) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

const mesh = (
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  shadows = true,
) => {
  const item = new THREE.Mesh(geometry, material);
  item.castShadow = shadows;
  item.receiveShadow = shadows;
  return item;
};

/** A rounded-square outline, sampled coarsely so its edge reads as cut facets. */
export function squircle(
  halfWidth: number,
  halfDepth: number,
  points = 36,
  power = 4,
) {
  const shape = new THREE.Shape();
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2,
      c = Math.cos(a),
      s = Math.sin(a);
    const x = Math.sign(c) * Math.abs(c) ** (2 / power) * halfWidth,
      y = Math.sign(s) * Math.abs(s) ** (2 / power) * halfDepth;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

/** Extrudes a flat outline downward from y = 0, lying in the ground plane. */
export function slab(shape: THREE.Shape, depth: number, bevel = 0) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 1,
    curveSegments: 1,
  });
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

export interface MoleRig {
  root: THREE.Group;
  /** Squash and stretch pivot at the hole. */
  body: THREE.Group;
  head: THREE.Group;
  fur: THREE.Mesh[];
  belly: THREE.Mesh[];
  eyes: THREE.Group[];
  dizzy: THREE.Group[];
  brows: THREE.Group;
  crown: THREE.Group;
  bomb: THREE.Group;
  spark: THREE.Mesh;
  paws: THREE.Group;
  stars: THREE.Group;
}

export interface MoleLook {
  fur: THREE.Material;
  belly: THREE.Material;
}

/** Shared mole parts for every hole; each rig switches look by kind. */
export class MoleKit {
  readonly looks: Record<'normal' | 'golden' | 'bomb' | 'soot', MoleLook>;
  private readonly g;
  private readonly m;

  constructor(private readonly kit: Kit) {
    this.looks = {
      normal: { fur: kit.toy('#9c6b46'), belly: kit.toy('#f3d3a6') },
      golden: {
        fur: kit.toy(PALETTE.gold, {
          metalness: 0.65,
          roughness: 0.32,
          emissive: '#5a3a00',
          emissiveIntensity: 0.25,
        }),
        belly: kit.toy('#fff1b8', { metalness: 0.3, roughness: 0.4 }),
      },
      bomb: { fur: kit.toy('#6d5c9a'), belly: kit.toy('#c2b6e6') },
      soot: { fur: kit.toy('#3a3440'), belly: kit.toy('#5b5462') },
    };
    this.g = {
      body: kit.geometry(
        new THREE.CylinderGeometry(0.72, 0.8, 2.4, 9, 2),
        0.05,
        3,
      ),
      head: kit.geometry(new THREE.SphereGeometry(0.76, 9, 7), 0.06, 5),
      belly: kit.geometry(new THREE.SphereGeometry(0.5, 8, 6), 0.03, 7),
      snout: kit.geometry(new THREE.SphereGeometry(0.3, 7, 5), 0.02, 9),
      nose: kit.geometry(new THREE.SphereGeometry(0.12, 10, 8)),
      eye: kit.geometry(new THREE.SphereGeometry(0.13, 12, 10)),
      shine: kit.geometry(new THREE.SphereGeometry(0.045, 6, 5)),
      tooth: kit.geometry(new THREE.BoxGeometry(0.1, 0.13, 0.05)),
      ear: kit.geometry(new THREE.SphereGeometry(0.19, 6, 5), 0.02, 11),
      cheek: kit.geometry(new THREE.CircleGeometry(0.11, 10)),
      paw: kit.geometry(new THREE.SphereGeometry(0.2, 6, 5), 0.02, 13),
      bar: kit.geometry(new THREE.BoxGeometry(0.26, 0.055, 0.055)),
      brow: kit.geometry(new THREE.BoxGeometry(0.3, 0.075, 0.07)),
      crownBand: kit.geometry(
        new THREE.CylinderGeometry(0.4, 0.44, 0.24, 8, 1, true),
      ),
      crownSpike: kit.geometry(new THREE.ConeGeometry(0.1, 0.26, 4)),
      gem: kit.geometry(new THREE.OctahedronGeometry(0.07)),
      bomb: kit.geometry(new THREE.IcosahedronGeometry(0.52, 1), 0.02, 17),
      fuseCap: kit.geometry(new THREE.CylinderGeometry(0.12, 0.15, 0.16, 6)),
      fuse: kit.geometry(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0.06, 0.16, 0),
            new THREE.Vector3(0.18, 0.26, 0.02),
          ]),
          6,
          0.03,
          5,
        ),
      ),
      spark: kit.geometry(new THREE.IcosahedronGeometry(0.1, 0)),
      star: kit.geometry(starGeometry(0.16, 0.07, 0.06)),
    };
    this.m = {
      eye: kit.glossy('#161321'),
      shine: kit.glow('#ffffff'),
      nose: kit.glossy('#ff7f9b'),
      tooth: kit.toy('#fffaf0'),
      cheek: kit.glow('#ff8fa8', 0.55),
      dark: kit.toy(PALETTE.navy),
      gold: kit.toy('#ffcf3f', {
        metalness: 0.75,
        roughness: 0.28,
        emissive: '#6b4300',
        emissiveIntensity: 0.35,
      }),
      gem: kit.glossy('#e8574f', {
        emissive: '#7a1010',
        emissiveIntensity: 0.4,
      }),
      bomb: kit.glossy('#23212b', { roughness: 0.3 }),
      fuseCap: kit.toy('#8f8a99'),
      fuse: kit.toy('#d9a441'),
      spark: kit.glow('#ffd23f'),
      star: kit.glow('#ffd23f'),
    };
  }

  rig(): MoleRig {
    const { g, m } = this;
    const look = this.looks.normal;
    const root = new THREE.Group(),
      body = new THREE.Group(),
      head = new THREE.Group();
    root.add(body);
    const trunk = mesh(g.body, look.fur);
    trunk.position.y = -0.3;
    body.add(trunk, head);
    head.position.y = 0.95;
    const skull = mesh(g.head, look.fur);
    skull.scale.set(1, 1.1, 0.95);
    const belly = mesh(g.belly, look.belly);
    belly.scale.set(1, 1.25, 0.5);
    belly.position.set(0, -0.4, 0.52);
    const snout = mesh(g.snout, look.belly);
    snout.scale.set(1.2, 0.85, 1);
    snout.position.set(0, -0.07, 0.68);
    const nose = mesh(g.nose, m.nose, false);
    nose.position.set(0, 0.02, 0.95);
    head.add(skull, belly, snout, nose);
    const fur = [trunk, skull],
      bellies = [belly, snout];
    for (const side of [-1, 1]) {
      const ear = mesh(g.ear, look.fur);
      ear.scale.set(1, 1, 0.5);
      ear.position.set(side * 0.55, 0.5, 0.1);
      fur.push(ear);
      const tooth = mesh(g.tooth, m.tooth, false);
      tooth.position.set(side * 0.055, -0.3, 0.86);
      const cheek = new THREE.Mesh(g.cheek, m.cheek);
      cheek.position.set(side * 0.43, 0, 0.68);
      cheek.rotation.y = side * 0.55;
      head.add(ear, tooth, cheek);
    }
    const eyes: THREE.Group[] = [],
      dizzy: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(side * 0.27, 0.2, 0.62);
      const ball = mesh(g.eye, m.eye, false);
      const shine = new THREE.Mesh(g.shine, m.shine);
      shine.position.set(-0.035, 0.05, 0.1);
      eye.add(ball, shine);
      const cross = new THREE.Group();
      cross.position.copy(eye.position);
      cross.position.z += 0.06;
      for (const turn of [-1, 1]) {
        const bar = new THREE.Mesh(g.bar, m.dark);
        bar.rotation.z = (turn * Math.PI) / 4;
        cross.add(bar);
      }
      cross.visible = false;
      head.add(eye, cross);
      eyes.push(eye);
      dizzy.push(cross);
    }
    const brows = new THREE.Group();
    for (const side of [-1, 1]) {
      const brow = new THREE.Mesh(g.brow, m.dark);
      brow.position.set(side * 0.27, 0.42, 0.66);
      brow.rotation.z = -side * 0.5;
      brows.add(brow);
    }
    head.add(brows);
    const crown = new THREE.Group();
    crown.position.y = 0.78;
    crown.add(mesh(g.crownBand, m.gold));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = mesh(g.crownSpike, m.gold);
      spike.position.set(Math.sin(a) * 0.38, 0.22, Math.cos(a) * 0.38);
      const gem = new THREE.Mesh(g.gem, m.gem);
      gem.position.set(Math.sin(a) * 0.43, 0, Math.cos(a) * 0.43);
      crown.add(spike, gem);
    }
    head.add(crown);
    // The bomb mole hugs a lit bomb to its belly.
    const bomb = new THREE.Group();
    bomb.position.set(0, 0.35, 0.78);
    const ball = mesh(g.bomb, m.bomb);
    const cap = mesh(g.fuseCap, m.fuseCap);
    cap.position.y = 0.52;
    const fuse = mesh(g.fuse, m.fuse, false);
    fuse.position.y = 0.58;
    const spark = new THREE.Mesh(g.spark, m.spark);
    spark.position.set(0.18, 0.86, 0.02);
    bomb.add(ball, cap, fuse, spark);
    body.add(bomb);
    const paws = new THREE.Group();
    for (const side of [-1, 1]) {
      const paw = mesh(g.paw, look.fur);
      paw.scale.set(1.3, 0.7, 1);
      paw.position.set(side * 0.46, 0.14, 0.74);
      paws.add(paw);
      fur.push(paw);
    }
    body.add(paws);
    const stars = new THREE.Group();
    stars.position.y = 2.05;
    for (let i = 0; i < 3; i++) stars.add(new THREE.Mesh(g.star, m.star));
    body.add(stars);
    return {
      root,
      body,
      head,
      fur,
      belly: bellies,
      eyes,
      dizzy,
      brows,
      crown,
      bomb,
      spark,
      paws,
      stars,
    };
  }

  dress(rig: MoleRig, look: MoleLook) {
    for (const part of rig.fur) part.material = look.fur;
    for (const part of rig.belly) part.material = look.belly;
  }
}

export function starGeometry(outer: number, inner: number, depth: number) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5,
      r = i % 2 ? inner : outer;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

export interface HammerRig {
  root: THREE.Group;
  pivot: THREE.Group;
  head: THREE.Group;
  marker: THREE.Mesh;
  stars: THREE.Group;
  paint: THREE.MeshStandardMaterial;
  ring: THREE.MeshBasicMaterial;
}

/** A toy mallet in the player's colour, pivoting at the grip. */
export function hammerRig(
  kit: Kit,
  color: string,
  size: number,
  length: number,
): HammerRig {
  const root = new THREE.Group(),
    pivot = new THREE.Group(),
    head = new THREE.Group();
  root.add(pivot);
  pivot.position.z = length;
  const paint = kit.toy(color, { roughness: 0.55 });
  const handle = mesh(
    kit.geometry(
      new THREE.CylinderGeometry(size * 0.1, size * 0.13, length, 7),
    ),
    kit.toy(PALETTE.wood),
  );
  handle.rotation.x = Math.PI / 2;
  handle.position.z = -length / 2;
  const grip = mesh(
    kit.geometry(
      new THREE.CylinderGeometry(size * 0.15, size * 0.15, length * 0.28, 7),
    ),
    kit.toy(PALETTE.navy),
  );
  grip.rotation.x = Math.PI / 2;
  grip.position.z = -length * 0.1;
  pivot.add(handle, grip, head);
  head.position.z = -length;
  const barrel = mesh(
    kit.geometry(
      new THREE.CylinderGeometry(size * 0.42, size * 0.42, size * 1.2, 8),
      size * 0.03,
      23,
    ),
    paint,
  );
  barrel.rotation.z = Math.PI / 2;
  const capGeometry = kit.geometry(
    new THREE.CylinderGeometry(size * 0.46, size * 0.46, size * 0.16, 8),
  );
  const cream = kit.toy(PALETTE.cream);
  for (const side of [-1, 1]) {
    const cap = mesh(capGeometry, cream);
    cap.rotation.z = Math.PI / 2;
    cap.position.x = side * size * 0.62;
    head.add(cap);
  }
  const band = mesh(
    kit.geometry(
      new THREE.CylinderGeometry(size * 0.44, size * 0.44, size * 0.14, 8),
    ),
    kit.toy('#ffffff', { roughness: 0.4 }),
  );
  band.rotation.z = Math.PI / 2;
  head.add(barrel, band);
  const ring = kit.glow(color, 0.85);
  const marker = new THREE.Mesh(
    kit.geometry(new THREE.RingGeometry(size * 0.3, size * 0.42, 20)),
    ring,
  );
  marker.rotation.x = -Math.PI / 2;
  const stars = new THREE.Group();
  const starGeo = kit.geometry(
    starGeometry(size * 0.16, size * 0.07, size * 0.06),
  );
  const starMat = kit.glow('#ffd23f');
  for (let i = 0; i < 3; i++) stars.add(new THREE.Mesh(starGeo, starMat));
  head.add(stars);
  return { root, pivot, head, marker, stars, paint, ring };
}

export type PropKind = 'tuft' | 'flower' | 'rock' | 'mushroom' | 'block';

/** Small scenery that fills the gaps between holes. */
export class PropKit {
  private readonly g;
  private readonly m;

  constructor(kit: Kit) {
    this.g = {
      blade: kit.geometry(new THREE.ConeGeometry(0.07, 0.34, 4), 0.01, 29),
      stem: kit.geometry(new THREE.CylinderGeometry(0.02, 0.025, 0.34, 4)),
      petal: kit.geometry(new THREE.IcosahedronGeometry(0.07, 0)),
      bud: kit.geometry(new THREE.IcosahedronGeometry(0.06, 0)),
      rock: kit.geometry(new THREE.DodecahedronGeometry(0.2, 0), 0.06, 31),
      stalk: kit.geometry(new THREE.CylinderGeometry(0.06, 0.08, 0.18, 6)),
      cap: kit.geometry(
        new THREE.SphereGeometry(0.17, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2),
        0.02,
        37,
      ),
      dot: kit.geometry(new THREE.IcosahedronGeometry(0.03, 0)),
      block: kit.geometry(new THREE.BoxGeometry(0.22, 0.22, 0.22), 0.015, 41),
    };
    this.m = {
      grass: kit.toy('#5fae43'),
      grassLight: kit.toy('#8fd064'),
      stem: kit.toy('#4f9a3a'),
      petals: [
        kit.toy('#ffffff'),
        kit.toy('#ffd23f'),
        kit.toy('#ff8fb1'),
        kit.toy('#8fc7ff'),
      ],
      bud: kit.toy('#ffb627'),
      rock: kit.toy('#a3a1ad'),
      stalk: kit.toy('#fff3dc'),
      cap: kit.toy(PALETTE.coral),
      dot: kit.toy('#ffffff'),
      blocks: [
        kit.toy(PALETTE.coral),
        kit.toy(PALETTE.teal),
        kit.toy(PALETTE.gold),
        kit.toy(PALETTE.sky),
      ],
    };
  }

  build(kind: PropKind, seed: number): THREE.Group {
    const { g, m } = this,
      group = new THREE.Group(),
      pick = <T>(items: T[]) =>
        items[Math.floor(hash(seed + 5) * items.length)];
    group.rotation.y = hash(seed) * Math.PI * 2;
    const scale = 0.8 + hash(seed + 1) * 0.5;
    group.scale.setScalar(scale);
    if (kind === 'tuft')
      for (let i = 0; i < 5; i++) {
        const blade = mesh(g.blade, i % 2 ? m.grass : m.grassLight);
        const a = (i / 5) * Math.PI * 2;
        blade.position.set(Math.cos(a) * 0.06, 0.15, Math.sin(a) * 0.06);
        blade.rotation.set(Math.sin(a) * 0.35, 0, Math.cos(a) * 0.35);
        group.add(blade);
      }
    else if (kind === 'flower') {
      const stem = mesh(g.stem, m.stem);
      stem.position.y = 0.17;
      const petal = pick(m.petals);
      group.add(stem);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const p = mesh(g.petal, petal);
        p.position.set(Math.cos(a) * 0.08, 0.36, Math.sin(a) * 0.08);
        group.add(p);
      }
      const bud = mesh(g.bud, m.bud);
      bud.position.y = 0.37;
      group.add(bud);
    } else if (kind === 'rock') {
      const rock = mesh(g.rock, m.rock);
      rock.scale.set(1.2, 0.7, 1);
      rock.position.y = 0.08;
      group.add(rock);
    } else if (kind === 'mushroom') {
      const stalk = mesh(g.stalk, m.stalk);
      stalk.position.y = 0.09;
      const cap = mesh(g.cap, m.cap);
      cap.position.y = 0.16;
      group.add(stalk, cap);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        const dot = mesh(g.dot, m.dot, false);
        dot.position.set(Math.cos(a) * 0.1, 0.27, Math.sin(a) * 0.1);
        group.add(dot);
      }
    } else {
      const block = mesh(g.block, pick(m.blocks));
      block.position.y = 0.11;
      group.add(block);
    }
    return group;
  }
}
