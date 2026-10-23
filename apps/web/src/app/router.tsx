import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter } from 'react-router';
import { PublicLayout } from '@/components/layout/public-layout';
import { AppLayout } from '@/components/layout/app-layout';
import { Skeleton } from '@/components/ui/primitives';
import { ForbiddenPage, NotFoundPage, RouteErrorPage } from '@/pages/public/errors';

const Landing = lazy(() => import('@/pages/public/landing'));
const Docs = lazy(() => import('@/pages/public/docs'));
const DemoIndex = lazy(() => import('@/pages/public/demo').then((m) => ({ default: m.DemoIndex })));
const DemoAnalysis = lazy(() => import('@/pages/public/demo').then((m) => ({ default: m.DemoAnalysis })));
const Login = lazy(() => import('@/pages/public/auth').then((m) => ({ default: m.LoginPage })));
const Register = lazy(() => import('@/pages/public/auth').then((m) => ({ default: m.RegisterPage })));
const Overview = lazy(() => import('@/pages/app/overview'));
const Projects = lazy(() => import('@/pages/app/projects'));
const ProjectLayout = lazy(() => import('@/pages/app/project-layout'));
const ProjectOverview = lazy(() => import('@/pages/app/project-overview'));
const Versions = lazy(() => import('@/pages/app/versions'));
const Compare = lazy(() => import('@/pages/app/compare'));
const Consumers = lazy(() => import('@/pages/app/consumers'));
const Policies = lazy(() => import('@/pages/app/policies'));
const Analysis = lazy(() => import('@/pages/app/analysis'));
const Activity = lazy(() => import('@/pages/app/activity'));
const Notifications = lazy(() => import('@/pages/app/notifications'));
const Settings = lazy(() => import('@/pages/app/settings'));

const s = (el: ReactNode) => (
  <Suspense
    fallback={
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-10">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64" />
      </div>
    }
  >
    {el}
  </Suspense>
);

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: '/', element: s(<Landing />) },
      { path: '/demo', element: s(<DemoIndex />) },
      { path: '/demo/:aid', element: s(<DemoAnalysis />) },
      { path: '/docs', element: s(<Docs />) },
      { path: '/docs/rules', element: s(<Docs />) },
      { path: '/login', element: s(<Login />) },
      { path: '/register', element: s(<Register />) },
      { path: '/403', element: <ForbiddenPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    path: '/app',
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: s(<Overview />) },
      { path: 'workspaces/:wid/projects', element: s(<Projects />) },
      {
        path: 'projects/:pid',
        element: s(<ProjectLayout />),
        children: [
          { index: true, element: s(<ProjectOverview />) },
          { path: 'versions', element: s(<Versions />) },
          { path: 'compare', element: s(<Compare />) },
          { path: 'consumers', element: s(<Consumers />) },
          { path: 'policies', element: s(<Policies />) },
        ],
      },
      { path: 'analyses/:aid', element: s(<Analysis />) },
      { path: 'analyses/:aid/impact', element: s(<Analysis tab="impact" />) },
      { path: 'analyses/:aid/reviews', element: s(<Analysis tab="reviews" />) },
      { path: 'activity', element: s(<Activity />) },
      { path: 'notifications', element: s(<Notifications />) },
      { path: 'settings', element: s(<Settings />) },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
