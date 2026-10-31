import { createRoot } from 'react-dom/client';
import App from './App';
import { initLang } from './lib/i18n';
import { initTelegram } from './lib/telegram';
import './styles.css';

// Язык решается до первого рендера: `tr` вызывается из разметки, и если он
// успел отложить решение на рендер, на экране на полсекуда мелькнет копия.
initLang();
initTelegram();

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

createRoot(container).render(<App />);
