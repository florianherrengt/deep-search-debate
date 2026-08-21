import Alert from "@mui/material/Alert"
import Button from "@mui/material/Button"
import type { ButtonProps } from "@mui/material/Button"
import Dialog from "@mui/material/Dialog"
import DialogContent from "@mui/material/DialogContent"
import DialogTitle from "@mui/material/DialogTitle"
import Link from "@mui/material/Link"
import Stack from "@mui/material/Stack"
import TextField from "@mui/material/TextField"
import Typography from "@mui/material/Typography"
import { useMutation } from "@tanstack/react-query"
import { useId, useState, type ReactNode, type SubmitEvent } from "react"
import { Link as RouterLink } from "react-router-dom"
import { joinWaitlist, waitlistEmailSchema } from "../../lib/waitlist.ts"
import { RequestError } from "../RequestError.tsx"

type JoinWaitlistButtonProps = Pick<
  ButtonProps,
  "color" | "endIcon" | "size" | "sx"
>

export function JoinWaitlistButton(props: JoinWaitlistButtonProps) {
  const [open, setOpen] = useState(false)
  const descriptionId = useId()

  return (
    <>
      <Button
        {...props}
        onClick={() => setOpen(true)}
        variant="contained"
      >
        Join the waiting list
      </Button>
      <Dialog
        aria-describedby={descriptionId}
        fullWidth
        maxWidth="xs"
        onClose={() => setOpen(false)}
        open={open}
      >
        <DialogTitle>Join the waiting list</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5}>
            <Typography color="text.secondary" id={descriptionId}>
              RethinkLoop is opening access gradually. Leave your email and
              we&apos;ll let you know when there&apos;s room.
            </Typography>
            <WaitlistForm
              closeAction={
                <Button onClick={() => setOpen(false)} variant="outlined">
                  Close
                </Button>
              }
            />
          </Stack>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function WaitlistForm({ closeAction }: { closeAction?: ReactNode }) {
  const [email, setEmail] = useState("")
  const parsedEmail = waitlistEmailSchema.safeParse(email)
  const showValidationError = email.trim().length > 0 && !parsedEmail.success
  const mutation = useMutation({
    mutationFn: (emailAddress: string) => joinWaitlist(emailAddress),
  })

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!parsedEmail.success || mutation.isPending) return
    mutation.mutate(parsedEmail.data)
  }

  if (mutation.isSuccess) {
    return (
      <Stack spacing={2}>
        <Alert severity="success">
          You’re on the waiting list. We’ll email you when access opens.
        </Alert>
        {closeAction}
      </Stack>
    )
  }

  return (
    <Stack component="form" onSubmit={submit} spacing={2}>
      <TextField
        autoComplete="email"
        error={showValidationError}
        fullWidth
        helperText={
          showValidationError ? "Enter a valid email address." : undefined
        }
        label="Email address"
        onChange={(event) => setEmail(event.target.value)}
        required
        slotProps={{ htmlInput: { inputMode: "email", maxLength: 254 } }}
        type="email"
        value={email}
      />
      {mutation.error ? <RequestError error={mutation.error} /> : null}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button
          disabled={!parsedEmail.success || mutation.isPending}
          type="submit"
          variant="contained"
        >
          {mutation.isPending ? "Joining…" : "Join waiting list"}
        </Button>
        {closeAction}
      </Stack>
      <Typography color="text.secondary" variant="caption">
        By joining, you acknowledge the{" "}
        <Link component={RouterLink} to="/privacy">
          Privacy Policy
        </Link>
        .
      </Typography>
    </Stack>
  )
}
