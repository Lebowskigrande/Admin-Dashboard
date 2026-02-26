import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import { EventsProvider } from './context/EventsContext';
import { ROUTE_MANIFEST } from './config/routeManifest';

const PAGE_COMPONENTS = {
  overview: lazy(() => import('./pages/Dashboard.jsx')),
  sunday: lazy(() => import('./pages/Sunday.jsx')),
  calendar: lazy(() => import('./pages/Calendar.jsx')),
  liturgical: lazy(() => import('./pages/LiturgicalSchedule.jsx')),
  finance: lazy(() => import('./pages/Finance.jsx')),
  vestry: lazy(() => import('./pages/Vestry.jsx')),
  buildings: lazy(() => import('./pages/Buildings.jsx')),
  people: lazy(() => import('./pages/People.jsx')),
  todo: lazy(() => import('./pages/Todo.jsx')),
  taskOrigins: lazy(() => import('./pages/TaskAdmin.jsx')),
  eventTemplates: lazy(() => import('./pages/EventTemplates.jsx')),
  settings: lazy(() => import('./pages/Settings.jsx')),
};

function App() {
  return (
    <BrowserRouter>
      <EventsProvider>
        <Suspense fallback={<div className="page-loading">Loading...</div>}>
          <Routes>
            <Route path="/" element={<Layout />}>
              {ROUTE_MANIFEST.map((entry) => {
                const Component = PAGE_COMPONENTS[entry.key];
                if (!Component) return null;
                if (entry.path === '/') {
                  return <Route key={entry.key} index element={<Component />} />;
                }
                return <Route key={entry.key} path={entry.routePath} element={<Component />} />;
              })}
            </Route>
          </Routes>
        </Suspense>
      </EventsProvider>
    </BrowserRouter>
  );
}

export default App;
