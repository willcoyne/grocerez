import { fireEvent, screen, waitFor, within } from 'expo-router/testing-library';

import { ApiError } from '@/api/client';
import * as handler from '@/api/mock/handler';

import { renderApp } from '../../../../test-utils/renderApp';

// DESIGN.md §4.5 "Done when" checks for the List tab, against the mock API.

// Not jest.restoreAllMocks(): that would also wipe the SecureStore jest.fn mocks from jest.setup.ts.
let restoreApi: (() => void) | null = null;
// renderRouter switches to fake timers; drop leftovers (e.g. the toast's hide timer) between tests.
afterEach(() => {
  restoreApi?.();
  restoreApi = null;
  jest.clearAllTimers();
  jest.useRealTimers();
});

async function openList() {
  await renderApp({ joined: true });
  return screen.findByTestId('row-i-lays');
}

it('shows the golden list in server order with meta, chips and summary', async () => {
  await openList();
  expect(screen.getByTestId('tab-list')).toBeTruthy();
  expect(screen.getByText('Shopping list')).toBeTruthy();
  expect(await screen.findByText('Hack Midwest House · 4 members')).toBeTruthy();

  const rowIds = screen.getAllByTestId(/^row-i-[a-z]+$/).map((n) => n.props.testID);
  expect(rowIds).toEqual(['row-i-lays', 'row-i-oreos', 'row-i-tostitos']);

  expect(screen.getByTestId('list-summary')).toHaveTextContent('3 to buy · 0 in the cart');
  expect(within(screen.getByTestId('row-i-lays')).getByText('For Carson, Maya')).toBeTruthy();
  expect(await within(screen.getByTestId('row-i-oreos')).findByText('Running low at home')).toBeTruthy();
  expect(within(screen.getByTestId('row-i-lays')).queryByText('Running low at home')).toBeNull();

  const finish = screen.getByTestId('finish-trip');
  expect(within(finish).getByText('Check items off as you shop')).toBeTruthy();
  expect(finish).toBeDisabled();
});

it('checks off a row optimistically, then finishes the trip', async () => {
  await openList();
  await fireEvent.press(screen.getByLabelText("Check off Lay's"));

  expect(await screen.findByLabelText("Uncheck Lay's")).toBeTruthy();
  expect(within(screen.getByTestId('row-i-lays')).getByText('In the cart · checked by you')).toBeTruthy();
  expect(screen.getByTestId('list-summary')).toHaveTextContent('2 to buy · 1 in the cart');
  expect(await screen.findByText('Finish trip · move 1 to the cabinet')).toBeTruthy();
  // No sync dot once the PATCH has settled.
  expect(screen.queryByTestId(/-syncing$/)).toBeNull();

  await fireEvent.press(screen.getByTestId('finish-trip'));
  expect(await screen.findByText('1 item moved to the cabinet')).toBeTruthy();
  await waitFor(() => expect(screen.queryByTestId('row-i-lays')).toBeNull());
  expect(screen.getByTestId('row-i-oreos')).toBeTruthy();
});

it('shows the empty state once everything is bought', async () => {
  await openList();
  for (const name of ["Lay's", 'Oreos', 'Tostitos']) {
    await fireEvent.press(screen.getByLabelText(`Check off ${name}`));
    await screen.findByLabelText(`Uncheck ${name}`);
  }
  expect(await screen.findByText('Finish trip · move 3 to the cabinet')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('finish-trip'));

  expect(await screen.findByText('3 items moved to the cabinet')).toBeTruthy();
  expect(
    await screen.findByText('Nothing to buy. Everything you all want is already in the cabinet.'),
  ).toBeTruthy();
  expect(screen.queryByTestId('list-summary')).toBeNull();
  expect(screen.getByTestId('finish-trip')).toBeDisabled();
});

it('adds by hand with allergen flags, and reports duplicates', async () => {
  await openList();
  const input = screen.getByTestId('list-add-input');
  expect(screen.getByText('Out of something? Add it to the list')).toBeTruthy();
  expect(input.props.placeholder).toBe('e.g. paper towels');

  await fireEvent.changeText(input, 'milk');
  await fireEvent(input, 'submitEditing');
  expect(await screen.findByText('Added Milk to the shopping list')).toBeTruthy();

  const milk = await screen.findByTestId('row-i-milk');
  expect(within(milk).getByText("Not in anyone's preferences")).toBeTruthy();
  expect(within(milk).getByText('Contains milk · Maya')).toBeTruthy();
  expect(within(milk).getByText('Added by hand')).toBeTruthy();

  await fireEvent.changeText(screen.getByTestId('list-add-input'), 'oreos');
  await fireEvent.press(screen.getByTestId('list-add-button'));
  expect(await screen.findByText('Oreos is already on the list')).toBeTruthy();
});

it('shows the error state and recovers on Retry', async () => {
  const real = handler.mockRequest;
  let failing = true;
  const spy = jest.spyOn(handler, 'mockRequest').mockImplementation((method, path, body, token) => {
    if (failing && method === 'GET' && /\/shopping-list$/.test(path)) {
      return Promise.reject(new ApiError(400, 'BAD', 'boom'));
    }
    return real(method, path, body, token);
  });
  restoreApi = () => spy.mockRestore();

  await renderApp({ joined: true });
  expect(await screen.findByText('Something went wrong.')).toBeTruthy();
  expect(screen.queryByTestId('finish-bar')).toBeNull();

  failing = false;
  await fireEvent.press(screen.getByTestId('list-error-retry'));
  expect(await screen.findByTestId('row-i-lays')).toBeTruthy();
});
