import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import { renderApp } from '../test-utils/renderApp';

// End-to-end walk of the board's product loop in mock mode (DESIGN.md §8 Phase 2).
// RNTL 14: fireEvent is async, so every call is awaited.

jest.setTimeout(30_000);

/** Item IDs of the visible list/cabinet/me rows, in render order. */
const rowIds = () =>
  screen
    .queryAllByTestId(/^row-i-[a-z-]+$/)
    .map((el) => el.props.testID as string)
    .filter((id) => !/-(check|syncing|meta|status|low|instock|ranout|recurrence|remove)$/.test(id))
    .map((id) => id.replace(/^row-/, ''));

async function openTab(name: 'list' | 'cabinet' | 'me' | 'group') {
  await fireEvent.press(screen.getByTestId(`tabbar-${name}`));
  return screen.findByTestId(`tab-${name}`);
}

async function addItem(field: string, text: string) {
  await fireEvent.changeText(screen.getByTestId(`${field}-input`), text);
  await fireEvent.press(screen.getByTestId(`${field}-button`));
}

it('runs the full loop: sign in → invite → list → trip → cabinet → ran out → fuzzy add → allergy flag', async () => {
  // 1. sign in
  await renderApp({ as: null });
  await fireEvent.press(await screen.findByTestId('signin-google'));

  // 2. accept the invite
  expect(await screen.findByTestId('screen-household')).toBeTruthy();
  await fireEvent.press(await screen.findByTestId('accept-inv-ian'));
  expect(await screen.findByTestId('tab-list')).toBeTruthy();
  expect(await screen.findByText('You joined Hack Midwest House')).toBeTruthy();

  // 3. the list is exactly Lay's, Oreos, Tostitos (aisle order), Oreos running low at home
  await screen.findByTestId('row-i-lays');
  expect(rowIds()).toEqual(['i-lays', 'i-oreos', 'i-tostitos']);
  expect(within(screen.getByTestId('row-i-oreos')).getByText('Running low at home')).toBeTruthy();

  // 4. check Lay's and Tostitos, finish the trip → both in the cabinet as In stock
  await fireEvent.press(screen.getByTestId('row-i-lays-check'));
  await fireEvent.press(screen.getByTestId('row-i-tostitos-check'));
  await waitFor(() => expect(screen.getByText('Finish trip · move 2 to the cabinet')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('finish-trip'));
  expect(await screen.findByText('2 items moved to the cabinet')).toBeTruthy();
  await waitFor(() => expect(rowIds()).toEqual(['i-oreos']));

  await openTab('cabinet');
  await screen.findByTestId('row-i-lays');
  for (const id of ['i-lays', 'i-tostitos']) {
    expect(within(screen.getByTestId(`row-${id}`)).getByText('In stock')).toBeTruthy();
  }

  // 5. Oreos → Ran out → requeued (back on the list)
  await fireEvent.press(screen.getByTestId('row-i-oreos-ranout'));
  expect(await screen.findByText('Oreos is back on the shopping list')).toBeTruthy();
  await waitFor(() => expect(screen.queryByTestId('row-i-oreos')).toBeNull());
  await openTab('list');
  await waitFor(() => expect(rowIds()).toContain('i-oreos'));

  // 6. add "cherios" on the Me tab → suggestion → Yes
  await openTab('me');
  await addItem('me-add', 'cherios');
  expect(await screen.findByText('Did you mean Cheerios?')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('me-add-suggest-yes'));
  expect(await screen.findByText('Added Cheerios as a staple')).toBeTruthy();
  expect(await screen.findByTestId('row-i-cheerios')).toBeTruthy();

  // 7. set the milk allergy → a Milk row shows "Contains milk · you"
  await fireEvent.press(screen.getByTestId('allergen-milk'));
  await openTab('list');
  await addItem('list-add', 'milk');
  expect(await screen.findByText('Added Milk to the shopping list')).toBeTruthy();
  const milk = await screen.findByTestId('row-i-milk');
  await waitFor(() => expect(within(milk).getByText('Contains milk · you')).toBeTruthy(), { timeout: 3000 });
  expect(within(screen.getByTestId('row-i-milk')).getByText('Contains milk · Maya')).toBeTruthy();
});
