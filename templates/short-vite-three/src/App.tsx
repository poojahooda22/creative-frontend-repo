import { useEffect, useRef } from 'react'
import { Stage } from './stage'
import { createScene } from './scene'

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const stage = new Stage(container)
    stage.start(createScene(stage))
    return () => stage.dispose()
  }, [])

  return <div ref={containerRef} className="stage" />
}
