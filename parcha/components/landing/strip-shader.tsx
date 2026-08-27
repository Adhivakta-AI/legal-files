"use client"

import { useEffect, useRef } from "react"

const vertexShaderSource = `
  attribute vec2 a_position;

  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`

const fragmentShaderSource = `
  precision highp float;

  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_pixelSize;
  uniform float u_speed;
  uniform float u_scale;
  uniform float u_warp;
  uniform float u_angle;
  uniform float u_glow;
  uniform float u_vertFade;
  uniform float u_lineCount;
  uniform float u_lineWeight;
  uniform vec3 u_foreground;
  uniform vec3 u_background;
  uniform vec3 u_glowColor;

  vec3 mod289(vec3 value) {
    return value - floor(value * (1.0 / 289.0)) * 289.0;
  }

  vec2 mod289(vec2 value) {
    return value - floor(value * (1.0 / 289.0)) * 289.0;
  }

  vec3 permute(vec3 value) {
    return mod289(((value * 34.0) + 1.0) * value);
  }

  float simplexNoise(vec2 point) {
    const vec4 constants = vec4(
      0.211324865405187,
      0.366025403784439,
      -0.577350269189626,
      0.024390243902439
    );

    vec2 cell = floor(point + dot(point, constants.yy));
    vec2 pointZero = point - cell + dot(cell, constants.xx);
    vec2 corner = pointZero.x > pointZero.y
      ? vec2(1.0, 0.0)
      : vec2(0.0, 1.0);
    vec4 points = pointZero.xyxy + constants.xxzz;
    points.xy -= corner;
    cell = mod289(cell);

    vec3 permutation = permute(
      permute(cell.y + vec3(0.0, corner.y, 1.0)) +
      cell.x + vec3(0.0, corner.x, 1.0)
    );
    vec3 influence = max(
      0.5 - vec3(
        dot(pointZero, pointZero),
        dot(points.xy, points.xy),
        dot(points.zw, points.zw)
      ),
      0.0
    );
    influence *= influence;
    influence *= influence;

    vec3 x = 2.0 * fract(permutation * constants.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 offset = floor(x + 0.5);
    vec3 gradient = x - offset;
    influence *= 1.79284291400159 -
      0.85373472095314 * (gradient * gradient + h * h);

    vec3 contribution;
    contribution.x = gradient.x * pointZero.x + h.x * pointZero.y;
    contribution.yz = gradient.yz * points.xz + h.yz * points.yw;
    return 130.0 * dot(influence, contribution);
  }

  void main() {
    vec2 pixel = floor(gl_FragCoord.xy / u_pixelSize);
    vec2 uv = pixel * u_pixelSize / u_resolution;

    float radians = u_angle * 3.14159265 / 180.0;
    vec2 flow = vec2(cos(radians), sin(radians));
    float time = u_time * u_speed;

    float warpX = simplexNoise(
      uv * u_scale * 1.5 + flow * time * 0.3
    ) * u_warp;
    float warpY = simplexNoise(
      uv * u_scale * 1.5 + flow.yx * time * 0.3 + vec2(5.2, 1.3)
    ) * u_warp;
    vec2 warped = uv + vec2(warpX, warpY);

    float rowPosition = warped.y * u_lineCount;
    float rowIndex = floor(rowPosition);
    float rowOffset = fract(rowPosition);
    float band = smoothstep(0.0, 0.04, rowOffset) *
      smoothstep(u_lineWeight, u_lineWeight - 0.04, rowOffset);

    float segmentX = warped.x * u_scale * 3.0 + flow.x * time * 0.5;
    float segment = simplexNoise(
      vec2(segmentX, rowIndex * 0.37 + time * 0.05)
    );
    segment += 0.35 * simplexNoise(
      vec2(segmentX * 2.5, rowIndex * 0.71 + 3.3)
    );
    segment = segment * 0.5 + 0.5;

    float rowDensity = simplexNoise(
      vec2(rowIndex * 0.23, time * 0.03 + 5.7)
    ) * 0.3 + 0.7;
    float signal = band * segment * rowDensity;
    signal *= mix(1.0, pow(uv.y, 2.0), u_vertFade);

    float contour = fract(signal * u_lineCount);
    float contourDistance = min(contour, 1.0 - contour) * 2.0;
    float line = 1.0 - smoothstep(0.0, u_lineWeight, contourDistance);
    float dither = fract(pixel.y * 0.5);
    float result = step(dither, line);

    vec3 color = mix(u_background, u_foreground, result);
    float glowZone = 1.0 - smoothstep(
      0.0,
      u_lineWeight * 4.0,
      contourDistance
    );
    color += u_glowColor * glowZone * u_glow * 0.018;

    gl_FragColor = vec4(color, 1.0);
  }
`

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string
) {
  const shader = gl.createShader(type)
  if (!shader) return null

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader

  gl.deleteShader(shader)
  return null
}

function hexToRgb(color: string): [number, number, number] {
  const normalized = color.trim().replace("#", "")
  if (!/^[\da-f]{6}$/i.test(normalized)) return [57 / 255, 128 / 255, 221 / 255]

  return [
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255,
  ]
}

export function StripShader({ id }: { id: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrapper = canvas?.parentElement
    if (!canvas || !wrapper) return

    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
    })
    if (!gl) return

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
    const fragmentShader = compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      fragmentShaderSource
    )

    if (!vertexShader || !fragmentShader) {
      if (vertexShader) gl.deleteShader(vertexShader)
      if (fragmentShader) gl.deleteShader(fragmentShader)
      return
    }

    const program = gl.createProgram()
    if (!program) {
      gl.deleteShader(vertexShader)
      gl.deleteShader(fragmentShader)
      return
    }

    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program)
      gl.deleteShader(vertexShader)
      gl.deleteShader(fragmentShader)
      return
    }

    const positionBuffer = gl.createBuffer()
    if (!positionBuffer) {
      gl.deleteProgram(program)
      gl.deleteShader(vertexShader)
      gl.deleteShader(fragmentShader)
      return
    }

    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    )

    const position = gl.getAttribLocation(program, "a_position")
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

    const uniform = (name: string) => gl.getUniformLocation(program, name)
    const uniforms = {
      resolution: uniform("u_resolution"),
      time: uniform("u_time"),
      pixelSize: uniform("u_pixelSize"),
      speed: uniform("u_speed"),
      scale: uniform("u_scale"),
      warp: uniform("u_warp"),
      angle: uniform("u_angle"),
      glow: uniform("u_glow"),
      vertFade: uniform("u_vertFade"),
      lineCount: uniform("u_lineCount"),
      lineWeight: uniform("u_lineWeight"),
      foreground: uniform("u_foreground"),
      background: uniform("u_background"),
      glowColor: uniform("u_glowColor"),
    }

    const accent = hexToRgb(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--color-accent-500"
      )
    )
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches

    let frame: number | null = null
    let visible = false
    let disposed = false

    const draw = (timestamp: number) => {
      frame = null
      if (disposed || !visible) return

      const bounds = wrapper.getBoundingClientRect()
      if (bounds.width === 0 || bounds.height === 0) return

      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.round(bounds.width * dpr)
      const height = Math.round(bounds.height * dpr)

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }

      gl.viewport(0, 0, width, height)
      gl.uniform2f(uniforms.resolution, width, height)
      gl.uniform1f(uniforms.time, timestamp * 0.001)
      gl.uniform1f(uniforms.pixelSize, 8 * dpr)
      gl.uniform1f(uniforms.speed, 0.25)
      gl.uniform1f(uniforms.scale, 1.3)
      gl.uniform1f(uniforms.warp, 0.12)
      gl.uniform1f(uniforms.angle, 238)
      gl.uniform1f(uniforms.glow, 0.6)
      gl.uniform1f(uniforms.vertFade, 0.7)
      gl.uniform1f(uniforms.lineCount, 2)
      gl.uniform1f(uniforms.lineWeight, 0.12)
      gl.uniform3f(uniforms.foreground, 0, 0, 0)
      gl.uniform3fv(uniforms.background, accent)
      gl.uniform3fv(uniforms.glowColor, accent)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

      if (!reducedMotion) frame = window.requestAnimationFrame(draw)
    }

    const renderIfNeeded = () => {
      if (visible && frame === null) frame = window.requestAnimationFrame(draw)
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting
        if (visible) renderIfNeeded()
        else if (frame !== null) {
          window.cancelAnimationFrame(frame)
          frame = null
        }
      },
      { rootMargin: "200px 0px", threshold: 0 }
    )

    observer.observe(wrapper.closest("section") ?? wrapper)

    return () => {
      disposed = true
      observer.disconnect()
      if (frame !== null) window.cancelAnimationFrame(frame)
      gl.deleteBuffer(positionBuffer)
      gl.deleteProgram(program)
      gl.deleteShader(vertexShader)
      gl.deleteShader(fragmentShader)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      id={id}
      className="shader-bg intro-strip-canvas"
      aria-hidden="true"
    />
  )
}
