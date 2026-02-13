import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Calendar from './pages/Calendar';
import LiturgicalSchedule from './pages/LiturgicalSchedule';
import Finance from './pages/Finance';
import Todo from './pages/Todo';
import TaskAdmin from './pages/TaskAdmin';
import Buildings from './pages/Buildings';
import People from './pages/People';
import Settings from './pages/Settings';
import Sunday from './pages/Sunday';
import Vestry from './pages/Vestry';
import EventTemplates from './pages/EventTemplates';
import { EventsProvider } from './context/EventsContext';
import { ROUTE_MANIFEST } from './config/routeManifest';

const PAGE_COMPONENTS = {
  overview: Dashboard,
  sunday: Sunday,
  calendar: Calendar,
  liturgical: LiturgicalSchedule,
  finance: Finance,
  vestry: Vestry,
  buildings: Buildings,
  people: People,
  todo: Todo,
  taskOrigins: TaskAdmin,
  eventTemplates: EventTemplates,
  settings: Settings,
};

function App() {
  return (
    <BrowserRouter>
      <EventsProvider>
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
      </EventsProvider>
    </BrowserRouter>
  );
}

export default App;
