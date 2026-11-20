import { test, expect, type Browser, type Page } from '@playwright/test';
import { audit } from './helpers/axe';

/**
 * The team picker of the login screen, as a browser lays it out. jsdom lays
 * out nothing: `__tests__/teamLoginLayout.test.tsx` pins the classes, and this
 * spec measures what they make.
 *
 * From `lg`, a list of six teams or more takes the Dashboard's width and shows
 * its teams as tiles, two per row, in DOM order. The page never scrolls on top
 * of the list, every name is whole, and each part of a team's meta line sits on
 * one line. A team's sign-in form, and every other form, keeps the narrow card.
 * A phone keeps the one column of rows, where a name takes two lines as on a
 * tile. The whole row opens its team, the star excepted.
 *
 * The e2e server holds every team the other specs created, so the spec types
 * its own prefix into the search and measures its teams alone. They have long
 * names (35 to 45 characters), 1 to 20 members and last activities whose French
 * wording is the longest ("il y a 3 semaines"), and two of them are favourites,
 * set where the browser keeps them (`retro-favorite-teams`).
 */

const PREFIX = `Picker-${Date.now()}`;
const PASSWORD = 'pickerpass123456';
const DAY = 24 * 60 * 60 * 1000;

const SUFFIXES = [
  'Équipe plateforme',
  'Produit et données',
  'Expérience client',
  'Infrastructure réseau',
  'Qualité logicielle',
  'Données et analyses',
  'Sécurité applicative',
  'Accueil et guichets',
  'Paie et ressources',
  'Portail citoyen',
  'Archives cantonales',
  'Mobilité douce',
  'Énergie et climat',
  'Formation continue',
];
const MEMBERS = [1, 7, 20, 3, 12, 2, 9, 15, 5, 18, 4, 11, 6, 20];
const DAYS_AGO = [0, 21, 22, 23, 1, 24, 25, 4, 26, 45, 300, 27, 400, 800];

const TEAMS = SUFFIXES.map((suffix, index) => ({
  // Zero-padded, so the server's alphabetical order is this order.
  name: `${PREFIX} ${String(index + 1).padStart(2, '0')} ${suffix}`,
  members: MEMBERS[index],
  lastActive: new Date(Date.now() - DAYS_AGO[index] * DAY).toISOString(),
}));
// The third and the seventh team, so the favourites' row holds two tiles.
const FAVORITE_INDEXES = [2, 6];

/**
 * A name that one line of a phone's row cut to "Équipe Plateforme…" at 390px,
 * and that two lines hold: 141 and 150px of words on lines of 154px (measured
 * with Geist). It is the start of the name the cut was reported on, "Équipe
 * Plateforme Numérique de l'État de Genève", whose end takes a third line
 * there and is cut after the second. Without the prefix, which fills a
 * phone's line by itself, so it is created once per server and found by its
 * own name.
 */
const LONG_NAME = "Équipe Plateforme Numérique de l'État";

let favoriteIds: string[] = [];

const DESKTOPS = [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  const api = context.request;
  const ids: string[] = [];
  for (const team of TEAMS) {
    const created = await api.post('/api/team/create', {
      data: { name: team.name, password: PASSWORD, facilitatorEmail: 'facilitator@example.com' },
    });
    expect(created.status(), team.name).toBe(201);
    const { team: stored, sessionToken } = (await created.json()) as {
      team: { id: string; members: unknown[] };
      sessionToken: string;
    };
    ids.push(stored.id);
    const others = Array.from({ length: team.members - stored.members.length }, (_, k) => ({
      id: `${stored.id}-m${k}`,
      name: `Membre ${k + 1}`,
      color: 'bg-emerald-500',
      role: 'participant',
    }));
    const members = await api.post(`/api/team/${stored.id}/members`, {
      data: { sessionToken, members: [...stored.members, ...others] },
    });
    expect(members.ok(), `${team.name} members`).toBe(true);
    const dated = await api.post(`/api/team/${stored.id}/update`, {
      data: { sessionToken, updates: { lastConnectionDate: team.lastActive } },
    });
    expect(dated.ok(), `${team.name} last activity`).toBe(true);
  }
  favoriteIds = FAVORITE_INDEXES.map((index) => ids[index]);
  // Kept from an earlier attempt on the same server (a retry, a second run).
  const long = await api.post('/api/team/create', {
    data: { name: LONG_NAME, password: PASSWORD, facilitatorEmail: 'facilitator@example.com' },
  });
  expect([201, 409], LONG_NAME).toContain(long.status());
  await context.close();
});

/** A French browser on the team list, with this spec's favourites stored. */
const openPicker = async (
  browser: Browser,
  viewport: { width: number; height: number },
  device: { isMobile?: boolean; hasTouch?: boolean } = {}
): Promise<Page> => {
  // A context a spec opens itself inherits neither the locale nor the motion
  // setting of the configuration.
  const context = await browser.newContext({ locale: 'fr-CH', reducedMotion: 'reduce', viewport, ...device });
  await context.addInitScript((ids) => {
    window.localStorage.setItem('retro-favorite-teams', JSON.stringify(ids));
  }, favoriteIds);
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Vos équipes' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: TEAMS[0].name })).toBeVisible({ timeout: 15_000 });
  return page;
};

const search = (page: Page) => page.getByPlaceholder('Rechercher une équipe...');

interface TileGeometry {
  /** The team's name, as the tile shows it. */
  name: string;
  left: number;
  top: number;
  /** Line boxes of the name, and whether its box cuts any of it. */
  nameLines: number;
  nameClipped: boolean;
  /** Line boxes of each part of the meta line. */
  countLines: number;
  lastActiveLines: number;
  labelLines: number;
  valueLines: number;
  /** The star sits between the name and the chevron. */
  starInPlace: boolean;
}

/**
 * What the browser made of the page, and of each tile whose team's name holds
 * `text` (this spec's prefix unless said otherwise), in DOM order.
 */
const measure = (page: Page, text: string = PREFIX) =>
  page.evaluate(async (prefix) => {
    // Once the fonts are in: the icon font is `font-display: block`, so an icon
    // measured before it arrives is no glyph yet, and Geist replaces a
    // fallback whose words wrap elsewhere.
    await document.fonts.ready;
    // The line boxes a node's words occupy: tops that differ by more than a few
    // pixels are two lines. Decoration (aria-hidden) is not words. A part the
    // row does not have reads -1, so the assertion that wants one line fails.
    const lines = (root: Node | null | undefined): number => {
      if (!root) return -1;
      const texts: Node[] = [];
      if (root.nodeType === Node.TEXT_NODE) texts.push(root);
      else {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node);
      }
      const tops: number[] = [];
      for (const text of texts) {
        if (!text.textContent?.trim() || text.parentElement?.closest('[aria-hidden="true"]')) continue;
        const range = document.createRange();
        range.selectNodeContents(text);
        for (const rect of range.getClientRects()) if (rect.width > 0) tops.push(rect.top);
      }
      tops.sort((a, b) => a - b);
      return tops.length ? 1 + tops.filter((top, i) => i > 0 && top - tops[i - 1] > 4).length : 0;
    };

    const buttons = [...document.querySelectorAll('button')].filter((button) => button.textContent?.includes(prefix));
    const card = buttons[0]?.closest('.rounded-2xl');
    const listBox = buttons[0]?.closest('.overflow-y-auto');
    const tiles = buttons.map((button) => {
      // The tile holds the team's button and its star: the star used to be
      // inside the button, which was then the tile itself.
      const tile = button.querySelector('[role="switch"]') ? button : (button.parentElement as HTMLElement);
      const box = tile.getBoundingClientRect();
      // The element that holds the name and nothing else, whatever the rule
      // that cuts it: found by its words, not by a class.
      const name = [...button.querySelectorAll('span')].find(
        (span) => span.childElementCount === 0 && span.textContent?.includes(prefix)
      ) as HTMLElement;
      const meta = name.nextElementSibling as HTMLElement;
      // The count, then the last activity; the separator is decoration.
      const [count, lastActive] = [...meta.children].filter((part) => part.getAttribute('aria-hidden') !== 'true');
      const value = lastActive?.lastElementChild;
      const label = lastActive
        ? [...lastActive.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
        : null;
      const star = tile.querySelector('[role="switch"]') as HTMLElement;
      const chevron = [...tile.querySelectorAll('.material-symbols-outlined')].find(
        (icon) => icon.textContent === 'chevron_right'
      ) as HTMLElement;
      const nameBox = name.getBoundingClientRect();
      const starBox = star.getBoundingClientRect();
      const chevronBox = chevron.getBoundingClientRect();
      return {
        name: name.textContent ?? '',
        left: Math.round(box.left),
        top: Math.round(box.top),
        nameLines: lines(name),
        nameClipped: name.scrollWidth > name.clientWidth + 1 || name.scrollHeight > name.clientHeight + 1,
        countLines: lines(count),
        lastActiveLines: lines(lastActive),
        labelLines: lines(label),
        valueLines: lines(value),
        starInPlace: nameBox.right <= starBox.left + 0.5 && starBox.right <= chevronBox.left + 0.5,
      };
    });
    return {
      cardWidth: card ? card.getBoundingClientRect().width : 0,
      listBottom: listBox ? listBox.getBoundingClientRect().bottom : 0,
      listScrolls: listBox ? listBox.scrollHeight > listBox.clientHeight + 1 : false,
      pageScrollsDown: document.documentElement.scrollHeight > window.innerHeight,
      pageScrollsAcross: document.documentElement.scrollWidth > window.innerWidth,
      innerHeight: window.innerHeight,
      tiles,
    };
  }, text) as Promise<{
    cardWidth: number;
    listBottom: number;
    listScrolls: boolean;
    pageScrollsDown: boolean;
    pageScrollsAcross: boolean;
    innerHeight: number;
    tiles: TileGeometry[];
  }>;

/** The width of the card that holds the view, whatever the view. */
const cardWidth = (page: Page) =>
  page.evaluate(() => {
    const heading = document.querySelector('main h2');
    const card = heading?.closest('.rounded-2xl');
    return card ? card.getBoundingClientRect().width : 0;
  });

test.describe('the team picker of the login screen', () => {
  for (const viewport of DESKTOPS) {
    test(`shows a long list as two columns of whole tiles at ${viewport.width}x${viewport.height}`, async ({ browser }) => {
      const page = await openPicker(browser, viewport);
      try {
        // The whole list of the server first: however long, the page itself
        // never scrolls on top of it.
        const unfiltered = await measure(page);
        expect(unfiltered.pageScrollsDown, 'the page scrolls on top of the whole list').toBe(false);
        expect(unfiltered.pageScrollsAcross).toBe(false);

        await search(page).fill(PREFIX);
        await expect(page.getByRole('button', { name: TEAMS[13].name })).toBeAttached();
        const picker = await measure(page);

        expect(picker.tiles).toHaveLength(TEAMS.length);
        // The Dashboard's width (72rem), where the forms keep 28rem.
        expect(picker.cardWidth).toBeGreaterThanOrEqual(1100);
        // Two columns of tiles...
        expect(new Set(picker.tiles.map((tile) => tile.left)).size).toBe(2);
        // ...read row by row, in DOM order: each tile is right of the one
        // before on its row, or below it.
        picker.tiles.slice(1).forEach((tile, index) => {
          const before = picker.tiles[index];
          const sameRow = Math.abs(tile.top - before.top) <= 1;
          expect(sameRow ? tile.left > before.left : tile.top > before.top, `tile ${index + 2} follows tile ${index + 1}`).toBe(true);
        });
        picker.tiles.forEach((tile, index) => {
          const which = `tile ${index + 1}`;
          expect(tile.nameClipped, `${which}: its name is cut`).toBe(false);
          expect(tile.nameLines, which).toBeLessThanOrEqual(2);
          expect(tile.countLines, `${which}: its member count is one line`).toBe(1);
          expect(tile.lastActiveLines, `${which}: its last activity is one line`).toBe(1);
          expect(tile.starInPlace, `${which}: its star sits between the name and the chevron`).toBe(true);
        });

        expect(picker.pageScrollsDown, 'the page scrolls on top of the list').toBe(false);
        expect(picker.pageScrollsAcross).toBe(false);
        expect(picker.listBottom).toBeLessThanOrEqual(picker.innerHeight);
        if (viewport.height === 800) {
          // The list is longer than the room left: its own box scrolls, so the
          // chain really is capped by the viewport.
          expect(picker.listScrolls).toBe(true);
        }
      } finally {
        await page.context().close();
      }
    });
  }

  test('opens a team, and every form, in the narrow card; Back brings the wide list again', async ({ browser }) => {
    const page = await openPicker(browser, { width: 1920, height: 1080 });
    try {
      await search(page).fill(PREFIX);
      expect(await cardWidth(page)).toBeGreaterThanOrEqual(1100);

      await page.getByText(TEAMS[0].name, { exact: true }).click();
      await expect(page.getByRole('heading', { name: `Connexion à ${TEAMS[0].name}` })).toBeVisible();
      await expect(page.getByLabel('Mot de passe')).toBeVisible();
      expect(await cardWidth(page)).toBeLessThanOrEqual(448);

      await page.getByRole('button', { name: 'Retour' }).click();
      await expect(page.getByRole('heading', { name: 'Vos équipes' })).toBeVisible();
      await expect(page.getByRole('button', { name: TEAMS[0].name })).toBeVisible();
      expect(await cardWidth(page)).toBeGreaterThanOrEqual(1100);

      await page.getByRole('button', { name: '+ Nouvelle équipe' }).click();
      await expect(page.getByRole('heading', { name: 'Créer une nouvelle équipe' })).toBeVisible();
      expect(await cardWidth(page)).toBeLessThanOrEqual(448);
    } finally {
      await page.context().close();
    }
  });

  test('says when a search matches no team', async ({ browser }) => {
    const page = await openPicker(browser, { width: 1280, height: 800 });
    try {
      await search(page).fill(`${PREFIX}-zzz`);
      await expect(page.getByRole('status')).toHaveText(`Aucune équipe ne correspond à «\u00a0${PREFIX}-zzz\u00a0».`);
      await expect(page.getByRole('button', { name: PREFIX })).toHaveCount(0);
      await search(page).fill(PREFIX);
      await expect(page.getByRole('status')).toHaveText('');
    } finally {
      await page.context().close();
    }
  });

  test('reaches each team and then its star with Tab, and stars from the keyboard', async ({ browser }) => {
    const page = await openPicker(browser, { width: 1280, height: 800 });
    try {
      const field = search(page);
      await field.fill(PREFIX);
      const [first, second] = FAVORITE_INDEXES.map((index) => TEAMS[index].name);

      // From the search field: its clear button, then the first favourite, its
      // star, the next favourite, its star.
      await field.focus();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Effacer la recherche' })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: first })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('switch', { name: `Retirer ${first} des favoris` })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: second })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('switch', { name: `Retirer ${second} des favoris` })).toBeFocused();

      // Space takes the team out of the favourites; its star, drawn again in
      // the other section, keeps the focus. Enter puts it back.
      await page.keyboard.press('Space');
      const unstarred = page.getByRole('switch', { name: `Ajouter ${second} aux favoris` });
      await expect(unstarred).toBeFocused();
      await expect(unstarred).toHaveAttribute('aria-checked', 'false');
      await page.keyboard.press('Enter');
      const starred = page.getByRole('switch', { name: `Retirer ${second} des favoris` });
      await expect(starred).toBeFocused();
      await expect(starred).toHaveAttribute('aria-checked', 'true');
    } finally {
      await page.context().close();
    }
  });

  test('passes the accessibility audit as tiles, in French', async ({ browser }, testInfo) => {
    const page = await openPicker(browser, { width: 1280, height: 800 });
    try {
      await search(page).fill(PREFIX);
      await expect(page.getByRole('button', { name: TEAMS[13].name })).toBeAttached();
      await audit(page, testInfo, 'login-team-grid');
    } finally {
      await page.context().close();
    }
  });

  test('keeps one column on a phone, each part of the meta line whole', async ({ browser }) => {
    const page = await openPicker(browser, { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
    try {
      await search(page).fill(PREFIX);
      await expect(page.getByRole('button', { name: TEAMS[13].name })).toBeAttached();
      const phone = await measure(page);
      expect(phone.tiles).toHaveLength(TEAMS.length);
      expect(new Set(phone.tiles.map((tile) => tile.left)).size, 'one column').toBe(1);
      expect(phone.cardWidth).toBeLessThanOrEqual(358);
      expect(phone.pageScrollsAcross).toBe(false);
      for (const tile of phone.tiles) {
        // "7 membres" never splits; the last activity breaks between its label
        // and its value, never inside either.
        expect(tile.countLines).toBe(1);
        expect(tile.labelLines).toBe(1);
        expect(tile.valueLines).toBe(1);
        expect(tile.starInPlace).toBe(true);
      }

      // A row's name takes a second line, as a tile's does, rather than
      // being cut on the first.
      await search(page).fill(LONG_NAME);
      await expect(page.getByRole('button', { name: LONG_NAME })).toBeVisible();
      const long = (await measure(page, LONG_NAME)).tiles.find((tile) => tile.name === LONG_NAME);
      expect(long, 'the long name has its row').toBeDefined();
      expect(long!.nameLines, 'the long name takes two lines').toBe(2);
      expect(long!.nameClipped, 'the long name is cut').toBe(false);
      expect(long!.starInPlace).toBe(true);
    } finally {
      await page.context().close();
    }
  });

  // The team's button covers its row with its `::after`, so the row's chevron
  // and its padding open the team too, and only the star, drawn above that
  // layer, is a control of its own. A box lifted above the layer (a chevron
  // made `relative`), or a layer that no longer covers the row, would leave a
  // part of the row that opens nothing.
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    test(`opens a team from its chevron and from its row beside the star at ${viewport.width}px`, async ({ browser }) => {
      const page = await openPicker(browser, viewport);
      try {
        await search(page).fill(PREFIX);
        const name = TEAMS[0].name;
        const team = page.getByRole('button', { name });
        const row = team.locator('xpath=..');
        const opened = page.getByRole('heading', { name: `Connexion à ${name}` });
        const back = async () => {
          await page.getByRole('button', { name: 'Retour' }).click();
          await expect(team).toBeVisible();
        };
        await expect(team).toBeVisible();

        // page.mouse aims at a point and checks nothing drawn there: the click
        // goes to whatever the browser finds on top of it.
        await team.scrollIntoViewIfNeeded();
        const chevron = (await row.locator('.material-symbols-outlined', { hasText: 'chevron_right' }).boundingBox())!;
        await page.mouse.click(chevron.x + chevron.width / 2, chevron.y + chevron.height / 2);
        await expect(opened).toBeVisible();
        await back();

        // The row's padding (12px) right above the star, 6px into the row:
        // no part of the star.
        await team.scrollIntoViewIfNeeded();
        const star = (await row.getByRole('switch').boundingBox())!;
        const box = (await row.boundingBox())!;
        expect(star.y - box.y, 'room above the star').toBeGreaterThanOrEqual(12);
        await page.mouse.click(star.x + star.width / 2, box.y + 6);
        await expect(opened).toBeVisible();
        await back();
      } finally {
        await page.context().close();
      }
    });
  }
});
