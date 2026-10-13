import React from 'react';
import {createRoot} from 'react-dom/client';
import Panel from '../../app/panel';
import '../../app/panel.css';

const query = new URLSearchParams(location.search);
const skin = query.get('skin') ?? document.documentElement.dataset.skin ?? 'sage';
createRoot(document.getElementById('root')!).render(<Panel demo={query.has('demo')} initialSkin={skin}/>);
Object.defineProperty(window,'observatoryPanelReady',{value:true});
