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
  camera.position.set(0,0,12000);

  // 2) Main renderer (draws ALL glyphs)
  rendererMain = new THREE.WebGLRenderer({antialias:true, alpha:false});
  rendererMain.setPixelRatio(devicePixelRatio);
  rendererMain.setSize(innerWidth, innerHeight);
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
      for (let c of 'echofox') {
        if (c===' ') { x+=500; continue; }
        const geo = new TextGeometry(c, {
          font, size:1000, height:1,
          bevelEnabled:true, bevelThickness:5, bevelSize:5,
          curveSegments:12
        });
        geo.computeBoundingBox();

        const mat = new THREE.ShaderMaterial({
          uniforms:{
            uTime:           {value:0},
            uMousePos:       {value:new THREE.Vector3()},
            uHoverState:     {value:0},
            uNoiseFrequency: {value:0.005},
            uNoiseAmplitude: {value:40}
          },
          vertexShader: vs,
          fragmentShader: fs
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.x = x;
        x += geo.boundingBox.max.x - geo.boundingBox.min.x + 100;
        textGroup.add(mesh);
      }

      // center group
      const box = new THREE.Box3().setFromObject(textGroup);
      const s   = box.getSize(new THREE.Vector3());
      textGroup.position.x = -s.x/2;
    }
  );

  window.addEventListener('resize', onResize);
  window.addEventListener('mousemove', onMouseMove);
}

function onResize() {
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  rendererMain.setSize(innerWidth, innerHeight);
  rendererFX.setSize(innerWidth, innerHeight);
  composerFX.setSize(innerWidth, innerHeight);
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
