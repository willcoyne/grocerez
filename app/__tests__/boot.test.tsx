import { screen } from 'expo-router/testing-library';

import { renderApp } from '../test-utils/renderApp';

// Phase 0 gate: the app boots in mock mode and the route guard sends each user to the right place.

it('signed out → SignIn', async () => {
  await renderApp({ as: null });
  expect(await screen.findByTestId('screen-signin')).toBeTruthy();
});

it('signed in with no groups → Household (onboarding)', async () => {
  await renderApp({ as: 'ian' });
  expect(await screen.findByTestId('screen-household')).toBeTruthy();
});

it('signed in with a group → List tab', async () => {
  await renderApp({ as: 'ian', joined: true });
  expect(await screen.findByTestId('tab-list')).toBeTruthy();
});
