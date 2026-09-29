import * as THREE from 'three';

export type Action =
  | 'jump'
  | 'sprint'
  | 'grab'
  | 'bonk'
  | 'wash'
  | 'roll'
  | 'flop'
  | 'chitter'
  | 'objectives'
  | 'pause'
  | 'camera'
  | 'slowmo'
  | 'respawn';

const KEYMAP: Record<string, Action> = {
  Space: 'jump',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyE: 'grab',
  KeyF: 'bonk',
  KeyR: 'wash',
  KeyQ: 'roll',
  KeyZ: 'flop',
  KeyC: 'chitter',
  Tab: 'objectives',
  Escape: 'pause',
  KeyP: 'pause',
  KeyV: 'camera',
  KeyT: 'slowmo',
  Backspace: 'respawn',
  KeyH: 'respawn',
};

// Standard gamepad mapping
const PADMAP: [number, Action][] = [
  [0, 'jump'], // A
  [1, 'roll'], // B
  [2, 'grab'], // X
  [3, 'wash'], // Y
  [4, 'flop'], // LB
  [5, 'bonk'], // RB
  [6, 'sprint'], // LT
  [7, 'grab'], // RT
  [8, 'objectives'], // Back
  [9, 'pause'], // Start
  [10, 'sprint'], // L3
  [11, 'camera'], // R3
  [12, 'chitter'], // D-pad up
  [13, 'flop'], // D-pad down
];

/**
 * Unified keyboard / mouse / gamepad / virtual (touch, automated test) input.
 * Call update() at frame start and endFrame() at frame end.
 */
export class Input {
  /** x = right, y = forward. Length ≤ 1. */
  readonly move = new THREE.Vector2();
  /** Camera look delta this frame (radians). */
  readonly look = new THREE.Vector2();
  wheel = 0;
  enabled = true;
  pointerLocked = false;
  mouseSensitivity = 0.0024;
  padLookSpeed = 2.8;
  invertY = false;
  usingGamepad = false;
  /** Set by touch controls / tests. */
  readonly virtual = { move: new THREE.Vector2(), look: new THREE.Vector2(), buttons: new Set<Action>() };

  private keys = new Set<string>();
  private down = new Set<Action>();
  private prevDown = new Set<Action>();
  private mouseButtons = new Set<number>();
  private mouseDelta = new THREE.Vector2();
  private padButtons = new Set<Action>();

  constructor(private canvas: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      if (e.code === 'Space' && e.target === document.body) e.preventDefault();
      this.keys.add(e.code);
      this.usingGamepad = false;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseButtons.clear();
    });
    canvas.addEventListener('mousedown', (e) => {
      this.mouseButtons.add(e.button);
      this.usingGamepad = false;
    });
    window.addEventListener('mouseup', (e) => this.mouseButtons.delete(e.button));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) this.mouseDelta.x += e.movementX;
      if (this.pointerLocked) this.mouseDelta.y += e.movementY;
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
  }

  requestPointerLock() {
    if (this.pointerLocked) return;
    try {
      const p = (this.canvas as any).requestPointerLock?.({ unadjustedMovement: false });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* ignore */
    }
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  update(dt: number) {
    this.prevDown = new Set(this.down);
    this.down.clear();
    this.move.set(0, 0);
    this.look.set(0, 0);

    // Gamepad
    this.padButtons.clear();
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let padMove = new THREE.Vector2();
    let padLook = new THREE.Vector2();
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      for (const [i, a] of PADMAP) {
        const b = pad.buttons[i];
        if (b && (b.pressed || b.value > 0.5)) {
          this.padButtons.add(a);
          this.usingGamepad = true;
        }
      }
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      padMove.set(dz(pad.axes[0] ?? 0), -dz(pad.axes[1] ?? 0));
      padLook.set(dz(pad.axes[2] ?? 0), dz(pad.axes[3] ?? 0));
      if (padMove.lengthSq() > 0 || padLook.lengthSq() > 0) this.usingGamepad = true;
      break;
    }

    if (!this.enabled) {
      this.mouseDelta.set(0, 0);
      this.wheel = 0;
      // still track pause/objectives so menus can be toggled with a pad
      for (const a of this.padButtons) if (a === 'pause' || a === 'objectives') this.down.add(a);
      for (const code of this.keys) {
        const a = KEYMAP[code];
        if (a === 'pause' || a === 'objectives') this.down.add(a);
      }
      return;
    }

    // Keyboard move
    const k = this.keys;
    const kx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const ky = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    this.move.set(kx, ky).add(padMove).add(this.virtual.move);
    if (this.move.lengthSq() > 1) this.move.normalize();

    // Actions
    for (const code of k) {
      const a = KEYMAP[code];
      if (a) this.down.add(a);
    }
    if (this.mouseButtons.has(0)) this.down.add('grab');
    if (this.mouseButtons.has(2)) this.down.add('bonk');
    for (const a of this.padButtons) this.down.add(a);
    for (const a of this.virtual.buttons) this.down.add(a);

    // Look
    const sy = this.invertY ? -1 : 1;
    this.look.set(this.mouseDelta.x * this.mouseSensitivity, this.mouseDelta.y * this.mouseSensitivity * sy);
    this.look.x += padLook.x * this.padLookSpeed * dt;
    this.look.y += padLook.y * this.padLookSpeed * dt * sy;
    this.look.add(this.virtual.look);
    this.virtual.look.set(0, 0);
    this.mouseDelta.set(0, 0);
  }

  endFrame() {
    this.wheel = 0;
  }

  held(a: Action) {
    return this.down.has(a);
  }
  pressed(a: Action) {
    return this.down.has(a) && !this.prevDown.has(a);
  }
  released(a: Action) {
    return !this.down.has(a) && this.prevDown.has(a);
  }

  /** For tests/touch: press a button for `ms` milliseconds. */
  tap(a: Action, ms = 120) {
    this.virtual.buttons.add(a);
    setTimeout(() => this.virtual.buttons.delete(a), ms);
  }
}
