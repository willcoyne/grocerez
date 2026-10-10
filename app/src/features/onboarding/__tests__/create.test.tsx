import { fireEvent, screen } from 'expo-router/testing-library';

import { renderApp } from '../../../../test-utils/renderApp';
import { flush } from '../testHelpers';

// DESIGN.md §4.3 Create (→ §4.4 Invite from onboarding).

it('Back returns to Household', async () => {
  await renderApp({ as: 'ian' });
  await fireEvent.press(await screen.findByRole('button', { name: 'Create a household' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
  expect(await screen.findByTestId('screen-household')).toBeTruthy();
});

it('an empty name becomes "Our house", then Invite → Continue to the app', async () => {
  await renderApp({ as: 'ian' });
  await fireEvent.press(await screen.findByRole('button', { name: 'Create a household' }));
  expect(await screen.findByTestId('screen-create')).toBeTruthy();
  expect(screen.getByText('Name your household')).toBeTruthy();
  expect(screen.getByText("You'll be the owner. You can invite people on the next screen.")).toBeTruthy();
  expect(screen.getByTestId('create-name').props.value).toBe('Our house');

  await fireEvent.changeText(screen.getByTestId('create-name'), '   ');
  await flush();
  await fireEvent.press(screen.getByRole('button', { name: 'Create household' }));

  expect(await screen.findByTestId('screen-invite')).toBeTruthy();
  expect(await screen.findByText('Our house')).toBeTruthy();
  expect(await screen.findByText('No pending invites yet.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Continue to the app' }));
  expect(await screen.findByTestId('tab-list')).toBeTruthy();
});
