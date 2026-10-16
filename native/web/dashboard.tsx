import React from 'react';
import { skinIdFrom } from '../../app/viewer/skin';
import {createRoot} from 'react-dom/client';
import Dashboard from '../../app/viewer/dashboard';
import '../../app/viewer/panel/panel.css';
import '../../app/viewer/dashboard.css';

const query = new URLSearchParams(location.search);
const skin = skinIdFrom(location.search, document.documentElement);
createRoot(document.getElementById('root')!).render(<Dashboard demo={import.meta.env.MODE === 'demo' || query.has('demo')} initialSkin={skin}/>);
