import { act, fireEvent, screen, waitFor } from 'expo-router/testing-library';

import { mockRequest, mockTokenFor } from '@/api/mock/handler';

import { renderApp, SEED } from '../../../../test-utils/renderApp';
import { failGet, flush } from '../testHelpers';

// DESIGN.md §4.4 Invite (opened from the Household tab, so the bottom button is "Done").

async function submit(email: string) {
  await fireEvent.changeText(screen.getByTestId('invite-email-input'), email);
  await flush();
  await fireEvent.press(screen.getByTestId('invite-email-button'));
}

/** Another user sends an invite while this screen is open (arrives via the invites:changed event). */
async function inviteAs(userId: string, email: string) {
  await act(async () => {
    await mockRequest('POST', `/groups/${SEED.groupId}/invites`, { email }, mockTokenFor(userId));
  });
}

const BAD_EMAIL = 'Enter a full email address, like name@example.com';

it('validates, sends, de-dupes, rejects members, and revokes', async () => {
  await renderApp({ as: 'ian', joined: true, initialUrl: '/invite' });
  expect(await screen.findByTestId('screen-invite')).toBeTruthy();
  expect(await screen.findByText('Hack Midwest House')).toBeTruthy();
  expect(screen.getByText('Invite your household')).toBeTruthy();
  expect(await screen.findByText('No pending invites yet.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();

  await submit('not-an-email');
  expect(await screen.findByText(BAD_EMAIL)).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId('invite-email-input'), 'new@');
  await waitFor(() => expect(screen.queryByText(BAD_EMAIL)).toBeNull());

  await submit('New@Example.com ');
  expect(await screen.findByText("Invited new@example.com. They'll see it when they sign in.")).toBeTruthy();
  expect(await screen.findByText('new@example.com')).toBeTruthy();
  expect(screen.getByText('Waiting for them to sign in')).toBeTruthy();
  expect(screen.getByTestId('invite-email-input').props.value).toBe('');

  await submit('new@example.com');
  expect(await screen.findByText('You already invited new@example.com')).toBeTruthy();

  await submit('carson@example.com');
  expect(await screen.findByText("They're already in this household.")).toBeTruthy();

  // Ian sent it, so he may revoke it.
  await fireEvent.press(screen.getByRole('button', { name: 'Revoke invite to new@example.com' }));
  expect(await screen.findByText('Invite to new@example.com revoked')).toBeTruthy();
  expect(await screen.findByText('No pending invites yet.')).toBeTruthy();
});

it("a member doesn't see Revoke on someone else's invite", async () => {
  // Seed: Carson (owner) invited you@example.com.
  await renderApp({ as: 'will', initialUrl: '/invite' });
  expect(await screen.findByText('you@example.com')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Revoke invite to you@example.com' })).toBeNull();
});

it('the owner sees Revoke on every invite, including ones others sent', async () => {
  await renderApp({ as: 'carson', initialUrl: '/invite' });
  expect(await screen.findByText('you@example.com')).toBeTruthy();
  await inviteAs(SEED.users.will, 'y@example.com');
  expect(await screen.findByText('y@example.com')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Revoke invite to you@example.com' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Revoke invite to y@example.com' })).toBeTruthy();
});

it('shows the error state for pending invites', async () => {
  const restore = failGet(`/groups/${SEED.groupId}/invites`);
  try {
    await renderApp({ as: 'carson', initialUrl: '/invite' });
    expect(await screen.findByText('Something went wrong.')).toBeTruthy();
  } finally {
    restore();
  }
});
