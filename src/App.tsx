import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';

const Explore = lazy(() => import('./pages/Explore'));
const Studio = lazy(() => import('./pages/Studio'));
const Gallery = lazy(() => import('./pages/Gallery'));
const Models = lazy(() => import('./pages/Models'));
const Plugins = lazy(() => import('./pages/Plugins'));
const PluginsInstalled = lazy(() => import('./pages/plugins/Installed'));
const PluginsHistory = lazy(() => import('./pages/plugins/History'));
const PluginsPythonDependencies = lazy(() => import('./pages/plugins/python/Dependencies'));
const PluginsPythonPackages = lazy(() => import('./pages/plugins/python/Packages'));
const PluginsCivitaiModels = lazy(() => import('./pages/plugins/civitai/Models'));
const PluginsCivitaiWorkflows = lazy(() => import('./pages/plugins/civitai/Workflows'));
const Settings = lazy(() => import('./pages/Settings'));

function RouteFallback() {
  return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
    </div>
  );
}

function App() {
  return (
    <Layout>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/studio" element={<Studio />} />
          <Route path="/studio/:templateName" element={<Studio />} />
          <Route path="/gallery" element={<Gallery />} />
          <Route path="/models" element={<Models />} />
          <Route path="/plugins" element={<Plugins />}>
            <Route index element={<Navigate to="/plugins/installed" replace />} />
            <Route path="installed" element={<PluginsInstalled />} />
            <Route path="history" element={<PluginsHistory />} />
            <Route path="python">
              <Route index element={<Navigate to="/plugins/python/dependencies" replace />} />
              <Route path="dependencies" element={<PluginsPythonDependencies />} />
              <Route path="packages" element={<PluginsPythonPackages />} />
            </Route>
            <Route path="civitai">
              <Route index element={<Navigate to="/plugins/civitai/models" replace />} />
              <Route path="models" element={<PluginsCivitaiModels />} />
              <Route path="workflows" element={<PluginsCivitaiWorkflows />} />
            </Route>
          </Route>
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

export default App;
