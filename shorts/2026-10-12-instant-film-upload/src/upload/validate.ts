import type { Failure, UploadCandidate } from './types'

export type FileKind = 'image' | 'pdf' | 'csv'

interface Format {
  kind: FileKind
  extensions: readonly string[]
  mimes: readonly string[]
}

const FORMATS: readonly Format[] = [
  { kind: 'image', extensions: ['png'], mimes: ['image/png'] },
  { kind: 'image', extensions: ['jpg', 'jpeg'], mimes: ['image/jpeg'] },
  { kind: 'image', extensions: ['webp'], mimes: ['image/webp'] },
  { kind: 'image', extensions: ['gif'], mimes: ['image/gif'] },
  { kind: 'pdf', extensions: ['pdf'], mimes: ['application/pdf'] },
  // Windows reports .csv files as application/vnd.ms-excel.
  { kind: 'csv', extensions: ['csv'], mimes: ['text/csv', 'application/vnd.ms-excel'] },
]

export const MAX_BYTES = 25 * 1024 * 1024
export const FORMAT_LIST = 'PNG, JPG, WebP, GIF, PDF or CSV'
export const ACCEPT_ATTRIBUTE = FORMATS.flatMap((format) => [
  ...format.extensions.map((extension) => `.${extension}`),
  ...format.mimes,
]).join(',')

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function kindOf(name: string): FileKind | null {
  const extension = extensionOf(name)
  return FORMATS.find((format) => format.extensions.includes(extension))?.kind ?? null
}

/**
 * During a drag the browser exposes MIME types but not names. An empty type is
 * unknown rather than wrong, so only a known, unsupported type is rejected early.
 */
export function mimeMightBeAccepted(mime: string): boolean {
  return mime === '' || FORMATS.some((format) => format.mimes.includes(mime))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  const megabytes = bytes / (1024 * 1024)
  return `${megabytes < 10 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`
}

export function validate(candidate: UploadCandidate): Failure | null {
  if (kindOf(candidate.name) === null) {
    const extension = extensionOf(candidate.name)
    const what = extension ? `.${extension} files aren't supported` : "Files without an extension aren't supported"
    return { kind: 'type', title: `Can't upload ${candidate.name}`, detail: `${what}. Use ${FORMAT_LIST}.` }
  }
  if (candidate.size > MAX_BYTES) {
    return {
      kind: 'size',
      title: `${candidate.name} is ${formatBytes(candidate.size)}`,
      detail: `The limit is ${formatBytes(MAX_BYTES)}. Export a smaller file and try again.`,
    }
  }
  return null
}
