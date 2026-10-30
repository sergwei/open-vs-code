// Protects the one thing the move to `src/shared` added: `formatSessionTime` takes the locale from
// its caller (the host passes `vscode.env.language`) instead of always using the default. The
// grouping rules themselves are protected by `webview-ui/src/sessions/sessionGroups.test.ts`,
// which imports them through the re-export.
//
// Provenance: dates are built from LOCAL components, so the expected hour does not depend on the
// time zone of the machine; the expected texts are what Node's ICU printed on Windows 11
// (29/10/2026). Fabricated input, nothing talks to a server.
import { describe, expect, it } from 'vitest';
import { formatSessionTime } from './sessionGroups';

/** Local time on 21 Oct 2026, 15:30. */
const NOW = new Date(2026, 9, 21, 15, 30).getTime();

describe('formatSessionTime', () => {
  it('formats the time with an explicit locale', () => {
    expect(formatSessionTime(NOW, NOW, 'de-DE')).toBe('15:30');
    // en-US prints "03:30 PM"; recent ICU puts a narrow no-break space before "PM", which `\s` covers.
    expect(formatSessionTime(NOW, NOW, 'en-US')).toMatch(/^03:30\s?PM$/u);
  });

  it('keeps the default locale when none is given', () => {
    expect(formatSessionTime(NOW, NOW)).toBe(
      new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(NOW),
    );
  });
});
