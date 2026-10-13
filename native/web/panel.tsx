import React from 'react';
import {createRoot} from 'react-dom/client';
import Panel from '../../app/panel';
import '../../app/panel.css';

const demo = new URLSearchParams(location.search).has('demo');
createRoot(document.getElementById('root')!).render(<Panel demo={demo}/>);
Object.defineProperty(window,'observatoryPanelReady',{value:true});
