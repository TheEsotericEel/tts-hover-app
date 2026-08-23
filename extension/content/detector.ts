/**
 * Smart DOM text block detector for Point & Read.
 * Identifies coherent readable blocks (p, h1-h6, li, blockquote, buttons/quiz options, etc.)
 * without accidentally selecting entire page wrappers or tiny fragmented characters.
 */

export interface DetectedBlock {
  element: HTMLElement;
  text: string;
  rect: DOMRect;
}

const INLINE_TAGS = new Set([
  'A', 'SPAN', 'STRONG', 'EM', 'B', 'I', 'U', 'MARK', 'CODE', 'KBD', 'SAMP',
  'VAR', 'TIME', 'SUB', 'SUP', 'SMALL', 'ABBR', 'CITE', 'Q', 'BDO', 'BDI'
]);

const BLOCK_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE',
  'FIGCAPTION', 'DT', 'DD', 'LABEL', 'SUMMARY', 'BUTTON'
]);

const READABLE_ROLES = new Set([
  'button', 'radio', 'checkbox', 'option', 'tab', 'treeitem', 'menuitem', 'listitem'
]);

const IGNORED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'CANVAS',
  'VIDEO', 'AUDIO', 'IMG', 'PICTURE', 'SOURCE', 'TRACK', 'TEXTAREA', 'SELECT', 'DIALOG'
]);

const CONTAINER_TAGS = new Set([
  'HTML', 'BODY', 'MAIN', 'ARTICLE', 'SECTION', 'NAV', 'HEADER', 'FOOTER',
  'ASIDE', 'FORM', 'FIELDSET', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'UL', 'OL', 'DL'
]);

export class DOMDetector {
  /**
   * Identifies the closest sensible text block under the given screen coordinates.
   */
  public static detectAtPoint(x: number, y: number): DetectedBlock | null {
    const rawTarget = document.elementFromPoint(x, y);
    if (!rawTarget || !(rawTarget instanceof HTMLElement)) {
      return null;
    }

    return this.findSensibleBlock(rawTarget);
  }

  /**
   * Climbs or inspects the element tree to isolate the natural reading block.
   */
  public static findSensibleBlock(startEl: HTMLElement): DetectedBlock | null {
    if (this.isIgnored(startEl)) {
      return null;
    }

    let current: HTMLElement | null = startEl;

    // 1. If clicked/hovered inside an interactive widget (e.g. Button or ARIA role), climb up to that control
    while (current && current.parentElement && !CONTAINER_TAGS.has(current.tagName)) {
      if (current.tagName === 'BUTTON' || (current.getAttribute('role') && READABLE_ROLES.has(current.getAttribute('role')!))) {
        return this.toDetectedBlock(current);
      }
      if (INLINE_TAGS.has(current.tagName)) {
        current = current.parentElement;
      } else {
        break;
      }
    }

    if (!current || this.isIgnored(current)) {
      return null;
    }

    // 2. If it's an explicit semantic text block (p, h1-h6, li, blockquote, button, etc.), use it
    if (BLOCK_TAGS.has(current.tagName)) {
      return this.toDetectedBlock(current);
    }

    // 3. If it's a generic element like <div>, check if it's a leaf text container or a large wrapper
    while (current && !CONTAINER_TAGS.has(current.tagName)) {
      if (BLOCK_TAGS.has(current.tagName) || (current.getAttribute('role') && READABLE_ROLES.has(current.getAttribute('role')!))) {
        return this.toDetectedBlock(current);
      }

      // If current is a div, verify it doesn't contain child block elements
      if (current.tagName === 'DIV') {
        const hasChildBlocks = current.querySelector('p, h1, h2, h3, h4, h5, h6, li, blockquote, table, ul, ol, button');
        if (!hasChildBlocks) {
          // Leaf div with text
          return this.toDetectedBlock(current);
        }
      }

      current = current.parentElement;
    }

    // 4. Fallback: if we hit a container tag, verify if the starting element itself had direct readable text
    if (startEl && !this.isIgnored(startEl)) {
      return this.toDetectedBlock(startEl);
    }

    return null;
  }

  private static isIgnored(el: HTMLElement): boolean {
    if (IGNORED_TAGS.has(el.tagName)) return true;
    // Plain text input / password input
    if (el.tagName === 'INPUT' && !['button', 'submit', 'reset', 'radio', 'checkbox'].includes((el as HTMLInputElement).type)) {
      return true;
    }
    if (el.getAttribute('aria-hidden') === 'true') return true;
    if (el.classList.contains('tts-reader-overlay')) return true;

    // Check visibility
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return true;
    }

    return false;
  }

  private static toDetectedBlock(el: HTMLElement): DetectedBlock | null {
    if (this.isIgnored(el)) return null;

    const text = el.innerText?.trim();
    if (!text || text.length === 0) {
      return null;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return null;
    }

    // Reject giant screen-filling wrapper boxes that slipped through
    const docW = window.innerWidth;
    const docH = window.innerHeight;
    if (rect.width > docW * 0.95 && rect.height > docH * 0.95) {
      return null;
    }

    return {
      element: el,
      text,
      rect,
    };
  }
}
