import { Link, useRouteError, isRouteErrorResponse } from 'react-router';
import { MiniRadar } from '@/components/radar/mini-radar';
import { Button } from '@/components/ui/button';

/** @param {{ code: string; title: string; body: string }} props */
function Frame({ code, title, body }) {
  return (
    <div className="relative overflow-hidden">
      <div
        className="hairline-grid pointer-events-none absolute inset-0 opacity-25 [mask-image:radial-gradient(ellipse_at_70%_50%,black,transparent_70%)]"
        aria-hidden
      />
      <div className="relative mx-auto grid min-h-[70vh] max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <div className="page-in">
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 font-mono text-xs text-muted">
            <span className="size-1.5 rounded-full bg-breaking" />
            {code}
          </p>
          <h1 className="display mt-5 text-[36px] leading-tight font-semibold sm:text-[44px]">{title}</h1>
          <p className="mt-3 max-w-md text-fg-soft">{body}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/">
              <Button variant="primary" size="lg">
                Go to the home page
              </Button>
            </Link>
            <Link to="/app">
              <Button variant="secondary" size="lg">
                Open your workspace
              </Button>
            </Link>
          </div>
        </div>
        <MiniRadar className="hidden max-w-[24rem] md:block" />
      </div>
    </div>
  );
}

export const NotFoundPage = () => (
  <Frame
    code="404"
    title="Nothing on the radar here"
    body="The page does not exist, or it belongs to a workspace you are not a member of."
  />
);
export const ForbiddenPage = () => (
  <Frame
    code="403"
    title="You do not have access"
    body="Your role in this workspace does not allow this action. Ask a workspace admin to change your role."
  />
);

export function RouteErrorPage() {
  const err = useRouteError();
  if (isRouteErrorResponse(err) && err.status === 404) return <NotFoundPage />;
  return (
    <Frame
      code="Error"
      title="This screen failed to load"
      body={
        err instanceof Error ? err.message : 'An unexpected error occurred. Reload the page to try again.'
      }
    />
  );
}
