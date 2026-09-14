import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// Capture while the classic bundle executes, before asynchronous scene construction.
const bundleURL = globalThis.document?.currentScript?.src || globalThis.location?.href;
export function disposeShopAsset(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), images = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of [object.material].flat().filter(Boolean)) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    material.dispose();
  }
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) { if (texture.image) images.add(texture.image); texture.dispose(); }
  for (const image of images) image.close?.();
}

// The fallback remains attached until the full model and all embedded textures are decoded.
export function attachShopAsset(group, fallback, { url, fetcher = fetch, loader = new GLTFLoader(), timeoutMs = 15000 } = {}) {
  let disposed = false;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  group.userData.staticAsset = 'loading';
  const ready = (async () => {
    try {
      const response = await fetcher(url || new URL('assets/scene/coffee-shop-v1.glb', bundleURL), { signal: abort.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.arrayBuffer();
      if (disposed) return;
      const gltf = await loader.parseAsync(data, '');
      if (disposed) { disposeShopAsset(gltf.scene); return; }
      gltf.scene.traverse(object => {
        if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; }
      });
      group.add(gltf.scene);
      for (const object of fallback) object.visible = false;
      group.userData.staticAsset = 'ready';
    } catch (error) {
      if (!disposed) {
        group.userData.staticAsset = 'fallback';
        console.warn('精细门店资源不可用，已保留基础场景。', error.message);
      }
    } finally { clearTimeout(timer); }
  })();
  return { ready, dispose() { disposed = true; clearTimeout(timer); abort.abort(); } };
}
