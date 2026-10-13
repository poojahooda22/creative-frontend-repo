import vertexSource from './develop.vert'
import fragmentSource from './develop.frag'

export interface DevelopFrame {
  develop: number
  fog: number
  overexpose: number
  dud: number
  time: number
  seed: number
}

/** 'compiling' while the shader links in the background, 'lost' while the GPU context is gone. */
export type RendererStatus = 'compiling' | 'ready' | 'failed' | 'lost'

export interface PrintRenderer {
  /** The image to develop, or null to clear the surface for the next print. */
  setSource(source: ImageBitmap | null): void
  render(frame: DevelopFrame): void
  status(): RendererStatus
  /** Called after a lost GPU context is rebuilt, so the owner can draw again. */
  onRestored(listener: (() => void) | null): void
  dispose(): void
}

/**
 * A canvas and the renderer that owns it: WebGL2 when it can be set up, otherwise a plain
 * 2D crossfade on a fresh canvas, so a GPU problem never stops the upload UI.
 */
export function createPrintRenderer({ fallback = false } = {}): { canvas: HTMLCanvasElement; renderer: PrintRenderer } {
  if (!fallback) {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false })
    if (gl) {
      try {
        return { canvas, renderer: createWebGLRenderer(canvas, gl) }
      } catch (error) {
        console.warn('Instant film: WebGL2 develop unavailable, using the 2D fallback.', error)
        gl.getExtension('WEBGL_lose_context')?.loseContext()
      }
    }
  }
  const canvas = document.createElement('canvas')
  return { canvas, renderer: createCanvas2DRenderer(canvas) }
}

type UniformName =
  | 'uImage'
  | 'uHasImage'
  | 'uDevelop'
  | 'uFog'
  | 'uOverexpose'
  | 'uDud'
  | 'uTime'
  | 'uSeed'
  | 'uResolution'

interface GpuResources {
  program: WebGLProgram
  vao: WebGLVertexArrayObject
  texture: WebGLTexture
  uniforms: Record<UniformName, WebGLUniformLocation | null>
  status: 'compiling' | 'ready' | 'failed'
}

type ParallelCompile = { COMPLETION_STATUS_KHR: GLenum }

function shaderFrom(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Could not create a shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  return shader
}

/** Querying LINK_STATUS blocks until the driver finishes, so it is only asked once linking is done. */
function linkResult(gl: WebGL2RenderingContext, program: WebGLProgram): string | null {
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return null
  const shaderLogs = (gl.getAttachedShaders(program) ?? []).map((shader) => gl.getShaderInfoLog(shader)).filter(Boolean)
  return [gl.getProgramInfoLog(program), ...shaderLogs].filter(Boolean).join('\n')
}

function createResources(gl: WebGL2RenderingContext, parallel: ParallelCompile | null): GpuResources {
  const program = gl.createProgram()
  const vao = gl.createVertexArray()
  const texture = gl.createTexture()
  if (!program || !vao || !texture) throw new Error('Could not allocate WebGL resources for the print')

  gl.attachShader(program, shaderFrom(gl, gl.VERTEX_SHADER, vertexSource))
  gl.attachShader(program, shaderFrom(gl, gl.FRAGMENT_SHADER, fragmentSource))
  gl.linkProgram(program)
  // Without parallel compile the check happens now, so a broken shader still falls back to 2D at creation.
  if (!parallel) {
    const failure = linkResult(gl, program)
    if (failure) throw new Error(`Develop shader failed to build: ${failure}`)
  }

  gl.bindTexture(gl.TEXTURE_2D, texture)
  // Mipmaps: the 640 px source is often drawn at a third of that size, where plain LINEAR aliases fine type.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  const at = (name: UniformName) => gl.getUniformLocation(program, name)
  const uniforms = {
    uImage: at('uImage'),
    uHasImage: at('uHasImage'),
    uDevelop: at('uDevelop'),
    uFog: at('uFog'),
    uOverexpose: at('uOverexpose'),
    uDud: at('uDud'),
    uTime: at('uTime'),
    uSeed: at('uSeed'),
    uResolution: at('uResolution'),
  }
  return { program, vao, texture, uniforms, status: parallel ? 'compiling' : 'ready' }
}

function settleCompile(gl: WebGL2RenderingContext, parallel: ParallelCompile | null, resources: GpuResources) {
  if (resources.status !== 'compiling') return
  if (parallel && !gl.getProgramParameter(resources.program, parallel.COMPLETION_STATUS_KHR)) return
  const failure = linkResult(gl, resources.program)
  if (failure) console.error('Instant film: the develop shader failed to build.', failure)
  resources.status = failure ? 'failed' : 'ready'
}

function createWebGLRenderer(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext): PrintRenderer {
  // Compiles the shader off the main thread where supported, instead of stalling the first frame.
  // Extensions do not survive a context loss, so it is fetched again on restore.
  let parallel: ParallelCompile | null = gl.getExtension('KHR_parallel_shader_compile')
  let resources: GpuResources | null = createResources(gl, parallel)
  let source: ImageBitmap | null = null
  let restoredListener: (() => void) | null = null

  const upload = () => {
    if (!resources || !source) return
    gl.bindTexture(gl.TEXTURE_2D, resources.texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.generateMipmap(gl.TEXTURE_2D)
  }

  const onLost = (event: Event) => {
    event.preventDefault()
    resources = null
  }
  const onRestored = () => {
    parallel = gl.getExtension('KHR_parallel_shader_compile')
    resources = createResources(gl, parallel)
    upload()
    restoredListener?.()
  }
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)

  return {
    setSource(next) {
      source = next
      upload()
    },
    status() {
      if (!resources) return 'lost'
      settleCompile(gl, parallel, resources)
      return resources.status
    },
    onRestored(listener) {
      restoredListener = listener
    },
    render(frame) {
      if (!resources) return
      settleCompile(gl, parallel, resources)
      if (resources.status !== 'ready') return
      const { program, vao, texture, uniforms } = resources
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.useProgram(program)
      gl.bindVertexArray(vao)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.uniform1i(uniforms.uImage, 0)
      gl.uniform1f(uniforms.uHasImage, source ? 1 : 0)
      gl.uniform1f(uniforms.uDevelop, frame.develop)
      gl.uniform1f(uniforms.uFog, frame.fog)
      gl.uniform1f(uniforms.uOverexpose, frame.overexpose)
      gl.uniform1f(uniforms.uDud, frame.dud)
      gl.uniform1f(uniforms.uTime, frame.time)
      gl.uniform1f(uniforms.uSeed, frame.seed)
      gl.uniform2f(uniforms.uResolution, canvas.width, canvas.height)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      restoredListener = null
      if (resources) {
        for (const shader of gl.getAttachedShaders(resources.program) ?? []) gl.deleteShader(shader)
        gl.deleteTexture(resources.texture)
        gl.deleteVertexArray(resources.vao)
        gl.deleteProgram(resources.program)
        resources = null
      }
      // Release the context now instead of waiting for garbage collection; browsers cap live contexts.
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}

const OPACIFIER_HEX = '#1b2629'
const PAPER_HEX = '#f9f6ee'

function createCanvas2DRenderer(canvas: HTMLCanvasElement): PrintRenderer {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Neither WebGL2 nor a 2D canvas is available to draw the print')
  let source: ImageBitmap | null = null

  return {
    setSource(next) {
      source = next
    },
    status() {
      return 'ready'
    },
    onRestored() {},
    render(frame) {
      const { width, height } = canvas
      context.globalAlpha = 1
      context.fillStyle = OPACIFIER_HEX
      context.fillRect(0, 0, width, height)
      if (source) {
        // Paper first, so transparent pixels develop onto white like the WebGL path.
        context.globalAlpha = Math.max(0, Math.min(1, frame.develop * 1.15 - 0.1)) * (1 - frame.fog * 0.8)
        context.fillStyle = PAPER_HEX
        context.fillRect(0, 0, width, height)
        context.drawImage(source, 0, 0, width, height)
      }
      context.globalAlpha = frame.overexpose
      context.fillStyle = PAPER_HEX
      context.fillRect(0, 0, width, height)
      context.globalAlpha = 1
    },
    dispose() {},
  }
}
