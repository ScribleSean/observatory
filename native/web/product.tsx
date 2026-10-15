import React from 'react';
import {createRoot} from 'react-dom/client';
import Product from '../../app/viewer/product/product';
import {skinIdFrom} from '../../app/viewer/skin';
import '../../app/viewer/panel/panel.css';
import '../../app/viewer/product/product.css';

createRoot(document.getElementById('root')!).render(<Product initialSkin={skinIdFrom(location.search, document.documentElement)}/>);
