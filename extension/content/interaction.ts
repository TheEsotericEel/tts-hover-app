import { DOMDetector, DetectedBlock } from './detector';
import { OverlayManager } from './overlay';
import { TTSClient } from '../speech/client';

export class InteractionController {
  private overlay: OverlayManager;
  private ttsClient: TTSClient;
  private currentBlock: DetectedBlock | null = null;
  private isEnabled = true;
  private isSpeaking = false;
  private rafId: number | null = null;
  private lastPointerPos = { x: 0, y: 0 };

  constructor(ttsClient: TTSClient) {
    this.ttsClient = ttsClient;
    this.overlay = new OverlayManager();
    this.init();
  }

  private async init(): Promise<void> {
    const settings = await this.ttsClient.loadSettings();
    this.isEnabled = settings.enabled;

    this.bindEvents();
    this.listenToStorageChanges();
  }

  private bindEvents(): void {
    // 1. Pointer move tracking
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });

    // 2. Click interception to read hovered block
    window.addEventListener('click', this.onClick, true); // Capture phase to prevent accidental link clicks

    // 3. Escape key to stop playback
    window.addEventListener('keydown', this.onKeyDown);

    // 4. Reposition overlay on scroll / resize
    window.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.onResize, { passive: true });
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.isEnabled) return;

    this.lastPointerPos = { x: e.clientX, y: e.clientY };

    if (this.rafId !== null) return;

    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.handlePointerPosition(this.lastPointerPos.x, this.lastPointerPos.y);
    });
  };

  private handlePointerPosition(x: number, y: number): void {
    const block = DOMDetector.detectAtPoint(x, y);

    if (!block) {
      if (!this.isSpeaking) {
        this.overlay.hide();
        this.currentBlock = null;
      }
      return;
    }

    // If we moved to a new block
    if (!this.currentBlock || this.currentBlock.element !== block.element) {
      this.currentBlock = block;

      // Show selection overlay on the new element
      this.overlay.show(block.element);

      // If not currently speaking another block, start preparing speech for this block in background
      if (!this.isSpeaking) {
        this.ttsClient.prepare(block.text).catch((err) => {
          console.debug('[InteractionController] Pre-buffering background notice:', err);
        });
      }
    }
  }

  private onClick = async (e: MouseEvent): Promise<void> => {
    if (!this.isEnabled || !this.currentBlock) return;

    const target = e.target as HTMLElement | null;
    if (!target) return;

    // Check if the click occurred inside the currently selected element
    if (this.currentBlock.element.contains(target) || this.currentBlock.element === target) {
      e.preventDefault();
      e.stopPropagation();

      await this.readCurrentBlock();
    }
  };

  public async readCurrentBlock(): Promise<void> {
    if (!this.currentBlock) return;

    const blockToRead = this.currentBlock;
    this.isSpeaking = true;
    this.overlay.setSpeaking(true);

    try {
      await this.ttsClient.speak(blockToRead.text);
    } catch (err) {
      console.error('[InteractionController] Playback error:', err);
    } finally {
      this.isSpeaking = false;
      this.overlay.setSpeaking(false);
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      this.stopPlayback();
    }
  };

  public stopPlayback(): void {
    this.ttsClient.stop();
    this.isSpeaking = false;
    this.overlay.setSpeaking(false);
  }

  private onScroll = (): void => {
    this.overlay.updatePosition();
  };

  private onResize = (): void => {
    this.overlay.updatePosition();
  };

  private listenToStorageChanges(): void {
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.ttsSettings) {
          const newSettings = changes.ttsSettings.newValue;
          if (newSettings) {
            this.isEnabled = !!newSettings.enabled;
            this.ttsClient.loadSettings();

            if (!this.isEnabled) {
              this.stopPlayback();
              this.overlay.hide();
            }
          }
        }
      });
    }
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled) {
      this.stopPlayback();
      this.overlay.hide();
    }
  }
}
