import { test, expect, request as apiRequest, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { JIRA_MOCK_PAT, startJiraMock, type JiraMock } from '../__tests__/helpers/jiraMock';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';
import { audit } from './helpers/axe';

/**
 * Creating a team's actions in Jira, end to end, against the Jira mock the unit
 * suites use (`__tests__/helpers/jiraMock.ts`, mounted under `/jira` as a Data
 * Center behind a shared host is).
 *
 * Every rule of the creation is unit-tested — claims, the time budget, stop
 * codes, the live-session patch, the client's retry rule. What only a browser
 * shows is that the pieces meet: the console's address reaches the routes, the
 * token saved in Settings is the one the creation uses, the server's patch of
 * the live session reaches a participant who never clicked anything, and the
 * keys survive a reload because the team record holds them.
 *
 * It also audits the five screens the feature added (`e2e/helpers/axe.ts`, at
 * zero like every other screen): they need a Jira and a second browser, which
 * `accessibility-audit.spec.ts` has neither of.
 *
 * Needs `SESSION_TOKEN_SECRET` on the e2e server (`playwright.config.ts`): the
 * token store refuses to seal a token with a per-process key.
 */

const STAMP = Date.now();
const TEAM_NAME = `Jira-E2E-${STAMP}`;
const TEAM_PASSWORD = 'jira-e2e-pass';
const PARTICIPANT_NAME = 'Noor';
const SUPER_ADMIN_PASSWORD = 'e2e-super-admin-password';
// Every issue this attempt creates carries this label, so the counts below
// never see an issue left by another run, a retry, or another spec.
const LABEL = `e2e-${STAMP}`;

const TICKET = 'Releases keep slipping';
const NEW_ACTIONS = ['Write the release checklist', 'Book a weekly release review'];
const PREVIOUS_ACTION = 'Automate the changelog';
const REMAINING_ACTION = 'Archive the old wiki pages';

const linkName = (key: string) => `${key}, open in Jira (new tab)`;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// One action row of the Review step, found by the action's text (a textarea's
// value) — the row also holds its Jira control.
const reviewRow = (page: Page, text: string): Locator =>
  page.locator('div.group').filter({ has: page.locator('textarea', { hasText: text }) });

// One action row of the Dashboard's Actions tab (an input's value).
const dashboardRow = (page: Page, text: string): Locator =>
  page.locator('div.group').filter({ has: page.locator(`input[value="${text}"]`) });

const keyOf = (mock: JiraMock, summary: string): string => {
  const issue = mock.issues({ label: LABEL }).find(candidate => candidate.summary === summary);
  if (!issue) throw new Error(`No issue in the mock for "${summary}"`);
  return issue.key;
};

const issueCount = (mock: JiraMock) => mock.issues({ label: LABEL }).length;

const openConsole = async (page: Page) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Super Admin Access' }).click();
  await page.getByLabel('Super Admin Password').fill(SUPER_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Access Admin Panel' }).click();
  await expect(page.getByRole('heading', { name: /Super Admin Dashboard/ })).toBeVisible({ timeout: 10_000 });
};

const createTeam = async (page: Page) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '+ New Team' }).click();
  await page.getByPlaceholder('e.g. Design Team').fill(TEAM_NAME);
  await page.locator('input[type="password"]').fill(TEAM_PASSWORD);
  await page.getByLabel('Recovery Email').fill('facilitator@example.com');
  await page.getByRole('button', { name: 'Create & Join' }).click();
  await expect(page.getByText(`${TEAM_NAME} Dashboard`)).toBeVisible({ timeout: 15_000 });
  await dismissAnnouncementsIfPresent(page);
};

const addBacklogAction = async (page: Page, text: string) => {
  await page.getByPlaceholder('What needs to be done?').fill(text);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator(`input[value="${text}"]`)).toBeVisible({ timeout: 10_000 });
};

const readInviteLink = async (page: Page) => {
  await page.locator('button[title="Invite / Join"]').click();
  await page.getByRole('button', { name: 'CODE & LINK' }).click();
  const link = page.locator('code').first();
  await expect(link).toContainText('?join=', { timeout: 10_000 });
  const url = (await link.textContent()) ?? '';
  await page.getByRole('button', { name: 'Done' }).click();
  return url;
};

const joinThroughInvite = async (page: Page, inviteUrl: string) => {
  await page.goto(inviteUrl);
  const joinHeading = page.getByText(`Join ${TEAM_NAME}`);
  const phaseHeading = page.getByRole('heading', { name: 'Icebreaker' });
  const mode = await Promise.race([
    joinHeading.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'JOIN' as const),
    phaseHeading.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'AUTO' as const),
  ]);
  if (mode === 'JOIN') {
    const notInList = page.getByRole('button', { name: "I'm not in the list" });
    if (await notInList.isVisible({ timeout: 2_000 }).catch(() => false)) await notInList.click();
    await page.getByPlaceholder('e.g. John Doe').fill(PARTICIPANT_NAME);
    await page.getByRole('button', { name: 'Join Retrospective' }).click();
  }
  await expect(phaseHeading).toBeVisible({ timeout: 15_000 });
};

// A Dashboard tab. Its accessible name starts with its icon's ligature
// ("settings Settings"), so it is found by its class and visible text.
const dashboardTab = (page: Page, label: string) => page.locator('.dash-tab', { hasText: label });

const discoveryNote = (page: Page) => page.getByRole('note', { name: 'New: create your actions in Jira' });

test.describe('Creating actions in Jira', () => {
  let mock: JiraMock;
  const contexts: BrowserContext[] = [];

  const newPage = async (browser: Browser) => {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    // Changing a saved Jira address asks first (`window.confirm`); a run that
    // died before its afterAll leaves another mock's address behind.
    page.on('dialog', dialog => { void dialog.accept(); });
    return page;
  };

  test.beforeAll(async () => {
    mock = await startJiraMock({ port: 0, contextPath: '/jira' });
  });

  test.afterAll(async () => {
    await Promise.all(contexts.map(context => context.close()));
    // Later specs must find a deployment without Jira: turn it off through
    // the console's own route, with the console's credential.
    const api = await apiRequest.newContext({ baseURL: 'http://localhost:3000' });
    try {
      const response = await api.post('/api/super-admin/update-jira-settings', {
        data: { password: SUPER_ADMIN_PASSWORD, enabled: false, baseUrl: null, allowSelfSignedCerts: false },
      });
      expect(response.ok(), `turning Jira off answered ${response.status()}`).toBe(true);
    } finally {
      await api.dispose();
      await mock?.close();
    }
  });

  test('a facilitator sends a retrospective\'s actions to Jira, once', async ({ browser }, testInfo) => {
    test.setTimeout(300_000);
    const facilitator = await newPage(browser);
    const participant = await newPage(browser);

    // ---- The console: the deployment's one Jira -------------------------
    await openConsole(facilitator);
    const consoleCard = facilitator.getByRole('region', { name: 'Jira', exact: true });
    await expect(consoleCard).toBeVisible();
    // Wait for the stored settings: Save is unavailable until they are read.
    await expect(consoleCard.getByRole('button', { name: 'Save the Jira settings' })).not.toHaveAttribute('aria-disabled', 'true');
    const enable = consoleCard.getByRole('switch', { name: 'Enable Jira' });
    if ((await enable.getAttribute('aria-checked')) !== 'true') await enable.click();
    await expect(enable).toHaveAttribute('aria-checked', 'true');
    await consoleCard.getByLabel('Jira base URL').fill(mock.url);
    await consoleCard.getByRole('button', { name: 'Test', exact: true }).click();
    await expect(consoleCard.getByText('Jira answered: version 10.3.1, Jira Data Center or Server.')).toBeVisible({ timeout: 10_000 });
    // The card, not the console: the console was never in the audit, and its
    // own findings are not this card's to carry or to hide.
    await audit(facilitator, testInfo, 'jira-console-card', { scope: consoleCard });
    await consoleCard.getByRole('button', { name: 'Save the Jira settings' }).click();
    await expect(consoleCard.getByText('Jira settings saved')).toBeVisible({ timeout: 10_000 });
    await facilitator.getByRole('button', { name: 'Exit Admin Mode' }).click();
    await expect(facilitator.getByRole('heading', { name: 'Your Teams' })).toBeVisible({ timeout: 10_000 });

    // ---- The team: two backlog actions, then Settings → Jira --------------
    await createTeam(facilitator);
    await addBacklogAction(facilitator, PREVIOUS_ACTION);
    await addBacklogAction(facilitator, REMAINING_ACTION);

    await dashboardTab(facilitator, 'Settings').click();
    const settingsCard = facilitator.getByRole('region', { name: 'Jira', exact: true });
    await expect(settingsCard.getByText('No token saved yet.')).toBeVisible({ timeout: 15_000 });
    await settingsCard.getByLabel('Jira access token').fill(JIRA_MOCK_PAT);
    await settingsCard.getByRole('button', { name: 'Save the token' }).click();
    await expect(settingsCard.getByText(/^Connected to Jira as Retro Bot, set on /)).toBeVisible({ timeout: 15_000 });
    // The token is write-only: nothing on the page holds it any more.
    await expect(facilitator.locator(`input[value="${JIRA_MOCK_PAT}"]`)).toHaveCount(0);

    const projectKey = settingsCard.getByLabel('Project key');
    await projectKey.fill('PROJ');
    await projectKey.press('Enter');
    const issueType = settingsCard.getByLabel('Issue type');
    // The list is read from Jira with the team's token: Task is one of three.
    await expect(issueType.locator('option', { hasText: 'Task' })).toHaveCount(1, { timeout: 10_000 });
    await issueType.selectOption({ label: 'Task' });
    await settingsCard.getByLabel('Labels').fill(LABEL);
    await settingsCard.getByRole('button', { name: 'Save the target' }).click();
    await expect(settingsCard.getByText('Target saved')).toBeVisible({ timeout: 10_000 });
    // The card only, as for the console: the rest of Settings was never audited.
    await audit(facilitator, testInfo, 'jira-settings-card', { scope: settingsCard });

    // ---- A retrospective with a participant, up to Review ------------------
    await dashboardTab(facilitator, 'Actions').click();
    await facilitator.getByRole('button', { name: 'New Retrospective' }).click();
    await facilitator.locator('text=Start, Stop, Continue').first().click();
    await expect(facilitator.getByRole('heading', { name: 'Icebreaker' })).toBeVisible({ timeout: 15_000 });
    const inviteUrl = await readInviteLink(facilitator);
    await joinThroughInvite(participant, inviteUrl);

    await facilitator.getByRole('button', { name: 'BRAINSTORM', exact: true }).click();
    const idea = facilitator.getByRole('textbox', { name: 'Add an idea...' }).first();
    await expect(idea).toBeVisible({ timeout: 15_000 });
    await idea.fill(TICKET);
    await idea.press('Enter');
    await expect(facilitator.getByText(TICKET)).toBeVisible();
    await wait(1_000);

    await facilitator.getByRole('button', { name: 'DISCUSS', exact: true }).click();
    await expect(facilitator.getByText('Discuss & Propose Actions')).toBeVisible({ timeout: 15_000 });
    const proposal = facilitator.getByPlaceholder('Propose an action...').first();
    for (const text of NEW_ACTIONS) {
      await proposal.fill(text);
      await facilitator.getByRole('button', { name: 'Directly Accept Action' }).first().click();
      await expect(facilitator.getByText(`Accepted: ${text}`)).toBeVisible({ timeout: 10_000 });
    }
    await wait(1_000);

    await facilitator.getByRole('button', { name: 'REVIEW', exact: true }).click();
    await expect(facilitator.getByText('Review Actions')).toBeVisible({ timeout: 15_000 });
    await expect(participant.getByText('Review Actions')).toBeVisible({ timeout: 15_000 });
    for (const text of NEW_ACTIONS) await expect(reviewRow(facilitator, text)).toBeVisible({ timeout: 10_000 });
    await expect(reviewRow(facilitator, PREVIOUS_ACTION)).toBeVisible({ timeout: 10_000 });

    // ---- The discovery note: everyone sees it once ----------------------
    // The facilitator's Review step, audited with the note, the batch button
    // and every per-action control on screen.
    await expect(discoveryNote(facilitator)).toBeVisible({ timeout: 15_000 });
    await expect(discoveryNote(facilitator)).toContainText('The “Create in Jira” buttons are just below.');
    const batchButton = facilitator.getByRole('button', { name: 'Create in Jira (2)' });
    await expect(batchButton).toBeVisible({ timeout: 15_000 });
    await expect(facilitator.getByRole('button', { name: `Create in Jira, ${PREVIOUS_ACTION}` })).toBeVisible();
    // The step itself, under the session header: the header and the
    // participants panel are the session's chrome, audited on every other
    // phase by accessibility-audit.spec.ts.
    const reviewStep = facilitator.getByRole('heading', { name: 'Review Actions', level: 2 }).locator('xpath=../..');
    await audit(facilitator, testInfo, 'jira-review-step', { scope: reviewStep });

    // A participant reads that it exists, and never gets a button.
    await expect(discoveryNote(participant)).toBeVisible({ timeout: 15_000 });
    await expect(discoveryNote(participant)).toContainText('Your facilitator can send the actions to Jira.');
    await expect(participant.getByRole('button', { name: /^Create in Jira/ })).toHaveCount(0);
    await discoveryNote(participant).getByRole('button', { name: 'Got it', exact: true }).click();
    await expect(discoveryNote(participant)).toHaveCount(0);
    // The note waits for the team's Jira status before it shows, so "not
    // shown" means something only once that status is in.
    const statusRead = participant.waitForResponse(res => res.url().endsWith('/jira/status') && res.status() === 200);
    await participant.reload();
    await statusRead;
    await expect(participant.getByText('Review Actions')).toBeVisible({ timeout: 15_000 });
    for (const text of NEW_ACTIONS) await expect(reviewRow(participant, text)).toBeVisible({ timeout: 10_000 });
    await wait(500);
    await expect(discoveryNote(participant)).toHaveCount(0);

    // ---- "Create in Jira (2)": preview, confirm, keys --------------------
    await batchButton.click();
    const dialog = facilitator.getByRole('dialog', { name: 'Create the actions in Jira' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('In the project PROJ')).toBeVisible();
    await expect(dialog.getByText(`Labels: ${LABEL}`)).toBeVisible();
    // The preview is what Jira receives: each summary, and a description that
    // names the retrospective and who asked.
    for (const text of NEW_ACTIONS) await expect(dialog.getByText(text, { exact: true })).toBeVisible();
    await expect(dialog.getByText(/Requested in RetroGemini as /).first()).toBeVisible();
    await audit(facilitator, testInfo, 'jira-batch-dialog', { scope: dialog });

    // Kept to send it once more below, as a second click from a stale screen would.
    const firstBatch = facilitator.waitForRequest(req => req.method() === 'POST' && req.url().endsWith('/jira/issues'));
    await dialog.getByRole('button', { name: 'Create 2 issues' }).click();
    await expect(dialog.getByText('2 issues created', { exact: true })).toBeVisible({ timeout: 20_000 });
    const sentBody = (await firstBatch).postDataJSON() as Record<string, unknown>;
    expect(sentBody.actionIds).toHaveLength(2);
    expect(issueCount(mock)).toBe(2);
    const newKeys = NEW_ACTIONS.map(text => keyOf(mock, text));
    for (const key of newKeys) await expect(dialog.getByRole('link', { name: linkName(key) })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);

    // Both browsers show each key on its own action: the participant through
    // the server's patch of the live session, without clicking anything.
    for (const page of [facilitator, participant]) {
      for (const [index, text] of NEW_ACTIONS.entries()) {
        await expect(reviewRow(page, text).getByRole('link', { name: linkName(newKeys[index]) })).toBeVisible({ timeout: 15_000 });
      }
    }

    // ---- A previous action, from its own row ------------------------------
    await facilitator.getByRole('button', { name: `Create in Jira, ${PREVIOUS_ACTION}` }).click();
    await expect.poll(() => issueCount(mock), { timeout: 15_000 }).toBe(3);
    const previousKey = keyOf(mock, PREVIOUS_ACTION);
    for (const page of [facilitator, participant]) {
      await expect(reviewRow(page, PREVIOUS_ACTION).getByRole('link', { name: linkName(previousKey) })).toBeVisible({ timeout: 15_000 });
    }

    // ---- Reload: the team record holds the keys ---------------------------
    for (const page of [facilitator, participant]) {
      await page.reload();
      await expect(page.getByText('Review Actions')).toBeVisible({ timeout: 15_000 });
      for (const [index, text] of NEW_ACTIONS.entries()) {
        await expect(reviewRow(page, text).getByRole('link', { name: linkName(newKeys[index]) })).toBeVisible({ timeout: 15_000 });
      }
      await expect(reviewRow(page, PREVIOUS_ACTION).getByRole('link', { name: linkName(previousKey) })).toBeVisible({ timeout: 15_000 });
    }

    // ---- Never twice -------------------------------------------------------
    // Nothing linked is offered again: no batch button over the new actions,
    // and the only per-action button left is the backlog action nobody sent.
    await expect(facilitator.getByRole('button', { name: /^Create in Jira \(/ })).toHaveCount(0);
    await expect(facilitator.getByRole('button', { name: /^Create in Jira, / })).toHaveCount(1);
    await expect(facilitator.getByRole('button', { name: `Create in Jira, ${REMAINING_ACTION}` })).toBeVisible();
    // And the very request that created them, sent again (a second click
    // from a screen that never learnt the keys), creates nothing: the server
    // re-checks the link under the team's write lock.
    const replay = await facilitator.request.post((await firstBatch).url(), { data: sentBody });
    expect(replay.ok()).toBe(true);
    const replayed = await replay.json() as { results: { status: string; key?: string }[] };
    expect(replayed.results.map(result => result.status)).toEqual(['already_linked', 'already_linked']);
    expect(replayed.results.map(result => result.key).sort()).toEqual([...newKeys].sort());
    expect(issueCount(mock)).toBe(3);

    // ---- The Dashboard's Actions tab --------------------------------------
    await facilitator.getByRole('button', { name: 'Leave the retrospective' }).click();
    await expect(facilitator.getByText(`${TEAM_NAME} Dashboard`)).toBeVisible({ timeout: 15_000 });
    await dismissAnnouncementsIfPresent(facilitator);
    await dashboardTab(facilitator, 'Actions').click();
    for (const [index, text] of NEW_ACTIONS.entries()) {
      await expect(dashboardRow(facilitator, text).getByRole('link', { name: linkName(newKeys[index]) })).toBeVisible({ timeout: 15_000 });
    }
    await expect(dashboardRow(facilitator, PREVIOUS_ACTION).getByRole('link', { name: linkName(previousKey) })).toBeVisible();
    // One open action is not in Jira yet: one to offer, in the batch and on its row.
    await expect(facilitator.getByRole('button', { name: 'Create in Jira (1)' })).toBeVisible({ timeout: 15_000 });
    const remainingButton = dashboardRow(facilitator, REMAINING_ACTION).getByRole('button', { name: `Create in Jira, ${REMAINING_ACTION}` });
    await expect(remainingButton).toBeVisible();
    await audit(facilitator, testInfo, 'jira-dashboard-actions');

    await remainingButton.click();
    await expect.poll(() => issueCount(mock), { timeout: 15_000 }).toBe(4);
    const remainingKey = keyOf(mock, REMAINING_ACTION);
    // The keyboard lands on the new link, which replaces the button.
    await expect(dashboardRow(facilitator, REMAINING_ACTION).getByRole('link', { name: linkName(remainingKey) })).toBeFocused({ timeout: 15_000 });

    await facilitator.reload();
    await expect(facilitator.getByText(`${TEAM_NAME} Dashboard`)).toBeVisible({ timeout: 15_000 });
    await dismissAnnouncementsIfPresent(facilitator);
    await expect(dashboardRow(facilitator, REMAINING_ACTION).getByRole('link', { name: linkName(remainingKey) })).toBeVisible({ timeout: 15_000 });
    await expect(facilitator.getByRole('button', { name: /^Create in Jira/ })).toHaveCount(0);

    // Every issue went where the team said, with the team's label, once each.
    const issues = mock.issues({ label: LABEL });
    expect(issues).toHaveLength(4);
    expect(new Set(issues.map(issue => issue.summary))).toEqual(new Set([...NEW_ACTIONS, PREVIOUS_ACTION, REMAINING_ACTION]));
    for (const issue of issues) {
      expect(issue.projectKey).toBe('PROJ');
      expect(issue.issueTypeId).toBe('10001');
      expect(issue.labels).toEqual([LABEL]);
    }
    // The token travelled as Data Center sends it, and only to the mock.
    const creates = mock.requests().filter(entry => entry.method === 'POST' && entry.path === '/jira/rest/api/2/issue');
    expect(creates).toHaveLength(4);
    for (const entry of creates) expect(entry.headers.authorization).toBe(`Bearer ${JIRA_MOCK_PAT}`);
  });
});
