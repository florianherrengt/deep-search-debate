import { useState, type SyntheticEvent } from "react"
import Alert from "@mui/material/Alert"
import Button from "@mui/material/Button"
import MenuItem from "@mui/material/MenuItem"
import Paper from "@mui/material/Paper"
import Stack from "@mui/material/Stack"
import Table from "@mui/material/Table"
import TableBody from "@mui/material/TableBody"
import TableCell from "@mui/material/TableCell"
import TableContainer from "@mui/material/TableContainer"
import TableHead from "@mui/material/TableHead"
import TableRow from "@mui/material/TableRow"
import TextField from "@mui/material/TextField"
import Typography from "@mui/material/Typography"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { RequestError } from "../../components/RequestError.tsx"
import {
  adminUsersQueryKey,
  creditAccountQueryKey,
  getAdminUsers,
  grantUserCredits,
} from "../../lib/credits.ts"

export function AdminCredits() {
  const queryClient = useQueryClient()
  const users = useQuery({
    queryKey: adminUsersQueryKey,
    queryFn: ({ signal }) => getAdminUsers(signal),
  })
  const [selectedUserId, setSelectedUserId] = useState("")
  const [amount, setAmount] = useState("1000")
  const grant = useMutation({
    mutationFn: grantUserCredits,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminUsersQueryKey }),
        queryClient.invalidateQueries({ queryKey: creditAccountQueryKey }),
      ])
    },
  })

  const effectiveUserId = selectedUserId || users.data?.users[0]?.id || ""

  const parsedAmount = Number(amount)
  const canSubmit =
    effectiveUserId.length > 0 &&
    Number.isSafeInteger(parsedAmount) &&
    parsedAmount > 0 &&
    parsedAmount <= 100_000_000

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return
    grant.mutate({ userId: effectiveUserId, credits: parsedAmount })
  }

  return (
    <Stack spacing={3}>
      <Stack spacing={0.5}>
        <Typography component="h1" variant="h4">
          Credit administration
        </Typography>
        <Typography color="text.secondary">
          Add credits to an account. Grants increment the current balance.
        </Typography>
      </Stack>

      <Paper component="form" onSubmit={submit} sx={{ p: 2.5 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{ alignItems: { sm: "flex-start" } }}
        >
          <TextField
            label="User"
            onChange={(event) => setSelectedUserId(event.target.value)}
            select
            sx={{ flex: 1, minWidth: 240 }}
            value={effectiveUserId}
          >
            {users.data?.users.map((account) => (
              <MenuItem key={account.id} value={account.id}>
                {account.email}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Credits to add"
            onChange={(event) => setAmount(event.target.value)}
            type="number"
            value={amount}
            slotProps={{
              htmlInput: { min: 1, max: 100_000_000, step: 1 },
            }}
          />
          <Button
            disabled={!canSubmit || grant.isPending}
            size="large"
            type="submit"
            variant="contained"
          >
            {grant.isPending ? "Adding…" : "Add credits"}
          </Button>
        </Stack>
      </Paper>

      {grant.isSuccess ? (
        <Alert severity="success">Credits added successfully.</Alert>
      ) : null}
      {grant.error ? <RequestError error={grant.error} /> : null}
      {users.error ? (
        <RequestError error={users.error} onRetry={() => void users.refetch()} />
      ) : null}

      <TableContainer component={Paper}>
        <Table aria-label="User credit balances">
          <TableHead>
            <TableRow>
              <TableCell>User</TableCell>
              <TableCell>Email</TableCell>
              <TableCell align="right">Credits</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.data?.users.map((account) => (
              <TableRow key={account.id}>
                <TableCell>
                  {account.name}
                  {account.isAdmin ? " (admin)" : ""}
                </TableCell>
                <TableCell>{account.email}</TableCell>
                <TableCell align="right">
                  {account.credits.toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  )
}
