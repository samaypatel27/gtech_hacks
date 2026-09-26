// Shared glass-vial geometry/material/label-texture builder, used by both
// the interactive spinning vial on the drug detail page (DrugVial.jsx) and
// the static per-card thumbnail snapshots on the search grid (DrugCard.jsx)
// -- so both render the exact same vial from one definition.
import * as THREE from 'three'
import { PMREMGenerator, WebGLRenderer } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

export function isWebglAvailable() {
  try {
    const canvas = document.createElement('canvas')
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl2') || canvas.getContext('webgl'))
    )
  } catch {
    return false
  }
}

export function makeShadowTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(0,0,0,0.4)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}

// Builds the vial mesh group. Returns the group plus every disposable
// (geometry/material/texture) it created, so the caller can dispose them
// without having to walk the scene graph.
export function buildVial({ statusColor, statusColorHex }) {
  const group = new THREE.Group()
  const disposables = []
  const track = (obj) => {
    disposables.push(obj)
    return obj
  }

  // Body + shoulder + neck as one revolved profile.
  const profile = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.55, 0),
    new THREE.Vector2(0.55, 1.45),
    new THREE.Vector2(0.5, 1.6),
    new THREE.Vector2(0.24, 1.82),
    new THREE.Vector2(0.24, 2.02),
    new THREE.Vector2(0, 2.02),
  ]
  const bodyGeo = track(new THREE.LatheGeometry(profile, 40))
  const glassMat = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 1,
      thickness: 0.4,
      roughness: 0.06,
      ior: 1.5,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      transparent: true,
      opacity: 0.35,
    }),
  )
  const body = new THREE.Mesh(bodyGeo, glassMat)
  group.add(body)

  // Liquid filled to ~70% of the straight body section.
  const liquidProfile = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.48, 0),
    new THREE.Vector2(0.48, 1.02),
    new THREE.Vector2(0.4, 1.06),
    new THREE.Vector2(0, 1.06),
  ]
  const liquidGeo = track(new THREE.LatheGeometry(liquidProfile, 40))
  const liquidMat = track(
    new THREE.MeshPhysicalMaterial({
      color: statusColorHex,
      transmission: 0.55,
      roughness: 0.3,
      transparent: true,
      opacity: 0.55,
    }),
  )
  const liquid = new THREE.Mesh(liquidGeo, liquidMat)
  liquid.position.y = 0.06
  group.add(liquid)

  // Metal crimp band at the neck.
  const bandGeo = track(new THREE.CylinderGeometry(0.27, 0.27, 0.12, 32))
  const bandMat = track(new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 1, roughness: 0.35 }))
  const band = new THREE.Mesh(bandGeo, bandMat)
  band.position.y = 1.94
  group.add(band)

  // Cap in the drug's status color.
  const capGeo = track(new THREE.CylinderGeometry(0.22, 0.24, 0.24, 32))
  const capMat = track(new THREE.MeshStandardMaterial({ color: statusColorHex, roughness: 0.55, metalness: 0.05 }))
  const cap = new THREE.Mesh(capGeo, capMat)
  cap.position.y = 2.14
  group.add(cap)

  group.position.y = -0.9

  return { group, disposables, statusColor }
}

// One offscreen renderer + environment map, lazily created and reused for
// every card's snapshot. Rendering 20+ live WebGL canvases at once would
// risk hitting the browser's concurrent-context limit; a single shared
// renderer produces a still PNG per card instead, so only one context is
// ever open regardless of grid size.
let sharedRenderer = null
let sharedEnvTexture = null

function getSharedRenderer(width, height) {
  if (!sharedRenderer) {
    sharedRenderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    sharedRenderer.setPixelRatio(1)
    const pmrem = new PMREMGenerator(sharedRenderer)
    sharedEnvTexture = pmrem.fromScene(new RoomEnvironment()).texture
    pmrem.dispose()
  }
  sharedRenderer.setSize(width, height, false)
  return sharedRenderer
}

const snapshotCache = new Map()

// Renders one still frame of the vial (fixed 3/4 turn, not spinning) and
// returns a PNG data URL, or null if WebGL isn't available. Cached per
// applicationId so remounting a card (e.g. after a filter change) doesn't
// re-render it.
export function renderVialSnapshot({
  applicationId,
  statusColor,
  statusColorHex,
  width = 240,
  height = 300,
}) {
  if (snapshotCache.has(applicationId)) return snapshotCache.get(applicationId)
  if (!isWebglAvailable()) return null

  const renderer = getSharedRenderer(width, height)

  const scene = new THREE.Scene()
  scene.environment = sharedEnvTexture

  const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100)
  camera.position.set(0, 0.5, 5)
  camera.lookAt(0, 0.1, 0)

  const ambient = new THREE.AmbientLight(0xffffff, 0.5)
  const key = new THREE.DirectionalLight(0xffffff, 1.1)
  key.position.set(2, 3, 2)
  scene.add(ambient, key)

  const { group: vialGroup, disposables } = buildVial({ statusColor, statusColorHex })
  vialGroup.rotation.y = 0.6
  scene.add(vialGroup)

  const shadowTexture = makeShadowTexture()
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false })
  const shadowGeo = new THREE.PlaneGeometry(2, 1)
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat)
  shadowMesh.rotation.x = -Math.PI / 2
  shadowMesh.position.y = -0.98
  scene.add(shadowMesh)

  renderer.render(scene, camera)
  const dataUrl = renderer.domElement.toDataURL('image/png')

  disposables.forEach((d) => d.dispose())
  shadowGeo.dispose()
  shadowMat.dispose()
  shadowTexture.dispose()

  snapshotCache.set(applicationId, dataUrl)
  return dataUrl
}
