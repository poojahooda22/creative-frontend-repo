// The few WebGL2 pieces this short needs: one program, its uniforms, one texture.
// Every uniform value lives in a Float32Array; scalars are length 1.

export type Uniforms = Record<string, Float32Array>

interface UniformSlot {
  name: string
  location: WebGLUniformLocation
  type: number
}

export interface Program {
  program: WebGLProgram
  // An array walked by index every frame: iterating a Map allocates an entry per uniform.
  slots: UniformSlot[]
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('createShader returned null (context lost?)')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  return shader
}

/**
 * Starts compiling and linking. With KHR_parallel_shader_compile the driver works off the main
 * thread; call `isReady` each frame and `finishProgram` once it reports true.
 */
export function startProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram()
  if (!program) throw new Error('createProgram returned null (context lost?)')
  const vs = compile(gl, gl.VERTEX_SHADER, vertex)
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment)
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  // Flagged for deletion now; freed with the program, and their logs stay readable until then.
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  return program
}

export function isReady(gl: WebGL2RenderingContext, program: WebGLProgram, parallel: KHR_parallel_shader_compile | null): boolean {
  if (!parallel) return true
  const done: boolean = gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)
  return done
}

/** Checks the link and reflects the active uniforms. Throws with the driver's log on failure. */
export function finishProgram(gl: WebGL2RenderingContext, program: WebGLProgram): Program {
  const linked: boolean = gl.getProgramParameter(program, gl.LINK_STATUS)
  if (!linked) {
    const shaders = gl.getAttachedShaders(program) ?? []
    const logs = shaders.map((s) => gl.getShaderInfoLog(s)).filter(Boolean)
    throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program) ?? ''} ${logs.join('\n')}`)
  }
  const uploadable: number[] = [gl.FLOAT, gl.FLOAT_VEC2, gl.FLOAT_VEC3, gl.FLOAT_VEC4, gl.FLOAT_MAT3, gl.INT, gl.SAMPLER_2D]
  const slots: UniformSlot[] = []
  const count: number = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS)
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i)
    if (!info) continue
    const location = gl.getUniformLocation(program, info.name)
    if (!location) continue
    // Arrays report as "uLobe[0]"; the base name sets the whole array.
    const name = info.name.replace(/\[0\]$/, '')
    if (!uploadable.includes(info.type)) {
      throw new Error(`Uniform ${name} has a type this short does not upload (0x${info.type.toString(16)})`)
    }
    slots.push({ name, location, type: info.type })
  }
  return { program, slots }
}

/** Uploads every value whose name the program uses. Unused names (optimised out) are skipped. */
export function applyUniforms(gl: WebGL2RenderingContext, program: Program, values: Uniforms): void {
  const slots = program.slots
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    const v = values[slot.name]
    if (!v) continue
    switch (slot.type) {
      case gl.FLOAT:
        gl.uniform1fv(slot.location, v)
        break
      case gl.FLOAT_VEC2:
        gl.uniform2fv(slot.location, v)
        break
      case gl.FLOAT_VEC3:
        gl.uniform3fv(slot.location, v)
        break
      case gl.FLOAT_VEC4:
        gl.uniform4fv(slot.location, v)
        break
      case gl.FLOAT_MAT3:
        gl.uniformMatrix3fv(slot.location, false, v)
        break
      default:
        // INT and SAMPLER_2D; finishProgram admitted no other type.
        gl.uniform1i(slot.location, v[0])
    }
  }
}

/** A single-channel, mipmapped texture: the label atlas. */
export function createCoverageTexture(gl: WebGL2RenderingContext, data: Uint8Array, width: number, height: number): WebGLTexture {
  const texture = gl.createTexture()
  if (!texture) throw new Error('createTexture returned null (context lost?)')
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, data)
  gl.generateMipmap(gl.TEXTURE_2D)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return texture
}
