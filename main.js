// --- OPTIMIZATION 1: Selective Imports ---
// This results in a much smaller file size by only including the code we actually use.
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

// --- Global Variables ---
let scene, camera, renderer, composer, rgbPass;
let textGroup;
const clock = new Clock();
const raycaster = new Raycaster();
const mouse = new Vector2(99, 99); // Initialize mouse off-screen

// --- OPTIMIZATION 2: Single Renderer with Layers ---
// We'll render the hover effect on a separate layer.
const BASE_LAYER = 0;
const HOVER_EFFECT_LAYER = 1;

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
    // 1) Scene and Camera
    scene = new Scene();
    camera = new PerspectiveCamera(14, window.innerWidth / window.innerHeight, 0.01, 100000);
    camera.position.set(0, 0, 10000);
    // The camera starts on the base layer
    camera.layers.enable(BASE_LAYER);

    // 2) Single, Unified Renderer
    renderer = new WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = SRGBColorSpace;
    
    // --- OPTIMIZATION 3: Cap Pixel Ratio ---
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    document.body.appendChild(renderer.domElement);

    // 3) Composer for Hover Effect
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    rgbPass = new ShaderPass(RGBShiftShader);
    rgbPass.uniforms['amount'].value = 0;
    composer.addPass(rgbPass);

    // 4) Build Text
    textGroup = new Group();
    scene.add(textGroup);

    new FontLoader().load('assets/fonts/Redcollar_Regular.json', font => {
        let x = 0;
        const str = `let's connect`;

        for (const char of str) {
            if (char === ' ') {
                x += 500;
                continue;
            }

            // --- OPTIMIZATION 4: Reduced Text Geometry Detail ---
            const geometry = new TextGeometry(char, {
                font,
                size: 500,
                height: 1,
                bevelEnabled: true,
                bevelThickness: 10,
                bevelSize: 10,
                curveSegments: 16 // Reduced from 100 for better performance
            });
            geometry.computeBoundingBox();

            const material = new ShaderMaterial({
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

            const mesh = new Mesh(geometry, material);
            mesh.position.x = x;
            mesh.layers.set(BASE_LAYER); // All text starts on the base layer
            x += geometry.boundingBox.max.x - geometry.boundingBox.min.x + 50;
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
    const height = 2 * Math.tan(vFOV / 2) * camera.position.z;
    const width = height * camera.aspect;
    textGroup.position.x = -width / 2;
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    alignTextLeft();
}

function onMouseMove(e) {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
}

function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    // 1) Update uniforms and find hovered mesh
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(textGroup.children);
    const hoveredMesh = hits.length > 0 ? hits[0].object : null;

    textGroup.children.forEach(mesh => {
        const material = mesh.material;
        const isHovered = mesh === hoveredMesh;

        // Reset all layers to the base layer
        mesh.layers.set(BASE_LAYER);

        if (isHovered) {
            // If hovered, move this mesh to the effect layer
            mesh.layers.set(HOVER_EFFECT_LAYER);
            const localPoint = mesh.worldToLocal(hits[0].point.clone());
            material.uniforms.uMousePos.value.copy(localPoint);
        }

        material.uniforms.uHoverState.value = MathUtils.lerp(
            material.uniforms.uHoverState.value,
            isHovered ? 1 : 0,
            0.1
        );
        material.uniforms.uTime.value = t;
    });

    // 2) Update RGB shift amount
    if (hoveredMesh) {
        rgbPass.uniforms['amount'].value = hoveredMesh.material.uniforms.uHoverState.value * 0.0035;
    } else {
        rgbPass.uniforms['amount'].value = 0;
    }
    
    // 3) Render the scene in two passes using layers
    renderer.autoClear = true; // Clear depth, color, stencil buffers
    
    // Pass 1: Render base text (Layer 0)
    camera.layers.set(BASE_LAYER);
    renderer.render(scene, camera);
    
    // Pass 2: Render hover effect (Layer 1) on top
    renderer.autoClear = false; // Don't clear the base text
    camera.layers.set(HOVER_EFFECT_LAYER);
    composer.render();
}