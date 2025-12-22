import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Calendar from './pages/Calendar';
import Bulletins from './pages/Bulletins';
import Finance from './pages/Finance';
import Todo from './pages/Todo';
import Communications from './pages/Communications';
import Buildings from './pages/Buildings';
import People from './pages/People';
import Music from './pages/Music';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="finance" element={<Finance />} />
          <Route path="communications" element={<Communications />} />
          <Route path="buildings" element={<Buildings />} />
          <Route path="people" element={<People />} />
          <Route path="music" element={<Music />} />
          <Route path="bulletins" element={<Bulletins />} />
          <Route path="todo" element={<Todo />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
