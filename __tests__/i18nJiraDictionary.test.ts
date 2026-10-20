import { describe, expect, it } from 'vitest';
import type { Language } from '../i18n/languages';
import { en, type MessageKey } from '../i18n/messages';
import { createTranslator } from '../i18n/translate';

/**
 * What the Jira strings must say, beyond being present in both languages
 * (i18nDictionaries.test.ts checks that). Each rule below is one a reader acts
 * on, so a sentence that drifts from it sends someone the wrong way, with no
 * other test to notice.
 */

const LANGUAGES: Language[] = ['en', 'fr'];

// Every sentence that sends a facilitator to where the team's token and target
// are entered (finding U-1).
const NAMES_THE_SETTINGS_CARD: MessageKey[] = [
  'jira.note.facilitatorNoToken',
  'jira.reason.noToken',
  'jira.reason.addressChanged',
  'jira.reason.unreadable',
  'jira.reason.refused',
  'jira.reason.noTarget',
  'errors.jiraTokenMissing',
  'errors.jiraTokenUnusable',
  'errors.jiraTokenRefused',
  'errors.jiraTargetMissing'
];

const ADMIN_JIRA_KEYS = (Object.keys(en) as MessageKey[]).filter(key => key.startsWith('admin.jira.'));

describe.each(LANGUAGES)('the Jira strings in %s', (language) => {
  const t = createTranslator(language);

  it('name the Settings tab and its Jira card exactly as the Dashboard labels them', () => {
    // Built from the labels themselves, so renaming the tab or the card fails
    // here rather than leaving sentences that point to a place that is gone.
    const path = `${t('dashboard.tabs.SETTINGS')} → ${t('jira.settings.title')}`;

    for (const key of NAMES_THE_SETTINGS_CARD) {
      expect(t(key), key).toContain(path);
    }
  });

  it('call the console\'s address the base URL, never an API URL', () => {
    // It is the address people open Jira at; the server adds the REST paths.
    expect(ADMIN_JIRA_KEYS.length).toBeGreaterThan(0);
    for (const key of ADMIN_JIRA_KEYS) {
      expect(t(key), key).not.toMatch(/\bAPI\s+URL\b|\bURL\s+(?:de\s+l[’']|d[’'])\s*API\b/i);
    }
    expect(t('admin.jira.baseUrlLabel')).toMatch(language === 'en' ? /\bbase URL\b/ : /\bURL de base\b/);
  });

  it('point the self-signed toggle to NODE_EXTRA_CA_CERTS', () => {
    // Finding S-2: the toggle drops certificate checks for every team's token,
    // and the warning must name the safer alternative.
    expect(t('admin.jira.selfSignedDescription')).toContain('NODE_EXTRA_CA_CERTS');
  });

  it('ask a Cloud team for a classic API token and say it expires', () => {
    // Finding J-7: a scoped token fails against the site URL, and a Cloud API
    // token stops working within a year.
    const help = t('jira.settings.tokenHelp');
    if (language === 'en') {
      expect(help).toContain('classic API token');
      expect(help).toContain('“with scopes”');
      expect(help).toMatch(/expire within a year/);
    } else {
      expect(help).toContain('jeton d’API classique');
      expect(help).toContain('« avec des portées »');
      expect(help).toMatch(/expirent au plus tard au bout d’un an/);
    }
  });
});
