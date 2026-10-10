import { router } from 'expo-router';
import { act, fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import { ApiError } from '@/api/errors';
import { getMockDb } from '@/api/mock/db';
import * as handler from '@/api/mock/handler';

import { renderApp, SEED } from '../../../../test-utils/renderApp';
import { resetRecurrenceChoice } from '../recurrenceChoice';

// Me tab (DESIGN.md §4.7) against the mock API.

beforeEach(() => resetRecurrenceChoice());
// renderRouter switches to fake timers; drop leftovers (toast hide, dietary debounce) between tests.
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function openMe() {
  await renderApp({ joined: true, initialUrl: '/me' });
  expect(await screen.findByTestId('tab-me')).toBeTruthy();
}

/** Types and submits. With `toast`, also waits for that toast and for the field to clear. */
async function add(text: string, toast?: string) {
  const input = () => screen.getByTestId('me-add-input');
  await fireEvent.changeText(input(), text);
  await fireEvent.press(screen.getByTestId('me-add-button'));
  if (toast) {
    await waitFor(() => expect(toastText().getByText(toast)).toBeTruthy());
    await waitFor(() => expect(input().props.value).toBe(''));
  }
}

const toastText = () => within(screen.getByTestId('toast'));

it('starts empty, with the header, hint, and footnote', async () => {
  await openMe();
  expect(screen.getByText('My preferences')).toBeTruthy();
  expect(await screen.findByText('Hack Midwest House · 4 members')).toBeTruthy();
  expect(
    await screen.findByText('Nothing yet. Add the things you want kept in stock, or just need this week.'),
  ).toBeTruthy();
  expect(screen.getByText('Staples come back on the list every time you run out.')).toBeTruthy();
  expect(screen.getByText("Your allergies are flagged on the household's shopping list, with your name.")).toBeTruthy();
});

it('"cherios" → Did you mean Cheerios? → Yes adds Cheerios as a staple, in the cabinet', async () => {
  await openMe();
  await screen.findByTestId('me-prefs-empty');
  await add('cherios');
  expect(await screen.findByText('Did you mean Cheerios?')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('me-add-suggest-yes'));

  await waitFor(() => expect(toastText().getByText('Added Cheerios as a staple')).toBeTruthy());
  await waitFor(() => expect(screen.getByTestId('me-add-input').props.value).toBe(''));
  const row = within(await screen.findByTestId('row-i-cheerios'));
  expect(row.getByText('Cheerios')).toBeTruthy();
  expect(row.getByText('Staple')).toBeTruthy();
  expect(await row.findByText('In cabinet')).toBeTruthy();
  expect(screen.queryByText('Did you mean Cheerios?')).toBeNull();
  expect(getMockDb().aliases.some((a) => a.itemId === 'i-cheerios')).toBe(true);
});

it('"Cheerios!" matches exactly; adding it twice shows the duplicate toast', async () => {
  await openMe();
  await screen.findByTestId('me-prefs-empty');
  await add('Cheerios!', 'Added Cheerios as a staple');
  expect(await screen.findByTestId('row-i-cheerios')).toBeTruthy();
  expect(screen.queryByText('Did you mean Cheerios?')).toBeNull();

  await add('Cheerios!', 'Cheerios is already on your list');
  expect(screen.getAllByTestId('row-i-cheerios')).toHaveLength(1);
});

it('This week only: adds milk (On the list), persists across tab switches, Make staple, Remove', async () => {
  await openMe();
  await screen.findByTestId('me-prefs-empty');
  await fireEvent.press(screen.getByTestId('me-recurrence-one_time'));
  expect(screen.getByText("One-time items leave your list after they're bought.")).toBeTruthy();

  await add('milk', 'Added Milk for this week');
  const row = await screen.findByTestId('row-i-milk');
  expect(within(row).getByText('This week only')).toBeTruthy();
  expect(within(row).getByText('On the list')).toBeTruthy();

  // The segment choice survives a tab switch.
  await act(async () => router.navigate('/list'));
  await act(async () => router.navigate('/me'));
  expect(screen.getByTestId('me-recurrence-one_time').props.accessibilityState).toMatchObject({ selected: true });

  await fireEvent.press(screen.getByRole('button', { name: 'Make Milk a staple' }));
  await waitFor(() => expect(within(screen.getByTestId('row-i-milk')).getByText('Staple')).toBeTruthy());
  expect(getMockDb().preferences.find((p) => p.itemId === 'i-milk')?.recurrence).toBe('staple');

  await fireEvent.press(screen.getByRole('button', { name: 'Remove Milk' }));
  await waitFor(() => expect(screen.queryByTestId('row-i-milk')).toBeNull());
  expect(toastText().getByText('Removed Milk')).toBeTruthy();
  await waitFor(() => expect(getMockDb().preferences.some((p) => p.itemId === 'i-milk')).toBe(false));
  expect(await screen.findByTestId('me-prefs-empty')).toBeTruthy();
});

it('the segment choice also survives a remount (session state)', async () => {
  await openMe();
  await fireEvent.press(screen.getByTestId('me-recurrence-one_time'));
  await screen.unmount();
  await openMe();
  expect(screen.getByTestId('me-recurrence-one_time').props.accessibilityState).toMatchObject({ selected: true });
});

it('diet and allergy chips toggle optimistically and save after the debounce', async () => {
  await openMe();
  const nuts = await screen.findByRole('button', { name: 'Tree nuts' });
  await fireEvent.press(nuts);
  await fireEvent.press(screen.getByRole('button', { name: 'Vegetarian' }));
  const ian = () => getMockDb().users.find((u) => u.id === SEED.users.ian)!;
  const selected = (name: string) => screen.getByRole('button', { name }).props.accessibilityState?.selected;

  // Optimistic: both chips flip before the debounced PUT has reached the server.
  await waitFor(() => expect(selected('Tree nuts') && selected('Vegetarian')).toBe(true));
  expect(ian().allergens).toEqual([]);
  expect(selected('Peanuts')).toBe(false);

  await waitFor(
    () => {
      expect(ian().allergens).toEqual(['tree_nuts']);
      expect(ian().diets).toEqual(['vegetarian']);
    },
    { timeout: 2000 },
  );
});

it('shows the error state and recovers on Retry', async () => {
  const real = handler.mockRequest;
  let fail = true;
  jest.spyOn(handler, 'mockRequest').mockImplementation((method, path, body, token) => {
    if (fail && method === 'GET' && path.includes('/preferences')) {
      return Promise.reject(new ApiError(400, 'BOOM', 'boom'));
    }
    return real(method, path, body, token);
  });
  await openMe();
  expect(await screen.findByText('Something went wrong.')).toBeTruthy();
  fail = false;
  await fireEvent.press(screen.getByTestId('me-prefs-error-retry'));
  expect(await screen.findByTestId('me-prefs-empty')).toBeTruthy();
});
