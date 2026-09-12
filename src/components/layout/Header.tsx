import React from 'react';
import { Layers } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const Header: React.FC = () => {
  const { config } = useApp();

  return (
    <header
      id="main-app-header"
      className="sticky top-0 z-40 w-full border-b border-zinc-200 bg-white/80 backdrop-blur-md"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-zinc-900 text-white flex items-center justify-center">
            <Layers className="w-4 h-4" aria-hidden="true" />
          </div>
          <span className="font-semibold text-zinc-900 text-sm tracking-tight">
            {config.appName}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/60">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Estrutura Ativa
          </span>
        </div>
      </div>
    </header>
  );
};
