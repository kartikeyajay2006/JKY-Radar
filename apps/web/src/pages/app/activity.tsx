import { useState } from 'react';
import { roleAllows } from '@jky/shared';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { useCrumbs, useCurrentWorkspace } from '@/components/layout/workspace';
import { useAudit, useWorkspaceAnalyses } from '@/lib/queries';
import { dateTime } from '@/lib/format';
import { AnalysisTable } from './overview';

function Pager({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-xs text-muted">
      <span>
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-1">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

function AuditLog({ wid }: { wid: string }) {
  const [page, setPage] = useState(1);
  const q = useAudit(wid, page);
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <ErrorState error={q.error} />;
  const items = q.data!.data;
  if (!items.length) return <EmptyState title="No audit events yet" />;
  return (
    <div className="panel p-5">
      <ol className="divide-y divide-line">
        {items.map((e) => (
          <li key={e.id} className="grid grid-cols-1 gap-1 py-3 text-sm md:grid-cols-[180px_200px_1fr]">
            <span className="text-xs text-muted">{dateTime(e.createdAt)}</span>
            <span className="font-mono text-xs">{e.action}</span>
            <span className="min-w-0 text-fg-soft">
              <strong className="font-medium text-fg">{e.actor?.name ?? 'System'}</strong>
              <span className="ml-2 text-xs break-all text-muted">
                {Object.entries(e.metadata)
                  .slice(0, 5)
                  .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                  .join(', ')}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <Pager page={page} totalPages={q.data!.meta?.totalPages ?? 1} onPage={setPage} />
      <p className="mt-3 text-xs text-muted">
        The audit log is append-only. Entries cannot be edited or deleted through the application.
      </p>
    </div>
  );
}

function AnalysesLog({ wid }: { wid: string }) {
  const [page, setPage] = useState(1);
  const q = useWorkspaceAnalyses(wid, page);
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data!.data.length) return <EmptyState title="No analyses yet" />;
  return (
    <div className="panel p-5">
      <AnalysisTable items={q.data!.data} />
      <Pager page={page} totalPages={q.data!.meta?.totalPages ?? 1} onPage={setPage} />
    </div>
  );
}

export default function ActivityPage() {
  const { current } = useCurrentWorkspace();
  useCrumbs([{ label: current?.name ?? 'Workspace', to: '/app' }, { label: 'Activity' }]);
  if (!current) return <Skeleton className="h-64" />;
  const canAudit = roleAllows(current.role, 'audit.read');
  return (
    <>
      <PageHeader
        title="Activity"
        description="Every analysis in this workspace, and the audit trail of who changed what."
      />
      <Tabs defaultValue="analyses">
        <TabsList>
          <TabsTrigger value="analyses">Analyses</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
        </TabsList>
        <div className="pt-5">
          <TabsContent value="analyses">
            <AnalysesLog wid={current.id} />
          </TabsContent>
          <TabsContent value="audit">
            {canAudit ? (
              <AuditLog wid={current.id} />
            ) : (
              <EmptyState
                title="Admins only"
                body="Ask a workspace admin or owner for access to the audit log."
              />
            )}
          </TabsContent>
        </div>
      </Tabs>
    </>
  );
}
