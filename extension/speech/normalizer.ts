/**
 * Text normalizer for speech synthesis.
 * Cleans web text for speech engines without destroying code, citations, or numbers.
 */
export class TextNormalizer {
  /**
   * Normalizes raw DOM text for clean TTS pronunciation.
   */
  public static normalize(rawText: string): string {
    if (!rawText) return '';

    let text = rawText;

    // Replace zero-width spaces and non-breaking spaces
    text = text.replace(/[\u200B-\u200D\uFEFF]/g, '');
    text = text.replace(/\u00A0/g, ' ');

    // Normalize multiple whitespace, tabs, and newlines to single spaces
    text = text.replace(/\s+/g, ' ').trim();

    // Replace markdown / bullet points at start of line
    text = text.replace(/^[-*•–—]\s+/, '');

    // Normalize common abbreviations for clearer pronunciation
    const abbreviations: Record<string, string> = {
      'e\\.g\\.': 'for example',
      'i\\.e\\.': 'that is',
      'etc\\.': 'etcetera',
      'vs\\.': 'versus',
      'approx\\.': 'approximately',
      'dept\\.': 'department',
      'fig\\.': 'figure',
      'vol\\.': 'volume',
      'no\\.': 'number',
    };

    for (const [abbr, replacement] of Object.entries(abbreviations)) {
      const regex = new RegExp(`\\b${abbr}`, 'gi');
      text = text.replace(regex, replacement);
    }

    // Clean Wikipedia-style edit links: [edit] -> ''
    text = text.replace(/\[edit\]/gi, '');

    // Simplify URLs to readable domain names (e.g., https://example.com/foo -> link to example.com)
    text = text.replace(/https?:\/\/(?:www\.)?([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})[^\s]*/gi, 'link to $1');

    return text.trim();
  }
}
