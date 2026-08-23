export class OverlayManager {
  private overlayEl: HTMLDivElement | null = null;
  private isVisible = false;
  private currentElement: HTMLElement | null = null;

  constructor() {
    this.ensureOverlay();
  }

  private ensureOverlay(): HTMLDivElement {
    if (!this.overlayEl || !document.body.contains(this.overlayEl)) {
      this.overlayEl = document.createElement('div');
      this.overlayEl.className = 'tts-reader-overlay';
      document.body.appendChild(this.overlayEl);
    }
    return this.overlayEl;
  }

  public show(element: HTMLElement): void {
    const el = this.ensureOverlay();
    this.currentElement = element;

    const rect = element.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    // Position overlay with a slight 3px padding around target element
    const pad = 3;
    el.style.left = `${rect.left + scrollX - pad}px`;
    el.style.top = `${rect.top + scrollY - pad}px`;
    el.style.width = `${rect.width + pad * 2}px`;
    el.style.height = `${rect.height + pad * 2}px`;

    el.classList.add('is-visible');
    el.classList.remove('is-speaking');
    this.isVisible = true;
  }

  public setSpeaking(speaking: boolean): void {
    if (!this.overlayEl) return;
    if (speaking) {
      this.overlayEl.classList.add('is-speaking');
    } else {
      this.overlayEl.classList.remove('is-speaking');
    }
  }

  public updatePosition(): void {
    if (this.isVisible && this.currentElement) {
      this.show(this.currentElement);
    }
  }

  public hide(): void {
    if (this.overlayEl) {
      this.overlayEl.classList.remove('is-visible', 'is-speaking');
    }
    this.isVisible = false;
    this.currentElement = null;
  }

  public destroy(): void {
    if (this.overlayEl && this.overlayEl.parentElement) {
      this.overlayEl.parentElement.removeChild(this.overlayEl);
      this.overlayEl = null;
    }
  }
}
