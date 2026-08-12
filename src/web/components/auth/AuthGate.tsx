import GitHub from "@mui/icons-material/GitHub"
import BugReportOutlined from "@mui/icons-material/BugReportOutlined"
import Alert from "@mui/material/Alert"
import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import CircularProgress from "@mui/material/CircularProgress"
import Link from "@mui/material/Link"
import Paper from "@mui/material/Paper"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState, type ReactNode } from "react"
import { Link as RouterLink } from "react-router-dom"

import { authClient, getAuthConfig, type AuthSession } from "../../lib/authClient.ts"
import { useSeo } from "../../lib/seo.ts"

interface AuthGateProps {
  anonymous?: ReactNode
  children: (props: {
    authError?: string
    session: AuthSession
    signingOut: boolean
    signOut: () => Promise<void>
  }) => ReactNode
}

function centeredPage(content: ReactNode, includeSignInSeo = false) {
  return (
    <Box
      component="main"
      sx={{
        alignItems: "center",
        display: "flex",
        justifyContent: "center",
        minHeight: "100dvh",
        p: 2,
      }}
    >
      {includeSignInSeo ? <SignInSeo /> : null}
      {content}
    </Box>
  )
}

function sessionErrorMessage(error: Error): string {
  return error.message || "The session could not be loaded."
}

/** Marks the sign-in flow non-indexable; it is not public content. */
function SignInSeo() {
  useSeo({ title: "Sign in — RethinkLoop", noindex: true })
  return null
}

export function AuthGate({ anonymous, children }: AuthGateProps) {
  const sessionQuery = authClient.useSession()
  const queryClient = useQueryClient()
  const [signingIn, setSigningIn] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [actionError, setActionError] = useState<string>()
  const authConfigQuery = useQuery({
    queryKey: ["auth", "config"],
    queryFn: ({ signal }) => getAuthConfig(signal),
    enabled: anonymous === undefined,
    staleTime: Infinity,
  })

  if (sessionQuery.isPending) {
    return centeredPage(
      <Stack spacing={2} sx={{ alignItems: "center" }}>
        <CircularProgress aria-label="Loading session" />
        <Typography color="text.secondary">Loading your session…</Typography>
      </Stack>,
      anonymous === undefined,
    )
  }

  if (sessionQuery.error !== null) {
    return centeredPage(
      <Paper sx={{ maxWidth: 440, p: 3, width: "100%" }} variant="outlined">
        <Stack spacing={2}>
          <Typography component="h1" variant="h5">
            Session unavailable
          </Typography>
          <Alert severity="error">
            {sessionErrorMessage(sessionQuery.error)}
          </Alert>
          <Button
            onClick={() => void sessionQuery.refetch()}
            variant="contained"
          >
            Try again
          </Button>
        </Stack>
      </Paper>,
      anonymous === undefined,
    )
  }

  if (sessionQuery.data === null) {
    if (anonymous !== undefined) return anonymous

    const signInWithGitHub = async () => {
      setActionError(undefined)
      setSigningIn(true)
      try {
        const callbackURL = `${window.location.pathname}${window.location.search}`
        const result = await authClient.signIn.social({
          callbackURL,
          provider: "github",
        })
        if (result.error !== null) {
          setActionError(result.error.message ?? "GitHub sign-in failed.")
        }
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "GitHub sign-in failed.",
        )
      } finally {
        setSigningIn(false)
      }
    }

    const signInAsDebugUser = async () => {
      setActionError(undefined)
      setSigningIn(true)
      try {
        const response = await fetch("/api/auth/debug-sign-in", {
          method: "POST",
          headers: { "X-Debug-Auth": "1" },
        })
        if (!response.ok) {
          setActionError(`Debug sign-in failed (${response.status}).`)
          return
        }
        await sessionQuery.refetch()
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Debug sign-in failed.",
        )
      } finally {
        setSigningIn(false)
      }
    }

    return centeredPage(
      <Paper sx={{ maxWidth: 440, p: { xs: 3, sm: 4 }, width: "100%" }} variant="outlined">
        <Stack spacing={3}>
          <Stack spacing={1}>
            <Typography color="text.secondary" variant="overline">
              RethinkLoop
            </Typography>
            <Typography component="h1" variant="h4">
              Sign in to continue
            </Typography>
            <Typography color="text.secondary">
              Your research jobs and provider-backed tools are available only
              in an authenticated session.
            </Typography>
          </Stack>

          {actionError === undefined ? null : (
            <Alert severity="error">{actionError}</Alert>
          )}

          <Stack spacing={1.5}>
            <Button
              disabled={signingIn}
              onClick={() => void signInWithGitHub()}
              startIcon={<GitHub />}
              variant="contained"
            >
              Continue with GitHub
            </Button>
            {authConfigQuery.data?.debugUserEnabled === true ? (
              <Button
                disabled={signingIn}
                onClick={() => void signInAsDebugUser()}
                startIcon={<BugReportOutlined />}
                variant="outlined"
              >
                Continue as debug user
              </Button>
            ) : null}
          </Stack>

          <Typography color="text.secondary" variant="caption">
            By continuing, you agree to the{" "}
            <Link component={RouterLink} to="/terms">
              Terms &amp; Conditions
            </Link>{" "}
            and acknowledge the{" "}
            <Link component={RouterLink} to="/privacy">
              Privacy Policy
            </Link>
            .
          </Typography>
        </Stack>
      </Paper>,
      true,
    )
  }

  const signOut = async () => {
    setSigningOut(true)
    setActionError(undefined)
    try {
      const result = await authClient.signOut()
      if (result.error !== null) {
        throw new Error(result.error.message ?? "Sign-out failed.")
      }
      queryClient.clear()
      await sessionQuery.refetch()
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Sign-out failed.",
      )
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <>
      {children({
        authError: actionError,
        session: sessionQuery.data,
        signingOut,
        signOut,
      })}
    </>
  )
}
