/**
 * Application root
 *
 * Wires global providers in the correct order:
 *  - QueryClientProvider  (TanStack Query cache)
 *  - NuqsAdapter          (URL state, must be inside Router)
 *  - BrowserRouter        (route matching)
 *  - App                  (the actual app)
 *
 * Suspense + ErrorBoundary are in App.tsx so query suspense boundaries
 * stay close to the routes that need them.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { Toaster } from 'sonner';
import App from './App';
import { createQueryClient } from './lib/query-client';
import './styles/globals.css';

const queryClient = createQueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <NuqsAdapter>
          <App />
          <Toaster
            position="bottom-right"
            theme="dark"
            closeButton
            toastOptions={{
              style: {
                background: 'hsl(222 35% 13%)',
                border: '1px solid hsl(222 18% 18%)',
                color: 'hsl(210 40% 96%)',
                fontFamily: "'Outfit', sans-serif",
                fontSize: '13px',
              },
            }}
          />
        </NuqsAdapter>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
