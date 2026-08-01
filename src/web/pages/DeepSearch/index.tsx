import { type FormEvent, useState } from "react"
import { DeepSearchView } from "./components/DeepSearchView.tsx"
import { useDeepSearchJob } from "./useDeepSearchJob.ts"

export function DeepSearch() {
  const [researchRequest, setResearchRequest] = useState("")
  const { state: run, start } = useDeepSearchJob()

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const request = researchRequest.trim()
    if (!request || run.status === "running") return

    void start(request)
  }

  return (
    <DeepSearchView
      researchRequest={researchRequest}
      run={run}
      onResearchRequestChange={setResearchRequest}
      onSubmit={handleSubmit}
    />
  )
}
