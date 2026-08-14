import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  type Location,
  useLocation,
} from "react-router-dom"
import AdminPanelSettingsOutlined from "@mui/icons-material/AdminPanelSettingsOutlined"
import InfoOutlined from "@mui/icons-material/InfoOutlined"
import LogoutRounded from "@mui/icons-material/LogoutRounded"
import MenuRounded from "@mui/icons-material/MenuRounded"
import { useCallback, useEffect, useRef, useState } from "react"
import Alert from "@mui/material/Alert"
import AppBar from "@mui/material/AppBar"
import Avatar from "@mui/material/Avatar"
import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import Chip from "@mui/material/Chip"
import Container from "@mui/material/Container"
import Divider from "@mui/material/Divider"
import IconButton from "@mui/material/IconButton"
import ListItemIcon from "@mui/material/ListItemIcon"
import ListSubheader from "@mui/material/ListSubheader"
import Menu from "@mui/material/Menu"
import MenuItem from "@mui/material/MenuItem"
import Toolbar from "@mui/material/Toolbar"
import Typography from "@mui/material/Typography"
import { useQuery } from "@tanstack/react-query"
import { BrandLink } from "./components/layout/BrandLink.tsx"
import { AppFooter } from "./components/layout/AppFooter.tsx"
import { PublicLayout } from "./components/layout/PublicLayout.tsx"
import { Home } from "./pages/Home/Home.tsx"
import { PrivacyPolicy, TermsAndConditions } from "./pages/Legal.tsx"
import { About } from "./pages/About.tsx"
import { DeepSearch } from "./pages/DeepSearch/index.tsx"
import { Ideas } from "./pages/Ideas/index.tsx"
import { Debates } from "./pages/Debates/index.tsx"
import { AdminCredits } from "./pages/AdminCredits/index.ts"
import { Examples } from "./pages/Examples/index.tsx"
import { NotFound } from "./components/NotFound.tsx"
import { AuthGate } from "./components/auth/AuthGate.tsx"
import type { AuthSession } from "./lib/authClient.ts"
import type { MouseEvent, ReactNode } from "react"
import type { ContainerProps } from "@mui/material/Container"
import {
  creditAccountQueryKey,
  getCreditAccount,
} from "./lib/credits.ts"

const navigationItems = [
  { label: "Home", to: "/" },
  { label: "Research a question", to: "/deep-search" },
  { label: "Generate options", to: "/ideas" },
  { label: "Compare options", to: "/debates" },
] as const

const ROUTE_FOCUS_OBSERVER_TIMEOUT_MS = 30_000

function findRouteFocusTarget(main: HTMLElement | null): HTMLElement | null {
  return (
    main?.querySelector<HTMLElement>("h1") ??
    main?.querySelector<HTMLElement>('[role="alert"]') ??
    null
  )
}

function isCurrentRoute(pathname: string, destination: string): boolean {
  if (destination === "/") return pathname === destination
  return pathname === destination || pathname.startsWith(`${destination}/`)
}

interface AppNavigationProps {
  authError?: string
  session: AuthSession
  signingOut: boolean
  signOut: () => Promise<void>
}

function AppNavigation({ session, signingOut, signOut }: AppNavigationProps) {
  const location = useLocation()
  const [navigationMenu, setNavigationMenu] = useState<{
    anchor: HTMLElement
    location: Location
  } | null>(null)
  const [accountMenu, setAccountMenu] = useState<{
    anchor: HTMLElement
    location: Location
  } | null>(null)
  const navigationAnchor =
    navigationMenu?.location === location ? navigationMenu.anchor : null
  const accountAnchor =
    accountMenu?.location === location ? accountMenu.anchor : null
  const creditAccount = useQuery({
    queryKey: creditAccountQueryKey,
    queryFn: ({ signal }) => getCreditAccount(signal),
    refetchInterval: 5_000,
  })
  const formattedCredits = creditAccount.data?.credits.toLocaleString() ?? "—"
  const compactCredits =
    creditAccount.data === undefined
      ? "—"
      : new Intl.NumberFormat(undefined, {
          maximumFractionDigits: 1,
          notation: "compact",
        }).format(creditAccount.data.credits)
  const creditBalanceLabel =
    creditAccount.data === undefined
      ? "Credit balance unavailable"
      : `Credit balance: ${formattedCredits} credits`

  const openNavigationMenu = (event: MouseEvent<HTMLElement>) => {
    setNavigationMenu({ anchor: event.currentTarget, location })
  }
  const closeNavigationMenu = () => setNavigationMenu(null)
  const openAccountMenu = (event: MouseEvent<HTMLElement>) => {
    setAccountMenu({ anchor: event.currentTarget, location })
  }
  const closeAccountMenu = () => setAccountMenu(null)

  return (
    <AppBar position="static">
      <Toolbar
        sx={{
          columnGap: { xs: 0.25, sm: 0.75 },
          maxWidth: 1536,
          minHeight: { xs: 64 },
          mx: "auto",
          px: { xs: 1.5, sm: 3 },
          py: 0.5,
          width: "100%",
        }}
      >
        <BrandLink />
        <Box
          aria-label="Primary navigation"
          component="nav"
          sx={{
            alignItems: "center",
            display: "flex",
            ml: { xs: 0, md: 1.5 },
          }}
        >
          <Box sx={{ display: { xs: "none", md: "flex" }, gap: 0.25 }}>
            {navigationItems.map((item) => {
              const current = isCurrentRoute(location.pathname, item.to)
              return (
                <Button
                  key={item.to}
                  aria-current={current ? "page" : undefined}
                  color="inherit"
                  component={Link}
                  size="small"
                  sx={{
                    bgcolor: current ? "action.selected" : "transparent",
                    color: current ? "text.primary" : "text.secondary",
                    flexShrink: 0,
                    minWidth: 0,
                    px: 1.25,
                    "&:hover": {
                      bgcolor: current ? "action.selected" : "action.hover",
                      color: "text.primary",
                    },
                  }}
                  to={item.to}
                >
                  {item.label}
                </Button>
              )
            })}
          </Box>
          <IconButton
            aria-controls={
              navigationAnchor === null ? undefined : "primary-navigation-menu"
            }
            aria-expanded={navigationAnchor === null ? undefined : "true"}
            aria-haspopup="menu"
            aria-label="Open navigation menu"
            color="inherit"
            onClick={openNavigationMenu}
            sx={{
              display: { xs: "inline-flex", md: "none" },
              height: 44,
              width: 44,
            }}
          >
            <MenuRounded />
          </IconButton>
          <Menu
            anchorEl={navigationAnchor}
            anchorOrigin={{ horizontal: "left", vertical: "bottom" }}
            disableRestoreFocus={
              navigationMenu !== null && navigationMenu.location !== location
            }
            id="primary-navigation-menu"
            onClose={closeNavigationMenu}
            open={navigationAnchor !== null}
            slotProps={{
              list: { "aria-label": "Primary navigation links" },
            }}
            transformOrigin={{ horizontal: "left", vertical: "top" }}
          >
            {navigationItems.map((item) => {
              const current = isCurrentRoute(location.pathname, item.to)
              return (
                <MenuItem
                  key={item.to}
                  aria-current={current ? "page" : undefined}
                  component={Link}
                  onClick={closeNavigationMenu}
                  selected={current}
                  to={item.to}
                >
                  {item.label}
                </MenuItem>
              )
            })}
          </Menu>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        <Chip
          aria-label={creditBalanceLabel}
          color={
            creditAccount.data !== undefined && creditAccount.data.credits <= 0
              ? "error"
              : "default"
          }
          label={
            <>
              <Box
                component="span"
                sx={{ display: { xs: "inline", sm: "none" } }}
              >
                {compactCredits} cr
              </Box>
              <Box
                component="span"
                sx={{ display: { xs: "none", sm: "inline" } }}
              >
                {formattedCredits} credits
              </Box>
            </>
          }
          role="status"
          size="small"
          sx={{ flexShrink: 0 }}
          variant="outlined"
        />
        <Button
          aria-controls={accountAnchor === null ? undefined : "account-menu"}
          aria-expanded={accountAnchor === null ? undefined : "true"}
          aria-haspopup="menu"
          aria-label={`Open account menu for ${session.user.name}`}
          color="inherit"
          id="account-menu-button"
          onClick={openAccountMenu}
          sx={{
            columnGap: 1,
            minHeight: { xs: 44, md: 40 },
            minWidth: { xs: 44, md: 0 },
            ml: { xs: 0, sm: 0.25 },
            px: { xs: 0, md: 1 },
          }}
        >
          <Avatar
            alt=""
            src={session.user.image ?? undefined}
            sx={{ height: 30, width: 30 }}
          >
            {session.user.name.slice(0, 1).toUpperCase()}
          </Avatar>
          <Typography
            noWrap
            sx={{ display: { xs: "none", md: "block" }, maxWidth: 140 }}
            variant="body2"
          >
            {session.user.name}
          </Typography>
        </Button>
        <Menu
          anchorEl={accountAnchor}
          anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
          disableRestoreFocus={
            accountMenu !== null && accountMenu.location !== location
          }
          id="account-menu"
          onClose={closeAccountMenu}
          open={accountAnchor !== null}
          slotProps={{
            list: { "aria-label": "Account menu" },
            paper: { sx: { minWidth: 240 } },
          }}
          transformOrigin={{ horizontal: "right", vertical: "top" }}
        >
          <ListSubheader
            component="li"
            disableSticky
            role="presentation"
            sx={{ bgcolor: "transparent", lineHeight: 1.4, py: 1 }}
          >
            <Typography
              color="text.primary"
              noWrap
              sx={{ fontWeight: 650 }}
              variant="body2"
            >
              {session.user.name}
            </Typography>
            <Typography color="text.secondary" noWrap variant="caption">
              {session.user.email}
            </Typography>
          </ListSubheader>
          <Divider />
          <MenuItem
            aria-current={
              isCurrentRoute(location.pathname, "/about") ? "page" : undefined
            }
            component={Link}
            onClick={closeAccountMenu}
            selected={isCurrentRoute(location.pathname, "/about")}
            to="/about"
          >
            <ListItemIcon>
              <InfoOutlined fontSize="small" />
            </ListItemIcon>
            About
          </MenuItem>
          {creditAccount.data?.isAdmin === true ? (
            <MenuItem
              aria-current={
                isCurrentRoute(location.pathname, "/admin/credits")
                  ? "page"
                  : undefined
              }
              component={Link}
              onClick={closeAccountMenu}
              selected={isCurrentRoute(location.pathname, "/admin/credits")}
              to="/admin/credits"
            >
              <ListItemIcon>
                <AdminPanelSettingsOutlined fontSize="small" />
              </ListItemIcon>
              Admin
            </MenuItem>
          ) : null}
          <Divider />
          <MenuItem
            disabled={signingOut}
            onClick={() => {
              closeAccountMenu()
              void signOut()
            }}
          >
            <ListItemIcon>
              <LogoutRounded fontSize="small" />
            </ListItemIcon>
            {signingOut ? "Signing out…" : "Sign out"}
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  )
}

function RoutedContent() {
  const location = useLocation()
  const isDebateDetail = /^\/debates\/[^/]+(?:\/matches\/[^/]+)?\/?$/.test(
    location.pathname,
  )
  const isResearchDetail =
    /^\/ideas\/[^/]+\/?$/.test(location.pathname) ||
    /^\/deep-search\/[^/]+(?:\/rounds\/[^/]+)?\/?$/.test(location.pathname)

  return (
    <Container
      component="main"
      maxWidth={isDebateDetail ? "xl" : isResearchDetail ? "lg" : "md"}
      sx={{ flex: 1, py: { xs: 3, sm: 4.5 } }}
    >
      <Routes>
        <Route path="/deep-search" element={<DeepSearch />} />
        <Route
          path="/deep-search/:slug"
          element={<DeepSearch />}
        />
        <Route
          path="/deep-search/:slug/rounds/:roundNumber"
          element={<DeepSearch />}
        />
        <Route path="/ideas" element={<Ideas />} />
        <Route path="/ideas/:slug" element={<Ideas />} />
        <Route path="/ideas/:slug/:ideaId" element={<Ideas />} />
        <Route path="/debates" element={<Debates />} />
        <Route path="/debates/:slug" element={<Debates />} />
        <Route
          path="/debates/:slug/matches/:matchId"
          element={<Debates />}
        />
        <Route path="/about" element={<About />} />
        <Route path="/admin/credits" element={<AdminCredits />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Container>
  )
}

function RouteChangeManager() {
  const location = useLocation()
  const previousPathnameRef = useRef(location.pathname)
  const currentMainRef = useRef<HTMLElement | null>(null)
  const lastFocusedElementRef = useRef<Element | null>(null)
  const managedFocusTargetRef = useRef<HTMLElement | null>(null)
  const routeTargetPendingRef = useRef(false)
  const routeTargetTimeoutRef = useRef<number | undefined>(undefined)

  const stopWaitingForRouteTarget = useCallback(() => {
    routeTargetPendingRef.current = false
    if (routeTargetTimeoutRef.current === undefined) return
    window.clearTimeout(routeTargetTimeoutRef.current)
    routeTargetTimeoutRef.current = undefined
  }, [])

  const startWaitingForRouteTarget = useCallback(() => {
    stopWaitingForRouteTarget()
    routeTargetPendingRef.current = true
    routeTargetTimeoutRef.current = window.setTimeout(() => {
      routeTargetPendingRef.current = false
      routeTargetTimeoutRef.current = undefined
    }, ROUTE_FOCUS_OBSERVER_TIMEOUT_MS)
  }, [stopWaitingForRouteTarget])

  const moveFocus = useCallback((element: HTMLElement) => {
    element.dataset.routeFocusTarget = "true"
    element.tabIndex = -1
    element.focus({ preventScroll: true })
    lastFocusedElementRef.current = element
    managedFocusTargetRef.current = element
  }, [])

  const focusRouteTarget = useCallback(
    (main: HTMLElement | null) => {
      const target = findRouteFocusTarget(main)
      if (target === null) return false
      stopWaitingForRouteTarget()
      moveFocus(target)
      return true
    },
    [moveFocus, stopWaitingForRouteTarget],
  )

  const focusMainAndWait = useCallback(
    (main: HTMLElement | null) => {
      if (main !== null) moveFocus(main)
      startWaitingForRouteTarget()
    },
    [moveFocus, startWaitingForRouteTarget],
  )

  useEffect(() => {
    currentMainRef.current = document.querySelector<HTMLElement>("main")
    lastFocusedElementRef.current = document.activeElement

    const recordFocusedElement = (event: FocusEvent) => {
      if (!(event.target instanceof Element)) return
      const previousFocusedElement = lastFocusedElementRef.current
      if (
        (event.target === document.body ||
          event.target === document.documentElement) &&
        previousFocusedElement !== null &&
        !previousFocusedElement.isConnected
      ) {
        return
      }
      lastFocusedElementRef.current = event.target
      if (
        routeTargetPendingRef.current &&
        event.target !== managedFocusTargetRef.current
      ) {
        stopWaitingForRouteTarget()
      }
    }
    document.addEventListener("focusin", recordFocusedElement)

    const observer = new MutationObserver(() => {
      const previousMain = currentMainRef.current
      const main = document.querySelector<HTMLElement>("main")
      const mainWasReplaced =
        previousMain !== null &&
        main !== previousMain &&
        !previousMain.isConnected
      currentMainRef.current = main

      const managedTarget = managedFocusTargetRef.current
      const lastFocusedElement = lastFocusedElementRef.current
      const focusedTargetWasReplaced =
        managedTarget !== null &&
        !managedTarget.isConnected &&
        lastFocusedElement === managedTarget
      const focusedScreenWasReplaced =
        mainWasReplaced &&
        lastFocusedElement !== null &&
        !lastFocusedElement.isConnected

      if (focusedScreenWasReplaced || focusedTargetWasReplaced) {
        if (!focusRouteTarget(main)) focusMainAndWait(main)
        return
      }

      if (routeTargetPendingRef.current) focusRouteTarget(main)
    })
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      document.removeEventListener("focusin", recordFocusedElement)
      observer.disconnect()
      stopWaitingForRouteTarget()
    }
  }, [focusMainAndWait, focusRouteTarget, stopWaitingForRouteTarget])

  useEffect(() => {
    if (previousPathnameRef.current === location.pathname) return
    previousPathnameRef.current = location.pathname
    window.scrollTo({ behavior: "auto", left: 0, top: 0 })
    const main = document.querySelector<HTMLElement>("main")
    currentMainRef.current = main
    if (!focusRouteTarget(main)) focusMainAndWait(main)
  }, [focusMainAndWait, focusRouteTarget, location.pathname])

  return null
}

interface AuthenticatedShellProps extends AppNavigationProps {
  children: ReactNode
}

function AuthenticatedShell({
  authError,
  children,
  session,
  signingOut,
  signOut,
}: AuthenticatedShellProps) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <AppNavigation session={session} signingOut={signingOut} signOut={signOut} />
      {authError === undefined ? null : (
        <Alert severity="error">{authError}</Alert>
      )}
      {children}
      <AppFooter />
    </Box>
  )
}

function AuthenticatedApp(props: AppNavigationProps) {
  return (
    <AuthenticatedShell {...props}>
      <RoutedContent />
    </AuthenticatedShell>
  )
}

function AuthenticatedHome(props: AppNavigationProps) {
  return (
    <AuthenticatedShell {...props}>
      <Container
        component="main"
        maxWidth="lg"
        sx={{ flex: 1, py: { xs: 3, sm: 4.5 } }}
      >
        <Home authenticated />
      </Container>
    </AuthenticatedShell>
  )
}

function ShareableResourceRoute({
  children,
  maxWidth,
}: {
  children: ReactNode
  maxWidth: ContainerProps["maxWidth"]
}) {
  return (
    <AuthGate
      anonymous={
        <PublicLayout maxWidth={maxWidth}>
          <Box sx={{ py: { xs: 3, sm: 4.5 } }}>{children}</Box>
        </PublicLayout>
      }
    >
      {(props) => (
        <AuthenticatedShell {...props}>
          <Container
            component="main"
            maxWidth={maxWidth}
            sx={{ flex: 1, py: { xs: 3, sm: 4.5 } }}
          >
            {children}
          </Container>
        </AuthenticatedShell>
      )}
    </AuthGate>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <RouteChangeManager />
      <Routes>
        <Route
          path="/"
          element={
            <AuthGate
              anonymous={
                <PublicLayout>
                  <Home />
                </PublicLayout>
              }
              showAnonymousDuringSessionCheck
            >
              {(props) => <AuthenticatedHome {...props} />}
            </AuthGate>
          }
        />
        <Route
          path="/examples"
          element={
            <PublicLayout maxWidth="md">
              <Examples />
            </PublicLayout>
          }
        />
        <Route
          path="/terms"
          element={
            <PublicLayout maxWidth="md">
              <TermsAndConditions />
            </PublicLayout>
          }
        />
        <Route
          path="/privacy"
          element={
            <PublicLayout maxWidth="md">
              <PrivacyPolicy />
            </PublicLayout>
          }
        />
        <Route
          path="/debates/:slug"
          element={
            <ShareableResourceRoute maxWidth="xl">
              <Debates />
            </ShareableResourceRoute>
          }
        />
        <Route
          path="/debates/:slug/matches/:matchId"
          element={
            <ShareableResourceRoute maxWidth="xl">
              <Debates />
            </ShareableResourceRoute>
          }
        />
        <Route
          path="/ideas/:slug/:ideaId"
          element={
            <ShareableResourceRoute maxWidth="md">
              <Ideas />
            </ShareableResourceRoute>
          }
        />
        <Route
          path="/ideas/:slug"
          element={
            <ShareableResourceRoute maxWidth="lg">
              <Ideas />
            </ShareableResourceRoute>
          }
        />
        <Route
          path="/deep-search/:slug"
          element={
            <ShareableResourceRoute maxWidth="lg">
              <DeepSearch />
            </ShareableResourceRoute>
          }
        />
        <Route
          path="/deep-search/:slug/rounds/:roundNumber"
          element={
            <ShareableResourceRoute maxWidth="lg">
              <DeepSearch />
            </ShareableResourceRoute>
          }
        />
        <Route
          path="*"
          element={
            <AuthGate>
              {(props) => <AuthenticatedApp {...props} />}
            </AuthGate>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
