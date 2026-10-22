'use strict';

/**
 * PROP // NIGHT - procedural art helpers.
 *
 * Everything the game renders is generated at runtime on a 2D canvas: map
 * tiles, props, propmachines and player skins. Nothing here touches the
 * network or Phaser, so both the Phaser scene and the DOM previews can reuse
 * the exact same drawing code.
 */
window.PN = window.PN || {};

(function (PN) {
  const TILE = 48;

  const DEFAULT_STYLE = {
    floor: '#151922',
    floorLine: '#697a94',
    wall: '#2b3140',
    wallDark: '#242a37',
    wallLight: '#353d4e',
    accent: '#6a8cff',
    fog: '#02030a',
  };

  const DEFAULT_LOOK = {
    body: '#49cf79',
    hat: 'none',
    eyes: 'normal',
    custom: null,
  };

  PN.TILE = TILE;
  PN.DEFAULT_STYLE = DEFAULT_STYLE;
  PN.DEFAULT_LOOK = DEFAULT_LOOK;
  PN.BODY_SWATCHES = [
    '#49cf79', '#4fb2ff', '#ffd166', '#ff7b7b', '#c58bff', '#ff9f45',
    '#57e0d0', '#f06292', '#f5f1e6', '#9aa4b2', '#5c6b8a', '#8c5a3c',
  ];
  PN.DRAW_SWATCHES = [
    '#ffffff', '#c0c6d0', '#8a93a3', '#4a5262', '#232833', '#000000',
    '#ff5555', '#ff9f45', '#ffd166', '#5de78e', '#4fb2ff', '#c58bff',
    '#57e0d0', '#f06292', '#8c5a3c', '#7b4e29',
  ];

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function hexToRgb(hex) {
    const clean = typeof hex === 'string' ? hex.replace('#', '') : '000000';
    const value = parseInt(clean.length === 3
      ? clean.split('').map((c) => c + c).join('')
      : clean, 16);
    if (Number.isNaN(value)) return { r: 0, g: 0, b: 0 };
    return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
  }

  function rgbToHex(r, g, b) {
    const part = (n) => Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
    return `#${part(r)}${part(g)}${part(b)}`;
  }

  // amount > 0 lightens toward white, amount < 0 darkens toward black.
  function shade(hex, amount) {
    const { r, g, b } = hexToRgb(hex);
    const target = amount >= 0 ? 255 : 0;
    const t = Math.abs(amount);
    return rgbToHex(
      r + (target - r) * t,
      g + (target - g) * t,
      b + (target - b) * t,
    );
  }

  function hexToRgba(hex, alpha) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  PN.roundedRect = roundedRect;
  PN.shade = shade;
  PN.hexToRgb = hexToRgb;
  PN.rgbToHex = rgbToHex;
  PN.hexToRgba = hexToRgba;

  // --------------------------------------------------------------------- Looks
  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function lookKey(look) {
    if (!look) return 'look:default';
    // A short slice of the base64 header is identical for every PNG, so hash
    // the whole drawing. Otherwise every custom skin shares one texture.
    const custom = look.custom ? hashString(look.custom) : '0';
    return `look:${look.body}:${look.hat}:${look.eyes}:${custom}`;
  }
  PN.lookKey = lookKey;

  const customImageCache = new Map();

  // Loads (and caches) a base64 PNG. Returns the image if it is ready, else
  // null and invokes onReady when it finishes decoding.
  function loadCustomImage(base64, onReady) {
    if (customImageCache.has(base64)) {
      const cached = customImageCache.get(base64);
      if (cached.complete) return cached;
      cached._callbacks.push(onReady);
      return null;
    }

    const img = new Image();
    img._callbacks = [onReady];
    const flush = () => {
      const callbacks = img._callbacks.splice(0);
      for (const callback of callbacks) callback();
    };
    img.onload = flush;
    img.onerror = flush;
    img.src = `data:image/png;base64,${base64}`;
    customImageCache.set(base64, img);
    return img.complete ? img : null;
  }
  PN.loadCustomImage = loadCustomImage;

  function drawEyes(ctx, style, bx, by, bw, bh) {
    const cx = bx + bw / 2;
    const cy = by + bh * 0.4;
    const off = bw * 0.21;
    const rad = bw * 0.08;

    ctx.save();
    ctx.lineCap = 'round';

    if (style === 'visor') {
      ctx.fillStyle = 'rgba(150, 235, 255, 0.95)';
      ctx.shadowColor = 'rgba(120, 220, 255, 0.9)';
      ctx.shadowBlur = 6;
      roundedRect(ctx, cx - off - rad * 1.6, cy - rad * 1.2, (off + rad * 1.6) * 2, rad * 2.4, rad * 1.2);
      ctx.fill();
      ctx.restore();
      return;
    }

    ctx.fillStyle = '#12202c';
    ctx.beginPath();
    ctx.arc(cx - off, cy, rad, 0, Math.PI * 2);
    ctx.arc(cx + off, cy, rad, 0, Math.PI * 2);
    ctx.fill();

    if (style === 'sparkle') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      for (const sx of [cx - off, cx + off]) {
        ctx.beginPath();
        ctx.moveTo(sx, cy - rad * 2.1);
        ctx.lineTo(sx, cy - rad * 0.4);
        ctx.moveTo(sx - rad * 0.85, cy - rad * 1.25);
        ctx.lineTo(sx + rad * 0.85, cy - rad * 1.25);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.lineWidth = rad * 0.5;
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    ctx.strokeStyle = '#12202c';
    ctx.lineWidth = bw * 0.055;

    if (style === 'angry') {
      ctx.beginPath();
      ctx.moveTo(cx - off - rad * 1.6, cy - rad * 2);
      ctx.lineTo(cx - off + rad * 1.1, cy - rad * 0.7);
      ctx.moveTo(cx + off + rad * 1.6, cy - rad * 2);
      ctx.lineTo(cx + off - rad * 1.1, cy - rad * 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - off * 0.7, cy + bh * 0.2);
      ctx.lineTo(cx + off * 0.7, cy + bh * 0.2);
      ctx.stroke();
    } else if (style === 'sad') {
      ctx.beginPath();
      ctx.arc(cx, cy + bh * 0.34, rad * 1.5, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      ctx.fillStyle = 'rgba(120, 200, 255, 0.85)';
      ctx.beginPath();
      ctx.arc(cx + off, cy + rad * 1.6, rad * 0.45, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy + bh * 0.16, rad * 1.6, Math.PI * 0.18, Math.PI * 0.82);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawHat(ctx, style, bx, by, bw, bh, bodyColor) {
    if (!style || style === 'none') return;
    const cx = bx + bw / 2;
    const top = by;

    ctx.save();
    ctx.lineJoin = 'round';

    if (style === 'cap') {
      ctx.fillStyle = shade(bodyColor, -0.45);
      ctx.beginPath();
      ctx.arc(cx, top + bh * 0.04, bw * 0.3, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shade(bodyColor, -0.65);
      roundedRect(ctx, cx - bw * 0.34, top + bh * 0.02, bw * 0.5, bh * 0.09, 2);
      ctx.fill();
    } else if (style === 'horns') {
      ctx.fillStyle = '#a91d1d';
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + dir * bw * 0.16, top + bh * 0.06);
        ctx.lineTo(cx + dir * bw * 0.34, top - bh * 0.28);
        ctx.lineTo(cx + dir * bw * 0.4, top + bh * 0.08);
        ctx.closePath();
        ctx.fill();
      }
    } else if (style === 'halo') {
      ctx.strokeStyle = '#ffe27a';
      ctx.shadowColor = 'rgba(255, 210, 90, 0.9)';
      ctx.shadowBlur = 8;
      ctx.lineWidth = bw * 0.08;
      ctx.beginPath();
      ctx.ellipse(cx, top - bh * 0.1, bw * 0.3, bh * 0.1, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (style === 'antenna') {
      ctx.strokeStyle = '#b8c2d0';
      ctx.lineWidth = bw * 0.055;
      ctx.beginPath();
      ctx.moveTo(cx, top + bh * 0.06);
      ctx.lineTo(cx, top - bh * 0.34);
      ctx.stroke();
      ctx.fillStyle = '#ff6b6b';
      ctx.beginPath();
      ctx.arc(cx, top - bh * 0.4, bw * 0.09, 0, Math.PI * 2);
      ctx.fill();
    } else if (style === 'crown') {
      ctx.fillStyle = '#ffcf3f';
      ctx.beginPath();
      ctx.moveTo(cx - bw * 0.3, top + bh * 0.08);
      ctx.lineTo(cx - bw * 0.3, top - bh * 0.2);
      ctx.lineTo(cx - bw * 0.15, top - bh * 0.02);
      ctx.lineTo(cx, top - bh * 0.24);
      ctx.lineTo(cx + bw * 0.15, top - bh * 0.02);
      ctx.lineTo(cx + bw * 0.3, top - bh * 0.2);
      ctx.lineTo(cx + bw * 0.3, top + bh * 0.08);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ff6b6b';
      ctx.beginPath();
      ctx.arc(cx, top - bh * 0.08, bw * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  const OUTLINE_INSET = 2;
  const CUSTOM_INSET = 3;

  // Draws a player skin into ctx inside a size x size box. `img` is an optional
  // decoded custom image; when supplied it is painted over the body.
  function drawPlayer(ctx, size, look, img) {
    const skin = Object.assign({}, DEFAULT_LOOK, look || {});
    const body = skin.body || DEFAULT_LOOK.body;
    const pad = size * 0.11;
    const x = pad;
    const y = pad;
    const w = size - pad * 2;
    const h = size - pad * 2;
    const radius = w * 0.24;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = size * 0.16;
    ctx.shadowOffsetY = size * 0.08;
    roundedRect(ctx, x, y, w, h, radius);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.restore();

    if (skin.custom && img && img.complete && img.naturalWidth > 0) {
      ctx.save();
      roundedRect(ctx, x, y, w, h, radius);
      ctx.clip();
      const inset = CUSTOM_INSET;
      ctx.drawImage(img, x + inset, y + inset, w - inset * 2, h - inset * 2);
      ctx.restore();
    }

    roundedRect(ctx, x + OUTLINE_INSET / 2, y + OUTLINE_INSET / 2, w - OUTLINE_INSET, h - OUTLINE_INSET, radius);
    ctx.strokeStyle = shade(body, 0.55);
    ctx.lineWidth = 2;
    ctx.stroke();

    if (!skin.custom) {
      drawEyes(ctx, skin.eyes, x, y, w, h);
    }

    drawHat(ctx, skin.hat, x, y, w, h, body);
  }
  PN.drawPlayer = drawPlayer;

  // ---------------------------------------------------------------------- Props
  function propCrate(ctx) {
    ctx.fillStyle = '#7b4e29';
    ctx.fillRect(4, 4, 28, 28);
    ctx.strokeStyle = '#c48a4d';
    ctx.lineWidth = 2;
    ctx.strokeRect(4, 4, 28, 28);
    ctx.strokeStyle = 'rgba(56, 31, 14, 0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(4, 12); ctx.lineTo(32, 12);
    ctx.moveTo(4, 24); ctx.lineTo(32, 24);
    ctx.moveTo(4, 4); ctx.lineTo(32, 32);
    ctx.moveTo(32, 4); ctx.lineTo(4, 32);
    ctx.stroke();
  }

  function propBarrel(ctx) {
    roundedRect(ctx, 7, 3, 22, 30, 8);
    ctx.fillStyle = '#4b593f';
    ctx.fill();
    ctx.strokeStyle = '#87956d';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = '#2e3728';
    ctx.beginPath();
    ctx.moveTo(8, 10); ctx.lineTo(28, 10);
    ctx.moveTo(8, 26); ctx.lineTo(28, 26);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(180, 200, 150, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(13, 7); ctx.lineTo(13, 29);
    ctx.stroke();
  }

  function propGurney(ctx) {
    ctx.fillStyle = '#c9ced8';
    roundedRect(ctx, 3, 10, 30, 12, 3);
    ctx.fill();
    ctx.fillStyle = '#8f97a4';
    ctx.fillRect(5, 22, 3, 9);
    ctx.fillRect(28, 22, 3, 9);
    ctx.fillStyle = '#39404d';
    ctx.beginPath();
    ctx.arc(6.5, 33, 3, 0, Math.PI * 2);
    ctx.arc(29.5, 33, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#dfe6f2';
    roundedRect(ctx, 6, 7, 12, 6, 2);
    ctx.fill();
  }

  function propCanister(ctx) {
    roundedRect(ctx, 10, 6, 16, 26, 4);
    ctx.fillStyle = '#c0392b';
    ctx.fill();
    ctx.strokeStyle = '#f0a59b';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#7a1f16';
    ctx.fillRect(13, 3, 10, 4);
    ctx.strokeStyle = '#f4d6d1';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(14, 12); ctx.lineTo(22, 12);
    ctx.moveTo(14, 20); ctx.lineTo(22, 20);
    ctx.stroke();
  }

  function propChair(ctx) {
    ctx.fillStyle = '#8a5a33';
    roundedRect(ctx, 8, 6, 5, 24, 2);
    ctx.fill();
    ctx.fillStyle = '#a06a3c';
    ctx.fillRect(8, 18, 20, 6);
    ctx.fillStyle = '#6f451f';
    ctx.fillRect(11, 24, 3, 8);
    ctx.fillRect(23, 24, 3, 8);
  }

  function propPlant(ctx) {
    ctx.fillStyle = '#3f7a4a';
    ctx.beginPath();
    ctx.arc(18, 12, 9, 0, Math.PI * 2);
    ctx.arc(11, 16, 6, 0, Math.PI * 2);
    ctx.arc(25, 16, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2f5c38';
    ctx.beginPath();
    ctx.arc(18, 14, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b5623b';
    ctx.beginPath();
    ctx.moveTo(10, 22); ctx.lineTo(26, 22);
    ctx.lineTo(23, 33); ctx.lineTo(13, 33);
    ctx.closePath();
    ctx.fill();
  }

  function propPallet(ctx) {
    ctx.fillStyle = '#a9773f';
    for (let i = 0; i < 3; i += 1) ctx.fillRect(4, 8 + i * 8, 28, 5);
    ctx.fillStyle = '#6f4a24';
    ctx.fillRect(6, 5, 4, 27);
    ctx.fillRect(26, 5, 4, 27);
  }

  function propToolbox(ctx) {
    ctx.fillStyle = '#c0392b';
    roundedRect(ctx, 4, 14, 28, 18, 3);
    ctx.fill();
    ctx.strokeStyle = '#f0a59b';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = '#8f97a4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(18, 14, 7, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#7a1f16';
    ctx.fillRect(4, 21, 28, 3);
  }

  function propCone(ctx) {
    ctx.fillStyle = '#ff7a1a';
    ctx.beginPath();
    ctx.moveTo(18, 4); ctx.lineTo(28, 31); ctx.lineTo(8, 31);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f4f1e8';
    ctx.beginPath();
    ctx.moveTo(13.5, 18); ctx.lineTo(22.5, 18);
    ctx.lineTo(24, 23); ctx.lineTo(12, 23);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c65a10';
    ctx.fillRect(5, 31, 26, 3);
  }

  function propLamp(ctx) {
    ctx.fillStyle = '#d7c48a';
    ctx.beginPath();
    ctx.moveTo(10, 4); ctx.lineTo(26, 4);
    ctx.lineTo(30, 15); ctx.lineTo(6, 15);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 235, 170, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#5c6474';
    ctx.fillRect(17, 15, 2, 16);
    ctx.fillRect(11, 31, 14, 3);
  }

  function propVase(ctx) {
    ctx.fillStyle = '#3f7fbf';
    ctx.beginPath();
    ctx.moveTo(14, 6); ctx.lineTo(22, 6);
    ctx.lineTo(25, 16); ctx.lineTo(21, 32);
    ctx.lineTo(15, 32); ctx.lineTo(11, 16);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#9fc9ef';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#2b5c8f';
    ctx.fillRect(13, 10, 10, 2);
  }

  function propTable(ctx) {
    ctx.fillStyle = '#8a5a33';
    roundedRect(ctx, 3, 9, 30, 7, 2);
    ctx.fill();
    ctx.fillStyle = '#6f451f';
    ctx.fillRect(7, 16, 4, 16);
    ctx.fillRect(25, 16, 4, 16);
    ctx.strokeStyle = '#a9773f';
    ctx.lineWidth = 1;
    ctx.strokeRect(3.5, 9.5, 29, 6);
  }

  function propSofa(ctx) {
    ctx.fillStyle = '#6d5a8f';
    roundedRect(ctx, 3, 12, 30, 16, 5);
    ctx.fill();
    ctx.fillStyle = '#8a75ad';
    roundedRect(ctx, 6, 8, 24, 8, 4);
    ctx.fill();
    ctx.fillStyle = '#5a4a78';
    ctx.fillRect(3, 20, 30, 4);
  }

  function propMirror(ctx) {
    ctx.fillStyle = '#9fc9ef';
    roundedRect(ctx, 8, 3, 20, 30, 8);
    ctx.fill();
    ctx.strokeStyle = '#e7d9a8';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(13, 26); ctx.lineTo(22, 9);
    ctx.stroke();
  }

  const PROP_DRAWERS = {
    crate: propCrate,
    barrel: propBarrel,
    gurney: propGurney,
    canister: propCanister,
    chair: propChair,
    plant: propPlant,
    pallet: propPallet,
    toolbox: propToolbox,
    cone: propCone,
    lamp: propLamp,
    vase: propVase,
    table: propTable,
    sofa: propSofa,
    mirror: propMirror,
  };

  PN.PROP_DRAWERS = PROP_DRAWERS;

  function drawProp(ctx, size, type) {
    const draw = PROP_DRAWERS[type] || propCrate;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 3;
    const scale = size / 36;
    ctx.scale(scale, scale);
    draw(ctx);
    ctx.restore();
  }
  PN.drawProp = drawProp;

  // --------------------------------------------------------------------- Tiles
  function seededRandom(seed) {
    let value = seed;
    return () => {
      value = (value * 16807) % 2147483647;
      return (value - 1) / 2147483646;
    };
  }

  // Draws a two-tile sheet: floor at [0, T) and wall at [T, 2T).
  function drawTiles(ctx, T, style) {
    const s = Object.assign({}, DEFAULT_STYLE, style || {});

    ctx.fillStyle = s.floor;
    ctx.fillRect(0, 0, T, T);
    ctx.strokeStyle = hexToRgba(s.floorLine, 0.14);
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, T - 1, T - 1);

    const random = seededRandom(9271);
    for (let i = 0; i < 8; i += 1) {
      ctx.fillStyle = hexToRgba(s.floorLine, 0.02 + random() * 0.05);
      ctx.fillRect(random() * T, random() * T, 2 + random() * 9, 1 + random() * 2);
    }

    ctx.fillStyle = s.wall;
    ctx.fillRect(T, 0, T, T);
    ctx.fillStyle = s.wallDark;
    ctx.fillRect(T, 0, T, 5);
    ctx.fillStyle = s.wallLight;
    ctx.fillRect(T, 5, T, 2);

    ctx.strokeStyle = 'rgba(9, 12, 18, 0.6)';
    ctx.lineWidth = 2;
    for (let y = 10; y < T; y += 11) {
      ctx.beginPath();
      ctx.moveTo(T + 1, y);
      ctx.lineTo(T + T - 1, y);
      ctx.stroke();
    }
    for (let row = 0; row < 4; row += 1) {
      const offset = row % 2 === 0 ? 11 : 27;
      ctx.beginPath();
      ctx.moveTo(T + offset, 10 + row * 11);
      ctx.lineTo(T + offset, 21 + row * 11);
      ctx.stroke();
    }

    ctx.strokeStyle = hexToRgba(s.wallLight, 0.5);
    ctx.lineWidth = 1;
    ctx.strokeRect(T + 1.5, 1.5, T - 3, T - 3);
  }
  PN.drawTiles = drawTiles;

  function drawMachine(ctx, size, style, done) {
    const s = Object.assign({}, DEFAULT_STYLE, style || {});
    const body = done ? shade(s.accent, -0.25) : '#3c4657';
    const light = done ? '#a8e0ff' : '#8ce2a9';
    const shadow = done ? '#17334e' : '#232a36';
    const scale = size / 48;
    const accent = done ? s.accent : '#5de78e';

    ctx.save();
    ctx.scale(scale, scale);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 8;
    roundedRect(ctx, 4, 4, 40, 40, 7);
    ctx.fillStyle = shadow;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.scale(scale, scale);
    roundedRect(ctx, 4, 4, 40, 40, 7);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.strokeStyle = light;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#141a24';
    ctx.beginPath();
    ctx.arc(24, 23, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = light;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(24, 23, 8, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 6; i += 1) {
      const angle = (Math.PI * 2 * i) / 6;
      ctx.beginPath();
      ctx.moveTo(24 + Math.cos(angle) * 4, 23 + Math.sin(angle) * 4);
      ctx.lineTo(24 + Math.cos(angle) * 9, 23 + Math.sin(angle) * 9);
      ctx.stroke();
    }

    ctx.fillStyle = light;
    ctx.fillRect(8, 40, 5, 3);
    ctx.fillRect(35, 40, 5, 3);
    ctx.restore();
  }
  PN.drawMachine = drawMachine;

  // -------------------------------------------------------------- DOM previews
  const PREVIEW_SIZE = 36;

  // Paints a look into a DOM canvas (used by the menu and customize screens).
  // Redraws itself once a custom drawing finishes decoding.
  function drawPreview(canvas, look) {
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    ctx.clearRect(0, 0, size, size);

    const image = look && look.custom
      ? loadCustomImage(look.custom, () => drawPreview(canvas, look))
      : null;

    const off = document.createElement('canvas');
    off.width = PREVIEW_SIZE;
    off.height = PREVIEW_SIZE;
    drawPlayer(off.getContext('2d'), PREVIEW_SIZE, look, image);

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(off, 0, 0, size, size);
    return image;
  }
  PN.drawPreview = drawPreview;
})(window.PN);
