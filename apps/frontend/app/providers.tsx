'use client';

import type { ReactNode } from 'react';
import { Provider } from 'react-redux';
import { store } from '../store';
import { SocketBridge } from '../components/socket/SocketBridge';
import { ToastProvider } from '../components/ui/ToastProvider';
import { ModalProvider } from '../components/ui/ModalProvider';
import { PluginLoader } from '../components/plugins/PluginLoader';
import { FrontendPluginContextProvider } from '../lib/frontendPluginContext';
import { UserIdentityProvider } from '../components/user';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <Provider store={store}>
      <ToastProvider>
        <ModalProvider>
          <FrontendPluginContextProvider>
            <SocketBridge />
            <UserIdentityProvider>
              <PluginLoader />
              {children}
            </UserIdentityProvider>
          </FrontendPluginContextProvider>
        </ModalProvider>
      </ToastProvider>
    </Provider>
  );
}
