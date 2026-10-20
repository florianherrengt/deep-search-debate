import { once } from "node:events"
import { getDocumentProxy } from "unpdf"
import { extractPdfText } from "./pdfText.ts"
import type { PdfProcessRequest } from "./pdfProcessProtocol.ts"

if (!process.send) throw new Error("PDF parser must run as a child process with IPC")
const send = process.send.bind(process)

const [request] = (await once(process, "message")) as [PdfProcessRequest]
const document = await getDocumentProxy(new Uint8Array(request.bytes), { verbosity: 0 })
let result
try {
  result = await extractPdfText(document, request.maxPages, request.maxTextChars)
} finally {
  await document.destroy().catch(() => undefined)
}

await new Promise<void>((resolve, reject) => {
  send(result, (error) => {
    if (error) reject(error)
    else resolve()
  })
})
if (process.connected) process.disconnect?.()
