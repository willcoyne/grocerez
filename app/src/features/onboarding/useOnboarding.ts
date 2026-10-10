import type { Invite, MyInvite, User } from '@contracts/models';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { ApiError } from '@/api/client';
import { useCreateGroup } from '@/api/hooks/useGroup';
import { useInvites, useRevokeInvite, useSendInvite } from '@/api/hooks/useInvites';
import { useMe } from '@/api/hooks/useMe';
import { useAcceptInvite, useDeclineInvite, useMyInvites } from '@/api/hooks/useMyInvites';
import { SEED } from '@/api/mock/db';
import { useToast } from '@/components/ui';
import { humanize, isEmail } from '@/lib/format';
import { useActiveGroup } from '@/state/ActiveGroupContext';
import { useAuth } from '@/state/AuthContext';

/**
 * Screen controllers for DESIGN.md §4.1–4.4. Each returns the props of its presentational View
 * (SignInView, HouseholdView, CreateView, InviteView), so route files stay one line.
 */

export type LoadStatus = 'pending' | 'error' | 'success';

const DEFAULT_HOUSEHOLD_NAME = 'Our house';

function messageFor(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong.';
}

// ---- §4.1 SignIn ----------------------------------------------------------------------------

export type DemoUser = { id: string; name: string };

export type SignInViewProps = {
  /** 'google', a demo user id, or null when idle. */
  busy: string | null;
  onGoogle: () => void;
  /** Empty outside __DEV__. */
  demoUsers: DemoUser[];
  onDemoUser: (id: string) => void;
};

const DEMO_USERS: DemoUser[] = Object.entries(SEED.users).map(([key, id]) => ({ id, name: humanize(key) }));

export function useSignIn(): SignInViewProps {
  const { signInWithGoogle, signInAs } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await action(); // the route guard takes over once the token is stored
    } catch (e) {
      toast.show(messageFor(e));
    } finally {
      setBusy(null);
    }
  };

  return {
    busy,
    onGoogle: () => void run('google', signInWithGoogle),
    demoUsers: __DEV__ ? DEMO_USERS : [],
    onDemoUser: (id) => void run(id, () => signInAs(id)),
  };
}

// ---- §4.2 Household -------------------------------------------------------------------------

export type HouseholdViewProps = {
  user: User | undefined;
  invites: MyInvite[] | undefined;
  status: LoadStatus;
  onRetry: () => void;
  acceptingId: string | null;
  onAccept: (invite: MyInvite) => void;
  onDecline: (invite: MyInvite) => void;
  onCreate: () => void;
};

export function useHousehold(): HouseholdViewProps {
  const me = useMe();
  const invites = useMyInvites();
  const accept = useAcceptInvite();
  const decline = useDeclineInvite();
  const toast = useToast();
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const onAccept = async (invite: MyInvite) => {
    if (acceptingId) return;
    setAcceptingId(invite.id);
    try {
      const group = await accept.mutateAsync({ inviteId: invite.id });
      toast.show(`You joined ${group.name}`);
      router.replace('/list');
    } catch (e) {
      toast.show(messageFor(e));
    } finally {
      setAcceptingId(null);
    }
  };

  return {
    user: me.data,
    invites: invites.data,
    status: invites.status,
    onRetry: () => void invites.refetch(),
    acceptingId,
    onAccept: (invite) => void onAccept(invite),
    onDecline: (invite) => decline.mutate({ inviteId: invite.id }, { onError: (e) => toast.show(messageFor(e)) }),
    onCreate: () => router.push('/create'),
  };
}

// ---- §4.3 Create ----------------------------------------------------------------------------

export type CreateViewProps = {
  name: string;
  onChangeName: (name: string) => void;
  onSubmit: () => void;
  busy: boolean;
  onBack: () => void;
};

export function useCreateHousehold(): CreateViewProps {
  const create = useCreateGroup();
  const toast = useToast();
  const [name, setName] = useState(DEFAULT_HOUSEHOLD_NAME);

  const onSubmit = async () => {
    if (create.isPending) return;
    try {
      await create.mutateAsync({ name: name.trim() || DEFAULT_HOUSEHOLD_NAME });
      router.replace('/invite?from=onboarding');
    } catch (e) {
      toast.show(messageFor(e));
    }
  };

  return {
    name,
    onChangeName: setName,
    onSubmit: () => void onSubmit(),
    busy: create.isPending,
    onBack: () => (router.canGoBack() ? router.back() : router.replace('/household')),
  };
}

// ---- §4.4 Invite ----------------------------------------------------------------------------

export type InviteViewProps = {
  groupName: string | undefined;
  email: string;
  onChangeEmail: (email: string) => void;
  error: string | null;
  sending: boolean;
  onSubmit: () => void;
  invites: Invite[] | undefined;
  status: LoadStatus;
  onRetry: () => void;
  canRevoke: (invite: Invite) => boolean;
  onRevoke: (invite: Invite) => void;
  fromOnboarding: boolean;
  onFinish: () => void;
};

export function useInviteScreen(): InviteViewProps {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { activeGroup } = useActiveGroup();
  const me = useMe();
  const invites = useInvites();
  const send = useSendInvite();
  const revoke = useRevokeInvite();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fromOnboarding = from === 'onboarding';

  const onSubmit = async () => {
    if (send.isPending) return;
    const value = email.trim().toLowerCase();
    if (!isEmail(value)) return setError('Enter a full email address, like name@example.com');
    if (invites.data?.some((i) => i.email.toLowerCase() === value)) return setError(`You already invited ${value}`);
    try {
      await send.mutateAsync({ email: value });
      setEmail('');
      setError(null);
      toast.show(`Invited ${value}. They'll see it when they sign in.`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ALREADY_MEMBER') setError("They're already in this household.");
      else toast.show(messageFor(e));
    }
  };

  return {
    groupName: activeGroup?.name,
    email,
    onChangeEmail: (value) => {
      setEmail(value);
      if (error) setError(null);
    },
    error,
    sending: send.isPending,
    onSubmit: () => void onSubmit(),
    invites: invites.data,
    status: invites.status,
    onRetry: () => void invites.refetch(),
    canRevoke: (invite) => activeGroup?.role === 'owner' || (!!me.data && invite.invitedBy?.id === me.data.id),
    onRevoke: (invite) =>
      revoke.mutate(
        { inviteId: invite.id },
        {
          onSuccess: () => toast.show(`Invite to ${invite.email} revoked`),
          onError: (e) => toast.show(messageFor(e)),
        },
      ),
    fromOnboarding,
    onFinish: () => {
      if (fromOnboarding) router.replace('/list');
      else if (router.canGoBack()) router.back();
      else router.replace('/group');
    },
  };
}
