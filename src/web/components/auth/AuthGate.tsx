import Alert from "@mui/material/Alert"
import Box from "@mui/material/Box"
import Button from "@mui/material/Button"
import CircularProgress from "@mui/material/CircularProgress"
import Paper from "@mui/material/Paper"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import { useQueryClient } from "@tanstack/react-query"
import { useState, type ReactNode } from "react"

import { authClient, type AuthSession } from "../../lib/authClient.ts"
import { useSeo } from "../../lib/seo.ts"
import { WaitlistForm } from "../waitlist/Waitlist.tsx"

interface AuthGateProps {
  anonymous?: ReactNode
  showAnonymousDuringSessionCheck?: boolean
  children: (props: {
    authError?: string
    session: AuthSession
    signingOut: boolean
    signOut: () => Promise<void>
  }) => ReactNode
}

function centeredPage(content: ReactNode, includeWaitlistSeo = false) {
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
      {includeWaitlistSeo ? <WaitlistSeo /> : null}
      {content}
    </Box>
  )
}

function sessionErrorMessage(error: Error): string {
  return error.message || "The session could not be loaded."
}

/** Marks the protected-route waitlist flow non-indexable. */
function WaitlistSeo() {
  useSeo({ title: "Join the waiting list — RethinkLoop", noindex: true })
  return null
}

export function AuthGate({
  anonymous,
  children,
  showAnonymousDuringSessionCheck = false,
}: AuthGateProps) {
  const sessionQuery = authClient.useSession()
  const queryClient = useQueryClient()
  const [signingOut, setSigningOut] = useState(false)
  const [actionError, setActionError] = useState<string>()

  if (
    showAnonymousDuringSessionCheck &&
    anonymous !== undefined &&
    (sessionQuery.data === null || sessionQuery.data === undefined)
  ) {
    return anonymous
  }

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

    return centeredPage(
      <Paper sx={{ maxWidth: 440, p: { xs: 3, sm: 4 }, width: "100%" }} variant="outlined">
        <Stack spacing={3}>
          <Stack spacing={1}>
            <Typography color="text.secondary" variant="overline">
              RethinkLoop
            </Typography>
            <Typography component="h1" variant="h4">
              Join the waiting list
            </Typography>
            <Typography color="text.secondary">
              RethinkLoop is opening access gradually. Leave your email and
              we&apos;ll let you know when there&apos;s room.
            </Typography>
          </Stack>
          <WaitlistForm />
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
