import { createRoot } from 'react-dom/client';
import Dashboard from '../viewer/dashboard';
import '../viewer/base.css';
import '../viewer/dashboard.css';

createRoot(document.getElementById('root')!).render(<Dashboard />);
