import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import ProtectedRoute from './routes/ProtectedRoute';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './pages/LoginPage';
import { Spinner } from './components/common';

// Pages are code-split so each one loads only when first visited.
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const UploadPage = lazy(() => import('./pages/UploadPage'));
const ProcessingPage = lazy(() => import('./pages/ProcessingPage'));
const MomReviewPage = lazy(() => import('./pages/MomReviewPage'));
const DistributionPage = lazy(() => import('./pages/DistributionPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const MeetingDetailPage = lazy(() => import('./pages/MeetingDetailPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const LiveStartPage = lazy(() => import('./pages/LiveStartPage'));
const LiveSessionPage = lazy(() => import('./pages/LiveSessionPage'));
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
          { path: 'live/new', element: <LiveStartPage /> },
          { path: 'live/:id', element: <LiveSessionPage /> },
          { path: 'meetings/new', element: <UploadPage /> },
          { path: 'meetings/:id', element: <MeetingDetailPage /> },
          { path: 'meetings/:id/processing', element: <ProcessingPage /> },
          { path: 'meetings/:id/review', element: <MomReviewPage /> },
          { path: 'meetings/:id/distribute', element: <DistributionPage /> },
          { path: 'history', element: <HistoryPage /> },
          { path: 'search', element: <SearchPage /> },
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
