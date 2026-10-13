import type { UploadItem } from './types'
import { FORMAT_LIST, MAX_BYTES, formatBytes } from './validate'

export type DragState = 'none' | 'page' | 'over' | 'invalid'

interface UploadStatusProps {
  drag: DragState
  /** Whether a drop anywhere on the page is accepted, or only on the camera. */
  acceptsPageDrops: boolean
  staged: UploadItem | undefined
  /** Other files still queued or uploading behind the one in the camera. */
  inProgress: number
}

const LIMITS = `${FORMAT_LIST}, up to ${formatBytes(MAX_BYTES)}.`

/** The words beside the ready light: what the camera is doing. Its buttons live in the camera. */
export function UploadStatus({ drag, acceptsPageDrops, staged, inProgress }: UploadStatusProps) {
  const others = inProgress > 0 ? `, ${inProgress} more in progress` : ''

  if (drag === 'invalid') {
    return (
      <div className="camera__status" data-tone="error">
        <p className="camera__title">This file type can't be uploaded</p>
        <p className="camera__detail">Use {FORMAT_LIST}.</p>
      </div>
    )
  }
  if (drag !== 'none') {
    const title = drag === 'over' ? 'Release to upload' : acceptsPageDrops ? 'Drop anywhere on this page' : 'Drop on the camera to upload'
    return (
      <div className="camera__status" data-tone="ready">
        <p className="camera__title">{title}</p>
        <p className="camera__detail">{LIMITS}</p>
      </div>
    )
  }

  if (!staged) {
    return (
      <div className="camera__status">
        <p className="camera__title">Drop photos or documents</p>
        <p className="camera__detail">{LIMITS} You can also paste an image.</p>
      </div>
    )
  }

  if (staged.status === 'failed' && staged.failure) {
    return (
      <div className="camera__status" data-tone="error">
        <p className="camera__title">{staged.failure.title}</p>
        <p className="camera__detail">{staged.failure.detail}</p>
      </div>
    )
  }

  if (staged.status === 'uploaded') {
    return (
      <div className="camera__status" data-tone="done">
        <p className="camera__title">{staged.name} uploaded</p>
        <p className="camera__detail">
          {formatBytes(staged.size)}
          {others}
        </p>
      </div>
    )
  }

  const percent = Math.round(staged.progress * 100)
  const sent = `${percent}% of ${formatBytes(staged.size)}`
  return (
    <div className="camera__status">
      <p className="camera__title">Uploading {staged.name}</p>
      <p className="camera__detail">
        {/* A progressbar's children are presentational, so its full reading goes in aria-valuetext. */}
        <span
          role="progressbar"
          aria-label={`Uploading ${staged.name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={sent}
        >
          {/* Tabular figures on the changing number only; in this face they also widen punctuation. */}
          <span className="tabular">{percent}%</span> of {formatBytes(staged.size)}
        </span>
        {others}
      </p>
    </div>
  )
}
