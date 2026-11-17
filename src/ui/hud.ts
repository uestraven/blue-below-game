/**
 * The in-world HUD: interaction prompt, inventory, stamina, and the
 * directional demon cue that lets the player judge where it is without
 * seeing it.
 */

export interface InventoryLine {
  cls: string;
  mark: string;
  text: string;
}

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly bottom: HTMLDivElement;
  private readonly stamina: HTMLDivElement;
  private readonly staminaFill: HTMLElement;
  private readonly threat: HTMLDivElement;
  private readonly dir: HTMLDivElement;
  private readonly toastEl: HTMLDivElement;
  private readonly tag: HTMLDivElement;
  private readonly hideOverlay: HTMLDivElement;
  private toastTimer: number | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.style.position = 'absolute';
    this.root.style.inset = '0';
    this.root.style.pointerEvents = 'none';
    parent.appendChild(this.root);

    this.crosshair = div('hud-crosshair');
    this.prompt = div('hud-prompt');
    this.prompt.style.display = 'none';
    this.bottom = div('hud-bottom');
    this.stamina = div('hud-stamina');
    this.staminaFill = document.createElement('i');
    this.stamina.appendChild(this.staminaFill);
    this.threat = div('hud-threat');
    this.threat.textContent = 'SOMETHING IS CLOSE';
    this.dir = div('hud-dir');
    this.dir.appendChild(document.createElement('i'));
    this.toastEl = div('hud-toast');
    this.tag = div('hud-vhs');
    // Framing for the inside of a hiding place: slats for a locker, a low
    // letterbox for under a desk, a lid gap for a crate.
    this.hideOverlay = div('hud-hide');
    this.hideOverlay.innerHTML = '<i class="slats"></i><span class="tagline">HIDDEN</span>';

    for (const el of [this.hideOverlay, this.crosshair, this.prompt, this.bottom, this.stamina, this.threat, this.dir, this.toastEl, this.tag]) {
      this.root.appendChild(el);
    }
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'block' : 'none';
  }

  setTag(text: string): void {
    this.tag.textContent = text;
  }

  /** `kind` frames the view from inside a hiding place; null clears it. */
  setHidden(kind: 'locker' | 'under' | 'crate' | null): void {
    this.hiddenKind = kind;
    this.hideOverlay.className = kind ? `hud-hide on ${kind}` : 'hud-hide';
    this.crosshair.style.display = kind ? 'none' : '';
  }

  get hidden(): boolean {
    return this.hiddenKind !== null;
  }

  private hiddenKind: 'locker' | 'under' | 'crate' | null = null;

  setAiming(aiming: boolean): void {
    this.crosshair.className = aiming ? 'hud-crosshair aiming' : 'hud-crosshair';
  }

  setPrompt(text: string | null, key = 'E', disabled = false): void {
    if (!text) {
      this.prompt.style.display = 'none';
      return;
    }
    this.prompt.style.display = 'block';
    this.prompt.className = disabled ? 'hud-prompt disabled' : 'hud-prompt';
    this.prompt.innerHTML = '';
    const k = document.createElement('span');
    k.className = 'key';
    k.textContent = key;
    this.prompt.appendChild(k);
    this.prompt.appendChild(document.createTextNode(text));
  }

  setInventory(lines: InventoryLine[]): void {
    this.bottom.innerHTML = '';
    for (const l of lines) {
      const d = document.createElement('div');
      d.className = `hud-item ${l.cls}`;
      const m = document.createElement('span');
      m.className = 'mark';
      m.textContent = l.mark;
      d.appendChild(m);
      d.appendChild(document.createTextNode(' ' + l.text));
      this.bottom.appendChild(d);
    }
  }

  setStamina(v: number, visible: boolean): void {
    this.stamina.style.display = visible ? 'block' : 'none';
    this.staminaFill.style.width = `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
    this.stamina.className = v < 0.26 ? 'hud-stamina low' : 'hud-stamina';
  }

  /**
   * `level` 0..1 is how strong the cue is; `angle` is the bearing to the demon
   * relative to where the player is looking, in radians (0 = dead ahead).
   */
  setThreat(level: number, angle: number | null): void {
    this.threat.className = level > 0.55 ? 'hud-threat on' : 'hud-threat';
    if (level <= 0.02 || angle === null) {
      this.dir.style.opacity = '0';
      return;
    }
    const r = Math.min(window.innerWidth, window.innerHeight) * 0.36;
    const px = Math.sin(angle) * r;
    const py = -Math.cos(angle) * r;
    this.dir.style.opacity = String(Math.min(1, level));
    this.dir.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
  }

  toast(text: string, seconds = 3.2): void {
    this.toastEl.textContent = text;
    this.toastEl.className = 'hud-toast on';
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.className = 'hud-toast';
      this.toastTimer = null;
    }, seconds * 1000);
  }

  clearToast(): void {
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = null;
    this.toastEl.className = 'hud-toast';
  }
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}
