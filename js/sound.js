import { asset } from './assets.js';

// Paper sounds. Real recordings are used when present (see CONFIG.sounds); otherwise
// short synthesized noise bursts stand in. Each event can have several variants: one is
// picked at random and its pitch/volume is varied slightly so repeated turns never sound
// identical.
export class Sound {
  constructor(enabled = true, files = {}) {
    this.enabled = enabled;
    this.files = files;      // { lift: [urls], land: [...], slide: [...], thud: [...], tick: [...] }
    this.samples = {};       // name -> AudioBuffer[]
    this.ctx = null;
  }

  unlock() {
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC({ latencyHint: 'interactive' });
        const len = this.ctx.sampleRate * 1.5;
        this.buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.buf.getChannelData(0);
        let b = 0;
        for (let i = 0; i < len; i++) { b = 0.85 * b + 0.15 * (Math.random() * 2 - 1); d[i] = b * 2.2; }
        // play one silent sample so the audio graph is running before the first real sound
        const warm = this.ctx.createBufferSource();
        warm.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
        warm.connect(this.ctx.destination);
        warm.start();
        this._loadSamples();
      } catch { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  _loadSamples() {
    for (const [name, urls] of Object.entries(this.files || {})) {
      for (const url of urls) {
        fetch(asset(url))
          .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
          .then((a) => this.ctx.decodeAudioData(a))
          .then((buf) => { (this.samples[name] ||= []).push(buf); })
          .catch(() => { /* missing file: synthesized fallback stays in use */ });
      }
    }
  }

  // play a recorded variant if we have one; returns false to fall back to synthesis
  _sample(name, gain = 1) {
    const list = this.samples[name];
    if (!this.enabled || !this.ctx || !list || !list.length) return false;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    src.playbackRate.value = 0.93 + Math.random() * 0.14;
    const g = c.createGain();
    g.gain.value = gain * (0.85 + Math.random() * 0.3);
    src.connect(g).connect(c.destination);
    src.start();
    return true;
  }

  _noise(dur, freq, q, gain, attack = 0.02) {
    if (!this.enabled || !this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.buf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t, Math.random() * 0.8, dur + 0.05);
  }

  lift(strength = 1) { if (!this._sample('lift', strength)) this._noise(0.35, 2600 + Math.random() * 1200, 0.7, 0.10, 0.05); }
  land(strength = 1) { if (!this._sample('land', strength)) { this._noise(0.18, 900, 0.8, 0.16, 0.005); this._noise(0.25, 3500, 1.2, 0.05, 0.01); } }
  slide() { if (!this._sample('slide')) this._noise(0.5, 700, 0.6, 0.08, 0.08); }
  tick() { if (!this._sample('tick', 0.5)) this._noise(0.035, 5200, 3, 0.035, 0.002); }
  thud() { if (!this._sample('thud')) this._noise(0.22, 320, 0.9, 0.25, 0.004); }
}
