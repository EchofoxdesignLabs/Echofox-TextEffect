// --- Selective Imports for better performance ---
import {
    Scene,
    PerspectiveCamera,
    WebGLRenderer,
    SRGBColorSpace,
    Group,
    Box3,
    Vector2,
    Vector3,
    Raycaster,
    Clock,
    ShaderMaterial,
    Mesh,
    MathUtils
} from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RGBShiftShader } from 'three/examples/jsm/shaders/RGBShiftShader.js';

// --- Global Variables (Reverted to original two-scene, two-renderer setup) ---
let scene, hoverScene, camera;
let rendererMain, rendererFX;
let composerFX, rgbPass;
let textGroup;
const clock = new Clock();
const raycaster = new Raycaster();
const mouse = new Vector2(99, 99);

// --- Shaders (unchanged) ---
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
    scene = new Scene();
    hoverScene = new Scene();
    camera = new PerspectiveCamera(14, window.innerWidth / window.innerHeight, 0.01, 100000);
    camera.position.set(0, 0, 10000);

    // 2) Main renderer (draws ALL glyphs)
    rendererMain = new WebGLRenderer({ antialias: true, alpha: true });
    rendererMain.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Optimization
    rendererMain.setSize(window.innerWidth, window.innerHeight);
    rendererMain.setClearColor(0x000000, 0);
    rendererMain.outputColorSpace = SRGBColorSpace;
    rendererMain.domElement.style.position = 'absolute';
    rendererMain.domElement.style.top = '0';
    rendererMain.domElement.style.left = '0';
    document.body.appendChild(rendererMain.domElement);

    // 3) FX renderer overlay (draws only hovered)
    rendererFX = new WebGLRenderer({ antialias: true, alpha: true });
    rendererFX.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Optimization
    rendererFX.setSize(window.innerWidth, window.innerHeight);
    rendererFX.outputColorSpace = SRGBColorSpace;
    rendererFX.domElement.style.position = 'absolute';
    rendererFX.domElement.style.top = '0';
    rendererFX.domElement.style.left = '0';
    rendererFX.domElement.style.pointerEvents = 'none';
    rendererFX.setClearColor(0x000000, 0);
    document.body.appendChild(rendererFX.domElement);

    // 4) Composer for hoverScene
    composerFX = new EffectComposer(rendererFX);
    composerFX.addPass(new RenderPass(hoverScene, camera));
    rgbPass = new ShaderPass(RGBShiftShader);
    rgbPass.uniforms['amount'].value = 0;
    composerFX.addPass(rgbPass);

    // 5) Build text in `scene`
    textGroup = new Group();
    scene.add(textGroup);

    new FontLoader().load('assets/fonts/Redcollar_Regular.json', font => {
        let x = 0;
        const str = `let's connect`;
        for (let c of str) {
            if (c === ' ') { x += 500; continue; }
            const geo = new TextGeometry(c, {
                font,
                size: 500,
                height: 1,
                bevelEnabled: true,
                bevelThickness: 10,
                bevelSize: 10,
                curveSegments: 16 // Reduced from 100 for performance
            });
            geo.computeBoundingBox();

            const mat = new ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uMousePos: { value: new Vector3() },
                    uHoverState: { value: 0 },
                    uNoiseFrequency: { value: 0.005 },
                    uNoiseAmplitude: { value: 30 }
                },
                vertexShader: vs,
                fragmentShader: fs
            });

            const mesh = new Mesh(geo, mat);
            mesh.position.x = x;
            x += geo.boundingBox.max.x - geo.boundingBox.min.x + 50;
            textGroup.add(mesh);
        }
        alignTextLeft();
    });

    window.addEventListener('resize', onResize);
    window.addEventListener('mousemove', onMouseMove);
}

function alignTextLeft() {
    if (!textGroup || textGroup.children.length === 0) return;
    const vFOV = MathUtils.degToRad(camera.fov);
    const distance = camera.position.z;
    const height = 2 * Math.tan(vFOV / 2) * distance;
    const width = height * camera.aspect;
    textGroup.position.x = -width / 2;
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    rendererMain.setSize(window.innerWidth, window.innerHeight);
    rendererFX.setSize(window.innerWidth, window.innerHeight);
    composerFX.setSize(window.innerWidth, window.innerHeight);
    alignTextLeft();
}

function onMouseMove(e) {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
}

function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    // 1) Update per-letter uniforms and detect hovered mesh
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(textGroup.children);
    const hovered = hits.length > 0 ? hits[0].object : null;

    textGroup.children.forEach(mesh => {
        const mat = mesh.material;
        const isH = mesh === hovered;
        if (isH) {
            const local = mesh.worldToLocal(hits[0].point.clone());
            mat.uniforms.uMousePos.value.copy(local);
        }
        mat.uniforms.uHoverState.value = MathUtils.lerp(
            mat.uniforms.uHoverState.value,
            isH ? 1 : 0,
            0.1
        );
        mat.uniforms.uTime.value = t;
    });

    // 2) Draw all glyphs normally to the main canvas
    rendererMain.autoClear = true;
    rendererMain.clear();
    rendererMain.render(scene, camera);

    // 3) Clear hoverScene and add the hovered mesh to it for the effect
    hoverScene.clear();

    if (hovered) {
        const clone = new Mesh(hovered.geometry, hovered.material);
        clone.matrixAutoUpdate = false;
        clone.matrix.copy(hovered.matrixWorld);
        hoverScene.add(clone);

        rgbPass.uniforms['amount'].value = hovered.material.uniforms.uHoverState.value * 0.0035;

        // Draw just the hovered letter with chromatic shift
        rendererFX.autoClear = true;
        rendererFX.clear();
        composerFX.render();
    } else {
        // If nothing is hovered, ensure the effect renderer is also clear
        rgbPass.uniforms['amount'].value = 0;
        rendererFX.clear();
    }
}
