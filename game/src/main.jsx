import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import CreatorApp from './creator/App.jsx';

const isCreator = window.location.pathname.startsWith('/creator');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isCreator ? <CreatorApp /> : <App />}
  </StrictMode>
);
