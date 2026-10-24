import { Link, useRouteError, isRouteErrorResponse } from 'react-router';
import { RadarMark } from '@/components/radar/logo';
import { Button } from '@/components/ui/button';

/** @param {{ code: string; title: string; body: string }} props */
function Frame({ code, title, body }) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center px-4 py-16">
      <RadarMark className="size-12" animated />
      <p className="mt-8 font-mono text-sm text-muted">{code}</p>
      <h1 className="display mt-2 text-[36px] leading-tight font-semibold">{title}</h1>
      <p className="mt-3 text-fg-soft">{body}</p>
      <div className="mt-8 flex gap-3">
        <Link to="/">
          <Button variant="primary">Go to the home page</Button>
        </Link>
        <Link to="/app">
          <Button variant="secondary">Open your workspace</Button>
        </Link>
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
