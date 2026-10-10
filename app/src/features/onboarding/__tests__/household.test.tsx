import { fireEvent, screen } from 'expo-router/testing-library';

import { renderApp, SEED } from '../../../../test-utils/renderApp';
import { failGet } from '../testHelpers';

// DESIGN.md §4.2 Household.

it('shows the signed-in user and the pending invite', async () => {
  await renderApp({ as: 'ian' });
  expect(await screen.findByTestId('screen-household')).toBeTruthy();
  expect(await screen.findByText('Signed in as Ian · you@example.com')).toBeTruthy();
  expect(screen.getByText('Join or start a household')).toBeTruthy();
  expect(screen.getByText('Invites for you')).toBeTruthy();
  expect(await screen.findByText('Carson invited you')).toBeTruthy();
  expect(screen.getByText('Hack Midwest House · 3 members')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Accept invite to Hack Midwest House' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Decline invite to Hack Midwest House' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Create a household' })).toBeTruthy();
});

it('Decline removes the card and shows the empty state', async () => {
  await renderApp({ as: 'ian' });
  await fireEvent.press(await screen.findByTestId(`decline-${SEED.inviteId}`));
  expect(await screen.findByText('No invites yet. Ask someone in your household to invite you@example.com.')).toBeTruthy();
  expect(screen.queryByText('Carson invited you')).toBeNull();
});

it('shows the error state, and Retry loads the invites', async () => {
  const restore = failGet('/me/invites');
  try {
    await renderApp({ as: 'ian' });
    expect(await screen.findByText('Something went wrong.')).toBeTruthy();
  } finally {
    restore();
  }
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Carson invited you')).toBeTruthy();
});

it('Accept joins the household, shows the tabs and a toast', async () => {
  await renderApp({ as: 'ian' });
  await fireEvent.press(await screen.findByTestId(`accept-${SEED.inviteId}`));
  expect(await screen.findByTestId('tab-list')).toBeTruthy();
  expect(await screen.findByText('You joined Hack Midwest House')).toBeTruthy();
});
