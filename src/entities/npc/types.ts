import type * as THREE from 'three';
import type { Entity } from '../../core/Entities';
import type { Look } from './Looks';

export const NPC_TYPES = [
  'pedestrian',
  'jogger',
  'tourist',
  'fan',
  'officer',
  'fishmonger',
  'mayor',
  'dean',
  'grandma',
  'kid',
  'racer',
  'techbro',
] as const;
export type NpcType = (typeof NPC_TYPES)[number];

export type Expression = 'neutral' | 'happy' | 'shock' | 'aww' | 'angry' | 'sad';

export type HoldingKind = 'phone' | 'coffee' | 'sandwich' | 'pizza' | 'icecream' | 'cottoncandy';

export type NpcState =
  | 'idle'
  | 'wander'
  | 'walk' // scripted walkTo
  | 'notice'
  | 'watch'
  | 'film'
  | 'selfie'
  | 'flee'
  | 'chase'
  | 'kitty'
  | 'faint'
  | 'scold'
  | 'retreat'
  | 'baffled'
  | 'fetch' // walking back to pick up a dropped item
  | 'ragdoll'
  | 'getup'
  | 'custom';

/** How Jimothy interacted with an NPC (see `Npc.onInteract`). */
export type InteractKind = 'chitter' | 'grab' | 'give' | 'wash';

/**
 * Return `true` from an `onInteract` hook to consume the interaction
 * (no default reaction: no ragdoll on grab, no face-wash score, ...).
 */
export type InteractHook = (kind: InteractKind, item?: Entity) => boolean | void;

export interface NpcSpawnOptions {
  type: NpcType;
  /** Feet position. y is snapped to the ground (raycast, falls back to world.heightAt). */
  position: THREE.Vector3;
  /** Display name (score popups, speech). Defaults to the type's display name. */
  name?: string;
  /** Appearance overrides (colors / styles); everything else is randomised for the type. */
  outfit?: Partial<Look>;
  /** Wander inside this circle (default: 10 m around the spawn position). */
  wander?: { center: THREE.Vector3; radius: number };
  /** Stroll along this polyline instead of wandering (ping-pong unless `pathLoop`). */
  path?: THREE.Vector3[];
  pathLoop?: boolean;
  /** Stay put (still reacts, turns to look; walks back to the spot after being knocked over). */
  stationary?: boolean;
  /** Always turn the head (and body when idle) toward Jimothy when he's within ~12 m. */
  lookAtPlayer?: boolean;
  /** Item in the right hand (a real grabbable entity Jimothy can steal). `null` = empty hands. Default: random per type. */
  holding?: HoldingKind | null;
  /** Initial yaw (radians, 0 = facing +Z). */
  facing?: number;
  /** Disable automatic reactions (notice / film / selfie / flee / kitty). Physics reactions still happen. */
  passive?: boolean;
  /** Deterministic appearance seed. */
  seed?: number;
}

/** Payloads of events emitted by the NPC system (for other agents' convenience). */
export interface NpcRagdollEvent {
  entity: Entity;
  cause: string;
}
