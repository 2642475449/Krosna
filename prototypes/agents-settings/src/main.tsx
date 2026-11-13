import React from 'react';
import { createRoot } from 'react-dom/client';
import { Prototype } from './App';
import '@/styles/themes.css';
import '@/styles/overlays.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><Prototype /></React.StrictMode>);
