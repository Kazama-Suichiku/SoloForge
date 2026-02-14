// 在首屏渲染前应用主题，避免闪烁
(function initTheme() {
  const stored = localStorage.getItem('soloforge-theme');
  const root = document.documentElement;
  if (stored === 'dark') {
    root.classList.add('dark');
    root.setAttribute('data-theme', 'dark');
  } else if (stored === 'light') {
    root.classList.remove('dark');
    root.removeAttribute('data-theme');
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    root.classList.add('dark');
    root.setAttribute('data-theme', 'dark');
  }
})();

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
