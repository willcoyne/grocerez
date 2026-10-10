import { render } from '@testing-library/react-native';
import { act, fireEvent, screen, within } from 'expo-router/testing-library';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { mockRequest, mockTokenFor } from '@/api/mock/handler';

import { renderApp, SEED } from '../../../../test-utils/renderApp';
import { GroupView, type GroupViewProps } from '../GroupView';

const { carson, will, maya, ian } = SEED.users;

describe('Household tab against the mock API', () => {
  it('lists members with "(you)", allergies and roles', async () => {
    await renderApp({ joined: true, initialUrl: '/group' });
    expect(await screen.findByTestId(`member-${carson}`)).toBeTruthy();

    expect(screen.getByText('Hack Midwest House · 4 members')).toBeTruthy();
    expect(within(screen.getByTestId("tab-group")).getByText("Household")).toBeTruthy();
    expect(screen.getByText('Members')).toBeTruthy();

    const c = within(screen.getByTestId(`member-${carson}`));
    expect(c.getByText('Carson')).toBeTruthy();
    expect(c.getByText('Allergic to peanuts')).toBeTruthy();
    expect(c.getByText('Owner')).toBeTruthy();

    const m = within(screen.getByTestId(`member-${maya}`));
    expect(m.getByText('Allergic to milk')).toBeTruthy();
    expect(m.getByText('Member')).toBeTruthy();

    const w = within(screen.getByTestId(`member-${will}`));
    expect(w.getByText('No allergies set')).toBeTruthy();

    const i = within(screen.getByTestId(`member-${ian}`));
    expect(i.getByText('Ian (you)')).toBeTruthy();
    expect(i.getByText('No allergies set')).toBeTruthy();
    expect(i.getByText('Member')).toBeTruthy();
  });

  it("shows everyone's wants grouped by item with cabinet status", async () => {
    await renderApp({ joined: true, initialUrl: '/group' });
    expect(await screen.findByTestId('row-i-oreos')).toBeTruthy();

    expect(screen.getByText("Everyone's wants")).toBeTruthy();
    expect(
      screen.getByText('All preferences combined. Anything here that isn\'t in the cabinet goes on the list.'),
    ).toBeTruthy();

    const expectRow = (itemId: string, name: string, wantedBy: string, chip: string) => {
      const row = within(screen.getByTestId(`row-${itemId}`));
      expect(row.getByText(name)).toBeTruthy();
      expect(row.getByText(`Wanted by ${wantedBy}`)).toBeTruthy();
      expect(row.getByText(chip)).toBeTruthy();
    };
    expectRow('i-oreos', 'Oreos', 'Carson, Maya', 'On the list'); // running_low is not in stock
    expectRow('i-lays', "Lay's", 'Carson, Maya', 'On the list');
    expectRow('i-tostitos', 'Tostitos', 'Will', 'On the list');
    expectRow('i-cheerios', 'Cheerios', 'Will', 'In cabinet');
    expect(screen.queryByTestId('wants-empty')).toBeNull();
  });

  it('says "you" when the current user wants an item', async () => {
    await renderApp({ joined: true, initialUrl: '/group' });
    expect(await screen.findByTestId('row-i-cheerios')).toBeTruthy();
    await act(async () => {
      await mockRequest(
        'POST',
        `/groups/${SEED.groupId}/preferences`,
        { itemId: 'i-cheerios', recurrence: 'staple' },
        mockTokenFor(ian),
      );
    });
    expect(await screen.findByText('Wanted by Will, you')).toBeTruthy();
  });

  it('"Invite someone" opens the invite screen', async () => {
    await renderApp({ joined: true, initialUrl: '/group' });
    const button = await screen.findByRole('button', { name: 'Invite someone' });
    await fireEvent.press(button);
    expect(await screen.findByTestId('screen-invite')).toBeTruthy();
  });

  it('shows the pending invite count', async () => {
    // Before Ian accepts, Carson's household has one pending invite (Ian's).
    await renderApp({ as: 'carson', initialUrl: '/group' });
    expect(await screen.findByTestId(`member-${carson}`)).toBeTruthy();
    expect(await screen.findByText('Invite someone · 1 pending')).toBeTruthy();
  });
});

describe('GroupView states', () => {
  const base: GroupViewProps = {
    groupName: 'Home',
    memberCount: 1,
    status: 'ready',
    members: [{ id: 'u1', name: 'Ian (you)', displayName: 'Ian', allergyLine: 'No allergies set', roleLabel: 'Owner' }],
    wants: [],
    pendingInvites: 0,
    onInvite: jest.fn(),
    onRetry: jest.fn(),
  };
  const renderView = async (props: Partial<GroupViewProps>) =>
    render(
      <SafeAreaProvider
        initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <GroupView {...base} {...props} />
      </SafeAreaProvider>,
    );

  it('loading', async () => {
    const r = await renderView({ status: 'loading', members: null, wants: null });
    expect(r.getByTestId('tab-group')).toBeTruthy();
    expect(r.getByTestId('loading-state')).toBeTruthy();
    expect(r.queryByText('Members')).toBeNull();
  });

  it('error → Retry', async () => {
    const onRetry = jest.fn();
    const r = await renderView({ status: 'error', members: null, wants: null, onRetry });
    expect(r.getByText('Something went wrong.')).toBeTruthy();
    await fireEvent.press(r.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('empty wants', async () => {
    const r = await renderView({});
    expect(r.getByText('No one has added preferences yet.')).toBeTruthy();
    expect(r.getByText('Ian (you)')).toBeTruthy();
    expect(r.getByText('Invite someone')).toBeTruthy();
  });
});
