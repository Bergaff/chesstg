import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles.css';
import './admin.css';
import AdminApp from './AdminApp';

const container = document.getElementById('admin-root');
if (!container) throw new Error('admin-root не найден');

createRoot(container).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
);
