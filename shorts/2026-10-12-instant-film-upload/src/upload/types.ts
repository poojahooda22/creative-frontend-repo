export type FailureKind = 'type' | 'size' | 'network'

export interface Failure {
  kind: FailureKind
  title: string
  detail: string
}

export interface UploadCandidate {
  name: string
  size: number
  type: string
  /** The bytes. Only candidates that fail validation may omit them. */
  blob?: Blob
}

export type UploadStatus = 'queued' | 'uploading' | 'uploaded' | 'failed'

/** What the server returned for a stored file. */
export interface UploadResult {
  id: string
  url?: string
}

export interface UploadItem {
  id: string
  name: string
  size: number
  blob?: Blob
  status: UploadStatus
  /** Fraction of the file the transport has confirmed, from 0 to 1. */
  progress: number
  failure?: Failure
  result?: UploadResult
  /** Object URL of what the gallery shows: the file itself, or a rendered card for a document. */
  preview?: string
  /** The camera has finished developing this file's print. */
  revealed: boolean
  /** The file has left the camera: filed to the gallery, or dismissed. */
  filed: boolean
}

export interface TransportCallbacks {
  onProgress: (fraction: number) => void
  signal: AbortSignal
}

/** Sends one file. Resolves with the stored asset, and rejects on failure or abort. */
export type Transport = (blob: Blob, callbacks: TransportCallbacks) => Promise<UploadResult>
