import * as React from 'react'
import { Drawer } from 'vaul'
import { SessionListPanel } from './SessionList'
import styles from './shell.module.css'

interface ShellContextValue {
  openDrawer: () => void
}

const ShellContext = React.createContext<ShellContextValue>({
  openDrawer: () => {},
})

export function useShell() {
  return React.useContext(ShellContext)
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = React.useState(false)

  const value = React.useMemo(
    () => ({ openDrawer: () => setDrawerOpen(true) }),
    [],
  )

  return (
    <ShellContext.Provider value={value}>
      <div className={styles.shell}>
        <aside className={styles.sidebar}>
          <SessionListPanel />
        </aside>
        <main className={styles.main}>{children}</main>
      </div>
      <Drawer.Root
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        direction="left"
      >
        <Drawer.Portal>
          <Drawer.Overlay className={styles.drawerOverlay} />
          <Drawer.Content
            className={styles.drawerContent}
            aria-describedby={undefined}
          >
            <Drawer.Title className={styles.srOnly}>Sessions</Drawer.Title>
            <SessionListPanel onNavigate={() => setDrawerOpen(false)} />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </ShellContext.Provider>
  )
}
