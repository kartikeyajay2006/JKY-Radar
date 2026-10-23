import { Link } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { useCrumbs } from '@/components/layout/workspace';
import { api } from '@/lib/api';
import { useInvalidate, useNotifications } from '@/lib/queries';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';

export default function NotificationsPage() {
  useCrumbs([{ label: 'Notifications' }]);
  const q = useNotifications();
  const inv = useInvalidate();
  const read = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => inv(['notifications']),
  });
  const all = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => inv(['notifications']),
  });
  const unread = q.data?.meta?.unread ?? 0;
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Review requests, decisions on your analyses, invitations and failures."
        actions={
          <Button variant="secondary" disabled={!unread} loading={all.isPending} onClick={() => all.mutate()}>
            Mark all as read
          </Button>
        }
      />
      {q.isLoading ? (
        <Skeleton className="h-64" />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : !q.data!.data.length ? (
        <EmptyState
          icon={<Bell className="size-5" />}
          title="You are all caught up"
          body="Notifications appear when analyses finish, reviews are requested or decisions are recorded."
        />
      ) : (
        <ul className="panel divide-y divide-line">
          {q.data!.data.map((n) => (
            <li key={n.id} className={cn('flex gap-3 px-5 py-4', !n.readAt && 'bg-accent-soft/50')}>
              <span
                className={cn('mt-2 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-accent')}
                aria-label={n.readAt ? undefined : 'Unread'}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {n.link ? (
                    <Link
                      to={n.link}
                      onClick={() => !n.readAt && read.mutate(n.id)}
                      className="hover:text-accent hover:underline"
                    >
                      {n.title}
                    </Link>
                  ) : (
                    n.title
                  )}
                </p>
                {n.body && <p className="mt-0.5 text-sm text-fg-soft">{n.body}</p>}
                <p className="mt-1 text-xs text-muted">{timeAgo(n.createdAt)}</p>
              </div>
              {!n.readAt && (
                <Button size="sm" variant="ghost" onClick={() => read.mutate(n.id)}>
                  Mark read
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
