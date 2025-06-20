import * as THREE from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RGBShiftShader } from 'three/examples/jsm/shaders/RGBShiftShader.js';

let scene, hoverScene, camera;
let rendererMain, rendererFX;
let composerFX, rgbPass;
let textGroup;
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2(99, 99);

const vs = `
  uniform float uTime;
  uniform vec3 uMousePos;
  uniform float uHoverState;
  uniform float uNoiseFrequency;
  uniform float uNoiseAmplitude;
  void main(){
    float waveX = sin(position.x * uNoiseFrequency + uTime * 1.5);
    float waveY = cos(position.y * uNoiseFrequency + uTime * 1.5);
    float total = (waveX + waveY) * uNoiseAmplitude;
    vec3 np = position + normal * total * uHoverState;
    float d = distance(position, uMousePos);
    float push = smoothstep(200.0, 0.0, d) * uHoverState;
    np += normalize(position - uMousePos) * push * 50.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(np, 1.0);
  }
`;

const fs = `
  precision highp float;
  void main(){
    gl_FragColor = vec4(1.0);
  }
`;

init();
animate();

function init() {
  // 1) Scenes and camera
  scene      = new THREE.Scene();
  hoverScene = new THREE.Scene();
  camera     = new THREE.PerspectiveCamera(14, innerWidth/innerHeight, 0.01, 100000);
  camera.position.set(0,0,10000);

  // 2) Main renderer (draws ALL glyphs)
  rendererMain = new THREE.WebGLRenderer({antialias:true, alpha:true});
  rendererMain.setPixelRatio(devicePixelRatio);
  rendererMain.setSize(innerWidth, innerHeight);
  rendererMain.setClearColor(0x000000, 0);
  rendererMain.outputColorSpace = THREE.SRGBColorSpace;
  rendererMain.domElement.style.position = 'absolute';
  rendererMain.domElement.style.top      = '0';
  rendererMain.domElement.style.left     = '0';
  document.body.appendChild(rendererMain.domElement);

  // 3) FX renderer overlay (draws only hovered)
  rendererFX = new THREE.WebGLRenderer({antialias:true, alpha:true});
  rendererFX.setPixelRatio(devicePixelRatio);
  rendererFX.setSize(innerWidth, innerHeight);
  rendererFX.outputColorSpace = THREE.SRGBColorSpace;
  rendererFX.domElement.style.position = 'absolute';
  rendererFX.domElement.style.top      = '0';
  rendererFX.domElement.style.left     = '0';
  rendererFX.domElement.style.pointerEvents = 'none';
  rendererFX.setClearColor(0x000000, 0)
  document.body.appendChild(rendererFX.domElement);

  // 4) Controls
  //new OrbitControls(camera, rendererMain.domElement).enableDamping = true;

  // 5) Composer for hoverScene
  composerFX = new EffectComposer(rendererFX);
  composerFX.addPass(new RenderPass(hoverScene, camera));
  rgbPass = new ShaderPass(RGBShiftShader);
  rgbPass.uniforms['amount'].value = 0;
  composerFX.addPass(rgbPass);

  // 6) Build text in `scene`
  textGroup = new THREE.Group();
  scene.add(textGroup);

  new FontLoader().load(
    'assets/fonts/Redcollar_Regular.json',
    font => {
      let x = 0;
      const str = `let's connect`;
      for (let c of str) {
        if (c===' ') { x+=500; continue; }
        const geo = new TextGeometry(c, {
          font, size:500, height:1,
          bevelEnabled:true, bevelThickness:10, bevelSize:10,
          curveSegments:100
        });
        geo.computeBoundingBox();

        const mat = new THREE.ShaderMaterial({
          uniforms:{
            uTime:           {value:0},
            uMousePos:       {value:new THREE.Vector3()},
            uHoverState:     {value:0},
            uNoiseFrequency: {value:0.005},
            uNoiseAmplitude: {value:30}
          },
          vertexShader: vs,
          fragmentShader: fs
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.x = x;
        x += geo.boundingBox.max.x - geo.boundingBox.min.x + 50;
        textGroup.add(mesh);
      }

      // Align the text to the left instead of centering
      alignTextLeft();
      // // center group
      // const box = new THREE.Box3().setFromObject(textGroup);
      // const s   = box.getSize(new THREE.Vector3());
      // textGroup.position.x = -s.x/2;
    }
  );

  window.addEventListener('resize', onResize);
  window.addEventListener('mousemove', onMouseMove);
}
// This function calculates the left edge of the screen and aligns the text.
function alignTextLeft() {
    if (!textGroup || textGroup.children.length === 0) return;
    
    // Calculate the visible width of the scene at the camera's distance
    const vFOV = THREE.MathUtils.degToRad(camera.fov);
    const distance = camera.position.z; // Since text is at z=0
    const height = 2 * Math.tan(vFOV / 2) * distance;
    const width = height * camera.aspect;

    // Position the text group so its origin is at the left edge of the viewport
    textGroup.position.x = -width / 2;
}

function onResize() {
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  rendererMain.setSize(innerWidth, innerHeight);
  rendererFX.setSize(innerWidth, innerHeight);
  composerFX.setSize(innerWidth, innerHeight);
  // Re-align the text when the window is resized
  alignTextLeft();
}

function onMouseMove(e) {
  mouse.x = (e.clientX/innerWidth)*2 - 1;
  mouse.y = -(e.clientY/innerHeight)*2 + 1;
}

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();

  // A) update per‐letter uniforms and detect hovered mesh
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(textGroup.children);
  const hovered = hits.length>0 ? hits[0].object : null;

  textGroup.children.forEach(mesh => {
    const mat = mesh.material;
    const isH = mesh === hovered;
    if (isH) {
      const local = mesh.worldToLocal(hits[0].point.clone());
      mat.uniforms.uMousePos.value.copy(local);
    }
    mat.uniforms.uHoverState.value = THREE.MathUtils.lerp(
      mat.uniforms.uHoverState.value,
      isH ? 1 : 0,
      0.1
    );
    mat.uniforms.uTime.value = t;
  });

  // B) Draw all glyphs normally to the main canvas
  rendererMain.autoClear = true;
  rendererMain.clear();
  rendererMain.render(scene, camera);

  // C) Now clear hoverScene and add exactly the hovered mesh
  hoverScene.clear();

  if (hovered) {
    // clone geometry but reuse material so uniforms stay synced
    const clone = new THREE.Mesh(hovered.geometry, hovered.material);
    // bake world transform into its matrix
    clone.matrixAutoUpdate = false;
    clone.matrix.copy(hovered.matrixWorld);
    hoverScene.add(clone);

    // set chromatic strength
    rgbPass.uniforms['amount'].value = hovered.material.uniforms.uHoverState.value * 0.0035;

    // draw just the hovered letter with chromatic shift
    rendererFX.autoClear = true;
    rendererFX.clear();
    composerFX.render();
  }
  else
  {
    rgbPass.uniforms['amount'].value = 0;
    rendererFX.clear();
    composerFX.render();
  }
}
