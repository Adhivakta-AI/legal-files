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

  float hash21(vec2 point) {
    point = fract(point * vec2(123.34, 456.21));
    point += dot(point, point + 45.32);
    return fract(point.x * point.y);
  }

  float valueNoise(vec2 point) {
    vec2 cell = floor(point);
    vec2 offset = fract(point);
    offset = offset * offset * (3.0 - 2.0 * offset);

    float bottomLeft = hash21(cell);
    float bottomRight = hash21(cell + vec2(1.0, 0.0));
    float topLeft = hash21(cell + vec2(0.0, 1.0));
    float topRight = hash21(cell + vec2(1.0, 1.0));

    return mix(
      mix(bottomLeft, bottomRight, offset.x),
      mix(topLeft, topRight, offset.x),
      offset.y
    ) * 2.0 - 1.0;
  }

  void main() {
    vec2 pixel = floor(gl_FragCoord.xy / u_pixelSize);
    vec2 uv = pixel * u_pixelSize / u_resolution;

    float radians = u_angle * 3.14159265 / 180.0;
    vec2 flow = vec2(cos(radians), sin(radians));
    float time = u_time * u_speed;

    float warpX = valueNoise(uv * u_scale * 1.5 + flow * time * 0.3) * u_warp;
    float warpY = valueNoise(
      uv * u_scale * 1.5 + flow.yx * time * 0.3 + vec2(5.2, 1.3)
    ) * u_warp;
    vec2 warped = uv + vec2(warpX, warpY);

    float rowDrift = sin(time * 1.5) * 0.04;
    float rowPosition = (warped.y + rowDrift) * u_lineCount;
    float rowIndex = floor(rowPosition);
    float rowOffset = fract(rowPosition);
    float band = smoothstep(0.0, 0.04, rowOffset) *
      smoothstep(u_lineWeight, u_lineWeight - 0.04, rowOffset);

    float segmentX = warped.x * u_scale * 3.0 + flow.x * time * 0.5;
    float segment = valueNoise(vec2(segmentX, rowIndex * 0.37 + time * 0.05));
    segment += 0.35 * valueNoise(vec2(segmentX * 2.5, rowIndex * 0.71 + 3.3));
    segment = segment * 0.5 + 0.5;

    float rowDensity = valueNoise(vec2(rowIndex * 0.23, time * 0.03 + 5.7)) *
      0.3 + 0.7;
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
    color += (u_foreground * 1.25 + u_glowColor * 0.12) *
      glowZone * u_glow * 0.18;

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

export function ApproachShader() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const panel = canvas?.parentElement
    if (!canvas || !panel) return

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
    if (!vertexShader || !fragmentShader) return

    const program = gl.createProgram()
    if (!program) return

    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program)
      return
    }

    gl.useProgram(program)

    const positionBuffer = gl.createBuffer()
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

      const bounds = panel.getBoundingClientRect()
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
      gl.uniform1f(uniforms.pixelSize, 14 * dpr)
      gl.uniform1f(uniforms.speed, 0.06)
      gl.uniform1f(uniforms.scale, 0.4)
      gl.uniform1f(uniforms.warp, 0.12)
      gl.uniform1f(uniforms.angle, 261)
      gl.uniform1f(uniforms.glow, 0.6)
      gl.uniform1f(uniforms.vertFade, 0.7)
      gl.uniform1f(uniforms.lineCount, 17)
      gl.uniform1f(uniforms.lineWeight, 0.16)
      gl.uniform3f(uniforms.foreground, 10 / 255, 10 / 255, 10 / 255)
      gl.uniform3f(uniforms.background, 18 / 255, 18 / 255, 18 / 255)
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

    observer.observe(panel.closest("section") ?? panel)

    return () => {
      disposed = true
      observer.disconnect()
      if (frame !== null) window.cancelAnimationFrame(frame)
      if (positionBuffer) gl.deleteBuffer(positionBuffer)
      gl.deleteProgram(program)
      gl.deleteShader(vertexShader)
      gl.deleteShader(fragmentShader)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      id="shader1"
      className="shader-bg how-shader-canvas"
      width={912}
      height={1360}
      aria-hidden="true"
    />
  )
}
