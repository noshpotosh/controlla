import * as THREE from 'three';
import { Kit, hash, starGeometry } from './models.ts';

const GRAVITY = 9;
const CONFETTI = [
  '#e8574f',
  '#ffc83d',
  '#3fae9f',
  '#4a78d6',
  '#ff8fb1',
  '#ffffff',
];

/** A fixed-capacity instanced particle batch, rebuilt every frame. */
class Batch {
  readonly mesh: THREE.InstancedMesh;
  private count = 0;
  private readonly dummy = new THREE.Object3D();

  constructor(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    readonly capacity: number,
  ) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }
  begin() {
    this.count = 0;
  }
  add(position: THREE.Vector3, scale: number, spin = 0, color?: THREE.Color) {
    if (this.count >= this.capacity || scale <= 0.001) return;
    this.dummy.position.copy(position);
    this.dummy.rotation.set(spin * 0.7, spin, spin * 0.4);
    this.dummy.scale.setScalar(scale);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(this.count, this.dummy.matrix);
    if (color) this.mesh.setColorAt(this.count, color);
    this.count++;
  }
  end() {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** Individually faded meshes (rings, flashes) drawn from a small pool. */
class Pool {
  private used = 0;
  private readonly items: THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshBasicMaterial
  >[] = [];
  constructor(
    kit: Kit,
    scene: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    color: string,
    size: number,
    additive = false,
  ) {
    for (let i = 0; i < size; i++) {
      const material = kit.glow(color, 0.99);
      if (additive) material.blending = THREE.AdditiveBlending;
      const item = new THREE.Mesh(geometry, material);
      item.visible = false;
      item.renderOrder = 2;
      scene.add(item);
      this.items.push(item);
    }
  }
  begin() {
    this.used = 0;
  }
  take() {
    const item = this.items[this.used++];
    if (item) item.visible = true;
    return item;
  }
  end() {
    for (let i = this.used; i < this.items.length; i++)
      this.items[i].visible = false;
  }
}

/** Hit, miss and explosion effects plus the golden sparkle and bomb fuse. */
export class Effects {
  private readonly stars: Batch;
  private readonly confetti: Batch;
  private readonly dirt: Batch;
  private readonly smoke: Batch;
  private readonly sparks: Batch;
  private readonly embers: Batch;
  private readonly rings: Pool;
  private readonly flashes: Pool;
  private readonly point = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly palette = CONFETTI.map((c) => new THREE.Color(c));

  constructor(
    kit: Kit,
    scene: THREE.Object3D,
    private readonly size: number,
  ) {
    this.stars = new Batch(
      kit.geometry(starGeometry(0.2, 0.09, 0.08)),
      kit.glow('#ffd23f'),
      160,
    );
    this.confetti = new Batch(
      kit.geometry(new THREE.BoxGeometry(0.12, 0.02, 0.07)),
      kit.toy('#ffffff', { side: THREE.DoubleSide }),
      160,
    );
    this.dirt = new Batch(
      kit.geometry(new THREE.IcosahedronGeometry(0.08, 0)),
      kit.toy('#7a4a2a'),
      96,
    );
    this.smoke = new Batch(
      kit.geometry(new THREE.IcosahedronGeometry(0.3, 1)),
      kit.toy('#8d8894', { transparent: true, opacity: 0.85 }),
      48,
    );
    this.sparks = new Batch(
      kit.geometry(new THREE.TetrahedronGeometry(0.05)),
      kit.glow('#ffb03a'),
      64,
    );
    for (const batch of [
      this.stars,
      this.confetti,
      this.dirt,
      this.smoke,
      this.sparks,
    ])
      scene.add(batch.mesh);
    this.rings = new Pool(
      kit,
      scene,
      kit.geometry(new THREE.RingGeometry(0.8, 1, 24)),
      '#fff6e0',
      16,
    );
    this.flashes = new Pool(
      kit,
      scene,
      kit.geometry(new THREE.IcosahedronGeometry(1, 1)),
      '#ffb13d',
      12,
      true,
    );
    this.embers = new Batch(
      kit.geometry(new THREE.IcosahedronGeometry(0.12, 0)),
      kit.glow('#ff7a1a'),
      48,
    );
    scene.add(this.embers.mesh);
  }

  begin() {
    for (const batch of [
      this.stars,
      this.confetti,
      this.dirt,
      this.smoke,
      this.sparks,
      this.embers,
    ])
      batch.begin();
    this.rings.begin();
    this.flashes.begin();
  }

  end() {
    for (const batch of [
      this.stars,
      this.confetti,
      this.dirt,
      this.smoke,
      this.sparks,
      this.embers,
    ])
      batch.end();
    this.rings.end();
    this.flashes.end();
  }

  /** A flat ring expanding over the ground. */
  private ring(
    at: THREE.Vector3,
    age: number,
    life: number,
    from: number,
    to: number,
    color: string,
  ) {
    if (age > life) return;
    const t = age / life,
      ring = this.rings.take();
    if (!ring) return;
    ring.position.set(at.x, at.y + 0.03, at.z);
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar((from + (to - from) * (1 - (1 - t) ** 3)) * this.size);
    ring.material.color.set(color);
    ring.material.opacity = 0.75 * (1 - t);
  }

  /** Particles thrown from `origin` in a fan, falling under gravity. */
  private burst(
    batch: Batch,
    origin: THREE.Vector3,
    age: number,
    id: number,
    count: number,
    options: {
      speed: number;
      lift: number;
      life: number;
      scale: number;
      gravity?: number;
      colored?: boolean;
    },
  ) {
    if (age > options.life) return;
    const t = age / 1000,
      fade = 1 - age / options.life;
    for (let i = 0; i < count; i++) {
      const seed = id * 97 + i * 13,
        angle = (i / count) * Math.PI * 2 + hash(seed) * 0.9,
        speed = options.speed * (0.6 + hash(seed + 1) * 0.8) * this.size,
        lift = options.lift * (0.6 + hash(seed + 2) * 0.8) * this.size;
      this.point.set(
        origin.x + Math.cos(angle) * speed * t,
        origin.y +
          lift * t -
          0.5 * (options.gravity ?? GRAVITY) * this.size * t * t,
        origin.z + Math.sin(angle) * speed * t * 0.8,
      );
      if (options.colored)
        this.color.copy(
          this.palette[Math.floor(hash(seed + 3) * this.palette.length)],
        );
      batch.add(
        this.point,
        options.scale * this.size * Math.min(1, fade * 2.2),
        hash(seed + 4) * 6 + t * 9,
        options.colored ? this.color : undefined,
      );
    }
  }

  bonk(
    head: THREE.Vector3,
    ground: THREE.Vector3,
    age: number,
    id: number,
    reducedMotion: boolean,
  ) {
    this.ring(ground, age, 380, 1, 1.9, '#fff6e0');
    if (!reducedMotion)
      this.burst(this.stars, head, age, id, 6, {
        speed: 2.4,
        lift: 3.2,
        life: 560,
        scale: 0.9,
      });
  }

  gold(
    head: THREE.Vector3,
    ground: THREE.Vector3,
    age: number,
    id: number,
    reducedMotion: boolean,
  ) {
    this.ring(ground, age, 420, 1, 2.3, '#ffd23f');
    this.burst(this.stars, head, age, id, 8, {
      speed: 2.8,
      lift: 3.6,
      life: 640,
      scale: 1.1,
    });
    if (!reducedMotion)
      this.burst(this.confetti, head, age, id + 5, 28, {
        speed: 2.2,
        lift: 5,
        life: 1000,
        scale: 1.4,
        gravity: 6,
        colored: true,
      });
  }

  boom(
    head: THREE.Vector3,
    ground: THREE.Vector3,
    age: number,
    id: number,
    reducedMotion: boolean,
  ) {
    // A fireball: a hot core inside an orange shell, both swelling and fading.
    if (age < 420)
      for (const [scale, color, life] of [
        [1, '#ff6a1a', 420],
        [0.62, '#ffd84a', 300],
      ] as const) {
        if (age >= life) continue;
        const flash = this.flashes.take();
        if (!flash) break;
        const t = age / life;
        flash.position.copy(head);
        flash.rotation.set(id, id * 2, 0);
        flash.scale.setScalar(
          (0.5 + 2.1 * (1 - (1 - t) ** 2)) * scale * this.size,
        );
        flash.material.color.set(color);
        flash.material.opacity = 0.9 * (1 - t) ** 1.5;
      }
    this.ring(ground, age, 460, 1.2, 3.2, '#ff9a4d');
    if (reducedMotion) return;
    this.burst(this.embers, head, age, id + 3, 14, {
      speed: 4.2,
      lift: 4.8,
      life: 600,
      scale: 1.2,
    });
    this.burst(this.dirt, head, age, id, 10, {
      speed: 3.2,
      lift: 4,
      life: 700,
      scale: 1.3,
    });
    // Smoke drifts up and swells, then thins out.
    if (age > 120 && age < 1000)
      for (let i = 0; i < 8; i++) {
        const seed = id * 31 + i,
          t = (age - 120) / 880,
          angle = (i / 8) * Math.PI * 2 + hash(seed);
        this.point.set(
          head.x + Math.cos(angle) * (0.5 + t) * this.size,
          head.y + (0.3 + t * 1.6 + hash(seed + 1) * 0.3) * this.size,
          head.z + Math.sin(angle) * (0.4 + t * 0.6) * this.size,
        );
        this.smoke.add(
          this.point,
          this.size * (0.5 + 1.1 * t) * (1 - t * t),
          hash(seed + 2) * 3,
        );
      }
  }

  miss(ground: THREE.Vector3, age: number, id: number, reducedMotion: boolean) {
    this.ring(ground, age, 300, 0.4, 1.3, '#e8cfa8');
    if (!reducedMotion)
      this.burst(this.dirt, ground, age, id, 7, {
        speed: 1.3,
        lift: 2.6,
        life: 420,
        scale: 0.9,
      });
  }

  /** Soil crumbs hopping on a hole's rim as its mole digs up to it. */
  rumble(center: THREE.Vector3, radius: number, time: number, id: number) {
    for (let i = 0; i < 6; i++) {
      const cycle = 200,
        offset = time + i * (cycle / 6) + id * 53,
        t = (offset % cycle) / cycle,
        seed = Math.floor(offset / cycle) * 7 + i + id * 31,
        angle = hash(seed) * Math.PI * 2,
        reach = radius * (0.85 + 0.25 * t);
      this.point.set(
        center.x + Math.cos(angle) * reach,
        center.y + (0.12 + 1.4 * t * (1 - t)) * radius * 0.35,
        center.z + Math.sin(angle) * reach * 0.8,
      );
      this.dirt.add(this.point, 0.9 * this.size * (1 - t * 0.5), seed);
    }
  }

  /** Twinkling stars circling a golden mole. */
  sparkle(center: THREE.Vector3, time: number, id: number, scale: number) {
    for (let i = 0; i < 4; i++) {
      const a = time / 420 + (i * Math.PI) / 2 + id,
        twinkle = 0.5 + 0.5 * Math.sin(time / 90 + i * 2 + id);
      this.point.set(
        center.x + Math.cos(a) * 0.95 * scale,
        center.y + (0.6 + 0.35 * Math.sin(a * 1.7)) * scale,
        center.z + Math.sin(a) * 0.7 * scale,
      );
      this.stars.add(this.point, 0.45 * twinkle * scale, time / 200 + i);
    }
  }

  /** Sparks spitting from a lit fuse. */
  fuse(tip: THREE.Vector3, time: number, id: number, scale: number) {
    for (let i = 0; i < 5; i++) {
      const cycle = 260,
        phase = ((time + i * (cycle / 5) + id * 37) % cycle) / cycle,
        seed = Math.floor((time + i * (cycle / 5) + id * 37) / cycle) * 11 + i,
        angle = hash(seed) * Math.PI * 2;
      this.point.set(
        tip.x + Math.cos(angle) * phase * 0.35 * scale,
        tip.y + (phase * 0.4 - phase * phase * 0.3) * scale,
        tip.z + Math.sin(angle) * phase * 0.35 * scale,
      );
      this.sparks.add(this.point, (1 - phase) * scale * 1.4, seed);
    }
  }
}
