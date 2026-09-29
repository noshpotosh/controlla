import * as THREE from 'three';
import type { Point, ReadonlyDeep } from '../../../api/index.ts';
import type { Stage, StageFrame, StageLabel } from '../stage-contract.ts';
import {
  WHACK,
  clamp,
  createRandom,
  frenzyAt,
  holeBounds,
  molePose,
  touchedHole,
  type Hole,
  type Mole,
  type MolePose,
} from '../model.ts';
import { PALETTE } from '../palette.ts';
import { Effects } from './fx.ts';
import {
  Kit,
  MoleKit,
  PropKit,
  hammerRig,
  hash,
  slab,
  squircle,
  type HammerRig,
  type MoleRig,
  type PropKind,
} from './models.ts';

/** The fixed camera the hole layout's depth scale and squash were chosen to match. */
const CAMERA = { fov: 26, elevation: (34 * Math.PI) / 180, distance: 20 };
const MAX_WIDTH = 2560;
/** Mole rig height when fully up, in hole radii; fully hidden sinks this far. */
const RISE = 1.95;

function easeOutBack(t: number) {
  const c = 1.7,
    u = Math.min(1, Math.max(0, t)) - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

// One WebGL context and its compiled shaders are shared by every stage on the
// page: the presenter builds a renderer per round, and browsers cap contexts.
interface Shared {
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  users: number;
  release: ReturnType<typeof setTimeout> | null;
}
let shared: Shared | null = null;

function acquire(): Shared | null {
  if (shared && !shared.renderer.getContext().isContextLost()) {
    shared.users++;
    if (shared.release) clearTimeout(shared.release);
    shared.release = null;
    return shared;
  }
  const canvas = document.createElement('canvas');
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
  } catch {
    return null;
  }
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  shared = { renderer, canvas, users: 1, release: null };
  return shared;
}

function release(owner: Shared) {
  owner.users--;
  if (owner.users > 0) return;
  // Keep the context briefly so back-to-back rounds reuse compiled shaders.
  owner.release = setTimeout(() => {
    if (owner.users > 0) return;
    owner.renderer.dispose();
    owner.renderer.forceContextLoss();
    if (shared === owner) shared = null;
  }, 20_000);
}

export function createStage(): Stage | null {
  if (typeof document === 'undefined') return null;
  const gl = acquire();
  if (!gl) return null;
  const world = new World();
  let disposed = false;
  return {
    canvas: gl.canvas,
    render(frame) {
      if (disposed || gl.renderer.getContext().isContextLost()) return null;
      const scale = Math.min(1, MAX_WIDTH / frame.width),
        width = Math.max(16, Math.round(frame.width * scale)),
        height = Math.max(9, Math.round(frame.height * scale));
      if (gl.canvas.width !== width || gl.canvas.height !== height)
        gl.renderer.setSize(width, height, false);
      const labels = world.update(frame);
      gl.renderer.render(world.scene, world.camera);
      return labels;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      world.dispose();
      release(gl);
    },
  };
}

interface HoleView {
  hole: ReadonlyDeep<Hole>;
  /** The hole's mound, rim and mole, which shake while the mole digs up. */
  group: THREE.Group;
  center: THREE.Vector3;
  radius: number;
  rig: MoleRig;
  target: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  warn: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** Mole shown this frame, and its pose. */
  mole: ReadonlyDeep<Mole> | null;
  pose: MolePose | null;
}

interface HammerView {
  rig: HammerRig;
  head: THREE.Vector3;
  /** 0 at rest, 1 fully raised while the swing button locks the aim. */
  raise: number;
  at: number;
}

class World {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(CAMERA.fov, 16 / 9, 0.5, 140);
  private readonly kit = new Kit();
  private readonly moles = new MoleKit(this.kit);
  private readonly props = new PropKit(this.kit);
  private readonly effects: Effects;
  private readonly key: THREE.DirectionalLight;
  private readonly sky: THREE.HemisphereLight;
  private readonly board = new THREE.Group();
  private readonly base = new THREE.Vector3();
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly scratch = new THREE.Vector3();
  private readonly scratch2 = new THREE.Vector3();
  private readonly scratch3 = new THREE.Vector3();
  private holes: HoleView[] = [];
  private hammers = new Map<string, HammerView>();
  private layoutKey = '';
  private size = 0.75;

  constructor() {
    const { scene, camera } = this;
    camera.position.set(
      0,
      Math.sin(CAMERA.elevation) * CAMERA.distance,
      Math.cos(CAMERA.elevation) * CAMERA.distance,
    );
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    this.base.copy(camera.position);
    scene.background = new THREE.Color('#6f93e6');
    scene.fog = new THREE.Fog('#86a6ee', 30, 70);
    this.sky = new THREE.HemisphereLight('#e4efff', '#a47e55', 1.15);
    this.key = new THREE.DirectionalLight('#fff0d6', 2.7);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 3;
    const rim = new THREE.DirectionalLight('#ffd9f2', 0.7);
    rim.position.set(6, 6, -10);
    scene.add(this.sky, this.key, this.key.target, rim, this.board);
    this.room();
    this.effects = new Effects(this.kit, scene, 1);
  }

  /** The toy room behind the playset: a wooden table and a painted plank wall. */
  private room() {
    const kit = this.kit;
    const table = new THREE.Mesh(
      kit.geometry(new THREE.PlaneGeometry(120, 80)),
      // A texture map multiplies the base colour, so mapped materials stay white.
      kit.toy('#ffffff', {
        map: this.stripes('#e9bd8f', '#ddaa79', 18, false),
      }),
    );
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.8;
    table.receiveShadow = true;
    const wall = new THREE.Mesh(
      kit.geometry(new THREE.PlaneGeometry(120, 40)),
      kit.toy('#ffffff', { map: this.stripes('#6d9af0', '#5f8be6', 30, true) }),
    );
    wall.position.set(0, 19, -8.5);
    const rail = new THREE.Mesh(
      kit.geometry(new THREE.BoxGeometry(120, 0.5, 0.4)),
      kit.toy(PALETTE.cream),
    );
    rail.position.set(0, 0.4, -8.3);
    this.scene.add(table, wall, rail);
    // A few big toys at the back corners, clear of the field and HUD.
    const block = kit.geometry(new THREE.BoxGeometry(1.6, 1.6, 1.6), 0.08, 51);
    const colors = [PALETTE.coral, PALETTE.teal, PALETTE.gold];
    [
      [9.4, -6.6, 0],
      [11.2, -6.3, 1],
      [10.3, -6.5, 2],
    ].forEach(([x, z, i], n) => {
      const toy = new THREE.Mesh(block, kit.toy(colors[i]));
      toy.position.set(x, n === 2 ? 0.8 : -0.0, z);
      toy.rotation.y = 0.3 + n * 0.4;
      toy.castShadow = toy.receiveShadow = true;
      this.scene.add(toy);
    });
    const ball = new THREE.Mesh(
      kit.geometry(new THREE.IcosahedronGeometry(1.1, 1), 0.04, 53),
      kit.toy(PALETTE.coral, { roughness: 0.5 }),
    );
    ball.position.set(-10.8, 0.3, -6.6);
    ball.castShadow = true;
    this.scene.add(ball);
  }

  private stripes(
    base: string,
    line: string,
    count: number,
    vertical: boolean,
  ) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = line;
      const step = 256 / 8;
      for (let i = 0; i < 8; i++)
        if (vertical) ctx.fillRect(i * step, 0, 3, 256);
        else ctx.fillRect(0, i * step, 256, 3);
    }
    const texture = this.kit.own(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(vertical ? count : 1, vertical ? 1 : count);
    return texture;
  }

  /** The point on the horizontal plane at `height` under a normalized screen position. */
  ground(x: number, y: number, height = 0, target = new THREE.Vector3()) {
    this.ndc.set(x * 2 - 1, -(y * 2 - 1));
    this.ray.setFromCamera(this.ndc, this.camera);
    const { origin, direction } = this.ray.ray;
    const t =
      Math.abs(direction.y) < 1e-6 ? 0 : (height - origin.y) / direction.y;
    return target.copy(origin).addScaledVector(direction, Math.max(0, t));
  }

  project(point: THREE.Vector3): Point {
    const v = this.scratch.copy(point).project(this.camera);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  }

  /** Builds the island, holes and scenery for a round's hole layout. */
  private layout(holes: ReadonlyDeep<Hole[]>) {
    const key = holes
      .map((h) => `${h.x.toFixed(4)},${h.y.toFixed(4)}`)
      .join(';');
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    this.board.clear();
    this.holes = [];
    const kit = this.kit;
    // Island sized to the field's footprint on the ground.
    const corners = [
      this.ground(0.03, 0.22),
      this.ground(0.97, 0.22),
      this.ground(0.03, 0.93),
      this.ground(0.97, 0.93),
    ];
    const back = corners[0].z,
      front = corners[2].z,
      halfWidth = Math.max(...corners.map((c) => Math.abs(c.x))),
      halfDepth = (front - back) / 2,
      middle = (front + back) / 2;
    const top = new THREE.Mesh(
      kit.geometry(slab(squircle(halfWidth, halfDepth, 44), 0.22)),
      kit.toy(PALETTE.grass),
    );
    top.position.z = middle;
    top.receiveShadow = true;
    const skirt = new THREE.Mesh(
      kit.geometry(
        slab(squircle(halfWidth + 0.3, halfDepth + 0.3, 44), 0.5, 0.14),
      ),
      kit.toy(PALETTE.wood),
    );
    skirt.position.set(0, -0.2 - 0.14, middle);
    skirt.castShadow = skirt.receiveShadow = true;
    this.board.add(top, skirt);
    const span = Math.max(halfWidth, halfDepth) + 2;
    const shadow = this.key.shadow.camera;
    shadow.left = shadow.bottom = -span;
    shadow.right = shadow.top = span;
    shadow.near = 1;
    shadow.far = 50;
    shadow.updateProjectionMatrix();
    this.key.position.set(-7, 14, middle + 8);
    this.key.target.position.set(0, 0, middle);

    const radii: number[] = [];
    const moundGeo = kit.geometry(
      new THREE.CylinderGeometry(1.42, 1.55, 0.1, 14),
      0.03,
      61,
    );
    const pitGeo = kit.geometry(new THREE.CircleGeometry(1, 14));
    const rimGeo = kit.geometry(
      new THREE.TorusGeometry(1.03, 0.14, 4, 14),
      0.02,
      63,
    );
    const ringGeo = kit.geometry(new THREE.TorusGeometry(1.2, 0.055, 3, 28));
    const mound = kit.toy('#8a5a35'),
      pit = kit.toy('#1c0e06', { roughness: 1 }),
      rim = kit.toy('#b87a4b');
    for (const hole of holes) {
      const center = this.ground(hole.x, hole.y);
      const left = this.ground(hole.x - hole.rx / 1600, hole.y),
        right = this.ground(hole.x + hole.rx / 1600, hole.y);
      const radius = left.distanceTo(right) / 2;
      radii.push(radius);
      const group = new THREE.Group();
      group.position.copy(center);
      group.scale.setScalar(radius);
      const base = new THREE.Mesh(moundGeo, mound);
      base.position.y = 0.05;
      base.receiveShadow = true;
      const hollow = new THREE.Mesh(pitGeo, pit);
      hollow.rotation.x = -Math.PI / 2;
      hollow.position.y = 0.105;
      const lip = new THREE.Mesh(rimGeo, rim);
      lip.rotation.x = Math.PI / 2;
      lip.position.y = 0.13;
      lip.castShadow = lip.receiveShadow = true;
      const target = new THREE.Mesh(ringGeo, kit.glow('#ffffff', 0.9));
      target.rotation.x = Math.PI / 2;
      target.position.y = 0.2;
      target.visible = false;
      const warn = new THREE.Mesh(ringGeo, kit.glow('#ff3b30', 0.7));
      warn.rotation.x = Math.PI / 2;
      warn.position.y = 0.16;
      warn.scale.setScalar(1.12);
      warn.visible = false;
      const rig = this.moles.rig();
      group.add(base, hollow, lip, target, warn, rig.root);
      this.board.add(group);
      this.holes.push({
        hole,
        group,
        center,
        radius,
        rig,
        target,
        warn,
        mole: null,
        pose: null,
      });
    }
    this.size = radii.reduce((a, b) => a + b, 0) / Math.max(1, radii.length);
    this.scatter(holes, halfWidth, halfDepth, middle);
    // Hammers are sized from the holes, so rebuild them for a new layout.
    for (const view of this.hammers.values()) {
      this.scene.remove(view.rig.root, view.rig.marker);
    }
    this.hammers.clear();
  }

  /** Seeded scenery in the gaps between holes, identical on every display. */
  private scatter(
    holes: ReadonlyDeep<Hole[]>,
    halfWidth: number,
    halfDepth: number,
    middle: number,
  ) {
    const seed = holes.reduce(
      (s, h) =>
        (s * 31 + Math.round(h.x * 1e4) * 7 + Math.round(h.y * 1e4)) >>> 0,
      17,
    );
    const random = createRandom(seed);
    const kinds: PropKind[] = [
      'tuft',
      'tuft',
      'tuft',
      'flower',
      'flower',
      'rock',
      'mushroom',
      'block',
    ];
    const placed: Point[] = [];
    for (let attempt = 0; attempt < 400 && placed.length < 26; attempt++) {
      const x = 0.04 + random() * 0.92,
        y = 0.27 + random() * 0.62;
      const px = x * 1600,
        py = y * 900;
      // Props never overlap a hole's hit shape (a prop stands about 40 px tall).
      const blocked = holes.some((hole) => {
        const box = holeBounds(hole);
        return (
          px > box.left - 18 &&
          px < box.right + 18 &&
          py > box.top - 8 &&
          py - 40 < box.bottom + 10
        );
      });
      if (
        blocked ||
        placed.some((p) => Math.hypot((p.x - x) * 1600, (p.y - y) * 900) < 70)
      )
        continue;
      const spot = this.ground(x, y);
      const nx = spot.x / (halfWidth - 0.3),
        nz = (spot.z - middle) / (halfDepth - 0.3);
      if (nx ** 4 + nz ** 4 > 1) continue;
      placed.push({ x, y });
      const prop = this.props.build(
        kinds[Math.floor(random() * kinds.length)],
        seed + attempt,
      );
      prop.position.copy(spot);
      prop.scale.multiplyScalar(this.size * 1.25);
      this.board.add(prop);
    }
  }

  update(frame: StageFrame): StageLabel[] {
    const { state, time, reducedMotion } = frame;
    // Unproject from the steady camera; shake is applied after.
    this.camera.position.copy(this.base);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.layout(state.holes);
    this.mood(time, frame.endAt);

    // Pick the mole each hole shows now; a hole never hosts two at once.
    for (const view of this.holes) {
      view.mole = null;
      view.pose = null;
    }
    for (const mole of state.moles) {
      const view = this.holes[mole.hole];
      if (!view) continue;
      const pose = molePose(mole, time);
      if (pose.phase === 'gone') continue;
      if (!view.mole || mole.upAt > view.mole.upAt) {
        view.mole = mole;
        view.pose = pose;
      }
    }

    this.effects.begin();
    const labels = this.hammerFrame(frame);
    for (const view of this.holes) this.moleFrame(view, time, reducedMotion);
    this.effectFrame(frame);
    this.effects.end();
    this.shake(frame);
    return labels;
  }

  /** Frenzy warms the light for the final ten seconds. */
  private mood(time: number, endAt: number) {
    const k = time >= endAt ? 0 : clamp((time - frenzyAt(endAt)) / 600);
    this.key.color.set('#fff0d6').lerp(new THREE.Color('#ffc07a'), k);
    this.key.intensity = 2.7 + k * 0.5;
    this.sky.color.set('#e4efff').lerp(new THREE.Color('#ffe2c4'), k);
  }

  private moleFrame(view: HoleView, time: number, reducedMotion: boolean) {
    const { rig, mole, pose } = view;
    view.warn.visible = false;
    view.group.rotation.set(0, 0, 0);
    rig.root.visible = !!mole && !!pose && pose.phase !== 'warning';
    if (!mole || !pose) return;
    // About to pop: the hole shakes harder and harder and spits soil.
    if (pose.phase === 'warning') {
      if (reducedMotion) return;
      const build = 0.4 + 0.6 * clamp((pose.elapsed * 1000) / WHACK.warn);
      view.group.rotation.set(
        Math.cos(time / 27 + mole.id) * 0.04 * build,
        0,
        Math.sin(time / 22 + mole.id) * 0.06 * build,
      );
      this.effects.rumble(view.center, view.radius, time, mole.id);
      return;
    }
    const bonked = pose.phase === 'bonked';
    const soot = bonked && mole.kind === 'bomb';
    this.moles.dress(rig, this.moles.looks[soot ? 'soot' : mole.kind]);
    rig.crown.visible = mole.kind === 'golden';
    rig.bomb.visible = mole.kind === 'bomb' && !bonked;
    rig.brows.visible = mole.kind === 'bomb' && !bonked;
    rig.paws.visible =
      pose.phase === 'up' || (pose.phase === 'rising' && pose.height > 0.85);
    for (const eye of rig.eyes) eye.visible = !bonked;
    for (const cross of rig.dizzy) cross.visible = bonked;
    rig.stars.visible = bonked && !reducedMotion;
    let sy = 1,
      bob = 0;
    const motion = !reducedMotion,
      e = pose.elapsed;
    if (pose.phase === 'rising' && motion)
      sy = 1 + 0.16 * Math.sin(Math.PI * clamp((e * 1000) / WHACK.rise));
    else if (pose.phase === 'up' && motion) {
      sy = 1 + 0.025 * Math.sin(time / 220 + mole.id);
      bob = 0.03 * Math.sin(time / 170 + mole.id * 1.3);
    } else if (pose.phase === 'hiding' && motion) sy = 0.9;
    else if (bonked)
      sy = motion ? 1 - 0.45 * Math.exp(-e * 6) * Math.cos(e * 26) : 0.7;
    rig.body.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
    rig.body.position.y = (pose.height - 1) * RISE + bob;
    // Blink, look at the nearest hammer, wobble when bonked.
    const blink =
      motion && pose.phase === 'up' && (time + mole.id * 733) % 2700 < 100;
    for (const eye of rig.eyes) eye.scale.y = blink ? 0.12 : 1;
    let look = 0,
      nearest = Infinity;
    for (const hammer of this.hammers.values()) {
      if (!hammer.rig.root.visible) continue;
      const dx = hammer.head.x - view.center.x,
        dz = hammer.head.z - view.center.z,
        d = dx * dx + dz * dz;
      if (d < nearest) {
        nearest = d;
        look = Math.atan2(dx, Math.max(0.3, dz + 2));
      }
    }
    rig.head.rotation.y = bonked || !motion ? 0 : clamp(look, -0.5, 0.5);
    rig.head.rotation.z =
      bonked && motion ? Math.sin(e * 20) * 0.25 * Math.exp(-e * 3) : 0;
    if (bonked && motion) {
      rig.stars.rotation.y = e * 6;
      rig.stars.children.forEach((star, i) => {
        const a = (i * Math.PI * 2) / 3;
        star.position.set(
          Math.cos(a) * 0.62,
          Math.sin(e * 8 + i) * 0.06,
          Math.sin(a) * 0.62,
        );
        star.rotation.y = -e * 6;
      });
    }
    const world = view.center,
      r = view.radius;
    if (mole.kind === 'bomb' && !bonked) {
      view.warn.visible = true;
      view.warn.material.opacity = motion
        ? 0.45 + 0.35 * Math.sin(time / 110)
        : 0.6;
      rig.spark.scale.setScalar(
        motion ? 0.7 + 0.7 * hash(Math.floor(time / 45) + mole.id) : 1,
      );
      rig.spark.getWorldPosition(this.scratch);
      if (motion && pose.height > 0.3)
        this.effects.fuse(this.scratch, time, mole.id, r);
    }
    if (mole.kind === 'golden' && !bonked && pose.height > 0.3 && motion)
      this.effects.sparkle(
        new THREE.Vector3(
          world.x,
          world.y + (pose.height * 1.4 + 0.2) * r,
          world.z,
        ),
        time,
        mole.id,
        r,
      );
  }

  private hammerFrame(frame: StageFrame): StageLabel[] {
    const { state, players, cursors, pressing, time, reducedMotion } = frame;
    const labels: StageLabel[] = [];
    const size = this.size,
      length = size * 2.5,
      hover = (RISE - 0.16) * size + size * 0.25;
    for (const view of this.holes) view.target.visible = false;
    const active = new Set<string>();
    for (const player of players) {
      const aim = cursors[player.id];
      const stats = state.players[player.id];
      if (!player.connected || !aim || !stats) continue;
      active.add(player.id);
      let view = this.hammers.get(player.id);
      if (!view) {
        view = {
          rig: hammerRig(this.kit, player.color, size, length),
          head: new THREE.Vector3(),
          raise: 0,
          at: time,
        };
        this.scene.add(view.rig.root, view.rig.marker);
        this.hammers.set(player.id, view);
      }
      const { rig } = view;
      rig.root.visible = true;
      // Freeform: the head follows the cursor, hovering just above the tallest
      // mole so nothing hides it. It never snaps to holes.
      const hovering = this.ground(aim.x, aim.y, hover, new THREE.Vector3());
      // Cursors arrive already smoothed by the renderer.
      view.head.copy(hovering);
      // Ring the hole this hammer would reach, using the same test as the rules.
      const touched =
        this.holes[
          touchedHole(
            aim,
            state.holes,
            (index) => this.holes[index]?.pose?.height ?? 0,
          )
        ];
      if (touched) {
        touched.target.visible = true;
        touched.target.material.color.set(player.color);
      }
      // Impact first: the mallet is down on the mole it hit (or the ground where it
      // missed) when the whack arrives, then springs back up to the cursor.
      const slam = state.effects.findLast(
        (effect) => effect.playerId === player.id && effect.at <= time,
      );
      const since = slam ? time - slam.at : Infinity;
      const back =
        since < 80 ? 0 : since < 380 ? easeOutBack((since - 80) / 300) : 1;
      const position = this.scratch2.copy(view.head);
      if (slam && back < 1) {
        const hit =
          slam.kind !== 'miss' && slam.hole >= 0
            ? this.holes[slam.hole]
            : undefined;
        // The barrel (radius 0.42) rests on the squashed mole or on the grass.
        const landing = hit
          ? this.scratch3
              .copy(hit.center)
              .setY(hit.center.y + 0.35 * hit.radius + size * 0.42)
          : this.ground(slam.x, slam.y, size * 0.42, this.scratch3);
        position.copy(landing).lerp(view.head, back);
      }
      rig.root.position.copy(position);
      // Held in the right hand: the handle runs toward the lower right.
      rig.root.rotation.y = 0.45;
      rig.marker.visible = true;
      rig.marker.position.set(position.x, 0.03, position.z);
      // Holding the swing button cocks the mallet back, ready to swing.
      const target = pressing[player.id] === true ? 1 : 0,
        step = Math.min(0.1, Math.max(0, (time - view.at) / 1000));
      view.at = time;
      view.raise = reducedMotion
        ? target
        : view.raise + (target - view.raise) * (1 - Math.exp(-step / 0.05));
      // Flat at impact, so the head lands exactly where placed; raised at rest.
      const rest = 0.26 + 0.5 * view.raise,
        strike = 0;
      let angle =
        strike +
        (rest - strike) * back +
        (reducedMotion ? 0 : Math.sin(time / 300 + player.seat) * 0.04);
      const stunned = stats.stunnedUntil > time;
      if (stunned && !reducedMotion) angle += Math.sin(time / 70) * 0.18;
      rig.pivot.rotation.x = angle;
      const squash =
        since < 100 && !reducedMotion ? 1 - (1 - since / 100) * 0.2 : 1;
      rig.head.scale.set(1 / squash, squash, 1 / squash);
      rig.stars.visible = stunned && !reducedMotion;
      if (rig.stars.visible)
        rig.stars.children.forEach((star, i) => {
          const a = time / 160 + (i * Math.PI * 2) / 3;
          star.position.set(
            Math.cos(a) * size * 0.8,
            size * 0.6,
            Math.sin(a) * size * 0.8,
          );
        });
      const spot = this.project(this.scratch.set(position.x, 0, position.z));
      labels.push({ playerId: player.id, x: spot.x, y: spot.y });
    }
    for (const [id, view] of this.hammers)
      if (!active.has(id)) {
        view.rig.root.visible = false;
        view.rig.marker.visible = false;
      }
    return labels;
  }

  private effectFrame(frame: StageFrame) {
    const { state, time, reducedMotion } = frame;
    const head = new THREE.Vector3(),
      floor = new THREE.Vector3();
    for (const effect of state.effects) {
      const age = time - effect.at;
      if (age < 0 || age >= WHACK.effectLifetime) continue;
      const view = effect.hole >= 0 ? this.holes[effect.hole] : undefined;
      if (view && effect.kind !== 'miss') {
        floor.copy(view.center);
        head.copy(view.center);
        head.y += 1.3 * view.radius;
      } else {
        this.ground(effect.x, effect.y, 0, floor);
        head.copy(floor);
      }
      if (effect.kind === 'bonk')
        this.effects.bonk(head, floor, age, effect.id, reducedMotion);
      else if (effect.kind === 'gold')
        this.effects.gold(head, floor, age, effect.id, reducedMotion);
      else if (effect.kind === 'boom')
        this.effects.boom(head, floor, age, effect.id, reducedMotion);
      else
        this.effects.miss(
          view ? view.center : floor,
          age,
          effect.id,
          reducedMotion,
        );
    }
  }

  /** A short camera shake on hits, strongest for bombs. */
  private shake(frame: StageFrame) {
    let amount = 0;
    if (!frame.reducedMotion)
      for (const effect of frame.state.effects) {
        const age = frame.time - effect.at;
        if (age < 0 || age > 320) continue;
        const power =
          effect.kind === 'boom'
            ? 0.22
            : effect.kind === 'gold'
              ? 0.07
              : effect.kind === 'bonk'
                ? 0.035
                : 0;
        amount = Math.max(amount, power * (1 - age / 320) ** 2);
      }
    const t = frame.time;
    this.camera.position.set(
      this.base.x + Math.sin(t * 0.093) * amount,
      this.base.y + Math.sin(t * 0.117 + 1) * amount * 0.7,
      this.base.z,
    );
    this.camera.lookAt(Math.sin(t * 0.081 + 2) * amount * 0.5, 0, 0);
  }

  dispose() {
    this.kit.dispose();
    this.scene.clear();
    this.hammers.clear();
    this.holes = [];
  }
}
