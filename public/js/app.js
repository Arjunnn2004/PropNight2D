'use strict';

/**
 * PROP // NIGHT - menus, rooms, chat and customization.
 *
 * Owns every DOM screen and the Socket.io connection. It hands gameplay
 * payloads to PN.Manager (the Phaser layer) and renders all non-game UI.
 */
(function (PN) {
  const $ = (id) => document.getElementById(id);

  const FALLBACK_CONFIG = {
    survivorSpeed: 185,
    killerSpeed: 222,
    morphSpeedMultiplier: 0.55,
    playerHalf: 13,
    maxHealth: 100,
    meleeDamage: 100,
    attackRange: 82,
    attackHalfAngle: Math.PI / 4,
    attackCooldownMs: 850,
    repairRange: 72,
    repairSeconds: 10,
    visionRange: 560,
    visionHalfAngle: Math.PI / 4,
    camoStillMs: 1100,
    maxPlayers: 5,
  };

  const HATS = ['none', 'cap', 'horns', 'halo', 'antenna', 'crown'];
  const EYES = ['normal', 'angry', 'sad', 'visor', 'sparkle'];
  const HAT_LEVEL = { none: 1, cap: 1, horns: 2, halo: 4, antenna: 6, crown: 9 };
  const EYE_LEVEL = { normal: 1, angry: 1, sad: 2, visor: 4, sparkle: 7 };

  const App = {
    socket: null,
    connected: false,
    maps: [],
    config: FALLBACK_CONFIG,
    maxPlayers: 5,
    name: 'Player',
    look: Object.assign({}, PN.DEFAULT_LOOK),
    editing: null,
    drawGrid: new Array(256).fill(null),
    drawTool: 'pencil',
    drawColor: '#ffffff',
    channel: 'all',
    room: null,
    mode: null,
    practiceMapId: 'asylum',
    painting: false,
    xp: 0,
    settings: { volume: 60, shake: true, colorblind: false },
    preference: 'any',
    session: null,
    inviteCode: null,
    rejoinTried: false,
    rejoinPending: false,
    pingOpen: false,
    awardedRounds: [],
  };

  // ------------------------------------------------------------- persistence
  function loadLocal() {
    try {
      const savedName = localStorage.getItem('pn.name');
      if (savedName) App.name = savedName;
      const savedLook = localStorage.getItem('pn.look');
      if (savedLook) {
        const parsed = JSON.parse(savedLook);
        App.look = Object.assign({}, PN.DEFAULT_LOOK, parsed);
      }
      const savedGrid = localStorage.getItem('pn.draw');
      if (savedGrid) {
        const parsed = JSON.parse(savedGrid);
        if (Array.isArray(parsed) && parsed.length === 256) App.drawGrid = parsed;
      }
      const savedXp = Number(localStorage.getItem('pn.xp'));
      if (Number.isFinite(savedXp) && savedXp > 0) App.xp = Math.floor(savedXp);
      const savedSettings = localStorage.getItem('pn.settings');
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        App.settings = Object.assign({}, App.settings, parsed);
      }
      const savedAwarded = localStorage.getItem('pn.awarded');
      if (savedAwarded) {
        const parsed = JSON.parse(savedAwarded);
        if (Array.isArray(parsed)) App.awardedRounds = parsed.slice(-50);
      }
    } catch (error) {
      // Corrupted storage just falls back to defaults.
    }
    applySettings();
  }

  function saveName() {
    try { localStorage.setItem('pn.name', App.name); } catch (error) { /* ignore */ }
  }

  function saveLook() {
    try { localStorage.setItem('pn.look', JSON.stringify(App.look)); } catch (error) { /* ignore */ }
  }

  function saveGrid() {
    try { localStorage.setItem('pn.draw', JSON.stringify(App.drawGrid)); } catch (error) { /* ignore */ }
  }

  function saveXp() {
    try { localStorage.setItem('pn.xp', String(App.xp)); } catch (error) { /* ignore */ }
  }

  function saveAwardedRounds() {
    try {
      localStorage.setItem('pn.awarded', JSON.stringify(App.awardedRounds.slice(-50)));
    } catch (error) { /* ignore */ }
  }

  function saveSettings() {
    try { localStorage.setItem('pn.settings', JSON.stringify(App.settings)); } catch (error) { /* ignore */ }
  }

  function saveSession() {
    try {
      if (App.session) sessionStorage.setItem('pn.session', JSON.stringify(App.session));
      else sessionStorage.removeItem('pn.session');
    } catch (error) { /* ignore */ }
  }

  function loadSession() {
    try {
      const raw = sessionStorage.getItem('pn.session');
      if (raw) App.session = JSON.parse(raw);
    } catch (error) {
      App.session = null;
    }
  }

  function levelFor(xp) {
    return Math.floor(Math.max(0, xp) / 500) + 1;
  }

  function applySettings() {
    const body = document.body;
    if (body) body.classList.toggle('colorblind', !!App.settings.colorblind);
    PN.settings = App.settings;
    if (PN.Audio) PN.Audio.setVolume(App.settings.volume / 100);
  }

  function updateLevelDisplay() {
    const el = $('menu-level');
    if (el) el.textContent = `LEVEL ${levelFor(App.xp)} · ${App.xp} XP`;
  }

  // ----------------------------------------------------------------- screens
  function showScreen(id) {
    for (const screen of document.querySelectorAll('.screen')) {
      screen.classList.toggle('hidden', screen.id !== id);
    }
  }

  function setChrome(options) {
    $('game').classList.toggle('hidden', !options.game);
    $('hud').classList.toggle('hidden', !options.hud);
    $('chat').classList.toggle('hidden', !options.chat);
    $('chat-toggle').classList.toggle('hidden', !options.chatToggle);
  }

  function statusLine(message, isError) {
    const el = $('menu-status');
    el.textContent = message || '';
    el.style.color = isError ? '#ff8a8a' : '';
  }

  // -------------------------------------------------------------------- chat
  function chatEl() { return $('chat-log'); }

  function renderChatEntry(entry) {
    const log = chatEl();
    const wrap = document.createElement('div');
    const isTeam = !entry.system && entry.channel === 'team';
    wrap.className = `msg${entry.system ? ' system' : ''}${isTeam ? ' team' : ''}`;

    if (entry.system) {
      wrap.textContent = entry.text;
    } else {
      const from = document.createElement('span');
      const isYou = !!App.socket && entry.from === App.socket.id;
      from.className = `from ${isYou ? 'you' : (entry.role || '')}`;
      from.textContent = `${isTeam ? '[TEAM] ' : ''}${entry.name}:`;
      wrap.appendChild(from);
      wrap.appendChild(document.createTextNode(` ${entry.text}`));
    }

    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
  }

  function pushSystemChat(text) {
    renderChatEntry({ system: true, text });
  }

  PN.Manager.onSystemChat = pushSystemChat;

  function renderEndStats(info) {
    const host = $('end-stats');
    host.innerHTML = '';
    const rows = Array.isArray(info.stats) ? info.stats : [];
    if (!rows.length) {
      host.textContent =
        info.totalMachines !== undefined
          ? `Propmachines online: ${info.repairedCount}/${info.totalMachines}`
          : '';
      return;
    }

    const table = document.createElement('table');
    table.className = 'stats-table';
    const head = document.createElement('tr');
    for (const label of ['PLAYER', 'ROLE', 'STATUS', 'REP', 'REV', 'HITS', 'DOWNS', 'FIN']) {
      const th = document.createElement('th');
      th.textContent = label;
      head.appendChild(th);
    }
    table.appendChild(head);

    for (const row of rows) {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = row.name;
      const role = document.createElement('td');
      role.textContent = row.role === 'killer' ? 'KILLER' : 'SURVIVOR';
      role.className = row.role === 'killer' ? 'role-killer' : 'role-survivor';
      const status = document.createElement('td');
      status.textContent = row.escaped ? 'ESCAPED' : row.role === 'killer' ? 'HUNTER' : 'IN';
      tr.appendChild(name);
      tr.appendChild(role);
      tr.appendChild(status);
      for (const key of ['repaired', 'revived', 'hits', 'downs', 'finishes']) {
        const cell = document.createElement('td');
        cell.className = 'num';
        cell.textContent = String(row[key] || 0);
        tr.appendChild(cell);
      }
      table.appendChild(tr);
    }
    host.appendChild(table);
  }

  function localStats(info) {
    const wantedId = App.mode === 'offline' ? 'local-you' : App.room && App.room.you;
    return Array.isArray(info.stats)
      ? info.stats.find((row) => row.id === wantedId) || null
      : null;
  }

  function awardRoundXp(info) {
    const mine = localStats(info);
    if (!mine) return 0;
    if (info.roundId && App.awardedRounds.includes(info.roundId)) return 0;
    
    const won = (info.winner === 'survivors') === (mine.role === 'survivor');
    let gained = 40 + (won ? 110 : 25);
    if (mine.escaped) gained += 70;
    gained += (mine.repaired || 0) * 18;
    gained += (mine.revived || 0) * 22;
    gained += (mine.hits || 0) * 8;
    gained += (mine.downs || 0) * 16;
    gained += (mine.finishes || 0) * 28;
    if (mine.role === 'killer' && info.winner === 'killer') gained += 30;

    App.xp += gained;
    saveXp();
    if (info.roundId) {
      App.awardedRounds.push(info.roundId);
      saveAwardedRounds();
    }
    updateLevelDisplay();
    return gained;
  }

  function spawnEndFx(survivorsWon) {
    const host = $('end-fx');
    if (!host) return;
    host.innerHTML = '';
    const count = survivorsWon ? 46 : 32;

    for (let i = 0; i < count; i += 1) {
      const spark = document.createElement('span');
      if (survivorsWon) {
        spark.className = 'confetti';
        spark.style.left = `${Math.random() * 100}%`;
        spark.style.background = ['#5de78e', '#ffd37a', '#6a8cff', '#ff7a7a', '#f4efe4'][i % 5];
        spark.style.animationDuration = `${2.2 + Math.random() * 2}s`;
        spark.style.animationDelay = `${Math.random() * 0.9}s`;
        spark.style.setProperty('--dx', `${(Math.random() * 2 - 1) * 140}px`);
      } else {
        spark.className = 'ember';
        spark.style.left = `${Math.random() * 100}%`;
        spark.style.animationDuration = `${2.8 + Math.random() * 2.4}s`;
        spark.style.animationDelay = `${Math.random() * 1.2}s`;
        spark.style.setProperty('--dx', `${(Math.random() * 2 - 1) * 80}px`);
        spark.style.opacity = String(0.45 + Math.random() * 0.5);
      }
      host.appendChild(spark);
    }
  }

  function syncEndLobbyButton() {
    const button = $('btn-end-lobby');
    if (App.mode === 'offline') {
      button.textContent = 'BACK TO MENU';
      button.disabled = false;
    } else if (App.room && App.room.isHost) {
      button.textContent = 'RETURN TO LOBBY';
      button.disabled = false;
    } else {
      button.textContent = 'WAITING FOR HOST...';
      button.disabled = true;
    }
  }

  function showEnd(info) {
    const survivorsWon = info.winner === 'survivors';
    const title = $('end-title');
    title.textContent = survivorsWon ? 'SURVIVORS ESCAPED' : 'THE KILLER WINS';
    title.style.color = survivorsWon ? 'var(--survivor)' : 'var(--killer)';
    $('end-reason').textContent = info.reason || '';
    renderEndStats(info);

    const gained = awardRoundXp(info);
    $('end-xp').textContent = gained
      ? `+${gained} XP · LEVEL ${levelFor(App.xp)}`
      : `LEVEL ${levelFor(App.xp)} · ${App.xp} XP`;

    const screen = $('screen-end');
    screen.classList.toggle('win', survivorsWon);
    screen.classList.toggle('lose', !survivorsWon);
    spawnEndFx(survivorsWon);

    const mine = localStats(info);
    const personalWin = mine
      ? (info.winner === 'survivors') === (mine.role === 'survivor')
      : survivorsWon;
    if (PN.Audio) PN.Audio.play(personalWin ? 'win' : 'lose');

    syncEndLobbyButton();

    if (App.mode === 'offline') PN.Manager.inputBlocked = true;
    togglePingWheel(false);
    setChrome({ game: true, hud: false, chat: false, chatToggle: false });
    showScreen('screen-end');
  }

  PN.Manager.onRoundEnd = (info) => showEnd(info);

  function setChannel(channel) {
    App.channel = channel;
    for (const button of document.querySelectorAll('#chat .chat-tabs button')) {
      button.classList.toggle('active', button.dataset.channel === channel);
    }
  }

  function toggleChat(force) {
    const panel = $('chat');
    const shouldShow = force === undefined ? panel.classList.contains('hidden') : force;
    panel.classList.toggle('hidden', !shouldShow);
    $('chat-toggle').classList.toggle('hidden', shouldShow || $('hud').classList.contains('hidden'));
    if (shouldShow) $('chat-input').focus();
  }

  function sendChat() {
    const input = $('chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    if (App.mode === 'offline' || !App.room) {
      renderChatEntry({
        from: App.socket ? App.socket.id : null,
        name: App.name,
        role: 'survivor',
        channel: App.channel,
        text,
      });
      return;
    }
    if (App.socket && App.socket.connected) App.socket.emit('chat:send', { text, channel: App.channel });
    else statusLine('Not connected.', true);
  }

  function togglePingWheel(force) {
    const panel = $('pingWheel');
    const shouldShow = force === undefined ? panel.classList.contains('hidden') : force;
    App.pingOpen = shouldShow;
    panel.classList.toggle('hidden', !shouldShow);
  }

  function sendPing(kind) {
    togglePingWheel(false);
    if (App.mode === 'offline') {
      pushSystemChat(`You pinged: ${kind.toUpperCase()}`);
      return;
    }
    if (App.socket && App.socket.connected) App.socket.emit('quick:ping', { kind });
  }

  // ------------------------------------------------------------------ lobby
  function renderLobby() {
    if (!App.room) return;
    $('lobby-name').textContent = App.room.name;
    $('lobby-code').textContent = App.room.code;
    $('lobby-count').textContent = `(${App.room.players.length}/${App.maxPlayers})`;

    const list = $('lobby-players');
    list.innerHTML = '';
    for (const player of App.room.players) {
      const li = document.createElement('li');
      const color = document.createElement('div');
      color.className = 'swatch-mini';
      color.style.background = (player.look && player.look.body) || '#49cf79';
      const name = document.createElement('span');
      name.className = 'pname';
      name.textContent = player.name;
      li.appendChild(color);
      li.appendChild(name);

      if (player.id === App.room.you) {
        const tag = document.createElement('span');
        tag.className = 'ptag you';
        tag.textContent = 'YOU';
        li.appendChild(tag);
      }
      if (player.isHost) {
        const tag = document.createElement('span');
        tag.className = 'ptag';
        tag.textContent = 'HOST';
        li.appendChild(tag);
      }
      if (player.disconnected) {
        const tag = document.createElement('span');
        tag.className = 'ptag';
        tag.textContent = 'OFFLINE';
        li.appendChild(tag);
      }
      if (player.dead) {
        const tag = document.createElement('span');
        tag.className = 'ptag killer';
        tag.textContent = 'DEAD';
        li.appendChild(tag);
      } else if (player.escaped) {
        const tag = document.createElement('span');
        tag.className = 'ptag you';
        tag.textContent = 'ESCAPED';
        li.appendChild(tag);
      }
      if (player.preference && player.preference !== 'any') {
        const tag = document.createElement('span');
        tag.className = 'ptag';
        tag.textContent = `WANTS ${player.preference.toUpperCase()}`;
        li.appendChild(tag);
      }
      list.appendChild(li);

      if (player.id === App.room.you) {
        App.preference = player.preference || 'any';
      }
    }

    const preferenceSelect = $('lobby-preference');
    preferenceSelect.value = App.preference;
    preferenceSelect.disabled = App.room.state !== 'lobby';

    const passwordNote = $('lobby-password-note');
    if (passwordNote) {
      passwordNote.textContent = App.room.hasPassword
        ? 'Password protected. The invite link carries the room code.'
        : 'Public room. Anyone with the code can join.';
    }

    const maps = $('lobby-maps');
    maps.innerHTML = '';
    for (const map of App.maps) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `map-card${map.id === App.room.mapId ? ' active' : ''}`;
      const strong = document.createElement('strong');
      strong.textContent = map.name;
      const small = document.createElement('small');
      small.textContent = map.description;
      card.appendChild(strong);
      card.appendChild(small);
      if (!App.room.isHost) {
        const lock = document.createElement('div');
        lock.className = 'lock';
        lock.textContent = 'Host picks the map';
        card.appendChild(lock);
        card.disabled = true;
      } else {
        card.addEventListener('click', () => {
          if (App.room && map.id !== App.room.mapId && App.socket && App.socket.connected) {
            App.socket.emit('room:setMap', { mapId: map.id });
          }
        });
      }
      maps.appendChild(card);
    }

    const activePlayers = App.room.players.filter((player) => !player.disconnected);
    const canStart = App.room.isHost && activePlayers.length >= 2;
    $('btn-start').disabled = !canStart;
    const lobbyStatus = $('lobby-status');
    if (!App.room.isHost) lobbyStatus.textContent = 'Waiting for the host to start...';
    else if (activePlayers.length < 2) {
      lobbyStatus.textContent =
        App.room.players.length >= 2
          ? 'Wait for reconnecting players before starting.'
          : 'You need at least 2 players to start.';
    } else lobbyStatus.textContent = 'Ready. Press START MATCH.';
  }

  function enterLobby(data) {
    App.rejoinPending = false;
    App.room = {
      code: data.code,
      name: data.name,
      mapId: data.mapId,
      state: data.state,
      you: data.you,
      isHost: data.isHost,
      players: data.players,
      hasPassword: !!data.hasPassword,
    };
    App.preference = ((data.players || []).find((p) => p.id === data.you) || {}).preference || 'any';
    if (data.session) {
      App.session = { code: data.code, token: data.session };
      saveSession();
    }
    showScreen('screen-lobby');
    setChrome({ chat: true });
    statusLine('');
    renderLobby();
  }

  function updateLobby(data) {
    App.room = App.room || {};
    App.room.code = data.code;
    App.room.name = data.name;
    App.room.mapId = data.mapId;
    App.room.state = data.state;
    App.room.you = data.you !== undefined ? data.you : App.room.you;
    App.room.isHost = data.isHost;
    App.room.players = data.players;
    if (data.hasPassword !== undefined) App.room.hasPassword = data.hasPassword;
    if (!$('screen-lobby').classList.contains('hidden')) renderLobby();
  }

  // ------------------------------------------------------------- game entry
  function enterGame(initData) {
    App.mode = 'online';
    $('roomBadge').textContent = `ROOM ${initData.roomCode}`;
    showScreen(null);
    setChrome({ game: true, hud: true, chat: false, chatToggle: true });
    togglePingWheel(false);

    const hudEl = $('hud');
    void hudEl.offsetWidth;
    PN.Manager.setSocket(App.socket);
    PN.Manager.deliverInit(initData);
    PN.Manager.setSocket(App.socket);
  }

  async function enterPractice() {
    const mapId = App.practiceMapId;
    const role = $('practice-role').value;
    statusLine('Loading practice map...');
    try {
      const response = await fetch(`/api/maps/${mapId}`);
      if (!response.ok) throw new Error('Map fetch failed');
      const map = await response.json();

      App.mode = 'offline';
      App.room = null;
      $('roomBadge').textContent = 'PRACTICE';
      showScreen(null);
      setChrome({ game: true, hud: true, chat: false, chatToggle: true });
      chatEl().innerHTML = '';
      pushSystemChat(
        `Practice on ${map.name}. ${role === 'killer' ? 'You are the Killer.' : 'You are a Survivor.'}`,
      );

      PN.Manager.start({
        mode: 'offline',
        id: 'local-you',
        roomCode: 'PRACTICE',
        mapId,
        map,
        config: App.config,
        human: { name: App.name, look: App.look, role },
        botCount: role === 'killer' ? 4 : 3,
      });
      statusLine('');
    } catch (error) {
      statusLine('Could not start practice. Is the server running?', true);
    }
  }

  function leaveMatch() {
    if (App.mode === 'online' && App.socket && App.socket.connected) {
      App.socket.emit('room:leave');
    }
    // Leave immediately so a dropped socket cannot strand the player on a
    // frozen match screen. The server also removes them from the room.
    returnToMenu();
  }

  function returnToMenu() {
    PN.Manager.stop();
    PN.Manager.inputBlocked = false;
    App.mode = null;
    App.room = null;
    App.session = null;
    saveSession();
    togglePingWheel(false);
    chatEl().innerHTML = '';
    showScreen('screen-menu');
    setChrome({});
    updateMenuPreview();
  }

  // ------------------------------------------------------------------- menu
  function updateMenuPreview() {
    $('name-input').value = App.name;
    PN.drawPreview($('menu-preview'), App.look);
    const bits = [`Body ${App.look.body}`, App.look.hat === 'none' ? 'No hat' : `${App.look.hat} hat`, `${App.look.eyes} eyes`];
    if (App.look.custom) bits.push('custom drawing');
    $('menu-look-note').textContent = bits.join(' · ');
    updateLevelDisplay();
  }

  function populatePracticeMaps() {
    const select = $('practice-map');
    const previous = App.practiceMapId || select.value;
    select.innerHTML = '';
    for (const map of App.maps) {
      const option = document.createElement('option');
      option.value = map.id;
      option.textContent = map.name;
      select.appendChild(option);
    }
    const valid = App.maps.some((map) => map.id === previous);
    App.practiceMapId = valid ? previous : (App.maps[0] && App.maps[0].id);
    if (App.practiceMapId) select.value = App.practiceMapId;
  }

  function playerName() {
    const value = $('name-input').value.trim();
    App.name = value || 'Player';
    saveName();
    return App.name;
  }

  // ------------------------------------------------------------ customize
  function drawingHasPixels() {
    return App.drawGrid.some((color) => !!color);
  }

  function refreshCustomizePreview() {
    const hasPixels = drawingHasPixels();
    $('use-drawing').disabled = !hasPixels;
    const look = Object.assign({}, App.editing);
    look.custom = $('use-drawing').checked && hasPixels ? gridToBase64() : null;
    PN.drawPreview($('customize-preview'), look);

    const bits = [look.body];
    if (look.hat !== 'none') bits.push(look.hat);
    bits.push(look.eyes);
    if (look.custom) bits.push('custom');
    $('look-note').textContent = bits.join(' · ');
  }

  function renderBodySwatches() {
    const container = $('body-swatches');
    container.innerHTML = '';
    for (const color of PN.BODY_SWATCHES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `swatch${App.editing.body === color ? ' active' : ''}`;
      button.style.background = color;
      button.addEventListener('click', () => {
        App.editing.body = color;
        $('body-color').value = color;
        renderBodySwatches();
        refreshCustomizePreview();
      });
      container.appendChild(button);
    }
  }

  function renderOptionRow(containerId, values, key, unlocks) {
    const container = $(containerId);
    container.innerHTML = '';
    const level = levelFor(App.xp);
    for (const value of values) {
      const required = (unlocks && unlocks[value]) || 1;
      const unlocked = level >= required;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = App.editing[key] === value ? 'active' : '';
      button.textContent = unlocked ? value : `${value} · L${required}`;
      button.disabled = !unlocked;
      button.style.opacity = unlocked ? '' : '0.45';
      if (unlocked) {
        button.addEventListener('click', () => {
          App.editing[key] = value;
          renderOptionRow(containerId, values, key, unlocks);
          refreshCustomizePreview();
        });
      }
      container.appendChild(button);
    }
  }

  function renderDrawSwatches() {
    const container = $('draw-swatches');
    container.innerHTML = '';
    for (const color of PN.DRAW_SWATCHES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `swatch${App.drawColor === color ? ' active' : ''}`;
      button.style.background = color;
      button.addEventListener('click', () => {
        App.drawColor = color;
        App.drawTool = 'pencil';
        syncDrawTools();
        renderDrawSwatches();
      });
      container.appendChild(button);
    }
  }

  function syncDrawTools() {
    for (const button of document.querySelectorAll('#draw-tools button')) {
      button.classList.toggle('active', button.dataset.tool === App.drawTool);
    }
  }

  function colorAt(index) {
    return App.drawGrid[index];
  }

  function componentToHex(value) {
    return value.toString(16).padStart(2, '0');
  }

  function renderDrawCanvas() {
    const canvas = $('draw-canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 16, 16);
    for (let i = 0; i < 256; i += 1) {
      const color = App.drawGrid[i];
      if (!color) continue;
      const rgb = PN.hexToRgb(color);
      ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
      ctx.fillRect(i % 16, Math.floor(i / 16), 1, 1);
    }
  }

  function gridToBase64() {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(16, 16);
    for (let i = 0; i < 256; i += 1) {
      const color = App.drawGrid[i];
      if (!color) continue;
      const rgb = PN.hexToRgb(color);
      image.data[i * 4] = rgb.r;
      image.data[i * 4 + 1] = rgb.g;
      image.data[i * 4 + 2] = rgb.b;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
  }

  function floodFill(startIndex, targetColor, replacement) {
    if (targetColor === replacement) return;
    const stack = [startIndex];
    const width = 16;
    const height = 16;
    const visited = new Set();

    while (stack.length > 0) {
      const index = stack.pop();
      if (visited.has(index)) continue;
      visited.add(index);
      if (App.drawGrid[index] !== targetColor) continue;
      App.drawGrid[index] = replacement;

      const x = index % width;
      const y = Math.floor(index / width);
      if (x > 0) stack.push(index - 1);
      if (x < width - 1) stack.push(index + 1);
      if (y > 0) stack.push(index - width);
      if (y < height - 1) stack.push(index + width);
    }
  }

  function paintAt(event) {
    const canvas = $('draw-canvas');
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * 16);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * 16);
    if (x < 0 || x > 15 || y < 0 || y > 15) return;
    const index = y * 16 + x;

    if (App.drawTool === 'pick') {
      const color = colorAt(index);
      if (color) {
        App.drawColor = color;
        App.drawTool = 'pencil';
        syncDrawTools();
        renderDrawSwatches();
      }
      return;
    }

    if (App.drawTool === 'fill') {
      floodFill(index, colorAt(index), App.drawColor);
    } else if (App.drawTool === 'eraser') {
      App.drawGrid[index] = null;
    } else {
      App.drawGrid[index] = App.drawColor;
    }

    if (App.drawTool !== 'eraser') $('use-drawing').checked = true;

    renderDrawCanvas();
    saveGrid();
    refreshCustomizePreview();
  }

  function openCustomize() {
    App.editing = Object.assign({}, App.look, { custom: null });
    $('body-color').value = App.editing.body;
    $('use-drawing').checked = !!App.look.custom && App.drawGrid.some((c) => c);
    renderBodySwatches();
    renderOptionRow('hat-options', HATS, 'hat', HAT_LEVEL);
    renderOptionRow('eyes-options', EYES, 'eyes', EYE_LEVEL);
    renderDrawSwatches();
    syncDrawTools();
    renderDrawCanvas();
    refreshCustomizePreview();
    showScreen('screen-customize');
  }

  function saveCustomize() {
    const look = Object.assign({}, App.editing);
    look.custom = $('use-drawing').checked && drawingHasPixels() ? gridToBase64() : null;
    App.look = look;
    saveLook();
    showScreen('screen-menu');
    updateMenuPreview();
  }

  // ------------------------------------------------------------------ socket
  function connect() {
    App.socket = io();
    PN.Manager.setSocket(App.socket);

    App.socket.on('connect', () => {
      App.connected = true;
      $('connect-note').textContent = 'Loading maps...';
      PN.Manager.setSocket(App.socket);

      if (App.session && !App.rejoinTried) {
        App.rejoinTried = true;
        App.rejoinPending = true;
        $('connect-note').textContent = 'Rejoining your match...';
        showScreen('screen-connecting');
        App.socket.emit('room:rejoin', {
          code: App.session.code,
          token: App.session.token,
        });
      }
    });

    App.socket.on('disconnect', () => {
      App.connected = false;
      App.rejoinTried = false;
      App.rejoinPending = false;
      $('connect-note').textContent = 'Lost the connection. Retrying...';
      showScreen('screen-connecting');
      setChrome({});
    });

    App.socket.on('menu:hello', (data) => {
      App.maps = data.maps || [];
      App.config = data.config || FALLBACK_CONFIG;
      App.maxPlayers = data.maxPlayers || 5;
      populatePracticeMaps();
      if (App.rejoinPending) return;
      showScreen('screen-menu');
      setChrome({});
      updateMenuPreview();

      if (App.inviteCode && !App.session) {
        const code = App.inviteCode;
        App.inviteCode = null;
        $('code-input').value = code;
        $('join-password').value = '';
        statusLine(`Joining room ${code}...`);
        App.socket.emit('room:join', {
          playerName: playerName(),
          look: App.look,
          code,
        });
      }
    });

    App.socket.on('room:joined', (data) => {
      if (data.maps) App.maps = data.maps;
      enterLobby(data);
    });

    App.socket.on('room:update', (data) => {
      if (data.state === 'lobby' && $('screen-lobby').classList.contains('hidden')) {
        // A finished round was restarted: leave the frozen match view.
        PN.Manager.stop();
        App.mode = null;
        showScreen('screen-lobby');
        setChrome({ chat: true });
      }
      updateLobby(data);
      if (!$('screen-end').classList.contains('hidden')) syncEndLobbyButton();
    });

    App.socket.on('room:left', () => returnToMenu());

    App.socket.on('room:passwordRequired', (data) => {
      const code = (data && data.code) || $('code-input').value.trim().toUpperCase();
      if (code) $('code-input').value = code;
      statusLine('That room is locked. Enter its password and join again.', true);
      $('join-password').focus();
    });

    App.socket.on('room:rejoinFailed', () => {
      App.session = null;
      saveSession();
      App.rejoinTried = true;
      App.rejoinPending = false;
      PN.Manager.stop();
      PN.Manager.inputBlocked = false;
      App.mode = null;
      App.room = null;
      showScreen('screen-menu');
      setChrome({});
      updateMenuPreview();
      statusLine('Your old room is gone. Create or join a new one.');
    });

    App.socket.on('room:error', (data) => {
      const message = (data && data.message) || 'Something went wrong.';
      statusLine(message, true);
      if (!$('screen-lobby').classList.contains('hidden')) $('lobby-status').textContent = message;
    });

    App.socket.on('chat:history', (entries) => {
      chatEl().innerHTML = '';
      for (const entry of entries) renderChatEntry(entry);
    });

    App.socket.on('chat:message', (entry) => renderChatEntry(entry));

    App.socket.on('game:init', (data) => enterGame(data));

    App.socket.on('state', (state) => PN.Manager.deliverState(state));

    App.socket.on('attack', (data) => PN.Manager.deliverEvent('attack', data));
    App.socket.on('hit', (data) => PN.Manager.deliverEvent('hit', data));
    App.socket.on('machineHit', (data) => PN.Manager.deliverEvent('machineHit', data));
    App.socket.on('machineRepaired', (data) => PN.Manager.deliverEvent('machineRepaired', data));
    App.socket.on('revived', (data) => PN.Manager.deliverEvent('revived', data));
    App.socket.on('ability', (data) => PN.Manager.deliverEvent('ability', data));
    App.socket.on('trapTriggered', (data) => PN.Manager.deliverEvent('trapTriggered', data));
    App.socket.on('skillCheck', (data) => PN.Manager.deliverEvent('skillCheck', data));
    App.socket.on('skillResult', (data) => PN.Manager.deliverEvent('skillResult', data));
    App.socket.on('quickPing', (data) => PN.Manager.deliverEvent('quickPing', data));
    App.socket.on('noise', (data) => PN.Manager.deliverEvent('noise', data));
    App.socket.on('alarm', (data) => PN.Manager.deliverEvent('alarm', data));
    App.socket.on('flash', (data) => PN.Manager.deliverEvent('flash', data));
    App.socket.on('stun', (data) => PN.Manager.deliverEvent('stun', data));
    App.socket.on('locker', (data) => PN.Manager.deliverEvent('locker', data));
    App.socket.on('lockerFound', (data) => PN.Manager.deliverEvent('lockerFound', data));
    App.socket.on('lockerEmpty', () => pushSystemChat('That locker is empty.'));
    App.socket.on('escaped', (data) => PN.Manager.deliverEvent('escaped', data));
    App.socket.on('executed', (data) => PN.Manager.deliverEvent('executed', data));
    App.socket.on('bledOut', (data) => PN.Manager.deliverEvent('bledOut', data));
    App.socket.on('exitOpen', (data) => PN.Manager.deliverEvent('exitOpen', data));

    App.socket.on('round:end', (data) => showEnd(data));
  }

  // ------------------------------------------------------------------- wire
  function wire() {
    $('name-input').addEventListener('input', () => {
      App.name = $('name-input').value.trim().slice(0, 16);
      saveName();
    });

    $('btn-customize').addEventListener('click', openCustomize);
    $('btn-customize-back').addEventListener('click', () => {
      showScreen('screen-menu');
      updateMenuPreview();
    });
    $('btn-customize-save').addEventListener('click', saveCustomize);

    $('body-color').addEventListener('input', (event) => {
      App.editing.body = event.target.value;
      renderBodySwatches();
      refreshCustomizePreview();
    });

    for (const button of document.querySelectorAll('#draw-tools button')) {
      button.addEventListener('click', () => {
        App.drawTool = button.dataset.tool;
        syncDrawTools();
      });
    }

    $('draw-clear').addEventListener('click', () => {
      App.drawGrid = new Array(256).fill(null);
      $('use-drawing').checked = false;
      renderDrawCanvas();
      saveGrid();
      refreshCustomizePreview();
    });

    $('use-drawing').addEventListener('change', refreshCustomizePreview);

    const drawCanvas = $('draw-canvas');
    drawCanvas.addEventListener('pointerdown', (event) => {
      App.painting = true;
      drawCanvas.setPointerCapture(event.pointerId);
      paintAt(event);
    });
    drawCanvas.addEventListener('pointermove', (event) => {
      if (App.painting) paintAt(event);
    });
    drawCanvas.addEventListener('pointerup', () => { App.painting = false; });
    drawCanvas.addEventListener('pointercancel', () => { App.painting = false; });

    $('btn-create').addEventListener('click', () => {
      if (!App.connected) return statusLine('Not connected yet...', true);
      statusLine('Creating room...');
      App.socket.emit('room:create', {
        playerName: playerName(),
        look: App.look,
        roomName: `${App.name}'s Room`,
        mapId: App.practiceMapId,
        password: $('password-input').value.trim(),
      });
    });

    $('btn-quick').addEventListener('click', () => {
      if (!App.connected) return statusLine('Not connected yet...', true);
      statusLine('Finding a room...');
      App.socket.emit('room:quick', { playerName: playerName(), look: App.look });
    });

    $('btn-join').addEventListener('click', () => {
      if (!App.connected) return statusLine('Not connected yet...', true);
      const code = $('code-input').value.trim().toUpperCase();
      if (code.length < 4) return statusLine('Enter a 4-character code.', true);
      statusLine('Joining...');
      App.socket.emit('room:join', {
        playerName: playerName(),
        look: App.look,
        code,
        password: $('join-password').value.trim(),
      });
    });

    $('code-input').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') $('btn-join').click();
    });

    $('join-password').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') $('btn-join').click();
    });

    $('practice-map').addEventListener('change', (event) => {
      App.practiceMapId = event.target.value;
    });

    $('btn-practice').addEventListener('click', () => {
      App.name = playerName();
      enterPractice();
    });

    $('btn-leave').addEventListener('click', leaveMatch);

    $('btn-start').addEventListener('click', () => {
      if (App.socket && App.socket.connected) App.socket.emit('room:start');
    });

    $('lobby-preference').addEventListener('change', (event) => {
      App.preference = event.target.value;
      if (App.socket && App.socket.connected) {
        App.socket.emit('room:preference', { preference: App.preference });
      }
    });

    $('btn-invite').addEventListener('click', async () => {
      if (!App.room) return;
      const url = `${location.origin}${location.pathname}?room=${App.room.code}`;
      try {
        await navigator.clipboard.writeText(url);
        $('btn-invite').textContent = 'LINK COPIED';
        setTimeout(() => { $('btn-invite').textContent = 'COPY INVITE LINK'; }, 1400);
      } catch (error) {
        statusLine(url);
      }
    });

    for (const button of document.querySelectorAll('#pingWheel button')) {
      button.addEventListener('click', () => sendPing(button.dataset.kind));
    }

    $('btn-settings').addEventListener('click', () => {
      $('set-volume').value = String(App.settings.volume);
      $('set-shake').checked = App.settings.shake !== false;
      $('set-colorblind').checked = !!App.settings.colorblind;
      showScreen('screen-settings');
    });

    $('btn-settings-back').addEventListener('click', () => {
      showScreen('screen-menu');
      updateMenuPreview();
    });

    $('set-volume').addEventListener('input', (event) => {
      App.settings.volume = Number(event.target.value);
      applySettings();
      saveSettings();
    });
    $('set-volume').addEventListener('change', () => {
      if (PN.Audio) PN.Audio.play('ui');
    });

    $('set-shake').addEventListener('change', (event) => {
      App.settings.shake = event.target.checked;
      applySettings();
      saveSettings();
    });

    $('set-colorblind').addEventListener('change', (event) => {
      App.settings.colorblind = event.target.checked;
      applySettings();
      saveSettings();
    });

    window.addEventListener('pointerdown', () => {
      if (PN.Audio) PN.Audio.unlock();
    }, { once: true });

    window.addEventListener('keydown', () => {
      if (PN.Audio) PN.Audio.unlock();
    }, { once: true });

    $('btn-copy').addEventListener('click', async () => {
      if (!App.room) return;
      try {
        await navigator.clipboard.writeText(App.room.code);
        $('btn-copy').textContent = 'COPIED';
        setTimeout(() => { $('btn-copy').textContent = 'COPY'; }, 1200);
      } catch (error) {
        statusLine(`Room code: ${App.room.code}`);
      }
    });

    $('btn-exit').addEventListener('click', leaveMatch);

    $('btn-end-lobby').addEventListener('click', () => {
      if (App.mode === 'offline') returnToMenu();
      else if (App.socket && App.socket.connected) App.socket.emit('room:restart');
    });

    $('btn-end-leave').addEventListener('click', leaveMatch);

    $('chat-form').addEventListener('submit', (event) => {
      event.preventDefault();
      sendChat();
    });

    for (const button of document.querySelectorAll('#chat .chat-tabs button')) {
      button.addEventListener('click', () => setChannel(button.dataset.channel));
    }

    $('chat-toggle').addEventListener('click', () => toggleChat(true));

    window.addEventListener('keydown', (event) => {
      if (event.key === 't' || event.key === 'T') {
        if (document.activeElement === $('chat-input')) return;
        if ($('hud').classList.contains('hidden')) return;
        event.preventDefault();
        togglePingWheel(false);
        toggleChat();
      } else if (event.key === 'v' || event.key === 'V') {
        if (document.activeElement === $('chat-input')) return;
        if ($('hud').classList.contains('hidden')) return;
        event.preventDefault();
        togglePingWheel();
      } else if (event.key === 'Escape') {
        if (document.activeElement === $('chat-input')) {
          $('chat-input').blur();
        } else if (App.pingOpen) {
          togglePingWheel(false);
        } else if (!$('chat').classList.contains('hidden')) {
          toggleChat(false);
        }
      }
    });

    $('chat-input').addEventListener('focus', () => {
      togglePingWheel(false);
      PN.Manager.inputBlocked = true;
    });
    $('chat-input').addEventListener('blur', () => { PN.Manager.inputBlocked = false; });
  }

  // ------------------------------------------------------------------- boot
  loadLocal();
  loadSession();
  try {
    const invite = (new URLSearchParams(location.search).get('room') || '').trim().toUpperCase();
    if (/^[A-Z0-9]{2,8}$/.test(invite)) App.inviteCode = invite;
  } catch (error) {
    App.inviteCode = null;
  }
  wire();
  setChrome({});
  showScreen('screen-connecting');
  updateMenuPreview();
  connect();

  window.PN.App = App;
})(window.PN);
