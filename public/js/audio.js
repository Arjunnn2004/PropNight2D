'use strict';

/**
 * PROP // NIGHT - tiny procedural WebAudio layer.
 * All sounds are synthesised so the game ships without audio assets.
 */
window.PN = window.PN || {};

(function (PN) {
  let audioContext = null;
  let master = null;
  let volume = 0.6;
  let pendingPan = null;

  function route(node, pan) {
    if (pan == null || !audioContext.createStereoPanner) {
      node.connect(master);
      return;
    }
    const panner = audioContext.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(panner);
    panner.connect(master);
  }

  function ensure() {
    if (!audioContext) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      audioContext = new Ctor();
      master = audioContext.createGain();
      master.gain.value = volume;
      master.connect(audioContext.destination);
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
    return audioContext;
  }

  function setVolume(next) {
    const value = Math.max(0, Math.min(1, Number(next)));
    volume = Number.isFinite(value) ? value : 0.6;
    if (master) master.gain.value = volume;
  }

  function tone(options) {
    const ac = ensure();
    if (!ac) return;
    const {
      freq = 220,
      endFreq = freq,
      duration = 0.2,
      type = 'sine',
      gain = 0.15,
      delay = 0,
      attack = 0.012,
      pan = pendingPan,
    } = options;

    const start = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const amp = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), start + duration);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(amp);
    route(amp, pan);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  function noise(options) {
    const ac = ensure();
    if (!ac) return;
    const { duration = 0.25, gain = 0.2, filter = 1200, delay = 0, pan = pendingPan } = options;
    const start = ac.currentTime + delay;
    const length = Math.max(1, Math.floor(ac.sampleRate * duration));
    const buffer = ac.createBuffer(1, length, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }

    const source = ac.createBufferSource();
    source.buffer = buffer;
    const lowpass = ac.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = filter;
    const amp = ac.createGain();
    amp.gain.setValueAtTime(gain, start);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(lowpass);
    lowpass.connect(amp);
    route(amp, pan);
    source.start(start);
  }

  function arpeggio(freqs, options = {}) {
    freqs.forEach((freq, index) => {
      tone({ freq, duration: options.duration || 0.16, gain: options.gain || 0.12, type: options.type || 'triangle', delay: index * (options.step || 0.08) });
    });
  }

  const sounds = {
    slash() {
      noise({ duration: 0.12, gain: 0.18, filter: 2600 });
      tone({ freq: 520, endFreq: 180, duration: 0.16, type: 'sawtooth', gain: 0.12 });
    },
    hurt() {
      tone({ freq: 190, endFreq: 70, duration: 0.35, type: 'square', gain: 0.2 });
    },
    down() {
      tone({ freq: 140, endFreq: 45, duration: 0.8, type: 'sawtooth', gain: 0.22 });
    },
    revive() {
      arpeggio([392, 523, 659], { duration: 0.18 });
    },
    machine() {
      arpeggio([262, 330, 392], { type: 'triangle' });
    },
    skill() {
      tone({ freq: 880, duration: 0.06, gain: 0.08, type: 'square' });
    },
    skillGood() {
      arpeggio([660, 880, 1100], { duration: 0.12, gain: 0.1, type: 'square' });
    },
    skillBad() {
      tone({ freq: 220, endFreq: 110, duration: 0.25, type: 'square', gain: 0.16 });
    },
    exit() {
      arpeggio([262, 392, 523, 784], { duration: 0.32, gain: 0.14, step: 0.1 });
    },
    escape() {
      arpeggio([523, 659, 784, 1047], { duration: 0.22, gain: 0.13 });
    },
    finish() {
      tone({ freq: 90, endFreq: 40, duration: 0.9, type: 'sawtooth', gain: 0.22 });
      noise({ duration: 0.4, gain: 0.18, filter: 500 });
    },
    trap() {
      noise({ duration: 0.15, gain: 0.2, filter: 500 });
      tone({ freq: 160, endFreq: 90, duration: 0.22, type: 'square', gain: 0.14 });
    },
    arm() {
      tone({ freq: 600, endFreq: 900, duration: 0.12, gain: 0.08, type: 'triangle' });
    },
    pulse() {
      tone({ freq: 60, endFreq: 140, duration: 0.7, gain: 0.2 });
    },
    sprint() {
      noise({ duration: 0.35, gain: 0.16, filter: 1600 });
      tone({ freq: 150, endFreq: 320, duration: 0.3, type: 'sawtooth', gain: 0.08 });
    },
    lungeWindup() {
      tone({ freq: 90, endFreq: 160, duration: 0.42, type: 'sawtooth', gain: 0.18 });
      noise({ duration: 0.38, gain: 0.12, filter: 420 });
    },
    lungeRecover() {
      tone({ freq: 180, endFreq: 70, duration: 0.5, type: 'triangle', gain: 0.12 });
    },
    pickup() {
      tone({ freq: 520, endFreq: 780, duration: 0.12, gain: 0.08, type: 'triangle' });
    },
    install() {
      tone({ freq: 180, endFreq: 90, duration: 0.14, type: 'square', gain: 0.14 });
      tone({ freq: 620, endFreq: 880, duration: 0.18, gain: 0.08, type: 'triangle', delay: 0.14 });
    },
    blood() {
      noise({ duration: 0.08, gain: 0.07, filter: 320 });
    },
    gasp() {
      noise({ duration: 0.32, gain: 0.2, filter: 1400 });
      tone({ freq: 300, endFreq: 180, duration: 0.28, type: 'triangle', gain: 0.1 });
    },
    breath() {
      noise({ duration: 0.42, gain: 0.09, filter: 780 });
    },
    creak() {
      tone({ freq: 120, endFreq: 90, duration: 0.65, type: 'sawtooth', gain: 0.06 });
    },
    hum() {
      tone({ freq: 58, duration: 1.4, gain: 0.05, type: 'sine', attack: 0.3 });
    },
    blackout() {
      noise({ duration: 0.7, gain: 0.2, filter: 260 });
      tone({ freq: 120, endFreq: 40, duration: 1.1, type: 'sawtooth', gain: 0.14 });
    },
    fog() {
      noise({ duration: 1.4, gain: 0.12, filter: 480 });
    },
    stun() {
      noise({ duration: 0.3, gain: 0.25, filter: 400 });
      tone({ freq: 140, endFreq: 60, duration: 0.3, type: 'square', gain: 0.15 });
    },
    flash() {
      tone({ freq: 1400, endFreq: 2000, duration: 0.1, gain: 0.08, type: 'square' });
    },
    alarm() {
      for (let i = 0; i < 3; i += 1) {
        tone({ freq: 880, endFreq: 660, duration: 0.18, gain: 0.14, type: 'square', delay: i * 0.2 });
      }
    },
    noise() {
      tone({ freq: 320, duration: 0.05, gain: 0.05, type: 'triangle' });
    },
    locker() {
      noise({ duration: 0.18, gain: 0.15, filter: 900 });
    },
    lockerFound() {
      noise({ duration: 0.3, gain: 0.25, filter: 700 });
      tone({ freq: 120, endFreq: 60, duration: 0.35, type: 'square', gain: 0.16 });
    },
    ui() {
      tone({ freq: 520, duration: 0.04, gain: 0.05, type: 'square' });
    },
    torch() {
      noise({ duration: 0.06, gain: 0.08, filter: 2400 });
      tone({ freq: 620, endFreq: 480, duration: 0.08, gain: 0.07, type: 'square' });
    },
    batteryLow() {
      tone({ freq: 540, endFreq: 420, duration: 0.16, gain: 0.09, type: 'square' });
      tone({ freq: 420, endFreq: 300, duration: 0.2, gain: 0.08, type: 'square', delay: 0.22 });
    },
    start() {
      noise({ duration: 0.8, gain: 0.16, filter: 520 });
      tone({ freq: 55, endFreq: 110, duration: 1.1, gain: 0.16, type: 'sawtooth' });
      tone({ freq: 220, endFreq: 440, duration: 0.9, gain: 0.06, type: 'triangle', delay: 0.15 });
    },
    win() {
      arpeggio([392, 523, 659, 784, 1047], { duration: 0.35, gain: 0.13, step: 0.12 });
      tone({ freq: 1568, duration: 0.8, gain: 0.08, type: 'triangle', delay: 0.62 });
    },
    lose() {
      tone({ freq: 220, endFreq: 92, duration: 1.2, gain: 0.18, type: 'sawtooth' });
      tone({ freq: 110, endFreq: 46, duration: 1.6, gain: 0.14, type: 'sine', delay: 0.12 });
      noise({ duration: 0.7, gain: 0.1, filter: 320, delay: 0.05 });
    },
    heartbeat() {
      tone({ freq: 70, endFreq: 55, duration: 0.18, gain: 0.2 });
      tone({ freq: 65, endFreq: 50, duration: 0.16, gain: 0.16, delay: 0.22 });
    },
    propHop() {
      tone({ freq: 260, endFreq: 520, duration: 0.12, gain: 0.14, type: 'sine' });
      noise({ duration: 0.06, gain: 0.06, filter: 1400 });
    },
    trapSnap() {
      noise({ duration: 0.14, gain: 0.28, filter: 3600 });
      tone({ freq: 940, endFreq: 240, duration: 0.09, gain: 0.18, type: 'sawtooth' });
    },
    decoy() {
      noise({ duration: 0.16, gain: 0.18, filter: 1800 });
      tone({ freq: 780, endFreq: 340, duration: 0.08, gain: 0.11, type: 'triangle', delay: 0.04 });
    },
    sprint() {
      noise({ duration: 0.24, gain: 0.08, filter: 750 });
      tone({ freq: 140, endFreq: 90, duration: 0.18, gain: 0.06, type: 'sine' });
    },
    spark() {
      noise({ duration: 0.09, gain: 0.14, filter: 4500 });
      tone({ freq: 1200, endFreq: 600, duration: 0.05, gain: 0.08, type: 'sawtooth' });
    },
  };

  function play(name) {
    if (!sounds[name]) return;
    try {
      sounds[name]();
    } catch (error) {
      // Audio is best-effort; never let it break gameplay.
    }
  }

  function spatial(name, pan) {
    if (!sounds[name]) return;
    pendingPan = Math.max(-1, Math.min(1, Number(pan) || 0));
    try {
      sounds[name]();
    } catch (error) {
      // Audio is best-effort; never let it break gameplay.
    } finally {
      pendingPan = null;
    }
  }

  PN.Audio = {
    play,
    spatial,
    setVolume,
    unlock: ensure,
    get volume() {
      return volume;
    },
  };
})(window.PN);
