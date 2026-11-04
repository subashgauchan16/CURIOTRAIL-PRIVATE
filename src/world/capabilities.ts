// Lightweight checks used before the 3D engine is downloaded.

export type Quality = 'high' | 'low';

interface GlProbe { available: boolean; software: boolean }
let probe: GlProbe | null = null;

/** One throwaway WebGL context, created once per page: is WebGL there, and does it run on the CPU? */
function glProbe(): GlProbe {
  if (probe) return probe;
  probe = { available: false, software: false };
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      // SwiftShader, llvmpipe, Microsoft Basic Render Driver: no usable GPU
      probe = { available: true, software: /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name) };
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    /* no WebGL */
  }
  return probe;
}

/** True when the browser can create a WebGL context at all. */
export function webglAvailable(): boolean {
  return glProbe().available;
}

/** True when WebGL runs on the CPU (no usable GPU). */
export function softwareRenderer(): boolean {
  return glProbe().software;
}

export function detectQuality(): Quality {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const small = Math.min(window.screen?.width ?? 1200, window.screen?.height ?? 900) < 700;
  if (coarse || small) return 'low';
  if ((nav.deviceMemory ?? 8) <= 4 || (nav.hardwareConcurrency ?? 8) <= 4) return 'low';
  return 'high';
}
