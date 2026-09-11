/* Shared event presentation only. No business state is inferred from audio. */
(function (root) {
  'use strict';
  class StatusSound {
    constructor({ contextFactory, storage } = {}) {
      this.factory = contextFactory || (() => {
        const Context = root.AudioContext || root.webkitAudioContext;
        return Context ? new Context() : null;
      });
      this.storage = storage;
      this.context = null;
      this.enabled = false;
      this.volume = 0.2;
      this.nodes = new Set();
      this.seen = new Set();
      try {
        const saved = JSON.parse(storage?.getItem('coffee-sound:recent') || '[]');
        if (Array.isArray(saved)) this.seen = new Set(saved.filter(key => typeof key === 'string').slice(-256));
      } catch (_) {}
      this.previous = null;
      this.generation = 0;
    }
    async enable() {
      const generation = ++this.generation;
      try {
        this.context ||= this.factory();
        if (!this.context) return false;
        await this.context.resume();
        if (generation !== this.generation) return false;
        this.enabled = this.context.state === 'running';
      } catch (_) { this.enabled = false; }
      return this.enabled;
    }
    mute() { this.generation++; this.enabled = false; this.stop(); }
    stop() {
      for (const { oscillator, gain } of this.nodes) {
        try { oscillator.stop(); } catch (_) {}
        oscillator.disconnect(); gain.disconnect();
      }
      this.nodes.clear();
    }
    disconnect() { this.stop(); this.previous = null; }
    close() {
      this.mute(); this.previous = null;
      if (this.context) { const context = this.context; this.context = null; Promise.resolve(context.close()).catch(() => {}); }
    }
    setVolume(value) {
      const volume = Number(value);
      if (Number.isFinite(volume)) this.volume = Math.min(1, Math.max(0, volume));
      if (!this.volume) this.stop();
    }
    mark(key) {
      if (this.seen.has(key)) return false;
      this.seen.add(key);
      if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value);
      try { this.storage?.setItem('coffee-sound:recent', JSON.stringify([...this.seen])); } catch (_) {}
      return true;
    }
    update({ id, status, revision = 0, collected = false }) {
      if (!id) { this.stop(); this.previous = { id: null }; return; }
      const previous = this.previous;
      if (previous?.id === id && revision && previous.revision && revision < previous.revision) return;
      this.previous = { id, status, revision };
      const kind = ({ ACCEPTED: 'accepted', ACKNOWLEDGED: 'accepted', READY: 'ready', SUCCEEDED: 'ready', HOLD: 'alert', FAILED: 'alert' })[status];
      if (['PAUSED', 'RETRY_WAIT', 'HOLD', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED'].includes(status) || collected) this.stop();
      if (!kind) return;
      // Baseline snapshots, reconnects and silent events are consumed, never replayed later.
      const fresh = this.mark(`${id}:${kind}`);
      if (!fresh || !previous || (previous.id !== id && kind !== 'accepted') || (previous.id === id && previous.status === status) || collected) return;
      if (this.enabled && this.volume > 0 && this.context?.state === 'running') this.play(kind);
    }
    play(kind) {
      this.stop();
      try {
        const context = this.context, now = context.currentTime;
        const oscillator = context.createOscillator(), gain = context.createGain();
        const node = { oscillator, gain };
        this.nodes.add(node);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(kind === 'alert' ? 330 : 587.33, now);
        oscillator.frequency.exponentialRampToValueAtTime(kind === 'ready' ? 880 : kind === 'alert' ? 220 : 660, now + 0.12);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(this.volume * 0.12, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); this.nodes.delete(node); };
        oscillator.start(now); oscillator.stop(now + 0.42);
      } catch (_) { this.stop(); }
    }
  }
  root.CoffeeStatusSound = StatusSound;
  if (!root.document?.addEventListener) return;
  let storage;
  try { storage = root.sessionStorage; } catch (_) {}
  const sound = new StatusSound({ storage });
  root.CoffeeSound = sound;
  const controls = root.document.getElementById('sound-controls');
  if (controls) {
    const button = root.document.createElement('button');
    button.type = 'button';
    const volume = root.document.createElement('input');
    volume.type = 'range'; volume.min = '0'; volume.max = '100'; volume.value = '20';
    const label = () => {
      const en = root.document.documentElement.lang.startsWith('en');
      button.textContent = sound.enabled ? (en ? 'Mute' : '静音') : (en ? 'Enable sound' : '开启声音');
      button.setAttribute('aria-pressed', String(sound.enabled));
      volume.setAttribute('aria-label', en ? 'Sound volume' : '提示音音量');
    };
    button.onclick = async () => { if (sound.enabled) sound.mute(); else await sound.enable(); label(); };
    volume.oninput = () => sound.setVolume(Number(volume.value) / 100);
    controls.append(button, volume); label();
    new MutationObserver(label).observe(root.document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    root.document.addEventListener('visibilitychange', () => {
      if (root.document.visibilityState !== 'visible') { sound.mute(); sound.disconnect(); label(); }
    });
    root.addEventListener('pagehide', () => { sound.close(); label(); });
  }
})(globalThis);
