import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Explore from './pages/Explore';
import Studio from './pages/Studio';
import Gallery from './pages/Gallery';
import Models from './pages/Models';
import Settings from './pages/Settings';

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/explore" element={<Explore />} />
        <Route path="/studio" element={<Studio />} />
        <Route path="/studio/:templateName" element={<Studio />} />
        <Route path="/gallery" element={<Gallery />} />
        <Route path="/models" element={<Models />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
  );
}

export default App;
