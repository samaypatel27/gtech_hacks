import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { buildVial, isWebglAvailable, makeShadowTexture } from './vialRenderer.js'
import StaticVialSvg from './StaticVialSvg.jsx'

const FULL_TURN_SECONDS = 12
const RESUME_AUTOROTATE_MS = 1500
const FLOAT_AMPLITUDE = 0.045
const FLOAT_SPEED = 1.1

// A 3D glass vial, rotating continuously and draggable via OrbitControls
// (rotate only). Falls back to a static SVG when WebGL is missing. The
// vial itself (geometry/materials) is built by vialRenderer.js, shared
// with the static per-card thumbnail snapshots on the search grid.
function DrugVial({ statusColor, statusColorHex }) {
  const mountRef = useRef(null)
  const [webglOk] = useState(isWebglAvailable)
  const useStatic = !webglOk

  useEffect(() => {
    if (useStatic) return
    const mount = mountRef.current
    if (!mount) return

    let raf
    let resumeTimer = null
    let dragging = false

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100)
    camera.position.set(0, 0.65, 5)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    mount.appendChild(renderer.domElement)

    const pmrem = new THREE.PMREMGenerator(renderer)
    const envScene = new RoomEnvironment()
    const envTexture = pmrem.fromScene(envScene).texture
    scene.environment = envTexture

    const ambient = new THREE.AmbientLight(0xffffff, 0.5)
    const key = new THREE.DirectionalLight(0xffffff, 1.1)
    key.position.set(2, 3, 2)
    scene.add(ambient, key)

    const { group: vialGroup, disposables } = buildVial({ statusColor, statusColorHex })
    scene.add(vialGroup)

    const shadowTexture = makeShadowTexture()
    const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false })
    const shadowGeo = new THREE.PlaneGeometry(2, 1)
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat)
    shadowMesh.rotation.x = -Math.PI / 2
    shadowMesh.position.y = -0.98
    scene.add(shadowMesh)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableZoom = false
    controls.enablePan = false
    controls.enableRotate = true
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.target.set(0, 0.2, 0)
    controls.update()

    const handleStart = () => {
      dragging = true
      if (resumeTimer) clearTimeout(resumeTimer)
    }
    const handleEnd = () => {
      resumeTimer = setTimeout(() => {
        dragging = false
      }, RESUME_AUTOROTATE_MS)
    }
    controls.addEventListener('start', handleStart)
    controls.addEventListener('end', handleEnd)

    const clock = new THREE.Clock()
    const spinSpeed = (Math.PI * 2) / FULL_TURN_SECONDS
    const baseY = vialGroup.position.y

    const renderLoop = () => {
      const dt = clock.getDelta()
      const t = clock.getElapsedTime()
      if (!dragging) {
        vialGroup.rotation.y += dt * spinSpeed
      }
      vialGroup.position.y = baseY + Math.sin(t * FLOAT_SPEED) * FLOAT_AMPLITUDE
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(renderLoop)
    }

    const handleVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf)
      } else {
        clock.getDelta()
        raf = requestAnimationFrame(renderLoop)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      const { width, height } = entry.contentRect
      if (width === 0 || height === 0) return
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    })
    resizeObserver.observe(mount)

    raf = requestAnimationFrame(renderLoop)

    return () => {
      cancelAnimationFrame(raf)
      if (resumeTimer) clearTimeout(resumeTimer)
      document.removeEventListener('visibilitychange', handleVisibility)
      resizeObserver.disconnect()
      controls.removeEventListener('start', handleStart)
      controls.removeEventListener('end', handleEnd)
      controls.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)

      disposables.forEach((d) => d.dispose())
      shadowGeo.dispose()
      shadowMat.dispose()
      shadowTexture.dispose()
      envTexture.dispose()
      pmrem.dispose()
      renderer.dispose()
    }
  }, [useStatic, statusColor, statusColorHex])

  if (useStatic) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <StaticVialSvg statusColor={statusColor} />
      </div>
    )
  }

  return <div ref={mountRef} className="h-full w-full" aria-hidden="true" />
}

export default DrugVial
