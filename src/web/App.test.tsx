import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { App } from "./App"
import { createAppQueryClient } from "./lib/queryClient.ts"

const authMocks = vi.hoisted(() => ({
  getAuthConfig: vi.fn(),
  refetch: vi.fn(),
  signInSocial: vi.fn(),
  signOut: vi.fn(),
  useSession: vi.fn(),
}))

vi.mock("./lib/authClient.ts", () => ({
  authClient: {
    signIn: { social: authMocks.signInSocial },
    signOut: authMocks.signOut,
    useSession: authMocks.useSession,
  },
  getAuthConfig: authMocks.getAuthConfig,
}))

const authenticatedSession = {
  session: {
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: new Date("2026-01-08T00:00:00.000Z"),
    id: "session-id",
    token: "session-token",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    userId: "user-id",
  },
  user: {
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    email: "debug@local.invalid",
    emailVerified: false,
    id: "user-id",
    image: null,
    name: "Debug User",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  },
}

function renderApp() {
  const queryClient = createAppQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  )
}

describe("App", () => {
  const scrollToMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, "", "/")
    scrollToMock.mockClear()
    vi.stubGlobal("scrollTo", scrollToMock)
    authMocks.getAuthConfig.mockResolvedValue({ debugUserEnabled: true })
    authMocks.refetch.mockResolvedValue(undefined)
    authMocks.signInSocial.mockResolvedValue({ data: null, error: null })
    authMocks.signOut.mockResolvedValue({ data: null, error: null })
    authMocks.useSession.mockReturnValue({
      data: authenticatedSession,
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: authMocks.refetch,
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it("renders the product entry point", () => {
    renderApp()
    expect(
      screen.getByRole("link", { name: "RethinkLoop home" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "One answer is not enough.",
      }),
    ).toBeVisible()
    const landingNavigation = screen.getByRole("navigation", {
      name: "Landing page navigation",
    })
    expect(
      within(landingNavigation).getByRole("link", {
        name: "Start your own debate",
      }),
    ).toHaveAttribute("href", "/debates")
    expect(
      screen.queryByRole("heading", { name: "RethinkLoop" }),
    ).not.toBeInTheDocument()
    expect(
      within(landingNavigation).getByRole("link", { name: "How it works" }),
    ).toHaveAttribute("href", "/#how-it-works")
    expect(
      screen.getByRole("link", { name: "Terms & Conditions" }),
    ).toHaveAttribute("href", "/terms")
    expect(
      screen.getByRole("link", { name: "Privacy Policy" }),
    ).toHaveAttribute("href", "/privacy")
    expect(screen.queryByText("Debug User")).not.toBeInTheDocument()
  })

  it("resets scroll and moves focus into the new route", async () => {
    window.history.replaceState({}, "", "/deep-search")
    renderApp()

    fireEvent.click(screen.getByRole("link", { name: "About" }))

    const heading = await screen.findByRole("heading", {
      name: "About RethinkLoop",
    })
    expect(heading).toBeVisible()
    await waitFor(() =>
      expect(scrollToMock).toHaveBeenCalledWith({
        behavior: "auto",
        left: 0,
        top: 0,
      }),
    )
    expect(heading).toHaveFocus()
  })

  it("renders an explicit not-found screen for unknown routes", () => {
    window.history.replaceState({}, "", "/missing")

    renderApp()

    expect(
      screen.getByRole("heading", { level: 1, name: "Page not found" }),
    ).toBeVisible()
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute(
      "href",
      "/",
    )
  })

  it("gates the application behind GitHub or debug sign-in", async () => {
    window.history.replaceState({}, "", "/debates")
    authMocks.useSession.mockReturnValue({
      data: null,
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: authMocks.refetch,
    })

    renderApp()

    expect(
      screen.getByRole("heading", { name: "Sign in to continue" }),
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Continue with GitHub" }),
    ).toBeVisible()
    expect(
      await screen.findByRole("button", { name: "Continue as debug user" }),
    ).toBeVisible()
    expect(screen.queryByRole("link", { name: "Deep Search" })).toBeNull()
  })

  it("keeps the landing page public without loading a session", () => {
    authMocks.useSession.mockReturnValue({
      data: null,
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: authMocks.refetch,
    })

    renderApp()

    expect(
      screen.getByRole("heading", { name: "One answer is not enough." }),
    ).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "Sign in to continue" }),
    ).not.toBeInTheDocument()
    expect(authMocks.useSession).not.toHaveBeenCalled()
  })

  it("shows anonymous debate viewers a marketing call to action", () => {
    window.history.replaceState({}, "", "/debates/debate-id")
    authMocks.useSession.mockReturnValue({
      data: null,
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: authMocks.refetch,
    })
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)))

    renderApp()

    expect(
      screen.getByRole("link", { name: "Start your own debate" }),
    ).toHaveAttribute("href", "/debates")
    expect(
      screen.queryByRole("heading", { name: "Sign in to continue" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("navigation", { name: "Primary navigation" }),
    ).not.toBeInTheDocument()
  })

  it("keeps authenticated debate detail routes inside the application shell", () => {
    window.history.replaceState({}, "", "/debates/debate-id")
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)))

    renderApp()

    expect(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeVisible()
    expect(screen.getByText("Debug User")).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "Page not found" }),
    ).not.toBeInTheDocument()
  })

  it("keeps the placeholder legal pages public", () => {
    window.history.replaceState({}, "", "/privacy")
    authMocks.useSession.mockReturnValue({
      data: null,
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: authMocks.refetch,
    })

    renderApp()

    expect(
      screen.getByRole("heading", { level: 1, name: "Privacy Policy" }),
    ).toBeVisible()
    expect(screen.getByText("Policy coming soon")).toBeVisible()
    expect(authMocks.useSession).not.toHaveBeenCalled()
  })

  it("starts GitHub sign-in with the current route as its callback", async () => {
    window.history.replaceState({}, "", "/ideas?source=test")
    authMocks.useSession.mockReturnValue({
      data: null,
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: authMocks.refetch,
    })

    renderApp()
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with GitHub" }),
    )

    await waitFor(() =>
      expect(authMocks.signInSocial).toHaveBeenCalledWith({
        callbackURL: "/ideas?source=test",
        provider: "github",
      }),
    )
  })
})
