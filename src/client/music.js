// Menu music: a looping track (public/audio/menu-music.mp3) streamed through
// an <audio> element, so the 5-minute song is never decoded into memory all
// at once. It goes through the game's master gain, so the master volume still
// applies, and has its own gain for the music slider and mute button. While a
// match is on, it fades out and pauses so it costs nothing in game.

const SRC = '/audio/menu-music.mp3';

export class MenuMusic {
  constructor(audio) {
    this.audio = audio;
    this.el = null;
    this.gain = null;
    this.level = 0.5; // settings.music
    this.muted = false;
    this.active = true; // only plays on the main menu
    this.pauseTimer = null;
  }

  // Call after audio.unlock() (browsers only allow sound after a click/key).
  start() {
    const ctx = this.audio.ctx;
    if (!ctx || this.el) return;
    try {
      const el = new window.Audio();
      el.src = SRC;
      el.loop = true;
      el.preload = 'auto';
      // iOS: play inline, never in a fullscreen player.
      el.setAttribute('playsinline', '');
      this.el = el;
      this.gain = ctx.createGain();
      this.gain.gain.value = 0;
      this.gain.connect(this.audio.master);
      ctx.createMediaElementSource(el).connect(this.gain);
      this.apply(1.2);
    } catch (e) {
      console.warn('Menu music failed', e);
    }
  }

  set({ level = this.level, muted = this.muted, active = this.active }) {
    this.level = level; this.muted = muted; this.active = active;
    this.apply(active ? 1 : 0.6);
  }

  apply(fade) {
    if (!this.gain) return;
    const ctx = this.audio.ctx;
    const target = this.active && !this.muted ? this.level * 0.7 : 0;
    const g = this.gain.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(g.value, ctx.currentTime);
    g.linearRampToValueAtTime(target, ctx.currentTime + fade);
    clearTimeout(this.pauseTimer);
    if (target > 0) {
      if (this.el.paused) this.el.play().catch((e) => console.warn('Menu music failed', e));
    } else {
      // Pause once the fade is done; it resumes where it left off.
      this.pauseTimer = setTimeout(() => this.el.pause(), fade * 1000 + 50);
    }
  }
}
