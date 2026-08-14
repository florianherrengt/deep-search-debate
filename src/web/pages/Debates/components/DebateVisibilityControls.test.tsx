import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DebateVisibilityControls } from "./DebateVisibilityControls.tsx"

const shareUrl = "https://rethinkloop.com/debates/example"

describe("DebateVisibilityControls", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("keeps publishing behind a compact share action", () => {
    const onChange = vi.fn()
    render(
      <DebateVisibilityControls
        canMakePrivate
        isPending={false}
        isPublic={false}
        onChange={onChange}
        onClose={vi.fn()}
        shareUrl={shareUrl}
      />,
    )

    expect(screen.getByText("Private")).toBeVisible()
    expect(screen.queryByText("This debate is private")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Share" }))
    expect(
      screen.getByRole("heading", { name: "Share debate" }),
    ).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "Make public" }))

    expect(onChange).toHaveBeenCalledWith(true)
  })

  it("copies the public URL from the share dialog", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    })
    render(
      <DebateVisibilityControls
        canMakePrivate
        isPending={false}
        isPublic
        onChange={vi.fn()}
        onClose={vi.fn()}
        shareUrl={shareUrl}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Share" }))
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(shareUrl))
    expect(screen.getByRole("button", { name: "Copied" })).toBeVisible()
  })

  it("explains why a live public debate cannot be made private", () => {
    render(
      <DebateVisibilityControls
        canMakePrivate={false}
        isPending={false}
        isPublic
        onChange={vi.fn()}
        onClose={vi.fn()}
        shareUrl={shareUrl}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Share" }))

    expect(
      screen.getByText(
        "A live public debate can be made private after it finishes.",
      ),
    ).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "Make private" }),
    ).not.toBeInTheDocument()
  })

  it("keeps the dialog open while publishing so a deferred failure stays visible", () => {
    const onChange = vi.fn()
    const onClose = vi.fn()
    const { rerender } = render(
      <DebateVisibilityControls
        canMakePrivate
        isPending={false}
        isPublic={false}
        onChange={onChange}
        onClose={onClose}
        shareUrl={shareUrl}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Share" }))
    fireEvent.click(screen.getByRole("button", { name: "Make public" }))
    expect(onChange).toHaveBeenCalledWith(true)

    rerender(
      <DebateVisibilityControls
        canMakePrivate
        isPending
        isPublic={false}
        onChange={onChange}
        onClose={onClose}
        shareUrl={shareUrl}
      />,
    )

    const closeButton = screen.getByRole("button", { name: "Close" })
    expect(closeButton).toBeDisabled()
    fireEvent.click(closeButton)
    expect(
      screen.getByRole("heading", { name: "Share debate" }),
    ).toBeVisible()
    expect(onClose).not.toHaveBeenCalled()

    rerender(
      <DebateVisibilityControls
        canMakePrivate
        error="Visibility could not be updated. Try again."
        isPending={false}
        isPublic={false}
        onChange={onChange}
        onClose={onClose}
        shareUrl={shareUrl}
      />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Visibility could not be updated. Try again.",
    )
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it.each(["resolve", "reject"] as const)(
    "ignores a clipboard %s from a closed dialog when it is reopened",
    async (outcome) => {
      let settleClipboard: () => void = () => undefined
      const clipboardResult = new Promise<void>((resolve, reject) => {
        settleClipboard =
          outcome === "resolve"
            ? resolve
            : () => reject(new Error("Clipboard permission denied"))
      })
      vi.stubGlobal("navigator", {
        ...navigator,
        clipboard: { writeText: vi.fn().mockReturnValue(clipboardResult) },
      })
      render(
        <DebateVisibilityControls
          canMakePrivate
          isPending={false}
          isPublic
          onChange={vi.fn()}
          onClose={vi.fn()}
          shareUrl={shareUrl}
        />,
      )

      fireEvent.click(screen.getByRole("button", { name: "Share" }))
      fireEvent.click(screen.getByRole("button", { name: "Copy link" }))
      fireEvent.click(screen.getByRole("button", { name: "Close" }))
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      )
      fireEvent.click(screen.getByRole("button", { name: "Share" }))

      await act(async () => {
        settleClipboard()
        await clipboardResult.catch(() => undefined)
      })

      expect(screen.getByRole("button", { name: "Copy link" })).toBeVisible()
      expect(
        screen.queryByText("The link could not be copied."),
      ).not.toBeInTheDocument()
    },
  )
})
