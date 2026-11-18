// Zod's setting comes first, before json-render or the catalog parse anything.
import '../../lib/zod-config.mjs';
import { createRoot } from 'react-dom/client';
import R2App from '../viewer/r2/App';

createRoot(document.getElementById('root')!).render(<R2App />);
