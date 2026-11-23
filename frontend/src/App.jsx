import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import ProtectedRoute from './routes/ProtectedRoute';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './pages/LoginPage';
import { Spinner } from './components/common';
import config from './config';

// Pages are code-split so each one loads only when first visited.
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const NewMeetingPage = lazy(() => import('./pages/NewMeetingPage'));
const RecordPage = lazy(() => import('./pages/RecordPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ProcessingPage = lazy(() => import('./pages/ProcessingPage'));
const MomReviewPage = lazy(() => import('./pages/MomReviewPage'));
const DistributionPage = lazy(() => import('./pages/DistributionPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const MeetingDetailPage = lazy(() => import('./pages/MeetingDetailPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'meetings/new', element: <NewMeetingPage /> },
          { path: 'meetings/:id/record', element: <RecordPage /> },
          { path: 'meetings/:id', element: <MeetingDetailPage /> },
          { path: 'meetings/:id/processing', element: <ProcessingPage /> },
          { path: 'meetings/:id/review', element: <MomReviewPage /> },
          { path: 'meetings/:id/distribute', element: <DistributionPage /> },
          { path: 'history', element: <HistoryPage /> },
          { path: 'settings', element: <SettingsPage /> },
          // Search needs a backend endpoint that doesn't exist yet (see README).
          ...(config.FEATURES.search ? [{ path: 'search', element: <SearchPage /> }] : []),
        ],
      },
    ],
  },
  {
    path: '*',
    element: (
      <Suspense fallback={<Spinner />}>
        <NotFoundPage />
      </Suspense>
    ),
  },
]);

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ToastProvider>
  );
}
