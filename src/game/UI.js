/** Thin controller over the DOM overlays (menu, HUD, banner, pause, victory). */
export class UI {
  constructor() {
    this.el = {
      menu: document.getElementById('menu'),
      hud: document.getElementById('hud'),
      banner: document.getElementById('banner'),
      pause: document.getElementById('pause'),
      victory: document.getElementById('victory'),
      loading: document.getElementById('loading'),
      levelName: document.querySelector('#hud-level .hud-level-name'),
      litCount: document.querySelector('#hud-level .lit-count'),
      litTotal: document.querySelector('#hud-level .lit-total'),
      crosshair: document.getElementById('crosshair'),
      levelSelect: document.getElementById('menu-levelselect'),
      victoryStats: document.getElementById('victory-stats'),
    };
    this._bannerTimer = null;
  }

  hideLoading() {
    this.el.loading.style.opacity = '0';
    setTimeout(() => this.el.loading.classList.add('hidden'), 600);
  }

  showMenu() {
    this.el.menu.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.el.victory.classList.add('hidden');
  }

  hideMenu() { this.el.menu.classList.add('hidden'); }

  showHUD() { this.el.hud.classList.remove('hidden'); }

  showPause(show) { this.el.pause.classList.toggle('hidden', !show); }

  showVictory(stats) {
    this.el.victory.classList.remove('hidden');
    this.el.hud.classList.add('hidden');
    if (stats) this.el.victoryStats.textContent = stats;
  }
  hideVictory() { this.el.victory.classList.add('hidden'); }

  setLevelName(name) { this.el.levelName.textContent = name; }

  setProgress(count, total) {
    this.el.litCount.textContent = count;
    this.el.litTotal.textContent = total;
  }

  setGrabbing(on) { this.el.crosshair.classList.toggle('grabbing', on); }

  banner(eyebrow, title, sub, duration = 3200) {
    const b = this.el.banner;
    b.querySelector('.banner-eyebrow').textContent = eyebrow;
    b.querySelector('.banner-title').textContent = title;
    b.querySelector('.banner-sub').textContent = sub;
    b.classList.remove('hidden');
    // restart CSS animations
    b.querySelectorAll('div').forEach((d) => {
      d.style.animation = 'none';
      void d.offsetWidth;
      d.style.animation = '';
    });
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => b.classList.add('hidden'), duration);
  }

  buildLevelSelect(levels, unlocked, onPick) {
    this.el.levelSelect.innerHTML = '';
    levels.forEach((lvl, i) => {
      const chip = document.createElement('div');
      const isUnlocked = i <= unlocked;
      chip.className = 'level-chip' + (isUnlocked ? '' : ' locked');
      chip.textContent = lvl.name;
      if (isUnlocked) chip.addEventListener('click', () => onPick(i));
      this.el.levelSelect.appendChild(chip);
    });
  }

  setMuted(muted) {
    for (const id of ['btn-mute', 'btn-mute-pause']) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.classList.toggle('muted', !!muted);
      el.setAttribute('aria-pressed', muted ? 'true' : 'false');
      el.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
    }
  }
}
