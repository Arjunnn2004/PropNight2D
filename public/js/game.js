'use strict';

/**
 * PROP // NIGHT - game client.
 *
 * Contains three cooperating pieces:
 *   - geometry helpers shared by the online reconciliation and offline sim
 *   - LocalSim: a small offline simulation used by Practice mode
 *   - PropNightScene: the Phaser scene that renders both modes
 *   - Manager: boots Phaser lazily and routes server messages to the scene
 */
window.PN = window.PN || {};

(function (PN) {
  const TILE = PN.TILE;
  const PLAYER_HALF = 13;
  const PREVIEW = 36;

  // Killer ability defaults, used only when the server omits abilities config.
  const SPRINT_SPEED_MULTIPLIER = 2.4;
  const TRAP_RADIUS = 26;
  const TRAP_ARM_MS = 600;
  const TRAP_LIFETIME_MS = 30000;

  const BLEEDOUT_SECONDS = 45;
  const FINISH_RANGE = 56;
  const FINISH_SECONDS = 2.5;
  const EXIT_RANGE = 56;
  const ESCAPE_SECONDS = 3.5;
  const SKILL_DURATION_MS = 1400;
  const SKILL_WINDOW_MS = 240;
  const SKILL_TOLERANCE_MS = 160;
  const SKILL_MIN_MS = 3500;
  const SKILL_MAX_MS = 7000;
  const SKILL_BONUS = 12;
  const SKILL_PENALTY = 14;
  const THROW_RADIUS = 24;
  const THROW_SPEED = 520;
  const THROW_LIFETIME_MS = 900;
  const THROW_STUN_MS = 1600;
  const THROW_COOLDOWN_MS = 9000;
  const LOCKER_RANGE = 48;
  const LOCKER_EJECT_ROOT_MS = 1200;
  const FLASHLIGHT_RANGE = 300;
  const FLASHLIGHT_STUN_MS = 1800;
  const TOOLBOX_PROGRESS = 40;
  const MEDKIT_HEAL = 50;
  const ALARM_RADIUS = 78;
  const ALARM_COOLDOWN_MS = 9000;
  const FOG_VISION_MULTIPLIER = 0.55;
  const SURVIVOR_ITEMS = ['flashlight', 'toolbox', 'medkit'];
  const TORCH_DRAIN_SECONDS = 75;
  const TORCH_RECHARGE_SECONDS = 18;
  const TORCH_RANGE_MIN = 130;
  const TORCH_RANGE_MAX = 330;
  const TORCH_HALF_ANGLE = 0.52;
  const KILLER_DARKNESS = 0.7;
  const SURVIVOR_DARKNESS = 0.78;

  function tileCenter(col, row) {
    return { x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function distSq(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  }

  function dist(ax, ay, bx, by) {
    return Math.sqrt(distSq(ax, ay, bx, by));
  }

  function angleDifference(a, b) {
    let difference = a - b;
    while (difference > Math.PI) difference -= Math.PI * 2;
    while (difference < -Math.PI) difference += Math.PI * 2;
    return difference;
  }

  function layoutIsWall(layout, col, row) {
    if (row < 0 || row >= layout.length) return true;
    if (col < 0 || col >= layout[0].length) return true;
    return layout[row][col] === '#';
  }

  function collidesWithWalls(layout, x, y, half) {
    const h = half === undefined ? PLAYER_HALF : half;
    const worldWidth = layout[0].length * TILE;
    const worldHeight = layout.length * TILE;

    if (x - h < 0 || y - h < 0 || x + h > worldWidth || y + h > worldHeight) {
      return true;
    }

    const minCol = Math.floor((x - h) / TILE);
    const maxCol = Math.floor((x + h) / TILE);
    const minRow = Math.floor((y - h) / TILE);
    const maxRow = Math.floor((y + h) / TILE);

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        if (!layoutIsWall(layout, col, row)) continue;
        const tileLeft = col * TILE;
        const tileTop = row * TILE;
        if (
          x + h > tileLeft &&
          x - h < tileLeft + TILE &&
          y + h > tileTop &&
          y - h < tileTop + TILE
        ) {
          return true;
        }
      }
    }

    return false;
  }

  function moveEntity(layout, entity, dx, dy) {
    const nextX = entity.x + dx;
    if (!collidesWithWalls(layout, nextX, entity.y)) entity.x = nextX;
    const nextY = entity.y + dy;
    if (!collidesWithWalls(layout, entity.x, nextY)) entity.y = nextY;
  }

  function isWallAtWorld(layout, x, y) {
    return layoutIsWall(layout, Math.floor(x / TILE), Math.floor(y / TILE));
  }

  function hasLineOfSight(layout, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.hypot(dx, dy);
    if (distance < 1) return true;
    const steps = Math.ceil(distance / 8);
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      if (isWallAtWorld(layout, x1 + dx * t, y1 + dy * t)) return false;
    }
    return true;
  }

  function killerCanSee(layout, config, killer, target, visionRange) {
    const dx = target.x - killer.x;
    const dy = target.y - killer.y;
    const distance = Math.hypot(dx, dy);
    const range = visionRange || config.visionRange;
    if (distance > range) return false;
    if (distance < 1) return true;
    const direction = Math.atan2(dy, dx);
    if (Math.abs(angleDifference(direction, killer.angle)) > config.visionHalfAngle) {
      return false;
    }
    return hasLineOfSight(layout, killer.x, killer.y, target.x, target.y);
  }

  PN.geom = {
    tileCenter, clamp, dist, distSq, angleDifference, layoutIsWall,
    collidesWithWalls, moveEntity, isWallAtWorld, hasLineOfSight, killerCanSee,
  };

  // ---------------------------------------------------------------- Local sim
  const BOT_NAMES = ['Ivy', 'Marlow', 'Pike', 'Quill', 'Rook', 'Sable', 'Teague', 'Vale'];
  const BOT_HATS = ['none', 'cap', 'horns', 'halo', 'antenna', 'crown'];
  const BOT_EYES = ['normal', 'angry', 'sad', 'visor', 'sparkle'];
  const BOT_COLORS = ['#4fb2ff', '#ffd166', '#ff7b7b', '#c58bff', '#ff9f45', '#57e0d0'];

  function isCamouflaged(player, config) {
    return (
      player.role === 'survivor' &&
      player.morphed &&
      !player.downed &&
      player.stillMs >= config.camoStillMs
    );
  }

function serializePlayer(player, config, now = 0, viewer = null) {
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
      camouflaged: isCamouflaged(player, config),
      repairing: player.isRepairing,
      reviving: !!player.reviving,
      reviveProgress: player.downed ? Math.round(player.reviveProgress || 0) : 0,
      sprinting: !!(player.sprintUntil > now),
      rooted: !!(player.rootUntil > now),
    };
  }

  function serializeMachine(machine) {
    return {
      id: machine.id,
      x: machine.x,
      y: machine.y,
      progress: Math.round(machine.progress * 10) / 10,
      repaired: machine.repaired,
    };
  }

function nearestMachine(machines, x, y, range, layout) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const machine of machines) {
    if (machine.repaired) continue;
    const d = dist(x, y, machine.x, machine.y);
    if (d > range || d >= nearestDistance) continue;
    if (layout && !hasLineOfSight(layout, x, y, machine.x, machine.y)) continue;
    nearest = machine;
    nearestDistance = d;
  }
  return nearest;
}

  class LocalSim {
    constructor(map, config, human, botCount) {
      this.map = map;
      this.config = config;
      this.layout = map.layout;
      this.now = 0;
      this.events = [];
      this.humanId = 'local-you';
      this.players = [];
      this.finished = false;
      this.winner = null;
      this.endReason = null;

      this.floorTiles = [];
      for (let row = 1; row < this.layout.length - 1; row += 1) {
        for (let col = 1; col < this.layout[row].length - 1; col += 1) {
          if (this.layout[row][col] === '.') this.floorTiles.push(tileCenter(col, row));
        }
      }

      this.machines = map.machineTiles.map(([col, row], index) => {
        const center = tileCenter(col, row);
        return {
          id: `machine-${index + 1}`,
          x: center.x,
          y: center.y,
          progress: 0,
          repaired: false,
        };
      });

      this.traps = [];
      this.trapSeq = 0;

      this.lockers = (map.lockerTiles || []).map(([col, row], index) => {
        const center = tileCenter(col, row);
        return { id: `locker-${index + 1}`, x: center.x, y: center.y };
      });

      this.alarms = (map.alarmTiles || []).map(([col, row], index) => {
        const center = tileCenter(col, row);
        return { id: `alarm-${index + 1}`, x: center.x, y: center.y, nextAt: 0 };
      });

      this.fogs = (map.fogTiles || []).map(([col, row], index) => {
        const center = tileCenter(col, row);
        return { id: `fog-${index + 1}`, x: center.x, y: center.y, radius: TILE * 2.4 };
      });

      const exitTile = map.exitTile || [13, 13];
      this.exit = tileCenter(exitTile[0], exitTile[1]);
      this.exitOpen = false;
      this.projectiles = [];
      this.projectileSeq = 0;

      this.human = this.addPlayer({
        id: this.humanId,
        name: human.name,
        look: human.look,
        role: human.role,
        isHuman: true,
      });

      let nameIndex = 0;
      for (let i = 0; i < botCount; i += 1) {
        const role = human.role === 'killer' ? 'survivor' : (i === botCount - 1 ? 'killer' : 'survivor');
        this.addPlayer({
          id: `bot-${i + 1}`,
          name: BOT_NAMES[nameIndex % BOT_NAMES.length],
          look: {
            body: BOT_COLORS[nameIndex % BOT_COLORS.length],
            hat: BOT_HATS[(nameIndex * 2 + 1) % BOT_HATS.length],
            eyes: BOT_EYES[(nameIndex * 3 + 2) % BOT_EYES.length],
            custom: null,
          },
          role,
        });
        nameIndex += 1;
      }

      this.spreadSpawns();
    }

    addPlayer(options) {
      const player = {
        id: options.id,
        name: options.name,
        look: options.look,
        role: options.role,
        x: 0,
        y: 0,
        angle: 0,
        input: {
          up: false, down: false, left: false, right: false,
          repair: false, revive: false, sprint: false, track: false, trap: false,
          finish: false, throw: false, locker: false, useItem: false,
        },
        health: this.config.maxHealth,
        downed: false,
        dead: false,
        bleedOutAt: 0,
        escaped: false,
        escapeProgress: 0,
        hiddenIn: null,
        finishProgress: 0,
        finishing: false,
        finishingId: null,
        item:
          options.role === 'killer'
            ? null
            : SURVIVOR_ITEMS[Math.floor(Math.random() * SURVIVOR_ITEMS.length)],
        itemUsed: false,
        throwReadyAt: 0,
        nextNoiseAt: 0,
        skillCheck: null,
        skillSeq: 0,
        nextSkillAt: 0,
        pressLatch: {},
        stats: { repaired: 0, revived: 0, hits: 0, downs: 0, finishes: 0, escapes: 0 },
        morphed: false,
        propType: null,
        stillMs: 0,
        isRepairing: false,
        sprintUntil: -9999,
        nextSprintAt: -9999,
        trackUntil: -9999,
        nextTrackAt: -9999,
        nextTrapAt: -9999,
        rootUntil: -9999,
        lastAttackAt: -9999,
        botTarget: null,
        botRetargetAt: 0,
        botRepairUntil: 0,
        isHuman: !!options.isHuman,
      };
      this.players.push(player);
      return player;
    }

    randomFloorPoint() {
      return this.floorTiles[Math.floor(Math.random() * this.floorTiles.length)];
    }

    spreadSpawns() {
      const points = this.map.spawnTiles
        .map(([col, row]) => tileCenter(col, row))
        .sort(() => Math.random() - 0.5);
      this.players.forEach((player, index) => {
        const spawn = points[index % points.length];
        player.x = spawn.x;
        player.y = spawn.y;
        player.angle = Math.atan2(
          (this.layout.length * TILE) / 2 - spawn.y,
          (this.layout[0].length * TILE) / 2 - spawn.x,
        );
      });
    }

    getPlayer(id) {
      return this.players.find((player) => player.id === id) || null;
    }

    setInput(input) {
      this.human.input.up = !!input.up;
      this.human.input.down = !!input.down;
      this.human.input.left = !!input.left;
      this.human.input.right = !!input.right;
      this.human.input.repair = !!input.repair;
      this.human.input.revive = !!input.revive;
      this.human.input.sprint = !!input.sprint;
      this.human.input.track = !!input.track;
      this.human.input.trap = !!input.trap;
      this.human.input.finish = !!input.finish;
      this.human.input.throw = !!input.throw;
      this.human.input.locker = !!input.locker;
      this.human.input.useItem = !!input.useItem;
    }

    pressed(player, key) {
      const down = player.input[key] === true;
      const was = player.pressLatch[key] === true;
      player.pressLatch[key] = down;
      return down && !was;
    }

    nearestLocker(x, y, range) {
      let best = null;
      let bestDistance = Infinity;
      for (const locker of this.lockers) {
        const d = dist(x, y, locker.x, locker.y);
        if (d <= range && d < bestDistance) {
          best = locker;
          bestDistance = d;
        }
      }
      return best;
    }

    nearestDownedSurvivor(x, y, range) {
      let best = null;
      let bestDistance = Infinity;
      for (const player of this.players) {
        if (player.role !== 'survivor' || !player.downed || player.dead) continue;
        const d = dist(x, y, player.x, player.y);
        if (d > range || d >= bestDistance) continue;
        if (!hasLineOfSight(this.layout, x, y, player.x, player.y)) continue;
        best = player;
        bestDistance = d;
      }
      return best;
    }

    emit(type, data) {
      this.events.push({ type, data });
    }

    completeMachine(machine, player) {
      if (machine.repaired) return;
      machine.progress = 100;
      machine.repaired = true;
      if (player) player.stats.repaired += 1;
      for (const other of this.players) {
        if (!other.skillCheck) continue;
        if (dist(other.x, other.y, machine.x, machine.y) <= this.config.repairRange) {
          other.skillCheck = null;
        }
      }
      this.emit('machineRepaired', {
        machineId: machine.id,
        repairedCount: this.machines.filter((m) => m.repaired).length,
        totalMachines: this.machines.length,
      });
      if (this.machines.every((m) => m.repaired)) this.openExit();
    }

    openExit() {
      if (this.exitOpen) return;
      this.exitOpen = true;
      this.emit('exitOpen', { x: this.exit.x, y: this.exit.y });
    }

    rollSkillCheck(player) {
      const zoneStart = 420 + Math.random() * (SKILL_DURATION_MS - 620 - SKILL_WINDOW_MS);
      player.skillSeq += 1;
      player.skillCheck = {
        seq: player.skillSeq,
        startedAt: this.now,
        durationMs: SKILL_DURATION_MS,
        zoneStart,
        zoneEnd: zoneStart + SKILL_WINDOW_MS,
      };
      player.nextSkillAt =
        this.now + SKILL_MIN_MS + Math.random() * (SKILL_MAX_MS - SKILL_MIN_MS);
      this.emit('skillCheck', {
        seq: player.skillCheck.seq,
        durationMs: SKILL_DURATION_MS,
        zoneStart,
        zoneEnd: player.skillCheck.zoneEnd,
      });
    }

    applySkillBonus(player) {
      const machine = nearestMachine(
        this.machines, player.x, player.y, this.config.repairRange, this.layout,
      );
      if (machine && !machine.repaired) {
        machine.progress = clamp(machine.progress + SKILL_BONUS, 0, 100);
        if (machine.progress >= 100) this.completeMachine(machine, player);
      }
      player.skillCheck = null;
    }

    applySkillPenalty(player) {
      const machine = nearestMachine(
        this.machines, player.x, player.y, this.config.repairRange, this.layout,
      );
      if (machine && !machine.repaired) {
        machine.progress = clamp(machine.progress - SKILL_PENALTY, 0, 100);
      }
      player.skillCheck = null;
    }

    resolveSkillCheck(hit, seq) {
      const player = this.human;
      const check = player.skillCheck;
      if (!check) return false;
      if (seq !== undefined && seq !== check.seq) return false;

      const elapsed = this.now - check.startedAt;
      const inZone =
        elapsed >= check.zoneStart - SKILL_TOLERANCE_MS &&
        elapsed <= check.zoneEnd + SKILL_TOLERANCE_MS;
      const success = hit === true && inZone;

      if (success) this.applySkillBonus(player);
      else this.applySkillPenalty(player);

      this.emit('skillResult', { seq: check.seq, success });
      return success;
    }

    updateSkillChecks() {
      for (const player of this.players) {
        const check = player.skillCheck;
        if (!check) continue;
        if (this.now <= check.startedAt + check.durationMs + SKILL_TOLERANCE_MS) {
          continue;
        }
        this.applySkillPenalty(player);
        this.emit('skillResult', { seq: check.seq, success: false, reason: 'missed' });
      }
    }

    toggleLocker(player) {
      if (player.downed || player.dead || player.escaped) return;

      if (player.hiddenIn) {
        player.hiddenIn = null;
        this.emit('locker', { id: player.id, hidden: false });
        return;
      }

      if (player.role === 'killer') {
        const locker = this.nearestLocker(player.x, player.y, LOCKER_RANGE);
        if (!locker) return;
        const victim = this.players.find(
          (other) => other.role === 'survivor' && other.hiddenIn === locker.id,
        );
        if (victim) {
          victim.hiddenIn = null;
          victim.rootUntil = this.now + LOCKER_EJECT_ROOT_MS;
          victim.x = locker.x;
          victim.y = locker.y;
          this.emit('lockerFound', {
            lockerId: locker.id,
            id: victim.id,
            name: victim.name,
            x: locker.x,
            y: locker.y,
          });
        } else {
          this.emit('lockerEmpty', { lockerId: locker.id });
        }
        return;
      }

      const locker = this.nearestLocker(player.x, player.y, LOCKER_RANGE);
      if (!locker) return;
      if (this.players.some((other) => other.hiddenIn === locker.id)) return;

      player.hiddenIn = locker.id;
      player.x = locker.x;
      player.y = locker.y;
      player.morphed = false;
      player.propType = null;
      player.skillCheck = null;
      player.escapeProgress = 0;
      this.emit('locker', { id: player.id, hidden: true, lockerId: locker.id });
    }

    useItem(player) {
      if (!player.item || player.itemUsed) return;

      if (player.item === 'flashlight') {
        const killer = this.players.find((other) => other.role === 'killer');
        if (killer && !killer.downed && !killer.dead) {
          const distance = dist(player.x, player.y, killer.x, killer.y);
          const direction = Math.atan2(killer.y - player.y, killer.x - player.x);
          const facing = Math.abs(angleDifference(direction, player.angle)) <= Math.PI / 3;
          if (
            distance <= FLASHLIGHT_RANGE &&
            facing &&
            hasLineOfSight(this.layout, player.x, player.y, killer.x, killer.y)
          ) {
            killer.rootUntil = this.now + FLASHLIGHT_STUN_MS;
            player.itemUsed = true;
            this.emit('flash', { id: player.id, x: killer.x, y: killer.y });
          }
        }
      } else if (player.item === 'toolbox') {
        const machine = nearestMachine(
          this.machines,
          player.x,
          player.y,
          this.config.repairRange + 96,
          this.layout,
        );
        if (machine) {
          player.itemUsed = true;
          machine.progress = clamp(machine.progress + TOOLBOX_PROGRESS, 0, 100);
          if (machine.progress >= 100) this.completeMachine(machine, player);
          this.emit('itemUsed', { id: player.id, item: 'toolbox', machineId: machine.id });
        }
      } else if (player.item === 'medkit') {
        if (player.health < this.config.maxHealth) {
          player.health = Math.min(this.config.maxHealth, player.health + MEDKIT_HEAL);
          player.itemUsed = true;
          this.emit('itemUsed', { id: player.id, item: 'medkit', health: player.health });
        }
      }
    }

    throwProp(player) {
      if (
        this.finished ||
        player.role !== 'survivor' ||
        player.downed ||
        player.dead ||
        player.escaped ||
        player.hiddenIn
      ) {
        return;
      }
      const angle = player.angle;
      this.projectileSeq += 1;
      this.projectiles.push({
        id: `prop-${this.projectileSeq}`,
        ownerId: player.id,
        x: player.x + Math.cos(angle) * 18,
        y: player.y + Math.sin(angle) * 18,
        vx: Math.cos(angle) * THROW_SPEED,
        vy: Math.sin(angle) * THROW_SPEED,
        expiresAt: this.now + THROW_LIFETIME_MS,
      });
      player.throwReadyAt = this.now + THROW_COOLDOWN_MS;
      this.emit('throw', { id: player.id, angle });
    }

    updateProjectiles(dt) {
      if (this.projectiles.length === 0) return;
      const killer = this.players.find((player) => player.role === 'killer');

      this.projectiles = this.projectiles.filter((projectile) => {
        if (this.now >= projectile.expiresAt) return false;

        const nextX = projectile.x + projectile.vx * dt;
        const nextY = projectile.y + projectile.vy * dt;
        if (isWallAtWorld(this.layout, nextX, nextY)) {
          this.emit('propBreak', { x: nextX, y: nextY });
          return false;
        }

        projectile.x = nextX;
        projectile.y = nextY;

        if (killer && !killer.downed && !killer.dead) {
          if (dist(projectile.x, projectile.y, killer.x, killer.y) <= THROW_RADIUS + PLAYER_HALF) {
            killer.rootUntil = this.now + THROW_STUN_MS;
            this.emit('stun', { x: killer.x, y: killer.y, by: projectile.ownerId });
            return false;
          }
        }

        return true;
      });
    }

    updateHazards() {
      for (const alarm of this.alarms) {
        if (this.now < alarm.nextAt) continue;
        const trigger = this.players.find(
          (player) =>
            player.role === 'survivor' &&
            !player.downed &&
            !player.dead &&
            !player.escaped &&
            !player.hiddenIn &&
            dist(player.x, player.y, alarm.x, alarm.y) <= ALARM_RADIUS,
        );
        if (!trigger) continue;
        alarm.nextAt = this.now + ALARM_COOLDOWN_MS;
        this.emit('alarm', { id: alarm.id, x: alarm.x, y: alarm.y, by: trigger.id });
      }
    }

    updateBleedOut() {
      for (const player of this.players) {
        if (!player.downed || player.dead || player.escaped) continue;
        if (!player.bleedOutAt || this.now < player.bleedOutAt) continue;
        player.dead = true;
        player.health = 0;
        player.reviveProgress = 0;
        player.skillCheck = null;
        player.bleedOutAt = 0;
        this.emit('bledOut', { id: player.id, name: player.name });
      }
    }

    updateFinish(dt) {
      const killer = this.players.find(
        (player) => player.role === 'killer' && !player.downed && !player.dead,
      );
      if (!killer) return;

      const target = killer.wantFinish && killer.rootUntil <= this.now
        ? this.nearestDownedSurvivor(killer.x, killer.y, FINISH_RANGE)
        : null;
      const previous = killer.finishingId ? this.getPlayer(killer.finishingId) : null;

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
          this.emit('executed', {
            id: target.id,
            name: target.name,
            by: killer.id,
          });
        }
        return;
      }

      killer.finishing = false;
      killer.finishingId = null;
      killer.finishProgress = Math.max(0, killer.finishProgress - 60 * dt);
      if (previous) {
        previous.finishProgress = Math.max(0, previous.finishProgress - 60 * dt);
      }
    }

    handleSurvivor(player, intent, dt, rooted) {
      if (this.exitOpen) {
        const atExit = dist(player.x, player.y, this.exit.x, this.exit.y) <= EXIT_RANGE;
        if (atExit && intent.repair && !rooted && !player.morphed) {
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
            this.emit('escaped', { id: player.id, name: player.name });
          }
          return;
        }
        if (!atExit) player.escapeProgress = Math.max(0, player.escapeProgress - 30 * dt);
      }

      if (!player.morphed && intent.repair && !rooted) {
        const machine = nearestMachine(
          this.machines,
          player.x,
          player.y,
          this.config.repairRange,
          this.layout,
        );
        if (machine) {
          player.isRepairing = true;
          machine.progress = clamp(
            machine.progress + (100 / this.config.repairSeconds) * dt,
            0,
            100,
          );
          if (machine.progress >= 100) this.completeMachine(machine, player);
          if (!player.skillCheck && this.now >= player.nextSkillAt) {
            this.rollSkillCheck(player);
          }
        } else if (player.skillCheck) {
          player.skillCheck = null;
        }
      } else if (player.skillCheck) {
        player.skillCheck = null;
      }

      const useItem = player.isHuman
        ? this.pressed(player, 'useItem')
        : !!intent.useItem;
      const throwPressed = player.isHuman ? this.pressed(player, 'throw') : !!intent.throw;
      if (useItem) this.useItem(player);
      if (throwPressed && this.now >= player.throwReadyAt) this.throwProp(player);
    }

    trapRadius() {
      const trap = (this.config.abilities || {}).trap;
      return trap && trap.radius ? trap.radius : TRAP_RADIUS;
    }

    power() {
      const repaired = this.machines.filter((machine) => machine.repaired).length;
      const cfg = this.config.power || {
        speedPerMachine: 0.09,
        visionPerMachine: 55,
        cooldownPerMachine: 0.08,
        minCooldownMs: 500,
      };
      const abilities = this.config.abilities || {};
      const sprint = abilities.sprint || {
        speedMultiplier: SPRINT_SPEED_MULTIPLIER,
        durationMs: 1200,
        cooldownMs: 6000,
        minCooldownMs: 1500,
      };
      const track = abilities.track || {
        durationMs: 3000,
        cooldownMs: 14000,
        minCooldownMs: 4000,
      };
      const trap = abilities.trap || {
        radius: TRAP_RADIUS,
        armMs: TRAP_ARM_MS,
        rootMs: 2200,
        rootPerMachineMs: 250,
        lifetimeMs: TRAP_LIFETIME_MS,
        cooldownMs: 3000,
        minCooldownMs: 800,
        max: 4,
      };
      const speedMultiplier = 1 + cfg.speedPerMachine * repaired;
      const scale = (base, min) =>
        Math.max(min, Math.round(base * (1 - cfg.cooldownPerMachine * repaired)));
      return {
        repairedCount: repaired,
        speedMultiplier: Math.round(speedMultiplier * 100) / 100,
        killerSpeed: this.config.killerSpeed * speedMultiplier,
        visionRange: this.config.visionRange + cfg.visionPerMachine * repaired,
        attackCooldownMs: Math.max(
          cfg.minCooldownMs,
          Math.round(this.config.attackCooldownMs * (1 - cfg.cooldownPerMachine * repaired)),
        ),
        sprintSpeedMultiplier: sprint.speedMultiplier,
        sprintDurationMs: sprint.durationMs,
        sprintCooldownMs: scale(sprint.cooldownMs, sprint.minCooldownMs),
        trackDurationMs: track.durationMs,
        trackCooldownMs: scale(track.cooldownMs, track.minCooldownMs),
        maxTraps: Math.min(trap.max, 1 + repaired),
        trapRootMs: trap.rootMs + (trap.rootPerMachineMs || 0) * repaired,
        trapCooldownMs: scale(trap.cooldownMs, trap.minCooldownMs),
      };
    }

    toggleMorph() {
      const player = this.human;
      if (player.downed || player.hiddenIn || player.role !== 'survivor') return;
      player.morphed = !player.morphed;
      player.stillMs = 0;
      player.isRepairing = false;
      player.propType = player.morphed
        ? this.map.propTypes[Math.floor(Math.random() * this.map.propTypes.length)]
        : null;
    }

    drainEvents() {
      const events = this.events;
      this.events = [];
      return events;
    }

    attack(id) {
      const killer = this.getPlayer(id);
      if (!killer || killer.role !== 'killer' || killer.downed) return;
      if (killer.rootUntil > this.now) return;
      if (this.now - killer.lastAttackAt < this.power().attackCooldownMs) return;
      killer.lastAttackAt = this.now;

      const victims = [];
      for (const player of this.players) {
        if (player.role !== 'survivor' || player.downed || player.dead) continue;
        if (player.escaped || player.hiddenIn) continue;
        const dx = player.x - killer.x;
        const dy = player.y - killer.y;
        const distance = Math.hypot(dx, dy);
        if (distance > this.config.attackRange + PLAYER_HALF) continue;
        const direction = Math.atan2(dy, dx);
        if (Math.abs(angleDifference(direction, killer.angle)) > this.config.attackHalfAngle) continue;
        if (!hasLineOfSight(this.layout, killer.x, killer.y, player.x, player.y)) continue;

        player.health = Math.max(0, player.health - this.config.meleeDamage);
        if (player.health <= 0) {
          player.downed = true;
          player.dead = false;
          player.bleedOutAt = this.now + BLEEDOUT_SECONDS * 1000;
          player.morphed = false;
          player.propType = null;
          player.isRepairing = false;
          player.skillCheck = null;
          player.hiddenIn = null;
        }
        victims.push(player.id);
      }

      if (victims.length > 0) {
        killer.stats.hits += 1;
        for (const id of victims) {
          const victim = this.getPlayer(id);
          if (victim && victim.downed) killer.stats.downs += 1;
        }
      }

      let hitMachine = null;
      let hitDistance = Infinity;
      for (const machine of this.machines) {
        if (machine.repaired) continue;
        const dx = machine.x - killer.x;
        const dy = machine.y - killer.y;
        const distance = Math.hypot(dx, dy);
        if (distance > this.config.attackRange + 24) continue;
        const direction = Math.atan2(dy, dx);
        if (Math.abs(angleDifference(direction, killer.angle)) > this.config.attackHalfAngle) continue;
        if (!hasLineOfSight(this.layout, killer.x, killer.y, machine.x, machine.y)) continue;
        if (distance < hitDistance) {
          hitMachine = machine;
          hitDistance = distance;
        }
      }
      if (hitMachine) hitMachine.progress = clamp(hitMachine.progress - 30, 0, 100);

      this.events.push({
        type: 'attack',
        data: {
          id: killer.id,
          x: Math.round(killer.x * 10) / 10,
          y: Math.round(killer.y * 10) / 10,
          angle: killer.angle,
          hitCount: victims.length,
          machineId: hitMachine ? hitMachine.id : null,
        },
      });
      if (victims.length > 0) {
        this.events.push({ type: 'hit', data: { attackerId: killer.id, victimIds: victims } });
      }
      if (hitMachine) {
        this.events.push({
          type: 'machineHit',
          data: { machineId: hitMachine.id, x: hitMachine.x, y: hitMachine.y },
        });
      }
    }

    buildIntent(player, dt) {
      if (player.isHuman) {
        const input = player.input;
        return {
          moveX: (input.right ? 1 : 0) - (input.left ? 1 : 0),
          moveY: (input.down ? 1 : 0) - (input.up ? 1 : 0),
          repair: input.repair,
          revive: input.revive,
          sprint: input.sprint,
          track: input.track,
          trap: input.trap,
          finish: input.finish,
          throw: input.throw,
          locker: input.locker,
          useItem: input.useItem,
          attack: false,
          angle: null,
        };
      }
      if (player.role === 'killer') return this.killerIntent(player, dt);
      return this.survivorIntent(player, dt);
    }

    wanderIntent(player) {
      if (
        !player.botTarget ||
        this.now > player.botRetargetAt ||
        dist(player.x, player.y, player.botTarget.x, player.botTarget.y) < 22
      ) {
        let target = null;
        if (Math.random() < 0.5) {
          const open = this.machines.filter((machine) => !machine.repaired);
          if (open.length > 0) target = open[Math.floor(Math.random() * open.length)];
        }
        player.botTarget = target || this.randomFloorPoint();
        player.botRetargetAt = this.now + 2500 + Math.random() * 3000;
      }
      const angle = Math.atan2(
        player.botTarget.y - player.y,
        player.botTarget.x - player.x,
      );
      return {
        moveX: Math.cos(angle),
        moveY: Math.sin(angle),
        repair: false,
        revive: false,
        sprint: false,
        track: false,
        trap: false,
        finish: false,
        throw: false,
        locker: false,
        useItem: false,
        attack: false,
        angle,
      };
    }

    nearestDownedMate(player) {
      let best = null;
      let bestDistance = Infinity;
      for (const other of this.players) {
        if (
          other.role !== 'survivor' ||
          !other.downed ||
          other.dead ||
          other.escaped ||
          other === player
        ) {
          continue;
        }
        const d = dist(player.x, player.y, other.x, other.y);
        if (d > 520) continue;
        if (!hasLineOfSight(this.layout, player.x, player.y, other.x, other.y)) continue;
        if (d < bestDistance) {
          best = other;
          bestDistance = d;
        }
      }
      return best;
    }

    killerIntent(player, dt) {
      const visionRange = this.power().visionRange;
      let best = null;
      let bestDistance = Infinity;
      for (const survivor of this.players) {
        if (
          survivor.role !== 'survivor' ||
          survivor.downed ||
          survivor.dead ||
          survivor.escaped ||
          survivor.hiddenIn
        ) {
          continue;
        }
        const d = dist(player.x, player.y, survivor.x, survivor.y);
        if (d > visionRange) continue;
        // Camouflaged props can only be spotted at close range.
        if (d > 110 && isCamouflaged(survivor, this.config)) continue;
        if (!hasLineOfSight(this.layout, player.x, player.y, survivor.x, survivor.y)) continue;
        const direction = Math.atan2(survivor.y - player.y, survivor.x - player.x);
        const facing = Math.abs(angleDifference(direction, player.angle));
        if (facing > this.config.visionHalfAngle && d > 120) continue;
        if (d < bestDistance) {
          best = survivor;
          bestDistance = d;
        }
      }

      const downed = this.nearestDownedSurvivor(player.x, player.y, FINISH_RANGE);
      if (downed) {
        return {
          moveX: 0,
          moveY: 0,
          repair: false,
          revive: false,
          sprint: false,
          track: false,
          trap: false,
          finish: true,
          throw: false,
          locker: false,
          useItem: false,
          attack: false,
          angle: Math.atan2(downed.y - player.y, downed.x - player.x),
        };
      }

      if (best) {
        const direction = Math.atan2(best.y - player.y, best.x - player.x);
        const killRange = this.config.attackRange - 8;
        const power = this.power();
        if (bestDistance <= killRange) {
          return {
            moveX: 0, moveY: 0, repair: false, revive: false,
            sprint: false, track: false, trap: false,
            finish: false, throw: false, locker: false, useItem: false,
            attack: true, angle: direction,
          };
        }
        return {
          moveX: Math.cos(direction),
          moveY: Math.sin(direction),
          repair: false,
          revive: false,
          sprint: bestDistance > 260 && this.now >= player.nextSprintAt,
          track: false,
          trap:
            bestDistance < 320 &&
            bestDistance > 120 &&
            this.traps.length < power.maxTraps &&
            this.now >= player.nextTrapAt &&
            Math.random() < 0.02,
          finish: false,
          throw: false,
          locker: false,
          useItem: false,
          attack: false,
          angle: direction,
        };
      }

      const wander = this.wanderIntent(player);
      wander.track = this.now >= player.nextTrackAt && Math.random() < 0.01;
      return wander;
    }

    survivorIntent(player, dt) {
      const config = this.config;

      if (
        !player.itemUsed &&
        player.item === 'medkit' &&
        player.health < config.maxHealth * 0.5
      ) {
        return {
          moveX: 0, moveY: 0, repair: false, revive: false,
          sprint: false, track: false, trap: false,
          finish: false, throw: false, locker: false, useItem: true,
          attack: false, angle: null,
        };
      }

      // Stun tools beat fleeing when the killer is already close.
      for (const other of this.players) {
        if (other.role !== 'killer' || other.downed) continue;
        const d = dist(player.x, player.y, other.x, other.y);
        if (d > 210) continue;
        if (!hasLineOfSight(this.layout, player.x, player.y, other.x, other.y)) continue;
        const toKiller = Math.atan2(other.y - player.y, other.x - player.x);
        if (
          player.item === 'flashlight' &&
          !player.itemUsed &&
          d <= FLASHLIGHT_RANGE
        ) {
          return {
            moveX: 0, moveY: 0, repair: false, revive: false,
            sprint: false, track: false, trap: false,
            finish: false, throw: false, locker: false, useItem: true,
            attack: false, angle: toKiller,
          };
        }
        if (this.now >= player.throwReadyAt) {
          return {
            moveX: -Math.cos(toKiller),
            moveY: -Math.sin(toKiller),
            repair: false, revive: false,
            sprint: false, track: false, trap: false,
            finish: false, throw: true, locker: false, useItem: false,
            attack: false, angle: toKiller,
          };
        }
      }

      // Flee the killer if it is close and visible.
      for (const other of this.players) {
        if (other.role !== 'killer' || other.downed) continue;
        const d = dist(player.x, player.y, other.x, other.y);
        if (d < 200 && hasLineOfSight(this.layout, player.x, player.y, other.x, other.y)) {
          const away = Math.atan2(player.y - other.y, player.x - other.x);
          return {
            moveX: Math.cos(away),
            moveY: Math.sin(away),
            repair: false,
            revive: false,
            sprint: false,
            track: false,
            trap: false,
            finish: false,
            throw: false,
            locker: false,
            useItem: false,
            attack: false,
            angle: away,
          };
        }
      }

      // Priority two: pick up a downed teammate.
      const mate = this.nearestDownedMate(player);
      if (mate) {
        const d = dist(player.x, player.y, mate.x, mate.y);
        const range = (config.reviveRange || 64) * 0.9;
        if (d <= range) {
          return {
            moveX: 0, moveY: 0, repair: false, revive: true,
            sprint: false, track: false, trap: false,
            finish: false, throw: false, locker: false, useItem: false,
            attack: false, angle: null,
          };
        }
        const angle = Math.atan2(mate.y - player.y, mate.x - player.x);
        return {
          moveX: Math.cos(angle),
          moveY: Math.sin(angle),
          repair: false,
          revive: false,
          sprint: false,
          track: false,
          trap: false,
          finish: false,
          throw: false,
          locker: false,
          useItem: false,
          attack: false,
          angle,
        };
      }

      if (player.botRepairUntil > this.now) {
        return {
          moveX: 0, moveY: 0, repair: true, revive: false,
          sprint: false, track: false, trap: false,
          finish: false, throw: false, locker: false, useItem: false,
          attack: false, angle: null,
        };
      }

      const near = nearestMachine(
        this.machines, player.x, player.y, config.repairRange * 0.9, this.layout,
      );
      if (near) {
        player.botRepairUntil = this.now + 1800 + Math.random() * 2600;
        return {
          moveX: 0, moveY: 0, repair: true, revive: false,
          sprint: false, track: false, trap: false,
          finish: false, throw: false, locker: false, useItem: false,
          attack: false, angle: null,
        };
      }

      return this.wanderIntent(player);
    }

    applyIntent(player, intent, dt) {
      if (player.dead || player.escaped || player.downed) return;
      if (player.role === 'killer') {
        this.handleAbilities(player, intent);
        player.wantFinish = !!intent.finish;
      }

      const lockerPressed = player.isHuman
        ? this.pressed(player, 'locker')
        : !!intent.locker;
      if (lockerPressed) this.toggleLocker(player);

      if (player.hiddenIn) {
        player.isRepairing = false;
        player.stillMs += dt * 1000;
        return;
      }

      const rooted = player.rootUntil > this.now;
      let moveX = rooted ? 0 : intent.moveX;
      let moveY = rooted ? 0 : intent.moveY;
      const moving = moveX !== 0 || moveY !== 0;

      if (moving) {
        const length = Math.hypot(moveX, moveY);
        moveX /= length;
        moveY /= length;
        player.angle = intent.angle != null ? intent.angle : Math.atan2(moveY, moveX);
        const base =
          player.role === 'killer' ? this.power().killerSpeed : this.config.survivorSpeed;
        let speed = base * (player.morphed ? this.config.morphSpeedMultiplier : 1);
        if (player.role === 'killer' && this.now < player.sprintUntil) {
          speed *= this.power().sprintSpeedMultiplier || SPRINT_SPEED_MULTIPLIER;
        }
        const oldX = player.x;
        const oldY = player.y;
        moveEntity(this.layout, player, moveX * speed * dt, moveY * speed * dt);
        player.stillMs = distSq(oldX, oldY, player.x, player.y) > 0.01 ? 0 : player.stillMs + dt * 1000;
      } else {
        if (intent.angle != null) player.angle = intent.angle;
        player.stillMs += dt * 1000;
      }

      player.isRepairing = false;
      if (player.role !== 'survivor') return;
      this.handleSurvivor(player, intent, dt, rooted);
    }

    // Mirrors the server ability rules for the offline Practice mode.
    handleAbilities(player, intent) {
      const power = this.power();
      const now = this.now;
      if (player.rootUntil > now) return;

      const sprint = player.isHuman ? this.pressed(player, 'sprint') : !!intent.sprint;
      const track = player.isHuman ? this.pressed(player, 'track') : !!intent.track;
      const trap = player.isHuman ? this.pressed(player, 'trap') : !!intent.trap;

      if (sprint && now >= player.nextSprintAt) {
        player.nextSprintAt = now + power.sprintCooldownMs;
        player.sprintUntil = now + power.sprintDurationMs;
        this.events.push({ type: 'ability', data: { id: player.id, ability: 'sprint' } });
      }

      if (track && now >= player.nextTrackAt) {
        player.nextTrackAt = now + power.trackCooldownMs;
        player.trackUntil = now + power.trackDurationMs;
        this.events.push({ type: 'ability', data: { id: player.id, ability: 'track' } });
      }

      if (trap && now >= player.nextTrapAt && this.traps.length < power.maxTraps) {
        player.nextTrapAt = now + power.trapCooldownMs;
        this.trapSeq += 1;
        const trap = {
          id: `trap-${this.trapSeq}`,
          x: player.x,
          y: player.y,
          armedAt: now + TRAP_ARM_MS,
          expiresAt: now + TRAP_LIFETIME_MS,
        };
        this.traps.push(trap);
        this.events.push({
          type: 'ability',
          data: { id: player.id, ability: 'trap', trapId: trap.id, x: trap.x, y: trap.y },
        });
      }
    }

    updateTraps() {
      if (this.traps.length === 0) return;
      const power = this.power();
      const now = this.now;
      const radius = this.trapRadius() + PLAYER_HALF;
      const survivors = this.players.filter(
        (player) =>
          player.role === 'survivor' &&
          !player.downed &&
          !player.dead &&
          !player.escaped &&
          !player.hiddenIn,
      );

      this.traps = this.traps.filter((trap) => {
        if (now >= trap.expiresAt) return false;
        if (now < trap.armedAt) return true;
        for (const survivor of survivors) {
          if (dist(survivor.x, survivor.y, trap.x, trap.y) > radius) continue;
          survivor.rootUntil = now + power.trapRootMs;
          survivor.morphed = false;
          survivor.propType = null;
          survivor.isRepairing = false;
          survivor.skillCheck = null;
          this.events.push({
            type: 'trapTriggered',
            data: { id: survivor.id, trapId: trap.id, x: trap.x, y: trap.y },
          });
          return false;
        }
        return true;
      });
    }

    step(dt) {
      if (this.finished) return;
      this.now += dt * 1000;

      this.updateBleedOut();
      this.updateHazards();
      this.updateTraps();
      this.updateProjectiles(dt);

      for (const player of this.players) player.wantFinish = false;

      const intents = new Map();
      for (const player of this.players) {
        if (player.dead || player.escaped) {
          player.isRepairing = false;
          player.reviving = false;
          player.skillCheck = null;
          continue;
        }
        if (player.downed) {
          player.isRepairing = false;
          player.reviving = false;
          player.skillCheck = null;
          continue;
        }
        if (player.hiddenIn) {
          player.reviving = false;
          if (player.isHuman && this.pressed(player, 'locker')) {
            this.toggleLocker(player);
          }
          continue;
        }
        player.reviving = false;
        intents.set(player.id, this.buildIntent(player, dt));
      }

      for (const player of this.players) {
        const intent = intents.get(player.id);
        if (intent) this.applyIntent(player, intent, dt);
      }

      this.updateFinish(dt);

      this.processRevives(intents, dt);
      for (const player of this.players) {
        const intent = intents.get(player.id);
        if (intent && intent.attack && !player.downed && !player.dead) this.attack(player.id);
      }
      this.updateSkillChecks();
      this.updateOutcome();
    }

    // Mirrors the server revive rule: a survivor standing still next to a
    // downed teammate brings them back over REVIVE_SECONDS.
    processRevives(intents, dt) {
      const reviveRange = this.config.reviveRange || 64;
      const reviveSeconds = this.config.reviveSeconds || 4;

      for (const player of this.players) {
        if (player.downed) player.reviveCount = 0;
      }

      for (const helper of this.players) {
        if (helper.downed || helper.dead || helper.escaped || helper.hiddenIn) continue;
        const intent = intents.get(helper.id);
        if (!intent || !intent.revive) continue;
        if (helper.role !== 'survivor' || helper.morphed) continue;
        if (helper.rootUntil > this.now) continue;
        if (intent.moveX !== 0 || intent.moveY !== 0) continue;

        let target = null;
        let bestDistance = Infinity;
        for (const victim of this.players) {
          if (!victim.downed || victim.dead || victim.role !== 'survivor' || victim === helper) {
            continue;
          }
          const d = dist(helper.x, helper.y, victim.x, victim.y);
          if (d > reviveRange || d >= bestDistance) continue;
          if (!hasLineOfSight(this.layout, helper.x, helper.y, victim.x, victim.y)) continue;
          target = victim;
          bestDistance = d;
        }
        if (target) {
          target.reviveCount = (target.reviveCount || 0) + 1;
          target.reviveBy = helper.id;
          helper.reviving = true;
        }
      }

      for (const victim of this.players) {
        if (!victim.downed || victim.dead) continue;
        const helpers = victim.reviveCount || 0;
        if (helpers > 0) {
          victim.reviveProgress = clamp(
            (victim.reviveProgress || 0) + (100 / reviveSeconds) * helpers * dt,
            0,
            100,
          );
          if (victim.reviveProgress >= 100) {
            const helper = victim.reviveBy ? this.getPlayer(victim.reviveBy) : null;
            if (helper) helper.stats.revived += 1;

            victim.downed = false;
            victim.health = this.config.reviveHealth || 50;
            victim.reviveProgress = 0;
            victim.bleedOutAt = 0;
            victim.finishProgress = 0;
            victim.stillMs = 0;
            victim.input = {
              up: false, down: false, left: false, right: false,
              repair: false, revive: false, sprint: false, track: false,
              trap: false, finish: false, throw: false, locker: false, useItem: false,
            };
            this.events.push({ type: 'revived', data: { id: victim.id } });
          }
        } else {
          victim.reviveProgress = clamp(
            (victim.reviveProgress || 0) - 45 * dt,
            0,
            100,
          );
        }
      }
    }

    updateOutcome() {
      if (this.finished) return;

      const survivors = this.players.filter((player) => player.role === 'survivor');
      if (survivors.length === 0) {
        this.finished = true;
        this.winner = 'killer';
        this.endReason = 'No survivors remain.';
        return;
      }

      const unresolved = survivors.filter(
        (player) => !player.dead && !player.escaped,
      );
      const escaped = survivors.filter((player) => player.escaped);
      const standing = survivors.filter(
        (player) => !player.dead && !player.escaped && !player.downed,
      );

      if (unresolved.length === 0) {
        this.finished = true;
        if (escaped.length > 0) {
          this.winner = 'survivors';
          this.endReason = 'Survivors slipped through the exit gate.';
        } else {
          this.winner = 'killer';
          this.endReason = 'Every survivor fell before the gate opened.';
        }
        return;
      }

      if (standing.length === 0) {
        this.finished = true;
        if (escaped.length > 0) {
          this.winner = 'survivors';
          this.endReason = 'Survivors slipped through the exit gate.';
        } else {
          this.winner = 'killer';
          this.endReason = 'Every survivor is down. The Killer claims the night.';
        }
      }
    }

    snapshot(recipientId) {
      const recipient = this.getPlayer(recipientId) || this.human;
      const power = this.power();
      const now = this.now;
      const inFog = this.fogs.some(
        (fog) => distSq(recipient.x, recipient.y, fog.x, fog.y) <= fog.radius * fog.radius,
      );
      if (recipient.role === 'killer' && inFog) {
        power.visionRange = Math.round(power.visionRange * FOG_VISION_MULTIPLIER);
      }
      const tracking = recipient.role === 'killer' && recipient.trackUntil > now;
      const visible = [];
      for (const player of this.players) {
        if (player.hiddenIn && player.id !== recipient.id) continue;
        const isOtherSurvivor =
          recipient.role === 'killer' && player.id !== recipient.id && player.role === 'survivor';
        if (
          isOtherSurvivor &&
          !tracking &&
          !killerCanSee(this.layout, this.config, recipient, player, power.visionRange)
        ) {
          continue;
        }
        visible.push(serializePlayer(player, this.config, now, recipient));
      }

      const survivors = this.players.filter((player) => player.role === 'survivor');
      const killerAbilities =
        recipient.role === 'killer'
          ? {
              sprintUntil: recipient.sprintUntil,
              sprintReadyAt: recipient.nextSprintAt,
              trackUntil: recipient.trackUntil,
              trackReadyAt: recipient.nextTrackAt,
              trapReadyAt: recipient.nextTrapAt,
              maxTraps: power.maxTraps,
              traps: this.traps.map((trap) => ({
                id: trap.id,
                x: Math.round(trap.x),
                y: Math.round(trap.y),
                armed: now >= trap.armedAt,
              })),
            }
          : null;

      return {
        t: this.now,
        roomCode: 'PRACTICE',
        me: recipient.id,
        myRole: recipient.role,
        players: visible,
        machines: this.machines.map(serializeMachine),
        repairedCount: this.machines.filter((machine) => machine.repaired).length,
        totalMachines: this.machines.length,
        survivorsAlive: survivors.filter(
          (player) => !player.downed && !player.dead && !player.escaped,
        ).length,
        totalSurvivors: survivors.length,
        matchState: this.finished ? 'ended' : 'playing',
        winner: this.winner || null,
        power,
        exit: { x: this.exit.x, y: this.exit.y, open: this.exitOpen },
        skillCheck: recipient.skillCheck
          ? {
              seq: recipient.skillCheck.seq,
              startedAt: recipient.skillCheck.startedAt,
              durationMs: recipient.skillCheck.durationMs,
              zoneStart: recipient.skillCheck.zoneStart,
              zoneEnd: recipient.skillCheck.zoneEnd,
            }
          : null,
        projectiles: this.projectiles.map((projectile) => ({
          id: projectile.id,
          x: Math.round(projectile.x),
          y: Math.round(projectile.y),
        })),
        killerAbilities,
      };
    }
  }

  PN.LocalSim = LocalSim;

  // ------------------------------------------------------------------- Scene
  class PropNightScene extends Phaser.Scene {
    constructor() {
      super({ key: 'PropNightScene' });
    }

    init(data) {
      this.payload = data || {};
      this.mode = this.payload.mode === 'offline' ? 'offline' : 'online';
      this.power = null;
      this.endReported = false;
    }

    create() {
      this.worldReady = false;
      this.myId = this.payload.id || 'local-you';
      this.me = null;
      this.myRole = 'survivor';
      this.localView = null;
      this.localSprite = null;
      this.localAngle = 0;
      this.nextAttackAt = 0;
      this.localSlashAt = -9999;
      this.inputSendAccumulator = 0;
      this.hudAccumulator = 0;

      this.playerViews = new Map();
      this.machineViews = new Map();
      this.trapViews = new Map();
      this.lastState = null;

      this.createGlobalTextures();
      this.createInput();

      if (this.mode === 'offline') {
        this.sim = new PN.LocalSim(
          this.payload.map,
          this.payload.config,
          this.payload.human,
          this.payload.botCount || 3,
        );
      }

      this.initializeWorld();

      this.torch = {
        charge: 1,
        on: true,
        lowWarned: false,
        shownPct: -1,
        shownOn: null,
      };
      this.introShown = false;
      this.introTimer = null;

      this.darkness = this.add
        .renderTexture(0, 0, this.worldW, this.worldH)
        .setOrigin(0, 0)
        .setDepth(40);
      this.lightBatch = this.game.renderer.type === Phaser.WEBGL;

      this.cameras.main.fadeIn(650, 2, 3, 8);
      this.cameras.main.setZoom(1.25);
      this.tweens.add({
        targets: this.cameras.main,
        zoom: 1.15,
        duration: 1200,
        ease: 'Cubic.easeOut',
      });

      this.events.once('shutdown', () => {
        const intro = document.getElementById('roundIntro');
        if (intro) intro.classList.remove('show', 'killer', 'survivor');
        if (this.introTimer) clearTimeout(this.introTimer);
      });

      this.worldReady = true;

      if (PN.Manager && PN.Manager.flush) PN.Manager.flush(this);
    }

    // ------------------------------------------------------------ Input
    createInput() {
      this.keys = this.input.keyboard.addKeys({
        up: Phaser.Input.Keyboard.KeyCodes.W,
        down: Phaser.Input.Keyboard.KeyCodes.S,
        left: Phaser.Input.Keyboard.KeyCodes.A,
        right: Phaser.Input.Keyboard.KeyCodes.D,
        morph: Phaser.Input.Keyboard.KeyCodes.E,
        repair: Phaser.Input.Keyboard.KeyCodes.F,
        revive: Phaser.Input.Keyboard.KeyCodes.R,
        attack: Phaser.Input.Keyboard.KeyCodes.SPACE,
        sprint: Phaser.Input.Keyboard.KeyCodes.SHIFT,
        pulse: Phaser.Input.Keyboard.KeyCodes.Q,
        trap: Phaser.Input.Keyboard.KeyCodes.C,
        throw: Phaser.Input.Keyboard.KeyCodes.G,
        locker: Phaser.Input.Keyboard.KeyCodes.H,
        useItem: Phaser.Input.Keyboard.KeyCodes.X,
        torch: Phaser.Input.Keyboard.KeyCodes.L,
      });

      this.input.keyboard.addCapture([
        Phaser.Input.Keyboard.KeyCodes.W,
        Phaser.Input.Keyboard.KeyCodes.A,
        Phaser.Input.Keyboard.KeyCodes.S,
        Phaser.Input.Keyboard.KeyCodes.D,
        Phaser.Input.Keyboard.KeyCodes.E,
        Phaser.Input.Keyboard.KeyCodes.F,
        Phaser.Input.Keyboard.KeyCodes.R,
        Phaser.Input.Keyboard.KeyCodes.SPACE,
        Phaser.Input.Keyboard.KeyCodes.SHIFT,
        Phaser.Input.Keyboard.KeyCodes.Q,
        Phaser.Input.Keyboard.KeyCodes.C,
        Phaser.Input.Keyboard.KeyCodes.G,
        Phaser.Input.Keyboard.KeyCodes.H,
        Phaser.Input.Keyboard.KeyCodes.X,
        Phaser.Input.Keyboard.KeyCodes.L,
      ]);
    }

    inputBlocked() {
      return !!(PN.Manager && PN.Manager.inputBlocked);
    }

    // -------------------------------------------------------- Textures
    canvasTexture(key, width, height, draw) {
      if (this.textures.exists(key)) return key;
      const texture = this.textures.createCanvas(key, width, height);
      draw(texture.context, texture);
      texture.refresh();
      return key;
    }

    textureSize(mode) {
      return mode === 'machine' ? 48 : PREVIEW;
    }

    createGlobalTextures() {
      this.canvasTexture('downed', PREVIEW, PREVIEW, (ctx) => {
        const size = PREVIEW;
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
        ctx.shadowBlur = 5;
        PN.roundedRect(ctx, 4, 4, 28, 28, 7);
        ctx.fillStyle = '#6d727c';
        ctx.fill();
        ctx.restore();
        PN.roundedRect(ctx, 4, 4, 28, 28, 7);
        ctx.strokeStyle = '#a2a7b0';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = '#282b31';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(10, 11); ctx.lineTo(15, 16);
        ctx.moveTo(15, 11); ctx.lineTo(10, 16);
        ctx.moveTo(21, 11); ctx.lineTo(26, 16);
        ctx.moveTo(26, 11); ctx.lineTo(21, 16);
        ctx.stroke();
        void size;
      });

      this.canvasTexture('arrow', 18, 12, (ctx) => {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(2, 2);
        ctx.lineTo(16, 6);
        ctx.lineTo(2, 10);
        ctx.lineTo(6, 6);
        ctx.closePath();
        ctx.fill();
      });

      this.canvasTexture('trap', 30, 30, (ctx) => {
        ctx.translate(15, 15);
        ctx.strokeStyle = '#c9cfd8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 2;
        for (let i = 0; i < 8; i += 1) {
          const angle = (i / 8) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(Math.cos(angle) * 7, Math.sin(angle) * 7);
          ctx.lineTo(Math.cos(angle) * 13, Math.sin(angle) * 13);
          ctx.stroke();
        }
        ctx.fillStyle = '#e0642f';
        ctx.beginPath();
        ctx.arc(0, 0, 3, 0, Math.PI * 2);
        ctx.fill();
      });

      this.canvasTexture('locker', 42, 48, (ctx) => {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(6, 6, 32, 42);
        ctx.fillStyle = '#3c4a58';
        ctx.fillRect(4, 4, 32, 42);
        ctx.strokeStyle = '#7c8b9c';
        ctx.lineWidth = 2;
        ctx.strokeRect(4, 4, 32, 42);
        ctx.strokeStyle = '#2a333d';
        ctx.lineWidth = 1;
        for (let i = 0; i < 4; i += 1) {
          ctx.beginPath();
          ctx.moveTo(9, 10 + i * 4);
          ctx.lineTo(21, 10 + i * 4);
          ctx.stroke();
        }
        ctx.fillStyle = '#9fb3c7';
        ctx.fillRect(27, 20, 3, 10);
      });

      this.canvasTexture('exit', 56, 56, (ctx) => {
        ctx.fillStyle = '#1a2028';
        ctx.fillRect(6, 2, 44, 52);
        ctx.strokeStyle = '#5d687c';
        ctx.lineWidth = 3;
        ctx.strokeRect(6, 2, 44, 52);
        ctx.strokeStyle = '#39424f';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(28, 3);
        ctx.lineTo(28, 53);
        ctx.stroke();
        ctx.fillStyle = '#8d1f2c';
        ctx.beginPath();
        ctx.arc(23, 28, 3, 0, Math.PI * 2);
        ctx.arc(33, 28, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ff5d5d';
        ctx.font = 'bold 9px Trebuchet MS';
        ctx.textAlign = 'center';
        ctx.fillText('EXIT', 28, 49);
      });

      this.canvasTexture('exitOpen', 56, 56, (ctx) => {
        ctx.fillStyle = '#0d1a12';
        ctx.fillRect(6, 2, 44, 52);
        ctx.strokeStyle = '#5de78e';
        ctx.lineWidth = 3;
        ctx.strokeRect(6, 2, 44, 52);
        const glow = ctx.createRadialGradient(28, 28, 2, 28, 28, 26);
        glow.addColorStop(0, 'rgba(93,231,142,0.85)');
        glow.addColorStop(1, 'rgba(93,231,142,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(4, 0, 48, 56);
        ctx.fillStyle = '#d7ffe6';
        ctx.font = 'bold 9px Trebuchet MS';
        ctx.textAlign = 'center';
        ctx.fillText('OPEN', 28, 49);
      });

      for (const size of [90, 140, 190, 250]) {
        this.canvasTexture(`light:${size}`, size, size, (ctx) => {
          const half = size / 2;
          const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
          gradient.addColorStop(0, 'rgba(255,255,255,1)');
          gradient.addColorStop(0.4, 'rgba(255,250,235,0.9)');
          gradient.addColorStop(0.72, 'rgba(255,245,215,0.42)');
          gradient.addColorStop(1, 'rgba(255,245,215,0)');
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, size, size);
        });
      }
    }

    createObjectiveViews() {
      const exitTile = this.mapDef.exitTile || [13, 13];
      this.exitCenter = tileCenter(exitTile[0], exitTile[1]);
      this.exitView = this.add
        .image(this.exitCenter.x, this.exitCenter.y, 'exit')
        .setDepth(4);

      this.lockerViews = (this.mapDef.lockerTiles || []).map(([col, row]) => {
        const center = tileCenter(col, row);
        return this.add.image(center.x, center.y, 'locker').setDepth(4);
      });
    }

    ensurePropTexture(type) {
      const key = `prop:${type}`;
      return this.canvasTexture(key, PREVIEW, PREVIEW, (ctx) => {
        PN.drawProp(ctx, PREVIEW, type);
      });
    }

    ensureMachineTexture(done) {
      const key = `machine:${this.mapId}:${done ? 1 : 0}`;
      return this.canvasTexture(key, 48, 48, (ctx) => {
        PN.drawMachine(ctx, 48, this.mapDef.style, done);
      });
    }

    ensureLookTexture(look) {
      const key = PN.lookKey(look);
      if (this.textures.exists(key)) return key;

      const applied = look || PN.DEFAULT_LOOK;
      const texture = this.textures.createCanvas(key, PREVIEW, PREVIEW);
      texture.context.clearRect(0, 0, PREVIEW, PREVIEW);
      PN.drawPlayer(texture.context, PREVIEW, applied, null);
      texture.refresh();

      if (applied.custom) {
        const redraw = () => {
          if (!this.textures.exists(key)) return;
          const live = this.textures.get(key);
          live.context.clearRect(0, 0, PREVIEW, PREVIEW);
          PN.drawPlayer(
            live.context,
            PREVIEW,
            applied,
            PN.loadCustomImage(applied.custom, redraw),
          );
          live.refresh();
        };
        // The menu preview usually decodes the drawing first. In that case the
        // cache already has a complete image and no callback fires, so paint it
        // immediately instead of leaving the base-colour texture in place.
        const image = PN.loadCustomImage(applied.custom, redraw);
        if (image) {
          texture.context.clearRect(0, 0, PREVIEW, PREVIEW);
          PN.drawPlayer(texture.context, PREVIEW, applied, image);
          texture.refresh();
        }
      }

      return key;
    }

    // ----------------------------------------------------------- World
    initializeWorld() {
      const payload = this.payload;
      this.mapDef = payload.map;
      this.mapId = this.mapDef.id;
      this.cfg = payload.config;
      this.tileSize = TILE;
      this.mapRows = this.mapDef.layout;
      this.worldW = this.mapRows[0].length * TILE;
      this.worldH = this.mapRows.length * TILE;

      this.physics.world.setBounds(0, 0, this.worldW, this.worldH);
      this.cameras.main.setBounds(0, 0, this.worldW, this.worldH);
      this.cameras.main.setBackgroundColor(this.mapDef.style.fog || '#04050a');

      const grid = this.mapRows.map((row) =>
        row.split('').map((cell) => (cell === '#' ? 1 : 0)),
      );
      const map = this.make.tilemap({ data: grid, tileWidth: TILE, tileHeight: TILE });
      this.canvasTexture(`tiles:${this.mapId}`, TILE * 2, TILE, (ctx) => {
        PN.drawTiles(ctx, TILE, this.mapDef.style);
      });
      const tileset = map.addTilesetImage('tiles', `tiles:${this.mapId}`, TILE, TILE, 0, 0);
      this.wallLayer = map.createLayer(0, tileset, 0, 0);
      this.wallLayer.setCollision(1);
      this.wallLayer.setDepth(0);

      this.spawnAmbientProps();
      this.createMachineViews();
      this.createObjectiveViews();
    }

    spawnAmbientProps() {
      const floors = [];
      for (let row = 1; row < this.mapRows.length - 1; row += 1) {
        for (let col = 1; col < this.mapRows[row].length - 1; col += 1) {
          if (this.mapRows[row][col] !== '.') continue;
          const x = col * TILE + TILE / 2;
          const y = row * TILE + TILE / 2;
          const nearMachine = this.mapDef.machineTiles.some(([mc, mr]) => {
            const center = tileCenter(mc, mr);
            return dist(x, y, center.x, center.y) < 90;
          });
          if (!nearMachine) floors.push({ x, y });
        }
      }

      Phaser.Utils.Array.Shuffle(floors);
      const total = Math.min(this.mapDef.ambientCount || 60, floors.length);
      const types = this.mapDef.propTypes;

      for (let i = 0; i < total; i += 1) {
        const point = floors[i];
        const type = types[i % types.length];
        const prop = this.add
          .image(point.x + Phaser.Math.Between(-5, 5), point.y + Phaser.Math.Between(-5, 5), this.ensurePropTexture(type))
          .setDepth(3)
          .setAlpha(0.92);
        if (i % 6 === 0) prop.setScale(0.9);
      }
    }

    createMachineViews() {
      this.machineViews.clear();
      const machines = this.mode === 'offline'
        ? this.sim.machines.map(serializeMachine)
        : this.payload.machines;

      for (const machine of machines) {
        const glow = this.add.circle(machine.x, machine.y, 30, 0x2d8cff, 0).setDepth(2);
        const sprite = this.add.image(machine.x, machine.y, this.ensureMachineTexture(false)).setDepth(6);
        const barBg = this.add
          .rectangle(machine.x, machine.y - 34, 50, 7, 0x070a0f, 0.92)
          .setStrokeStyle(1, 0x5d687c, 0.75)
          .setDepth(44)
          .setVisible(false);
        const bar = this.add
          .rectangle(machine.x - 24, machine.y - 34, 0, 5, 0x5de78e, 1)
          .setOrigin(0, 0.5)
          .setDepth(45)
          .setVisible(false);
        const label = this.add
          .text(machine.x, machine.y - 47, '', {
            fontFamily: 'Trebuchet MS, Segoe UI, sans-serif',
            fontSize: '11px',
            color: '#bfe5ff',
            stroke: '#040609',
            strokeThickness: 3,
          })
          .setOrigin(0.5, 1)
          .setDepth(45)
          .setVisible(false);

        this.machineViews.set(machine.id, {
          glow, sprite, barBg, bar, label, progress: 0, repaired: false,
        });
      }
    }

    // ------------------------------------------------------- Player views
    textureForPlayer(player) {
      if (player.downed) return 'downed';
      if (player.role === 'killer') return this.ensureLookTexture(player.look);
      if (player.morphed) return this.ensurePropTexture(player.propType || this.mapDef.propTypes[0]);
      return this.ensureLookTexture(player.look);
    }

    createPlayerView(player) {
      const isLocal = player.id === this.myId;
      const texture = this.textureForPlayer(player);
      const usePhysics = isLocal && this.mode === 'online';
      let sprite;

      if (usePhysics) {
        sprite = this.physics.add.sprite(player.x, player.y, texture);
        sprite.setCollideWorldBounds(true);
        sprite.body.setSize(26, 26, true);
        this.physics.add.collider(sprite, this.wallLayer);
        this.localSprite = sprite;
      } else {
        sprite = this.add.sprite(player.x, player.y, texture);
      }

      sprite.setOrigin(0.5);
      sprite.setDepth(10);

      const label = this.add
        .text(player.x, player.y - 27, player.name, {
          fontFamily: 'Trebuchet MS, Segoe UI, sans-serif',
          fontSize: '12px',
          fontStyle: 'bold',
          color: '#dfffe8',
          stroke: '#04060a',
          strokeThickness: 4,
        })
        .setOrigin(0.5, 1)
        .setDepth(39);

      const ring = this.add
        .circle(player.x, player.y, 20)
        .setStrokeStyle(2, 0xff5555, 0.85)
        .setDepth(5)
        .setVisible(false);

      const reviveBg = this.add
        .rectangle(player.x, player.y - 40, 46, 7, 0x070a0f, 0.92)
        .setStrokeStyle(1, 0x8ff0ab, 0.7)
        .setDepth(39)
        .setVisible(false);
      const reviveBar = this.add
        .rectangle(player.x - 22, player.y - 40, 0, 5, 0x5de78e, 1)
        .setOrigin(0, 0.5)
        .setDepth(39)
        .setVisible(false);

      const view = {
        sprite, label, ring, reviveBg, reviveBar,
        targetX: player.x, targetY: player.y, isLocal, hideUI: false, arrow: null,
        samples: [],
      };

      if (isLocal) {
        view.arrow = this.add.image(player.x, player.y, 'arrow').setDepth(47).setAlpha(0.85);
        this.localAngle = player.angle;
      }

      this.playerViews.set(player.id, view);
      return view;
    }

    applyState(state) {
      if (!this.worldReady || !state || !state.players) return;
      const newMe = state.players.find((player) => player.id === this.myId);
      if (!newMe) return;

      this.lastState = state;
      if (state.power) this.power = state.power;

      const roleChanged = this.me && this.me.role !== newMe.role;
      this.me = newMe;
      this.myRole = newMe.role;

      if (roleChanged) {
        this.showToast(
          this.myRole === 'killer' ? 'You are now the KILLER.' : 'You are now a SURVIVOR.',
          this.myRole === 'killer' ? 'killer' : 'success',
        );
      }

      if (!this.introShown) this.playRoundIntro();

      const seen = new Set();
      for (const player of state.players) {
        seen.add(player.id);
        this.updatePlayerView(player);
      }

      for (const [id, view] of this.playerViews) {
        if (seen.has(id) || view.isLocal) continue;
        view.sprite.destroy();
        view.label.destroy();
        view.ring.destroy();
        view.reviveBg.destroy();
        view.reviveBar.destroy();
        this.playerViews.delete(id);
      }

      this.updateMachineViews(state.machines);
      this.updateTrapViews(state);
      if (state.exit) this.updateExitView(state.exit);
      this.updateHud(state);
    }

    updateExitView(exit) {
      if (!this.exitView) return;
      const key = exit.open ? 'exitOpen' : 'exit';
      if (this.exitView.texture.key !== key) {
        this.exitView.setTexture(key);
        if (exit.open && !this.exitOpenedShown) {
          this.exitOpenedShown = true;
          this.showToast('Exit gate open! Hold F at the gate to escape.', 'success');
          if (PN.Audio) PN.Audio.play('exit');
        }
      }
      this.exitView.setAlpha(exit.open ? 0.95 : 0.82);
    }

    updateTrapViews(state) {
      const traps = (state.killerAbilities && state.killerAbilities.traps) || [];
      const seen = new Set();

      for (const trap of traps) {
        seen.add(trap.id);
        let view = this.trapViews.get(trap.id);
        if (!view) {
          view = this.add.image(trap.x, trap.y, 'trap').setDepth(6);
          this.trapViews.set(trap.id, view);
        }
        view.setPosition(trap.x, trap.y);
        view.setAlpha(trap.armed ? 1 : 0.4);
      }

      for (const [id, view] of this.trapViews) {
        if (seen.has(id)) continue;
        view.destroy();
        this.trapViews.delete(id);
      }
    }

    updatePlayerView(player) {
      let view = this.playerViews.get(player.id);
      if (!view) view = this.createPlayerView(player);
      view.player = player;

      const texture = this.textureForPlayer(player);
      if (view.sprite.texture.key !== texture) view.sprite.setTexture(texture);
      view.sprite.setAlpha(player.dead || player.escaped || player.hidden ? 0.45 : 1);

      if (player.rooted) view.sprite.setTint(0x9fd0ff);
      else if (player.sprinting) view.sprite.setTint(0xffb4a2);
      else view.sprite.clearTint();

      const hideUI =
        this.myRole === 'killer' && player.role === 'survivor' && player.camouflaged;
      view.hideUI = hideUI;
      view.label.setVisible(!hideUI);
      view.ring.setVisible(player.role === 'killer' && !player.downed && !player.dead);
      view.ring.setPosition(player.x, player.y);

      const showRevive = player.downed === true && !player.dead;
      view.reviveBg.setVisible(showRevive);
      view.reviveBar.setVisible(showRevive);
      if (showRevive) {
        const ratio = clamp((player.reviveProgress || 0) / 100, 0, 1);
        view.reviveBar.displayWidth = 44 * ratio;
        view.reviveBg.setPosition(player.x, player.y - 40);
        view.reviveBar.setPosition(player.x - 22, player.y - 40);
      }

      if (!hideUI) {
        let text;
        if (player.id === this.myId) {
          text = 'YOU';
          if (player.dead) text = 'YOU · DEAD';
          else if (player.escaped) text = 'YOU · ESCAPED';
          else if (player.hidden) text = 'YOU · HIDDEN';
          else if (player.downed) text = 'YOU · DOWNED';
          else if (player.role === 'killer') text = 'YOU · KILLER';
          else if (player.morphed) text = 'YOU · PROP';
        } else if (player.dead) {
          text = `${player.name} · DEAD`;
        } else if (player.escaped) {
          text = `${player.name} · ESCAPED`;
        } else if (player.hidden) {
          text = `${player.name} · HIDDEN`;
        } else if (player.role === 'killer') {
          text = `${player.name} · KILLER`;
        } else if (player.downed) {
          text = `${player.name} · DOWNED`;
        } else {
          text = `${player.name} · SURVIVOR`;
        }
        if (player.repairing && player.role === 'survivor') text += ' · FIXING';
        if (player.downed && !player.dead && player.bleedRemaining > 0) {
          text += ` · ${player.bleedRemaining}s`;
        }
        if (player.finishing) text += ' · FINISHING';

        view.label.setText(text);
        view.label.setColor(
          player.role === 'killer'
            ? '#ff7f7f'
            : player.downed
              ? '#aeb3bd'
              : player.id === this.myId
                ? '#ffe39a'
                : '#8ff0ab',
        );
      }

      if (hideUI) view.sprite.setDepth(3);
      else if (player.downed) view.sprite.setDepth(8);
      else if (player.morphed) view.sprite.setDepth(7);
      else if (player.role === 'killer') view.sprite.setDepth(11);
      else view.sprite.setDepth(10);

      if (view.isLocal) {
        this.localView = view;
        this.localSprite = view.sprite;
        this.me = player;

        if (this.cameras.main._follow !== view.sprite) {
          this.cameras.main.startFollow(view.sprite, true, 0.12, 0.12);
        }

        if (this.mode === 'offline') {
          view.sprite.setPosition(player.x, player.y);
          this.localAngle = player.angle;
        } else {
          const dx = player.x - view.sprite.x;
          const dy = player.y - view.sprite.y;
          if (Math.hypot(dx, dy) > 70 && view.sprite.body) {
            view.sprite.body.reset(player.x, player.y);
          }
        }
      } else {
        view.targetX = player.x;
        view.targetY = player.y;
        if (this.mode === 'online') {
          view.samples.push({ time: performance.now(), x: player.x, y: player.y });
          if (view.samples.length > 32) view.samples.shift();
        }
      }
    }

    // ---------------------------------------------------------- Update
    update(time, delta) {
      if (!this.worldReady) return;

      if (this.mode === 'offline') this.stepOffline(delta);
      else this.stepOnline(delta);

      this.syncSkillCheck();
      this.updateSkillCheckUi();
      this.handleActionKeys(time);
      this.interpolateRemotePlayers(delta);
      this.updateRemoteVisibility();
      this.updateLocalMarker();
      this.updateTorch(delta);
      this.updateDarkness();

      this.hudAccumulator += delta;
      if (this.hudAccumulator >= 100) {
        this.hudAccumulator = 0;
        this.refreshDynamicHud();
        this.refreshMachineBars();
      }
    }

    collectInput() {
      const blocked = this.inputBlocked();
      const me = this.me;
      const active = !!(me && !me.downed && !me.dead && !me.escaped);
      const hidden = !!(me && me.hidden);
      const isSurvivor = !!(me && me.role === 'survivor');
      const isKiller = !!(me && me.role === 'killer');
      const up = !blocked && active && !hidden && this.keys.up.isDown;
      const down = !blocked && active && !hidden && this.keys.down.isDown;
      const left = !blocked && active && !hidden && this.keys.left.isDown;
      const right = !blocked && active && !hidden && this.keys.right.isDown;
      const repair =
        !blocked && active && !hidden && isSurvivor && this.keys.repair.isDown;
      const revive =
        !blocked && active && !hidden && isSurvivor && this.keys.revive.isDown;
      const finish =
        !blocked && active && !hidden && isKiller && this.keys.repair.isDown;
      const sprint = !blocked && active && !hidden && isKiller && this.keys.sprint.isDown;
      const track = !blocked && active && !hidden && isKiller && this.keys.pulse.isDown;
      const trap = !blocked && active && !hidden && isKiller && this.keys.trap.isDown;
      const throwProp =
        !blocked && active && !hidden && isSurvivor && this.keys.throw.isDown;
      const locker = !blocked && active && this.keys.locker.isDown;
      const useItem =
        !blocked && active && !hidden && isSurvivor && this.keys.useItem.isDown;
      return {
        up, down, left, right, repair, revive, sprint, track, trap,
        finish, throw: throwProp, locker, useItem,
      };
    }

    attackCooldownMs() {
      return (this.power && this.power.attackCooldownMs) || this.cfg.attackCooldownMs;
    }

    stepOnline(delta) {
      if (!this.localSprite || !this.localSprite.body || !this.me) return;
      const input = this.collectInput();

      if (this.me.downed || this.me.dead || this.me.escaped || this.me.hidden || this.me.rooted) {
        this.localSprite.body.setVelocity(0, 0);
      } else {
        const x = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        const y = (input.down ? 1 : 0) - (input.up ? 1 : 0);
        if (x === 0 && y === 0) {
          this.localSprite.body.setVelocity(0, 0);
        } else {
          const length = Math.hypot(x, y);
          const killerSpeed = (this.power && this.power.killerSpeed) || this.cfg.killerSpeed;
          const baseSpeed = this.me.role === 'killer' ? killerSpeed : this.cfg.survivorSpeed;
          let speed = baseSpeed * (this.me.morphed ? this.cfg.morphSpeedMultiplier : 1);
          // Predict from the server-confirmed sprint, not the raw key, so the
          // local sprite does not rubber-band when a lunge ends.
          if (this.me.role === 'killer' && this.me.sprinting) {
            speed *= (this.power && this.power.sprintSpeedMultiplier) || SPRINT_SPEED_MULTIPLIER;
          }
          this.localAngle = Math.atan2(y, x);
          this.localSprite.body.setVelocity((x / length) * speed, (y / length) * speed);
        }
      }

      this.inputSendAccumulator += delta;
      if (this.inputSendAccumulator >= 33) {
        this.inputSendAccumulator = 0;
        if (this.socket && this.socket.connected) this.socket.emit('input', input);
      }
    }

    stepOffline(delta) {
      const dt = Math.min(0.05, delta / 1000);
      const input = this.collectInput();
      this.sim.setInput(input);
      this.sim.step(dt);

      const state = this.sim.snapshot(this.sim.humanId);
      this.applyState(state);

      for (const event of this.sim.drainEvents()) this.handleEvent(event.type, event.data);

      if (this.sim.finished && !this.endReported) {
        this.endReported = true;
        if (PN.Manager && PN.Manager.onRoundEnd) {
          PN.Manager.onRoundEnd({
            winner: this.sim.winner,
            reason: this.sim.endReason,
            stats: this.sim.players.map((player) => ({
              id: player.id,
              name: player.name,
              role: player.role,
              escaped: player.escaped,
              ...player.stats,
            })),
          });
        }
      }
    }

    handleActionKeys(time) {
      if (!this.me) return;
      const blocked = this.inputBlocked();
      if (blocked) return;

      if (
        this.myRole === 'survivor' &&
        this.skillCheckUi &&
        Phaser.Input.Keyboard.JustDown(this.keys.attack)
      ) {
        this.completeSkillCheck();
        return;
      }

      if (this.myRole === 'survivor' && Phaser.Input.Keyboard.JustDown(this.keys.torch)) {
        this.toggleTorch();
      }

      if (
        Phaser.Input.Keyboard.JustDown(this.keys.morph) &&
        this.me.role === 'survivor' &&
        !this.me.downed &&
        !this.me.dead &&
        !this.me.escaped &&
        !this.me.hidden
      ) {
        this.emitAction('morph');
      }

      if (
        Phaser.Input.Keyboard.JustDown(this.keys.attack) &&
        this.me.role === 'killer' &&
        !this.me.downed &&
        !this.me.dead &&
        !this.me.rooted
      ) {
        if (time >= this.nextAttackAt) {
          this.nextAttackAt = time + this.attackCooldownMs();
          this.localSlashAt = time;
          if (this.localSprite) this.showSlash(this.localSprite.x, this.localSprite.y, this.localAngle);
          this.emitAction('attack');
          if (PN.Audio) PN.Audio.play('slash');
        }
      }
    }

    syncSkillCheck() {
      if (this.mode !== 'online' || !this.lastState) return;
      const check = this.lastState.skillCheck;
      if (!check) {
        if (this.skillCheckUi) this.hideSkillCheck();
        return;
      }
      if (this.skillCheckUi && this.skillCheckUi.seq === check.seq) return;
      const elapsed = Math.max(0, (this.lastState.t || 0) - check.startedAt);
      this.showSkillCheck(check, elapsed);
    }

    showSkillCheck(check, elapsed = 0) {
      this.skillCheckUi = {
        seq: check.seq,
        startedAt: this.time.now - elapsed,
        durationMs: check.durationMs,
        zoneStart: check.zoneStart,
        zoneEnd: check.zoneEnd,
      };

      const el = document.getElementById('skillCheck');
      if (!el) return;
      el.classList.add('show');
      const zone = document.getElementById('skillZone');
      if (zone) {
        zone.style.left = `${(check.zoneStart / check.durationMs) * 100}%`;
        zone.style.width = `${((check.zoneEnd - check.zoneStart) / check.durationMs) * 100}%`;
      }
    }

    updateSkillCheckUi() {
      const ui = this.skillCheckUi;
      if (!ui) return;

      const elapsed = this.time.now - ui.startedAt;
      const marker = document.getElementById('skillMarker');
      if (marker) {
        marker.style.left = `${clamp(elapsed / ui.durationMs, 0, 1) * 100}%`;
      }

      if (elapsed > ui.durationMs + 400) this.hideSkillCheck();
    }

    hideSkillCheck() {
      this.skillCheckUi = null;
      const el = document.getElementById('skillCheck');
      if (el) el.classList.remove('show');
    }

    completeSkillCheck() {
      const ui = this.skillCheckUi;
      if (!ui) return;
      this.hideSkillCheck();

      if (this.mode === 'offline') {
        this.sim.resolveSkillCheck(true, ui.seq);
    } else if (this.socket && this.socket.connected) {
      this.socket.emit('skill:result', { seq: ui.seq, hit: true });
    }
    }

    emitAction(action) {
      if (this.mode === 'offline') {
        if (action === 'morph') this.sim.toggleMorph();
        else if (action === 'attack') this.sim.attack(this.sim.humanId);
        return;
      }
      if (this.socket && this.socket.connected) this.socket.emit(action);
    }

    interpolateRemotePlayers(delta) {
      if (this.mode === 'online') {
        // Render 100ms in the past and interpolate between buffered snapshots.
        const now = performance.now() - 100;
        for (const view of this.playerViews.values()) {
          if (view.isLocal) continue;
          const samples = view.samples;
          if (!samples || samples.length === 0) continue;
          if (samples.length === 1 || now <= samples[0].time) {
            view.sprite.setPosition(samples[0].x, samples[0].y);
            continue;
          }

          let a = samples[0];
          let b = samples[samples.length - 1];
          let found = false;
          for (let i = 0; i < samples.length - 1; i += 1) {
            if (now >= samples[i].time && now <= samples[i + 1].time) {
              a = samples[i];
              b = samples[i + 1];
              found = true;
              break;
            }
          }

          if (!found) {
            const latest = samples[samples.length - 1];
            view.sprite.setPosition(latest.x, latest.y);
          } else {
            const span = Math.max(1, b.time - a.time);
            const t = clamp((now - a.time) / span, 0, 1);
            view.sprite.setPosition(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
          }
        }
      } else {
        const alpha = Math.min(1, delta / 60);
        for (const view of this.playerViews.values()) {
          if (view.isLocal) continue;
          const dx = view.targetX - view.sprite.x;
          const dy = view.targetY - view.sprite.y;
          if (Math.hypot(dx, dy) > 260) {
            view.sprite.setPosition(view.targetX, view.targetY);
          } else {
            view.sprite.x += dx * alpha;
            view.sprite.y += dy * alpha;
          }
        }
      }
      for (const view of this.playerViews.values()) {
        view.label.setPosition(view.sprite.x, view.sprite.y - 27);
        view.ring.setPosition(view.sprite.x, view.sprite.y);
        if (view.reviveBg.visible) {
          view.reviveBg.setPosition(view.sprite.x, view.sprite.y - 40);
          view.reviveBar.setPosition(view.sprite.x - 22, view.sprite.y - 40);
        }
      }
    }

    pointInTorch(x, y) {
      if (!this.localSprite) return false;
      const sx = this.localSprite.x;
      const sy = this.localSprite.y;
      const distance = dist(sx, sy, x, y);
      if (distance > this.torchRange()) return false;
      if (distance < 34) return true;
      const angle = Math.atan2(y - sy, x - sx);
      const grace = Math.atan2(54, distance);
      if (Math.abs(angleDifference(angle, this.localAngle)) > TORCH_HALF_ANGLE + grace) {
        return false;
      }
      return PN.geom.hasLineOfSight(this.mapRows, sx, sy, x, y);
    }

    updateRemoteVisibility() {
      if (!this.me || !this.localSprite) return;

      for (const view of this.playerViews.values()) {
        if (view.isLocal) continue;
        let visible = true;

        if (this.me.dead || this.me.escaped) {
          visible = true;
        } else if (this.me.hidden) {
          visible = false;
        } else if (this.me.downed) {
          const d = dist(this.localSprite.x, this.localSprite.y, view.sprite.x, view.sprite.y);
          visible =
            d <= 190 &&
            PN.geom.hasLineOfSight(
              this.mapRows,
              this.localSprite.x,
              this.localSprite.y,
              view.sprite.x,
              view.sprite.y,
            );
        } else if (this.myRole === 'survivor') {
          // Survivors only see other players caught in their torch beam.
          visible = this.torch.on && this.pointInTorch(view.sprite.x, view.sprite.y);
        }

        view.sprite.setVisible(visible);
        view.label.setVisible(visible && !view.hideUI);
        const showRevive = visible && !!view.player && view.player.downed && !view.player.dead;
        view.reviveBg.setVisible(showRevive);
        view.reviveBar.setVisible(showRevive);
        if (!visible) view.ring.setVisible(false);
      }
    }

    updateLocalMarker() {
      if (!this.localView || !this.localSprite) return;
      const view = this.localView;
      const angle = this.localAngle;
      view.arrow.setPosition(
        this.localSprite.x + Math.cos(angle) * 25,
        this.localSprite.y + Math.sin(angle) * 25,
      );
      view.arrow.setRotation(angle);
      view.arrow.setTint(this.me && this.me.role === 'killer' ? 0xff7a7a : 0xb8ffd0);
      view.arrow.setVisible(!(
        this.me && (this.me.downed || this.me.dead || this.me.escaped || this.me.hidden)
      ));
    }

    // ------------------------------------------------------ Darkness & torch
    isWallAt(x, y) {
      return PN.geom.isWallAtWorld(this.mapRows, x, y);
    }

    eraseLight(key, x, y) {
      if (!this.darkness) return;
      const texture = this.textures.get(key);
      const source = texture && texture.source && texture.source[0];
      const size = source ? source.width : 140;
      const px = x - size / 2;
      const py = y - size / 2;
      if (this.lightBatch) this.darkness.batchDraw(key, px, py);
      else this.darkness.erase(key, px, py);
    }

    beginLights() {
      if (this.lightBatch) this.darkness.beginDraw();
    }

    endLights() {
      if (this.lightBatch) this.darkness.endDraw(true);
    }

    torchIsUsable() {
      return !!(
        this.me &&
        this.me.role === 'survivor' &&
        !this.me.downed &&
        !this.me.dead &&
        !this.me.escaped &&
        !this.me.hidden
      );
    }

    toggleTorch() {
      if (!this.torch || !this.torchIsUsable()) return;
      if (this.torch.charge <= 0.02) {
        this.showToast('Torch battery is dead. Let it recharge.', 'danger');
        return;
      }
      this.torch.on = !this.torch.on;
      this.torch.shownOn = null;
      if (PN.Audio) PN.Audio.play('torch');
    }

    torchRange() {
      const charge = this.torch ? this.torch.charge : 1;
      const flicker =
        charge < 0.22
          ? 0.82 + Math.sin(this.time.now / 47) * 0.12 + Math.sin(this.time.now / 13) * 0.04
          : 1;
      return (TORCH_RANGE_MIN + (TORCH_RANGE_MAX - TORCH_RANGE_MIN) * charge) * flicker;
    }

    updateTorch(delta) {
      if (!this.torch) return;
      const dt = Math.min(0.1, delta / 1000);
      if (!this.torchIsUsable()) this.torch.on = false;

      if (this.torch.on) {
        this.torch.charge = Math.max(0, this.torch.charge - dt / TORCH_DRAIN_SECONDS);
        if (this.torch.charge <= 0) {
          this.torch.charge = 0;
          this.torch.on = false;
          this.torch.lowWarned = false;
          this.showToast('Your torch died. Darkness closes in.', 'danger');
        } else if (this.torch.charge < 0.22 && !this.torch.lowWarned) {
          this.torch.lowWarned = true;
          this.showToast('Torch battery low. Press L to save it.', 'danger');
          if (PN.Audio) PN.Audio.play('batteryLow');
        }
      } else {
        this.torch.charge = Math.min(1, this.torch.charge + dt / TORCH_RECHARGE_SECONDS);
        if (this.torch.charge > 0.3) this.torch.lowWarned = false;
      }

      this.updateTorchHud();
    }

    updateTorchHud() {
      const row = document.getElementById('torchRow');
      if (!row || !this.me) return;
      const visible =
        this.me.role === 'survivor' && !this.me.dead && !this.me.escaped;
      row.classList.toggle('hidden', !visible);
      if (!visible) return;

      const pct = Math.round(this.torch.charge * 100);
      if (this.torch.shownPct === pct && this.torch.shownOn === this.torch.on) return;
      this.torch.shownPct = pct;
      this.torch.shownOn = this.torch.on;

      const fill = document.getElementById('torchFill');
      const label = document.getElementById('torchLabel');
      if (fill) fill.style.width = `${pct}%`;
      if (label) {
        if (this.torch.on) label.textContent = `TORCH ${pct}%`;
        else if (this.me.downed || this.me.hidden) label.textContent = 'TORCH OFF';
        else label.textContent = `TORCH OFF · ${pct}%`;
      }
      row.classList.toggle('off', !this.torch.on);
      row.classList.toggle('low', this.torch.charge < 0.22);
    }

    updateDarkness() {
      if (!this.darkness) return;
      this.darkness.clear();

      if (!this.me || !this.localSprite) {
        this.darkness.fill(0x02030a, 0.22);
        return;
      }

      // Dead and escaped players watch the whole hunt from above.
      if (this.me.dead || this.me.escaped) {
        this.darkness.fill(0x02030a, 0.12);
        return;
      }

      if (this.myRole === 'killer') {
        this.darkness.fill(0x02030a, KILLER_DARKNESS);
        this.beginLights();
        this.drawKillerLight();
        this.endLights();
        return;
      }

      this.darkness.fill(0x02030a, SURVIVOR_DARKNESS);
      this.beginLights();
      this.drawSurvivorLight();
      this.endLights();
    }

    drawSurvivorLight() {
      const x = this.localSprite.x;
      const y = this.localSprite.y;

      if (this.me.hidden) {
        this.eraseLight('light:90', x, y);
        return;
      }

      if (this.me.downed) {
        this.eraseLight('light:90', x, y);
        return;
      }

      if (!this.torch.on) {
        this.eraseLight('light:90', x, y);
        return;
      }

      this.eraseLight('light:140', x, y);

      const range = this.torchRange();
      const rays = 5;
      const step = 42;
      for (let i = 0; i < rays; i += 1) {
        const angle = this.localAngle + TORCH_HALF_ANGLE * ((i / (rays - 1)) * 2 - 1);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        for (let distance = 28; distance <= range; distance += step) {
          const px = x + cos * distance;
          const py = y + sin * distance;
          if (this.isWallAt(px, py)) break;
          this.eraseLight('light:140', px, py);
        }
      }
    }

    drawKillerLight() {
      const x = this.localSprite.x;
      const y = this.localSprite.y;
      const range = (this.power && this.power.visionRange) || this.cfg.visionRange;
      const half = this.cfg.visionHalfAngle;
      const rays = 7;
      const step = 52;

      this.eraseLight('light:90', x, y);
      for (let i = 0; i < rays; i += 1) {
        const angle = this.localAngle + half * ((i / (rays - 1)) * 2 - 1);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        for (let distance = 26; distance <= range; distance += step) {
          const px = x + cos * distance;
          const py = y + sin * distance;
          if (this.isWallAt(px, py)) break;
          this.eraseLight('light:190', px, py);
        }
      }
    }

    playRoundIntro() {
      this.introShown = true;
      const el = document.getElementById('roundIntro');
      if (!el) return;

      const isKiller = this.myRole === 'killer';
      const roleEl = document.getElementById('introRole');
      const eyebrow = document.getElementById('introEyebrow');
      const mapEl = document.getElementById('introMap');
      const tipEl = document.getElementById('introTip');

      if (roleEl) roleEl.textContent = isKiller ? 'THE KILLER' : 'SURVIVOR';
      if (eyebrow) eyebrow.textContent = 'THE HUNT BEGINS';
      if (mapEl) mapEl.textContent = String(this.mapDef.name || this.mapId || '').toUpperCase();
      if (tipEl) {
        tipEl.textContent = isKiller
          ? 'Hunt them down. SHIFT to lunge, Q to pulse, C to arm a trap.'
          : 'Repair the propmachines. Your torch drains — press L to save battery.';
      }

      el.classList.remove('show', 'killer', 'survivor');
      void el.offsetWidth;
      el.classList.add(isKiller ? 'killer' : 'survivor', 'show');

      if (PN.Audio) PN.Audio.play('start');
      if (this.introTimer) clearTimeout(this.introTimer);
      this.introTimer = setTimeout(() => el.classList.remove('show'), 3400);
    }

    // ------------------------------------------------------- Machines
    updateMachineViews(machineData) {
      if (!machineData) return;
      for (const machine of machineData) {
        const view = this.machineViews.get(machine.id);
        if (!view) continue;

        const justRepaired = !view.repaired && machine.repaired;
        view.progress = machine.progress;
        view.repaired = machine.repaired;

        if (justRepaired) {
          view.sprite.setTexture(this.ensureMachineTexture(true));
          view.glow.setFillStyle(0x2d8cff, 0.22);
        } else if (!machine.repaired) {
          view.sprite.setTexture(this.ensureMachineTexture(false));
        }

        const near =
          this.localSprite &&
          this.myRole === 'survivor' &&
          dist(this.localSprite.x, this.localSprite.y, machine.x, machine.y) <= this.cfg.repairRange + 16;
        const showBar = machine.progress > 0 || machine.repaired || near;
        view.barBg.setVisible(showBar);
        view.bar.setVisible(showBar);
        view.label.setVisible(showBar);

        const ratio = clamp(machine.progress / 100, 0, 1);
        view.bar.displayWidth = 48 * ratio;
        view.bar.setFillStyle(machine.repaired ? 0x54a9ff : 0x5de78e, 1);
        view.label.setText(machine.repaired ? 'ONLINE' : `${Math.floor(machine.progress)}%`);
        view.label.setColor(machine.repaired ? '#9ad8ff' : '#bfe5ff');
      }
    }

    refreshMachineBars() {
      if (!this.localSprite) return;
      for (const view of this.machineViews.values()) {
        const near =
          this.myRole === 'survivor' &&
          dist(this.localSprite.x, this.localSprite.y, view.sprite.x, view.sprite.y) <= this.cfg.repairRange + 16;
        const showBar = view.progress > 0 || view.repaired || near;
        view.barBg.setVisible(showBar);
        view.bar.setVisible(showBar);
        view.label.setVisible(showBar);
        if (view.repaired) {
          view.glow.setAlpha(0.16 + Math.sin(this.time.now / 380) * 0.06);
        } else {
          view.glow.setAlpha(0);
        }
      }
    }

    // ------------------------------------------------------ Server events
    showSlash(x, y, angle) {
      const slash = this.add.graphics({ x, y }).setDepth(30);
      const half = this.cfg.attackHalfAngle;
      slash.lineStyle(8, 0xff4343, 0.9);
      slash.beginPath();
      slash.arc(0, 0, this.cfg.attackRange * 0.7, angle - half, angle + half);
      slash.strokePath();
      slash.lineStyle(2, 0xffd3d3, 0.95);
      slash.beginPath();
      slash.arc(0, 0, this.cfg.attackRange * 0.82, angle - half * 0.8, angle + half * 0.8);
      slash.strokePath();
      this.tweens.add({
        targets: slash,
        alpha: 0,
        scaleX: 1.16,
        scaleY: 1.16,
        duration: 220,
        ease: 'Quad.Out',
        onComplete: () => slash.destroy(),
      });
    }

    flashMachine(machineId) {
      const view = this.machineViews.get(machineId);
      if (!view) return;
      view.sprite.setTintFill(0xff4d4d);
      this.time.delayedCall(130, () => {
        if (view.sprite.active) view.sprite.clearTint();
      });
    }

    handleEvent(type, data) {
      if (!this.worldReady) return;

      if (type === 'attack') {
        if (data.id === this.myId && this.time.now - this.localSlashAt < 250) return;
        this.showSlash(data.x, data.y, data.angle);
        return;
      }

      if (type === 'hit') {
        if (data.victimIds.includes(this.myId)) {
          this.flashDamage();
          if (!PN.settings || PN.settings.shake !== false) {
            this.cameras.main.shake(190, 0.009);
          }
          this.showToast('You were hit by the Killer!', 'danger');
          if (PN.Audio) PN.Audio.play('hurt');
        }
        return;
      }

      if (type === 'machineHit') {
        this.flashMachine(data.machineId);
        if (
          this.localSprite &&
          dist(this.localSprite.x, this.localSprite.y, data.x, data.y) < 240
        ) {
          if (!PN.settings || PN.settings.shake !== false) {
            this.cameras.main.shake(90, 0.003);
          }
        }
        return;
      }

      if (type === 'machineRepaired') {
        if (this.mode === 'offline' && PN.Manager && PN.Manager.onSystemChat) {
          PN.Manager.onSystemChat(
            `Propmachine online (${data.repairedCount}/${data.totalMachines}).`,
          );
        }
        this.showToast(
          `Propmachine online (${data.repairedCount}/${data.totalMachines}). The Killer grows stronger.`,
          'success',
        );
        if (PN.Audio) PN.Audio.play('machine');
        return;
      }

      if (type === 'revived') {
        if (data.id === this.myId) this.showToast('You were revived!', 'success');
        else if (this.mode === 'offline' && PN.Manager && PN.Manager.onSystemChat) {
          PN.Manager.onSystemChat('A survivor was revived.');
        }
        if (PN.Audio) PN.Audio.play('revive');
        return;
      }

      if (type === 'ability') {
        if (data.ability === 'track') {
          this.cameras.main.flash(180, 90, 40, 150);
          if (data.id !== this.myId) this.showToast('The Killer senses the dark.', 'danger');
          if (PN.Audio) PN.Audio.play('pulse');
        } else if (data.ability === 'sprint' && data.id !== this.myId) {
          this.showToast('The Killer lunges forward!', 'danger');
          if (PN.Audio) PN.Audio.play('sprint');
        } else if (data.ability === 'trap' && data.id === this.myId) {
          this.showToast('Trap armed. It fades after 30s.', 'info');
          if (PN.Audio) PN.Audio.play('arm');
        }
        return;
      }

      if (type === 'trapTriggered') {
        const burst = this.add.circle(data.x, data.y, 10, 0x9fd0ff, 0.85).setDepth(29);
        this.tweens.add({
          targets: burst,
          scale: 3.4,
          alpha: 0,
          duration: 340,
          onComplete: () => burst.destroy(),
        });
        if (data.id === this.myId) {
          this.flashDamage();
          if (!PN.settings || PN.settings.shake !== false) {
            this.cameras.main.shake(180, 0.007);
          }
          this.showToast('Snared! You cannot move.', 'danger');
          if (PN.Audio) PN.Audio.play('trap');
        }
        return;
      }

      if (type === 'skillCheck') {
        this.showSkillCheck(data);
        if (PN.Audio) PN.Audio.play('skill');
        return;
      }

      if (type === 'skillResult') {
        if (data.success) {
          this.showToast('Skill check! Bonus repair progress.', 'success');
          if (PN.Audio) PN.Audio.play('skillGood');
        } else if (data.reason !== 'missed') {
          this.showToast('Skill check failed. The machine slipped back.', 'danger');
          if (PN.Audio) PN.Audio.play('skillBad');
        }
        return;
      }

      if (type === 'quickPing' || type === 'noise') {
        this.spawnMarker(data, type === 'noise' ? data.kind : data.kind);
        if (type === 'noise' && PN.Audio) PN.Audio.play('noise');
        return;
      }

      if (type === 'alarm') {
        this.spawnMarker(data, 'alarm');
        this.showToast('An alarm shrieks across the map!', 'danger');
        if (!PN.settings || PN.settings.shake !== false) {
          this.cameras.main.shake(140, 0.004);
        }
        if (PN.Audio) PN.Audio.play('alarm');
        return;
      }

      if (type === 'flash') {
        const flash = this.add.circle(data.x, data.y, 18, 0xffffff, 0.9).setDepth(30);
        this.tweens.add({
          targets: flash,
          scale: 4,
          alpha: 0,
          duration: 320,
          onComplete: () => flash.destroy(),
        });
        if (PN.Audio) PN.Audio.play('flash');
        return;
      }

      if (type === 'stun') {
        this.spawnMarker(data, 'stun');
        this.showToast('The Killer is stunned!', 'success');
        if (PN.Audio) PN.Audio.play('stun');
        return;
      }

      if (type === 'locker') {
        if (data.id === this.myId) {
          this.showToast(data.hidden ? 'Hidden. Press H to peek out.' : 'You slipped out.', 'info');
          if (PN.Audio) PN.Audio.play('locker');
        }
        return;
      }

      if (type === 'lockerFound') {
        this.spawnMarker({ x: data.x, y: data.y }, 'locker');
        this.showToast(`${data.name} was dragged out of a locker!`, 'danger');
        if (PN.Audio) PN.Audio.play('lockerFound');
        return;
      }

      if (type === 'escaped') {
        if (data.id === this.myId) this.showToast('You escaped!', 'success');
        else this.showToast(`${data.name} escaped through the gate.`, 'success');
        if (PN.Audio) PN.Audio.play('escape');
        return;
      }

      if (type === 'executed') {
        if (data.id === this.myId) this.showToast('You were finished.', 'danger');
        else this.showToast(`${data.name} was finished by the Killer.`, 'danger');
        if (PN.Audio) PN.Audio.play('finish');
        return;
      }

      if (type === 'bledOut') {
        if (data.id === this.myId) this.showToast('You bled out.', 'danger');
        else this.showToast(`${data.name} bled out.`, 'danger');
        if (PN.Audio) PN.Audio.play('finish');
        return;
      }

      if (type === 'exitOpen') {
        this.updateExitView({ x: data.x, y: data.y, open: true });
        return;
      }
    }

    spawnMarker(data, kind) {
      const colors = {
        killer: 0xff5d5d,
        repair: 0x6bb8ff,
        help: 0xffd166,
        regroup: 0x8ff0ab,
        step: 0xffffff,
        alarm: 0xff3b3b,
        stun: 0xffe08a,
        locker: 0x9fd0ff,
        fail: 0xff7a7a,
      };
      const labels = {
        killer: 'KILLER',
        repair: 'REPAIR',
        help: 'HELP',
        regroup: 'GROUP',
        alarm: 'ALARM!',
      };
      const color = colors[kind] || 0xffffff;
      const circle = this.add.circle(data.x, data.y, 10, color, 0.8).setDepth(28);
      const ringShape = this.add
        .circle(data.x, data.y, 15)
        .setStrokeStyle(2, color, 0.9)
        .setDepth(28);
      let label = null;
      if (labels[kind]) {
        label = this.add
          .text(data.x, data.y - 20, labels[kind], {
            fontFamily: 'Trebuchet MS, Segoe UI, sans-serif',
            fontSize: '12px',
            fontStyle: 'bold',
            color: '#ffffff',
            stroke: '#04060a',
            strokeThickness: 4,
          })
          .setOrigin(0.5, 1)
          .setDepth(29);
      }

      this.tweens.add({
        targets: [circle, ringShape],
        scale: kind === 'step' ? 2.2 : 3.6,
        alpha: 0,
        duration: kind === 'step' ? 520 : 950,
        onComplete: () => {
          circle.destroy();
          ringShape.destroy();
          if (label) label.destroy();
        },
      });
    }

    // ------------------------------------------------------------- HUD
    flashDamage() {
      const el = document.getElementById('damageFlash');
      if (!el) return;
      el.classList.remove('active');
      void el.offsetWidth;
      el.classList.add('active');
    }

    showToast(text, kind) {
      const el = document.getElementById('toast');
      if (!el) return;
      el.textContent = text;
      el.className = `show ${kind || 'info'}`;
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        el.className = '';
      }, 3200);
    }

    updateHud(state) {
      if (!this.me) return;
      const roleName = document.getElementById('roleName');
      const healthLabel = document.getElementById('healthLabel');
      const healthFill = document.getElementById('healthFill');
      const objectiveCount = document.getElementById('objectiveCount');
      const objectiveHint = document.getElementById('objectiveHint');
      const downBanner = document.getElementById('downBanner');
      if (!roleName) return;

      const role = this.me.dead
        ? 'dead'
        : this.me.escaped
          ? 'escaped'
          : this.me.downed
            ? 'downed'
            : this.me.role;
      roleName.dataset.role = role;
      roleName.textContent = this.me.dead
        ? 'DEAD'
        : this.me.escaped
          ? 'ESCAPED'
          : this.me.downed
            ? 'DOWNED'
            : this.me.role === 'killer'
              ? 'KILLER'
              : 'SURVIVOR';

      const mapLabel = document.getElementById('mapLabel');
      if (mapLabel) {
        const mapName = (this.mapDef && this.mapDef.name) || this.mapId || 'UNKNOWN';
        mapLabel.textContent = `MAP - ${mapName.toUpperCase()}`;
      }

      const controlsBar = document.getElementById('controlsBar');
      if (controlsBar) {
        controlsBar.textContent =
          this.myRole === 'killer'
            ? 'WASD MOVE | F FINISH | H CHECK LOCKER | SPACE SLASH | SHIFT LUNGE | Q PULSE | C TRAP | V PING | T CHAT'
            : 'WASD MOVE | E MORPH | F REPAIR/ESCAPE | R REVIVE | G THROW | H LOCKER | X ITEM | L TORCH | SPACE CHECK | V PING | T CHAT';
      }

      this.updateBleedHud();

      const health = Math.max(0, this.me.health);
      healthFill.style.width = `${health}%`;
      healthFill.classList.toggle('low', health <= 40);

      if (this.me.role === 'killer') {
        healthLabel.textContent = 'THE HUNTER';
        healthFill.style.width = '100%';
      } else {
        healthLabel.textContent = `${Math.round(health)} / ${this.cfg.maxHealth} HP`;
      }

      objectiveCount.textContent = `${state.repairedCount} / ${state.totalMachines}`;
      objectiveHint.textContent = this.me.dead || this.me.escaped
        ? 'Spectating. The hunt continues.'
        : state.exit && state.exit.open
          ? `Gate open. ${state.survivorsAlive} survivor${state.survivorsAlive === 1 ? '' : 's'} still inside.`
          : this.me.role === 'killer'
            ? `${state.survivorsAlive} survivor${state.survivorsAlive === 1 ? '' : 's'} still standing. Find them.`
            : `Repair all propmachines. ${state.survivorsAlive} survivor${state.survivorsAlive === 1 ? '' : 's'} alive.`;

      const itemLabel = document.getElementById('itemLabel');
      if (itemLabel) {
        itemLabel.textContent =
          this.me.role === 'survivor' && this.me.item
            ? `${this.me.item.toUpperCase()}${this.me.itemUsed ? ' · USED' : ' · X'}`
            : '';
      }

      const powerLabel = document.getElementById('powerLabel');
      if (powerLabel && state.power) {
        let text =
          `HUNTER POWER x${state.power.speedMultiplier.toFixed(2)} · ` +
          `${state.repairedCount}/${state.totalMachines} online`;
        if (this.myRole === 'killer') {
          text += ` · ${state.power.maxTraps} trap slot${state.power.maxTraps === 1 ? '' : 's'}`;
        }
        powerLabel.textContent = text;
      }

      downBanner.classList.toggle('show', this.me.downed && !this.me.dead);
      const spectateBanner = document.getElementById('spectateBanner');
      if (spectateBanner) {
        spectateBanner.classList.toggle('show', !!(this.me.dead || this.me.escaped));
      }
    }

    updateBleedHud() {
      const row = document.getElementById('bleedRow');
      const fill = document.getElementById('bleedFill');
      const label = document.getElementById('bleedLabel');
      if (!row) return;

      const bleeding =
        !!this.me &&
        this.me.role === 'survivor' &&
        this.me.downed &&
        !this.me.dead &&
        !this.me.escaped;
      row.classList.toggle('hidden', !bleeding);
      if (!bleeding) return;

      const remaining = Math.max(0, this.me.bleedRemaining || 0);
      const total = this.cfg.bleedoutSeconds || BLEEDOUT_SECONDS;
      if (label) label.textContent = `BLEEDING OUT - ${remaining}s`;
      if (fill) fill.style.width = `${clamp((remaining / total) * 100, 0, 100)}%`;
    }

    refreshDynamicHud() {
      const hint = document.getElementById('hint');
      if (!hint) return;
      if (!this.me || !this.localSprite) {
        hint.textContent = 'Waiting for a role...';
        return;
      }
      this.updateBleedHud();
      if (this.me.dead) {
        hint.textContent = 'You are dead. Spectating the rest of the hunt.';
        return;
      }
      if (this.me.escaped) {
        hint.textContent = 'You escaped! Spectating the rest of the hunt.';
        return;
      }
      if (this.me.downed) {
        hint.textContent =
          this.me.finishProgress > 0
            ? 'The Killer is finishing you!'
            : `Bleeding out${this.me.bleedRemaining ? ` in ${this.me.bleedRemaining}s` : ''}. Hold on for a teammate.`;
        return;
      }
      if (this.me.hidden) {
        hint.textContent = 'Hidden in a locker. Press H to peek out.';
        return;
      }
      if (this.myRole === 'killer') {
        const ability = this.lastState && this.lastState.killerAbilities;
        const downedNear = this.nearestDownedView(this.cfg.finishRange || 56);
        if (downedNear) {
          hint.textContent = 'Hold F to finish the downed survivor.';
          return;
        }
        if (ability) {
          const now = (this.lastState && this.lastState.t) || 0;
          const ready = (at) => (at && at > now ? `${Math.ceil((at - now) / 1000)}s` : 'ready');
          hint.textContent =
            `SHIFT sprint (${ready(ability.sprintReadyAt)}) · ` +
            `Q pulse (${ready(ability.trackReadyAt)}) · ` +
            `C trap (${ready(ability.trapReadyAt)}) · F finish · SPACE slash · H check locker`;
        } else {
          hint.textContent = 'SHIFT sprint · Q pulse · C trap · F finish · SPACE slash · H locker';
        }
        return;
      }

      const exit = this.lastState && this.lastState.exit;
      if (exit && exit.open) {
        const exitDistance = dist(this.localSprite.x, this.localSprite.y, exit.x, exit.y);
        if (exitDistance <= (this.cfg.exitRange || 56) + 16) {
          hint.textContent = this.me.escapeProgress > 0
            ? `Opening the gate... ${Math.floor(this.me.escapeProgress)}%`
            : 'Hold F to escape through the gate!';
          return;
        }
      }

      if (this.me.item === 'toolbox' && !this.me.itemUsed) {
        const machine = this.nearestRepairView(this.cfg.repairRange + 96);
        if (machine) {
          hint.textContent = 'Press X to slam the toolbox into the machine (+40%).';
          return;
        }
      }
      if (this.me.item === 'medkit' && !this.me.itemUsed && this.me.health < this.cfg.maxHealth) {
        hint.textContent = 'Press X to use the medkit (+50 HP).';
        return;
      }
      if (this.me.item === 'flashlight' && !this.me.itemUsed) {
        const killerView = this.nearestKillerView(300);
        if (killerView) {
          hint.textContent = 'Face the Killer and press X to blind them.';
          return;
        }
      }

      const locker = this.nearestLockerView(this.cfg.lockerRange || 48);
      if (locker) {
        hint.textContent = 'Press H to hide in the locker.';
        return;
      }

      // Revive prompt: stand next to a downed teammate and hold R.
      let mate = null;
      let mateDistance = Infinity;
      for (const view of this.playerViews.values()) {
        const other = view.player;
        if (!other || view.isLocal || !other.downed || other.dead || other.role !== 'survivor') {
          continue;
        }
        const d = dist(this.localSprite.x, this.localSprite.y, view.sprite.x, view.sprite.y);
        if (d < mateDistance) {
          mate = other;
          mateDistance = d;
        }
      }
      if (mate && mateDistance <= this.cfg.reviveRange + 16) {
        hint.textContent = this.me.reviving
          ? `Reviving ${mate.name}... ${Math.round(mate.reviveProgress || 0)}%`
          : `Hold R to revive ${mate.name}.`;
        return;
      }

      let nearest = null;
      let nearestDistance = Infinity;
      for (const view of this.machineViews.values()) {
        if (view.repaired) continue;
        const d = dist(this.localSprite.x, this.localSprite.y, view.sprite.x, view.sprite.y);
        if (d < nearestDistance) {
          nearest = view;
          nearestDistance = d;
        }
      }
      if (nearest && nearestDistance <= this.cfg.repairRange + 16) {
        hint.textContent = this.me.repairing
          ? `Repairing... ${Math.floor(nearest.progress)}% · press SPACE in the green zone`
          : 'Hold F to repair this propmachine.';
        return;
      }
      if (this.me.morphed) {
        hint.textContent = this.me.camouflaged
          ? 'CAMOUFLAGED · stay perfectly still and blend in.'
          : 'Stand still and wait to blend in with the props.';
        return;
      }
      hint.textContent = "Stay out of the Killer's sight. Hold F near a propmachine.";
    }

    nearestDownedView(range) {
      if (!this.localSprite) return null;
      let best = null;
      let bestDistance = Infinity;
      for (const view of this.playerViews.values()) {
        const other = view.player;
        if (!other || view.isLocal || !other.downed || other.dead) continue;
        const d = dist(this.localSprite.x, this.localSprite.y, view.sprite.x, view.sprite.y);
        if (d <= range && d < bestDistance) {
          best = view;
          bestDistance = d;
        }
      }
      return best;
    }

    nearestRepairView(range) {
      if (!this.localSprite) return null;
      let best = null;
      let bestDistance = Infinity;
      for (const view of this.machineViews.values()) {
        if (view.repaired) continue;
        const d = dist(this.localSprite.x, this.localSprite.y, view.sprite.x, view.sprite.y);
        if (d <= range && d < bestDistance) {
          best = view;
          bestDistance = d;
        }
      }
      return best;
    }

    nearestKillerView(range) {
      if (!this.localSprite) return null;
      for (const view of this.playerViews.values()) {
        const other = view.player;
        if (!other || other.role !== 'killer' || other.downed || other.dead) continue;
        const d = dist(this.localSprite.x, this.localSprite.y, view.sprite.x, view.sprite.y);
        if (d <= range) return view;
      }
      return null;
    }

    nearestLockerView(range) {
      if (!this.localSprite) return null;
      for (const locker of this.lockerViews || []) {
        if (dist(this.localSprite.x, this.localSprite.y, locker.x, locker.y) <= range) {
          return locker;
        }
      }
      return null;
    }
  }

  PN.PropNightScene = PropNightScene;

  // ----------------------------------------------------------------- Manager
  const Manager = {
    game: null,
    scene: null,
    inputBlocked: false,
    onSystemChat: null,
    onRoundEnd: null,
    pending: { state: null, events: [] },

    ensureGame() {
      if (this.game) return;
      this.game = new Phaser.Game({
        type: Phaser.AUTO,
        width: 1296,
        height: 720,
        parent: 'game',
        backgroundColor: '#04050a',
        render: { antialias: true, pixelArt: false },
        physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } },
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: [],
      });
      this.game.scene.add('PropNightScene', PN.PropNightScene, false);
    },

    start(payload) {
      this.ensureGame();
      this.pending = { state: null, events: [] };
      if (this.game.scene.isActive('PropNightScene')) {
        this.game.scene.stop('PropNightScene');
      }
      this.scene = this.game.scene.getScene('PropNightScene');
      this.game.scene.start('PropNightScene', payload);
    },

    setSocket(socket) {
      if (this.scene) this.scene.socket = socket;
    },

    deliverInit(initData) {
      this.start(Object.assign({ mode: 'online' }, initData));
    },

    deliverState(state) {
      if (this.scene && this.scene.worldReady) this.scene.applyState(state);
      else this.pending.state = state;
    },

    deliverEvent(type, data) {
      if (this.scene && this.scene.worldReady) this.scene.handleEvent(type, data);
      else this.pending.events.push({ type, data });
    },

    flush(scene) {
      this.scene = scene;
      if (this.pending.state) {
        scene.applyState(this.pending.state);
        this.pending.state = null;
      }
      const events = this.pending.events.splice(0);
      for (const event of events) scene.handleEvent(event.type, event.data);
    },

    stop() {
      if (this.game && this.game.scene.isActive('PropNightScene')) {
        this.game.scene.stop('PropNightScene');
      }
      this.scene = null;
      this.pending = { state: null, events: [] };
    },
  };

  PN.Manager = Manager;
})(window.PN);
