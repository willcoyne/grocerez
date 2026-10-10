import { fireEvent, screen } from 'expo-router/testing-library';

import { renderApp } from '../../../../test-utils/renderApp';

// DESIGN.md §4.1 SignIn.

it('shows the SignIn copy', async () => {
  await renderApp({ as: null });
  expect(await screen.findByTestId('screen-signin')).toBeTruthy();
  expect(screen.getByText('GrocerEZ')).toBeTruthy();
  expect(
    screen.getByText(
      'One shared grocery list for your household. Everyone adds what they want, and the app works out what to buy.',
    ),
  ).toBeTruthy();
  expect(screen.getByText('Household invites go to the email on your Google account.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy();
});

it('dev: the Demo users toggle lists the seed users', async () => {
  await renderApp({ as: null });
  await fireEvent.press(await screen.findByTestId('signin-demo-toggle'));
  for (const name of ['Carson', 'Will', 'Maya', 'Ian']) {
    expect(await screen.findByRole('button', { name: `Sign in as ${name}` })).toBeTruthy();
  }
});

it('Continue with Google signs in and lands on Household', async () => {
  await renderApp({ as: null });
  await fireEvent.press(await screen.findByRole('button', { name: 'Continue with Google' }));
  expect(await screen.findByTestId('screen-household')).toBeTruthy();
});
