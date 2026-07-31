import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Test } from "./Test"

describe("Test", () => {
  it("renders the heading and button", () => {
    render(<Test />)
    expect(screen.getByText("Test Component")).toBeInTheDocument()
    expect(screen.getByText("Test Button")).toBeInTheDocument()
  })
})
