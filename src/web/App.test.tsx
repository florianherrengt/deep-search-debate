import { fireEvent, render, screen, waitFor } from "@testing-library/react"
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
    expect(screen.getByText("Deep Search Debate")).toBeInTheDocument()
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Research, generate, and decide",
      }),
    ).toBeVisible()
    expect(
      screen.getByRole("link", { name: "Start a tournament" }),
    ).toHaveAttribute("href", "/debates")
    expect(
      screen.queryByRole("heading", {
        name: /Move from an open question to grounded ideas/,
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "Deep Search Debate" }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Debates" })).toHaveAttribute(
      "href",
      "/debates",
    )
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    )
    expect(screen.getByRole("link", { name: "Debates" })).not.toHaveAttribute(
      "aria-current",
    )
  })

  it("resets scroll and moves focus into the new route", async () => {
    renderApp()

    fireEvent.click(screen.getByRole("link", { name: "About" }))

    const heading = await screen.findByRole("heading", {
      name: "About Deep Search Debate",
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
