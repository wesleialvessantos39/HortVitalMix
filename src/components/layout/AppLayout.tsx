import React, { ReactNode } from 'react';
import { Header } from './Header';

interface AppLayoutProps {
  children: ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  return (
    <div id="app-root-container" className="min-h-screen flex flex-col bg-zinc-50 text-zinc-900 antialiased">
      <Header />
      <main id="app-main-content" className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {children}
      </main>
    </div>
  );
};
