import {ShaderPass} from 'three/examples/jsm/postprocessing/ShaderPass.js';
import {GammaCorrectionShader} from 'three/examples/jsm/shaders/GammaCorrectionShader.js';

const installed = new WeakMap();

export function installMapOutputPass(composer) {
  if (installed.has(composer)) return installed.get(composer);
  // Three r152 renders composer intermediates in linear space. FXAA alone
  // does not encode the final pixels, unlike the preview's direct renderer.
  const output = new ShaderPass(GammaCorrectionShader);
  output.material.toneMapped = false;
  composer.addPass(output);
  installed.set(composer, output);
  return output;
}
