import { fireEvent, screen, within } from 'expo-router/testing-library';

import { ApiError } from '@/api/errors';
import * as handler from '@/api/mock/handler';

import { renderApp } from '../../../../test-utils/renderApp';
import { CABINET_EMPTY_COPY } from '../CabinetView';

// DESIGN.md §4.6 "Done when" checks for the Cabinet tab, against the mock API.
// RNTL 14: fireEvent is async — always await it, or act() scopes overlap and break later tests.

const open = () => renderApp({ joined: true, initialUrl: '/cabinet' });
const toast = async (text: string) => expect(await screen.findByText(text)).toBeTruthy();

afterEach(() => jest.restoreAllMocks());

it('shows the seeded rows in server order with chips, meta and summary', async () => {
  await open();
  expect(await screen.findByTestId('row-i-cheerios')).toBeTruthy();
  expect(screen.getByTestId('tab-cabinet')).toBeTruthy();
  expect(screen.getByRole('header', { name: 'Cabinet' })).toBeTruthy();
  expect(screen.getByText('Hack Midwest House · 4 members')).toBeTruthy();
  expect(screen.getByTestId('cabinet-summary')).toHaveTextContent('2 items in the house');

  const cheerios = within(screen.getByTestId('row-i-cheerios'));
  expect(cheerios.getByText('Cheerios')).toBeTruthy();
  expect(cheerios.getByText('Pantry')).toBeTruthy();
  expect(cheerios.getByText('In stock')).toBeTruthy();

  const oreos = within(screen.getByTestId('row-i-oreos'));
  expect(oreos.getByText('Snacks · also on the shopping list')).toBeTruthy();
  expect(oreos.getByText('Running low')).toBeTruthy();
  expect(oreos.getByRole('button', { name: 'Oreos ran out' })).toBeTruthy();

  const ids = screen.getAllByTestId(/^row-i-[a-z]+$/).map((n) => n.props.testID);
  expect(ids).toEqual(['row-i-cheerios', 'row-i-oreos']);
});

it('Running low on a wanted item → toast "…so it\'s on the list"; Back in stock flips the chip', async () => {
  await open();
  await fireEvent.press(await screen.findByTestId('row-i-cheerios-low'));
  await toast("Cheerios is running low, so it's on the list");
  expect(await within(screen.getByTestId('row-i-cheerios')).findByText('Pantry · also on the shopping list')).toBeTruthy();
  expect(within(screen.getByTestId('row-i-cheerios')).getByText('Running low')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('row-i-oreos-instock'));
  expect(await within(screen.getByTestId('row-i-oreos')).findByText('In stock')).toBeTruthy();
  expect(within(screen.getByTestId('row-i-oreos')).getByText('Snacks')).toBeTruthy();
});

it('Ran out on a wanted item → "{name} is back on the shopping list"', async () => {
  await open();
  await fireEvent.press(await screen.findByTestId('row-i-oreos-ranout'));
  await toast('Oreos is back on the shopping list');
  await screen.findByText('1 item in the house');
  expect(screen.queryByTestId('row-i-oreos')).toBeNull();
});

it('add rice → toast; Running low on unwanted → "Marked…"; Ran out → prompt → Add to list', async () => {
  await open();
  await fireEvent.changeText(await screen.findByTestId('cabinet-add-input'), 'rice');
  await fireEvent.press(screen.getByTestId('cabinet-add-button'));
  await toast('Rice is in the cabinet');
  expect(await screen.findByTestId('row-i-rice')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('row-i-rice-low'));
  await toast('Marked Rice running low');
  expect(within(screen.getByTestId('row-i-rice')).getByText('Pantry')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('row-i-rice-ranout'));
  expect(
    await screen.findByText('Nobody has Rice in their preferences. Add it to the shopping list anyway?'),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('ranout-prompt-add'));
  await toast('Rice added to the shopping list');
  expect(screen.queryByTestId('ranout-prompt')).toBeNull();
});

it('ran-out prompt "No thanks" dismisses it', async () => {
  await open();
  await fireEvent.changeText(await screen.findByTestId('cabinet-add-input'), 'rice');
  await fireEvent.press(screen.getByTestId('cabinet-add-button'));
  await fireEvent.press(await screen.findByTestId('row-i-rice-ranout'));
  expect(await screen.findByTestId('ranout-prompt')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('ranout-prompt-dismiss'));
  expect(screen.queryByTestId('ranout-prompt')).toBeNull();
});

it('empty state after everything runs out', async () => {
  await open();
  await fireEvent.press(await screen.findByTestId('row-i-oreos-ranout'));
  await screen.findByText('1 item in the house');
  await fireEvent.press(screen.getByTestId('row-i-cheerios-ranout'));
  expect(await screen.findByText(CABINET_EMPTY_COPY)).toBeTruthy();
  expect(screen.getByText('0 items in the house')).toBeTruthy();
  expect(screen.getByTestId('cabinet-add-input')).toBeTruthy();
});

it('error state with Retry', async () => {
  const real = handler.mockRequest;
  let fail = true;
  jest.spyOn(handler, 'mockRequest').mockImplementation(async (method, path, body, token) => {
    if (fail && method === 'GET' && /\/cabinet$/.test(path)) throw new ApiError(400, 'BAD', 'boom');
    return real(method, path, body, token);
  });
  await open();
  expect(await screen.findByText('Something went wrong.')).toBeTruthy();
  fail = false;
  await fireEvent.press(screen.getByTestId('error-state-retry'));
  expect(await screen.findByTestId('row-i-cheerios')).toBeTruthy();
});
