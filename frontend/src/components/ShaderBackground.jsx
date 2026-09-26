import { useEffect, useRef } from 'react'
import * as THREE from 'three'

// Full-screen triangle in clip space — no camera transform needed.
const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`

// 2-3 octave simplex-noise fbm, driving slow-drifting dark blobs.
// Palette: pure black base, dark navy blobs, subtle blue-purple edges.
const fragmentShader = `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2 uResolution;

  // Ashima Arts 2D simplex noise (webgl-noise, MIT)
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                         -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                    + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 3; i++) {
      value += amplitude * snoise(p);
      p *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    float aspect = uResolution.x / uResolution.y;
    // Frequency tuned so a handful of distinct chunky blobs fit the
    // screen, each with room to breathe (not one giant shape, not a
    // dense marbled network).
    vec2 p = vec2(vUv.x * aspect, vUv.y) * 1.0;

    // Very slow "breathing" drift. No domain warp: warping folded the
    // noise into an all-over marbled/vein pattern instead of a few big blobs.
    float t = uTime * 0.03;
    float n = fbm(p + vec2(t, -t * 0.6));

    // Threshold tuned so blobs stay thick and solid ("ink diffusing in
    // water") while most of the frame stays pure black.
    float blob = smoothstep(-0.05, 0.55, n);

    vec3 black = vec3(0.0);
    vec3 navy = vec3(0.0392, 0.0392, 0.1020);   // #0a0a1a
    vec3 purple = vec3(0.1020, 0.1020, 0.2275); // #1a1a3a

    vec3 color = mix(black, navy, blob);

    float edge = clamp(fwidth(n) * 6.0, 0.0, 1.0);
    color = mix(color, purple, edge * blob * 0.5);

    gl_FragColor = vec4(color, 1.0);
  }
`

function ShaderBackground() {
  const mountRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    const renderer = new THREE.WebGLRenderer({ antialias: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(window.innerWidth, window.innerHeight)
    mount.appendChild(renderer.domElement)

    const uniforms = {
      uTime: { value: 0 },
      uResolution: {
        value: new THREE.Vector2(window.innerWidth, window.innerHeight),
      },
    }

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
    })
    material.extensions.derivatives = true

    const geometry = new THREE.PlaneGeometry(2, 2)
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    const clock = new THREE.Clock()
    renderer.setAnimationLoop(() => {
      uniforms.uTime.value = clock.getElapsedTime()
      renderer.render(scene, camera)
    })

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight)
      uniforms.uResolution.value.set(window.innerWidth, window.innerHeight)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      renderer.setAnimationLoop(null)
      window.removeEventListener('resize', handleResize)
      mount.removeChild(renderer.domElement)
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    }
  }, [])

  return (
    <div
      ref={mountRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        zIndex: -1,
      }}
    />
  )
}

export default ShaderBackground
