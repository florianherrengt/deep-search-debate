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

const creditMocks = vi.hoisted(() => ({
  getAdminUsers: vi.fn(),
  getCreditAccount: vi.fn(),
  grantUserCredits: vi.fn(),
}))

vi.mock("./lib/authClient.ts", () => ({
  authClient: {
    signIn: { social: authMocks.signInSocial },
    signOut: authMocks.signOut,
    useSession: authMocks.useSession,
  },
  getAuthConfig: authMocks.getAuthConfig,
}))

vi.mock("./lib/credits.ts", () => ({
  adminUsersQueryKey: ["admin", "users"],
  creditAccountQueryKey: ["credit-account"],
  getAdminUsers: creditMocks.getAdminUsers,
  getCreditAccount: creditMocks.getCreditAccount,
  grantUserCredits: creditMocks.grantUserCredits,
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

function renderApp(queryClient = createAppQueryClient()) {
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
    creditMocks.getCreditAccount.mockResolvedValue({
      credits: 1_000,
      isAdmin: true,
    })
    creditMocks.getAdminUsers.mockResolvedValue({ users: [] })
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

  it("renders the authenticated home inside a conventional application shell", async () => {
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
    const primaryNavigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    })
    expect(within(primaryNavigation).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/")
    expect(
      within(primaryNavigation).getByRole("link", {
        name: "Research a question",
      }),
    ).toHaveAttribute("href", "/deep-search")
    expect(
      within(primaryNavigation).getByRole("link", {
        name: "Generate options",
      }),
    ).toHaveAttribute("href", "/ideas")
    expect(
      within(primaryNavigation).getByRole("link", {
        name: "Compare options",
      }),
    ).toHaveAttribute("href", "/debates")
    expect(within(primaryNavigation).queryByRole("link", { name: "About" })).not.toBeInTheDocument()
    expect(screen.queryByRole("navigation", { name: "Landing page navigation" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open account menu for Debug User" })).toBeVisible()
    expect(screen.queryByText(/sign in required/i)).not.toBeInTheDocument()
    expect(screen.getByText("Your debate is saved automatically.")).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: "Open account menu for Debug User" }))
    const accountMenu = await screen.findByRole("menu", { name: "Account menu" })
    expect(within(accountMenu).getByText("Debug User")).toBeVisible()
    expect(within(accountMenu).getByRole("menuitem", { name: "About" })).toHaveAttribute("href", "/about")
    expect(
      await within(accountMenu).findByRole("menuitem", { name: "Admin" }),
    ).toHaveAttribute("href", "/admin/credits")
    expect(within(accountMenu).getByRole("menuitem", { name: "Sign out" })).toBeVisible()
  })

  it("resets scroll and moves focus into the new route", async () => {
    window.history.replaceState({}, "", "/deep-search")
    renderApp()

    fireEvent.click(screen.getByRole("button", { name: "Open account menu for Debug User" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "About" }))

    const heading = await screen.findByRole("heading", {
      name: "About RethinkLoop",
    })
    expect(heading).toBeVisible()
    expect(heading).toHaveAttribute("data-route-focus-target", "true")
    await waitFor(() =>
      expect(scrollToMock).toHaveBeenCalledWith({
        behavior: "auto",
        left: 0,
        top: 0,
      }),
    )
    expect(heading).toHaveFocus()
  })

  it("moves focus to a generic error after an asynchronous route load", async () => {
    window.history.replaceState({}, "", "/about")
    const timeoutSpy = vi.spyOn(window, "setTimeout")
    let resolveDetail!: (response: Response) => void
    const detailResponse = new Promise<Response>((resolve) => {
      resolveDetail = resolve
    })
    vi.stubGlobal("fetch", vi.fn(() => detailResponse))
    renderApp()

    window.history.pushState({}, "", "/deep-search/unavailable")
    fireEvent.popState(window)

    const main = screen.getByRole("main")
    await waitFor(() => expect(main).toHaveFocus())
    expect(main).toHaveAttribute("data-route-focus-target", "true")
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30_000)

    resolveDetail(new Response(null, { status: 400 }))
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveFocus()
    expect(alert).toHaveAttribute("data-route-focus-target", "true")
    timeoutSpy.mockRestore()
  })

  it("moves focus to a heading after a successful asynchronous route load", async () => {
    window.history.replaceState({}, "", "/about")
    let resolveDetail!: (response: Response) => void
    const detailResponse = new Promise<Response>((resolve) => {
      resolveDetail = resolve
    })
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url
        if (url.endsWith("/events")) {
          return Promise.resolve(
            new Response('{"type":"done"}\n', { status: 200 }),
          )
        }
        return detailResponse
      }),
    )
    renderApp()

    window.history.pushState({}, "", "/deep-search/loaded-research")
    fireEvent.popState(window)

    const main = screen.getByRole("main")
    await waitFor(() => expect(main).toHaveFocus())
    expect(main).toHaveAttribute("data-route-focus-target", "true")

    resolveDetail(
      Response.json({
        deepSearchJob: {
          completedAt: "2026-01-01T00:01:00.000Z",
          canStop: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          creditsUsed: null,
          deepSearchJobId: "loaded-job-id",
          error: null,
          feedback: null,
          isIndexable: false,
          isPublic: false,
          maxResultsPerSearch: 5,
          maxRounds: 2,
          maxSearches: 3,
          researchRequest: "A completed research request",
          slug: "loaded-research",
          status: "completed",
          stopRequested: false,
          title: "Loaded research",
        },
      }),
    )
    const heading = await screen.findByRole("heading", {
      name: "Loaded research",
    })
    expect(heading).toHaveFocus()
    expect(heading).toHaveAttribute("data-route-focus-target", "true")
  })

  it("keeps focus on the route heading when a transient heading is replaced", async () => {
    window.history.replaceState({}, "", "/about")
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)))
    renderApp()

    window.history.pushState({}, "", "/deep-search/loading-research")
    fireEvent.popState(window)

    const main = screen.getByRole("main")
    await waitFor(() => expect(main).toHaveFocus())
    const loadingHeading = document.createElement("h1")
    loadingHeading.textContent = "Loading idea…"
    main.append(loadingHeading)
    await waitFor(() => expect(loadingHeading).toHaveFocus())

    const resolvedHeading = document.createElement("h1")
    resolvedHeading.textContent = "Resolved idea"
    loadingHeading.replaceWith(resolvedHeading)
    fireEvent.focusIn(document.body)

    await waitFor(() => expect(resolvedHeading).toHaveFocus())
  })

  it("does not steal focus when a user leaves a route waiting for its heading", async () => {
    window.history.replaceState({}, "", "/about")
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)))
    renderApp()

    window.history.pushState({}, "", "/deep-search/loading-research")
    fireEvent.popState(window)

    const main = screen.getByRole("main")
    await waitFor(() => expect(main).toHaveFocus())
    const accountButton = screen.getByRole("button", { name: "Open account menu for Debug User" })
    accountButton.focus()
    const resolvedHeading = document.createElement("h1")
    resolvedHeading.textContent = "Resolved research"
    main.append(resolvedHeading)

    await waitFor(() => expect(resolvedHeading).toBeInTheDocument())
    expect(accountButton).toHaveFocus()
    expect(resolvedHeading).not.toHaveAttribute("data-route-focus-target")
  })

  it("closes open shell menus when browser history changes the route", async () => {
    window.history.replaceState({}, "", "/about")
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)))
    renderApp()

    fireEvent.click(screen.getByRole("button", { name: "Open account menu for Debug User" }))
    expect(await screen.findByRole("menu", { name: "Account menu" })).toBeVisible()

    window.history.pushState({}, "", "/deep-search")
    fireEvent.popState(window)

    await waitFor(() => expect(screen.queryByRole("menu", { name: "Account menu" })).not.toBeInTheDocument())
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

  it("shows the current balance and admin navigation", async () => {
    window.history.replaceState({}, "", "/deep-search")
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)))

    renderApp()

    const creditBalance = await screen.findByRole("status", {
      name: "Credit balance: 1,000 credits",
    })
    expect(within(creditBalance).getByText("1,000 credits")).toBeInTheDocument()
    expect(
      within(screen.getByRole("navigation", { name: "Primary navigation" }))
        .queryByRole("link", { name: "Admin" }),
    ).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open account menu for Debug User",
      }),
    )
    expect(await screen.findByRole("menuitem", { name: "Admin" })).toHaveAttribute(
      "href",
      "/admin/credits",
    )
  })

  it("exposes every primary destination through the mobile navigation menu", () => {
    window.history.replaceState({}, "", "/deep-search")
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)))

    renderApp()
    fireEvent.click(
      screen.getByRole("button", { name: "Open navigation menu" }),
    )

    const menu = screen.getByRole("menu", {
      name: "Primary navigation links",
    })
    expect(
      within(menu).getByRole("menuitem", { name: "Home" }),
    ).toHaveAttribute("href", "/")
    expect(
      within(menu).getByRole("menuitem", { name: "Research a question" }),
    ).toHaveAttribute("href", "/deep-search")
    expect(
      within(menu).getByRole("menuitem", { name: "Generate options" }),
    ).toHaveAttribute("href", "/ideas")
    expect(
      within(menu).getByRole("menuitem", { name: "Compare options" }),
    ).toHaveAttribute("href", "/debates")
  })

  it("shows the waitlist instead of sign-in on protected routes", () => {
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
      screen.getByRole("heading", { name: "Join the waiting list" }),
    ).toBeVisible()
    expect(
      screen.getByRole("textbox", { name: "Email address" }),
    ).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "Continue with GitHub" }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Privacy Policy" }),
    ).toHaveAttribute("href", "/privacy")
    expect(screen.queryByRole("link", { name: "Deep Search" })).toBeNull()
  })

  it("shows sign-in only at the hidden UUID route", async () => {
    window.history.replaceState(
      {},
      "",
      "/8f917f11-9443-4241-b741-6320492608c5?source=test",
    )
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
      screen.queryByRole("textbox", { name: "Email address" }),
    ).not.toBeInTheDocument()
    expect(
      await screen.findByRole("button", { name: "Continue as debug user" }),
    ).toBeVisible()
    expect(document.title).toBe("Sign in — RethinkLoop")
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    )

    fireEvent.click(
      screen.getByRole("button", { name: "Continue with GitHub" }),
    )
    await waitFor(() =>
      expect(authMocks.signInSocial).toHaveBeenCalledWith({
        callbackURL: "/",
        provider: "github",
      }),
    )
  })

  it("redirects authenticated visitors from the hidden sign-in route home", async () => {
    window.history.replaceState(
      {},
      "",
      "/8f917f11-9443-4241-b741-6320492608c5",
    )

    renderApp()

    await waitFor(() => expect(window.location.pathname).toBe("/"))
    expect(
      screen.getByRole("heading", { name: "One answer is not enough." }),
    ).toBeVisible()
    expect(authMocks.getAuthConfig).not.toHaveBeenCalled()
  })

  it("renders the public product entry point for an anonymous session", () => {
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
    const landingNavigation = screen.getByRole("navigation", {
      name: "Landing page navigation",
    })
    expect(
      within(landingNavigation).getByRole("button", {
        name: "Join the waiting list",
      }),
    ).toBeVisible()
    expect(
      within(landingNavigation).getByRole("link", { name: "How it works" }),
    ).toHaveAttribute("href", "/#how-it-works")
    expect(
      screen.queryByRole("heading", { name: "Join the waiting list" }),
    ).not.toBeInTheDocument()
    expect(screen.getByText(/debate access is opening soon/i)).toBeVisible()
    expect(
      screen.getByRole("link", { name: "Terms & Conditions" }),
    ).toHaveAttribute("href", "/terms")
    expect(
      screen.getByRole("link", { name: "Privacy Policy" }),
    ).toHaveAttribute("href", "/privacy")
    expect(authMocks.useSession).toHaveBeenCalled()
  })

  it("keeps the public home available while the optional session resolves", () => {
    authMocks.useSession.mockReturnValue({
      data: null,
      error: null,
      isPending: true,
      isRefetching: false,
      refetch: authMocks.refetch,
    })
    const queryClient = createAppQueryClient()
    const { rerender } = renderApp(queryClient)

    expect(
      screen.getByRole("heading", { name: "One answer is not enough." }),
    ).toBeVisible()
    expect(screen.queryByLabelText("Loading session")).not.toBeInTheDocument()

    authMocks.useSession.mockReturnValue({
      data: authenticatedSession,
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: authMocks.refetch,
    })
    rerender(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    )

    expect(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeVisible()
    expect(
      screen.queryByRole("navigation", { name: "Landing page navigation" }),
    ).not.toBeInTheDocument()
  })

  it("moves focus into a replacement screen when auth changes at the same URL", async () => {
    authMocks.useSession.mockReturnValue({
      data: null,
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: authMocks.refetch,
    })
    const queryClient = createAppQueryClient()
    const { rerender } = renderApp(queryClient)
    const anonymousHeading = screen.getByRole("heading", {
      name: "One answer is not enough.",
    })
    const anonymousAction = within(screen.getByRole("main")).getAllByRole(
      "button",
      { name: "Join the waiting list" },
    )[0]
    anonymousAction.focus()
    expect(anonymousAction).toHaveFocus()

    authMocks.useSession.mockReturnValue({
      data: authenticatedSession,
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: authMocks.refetch,
    })
    rerender(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    )

    const authenticatedHeading = screen.getByRole("heading", {
      name: "One answer is not enough.",
    })
    expect(authenticatedHeading).not.toBe(anonymousHeading)
    await waitFor(() => expect(authenticatedHeading).toHaveFocus())
  })

  it("keeps the public home available when the optional session fails", () => {
    authMocks.useSession.mockReturnValue({
      data: null,
      error: new Error("Session lookup failed"),
      isPending: false,
      isRefetching: false,
      refetch: authMocks.refetch,
    })

    renderApp()

    expect(
      screen.getByRole("heading", { name: "One answer is not enough." }),
    ).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "Session unavailable" }),
    ).not.toBeInTheDocument()
  })

  it("waits for the session check before showing a shareable resource anonymously", () => {
    window.history.replaceState({}, "", "/debates/private-debate")
    authMocks.useSession.mockReturnValue({
      data: null,
      error: null,
      isPending: true,
      isRefetching: false,
      refetch: authMocks.refetch,
    })
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)))
    const queryClient = createAppQueryClient()
    const { rerender } = renderApp(queryClient)

    expect(
      screen.getByRole("progressbar", { name: "Loading session" }),
    ).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "Join the waiting list" }),
    ).not.toBeInTheDocument()

    authMocks.useSession.mockReturnValue({
      data: null,
      error: new Error("Session lookup failed"),
      isPending: false,
      isRefetching: false,
      refetch: authMocks.refetch,
    })
    rerender(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    )

    expect(
      screen.getByRole("heading", { name: "Session unavailable" }),
    ).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "Join the waiting list" }),
    ).not.toBeInTheDocument()
  })

  it("keeps the examples page visible to an anonymous session", async () => {
    window.history.replaceState({}, "", "/examples")
    authMocks.useSession.mockReturnValue({
      data: null,
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: authMocks.refetch,
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ debates: [] })),
    )

    renderApp()

    expect(
      screen.getByRole("heading", { level: 1, name: "Debate examples" }),
    ).toBeVisible()
    expect(
      await screen.findByText("No examples are currently published."),
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Join the waiting list" }),
    ).toBeVisible()
    expect(authMocks.useSession).toHaveBeenCalled()
  })

  it("keeps the debate action for authenticated users on public pages", async () => {
    window.history.replaceState({}, "", "/examples")
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ debates: [] })),
    )

    renderApp()

    expect(
      await screen.findByRole("heading", { level: 1, name: "Debate examples" }),
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
      within(landingNavigation).queryByRole("button", {
        name: "Join the waiting list",
      }),
    ).not.toBeInTheDocument()
  })

  it("keeps match details shareable with anonymous viewers", () => {
    window.history.replaceState(
      {},
      "",
      "/debates/debate-id/matches/match-id",
    )
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
      screen.getByRole("button", { name: "Join the waiting list" }),
    ).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "Join the waiting list" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("navigation", { name: "Primary navigation" }),
    ).not.toBeInTheDocument()
  })

  it("keeps individual idea pages shareable with anonymous viewers", () => {
    window.history.replaceState(
      {},
      "",
      "/ideas/independent-cafe-ideas/prep-forecast-id",
    )
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
      screen.getByRole("button", { name: "Join the waiting list" }),
    ).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "Join the waiting list" }),
    ).not.toBeInTheDocument()
  })

  it("keeps deep-search round pages shareable with anonymous viewers", () => {
    window.history.replaceState(
      {},
      "",
      "/deep-search/future-of-grid-storage/rounds/1",
    )
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
      screen.getByRole("button", { name: "Join the waiting list" }),
    ).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "Join the waiting list" }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "Page not found" }),
    ).not.toBeInTheDocument()
  })

  it("keeps authenticated match routes inside the application shell", async () => {
    window.history.replaceState(
      {},
      "",
      "/debates/debate-id/matches/match-id",
    )
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)))

    renderApp()

    expect(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeVisible()
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open account menu for Debug User",
      }),
    )
    const accountMenu = await screen.findByRole("menu", {
      name: "Account menu",
    })
    expect(within(accountMenu).getByText("Debug User")).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "Page not found" }),
    ).not.toBeInTheDocument()
  })

  it("keeps authenticated deep-search round routes inside the application shell", () => {
    window.history.replaceState(
      {},
      "",
      "/deep-search/future-of-grid-storage/rounds/1",
    )
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)))

    renderApp()

    expect(
      screen.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "Page not found" }),
    ).not.toBeInTheDocument()
  })

  it("keeps the privacy policy public and explains cookie use", () => {
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
    expect(
      screen.getByRole("heading", { level: 2, name: "Cookies and analytics" }),
    ).toBeVisible()
    expect(
      screen.getByText(/do not currently use non-essential cookies/i),
    ).toBeVisible()
    expect(screen.getByText(/waiting-list information/i)).toBeVisible()
    expect(
      screen.getAllByRole("link", { name: "support@rethinkloop.com" })[0],
    ).toHaveAttribute("href", "mailto:support@rethinkloop.com")
    expect(authMocks.useSession).toHaveBeenCalled()
  })

  it("makes the AI limitation explicit in the terms", () => {
    window.history.replaceState({}, "", "/terms")

    renderApp()

    const main = screen.getByRole("main")
    expect(
      within(main).getByRole("heading", {
        level: 2,
        name: "AI output can be wrong",
      }),
    ).toBeVisible()
    expect(
      within(main).getByText(/may be inaccurate, incomplete, biased/i),
    ).toBeVisible()
  })

  it("keeps sign-in controls hidden on a protected route with a query", () => {
    window.history.replaceState({}, "", "/ideas?source=test")
    authMocks.useSession.mockReturnValue({
      data: null,
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: authMocks.refetch,
    })

    renderApp()
    expect(
      screen.getByRole("heading", { name: "Join the waiting list" }),
    ).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "Continue with GitHub" }),
    ).not.toBeInTheDocument()
    expect(authMocks.signInSocial).not.toHaveBeenCalled()
  })
})
