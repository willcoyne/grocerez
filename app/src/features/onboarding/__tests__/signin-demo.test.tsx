import { fireEvent, screen } from 'expo-router/testing-library';

import { renderApp } from '../../../../test-utils/renderApp';

// DESIGN.md §4.1: a __DEV__ demo user signs in through /dev/login-as/:id.

it('signing in as Carson (already in a household) lands on the List tab', async () => {
  await renderApp({ as: null });
  await fireEvent.press(await screen.findByTestId('signin-demo-toggle'));
  await fireEvent.press(await screen.findByRole('button', { name: 'Sign in as Carson' }));
  expect(await screen.findByTestId('tab-list')).toBeTruthy();
});
