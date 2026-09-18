import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const canvas = document.querySelector('#canvas');
const viewport = document.querySelector('#viewport');
const statusEl = document.querySelector('#status');
const folderInfoEl = document.querySelector('#folderInfo');
const reloadCurrentBtn = document.querySelector('#reloadCurrentBtn');
const refreshFoldersBtn = document.querySelector('#refreshFoldersBtn');
const userModelButtons = [...document.querySelectorAll('.user-model-btn')];
const assetStateEl = document.querySelector('#assetState');
const lightingInfoEl = document.querySelector('#lightingInfo');
const modelSelect = document.querySelector('#modelSelect');
const showBackground = document.querySelector('#showBackground');
const showHelpers = document.querySelector('#showHelpers');
const hdrSelect = document.querySelector('#hdrSelect');
const refreshHdrBtn = document.querySelector('#refreshHdrBtn');
const hdrStateEl = document.querySelector('#hdrState');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.001, 1000);
camera.position.set(1.4, 1.0, 1.7);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0, 0);
controls.update();

const modelRoot = new THREE.Group();
scene.add(modelRoot);
const lightRoot = new THREE.Group();
scene.add(lightRoot);
const helperRoot = new THREE.Group();
scene.add(helperRoot);

const gltfLoader = new GLTFLoader();
const rgbeLoader = new RGBELoader();
let currentHdr = null;
let currentModel = null;
let lightingMode = 'authored';
let lastStatus = null;
let currentSource = { type: 'czy3d', kind: 'original' };
let currentUserFolder = null;
let hdrOverrideName = '';

const LIGHTING = {
  authored: {
    title: '저장 Scene',
    hdr: '/hdr/art_studio.hdr',
    hdrName: 'art_studio.hdr',
    envIntensity: 0.7,
    backgroundIntensity: 0.11,
    backgroundBlurriness: 1,
    directional: [{ position: [20,20,20], target: [0,-1,0], intensity: 1 }],
    ambient: 0
  },
  init: {
    title: '초기화',
    hdr: '/hdr/sky.hdr',
    hdrName: 'sky.hdr',
    envIntensity: 1,
    backgroundIntensity: 1,
    backgroundBlurriness: 0,
    directional: [{ position: [10,10,10], target: [0,0,0], intensity: 1 }],
    ambient: 0.2
  },
  combined: {
    title: '결합 비교',
    hdr: '/hdr/art_studio.hdr',
    hdrName: 'art_studio.hdr',
    envIntensity: 0.7,
    backgroundIntensity: 0.11,
    backgroundBlurriness: 1,
    directional: [
      { position: [20,20,20], target: [0,-1,0], intensity: 1 },
      { position: [10,10,10], target: [0,0,0], intensity: 1 }
    ],
    ambient: 0.2
  }
};

function setStatus(text) {
  lastStatus = text;
  statusEl.textContent = text;
}

function disposeMaterial(material) {
  if (!material) return;
  for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
  material.dispose?.();
}

function disposeObject(root) {
  root.traverse((o) => {
    o.geometry?.dispose?.();
    if (Array.isArray(o.material)) o.material.forEach(disposeMaterial);
    else disposeMaterial(o.material);
  });
}

function clearGroup(group) {
  while (group.children.length) {
    const child = group.children.pop();
    child.parent = null;
  }
}

function clearModel() {
  if (currentModel) {
    modelRoot.remove(currentModel);
    disposeObject(currentModel);
    currentModel = null;
  }
}

function resize() {
  const w = Math.max(1, viewport.clientWidth);
  const h = Math.max(1, viewport.clientHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function fitCamera() {
  if (!currentModel) return;
  currentModel.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(currentModel);
  if (box.isEmpty()) return;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 0.001);
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.18;
  const dir = camera.position.clone().sub(controls.target).normalize();
  if (dir.lengthSq() < 0.1) dir.set(1, .7, 1).normalize();
  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).addScaledVector(dir, distance);
  camera.near = Math.max(distance / 1000, 0.0001);
  camera.far = Math.max(distance * 100, 100);
  camera.updateProjectionMatrix();
  controls.update();
}

function restoreCzy3dMaterialRenderState(root, kind) {
  const visited = new Set();

  root.traverse((object) => {
    if (!object.isMesh) return;

    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];

    for (const material of materials) {
      if (!material || visited.has(material)) continue;
      visited.add(material);

      const source = material.userData?.exactThreeMaterial;

      // This viewer is for rendering-quality comparison only.
      // Functional transparency from the CZY3D manual is intentionally disabled.
      material.transparent = false;
      material.opacity = 1;
      material.alphaTest = 0;
      material.depthWrite = true;
      material.depthTest = true;

      // MeshPhysicalMaterial transmission is independent of ordinary opacity.
      // Disable it as well so glass/explanation effects cannot make parts see-through.
      if ('transmission' in material) material.transmission = 0;
      if ('thickness' in material) material.thickness = 0;
      if ('alphaMap' in material) material.alphaMap = null;

      // Preserve original face-culling direction where possible.
      if (source && Number.isFinite(Number(source.side))) {
        const side = Number(source.side);
        material.side =
          side === 2 ? THREE.DoubleSide :
          side === 1 ? THREE.BackSide :
                       THREE.FrontSide;
      } else {
        material.side = THREE.FrontSide;
      }

      material.needsUpdate = true;
    }
  });
}

function setActiveUserFolder(folder) {
  currentUserFolder = folder;
  userModelButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.folder === folder);
  });
}

async function loadModel(kind = modelSelect.value) {
  const url = kind === 'neutral'
    ? '/models/czy3d_fixed_neutral_uncompressed.glb'
    : '/models/czy3d_fixed_original_pbr_uncompressed.glb';

  currentSource = { type: 'czy3d', kind };
  setActiveUserFolder(null);
  setStatus(`모델 로딩 중...\n${url}`);

  try {
    const gltf = await gltfLoader.loadAsync(`${url}?t=${Date.now()}`);
    clearModel();

    currentModel = gltf.scene;
    restoreCzy3dMaterialRenderState(currentModel, kind);
    modelRoot.add(currentModel);

    fitCamera();
    setStatus(`모델 로드 완료\n${kind === 'neutral' ? 'Neutral (불투명)' : 'CZY3D PBR (불투명)'}`);
  } catch (error) {
    console.error(error);
    setStatus(`모델 로드 실패\n${error.message}\n먼저 BUILD_COMPLETE_GLB.bat를 실행하세요.`);
  }
}

async function getFolderModels(folder) {
  const response = await fetch(`/api/models/${folder}?t=${Date.now()}`, {
    cache: 'no-store'
  });
  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data;
}

async function loadUserFolder(folder) {
  folder = String(folder).toUpperCase();
  currentSource = { type: 'user', folder };
  setActiveUserFolder(folder);

  setStatus(`${folder} 폴더 확인 중...`);

  try {
    const data = await getFolderModels(folder);

    if (!data.files.length) {
      clearModel();
      setStatus(
        `${folder} 폴더에 GLB가 없습니다.\n` +
        `public/models/${folder}/ 에 .glb 파일을 넣으세요.`
      );
      return;
    }

    setStatus(
      `${folder} 폴더 모델 로딩 중...\n` +
      data.files.map((file) => file.name).join('\n')
    );

    const results = await Promise.all(
      data.files.map(async (file) => {
        const gltf = await gltfLoader.loadAsync(`${file.url}?t=${Date.now()}`);

        // Same behaviour as the previous A-D viewer:
        // every loaded GLB root is placed at the origin.
        gltf.scene.position.set(0, 0, 0);
        gltf.scene.updateMatrix();

        return { file, scene: gltf.scene };
      })
    );

    clearModel();

    const group = new THREE.Group();
    group.name = `UserFolder_${folder}`;
    group.position.set(0, 0, 0);

    for (const result of results) {
      result.scene.name = result.scene.name || result.file.name;
      group.add(result.scene);
    }

    currentModel = group;
    modelRoot.add(currentModel);
    fitCamera();

    setStatus(
      `${folder} 폴더 로드 완료\n` +
      `${results.length}개 GLB\n` +
      results.map((item) => item.file.name).join('\n')
    );
  } catch (error) {
    console.error(error);
    setStatus(`${folder} 폴더 로드 실패\n${error.message}`);
  }
}

async function refreshFolderInfo() {
  const folders = ['A', 'B', 'C', 'D'];

  try {
    const results = await Promise.all(folders.map(getFolderModels));

    folderInfoEl.textContent = results
      .map((data) =>
        `${data.folder}: ${data.count}개` +
        (data.files.length ? `\n  ${data.files.map((f) => f.name).join('\n  ')}` : '')
      )
      .join('\n');
  } catch (error) {
    folderInfoEl.textContent = `폴더 확인 실패: ${error.message}`;
  }
}

function addDirectional(spec) {
  const light = new THREE.DirectionalLight(0xffffff, spec.intensity);
  light.position.fromArray(spec.position);
  light.castShadow = false;
  const target = new THREE.Object3D();
  target.position.fromArray(spec.target);
  lightRoot.add(target);
  light.target = target;
  lightRoot.add(light);
  if (showHelpers.checked) helperRoot.add(new THREE.DirectionalLightHelper(light, 0.15));
}

function getSelectedHdr(config) {
  if (hdrOverrideName) {
    return {
      name: hdrOverrideName,
      url: `/hdr/${encodeURIComponent(hdrOverrideName)}`,
      overridden: true
    };
  }

  return {
    name: config.hdrName,
    url: config.hdr,
    overridden: false
  };
}

function updatePresetDefaultOption() {
  const option = hdrSelect.querySelector('option[value=""]');
  if (!option) return;

  const config = LIGHTING[lightingMode];
  option.textContent = `프리셋 기본 HDR (${config.hdrName})`;
}

function renderLightingInfo(config, hdrInfo = getSelectedHdr(config)) {
  lightingInfoEl.textContent =
`${config.title}\nHDR: ${hdrInfo.name}${hdrInfo.overridden ? ' (직접 선택)' : ' (프리셋 기본)'}\nenvIntensity: ${config.envIntensity}\nbgIntensity: ${config.backgroundIntensity}\nbgBlur: ${config.backgroundBlurriness}\nDirectional: ${config.directional.map(v => `[${v.position.join(',')}] x${v.intensity}`).join(' + ')}\nAmbient: ${config.ambient}`;
}

async function getHdrList() {
  const response = await fetch(`/api/hdrs?t=${Date.now()}`, {
    cache: 'no-store'
  });
  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data;
}

async function refreshHdrList() {
  const previous = hdrOverrideName;

  try {
    const data = await getHdrList();

    hdrSelect.innerHTML = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    hdrSelect.appendChild(defaultOption);

    for (const file of data.files) {
      const option = document.createElement('option');
      option.value = file.name;
      option.textContent = file.name;
      hdrSelect.appendChild(option);
    }

    const stillExists = previous && data.files.some((file) => file.name === previous);
    hdrOverrideName = stillExists ? previous : '';
    hdrSelect.value = hdrOverrideName;

    updatePresetDefaultOption();

    hdrStateEl.textContent =
      data.files.length > 0
        ? `${data.count}개 HDR 발견\n${data.files.map((file) => file.name).join('\n')}`
        : 'input/hdr 폴더에 .hdr 파일이 없습니다.';

    return data;
  } catch (error) {
    hdrStateEl.textContent = `HDR 목록 확인 실패: ${error.message}`;
    throw error;
  }
}

async function applyLighting(mode = lightingMode) {
  lightingMode = mode;
  const config = LIGHTING[mode];
  updatePresetDefaultOption();
  const hdrInfo = getSelectedHdr(config);
  renderLightingInfo(config, hdrInfo);
  document.querySelectorAll('.lighting-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.lighting === mode));

  clearGroup(helperRoot);
  clearGroup(lightRoot);

  for (const spec of config.directional) addDirectional(spec);
  if (config.ambient > 0) lightRoot.add(new THREE.AmbientLight(0xffffff, config.ambient));

  if (currentHdr) {
    currentHdr.dispose();
    currentHdr = null;
  }

  setStatus(`${config.title} HDR 로딩 중...\n${hdrInfo.name}`);
  try {
    const separator = hdrInfo.url.includes('?') ? '&' : '?';
    const hdr = await rgbeLoader.loadAsync(`${hdrInfo.url}${separator}t=${Date.now()}`);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    currentHdr = hdr;
    scene.environment = hdr;
    if ('environmentIntensity' in scene) scene.environmentIntensity = config.envIntensity;
    if ('environmentRotation' in scene) scene.environmentRotation.set(0,0,0);
    if ('backgroundIntensity' in scene) scene.backgroundIntensity = config.backgroundIntensity;
    if ('backgroundBlurriness' in scene) scene.backgroundBlurriness = config.backgroundBlurriness;
    if ('backgroundRotation' in scene) scene.backgroundRotation.set(0,0,0);
    scene.background = showBackground.checked ? hdr : null;
    setStatus(`${config.title} 적용 완료\n${hdrInfo.name}`);
  } catch (error) {
    console.error(error);
    scene.environment = null;
    scene.background = null;
    setStatus(`${config.title} HDR 로드 실패\n${hdrInfo.name}\n${error.message}`);
  }
}

async function refreshAssetState() {
  const data = await fetch('/api/status').then(r => r.json());
  assetStateEl.textContent =
    `GLB neutral: ${data.neutralModel ? 'OK' : '없음'} / original: ${data.originalModel ? 'OK' : '없음'}\n` +
    `art_studio.hdr: ${data.artStudioHdr ? 'OK' : '없음'} / sky.hdr: ${data.skyHdr ? 'OK' : '없음'}`;
  return data;
}

modelSelect.addEventListener('change', () => loadModel());

userModelButtons.forEach((button) => {
  button.addEventListener('click', () => loadUserFolder(button.dataset.folder));
});

reloadCurrentBtn.addEventListener('click', async () => {
  if (currentSource.type === 'user') {
    await loadUserFolder(currentSource.folder);
  } else {
    modelSelect.value = currentSource.kind;
    await loadModel(currentSource.kind);
  }
});

refreshFoldersBtn.addEventListener('click', refreshFolderInfo);

hdrSelect.addEventListener('change', async () => {
  hdrOverrideName = hdrSelect.value;
  await applyLighting(lightingMode);
});

refreshHdrBtn.addEventListener('click', async () => {
  try {
    await refreshHdrList();
    await applyLighting(lightingMode);
  } catch (error) {
    setStatus(`HDR 목록 새로고침 실패\n${error.message}`);
  }
});
document.querySelectorAll('.lighting-btn').forEach(btn => btn.addEventListener('click', () => applyLighting(btn.dataset.lighting)));
showBackground.addEventListener('change', () => { scene.background = showBackground.checked ? currentHdr : null; });
showHelpers.addEventListener('change', () => applyLighting(lightingMode));
document.querySelector('#fitBtn').addEventListener('click', fitCamera);
document.querySelector('#resetBtn').addEventListener('click', () => { camera.position.set(1.4,1.0,1.7); controls.target.set(0,0,0); camera.near=.001; camera.far=1000; camera.updateProjectionMatrix(); controls.update(); });
document.querySelector('#fetchSkyBtn').addEventListener('click', async () => {
  setStatus('sky.hdr 다운로드 요청 중...');
  try {
    const response = await fetch('/api/fetch-sky', { method: 'POST' });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    setStatus(`sky.hdr 다운로드 완료\n${data.bytes.toLocaleString()} bytes`);
    await refreshAssetState();
    await refreshHdrList();
    if (lightingMode === 'init' || hdrOverrideName === 'sky.hdr') {
      await applyLighting(lightingMode);
    }
  } catch (error) {
    setStatus(`sky.hdr 다운로드 실패\n${error.message}`);
  }
});

window.addEventListener('resize', resize);
resize();
await refreshFolderInfo();
await refreshHdrList();
const state = await refreshAssetState();
await applyLighting('authored');
if (state.originalModel) await loadModel('original');
else if (state.neutralModel) { modelSelect.value = 'neutral'; await loadModel('neutral'); }
else setStatus('GLB가 아직 없습니다.\nBUILD_COMPLETE_GLB.bat 또는 RUN_COMPARE_VIEWER.bat를 실행하세요.');

renderer.setAnimationLoop(() => {
  controls.update();
  helperRoot.traverse(o => o.update?.());
  renderer.render(scene, camera);
});
