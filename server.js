'use strict';

/**
 * PROP // NIGHT - 4v1 prop-hunt prototype server
 *
 * This server now supports:
 *   - a main-menu handshake
 *   - named rooms with join codes, host controls and lobby/playing states
 *   - room chat (All + Team channels)
 *   - several maps with layouts and visual styles
 *   - many prop types so morphed survivors can hide among clutter
 *   - per-player cosmetic looks, including a compact custom-drawing payload
 *   - authoritative movement, melee, repair progress and killer vision
 *
 * Map legend: '#' = wall, '.' = floor.
 */

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
const TILE_SIZE = 48;
const PLAYER_HALF = 13;
const MAX_PLAYERS = 5;
const SURVIVOR_SPEED = 185;
const KILLER_SPEED = SURVIVOR_SPEED * 1.2;
const MORPH_SPEED_MULTIPLIER = 0.55;
const MAX_HEALTH = 100;
const MELEE_DAMAGE = 100;
const ATTACK_RANGE = 82;
const ATTACK_HALF_ANGLE = Math.PI / 4;
const ATTACK_COOLDOWN_MS = 850;
const MACHINE_REGRESS = 30;
const REPAIR_RANGE = 72;
const REPAIR_SECONDS = 10;
const REPAIR_PER_SECOND = 100 / REPAIR_SECONDS;
const VISION_RANGE = 560;
const VISION_HALF_ANGLE = Math.PI / 4;
const CAMO_STILL_MS = 1100;
const SNAPSHOT_HZ = 20;
const MAX_CHAT_LENGTH = 160;

// Revives: survivors hold REVIVE next to a downed teammate.
const REVIVE_RANGE = 64;
const REVIVE_SECONDS = 4;
const REVIVE_HEALTH = 50;
const REVIVE_DECAY_PER_SECOND = 45;

// Escalation: repairing propmachines empowers the killer.
const POWER_SPEED_PER_MACHINE = 0.09;
const POWER_VISION_PER_MACHINE = 55;
const POWER_COOLDOWN_PER_MACHINE = 0.08;
const POWER_MIN_COOLDOWN_MS = 500;

// Killer super abilities, all sharpened by repaired propmachines.
//   SHIFT - sprint burst, Q - tracking pulse, C - trap placement.
const SPRINT_SPEED_MULTIPLIER = 2.4;
const SPRINT_DURATION_MS = 1200;
const SPRINT_COOLDOWN_MS = 6000;
const SPRINT_MIN_COOLDOWN_MS = 1500;

const TRACK_DURATION_MS = 3000;
const TRACK_COOLDOWN_MS = 14000;
const TRACK_MIN_COOLDOWN_MS = 4000;

const TRAP_RADIUS = 26;
const TRAP_ARM_MS = 600;
const TRAP_ROOT_MS = 2200;
const TRAP_ROOT_PER_MACHINE = 250;
const TRAP_LIFETIME_MS = 30000;
const TRAP_COOLDOWN_MS = 3000;
const TRAP_MIN_COOLDOWN_MS = 800;
const TRAP_MAX = 4;

// Bleed-out and the killer's finishing channel.
const BLEEDOUT_SECONDS = 45;
const FINISH_RANGE = 56;
const FINISH_SECONDS = 2.5;
const FINISH_DECAY_PER_SECOND = 60;

// Escape gate: opens when every propmachine is online.
const EXIT_RANGE = 56;
const ESCAPE_SECONDS = 3.5;

// Repair skill checks.
const SKILL_MIN_MS = 3500;
const SKILL_MAX_MS = 7000;
const SKILL_DURATION_MS = 1400;
const SKILL_WINDOW_MS = 240;
const SKILL_TOLERANCE_MS = 160;
const SKILL_BONUS = 12;
const SKILL_PENALTY = 14;

// Noise pings the killer can hear.
const NOISE_STEP_MS = 1000;
const NOISE_RANGE = 760;

// Thrown props stun the killer.
const THROW_SPEED = 520;
const THROW_RADIUS = 24;
const THROW_LIFETIME_MS = 900;
const THROW_STUN_MS = 1600;
const THROW_COOLDOWN_MS = 9000;

// Lockers.
const LOCKER_RANGE = 48;
const LOCKER_EJECT_ROOT_MS = 1200;

// Survivor one-use items.
const ITEM_USE_RANGE = 96;
const FLASHLIGHT_RANGE = 300;
const FLASHLIGHT_STUN_MS = 1800;
const TOOLBOX_PROGRESS = 40;
const MEDKIT_HEAL = 50;

// Map hazards.
const ALARM_RADIUS = 78;
const ALARM_COOLDOWN_MS = 9000;
const FOG_VISION_MULTIPLIER = 0.55;

// Reconnect grace period.
const RECONNECT_GRACE_MS = 60000;

const SURVIVOR_ITEMS = ['flashlight', 'toolbox', 'medkit'];

const GAME_CONFIG = Object.freeze({
  survivorSpeed: SURVIVOR_SPEED,
  killerSpeed: KILLER_SPEED,
  morphSpeedMultiplier: MORPH_SPEED_MULTIPLIER,
  playerHalf: PLAYER_HALF,
  maxHealth: MAX_HEALTH,
  meleeDamage: MELEE_DAMAGE,
  attackRange: ATTACK_RANGE,
  attackHalfAngle: ATTACK_HALF_ANGLE,
  attackCooldownMs: ATTACK_COOLDOWN_MS,
  repairRange: REPAIR_RANGE,
  repairSeconds: REPAIR_SECONDS,
  visionRange: VISION_RANGE,
  visionHalfAngle: VISION_HALF_ANGLE,
  camoStillMs: CAMO_STILL_MS,
  maxPlayers: MAX_PLAYERS,
  reviveRange: REVIVE_RANGE,
  reviveSeconds: REVIVE_SECONDS,
  reviveHealth: REVIVE_HEALTH,
  power: {
    speedPerMachine: POWER_SPEED_PER_MACHINE,
    visionPerMachine: POWER_VISION_PER_MACHINE,
    cooldownPerMachine: POWER_COOLDOWN_PER_MACHINE,
    minCooldownMs: POWER_MIN_COOLDOWN_MS,
  },
  abilities: {
    sprint: {
      speedMultiplier: SPRINT_SPEED_MULTIPLIER,
      durationMs: SPRINT_DURATION_MS,
      cooldownMs: SPRINT_COOLDOWN_MS,
      minCooldownMs: SPRINT_MIN_COOLDOWN_MS,
    },
    track: {
      durationMs: TRACK_DURATION_MS,
      cooldownMs: TRACK_COOLDOWN_MS,
      minCooldownMs: TRACK_MIN_COOLDOWN_MS,
    },
    trap: {
      radius: TRAP_RADIUS,
      armMs: TRAP_ARM_MS,
      rootMs: TRAP_ROOT_MS,
      rootPerMachineMs: TRAP_ROOT_PER_MACHINE,
      lifetimeMs: TRAP_LIFETIME_MS,
      cooldownMs: TRAP_COOLDOWN_MS,
      minCooldownMs: TRAP_MIN_COOLDOWN_MS,
      max: TRAP_MAX,
    },
  },
  bleedoutSeconds: BLEEDOUT_SECONDS,
  finishRange: FINISH_RANGE,
  finishSeconds: FINISH_SECONDS,
  exitRange: EXIT_RANGE,
  escapeSeconds: ESCAPE_SECONDS,
  skillCheck: {
    minMs: SKILL_MIN_MS,
    maxMs: SKILL_MAX_MS,
    durationMs: SKILL_DURATION_MS,
    windowMs: SKILL_WINDOW_MS,
    bonus: SKILL_BONUS,
    penalty: SKILL_PENALTY,
  },
  noiseStepMs: NOISE_STEP_MS,
  throwStunMs: THROW_STUN_MS,
  throwCooldownMs: THROW_COOLDOWN_MS,
  lockerRange: LOCKER_RANGE,
  items: SURVIVOR_ITEMS,
  fogVisionMultiplier: FOG_VISION_MULTIPLIER,
});

function scaledCooldown(base, min, repaired) {
  return Math.max(
    min,
    Math.round(base * (1 - POWER_COOLDOWN_PER_MACHINE * repaired)),
  );
}

// The killer scales up with every propmachine the survivors bring online.
function killerPower(room) {
  const repaired = repairedMachineCount(room);
  const speedMultiplier = 1 + POWER_SPEED_PER_MACHINE * repaired;
  return {
    repairedCount: repaired,
    speedMultiplier: Math.round(speedMultiplier * 100) / 100,
    killerSpeed: KILLER_SPEED * speedMultiplier,
    visionRange: VISION_RANGE + POWER_VISION_PER_MACHINE * repaired,
    attackCooldownMs: Math.max(
      POWER_MIN_COOLDOWN_MS,
      Math.round(ATTACK_COOLDOWN_MS * (1 - POWER_COOLDOWN_PER_MACHINE * repaired)),
    ),
    sprintSpeedMultiplier: SPRINT_SPEED_MULTIPLIER,
    sprintDurationMs: SPRINT_DURATION_MS,
    sprintCooldownMs: scaledCooldown(SPRINT_COOLDOWN_MS, SPRINT_MIN_COOLDOWN_MS, repaired),
    trackDurationMs: TRACK_DURATION_MS,
    trackCooldownMs: scaledCooldown(TRACK_COOLDOWN_MS, TRACK_MIN_COOLDOWN_MS, repaired),
    maxTraps: Math.min(TRAP_MAX, 1 + repaired),
    trapRootMs: TRAP_ROOT_MS + TRAP_ROOT_PER_MACHINE * repaired,
    trapCooldownMs: scaledCooldown(TRAP_COOLDOWN_MS, TRAP_MIN_COOLDOWN_MS, repaired),
  };
}

const VALID_HATS = ['none', 'cap', 'horns', 'halo', 'antenna', 'crown'];
const VALID_EYES = ['normal', 'angry', 'sad', 'visor', 'sparkle'];
const DEFAULT_LOOK = Object.freeze({
  body: '#49cf79',
  hat: 'none',
  eyes: 'normal',
  custom: null,
});

// ---------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------
const MAPS = {
  asylum: {
    id: 'asylum',
    name: 'Blackwood Asylum',
    description: 'Tight hospital corridors. Great for looping the killer.',
    style: {
      floor: '#151922',
      floorLine: '#697a94',
      wall: '#2b3140',
      wallDark: '#242a37',
      wallLight: '#353d4e',
      accent: '#6a8cff',
      fog: '#02030a',
    },
    layout: [
      '###########################',
      '#.........#.....#.........#',
      '#.........#.....#.........#',
      '#..#####..#.....#..#####..#',
      '#..#...#..#.....#..#...#..#',
      '#..#...#.........#...#....#',
      '#..#...#####.#...#####....#',
      '#...........#.............#',
      '#....#####..#..#####......#',
      '#....#...........#........#',
      '#....#....#...#...#.......#',
      '#.........#...#...........#',
      '#..#####..#...#..#####....#',
      '#.........................#',
      '###########################',
    ],
    machineTiles: [[5, 5], [22, 5], [5, 11], [21, 11]],
    spawnTiles: [[2, 12], [24, 12], [2, 2], [24, 2], [13, 7]],
    propTypes: ['crate', 'barrel', 'gurney', 'canister', 'chair', 'plant'],
    ambientCount: 68,
    exitTile: [13, 13],
    lockerTiles: [[2, 7], [24, 7], [2, 10]],
    alarmTiles: [[13, 4]],
    fogTiles: [[20, 10]],
  },
  warehouse: {
    id: 'warehouse',
    name: 'Rustworks Warehouse',
    description: 'Long open lanes and shipping clutter. Watch the sightlines.',
    style: {
      floor: '#1b1b1f',
      floorLine: '#7d7d86',
      wall: '#3a312b',
      wallDark: '#2b241f',
      wallLight: '#55483d',
      accent: '#ffb45c',
      fog: '#050407',
    },
    layout: [
      '###########################',
      '#.........#.......#.......#',
      '#.........#.......#.......#',
      '#....##...#.......#..##...#',
      '#....##...#.......#..##...#',
      '#.........#.......#.......#',
      '#.........#.......#.......#',
      '#.........................#',
      '#....##...#.......#..##...#',
      '#....##...#.......#..##...#',
      '#.........#.......#.......#',
      '#.........#.......#.......#',
      '#....##...#.......#..##...#',
      '#.........#.......#.......#',
      '###########################',
    ],
    machineTiles: [[3, 3], [23, 3], [3, 11], [23, 11]],
    spawnTiles: [[2, 1], [24, 1], [2, 13], [24, 13], [13, 7]],
    propTypes: ['crate', 'barrel', 'pallet', 'canister', 'toolbox', 'cone'],
    ambientCount: 62,
    exitTile: [13, 13],
    lockerTiles: [[2, 7], [24, 7], [9, 13]],
    alarmTiles: [[13, 4]],
    fogTiles: [[15, 9]],
  },
  manor: {
    id: 'manor',
    name: 'Hollow Manor',
    description: 'Grand side rooms joined by a central hall. Prop heaven.',
    style: {
      floor: '#1d1714',
      floorLine: '#7a6350',
      wall: '#3b2a33',
      wallDark: '#2a1d24',
      wallLight: '#5b414f',
      accent: '#c58bff',
      fog: '#07040a',
    },
    layout: [
      '###########################',
      '#.......#.........#.......#',
      '#.......#.........#.......#',
      '#.......#.........#.......#',
      '#.......#.........#.......#',
      '#.......#.........#.......#',
      '#.......#####.#####.......#',
      '#.........................#',
      '#.......#####.#####.......#',
      '#.......#.........#.......#',
      '#.......#.........#.......#',
      '#.......#.........#.......#',
      '#.......#.........#.......#',
      '#.......#.........#.......#',
      '###########################',
    ],
    machineTiles: [[3, 2], [13, 2], [23, 2], [13, 11]],
    spawnTiles: [[2, 12], [24, 12], [2, 2], [24, 2], [13, 7]],
    propTypes: ['chair', 'plant', 'lamp', 'vase', 'table', 'crate'],
    ambientCount: 56,
    exitTile: [13, 13],
    lockerTiles: [[2, 7], [24, 7], [2, 10]],
    alarmTiles: [[13, 3]],
    fogTiles: [[20, 10]],
  },
};

const MAP_ORDER = ['asylum', 'warehouse', 'manor'];

function publicMapSummary() {
  return MAP_ORDER.map((id) => {
    const map = MAPS[id];
    return {
      id: map.id,
      name: map.name,
      description: map.description,
    };
  });
}

function publicMapDefinition(id) {
  const map = MAPS[id] || MAPS.asylum;
  return {
    id: map.id,
    name: map.name,
    description: map.description,
    style: map.style,
    layout: map.layout,
    machineTiles: map.machineTiles,
    spawnTiles: map.spawnTiles,
    propTypes: map.propTypes,
    ambientCount: map.ambientCount,
    exitTile: map.exitTile,
    lockerTiles: map.lockerTiles,
    alarmTiles: map.alarmTiles,
    fogTiles: map.fogTiles,
  };
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------
const players = new Map(); // socket.id -> player (connected clients, may be in menu)
const rooms = new Map(); // roomCode -> room
let nextPlayerNumber = 1;

// ---------------------------------------------------------------------------
// Math / geometry helpers
// ---------------------------------------------------------------------------
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distanceSq(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function angleDifference(a, b) {
  let difference = a - b;
  while (difference > Math.PI) difference -= Math.PI * 2;
  while (difference < -Math.PI) difference += Math.PI * 2;
  return difference;
}

function tileCenter(col, row) {
  return {
    x: col * TILE_SIZE + TILE_SIZE / 2,
    y: row * TILE_SIZE + TILE_SIZE / 2,
  };
}

function shuffle(list) {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function layoutIsWall(layout, col, row) {
  if (row < 0 || row >= layout.length) return true;
  if (col < 0 || col >= layout[0].length) return true;
  return layout[row][col] === '#';
}

function collidesWithWalls(map, x, y, half = PLAYER_HALF) {
  const layout = map.layout;
  const worldWidth = layout[0].length * TILE_SIZE;
  const worldHeight = layout.length * TILE_SIZE;

  if (
    x - half < 0 ||
    y - half < 0 ||
    x + half > worldWidth ||
    y + half > worldHeight
  ) {
    return true;
  }

  const minCol = Math.floor((x - half) / TILE_SIZE);
  const maxCol = Math.floor((x + half) / TILE_SIZE);
  const minRow = Math.floor((y - half) / TILE_SIZE);
  const maxRow = Math.floor((y + half) / TILE_SIZE);

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      if (!layoutIsWall(layout, col, row)) continue;

      const tileLeft = col * TILE_SIZE;
      const tileTop = row * TILE_SIZE;
      const tileRight = tileLeft + TILE_SIZE;
      const tileBottom = tileTop + TILE_SIZE;

      if (
        x + half > tileLeft &&
        x - half < tileRight &&
        y + half > tileTop &&
        y - half < tileBottom
      ) {
        return true;
      }
    }
  }

  return false;
}

function moveEntity(map, entity, dx, dy) {
  const nextX = entity.x + dx;
  if (!collidesWithWalls(map, nextX, entity.y)) {
    entity.x = nextX;
  }

  const nextY = entity.y + dy;
  if (!collidesWithWalls(map, entity.x, nextY)) {
    entity.y = nextY;
  }
}

function isWallAtWorld(map, x, y) {
  return layoutIsWall(
    map.layout,
    Math.floor(x / TILE_SIZE),
    Math.floor(y / TILE_SIZE),
  );
}

function hasLineOfSight(map, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return true;

  const steps = Math.ceil(distance / 8);
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    if (isWallAtWorld(map, x1 + dx * t, y1 + dy * t)) {
      return false;
    }
  }
  return true;
}

function killerCanSee(killer, target, visionRange = VISION_RANGE) {
  const dx = target.x - killer.x;
  const dy = target.y - killer.y;
  const distance = Math.hypot(dx, dy);

  if (distance > visionRange) return false;
  if (distance < 1) return true;

  const direction = Math.atan2(dy, dx);
  if (Math.abs(angleDifference(direction, killer.angle)) > VISION_HALF_ANGLE) {
    return false;
  }

  return hasLineOfSight(killer.mapRef, killer.x, killer.y, target.x, target.y);
}

function isCamouflaged(player) {
  return (
    player.role === 'survivor' &&
    player.morphed &&
    !player.downed &&
    player.stillMs >= CAMO_STILL_MS
  );
}

// ---------------------------------------------------------------------------
// Sanitising
// ---------------------------------------------------------------------------
function sanitizeName(rawName) {
  if (typeof rawName !== 'string') return `Player ${nextPlayerNumber}`;
  const clean = rawName.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  return clean.length > 0 ? clean : `Player ${nextPlayerNumber}`;
}

function sanitizeLook(rawLook) {
  const look = rawLook && typeof rawLook === 'object' ? rawLook : {};
  const body =
    typeof look.body === 'string' && /^#[0-9a-fA-F]{6}$/.test(look.body)
      ? look.body.toLowerCase()
      : DEFAULT_LOOK.body;

  const hat = VALID_HATS.includes(look.hat) ? look.hat : DEFAULT_LOOK.hat;
  const eyes = VALID_EYES.includes(look.eyes) ? look.eyes : DEFAULT_LOOK.eyes;

  let custom = null;
  if (
    typeof look.custom === 'string' &&
    look.custom.length > 0 &&
    // A dense 16x16 PNG can exceed 1 KB once base64 encoded.
    look.custom.length <= 2048 &&
    /^[A-Za-z0-9+/=]+$/.test(look.custom)
  ) {
    custom = look.custom;
  }

  return { body, hat, eyes, custom };
}

function sanitizeChat(rawText) {
  if (typeof rawText !== 'string') return '';
  return rawText
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, MAX_CHAT_LENGTH);
}

// ---------------------------------------------------------------------------
// Player helpers
// ---------------------------------------------------------------------------
function makeStats() {
  return { repaired: 0, revived: 0, hits: 0, downs: 0, finishes: 0, escapes: 0 };
}

function newSessionToken() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function createPlayer(socketId) {
  return {
    id: socketId,
    name: `Player ${nextPlayerNumber++}`,
    look: { ...DEFAULT_LOOK },
    roomCode: null,
    role: 'survivor',
    x: 0,
    y: 0,
    angle: 0,
    input: {
      up: false,
      down: false,
      left: false,
      right: false,
      repair: false,
      revive: false,
      sprint: false,
      track: false,
      trap: false,
      finish: false,
      throw: false,
      locker: false,
      useItem: false,
    },
    health: MAX_HEALTH,
    downed: false,
    dead: false,
    bleedOutAt: 0,
    morphed: false,
    propType: null,
    stillMs: 0,
    isRepairing: false,
    reviving: false,
    reviveProgress: 0,
    lastAttackAt: 0,
    sprintUntil: 0,
    nextSprintAt: 0,
    trackUntil: 0,
    nextTrackAt: 0,
    nextTrapAt: 0,
    rootUntil: 0,
    finishing: false,
    finishProgress: 0,
    finishingId: null,
    hiddenIn: null,
    escaped: false,
    escapeProgress: 0,
    item: null,
    itemUsed: false,
    throwReadyAt: 0,
    nextNoiseAt: 0,
    skillCheck: null,
    nextSkillAt: 0,
    pressLatch: {},
    stats: makeStats(),
    preference: 'any',
    sessionToken: null,
    disconnected: false,
    disconnectAt: 0,
    joinedAt: Date.now(),
    mapRef: null,
  };
}

function resetInput(player) {
  player.input.up = false;
  player.input.down = false;
  player.input.left = false;
  player.input.right = false;
  player.input.repair = false;
  player.input.revive = false;
  player.input.sprint = false;
  player.input.track = false;
  player.input.trap = false;
  player.input.finish = false;
  player.input.throw = false;
  player.input.locker = false;
  player.input.useItem = false;
}

function resetPlayerForRound(player) {
  player.health = MAX_HEALTH;
  player.downed = false;
  player.dead = false;
  player.bleedOutAt = 0;
  player.morphed = false;
  player.propType = null;
  player.stillMs = 0;
  player.isRepairing = false;
  player.reviving = false;
  player.reviveProgress = 0;
  player.lastAttackAt = 0;
  player.sprintUntil = 0;
  player.nextSprintAt = 0;
  player.trackUntil = 0;
  player.nextTrackAt = 0;
  player.nextTrapAt = 0;
  player.rootUntil = 0;
  player.finishing = false;
  player.finishProgress = 0;
  player.finishingId = null;
  player.hiddenIn = null;
  player.escaped = false;
  player.escapeProgress = 0;
  player.item = null;
  player.itemUsed = false;
  player.throwReadyAt = 0;
  player.nextNoiseAt = 0;
  player.skillCheck = null;
  player.nextSkillAt = 0;
  player.pressLatch = {};
  player.stats = makeStats();
  resetInput(player);
}

function downPlayer(player) {
  player.health = 0;
  player.downed = true;
  player.dead = false;
  player.bleedOutAt = Date.now() + BLEEDOUT_SECONDS * 1000;
  player.morphed = false;
  player.propType = null;
  player.isRepairing = false;
  player.reviving = false;
  player.reviveProgress = 0;
  player.stillMs = 0;
  player.rootUntil = 0;
  player.hiddenIn = null;
  player.skillCheck = null;
  player.finishing = false;
  player.finishProgress = 0;
  resetInput(player);
}

function randomPropType(map) {
  return map.propTypes[Math.floor(Math.random() * map.propTypes.length)];
}

// ---------------------------------------------------------------------------
// Room helpers
// ---------------------------------------------------------------------------
function generateRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 4; i += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  } while (rooms.has(code));
  return code;
}

function roomMembers(room) {
  const members = [];
  for (const id of room.members) {
    const player = players.get(id);
    if (player) members.push(player);
  }
  return members;
}

function activeSurvivors(room) {
  return roomMembers(room).filter(
    (player) =>
      player.role === 'survivor' &&
      !player.downed &&
      !player.dead &&
      !player.escaped &&
      !player.hiddenIn &&
      !player.disconnected,
  );
}

function repairedMachineCount(room) {
  return room.machines.filter((machine) => machine.repaired).length;
}

function makeMachines(map) {
  return map.machineTiles.map(([col, row], index) => {
    const center = tileCenter(col, row);
    return {
      id: `machine-${index + 1}`,
      x: center.x,
      y: center.y,
      progress: 0,
      repaired: false,
    };
  });
}

function makeLockers(map) {
  return (map.lockerTiles || []).map(([col, row], index) => {
    const center = tileCenter(col, row);
    return { id: `locker-${index + 1}`, x: center.x, y: center.y };
  });
}

function makeAlarms(map) {
  return (map.alarmTiles || []).map(([col, row], index) => {
    const center = tileCenter(col, row);
    return { id: `alarm-${index + 1}`, x: center.x, y: center.y, nextAt: 0 };
  });
}

function makeFogs(map) {
  return (map.fogTiles || []).map(([col, row], index) => {
    const center = tileCenter(col, row);
    return { id: `fog-${index + 1}`, x: center.x, y: center.y, radius: TILE_SIZE * 2.4 };
  });
}

function nearestLocker(room, x, y, range) {
  let best = null;
  let bestDistance = Infinity;
  for (const locker of room.lockers) {
    const distance = Math.sqrt(distanceSq(x, y, locker.x, locker.y));
    if (distance <= range && distance < bestDistance) {
      best = locker;
      bestDistance = distance;
    }
  }
  return best;
}

function nearestDownedSurvivor(room, x, y, range, requireSight = false) {
  let best = null;
  let bestDistance = Infinity;
  const map = requireSight ? MAPS[room.mapId] : null;
  for (const member of roomMembers(room)) {
    if (member.role !== 'survivor' || !member.downed || member.dead) continue;
    const distance = Math.sqrt(distanceSq(x, y, member.x, member.y));
    if (distance > range || distance >= bestDistance) continue;
    if (requireSight && !hasLineOfSight(map, x, y, member.x, member.y)) continue;
    best = member;
    bestDistance = distance;
  }
  return best;
}

function pressed(player, key) {
  if (!player.pressLatch) player.pressLatch = {};
  const down = player.input[key] === true;
  const was = player.pressLatch[key] === true;
  player.pressLatch[key] = down;
  return down && !was;
}

function emitNoise(room, x, y, kind) {
  const killer = roomMembers(room).find((member) => member.role === 'killer');
  if (!killer) return;
  const distance = Math.sqrt(distanceSq(killer.x, killer.y, x, y));
  if (distance > NOISE_RANGE) return;
  io.to(killer.id).emit('noise', {
    x: Math.round(x),
    y: Math.round(y),
    kind,
    distance: Math.round(distance),
  });
}

function killerInFog(room, killer) {
  if (!killer) return false;
  return (room.fogs || []).some(
    (fog) => distanceSq(killer.x, killer.y, fog.x, fog.y) <= fog.radius * fog.radius,
  );
}

function completeMachine(room, machine, player) {
  if (machine.repaired) return;
  machine.progress = 100;
  machine.repaired = true;
  if (player) player.stats.repaired += 1;

  // A repairer still holding a skill check on this machine should not be
  // penalised for a check that no longer exists.
  for (const member of roomMembers(room)) {
    if (!member.skillCheck) continue;
    if (distanceSq(member.x, member.y, machine.x, machine.y) <= REPAIR_RANGE * REPAIR_RANGE) {
      member.skillCheck = null;
    }
  }

  io.to(room.code).emit('machineRepaired', {
    machineId: machine.id,
    repairedCount: repairedMachineCount(room),
    totalMachines: room.machines.length,
  });
  addSystemChat(
    room,
    `Propmachine online (${repairedMachineCount(room)}/${room.machines.length}). The Killer grows stronger.`,
  );

  if (repairedMachineCount(room) >= room.machines.length) openExit(room);
}

function openExit(room) {
  if (room.exitOpen) return;
  room.exitOpen = true;
  io.to(room.code).emit('exitOpen', { x: room.exit.x, y: room.exit.y });
  addSystemChat(room, 'ALL PROPMACHINES ONLINE - the exit gate is open. RUN.');
}

function rollSkillCheck(player, now) {
  const durationMs = SKILL_DURATION_MS;
  const windowMs = SKILL_WINDOW_MS;
  const zoneStart = 420 + Math.random() * (durationMs - 620 - windowMs);
  player.skillSeq = (player.skillSeq || 0) + 1;
  player.skillCheck = {
    seq: player.skillSeq,
    startedAt: now,
    durationMs,
    zoneStart,
    zoneEnd: zoneStart + windowMs,
  };
  player.nextSkillAt = now + SKILL_MIN_MS + Math.random() * (SKILL_MAX_MS - SKILL_MIN_MS);
  io.to(player.id).emit('skillCheck', {
    seq: player.skillCheck.seq,
    durationMs,
    zoneStart,
    zoneEnd: player.skillCheck.zoneEnd,
  });
}

function applySkillBonus(room, player) {
  const machine = nearestMachine(room, player.x, player.y, 0, true);
  if (machine && !machine.repaired) {
    machine.progress = clamp(machine.progress + SKILL_BONUS, 0, 100);
    if (machine.progress >= 100) completeMachine(room, machine, player);
  }
  player.skillCheck = null;
}

function applySkillPenalty(room, player) {
  const machine = nearestMachine(room, player.x, player.y, 0, true);
  if (machine && !machine.repaired) {
    machine.progress = clamp(machine.progress - SKILL_PENALTY, 0, 100);
  }
  emitNoise(room, player.x, player.y, 'fail');
  player.skillCheck = null;
}

function useItem(room, player, now) {
  if (!player.item || player.itemUsed) return;

  if (player.item === 'flashlight') {
    const killer = roomMembers(room).find((member) => member.role === 'killer');
    if (killer && !killer.downed && !killer.dead) {
      const distance = Math.sqrt(distanceSq(player.x, player.y, killer.x, killer.y));
      const direction = Math.atan2(killer.y - player.y, killer.x - player.x);
      const facing = Math.abs(angleDifference(direction, player.angle)) <= Math.PI / 3;
      if (
        distance <= FLASHLIGHT_RANGE &&
        facing &&
        hasLineOfSight(MAPS[room.mapId], player.x, player.y, killer.x, killer.y)
      ) {
        killer.rootUntil = now + FLASHLIGHT_STUN_MS;
        player.itemUsed = true;
        io.to(room.code).emit('flash', { id: player.id, x: killer.x, y: killer.y });
        emitNoise(room, player.x, player.y, 'flash');
        addSystemChat(room, `${player.name} blinded the Killer!`);
      }
    }
  } else if (player.item === 'toolbox') {
    const machine = nearestMachine(room, player.x, player.y, ITEM_USE_RANGE, true);
    if (machine) {
      player.itemUsed = true;
      machine.progress = clamp(machine.progress + TOOLBOX_PROGRESS, 0, 100);
      if (machine.progress >= 100) completeMachine(room, machine, player);
      io.to(room.code).emit('itemUsed', {
        id: player.id,
        item: 'toolbox',
        machineId: machine.id,
      });
      emitNoise(room, player.x, player.y, 'toolbox');
    }
  } else if (player.item === 'medkit') {
    if (player.health < MAX_HEALTH) {
      player.health = Math.min(MAX_HEALTH, player.health + MEDKIT_HEAL);
      player.itemUsed = true;
      io.to(room.code).emit('itemUsed', {
        id: player.id,
        item: 'medkit',
        health: player.health,
      });
    }
  }

  if (player.itemUsed) broadcastSnapshots(room);
}

function throwProp(room, player, now) {
  if (
    room.state !== 'playing' ||
    player.role !== 'survivor' ||
    player.downed ||
    player.dead ||
    player.escaped ||
    player.hiddenIn
  ) {
    return;
  }
  const angle = player.angle;
  room.projectileSeq = (room.projectileSeq || 0) + 1;
  room.projectiles.push({
    id: `prop-${room.projectileSeq}`,
    ownerId: player.id,
    x: player.x + Math.cos(angle) * 18,
    y: player.y + Math.sin(angle) * 18,
    vx: Math.cos(angle) * THROW_SPEED,
    vy: Math.sin(angle) * THROW_SPEED,
    expiresAt: now + THROW_LIFETIME_MS,
  });
  player.throwReadyAt = now + THROW_COOLDOWN_MS;
  io.to(room.code).emit('throw', { id: player.id, angle });
}

function toggleLocker(room, player, now) {
  if (player.downed || player.dead) return;

  if (player.hiddenIn) {
    player.hiddenIn = null;
    io.to(room.code).emit('locker', { id: player.id, hidden: false });
    return;
  }

  if (player.role === 'killer') {
    const locker = nearestLocker(room, player.x, player.y, LOCKER_RANGE);
    if (!locker) return;
    const victim = roomMembers(room).find(
      (member) => member.role === 'survivor' && member.hiddenIn === locker.id,
    );
    if (victim) {
      victim.hiddenIn = null;
      victim.rootUntil = now + LOCKER_EJECT_ROOT_MS;
      victim.x = locker.x;
      victim.y = locker.y;
      io.to(room.code).emit('lockerFound', {
        lockerId: locker.id,
        id: victim.id,
        name: victim.name,
        x: locker.x,
        y: locker.y,
      });
      addSystemChat(room, `${player.name} found ${victim.name} hiding!`);
      emitNoise(room, locker.x, locker.y, 'locker');
    } else {
      io.to(player.id).emit('lockerEmpty', { lockerId: locker.id });
    }
    return;
  }

  const locker = nearestLocker(room, player.x, player.y, LOCKER_RANGE);
  if (!locker) return;
  const occupied = roomMembers(room).some((member) => member.hiddenIn === locker.id);
  if (occupied) return;

  player.hiddenIn = locker.id;
  player.x = locker.x;
  player.y = locker.y;
  player.morphed = false;
  player.propType = null;
  player.skillCheck = null;
  player.escapeProgress = 0;
  io.to(room.code).emit('locker', { id: player.id, hidden: true, lockerId: locker.id });
}

function updateProjectiles(room, dt, now) {
  if (!room.projectiles || room.projectiles.length === 0) return;

  const map = MAPS[room.mapId];
  const killer = roomMembers(room).find((member) => member.role === 'killer');

  room.projectiles = room.projectiles.filter((projectile) => {
    if (now >= projectile.expiresAt) return false;

    const nextX = projectile.x + projectile.vx * dt;
    const nextY = projectile.y + projectile.vy * dt;
    if (isWallAtWorld(map, nextX, nextY)) {
      io.to(room.code).emit('propBreak', { x: nextX, y: nextY });
      return false;
    }

    projectile.x = nextX;
    projectile.y = nextY;

    if (killer && !killer.downed && !killer.dead) {
      const distance = Math.sqrt(
        distanceSq(projectile.x, projectile.y, killer.x, killer.y),
      );
      if (distance <= THROW_RADIUS + PLAYER_HALF) {
        killer.rootUntil = now + THROW_STUN_MS;
        io.to(room.code).emit('stun', {
          x: killer.x,
          y: killer.y,
          by: projectile.ownerId,
        });
        emitNoise(room, killer.x, killer.y, 'stun');
        return false;
      }
    }

    return true;
  });
}

function updateHazards(room, now) {
  for (const alarm of room.alarms || []) {
    if (now < alarm.nextAt) continue;
    const trigger = roomMembers(room).find(
      (member) =>
        member.role === 'survivor' &&
        !member.downed &&
        !member.dead &&
        !member.escaped &&
        !member.hiddenIn &&
        !member.disconnected &&
        distanceSq(member.x, member.y, alarm.x, alarm.y) <= ALARM_RADIUS * ALARM_RADIUS,
    );
    if (!trigger) continue;

    alarm.nextAt = now + ALARM_COOLDOWN_MS;
    emitNoise(room, alarm.x, alarm.y, 'alarm');
    io.to(room.code).emit('alarm', { id: alarm.id, x: alarm.x, y: alarm.y, by: trigger.id });
    addSystemChat(room, `An alarm shrieks near ${trigger.name}!`);
  }
}

function updateBleedOut(room, now) {
  for (const player of roomMembers(room)) {
    if (!player.downed || player.dead || player.escaped) continue;
    if (!player.bleedOutAt || now < player.bleedOutAt) continue;

    player.dead = true;
    player.health = 0;
    player.reviveProgress = 0;
    player.skillCheck = null;
    player.bleedOutAt = 0;
    io.to(room.code).emit('bledOut', { id: player.id, name: player.name });
    addSystemChat(room, `${player.name} bled out.`);
  }
}

function updateFinish(room, killer, now, dt) {
  const target = killer.input.finish && killer.rootUntil <= now
    ? nearestDownedSurvivor(room, killer.x, killer.y, FINISH_RANGE, true)
    : null;

  const previous = killer.finishingId
    ? roomMembers(room).find((member) => member.id === killer.finishingId)
    : null;

  if (target) {
    if (previous && previous.id !== target.id) previous.finishProgress = 0;
    killer.finishing = true;
    killer.finishingId = target.id;
    killer.finishProgress = clamp(
      killer.finishProgress + (100 / FINISH_SECONDS) * dt,
      0,
      100,
    );
    target.finishProgress = killer.finishProgress;

    if (killer.finishProgress >= 100) {
      target.dead = true;
      target.downed = true;
      target.health = 0;
      target.bleedOutAt = 0;
      target.finishProgress = 100;
      killer.stats.finishes += 1;
      killer.finishProgress = 0;
      killer.finishing = false;
      killer.finishingId = null;
      io.to(room.code).emit('executed', {
        id: target.id,
        name: target.name,
        by: killer.id,
      });
      addSystemChat(room, `${target.name} was finished.`);
    }
    return;
  }

  killer.finishing = false;
  killer.finishingId = null;
  killer.finishProgress = Math.max(
    0,
    killer.finishProgress - FINISH_DECAY_PER_SECOND * dt,
  );
  if (previous) {
    previous.finishProgress = Math.max(
      0,
      previous.finishProgress - FINISH_DECAY_PER_SECOND * dt,
    );
  }
}

function pickSpawnForRoom(room, excludeIds = []) {
  const map = MAPS[room.mapId];
  const points = map.spawnTiles.map(([col, row]) => tileCenter(col, row));
  const members = roomMembers(room).filter(
    (player) => !excludeIds.includes(player.id),
  );

  const shuffled = shuffle(points);
  let best = shuffled[0];
  let bestDistance = -1;

  for (const point of shuffled) {
    let closest = Infinity;
    for (const player of members) {
      closest = Math.min(
        closest,
        Math.sqrt(distanceSq(point.x, point.y, player.x, player.y)),
      );
    }
    if (closest > bestDistance) {
      best = point;
      bestDistance = closest;
    }
  }

  return { ...best };
}

function addChat(room, message) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts: Date.now(),
    system: false,
    channel: 'all',
    ...message,
  };

  room.chat.push(entry);
  if (room.chat.length > 80) room.chat.shift();
  return entry;
}

function addSystemChat(room, text) {
  const entry = addChat(room, {
    system: true,
    from: null,
    name: 'SYSTEM',
    role: null,
    channel: 'all',
    text,
  });
  io.to(room.code).emit('chat:message', entry);
}

function chatHistoryFor(room, player) {
  return room.chat.filter(
    (entry) =>
      entry.channel !== 'team' ||
      entry.system ||
      entry.role === player.role,
  );
}

function broadcastChat(room, message) {
  if (message.system) {
    io.to(room.code).emit('chat:message', message);
    return;
  }

    // Team chat only reaches players of the same role.
    if (message.channel === 'team') {
    for (const id of room.members) {
      const player = players.get(id);
      if (player && player.role === message.role) {
        io.to(id).emit('chat:message', message);
      }
    }
    return;
  }

  io.to(room.code).emit('chat:message', message);
}

function broadcastRoomUpdate(room) {
  const base = {
    code: room.code,
    name: room.name,
    hostId: room.hostId,
    mapId: room.mapId,
    state: room.state,
    round: room.round,
    hasPassword: !!room.password,
    players: roomMembers(room).map((player) => ({
      id: player.id,
      name: player.name,
      role: player.role,
      look: player.look,
      isHost: player.id === room.hostId,
      downed: player.downed,
      dead: !!player.dead,
      escaped: !!player.escaped,
      preference: player.preference,
      disconnected: !!player.disconnected,
    })),
  };

  for (const id of room.members) {
    io.to(id).emit('room:update', { ...base, isHost: id === room.hostId });
  }
}

function buildGameInit(room, socketId) {
  return {
    id: socketId,
    roomCode: room.code,
    mapId: room.mapId,
    map: publicMapDefinition(room.mapId),
    machines: room.machines.map(serializeMachine),
    config: GAME_CONFIG,
  };
}

function joinRoom(socket, room, player, password) {
  if (room.password && password !== room.password) {
    socket.emit('room:passwordRequired', { code: room.code });
    return false;
  }

  if (room.members.size >= MAX_PLAYERS) {
    socket.emit('room:error', { message: 'That room is full.' });
    return false;
  }

  // A finished round drops back to the lobby so newcomers are not stranded
  // watching an ended match.
  if (room.state === 'ended') {
    resetRoomToLobby(room);
  }

  leaveRoom(player, { silent: true });

  player.roomCode = room.code;
  player.role = 'survivor';
  player.mapRef = MAPS[room.mapId];
  player.sessionToken = newSessionToken();
  player.disconnected = false;
  player.disconnectAt = 0;

  if (room.state === 'playing') {
    // Joining an active match drops you in as a fresh survivor.
    player.role = 'survivor';
    resetPlayerForRound(player);
    player.item =
      SURVIVOR_ITEMS[Math.floor(Math.random() * SURVIVOR_ITEMS.length)];
    const spawn = pickSpawnForRoom(room, [player.id]);
    player.x = spawn.x;
    player.y = spawn.y;
    player.angle = Math.atan2(
      (room.mapRef.layout.length * TILE_SIZE) / 2 - spawn.y,
      (room.mapRef.layout[0].length * TILE_SIZE) / 2 - spawn.x,
    );
  } else {
    const spawn = pickSpawnForRoom(room, [player.id]);
    player.x = spawn.x;
    player.y = spawn.y;
    player.angle = 0;
  }

  room.members.add(player.id);
  socket.join(room.code);

  socket.emit('room:joined', {
    code: room.code,
    name: room.name,
    hostId: room.hostId,
    mapId: room.mapId,
    state: room.state,
    hasPassword: !!room.password,
    you: player.id,
    isHost: player.id === room.hostId,
    session: player.sessionToken,
    maps: publicMapSummary(),
    config: GAME_CONFIG,
    maxPlayers: MAX_PLAYERS,
    players: roomMembers(room).map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      look: member.look,
      isHost: member.id === room.hostId,
      downed: member.downed,
      dead: !!member.dead,
      escaped: !!member.escaped,
      preference: member.preference,
    })),
  });

  socket.emit('chat:history', chatHistoryFor(room, player));
  addSystemChat(room, `${player.name} joined the room.`);
  broadcastRoomUpdate(room);

  if (room.state === 'playing') {
    socket.emit('game:init', buildGameInit(room, player.id));
    broadcastSnapshots(room);
  }

  return true;
}

function leaveRoom(player, options = {}) {
  const room = rooms.get(player.roomCode);
  if (!room) return;

  const wasKiller = player.role === 'killer' && room.state === 'playing';
  room.members.delete(player.id);
  player.roomCode = null;
  player.role = 'survivor';
  resetPlayerForRound(player);

  try {
    io.sockets.sockets.get(player.id)?.leave(room.code);
  } catch (error) {
    // Socket may already be gone; nothing to clean up on the channel.
  }

  if (room.members.size === 0) {
    rooms.delete(room.code);
    return;
  }

  if (!options.silent) {
    addSystemChat(room, `${player.name} left the room.`);
  }

  if (room.hostId === player.id) {
    const connectedHost = [...room.members].find((id) => {
      const member = players.get(id);
      return member && !member.disconnected;
    });
    room.hostId = connectedHost || [...room.members][0];
    const host = players.get(room.hostId);
    addSystemChat(room, `${host ? host.name : 'A player'} is now the host.`);
  }

  if (wasKiller) {
    promoteKiller(room);
  }

  broadcastRoomUpdate(room);
  broadcastSnapshots(room);
}

function promoteKiller(room) {
  let candidates = activeSurvivors(room);
  if (candidates.length === 0) {
    // If every remaining survivor is hiding, still promote one so the round
    // cannot stall without a killer. resetPlayerForRound() pulls them out.
    candidates = roomMembers(room).filter(
      (member) =>
        member.role === 'survivor' &&
        !member.downed &&
        !member.dead &&
        !member.escaped &&
        !member.disconnected,
    );
  }
  if (candidates.length === 0) return null;

  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  for (const member of roomMembers(room)) {
    member.role = member === chosen ? 'killer' : 'survivor';
  }
  resetPlayerForRound(chosen);
  chosen.propType = null;

  addSystemChat(room, `${chosen.name} is now the Killer.`);
  return chosen;
}

function createRoom(socket, player, options = {}) {
  const code = generateRoomCode();
  const mapId = MAPS[options.mapId] ? options.mapId : 'asylum';
  const password =
    typeof options.password === 'string'
      ? options.password.trim().slice(0, 32)
      : '';
  const room = {
    code,
    name: sanitizeName(options.roomName || `Room ${code}`),
    hostId: player.id,
    mapId,
    password: password || null,
    state: 'lobby',
    round: 0,
    members: new Set(),
    machines: [],
    traps: [],
    trapSeq: 0,
    projectiles: [],
    projectileSeq: 0,
    lockers: [],
    alarms: [],
    fogs: [],
    exit: null,
    exitOpen: false,
    lastKillerId: null,
    lastResult: null,
    chat: [],
    snapshotAcc: 0,
    createdAt: Date.now(),
  };

  rooms.set(code, room);
  return joinRoom(socket, room, player, room.password) ? room : null;
}

function findRoomByCode(rawCode) {
  if (typeof rawCode !== 'string') return null;
  return rooms.get(rawCode.trim().toUpperCase()) || null;
}

function quickJoinRoom(socket, player) {
  const openRooms = [...rooms.values()].filter(
    (room) => room.members.size < MAX_PLAYERS && !room.password,
  );

  if (openRooms.length > 0) {
    openRooms.sort((a, b) => b.members.size - a.members.size);
    if (joinRoom(socket, openRooms[0], player)) return;
  }

  createRoom(socket, player, {});
}

// ---------------------------------------------------------------------------
// Game start / round flow
// ---------------------------------------------------------------------------
function startGame(room, requesterId) {
  const requester = players.get(requesterId);
  if (!requester || requester.id !== room.hostId) return 'Only the host can start.';
  if (room.state !== 'lobby') return 'The round is already in progress.';

  const members = roomMembers(room);
  if (members.length < 2) return 'You need at least 2 players.';
  const activeMembers = members.filter((member) => !member.disconnected);
  if (activeMembers.length < 2) return 'Wait for reconnecting players before starting.';

  room.state = 'playing';
  room.round += 1;
  room.winner = null;
  room.endReason = null;
  room.lastResult = null;
  room.machines = makeMachines(MAPS[room.mapId]);
  room.mapRef = MAPS[room.mapId];
  room.traps = [];
  room.trapSeq = 0;
  room.projectiles = [];
  room.projectileSeq = 0;
  room.lockers = makeLockers(room.mapRef);
  room.alarms = makeAlarms(room.mapRef);
  room.fogs = makeFogs(room.mapRef);
  room.exit = tileCenter(...room.mapRef.exitTile);
  room.exitOpen = false;

  // Role preference hints the killer pick; with 4+ players the previous
  // killer is skipped so the same person is not hunted every round.
  let pool = activeMembers;
  if (activeMembers.length > 3 && room.lastKillerId) {
    const rotated = activeMembers.filter((member) => member.id !== room.lastKillerId);
    if (rotated.length > 0) pool = rotated;
  }
  const eager = pool.filter((member) => member.preference === 'killer');
  if (eager.length > 0) pool = eager;

  const chosen = pool[Math.floor(Math.random() * pool.length)];
  room.lastKillerId = chosen.id;
  for (const member of members) {
    member.role = member === chosen ? 'killer' : 'survivor';
    member.mapRef = room.mapRef;
    resetPlayerForRound(member);
    if (member.role === 'survivor') {
      member.item =
        SURVIVOR_ITEMS[Math.floor(Math.random() * SURVIVOR_ITEMS.length)];
    }
  }

  // Spread everyone over the map's spawn points.
  const spawns = shuffle(
    MAPS[room.mapId].spawnTiles.map(([col, row]) => tileCenter(col, row)),
  );
  members.forEach((member, index) => {
    const spawn = spawns[index % spawns.length];
    member.x = spawn.x;
    member.y = spawn.y;
    member.angle = Math.atan2(
      (MAPS[room.mapId].layout.length * TILE_SIZE) / 2 - spawn.y,
      (MAPS[room.mapId].layout[0].length * TILE_SIZE) / 2 - spawn.x,
    );
  });

  addSystemChat(room, `Round ${room.round} started on ${MAPS[room.mapId].name}.`);
  addSystemChat(room, `${chosen.name} is the Killer!`);
  broadcastRoomUpdate(room);

  for (const id of room.members) {
    io.to(id).emit('game:init', buildGameInit(room, id));
  }

  broadcastSnapshots(room);
  return null;
}

// ---------------------------------------------------------------------------
// Serialisation / snapshots
// ---------------------------------------------------------------------------
function serializeMachine(machine) {
  return {
    id: machine.id,
    x: machine.x,
    y: machine.y,
    progress: Math.round(machine.progress * 10) / 10,
    repaired: machine.repaired,
  };
}

function serializePlayer(player, viewer) {
  const now = Date.now();
  const isSelf = !viewer || viewer.id === player.id;
  return {
    id: player.id,
    name: player.name,
    role: player.role,
    look: player.look,
    x: Math.round(player.x * 10) / 10,
    y: Math.round(player.y * 10) / 10,
    angle: Math.round(player.angle * 1000) / 1000,
    health: player.health,
    downed: player.downed,
    dead: !!player.dead,
    escaped: !!player.escaped,
    hidden: !!player.hiddenIn,
    escapeProgress: Math.round(player.escapeProgress || 0),
    finishProgress: Math.round(player.finishProgress || 0),
    bleedRemaining:
      player.downed && !player.dead && player.bleedOutAt
        ? Math.max(0, Math.ceil((player.bleedOutAt - now) / 1000))
        : 0,
    item: isSelf ? player.item : null,
    itemUsed: isSelf ? !!player.itemUsed : false,
    throwReadyAt: isSelf ? player.throwReadyAt : 0,
    finishing: !!player.finishing,
    morphed: player.morphed,
    propType: player.propType,
    camouflaged: isCamouflaged(player),
    repairing: player.isRepairing,
    reviving: !!player.reviving,
    reviveProgress: player.downed ? Math.round(player.reviveProgress) : 0,
    sprinting: !!player.sprintUntil && now < player.sprintUntil,
    rooted: !!player.rootUntil && now < player.rootUntil,
  };
}

function buildStateFor(room, socketId) {
  const recipient = players.get(socketId);
  if (!recipient) return null;

  const power = killerPower(room);
  const map = MAPS[room.mapId];
  const now = Date.now();
  if (recipient.role === 'killer' && killerInFog(room, recipient)) {
    power.visionRange = Math.round(power.visionRange * FOG_VISION_MULTIPLIER);
  }
  const visiblePlayers = [];
  const tracking = recipient.role === 'killer' && recipient.trackUntil > now;

  for (const member of roomMembers(room)) {
    // Never reveal that another player is hidden inside a locker.
    if (member.hiddenIn && member.id !== recipient.id) continue;

    const isOtherSurvivor =
      recipient.role === 'killer' &&
      member.id !== recipient.id &&
      member.role === 'survivor';

    if (
      isOtherSurvivor &&
      !tracking &&
      !killerCanSee({ ...recipient, mapRef: map }, member, power.visionRange)
    ) {
      continue;
    }

    visiblePlayers.push(serializePlayer(member, recipient));
  }

  const survivors = roomMembers(room).filter(
    (member) => member.role === 'survivor',
  );

  const killerAbilities =
    recipient.role === 'killer'
      ? {
          sprintUntil: recipient.sprintUntil,
          sprintReadyAt: recipient.nextSprintAt,
          trackUntil: recipient.trackUntil,
          trackReadyAt: recipient.nextTrackAt,
          trapReadyAt: recipient.nextTrapAt,
          maxTraps: power.maxTraps,
          traps: room.traps.map((trap) => ({
            id: trap.id,
            x: Math.round(trap.x),
            y: Math.round(trap.y),
            armed: now >= trap.armedAt,
          })),
        }
      : null;

  return {
    t: now,
    roomCode: room.code,
    me: socketId,
    myRole: recipient.role,
    players: visiblePlayers,
    machines: room.machines.map(serializeMachine),
    repairedCount: repairedMachineCount(room),
    totalMachines: room.machines.length,
    survivorsAlive: survivors.filter(
      (member) => !member.downed && !member.dead && !member.escaped,
    ).length,
    totalSurvivors: survivors.length,
    matchState: room.state,
    winner: room.winner || null,
    power,
    exit: room.exit
      ? {
          x: room.exit.x,
          y: room.exit.y,
          open: !!room.exitOpen,
        }
      : null,
    skillCheck: recipient.skillCheck
      ? {
          seq: recipient.skillCheck.seq,
          startedAt: recipient.skillCheck.startedAt,
          durationMs: recipient.skillCheck.durationMs,
          zoneStart: recipient.skillCheck.zoneStart,
          zoneEnd: recipient.skillCheck.zoneEnd,
        }
      : null,
    projectiles: (room.projectiles || []).map((projectile) => ({
      id: projectile.id,
      x: Math.round(projectile.x),
      y: Math.round(projectile.y),
    })),
    killerAbilities,
  };
}

function broadcastSnapshots(room) {
  if (room.state !== 'playing') return;
  for (const id of room.members) {
    const state = buildStateFor(room, id);
    if (state) io.to(id).emit('state', state);
  }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
function nearestMachine(room, x, y, extraRange = 0, requireSight = false) {
  let nearest = null;
  let nearestDistance = Infinity;
  const map = requireSight ? MAPS[room.mapId] : null;

  for (const machine of room.machines) {
    if (machine.repaired) continue;
    const distance = Math.sqrt(distanceSq(x, y, machine.x, machine.y));
    if (distance > REPAIR_RANGE + extraRange || distance >= nearestDistance) continue;
    if (requireSight && !hasLineOfSight(map, x, y, machine.x, machine.y)) continue;
    nearest = machine;
    nearestDistance = distance;
  }

  return nearest;
}

function performAttack(room, killer) {
  const now = Date.now();
  const power = killerPower(room);
  if (killer.rootUntil > now) return;
  if (now - killer.lastAttackAt < power.attackCooldownMs) return;

  killer.lastAttackAt = now;
  const map = MAPS[room.mapId];
  const hitVictims = [];

  for (const member of roomMembers(room)) {
    if (member.role !== 'survivor' || member.downed || member.dead) continue;
    if (member.escaped || member.hiddenIn) continue;

    const dx = member.x - killer.x;
    const dy = member.y - killer.y;
    const distance = Math.hypot(dx, dy);
    if (distance > ATTACK_RANGE + PLAYER_HALF) continue;

    const direction = Math.atan2(dy, dx);
    if (Math.abs(angleDifference(direction, killer.angle)) > ATTACK_HALF_ANGLE) {
      continue;
    }

    if (!hasLineOfSight(map, killer.x, killer.y, member.x, member.y)) continue;

    member.health = Math.max(0, member.health - MELEE_DAMAGE);
    if (member.health <= 0) downPlayer(member);
    hitVictims.push(member.id);
  }

  if (hitVictims.length > 0) {
    killer.stats.hits += 1;
    for (const id of hitVictims) {
      const victim = players.get(id);
      if (victim && victim.downed) killer.stats.downs += 1;
    }
  }

  let hitMachine = null;
  let hitMachineDistance = Infinity;

  for (const machine of room.machines) {
    if (machine.repaired) continue;

    const dx = machine.x - killer.x;
    const dy = machine.y - killer.y;
    const distance = Math.hypot(dx, dy);
    if (distance > ATTACK_RANGE + 24) continue;

    const direction = Math.atan2(dy, dx);
    if (Math.abs(angleDifference(direction, killer.angle)) > ATTACK_HALF_ANGLE) {
      continue;
    }

    if (!hasLineOfSight(map, killer.x, killer.y, machine.x, machine.y)) continue;

    if (distance < hitMachineDistance) {
      hitMachine = machine;
      hitMachineDistance = distance;
    }
  }

  if (hitMachine) {
    hitMachine.progress = clamp(hitMachine.progress - MACHINE_REGRESS, 0, 100);
  }

  io.to(room.code).emit('attack', {
    id: killer.id,
    x: Math.round(killer.x * 10) / 10,
    y: Math.round(killer.y * 10) / 10,
    angle: killer.angle,
    hitCount: hitVictims.length,
    machineId: hitMachine ? hitMachine.id : null,
  });

  if (hitVictims.length > 0) {
    io.to(room.code).emit('hit', {
      attackerId: killer.id,
      victimIds: hitVictims,
    });
  }

  if (hitMachine) {
    io.to(room.code).emit('machineHit', {
      machineId: hitMachine.id,
      x: hitMachine.x,
      y: hitMachine.y,
    });
  }

  broadcastSnapshots(room);
}

// Killer abilities: sprint burst, tracking pulse, trap placement - all gated
// by per-machine cooldowns from killerPower().
function handleKillerAbilities(room, killer, power, now) {
  if (killer.rootUntil > now) return;

  if (pressed(killer, 'sprint') && now >= killer.nextSprintAt) {
    killer.nextSprintAt = now + power.sprintCooldownMs;
    killer.sprintUntil = now + power.sprintDurationMs;
    io.to(room.code).emit('ability', {
      id: killer.id,
      ability: 'sprint',
      durationMs: power.sprintDurationMs,
    });
  }

  if (pressed(killer, 'track') && now >= killer.nextTrackAt) {
    killer.nextTrackAt = now + power.trackCooldownMs;
    killer.trackUntil = now + power.trackDurationMs;
    io.to(room.code).emit('ability', {
      id: killer.id,
      ability: 'track',
      durationMs: power.trackDurationMs,
    });
    addSystemChat(room, `${killer.name} senses every survivor.`);
  }

  if (
    pressed(killer, 'trap') &&
    now >= killer.nextTrapAt &&
    room.traps.length < power.maxTraps
  ) {
    killer.nextTrapAt = now + power.trapCooldownMs;
    room.trapSeq += 1;
    const trap = {
      id: `trap-${room.trapSeq}`,
      x: killer.x,
      y: killer.y,
      armedAt: now + TRAP_ARM_MS,
      expiresAt: now + TRAP_LIFETIME_MS,
    };
    room.traps.push(trap);
    io.to(killer.id).emit('ability', {
      id: killer.id,
      ability: 'trap',
      trapId: trap.id,
      x: killer.x,
      y: killer.y,
    });
  }
}

// Traps arm shortly after placement, snare the first survivor who steps on
// them, and expire after TRAP_LIFETIME_MS.
function updateTraps(room, power, now) {
  if (room.traps.length === 0) return;

  const survivors = roomMembers(room).filter(
    (player) =>
      player.role === 'survivor' &&
      !player.downed &&
      !player.dead &&
      !player.escaped &&
      !player.hiddenIn &&
      !player.disconnected,
  );

  room.traps = room.traps.filter((trap) => {
    if (now >= trap.expiresAt) return false;
    if (now < trap.armedAt) return true;

    for (const survivor of survivors) {
      if (
        Math.sqrt(distanceSq(survivor.x, survivor.y, trap.x, trap.y)) >
        TRAP_RADIUS + PLAYER_HALF
      ) {
        continue;
      }

      survivor.rootUntil = now + power.trapRootMs;
      survivor.morphed = false;
      survivor.propType = null;
      survivor.isRepairing = false;
      survivor.skillCheck = null;
      io.to(room.code).emit('trapTriggered', {
        id: survivor.id,
        trapId: trap.id,
        x: trap.x,
        y: trap.y,
        rootMs: power.trapRootMs,
      });
      addSystemChat(room, `${survivor.name} was snared by a trap.`);
      return false;
    }

    return true;
  });
}

function updateSkillChecks(room, now) {
  for (const player of roomMembers(room)) {
    const check = player.skillCheck;
    if (!check) continue;
    if (now <= check.startedAt + check.durationMs + SKILL_TOLERANCE_MS) continue;

    applySkillPenalty(room, player);
    io.to(player.id).emit('skillResult', {
      seq: check.seq,
      success: false,
      reason: 'missed',
    });
  }
}

function handleSurvivorActions(room, player, now, dt, rooted) {
  const input = player.input;

  // Escape gate: hold REPAIR at the gate once every propmachine is online.
  if (room.exitOpen && room.exit) {
    const atExit =
      Math.sqrt(distanceSq(player.x, player.y, room.exit.x, room.exit.y)) <=
      EXIT_RANGE;

    if (atExit && input.repair && !rooted && !player.morphed) {
      player.escapeProgress = clamp(
        player.escapeProgress + (100 / ESCAPE_SECONDS) * dt,
        0,
        100,
      );

      if (player.escapeProgress >= 100) {
        player.escaped = true;
        player.escapeProgress = 100;
        player.stats.escapes = 1;
        player.morphed = false;
        player.skillCheck = null;
        io.to(room.code).emit('escaped', { id: player.id, name: player.name });
        addSystemChat(room, `${player.name} escaped through the gate!`);
        broadcastSnapshots(room);
      }
      return;
    }

    if (!atExit) {
      player.escapeProgress = Math.max(0, player.escapeProgress - 30 * dt);
    }
  }

  if (!player.morphed && input.repair && !rooted) {
    const machine = nearestMachine(room, player.x, player.y, 0, true);
    if (machine) {
      player.isRepairing = true;
      machine.progress = clamp(
        machine.progress + REPAIR_PER_SECOND * dt,
        0,
        100,
      );
      if (machine.progress >= 100) completeMachine(room, machine, player);
      if (!player.skillCheck && now >= player.nextSkillAt) {
        rollSkillCheck(player, now);
      }
    } else if (player.skillCheck) {
      player.skillCheck = null;
    }
  } else if (player.skillCheck) {
    player.skillCheck = null;
  }

  if (pressed(player, 'useItem')) useItem(room, player, now);
  if (pressed(player, 'throw') && now >= player.throwReadyAt) {
    throwProp(room, player, now);
  }

  const moving = input.up || input.down || input.left || input.right;
  if (!rooted && moving && now >= player.nextNoiseAt) {
    player.nextNoiseAt = now + NOISE_STEP_MS;
    emitNoise(room, player.x, player.y, 'step');
  }
}

function simulateRoom(room, dt) {
  const map = MAPS[room.mapId];
  const power = killerPower(room);
  const now = Date.now();

  updateTraps(room, power, now);
  updateProjectiles(room, dt, now);
  updateHazards(room, now);
  updateBleedOut(room, now);

  const killer = roomMembers(room).find((member) => member.role === 'killer');
  if (killer && !killer.downed && !killer.dead) {
    updateFinish(room, killer, now, dt);
  }

  for (const player of roomMembers(room)) {
    if (player.dead || player.escaped) {
      player.isRepairing = false;
      player.reviving = false;
      player.finishing = false;
      player.skillCheck = null;
      continue;
    }

    if (player.downed) {
      player.isRepairing = false;
      player.reviving = false;
      player.skillCheck = null;
      continue;
    }

    const input = player.input;

    if (pressed(player, 'locker')) toggleLocker(room, player, now);

    if (player.hiddenIn) {
      player.isRepairing = false;
      player.stillMs += dt * 1000;
      continue;
    }

    if (player.role === 'killer') handleKillerAbilities(room, player, power, now);

    const rooted = player.rootUntil > now;
    let moveX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let moveY = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (rooted) {
      moveX = 0;
      moveY = 0;
    }
    const isTryingToMove = moveX !== 0 || moveY !== 0;

    if (isTryingToMove) {
      const length = Math.hypot(moveX, moveY);
      moveX /= length;
      moveY /= length;
      player.angle = Math.atan2(moveY, moveX);

      const baseSpeed =
        player.role === 'killer' ? power.killerSpeed : SURVIVOR_SPEED;
      let speed = baseSpeed * (player.morphed ? MORPH_SPEED_MULTIPLIER : 1);
      if (player.role === 'killer' && now < player.sprintUntil) {
        speed *= power.sprintSpeedMultiplier || SPRINT_SPEED_MULTIPLIER;
      }

      const oldX = player.x;
      const oldY = player.y;
      moveEntity(map, player, moveX * speed * dt, moveY * speed * dt);

      if (distanceSq(oldX, oldY, player.x, player.y) > 0.01) {
        player.stillMs = 0;
      } else {
        player.stillMs += dt * 1000;
      }
    } else {
      player.stillMs += dt * 1000;
    }

    player.isRepairing = false;
    if (player.role === 'survivor') {
      handleSurvivorActions(room, player, now, dt, rooted);
    }
  }

  updateSkillChecks(room, now);
  simulateRevives(room, dt);
}

// A survivor who stands still holding REVIVE next to a downed teammate
// restores them over a few seconds. Progress decays when nobody helps.
function simulateRevives(room, dt) {
  const members = roomMembers(room);
  const map = MAPS[room.mapId];
  const now = Date.now();

  for (const member of members) {
    member.reviving = false;
    member.reviveBy = null;
    if (member.downed) member.reviveCount = 0;
  }

  for (const helper of members) {
    if (helper.downed || helper.dead || helper.escaped || helper.hiddenIn) continue;
    if (helper.role !== 'survivor' || helper.morphed) continue;
    if (helper.rootUntil > now) continue;
    if (!helper.input.revive) continue;

    const moving =
      helper.input.up || helper.input.down || helper.input.left || helper.input.right;
    if (moving) continue;

    let target = null;
    let bestDistance = Infinity;
    for (const victim of members) {
      if (!victim.downed || victim.dead || victim.role !== 'survivor' || victim === helper) {
        continue;
      }
      const distance = Math.sqrt(distanceSq(helper.x, helper.y, victim.x, victim.y));
      if (distance > REVIVE_RANGE || distance >= bestDistance) continue;
      if (!hasLineOfSight(map, helper.x, helper.y, victim.x, victim.y)) continue;
      target = victim;
      bestDistance = distance;
    }

    if (target) {
      target.reviveCount = (target.reviveCount || 0) + 1;
      target.reviveBy = helper.id;
      helper.reviving = true;
    }
  }

  for (const victim of members) {
    if (!victim.downed || victim.dead) {
      victim.reviveProgress = 0;
      continue;
    }

    if (victim.reviveCount > 0) {
      victim.reviveProgress = clamp(
        victim.reviveProgress + (100 / REVIVE_SECONDS) * victim.reviveCount * dt,
        0,
        100,
      );

      if (victim.reviveProgress >= 100) {
        const helper = victim.reviveBy ? players.get(victim.reviveBy) : null;
        if (helper) helper.stats.revived += 1;

        victim.downed = false;
        victim.health = REVIVE_HEALTH;
        victim.reviveProgress = 0;
        victim.bleedOutAt = 0;
        victim.stillMs = 0;
        victim.finishProgress = 0;
        resetInput(victim);
        io.to(room.code).emit('revived', { id: victim.id });
        addSystemChat(room, `${victim.name} was revived.`);
      }
    } else {
      victim.reviveProgress = clamp(
        victim.reviveProgress - REVIVE_DECAY_PER_SECOND * dt,
        0,
        100,
      );
    }
  }
}

// Win conditions: survivors win once the gate opened and everyone is either
// escaped or dead; the killer wins when every remaining survivor is down.
function checkRoundEnd(room) {
  if (room.state !== 'playing') return;

  const survivors = roomMembers(room).filter(
    (member) => member.role === 'survivor',
  );

  if (survivors.length === 0) {
    endRound(room, 'killer', 'No survivors remain.');
    return;
  }

  const unresolved = survivors.filter(
    (member) => !member.dead && !member.escaped,
  );
  const escaped = survivors.filter((member) => member.escaped);
  const standing = survivors.filter(
    (member) => !member.dead && !member.escaped && !member.downed,
  );

  if (unresolved.length === 0) {
    if (escaped.length > 0) {
      endRound(room, 'survivors', 'Survivors slipped through the exit gate.');
    } else {
      endRound(room, 'killer', 'Every survivor fell before the gate opened.');
    }
    return;
  }

  if (standing.length === 0) {
    if (escaped.length > 0) {
      // Someone already got out; the survivors have won even if the rest fell.
      endRound(room, 'survivors', 'Survivors slipped through the exit gate.');
    } else {
      endRound(room, 'killer', 'Every survivor is down. The Killer claims the night.');
    }
  }
}

function endRound(room, winner, reason) {
  room.state = 'ended';
  room.winner = winner;
  room.endReason = reason;

  for (const member of roomMembers(room)) {
    resetInput(member);
    member.reviving = false;
    member.skillCheck = null;
  }

  const stats = roomMembers(room).map((member) => ({
    id: member.id,
    name: member.name,
    role: member.role,
    escaped: member.escaped,
    ...member.stats,
  }));

  room.lastResult = {
    roundId: `${room.code}-${room.createdAt}-${room.round}`,
    winner,
    reason,
    repairedCount: repairedMachineCount(room),
    totalMachines: room.machines.length,
    stats,
  };

  io.to(room.code).emit('round:end', room.lastResult);

  addSystemChat(
    room,
    winner === 'survivors'
      ? 'SURVIVORS WIN - the power is restored.'
      : 'KILLER WINS - the night belongs to the hunter.',
  );
  broadcastRoomUpdate(room);
}

function resetRoomToLobby(room) {
  room.state = 'lobby';
  room.machines = [];
  room.traps = [];
  room.trapSeq = 0;
  room.projectiles = [];
  room.projectileSeq = 0;
  room.lockers = [];
  room.alarms = [];
  room.fogs = [];
  room.exit = null;
  room.exitOpen = false;
  room.winner = null;
  room.endReason = null;
  room.lastResult = null;

  for (const member of roomMembers(room)) {
    resetPlayerForRound(member);
    member.role = 'survivor';
  }

  addSystemChat(room, 'Returned to the lobby.');
  broadcastRoomUpdate(room);
}

// ---------------------------------------------------------------------------
// Networking
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  const player = createPlayer(socket.id);
  players.set(socket.id, player);

  socket.emit('menu:hello', {
    serverTime: Date.now(),
    maps: publicMapSummary(),
    config: GAME_CONFIG,
    maxPlayers: MAX_PLAYERS,
  });

  socket.on('room:create', (data = {}) => {
    const me = players.get(socket.id);
    if (!me) return;
    me.name = sanitizeName(data.playerName);
    me.look = sanitizeLook(data.look);
    createRoom(socket, me, data);
  });

  socket.on('room:join', (data = {}) => {
    const me = players.get(socket.id);
    if (!me) return;
    me.name = sanitizeName(data.playerName);
    me.look = sanitizeLook(data.look);

    const room = findRoomByCode(data.code);
    if (!room) {
      socket.emit('room:error', { message: 'No room found with that code.' });
      return;
    }
    joinRoom(
      socket,
      room,
      me,
      typeof data.password === 'string' ? data.password : '',
    );
  });

  socket.on('room:quick', (data = {}) => {
    const me = players.get(socket.id);
    if (!me) return;
    me.name = sanitizeName(data.playerName);
    me.look = sanitizeLook(data.look);
    quickJoinRoom(socket, me);
  });

  socket.on('room:leave', () => {
    const me = players.get(socket.id);
    if (!me) return;
    leaveRoom(me);
    socket.emit('room:left');
  });

  socket.on('room:setMap', (data = {}) => {
    const me = players.get(socket.id);
    if (!me) return;
    const room = rooms.get(me.roomCode);
    if (!room || room.hostId !== me.id || room.state !== 'lobby') return;
    if (!MAPS[data.mapId]) return;
    room.mapId = data.mapId;
    broadcastRoomUpdate(room);
    addSystemChat(room, `Map changed to ${MAPS[data.mapId].name}.`);
  });

  socket.on('room:start', () => {
    const me = players.get(socket.id);
    if (!me) return;
    const room = rooms.get(me.roomCode);
    if (!room) return;
    const error = startGame(room, me.id);
    if (error) socket.emit('room:error', { message: error });
  });

  socket.on('room:restart', () => {
    const me = players.get(socket.id);
    if (!me) return;
    const room = rooms.get(me.roomCode);
    if (!room || room.hostId !== me.id) return;
    if (room.state === 'playing') return;
    resetRoomToLobby(room);
  });

  socket.on('chat:send', (data = {}) => {
    const me = players.get(socket.id);
    if (!me) return;
    const room = rooms.get(me.roomCode);
    if (!room) return;

    const text = sanitizeChat(data.text);
    if (!text) return;

    const channel = data.channel === 'team' ? 'team' : 'all';
    const message = addChat(room, {
      from: me.id,
      name: me.name,
      role: me.role,
      channel,
      text,
    });
    broadcastChat(room, message);
  });

  socket.on('input', (data = {}) => {
    const me = players.get(socket.id);
    if (!me || !data || typeof data !== 'object') return;
    const room = rooms.get(me.roomCode);
    if (!room || room.state !== 'playing') return;

    me.input.up = data.up === true;
    me.input.down = data.down === true;
    me.input.left = data.left === true;
    me.input.right = data.right === true;
    me.input.repair = data.repair === true;
    me.input.revive = data.revive === true;
    me.input.sprint = data.sprint === true;
    me.input.track = data.track === true;
    me.input.trap = data.trap === true;
    me.input.finish = data.finish === true;
    me.input.throw = data.throw === true;
    me.input.locker = data.locker === true;
    me.input.useItem = data.useItem === true;
  });

  socket.on('skill:result', (data = {}) => {
    const me = players.get(socket.id);
    if (!me) return;
    const room = rooms.get(me.roomCode);
    if (!room || room.state !== 'playing') return;

    const check = me.skillCheck;
    if (!check || !data || data.seq !== check.seq) return;

    const elapsed = Date.now() - check.startedAt;
    const inZone =
      elapsed >= check.zoneStart - SKILL_TOLERANCE_MS &&
      elapsed <= check.zoneEnd + SKILL_TOLERANCE_MS;
    const success = data.hit === true && inZone;

    if (success) {
      applySkillBonus(room, me);
    } else {
      applySkillPenalty(room, me);
    }

    socket.emit('skillResult', { seq: check.seq, success });
    broadcastSnapshots(room);
  });

  socket.on('quick:ping', (data = {}) => {
    const me = players.get(socket.id);
    if (!me) return;
    const room = rooms.get(me.roomCode);
    if (!room || room.state !== 'playing') return;
    if (me.role !== 'survivor' || me.downed || me.dead) return;

    const kinds = ['killer', 'repair', 'help', 'regroup'];
    const kind = kinds.includes(data.kind) ? data.kind : 'help';
    const map = MAPS[room.mapId];
    const x = clamp(
      Number.isFinite(data.x) ? data.x : me.x,
      0,
      map.layout[0].length * TILE_SIZE,
    );
    const y = clamp(
      Number.isFinite(data.y) ? data.y : me.y,
      0,
      map.layout.length * TILE_SIZE,
    );
    const payload = {
      from: me.id,
      name: me.name,
      kind,
      x: Math.round(x),
      y: Math.round(y),
      t: Date.now(),
    };

    for (const member of roomMembers(room)) {
      if (member.role === 'survivor') io.to(member.id).emit('quickPing', payload);
    }
  });

  socket.on('room:preference', (data = {}) => {
    const me = players.get(socket.id);
    if (!me) return;
    const room = rooms.get(me.roomCode);
    if (!room || room.state !== 'lobby') return;

    const preferences = ['any', 'survivor', 'killer'];
    me.preference = preferences.includes(data.preference)
      ? data.preference
      : 'any';
    broadcastRoomUpdate(room);
  });

  socket.on('room:rejoin', (data = {}) => {
    const room = findRoomByCode(data.code);
    const token = typeof data.token === 'string' ? data.token : '';
    if (!room || !token) {
      socket.emit('room:rejoinFailed');
      return;
    }

    // Accept a matching session token even if the old socket has not finished
    // disconnecting yet. A page refresh can race the close event; taking over
    // with the token is safe and avoids losing the room on reload.
    const returning = roomMembers(room).find(
      (member) => member.sessionToken === token,
    );
    if (!returning) {
      socket.emit('room:rejoinFailed');
      return;
    }

    const oldSocket =
      returning.id !== socket.id ? io.sockets.sockets.get(returning.id) : null;
    const provisional = players.get(socket.id);
    if (provisional && provisional !== returning) {
      leaveRoom(provisional, { silent: true });
      players.delete(socket.id);
    }

    const oldId = returning.id;
    players.delete(oldId);
    room.members.delete(oldId);

    returning.id = socket.id;
    returning.disconnected = false;
    returning.disconnectAt = 0;
    players.set(socket.id, returning);
    room.members.add(socket.id);
    if (room.hostId === oldId) room.hostId = socket.id;
    if (room.lastKillerId === oldId) room.lastKillerId = socket.id;
    if (oldSocket) oldSocket.disconnect(true);

    socket.join(room.code);
    socket.emit('room:joined', {
      code: room.code,
      name: room.name,
      hostId: room.hostId,
      mapId: room.mapId,
      state: room.state,
      hasPassword: !!room.password,
      you: returning.id,
      isHost: returning.id === room.hostId,
      session: returning.sessionToken,
      maps: publicMapSummary(),
      config: GAME_CONFIG,
      maxPlayers: MAX_PLAYERS,
      players: roomMembers(room).map((member) => ({
        id: member.id,
        name: member.name,
        role: member.role,
        look: member.look,
        isHost: member.id === room.hostId,
        downed: member.downed,
        dead: !!member.dead,
        escaped: !!member.escaped,
        preference: member.preference,
      })),
    });
    socket.emit('chat:history', chatHistoryFor(room, returning));

    if (room.state === 'playing') {
      socket.emit('game:init', buildGameInit(room, returning.id));
    } else if (room.state === 'ended' && room.lastResult) {
      // The round finished while this player was reconnecting. Re-key their
      // stats row to the new socket so the end screen can find it.
      for (const row of room.lastResult.stats) {
        if (row.id === oldId) row.id = returning.id;
      }
      socket.emit('round:end', room.lastResult);
    }

    addSystemChat(room, `${returning.name} reconnected.`);
    broadcastRoomUpdate(room);
    broadcastSnapshots(room);
  });

  socket.on('morph', () => {
    const me = players.get(socket.id);
    if (!me) return;
    const room = rooms.get(me.roomCode);
    if (!room || room.state !== 'playing') return;
    if (me.downed || me.dead || me.escaped || me.hiddenIn) return;
    if (me.role !== 'survivor') return;

    me.morphed = !me.morphed;
    me.stillMs = 0;
    me.isRepairing = false;
    me.propType = me.morphed ? randomPropType(MAPS[room.mapId]) : null;
    broadcastSnapshots(room);
  });

  socket.on('attack', () => {
    const me = players.get(socket.id);
    if (!me) return;
    const room = rooms.get(me.roomCode);
    if (!room || room.state !== 'playing') return;
    if (me.downed || me.dead || me.hiddenIn) return;
    if (me.role !== 'killer') return;
    if (me.rootUntil > Date.now()) return;
    performAttack(room, me);
  });

  socket.on('disconnect', () => {
    const me = players.get(socket.id);
    if (!me) return;

    const room = rooms.get(me.roomCode);
    if (room && (room.state === 'playing' || room.state === 'ended')) {
      me.disconnected = true;
      me.disconnectAt = Date.now();
      me.sessionToken = me.sessionToken || newSessionToken();
      resetInput(me);
      me.isRepairing = false;
      me.reviving = false;
      me.skillCheck = null;

      // Do not let a closed tab block the end-screen controls for 60 seconds.
      if (room.hostId === me.id) {
        const nextHost = roomMembers(room).find(
          (member) => member.id !== me.id && !member.disconnected,
        );
        if (nextHost) {
          room.hostId = nextHost.id;
          addSystemChat(room, `${nextHost.name} is now the host.`);
        }
      }

      addSystemChat(
        room,
        `${me.name} disconnected. Reconnect within ${Math.round(
          RECONNECT_GRACE_MS / 1000,
        )}s.`,
      );
      broadcastRoomUpdate(room);
      return;
    }

    leaveRoom(me, { silent: true });
    players.delete(socket.id);
  });
});

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------
let lastTick = Date.now();
const SNAPSHOT_INTERVAL = 1 / SNAPSHOT_HZ;

setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.05, (now - lastTick) / 1000);
  lastTick = now;

  for (const room of rooms.values()) {
    for (const member of roomMembers(room)) {
      if (!member.disconnected) continue;
      if (now - member.disconnectAt <= RECONNECT_GRACE_MS) continue;

      const name = member.name;
      leaveRoom(member, { silent: true });
      players.delete(member.id);
      if (rooms.get(room.code) === room) {
        addSystemChat(room, `${name} did not reconnect.`);
      }
    }
  }

  for (const room of rooms.values()) {
    if (room.state !== 'playing') continue;
    simulateRoom(room, dt);
    checkRoundEnd(room);
    room.snapshotAcc += dt;
    if (room.snapshotAcc >= SNAPSHOT_INTERVAL) {
      room.snapshotAcc = 0;
      broadcastSnapshots(room);
    }
  }
}, 1000 / 60);

// ---------------------------------------------------------------------------
// Static files / server boot
// ---------------------------------------------------------------------------
const PUBLIC_DIR = path.join(__dirname, 'public');

app.get('/api/maps', (_request, response) => {
  response.json(publicMapSummary());
});

app.get('/api/maps/:id', (request, response) => {
  if (!MAPS[request.params.id]) {
    response.status(404).json({ error: 'Unknown map.' });
    return;
  }
  response.json(publicMapDefinition(request.params.id));
});

app.get('/', (_request, response) => {
  response.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/favicon.ico', (_request, response) => {
  response.status(204).end();
});

app.use(express.static(PUBLIC_DIR));

app.use(
  '/vendor/phaser',
  express.static(path.join(__dirname, 'node_modules', 'phaser', 'dist')),
);

const PORT = Number(process.env.PORT) || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`PROP // NIGHT server running at http://localhost:${PORT}`);
});
