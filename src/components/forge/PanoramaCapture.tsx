'use client'

// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// PanoramaCapture — Ctrl+Shift+P → equirectangular panorama export
// CubeCamera renders 6 faces → shader converts to equirect → JPEG download
// v2: 1024 cube faces → 4096×2048 equirect, JPEG 90%, proper lighting
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import * as THREE from 'three'

export default function PanoramaCapture() {
  const { gl, scene, camera } = useThree()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault()
        capture()
      }
    }

    const capture = () => {
      console.log('✦ Capturing panorama...')

      // 1024 cube faces → 4096×2048 equirect (good quality, ~2-4MB JPEG vs 42MB PNG)
      const size = 1024
      const cubeRT = new THREE.WebGLCubeRenderTarget(size, {
        format: THREE.RGBAFormat,
        generateMipmaps: false,
      })

      const cubeCam = new THREE.CubeCamera(0.1, 2000, cubeRT)
      cubeCam.position.copy(camera.position)
      scene.add(cubeCam)

      // Preserve renderer state — restore after capture
      const prevToneMapping = gl.toneMapping
      const prevExposure = gl.toneMappingExposure
      const prevOutputColorSpace = gl.outputColorSpace

      // Enable tone mapping for the capture so lighting looks natural
      gl.toneMapping = THREE.ACESFilmicToneMapping
      gl.toneMappingExposure = 1.2
      gl.outputColorSpace = THREE.SRGBColorSpace

      // Render cubemap — this captures the scene from all 6 directions
      cubeCam.update(gl, scene)

      // Convert cubemap → equirectangular via fullscreen quad + shader
      const equiW = size * 4
      const equiH = size * 2

      const equiRT = new THREE.WebGLRenderTarget(equiW, equiH, {
        format: THREE.RGBAFormat,
      })

      const equiMat = new THREE.ShaderMaterial({
        uniforms: {
          cubemap: { value: cubeRT.texture },
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.0, 1.0);
          }
        `,
        fragmentShader: `
          uniform samplerCube cubemap;
          varying vec2 vUv;
          #define PI 3.14159265359
          void main() {
            float lon = vUv.x * 2.0 * PI - PI;
            float lat = vUv.y * PI - PI * 0.5;
            vec3 dir = vec3(
              cos(lat) * sin(lon),
              sin(lat),
              cos(lat) * cos(lon)
            );
            gl_FragColor = textureCube(cubemap, dir);
          }
        `,
      })

      // Temporarily disable tone mapping for the equirect conversion pass
      // (tone mapping was already baked into the cubemap render)
      gl.toneMapping = THREE.NoToneMapping

      const equiScene = new THREE.Scene()
      const equiCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), equiMat)
      equiScene.add(quad)

      const prevTarget = gl.getRenderTarget()
      gl.setRenderTarget(equiRT)
      gl.render(equiScene, equiCam)

      // Read pixels
      const pixels = new Uint8Array(equiW * equiH * 4)
      gl.readRenderTargetPixels(equiRT, 0, 0, equiW, equiH, pixels)

      // WebGL y is inverted — flip vertically via canvas
      const tmpCanvas = document.createElement('canvas')
      tmpCanvas.width = equiW
      tmpCanvas.height = equiH
      const tmpCtx = tmpCanvas.getContext('2d')!
      tmpCtx.putImageData(new ImageData(new Uint8ClampedArray(pixels), equiW, equiH), 0, 0)

      const canvas = document.createElement('canvas')
      canvas.width = equiW
      canvas.height = equiH
      const ctx = canvas.getContext('2d')!
      ctx.translate(0, equiH)
      ctx.scale(1, -1)
      ctx.drawImage(tmpCanvas, 0, 0)

      // JPEG at 75% quality — ~2MB instead of 42MB PNG
      const link = document.createElement('a')
      link.download = `oasis-panorama-${Date.now()}.jpg`
      link.href = canvas.toDataURL('image/jpeg', 0.75)
      link.click()

      // Restore renderer state
      gl.setRenderTarget(prevTarget)
      gl.toneMapping = prevToneMapping
      gl.toneMappingExposure = prevExposure
      gl.outputColorSpace = prevOutputColorSpace

      // Cleanup
      scene.remove(cubeCam)
      cubeRT.dispose()
      equiRT.dispose()
      equiMat.dispose()
      quad.geometry.dispose()

      console.log('✦ Panorama captured! (~2-4MB JPEG)')
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [gl, scene, camera])

  return null
}
