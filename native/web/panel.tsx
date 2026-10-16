import React from 'react';
import { skinIdFrom } from '../../app/viewer/skin';
import {createRoot} from 'react-dom/client';
import Panel from '../../app/viewer/panel/panel';
import '../../app/viewer/panel/panel.css';

const query = new URLSearchParams(location.search);
const skin = skinIdFrom(location.search, document.documentElement);
createRoot(document.getElementById('root')!).render(<Panel demo={import.meta.env.MODE === 'demo' || query.has('demo')} initialSkin={skin}/>);
Object.defineProperty(window,'observatoryPanelReady',{value:true});
