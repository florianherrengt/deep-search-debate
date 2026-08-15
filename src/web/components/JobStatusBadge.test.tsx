import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { JobStatusBadge } from "./JobStatusBadge.tsx"

describe("JobStatusBadge", () => {
  it.each([
    ["running", false, "Running"],
    ["running", true, "Stopping…"],
    ["interrupted", true, "Stopped"],
    ["interrupted", false, "Interrupted"],
  ] as const)(
    "presents %s with stopRequested=%s as %s",
    (status, stopRequested, label) => {
      render(
        <JobStatusBadge status={status} stopRequested={stopRequested} />,
      )

      expect(screen.getByText(label)).toBeVisible()
    },
  )
})
