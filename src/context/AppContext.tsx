import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { AppConfig, NotificationMessage } from '../types';
import { APP_CONFIG } from '../lib/constants';

interface AppContextType {
  config: AppConfig;
  notifications: NotificationMessage[];
  addNotification: (notification: Omit<NotificationMessage, 'id' | 'createdAt'>) => void;
  removeNotification: (id: string) => void;
  isReady: boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [config] = useState<AppConfig>(APP_CONFIG);
  const [notifications, setNotifications] = useState<NotificationMessage[]>([]);
  const [isReady] = useState<boolean>(true);

  const addNotification = useCallback((notification: Omit<NotificationMessage, 'id' | 'createdAt'>) => {
    const id = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newNotif: NotificationMessage = {
      ...notification,
      id,
      createdAt: Date.now(),
    };
    setNotifications((prev) => [...prev, newNotif]);
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((item) => item.id !== id));
  }, []);

  return (
    <AppContext.Provider
      value={{
        config,
        notifications,
        addNotification,
        removeNotification,
        isReady,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = (): AppContextType => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp deve ser utilizado dentro de um AppProvider');
  }
  return context;
};
