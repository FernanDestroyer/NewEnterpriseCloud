import { createContext, useContext, type ReactNode } from 'react'

export type OperationalNotificationSync = {
  key: string
  state: 'pending' | 'ok' | 'error'
  message?: string
}

export type OperationalNotificationsContextValue = {
  sync: OperationalNotificationSync
  revision: number
  refresh: () => void
}

const OperationalNotificationsContext = createContext<OperationalNotificationsContextValue | null>(null)

export function OperationalNotificationsProvider({ value, children }: { value: OperationalNotificationsContextValue; children: ReactNode }) {
  return <OperationalNotificationsContext.Provider value={value}>{children}</OperationalNotificationsContext.Provider>
}

export function useOperationalNotifications() {
  return useContext(OperationalNotificationsContext)
}
