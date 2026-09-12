/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppProvider } from './context/AppContext';
import { AppLayout } from './components/layout/AppLayout';
import { EmptyState } from './components/common/EmptyState';

export default function App() {
  return (
    <AppProvider>
      <AppLayout>
        <div id="initial-structure-container" className="max-w-xl mx-auto py-12">
          <EmptyState
            id="empty-state-initial"
            title="Estrutura Inicial Configurada"
            description="A arquitetura base da aplicação (tipagem, contexto, layout e utilitários) está pronta para receber os módulos e telas do projeto."
          />
        </div>
      </AppLayout>
    </AppProvider>
  );
}

