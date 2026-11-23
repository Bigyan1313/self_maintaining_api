import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Configuration } from './pages/Configuration';
import { Changes } from './pages/Changes';
import { RunDetailPage, Runs } from './pages/Runs';
import { Results } from './pages/Results';
/** Five-view dashboard; server contract owns all pipeline decisions. */
export function App() {
  return (
    <div className="shell">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <aside>
        <div className="brand">
          <span className="brand-mark">S</span>
          <div>
            Self-Maintaining<span>API WORKSPACE</span>
          </div>
        </div>
        <nav aria-label="Main navigation">
          {[
            ['/configuration', 'Configuration', '01'],
            ['/changes', 'Changes', '02'],
            ['/runs', 'Runs', '03'],
            ['/results', 'Results', '04'],
          ].map(([path, label, n]) => (
            <NavLink key={path} to={path!}>
              <span aria-hidden="true">{n}</span>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-note">
          Detect. Review. Repair.<p>Every repair awaits human review.</p>
        </div>
      </aside>
      <main id="content">
        <div className="topbar">
          <span>SELF-MAINTAINING APIs</span>
          <span>Group 13 · Workspace</span>
        </div>
        {import.meta.env.DEV && import.meta.env.VITE_USE_MOCKS === 'true' && (
          <div role="status" className="mock-banner">
            {import.meta.env.VITE_E2E_FIXTURES === 'true'
              ? 'FIXTURE DEMONSTRATION — all data is simulated.'
              : 'Development mock: evaluation results only (Increment 16 pending).'}
          </div>
        )}
        <Routes>
          <Route path="/" element={<Navigate to="/configuration" replace />} />
          <Route path="/configuration" element={<Configuration />} />
          <Route path="/changes" element={<Changes />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/runs/:id" element={<RunDetailPage />} />
          <Route path="/results" element={<Results />} />
          <Route
            path="*"
            element={
              <>
                <h1>Page not found</h1>
                <NavLink to="/configuration">Open Configuration</NavLink>
              </>
            }
          />
        </Routes>
        <footer>Evidence first. Review before merging.</footer>
      </main>
    </div>
  );
}
