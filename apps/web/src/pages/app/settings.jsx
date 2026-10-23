import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ROLE_DESCRIPTION, ROLES, roleAllows } from '@jky/shared';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { ErrorState, PageHeader, Section, Skeleton } from '@/components/ui/primitives';
import { useCrumbs, useCurrentWorkspace } from '@/components/layout/workspace';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useInvalidate, useInvitations, useMembers } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import { dateTime } from '@/lib/format';
import { useConfirm } from '@/components/ui/confirm';

/** @import { Role, UserDTO } from '@jky/shared' */
/** @import { ThemePref } from '@/lib/theme' */

function Profile() {
  const { user, signOut } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.name ?? '');
  const save = useMutation({
    mutationFn: async () =>
      (await /** @type {Promise<import('@/lib/api').Envelope<UserDTO>>} */ (api.patch('/auth/me', { name })))
        .data,
    onSuccess: (u) => {
      qc.setQueryData(['me'], u);
      toast.success('Profile saved');
    },
    onError: (e) => toast.error(/** @type {Error} */ (e).message),
  });
  const revoke = useMutation({
    mutationFn: () => api.post('/auth/logout-all'),
    onSuccess: async () => {
      await signOut().catch(() => undefined);
      navigate('/login');
    },
  });
  return (
    <div className="space-y-6">
      <Section title="Profile">
        <div className="grid max-w-xl gap-4">
          <Field label="Name">
            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Email" hint="Email cannot be changed.">
            {(id) => <Input id={id} value={user?.email ?? ''} disabled />}
          </Field>
          <div>
            <Button
              variant="primary"
              disabled={!name.trim() || name === user?.name}
              loading={save.isPending}
              onClick={() => save.mutate()}
            >
              Save profile
            </Button>
          </div>
        </div>
      </Section>
      <Section
        title="Sessions"
        description="Signing out everywhere revokes every active session for your account, including this one."
      >
        <Button variant="danger" loading={revoke.isPending} onClick={() => revoke.mutate()}>
          Sign out everywhere
        </Button>
      </Section>
    </div>
  );
}

function Appearance() {
  const { pref, setPref } = useTheme();
  const qc = useQueryClient();
  /** @param {ThemePref} p */
  const save = (p) => {
    setPref(p);
    api
      .patch('/auth/me', { preferences: { theme: p } })
      .then((r) => qc.setQueryData(['me'], r.data))
      .catch(() => undefined);
  };
  return (
    <Section title="Appearance" description="Stored in this browser and on your profile.">
      <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Theme">
        {
          /** @type {const} */ (['system', 'light', 'dark']).map((p) => (
            <label
              key={p}
              className={`flex cursor-pointer items-center gap-2 rounded-md border px-4 py-3 text-sm capitalize ${pref === p ? 'border-accent bg-accent-soft' : 'border-line'}`}
            >
              <input
                type="radio"
                name="theme"
                checked={pref === p}
                onChange={() => save(p)}
                className="accent-[var(--accent)]"
              />
              {p === 'system' ? 'Match system' : p}
            </label>
          ))
        }
      </div>
    </Section>
  );
}

function Workspace() {
  const { current } = useCurrentWorkspace();
  const { user } = useAuth();
  const members = useMembers(current?.id);
  const inv = useInvalidate();
  const [name, setName] = useState(current?.name ?? '');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(/** @type {Role} */ ('VIEWER'));
  useEffect(() => setName(current?.name ?? ''), [current?.name]);
  const isAdmin = current ? roleAllows(current.role, 'members.manage') : false;
  const confirm = useConfirm();
  const rename = useMutation({
    mutationFn: () => api.patch(`/workspaces/${current.id}`, { name }),
    onSuccess: async () => {
      toast.success('Workspace renamed');
      await inv(['workspaces']);
    },
    onError: (e) => toast.error(/** @type {Error} */ (e).message),
  });
  const invite = useMutation({
    mutationFn: () => api.post(`/workspaces/${current.id}/invitations`, { email, role }),
    onSuccess: async () => {
      toast.success(`Invited ${email}`);
      setEmail('');
      await inv(['members', current.id]);
    },
    onError: (e) => toast.error(/** @type {Error} */ (e).message),
  });
  const changeRole = useMutation({
    /** @param {{ id: string; r: Role }} props */
    mutationFn: ({ id, r }) => api.patch(`/workspaces/${current.id}/members/${id}`, { role: r }),
    onSuccess: async () => {
      toast.success('Role updated');
      await inv(['members', current.id]);
    },
    onError: (e) => toast.error(/** @type {Error} */ (e).message),
  });
  const remove = useMutation({
    /** @param {string} id */
    mutationFn: (id) => api.del(`/workspaces/${current.id}/members/${id}`),
    onSuccess: async () => {
      toast.success('Member removed');
      await inv(['members', current.id]);
    },
    onError: (e) => toast.error(/** @type {Error} */ (e).message),
  });
  if (!current) return <Skeleton className="h-64" />;
  return (
    <div className="space-y-6">
      <Section title="Workspace">
        <div className="flex max-w-xl flex-wrap items-end gap-3">
          <Field label="Name" className="flex-1">
            {(id) => (
              <Input id={id} value={name} disabled={!isAdmin} onChange={(e) => setName(e.target.value)} />
            )}
          </Field>
          {isAdmin && (
            <Button
              variant="primary"
              disabled={name.trim().length < 2 || name === current.name}
              loading={rename.isPending}
              onClick={() => rename.mutate()}
            >
              Rename
            </Button>
          )}
        </div>
        <p className="mt-3 text-xs text-muted">
          Your role: {current.role.toLowerCase()}. {ROLE_DESCRIPTION[current.role]}
        </p>
      </Section>
      <Section
        title="Members"
        description="Invite people who already have a JKY-Radar account. They accept from their overview page."
      >
        {isAdmin && (
          <form
            className="mb-5 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              invite.mutate();
            }}
          >
            <Field label="Email" className="min-w-60 flex-1">
              {(id) => (
                <Input
                  id={id}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teammate@company.com"
                />
              )}
            </Field>
            <Field label="Role" className="w-44">
              {(id) => (
                <Select id={id} value={role} onChange={(e) => setRole(/** @type {Role} */ (e.target.value))}>
                  {ROLES.filter((r) => r !== 'OWNER').map((r) => (
                    <option key={r} value={r}>
                      {r.toLowerCase()}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button
              type="submit"
              variant="primary"
              loading={invite.isPending}
              disabled={!email.includes('@')}
            >
              Send invitation
            </Button>
          </form>
        )}
        {members.isLoading ? (
          <Skeleton className="h-32" />
        ) : members.error ? (
          <ErrorState error={members.error} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="py-2 pr-4 font-medium">Member</th>
                  <th className="py-2 pr-4 font-medium">Role</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {members.data.map((m) => {
                  const self = m.userId === user?.id;
                  const editable =
                    isAdmin &&
                    m.role !== 'OWNER' &&
                    !self &&
                    !(current.role === 'ADMIN' && m.role === 'ADMIN');
                  return (
                    <tr key={m.id} className="border-b border-line last:border-0">
                      <td className="py-2.5 pr-4">
                        <div className="font-medium">
                          {m.name} {self && <span className="text-xs text-muted">(you)</span>}
                        </div>
                        <div className="text-xs text-muted">{m.email}</div>
                      </td>
                      <td className="py-2.5 pr-4">
                        {editable ? (
                          <Select
                            aria-label={`Role for ${m.name}`}
                            value={m.role}
                            onChange={(e) =>
                              changeRole.mutate({ id: m.id, r: /** @type {Role} */ (e.target.value) })
                            }
                            className="h-8 w-36"
                          >
                            {ROLES.filter((r) => r !== 'OWNER').map((r) => (
                              <option key={r} value={r}>
                                {r.toLowerCase()}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <span className="capitalize">{m.role.toLowerCase()}</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-muted capitalize">
                        {m.status}, {dateTime(m.createdAt)}
                      </td>
                      <td className="py-2.5 text-right">
                        {(editable || (self && m.role !== 'OWNER')) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-breaking"
                            onClick={async () => {
                              const ok = await confirm({
                                title: self ? 'Leave this workspace?' : `Remove ${m.name}?`,
                                body: self
                                  ? 'You lose access until someone invites you again.'
                                  : 'They lose access to every project in this workspace.',
                                confirmLabel: self ? 'Leave workspace' : 'Remove member',
                                danger: true,
                              });
                              if (ok) remove.mutate(m.id);
                            }}
                          >
                            {self ? 'Leave' : 'Remove'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <dl className="mt-5 grid grid-cols-1 gap-2 border-t border-line pt-4 text-xs sm:grid-cols-2">
          {ROLES.map((r) => (
            <div key={r}>
              <dt className="font-medium capitalize">{r.toLowerCase()}</dt>
              <dd className="text-muted">{ROLE_DESCRIPTION[r]}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}

function InvitationsTab() {
  const q = useInvitations();
  const inv = useInvalidate();
  const act = useMutation({
    /** @param {{ id: string; a: 'accept' | 'decline' }} props */
    mutationFn: ({ id, a }) => api.post(`/invitations/${id}/${a}`),
    onSuccess: () => inv(['invitations'], ['workspaces']),
  });
  return (
    <Section title="Pending invitations">
      {q.isLoading ? (
        <Skeleton className="h-20" />
      ) : !q.data?.length ? (
        <p className="text-sm text-muted">No pending invitations.</p>
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <span className="flex-1">
                {i.workspaceName} as {i.role.toLowerCase()}, from {i.invitedBy}
              </span>
              <Button size="sm" variant="primary" onClick={() => act.mutate({ id: i.id, a: 'accept' })}>
                Accept
              </Button>
              <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: i.id, a: 'decline' })}>
                Decline
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export default function SettingsPage() {
  useCrumbs([{ label: 'Settings' }]);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'profile';
  return (
    <>
      <PageHeader title="Settings" />
      <Tabs value={tab} onValueChange={(t) => setParams({ tab: t }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="workspace">Workspace and members</TabsTrigger>
          <TabsTrigger value="invitations">Invitations</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
        </TabsList>
        <div className="pt-5">
          <TabsContent value="profile">
            <Profile />
          </TabsContent>
          <TabsContent value="workspace">
            <Workspace />
          </TabsContent>
          <TabsContent value="invitations">
            <InvitationsTab />
          </TabsContent>
          <TabsContent value="appearance">
            <Appearance />
          </TabsContent>
        </div>
      </Tabs>
    </>
  );
}
