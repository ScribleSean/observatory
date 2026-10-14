import React from 'react';
import {createRoot} from 'react-dom/client';
import Dashboard from '../../app/viewer/dashboard';
import '../../app/panel.css';
import '../../app/viewer/dashboard.css';

const query = new URLSearchParams(location.search);
const skin = query.get('skin') ?? document.documentElement.dataset.skin ?? 'sage';
createRoot(document.getElementById('root')!).render(<Dashboard demo={query.has('demo')} initialSkin={skin}/>);
