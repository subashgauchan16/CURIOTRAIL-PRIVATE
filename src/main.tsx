import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applySettings } from './app/a11y';
import { createProgressStore } from './engine/progress-store';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/game.css';
import './styles/learning.css';
import './styles/explore.css';
import './styles/profile.css';

// Apply text size and motion preferences before the first paint.
applySettings(createProgressStore().load().settings);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
