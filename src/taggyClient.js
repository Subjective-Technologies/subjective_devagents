// Client for the Taggy Todo API (clients/tools/subjective_taggy_web), used by the
// composer's Taggy button to pull a task's text/images into a chat message, or save
// a message as a new task. Auth mirrors Taggy's own client: reuse the Firebase ID
// token this app already holds (window.devagentsAuth, web build only — the token is
// for the same Firebase project Taggy verifies) when present, otherwise fall back to
// Taggy's anonymous-workspace scheme (a per-install random key) so the feature still
// works standalone in the Electron/mobile builds, which have no Firebase session.
(function () {
  'use strict';

  const BASE = 'https://taggy.subjectivetechnologies.com';
  const ANON_KEY = 'subjective_chat.taggy.workspace';
  // Mirrors subjective_taggy_web/src/lib/image.ts's compressImage, so a chat-attached
  // image is stored the same way as one pasted directly into Taggy.
  const MAX_DIM = 1600;
  const THUMB_DIM = 360;
  const JPEG_QUALITY = 0.85;

  function anonWorkspace() {
    let key = '';
    try { key = localStorage.getItem(ANON_KEY) || ''; } catch (_error) { /* storage unavailable */ }
    if (!key) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      key = `w${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
      try { localStorage.setItem(ANON_KEY, key); } catch (_error) { /* storage unavailable */ }
    }
    return key;
  }

  async function authHeaders() {
    if (window.devagentsAuth?.getToken) {
      try {
        const token = await window.devagentsAuth.getToken();
        if (token) return { authorization: `Bearer ${token}` };
      } catch (_error) { /* fall through to the anonymous workspace */ }
    }
    return { 'x-taggy-workspace': anonWorkspace() };
  }

  async function req(path, options = {}) {
    const headers = await authHeaders();
    let response;
    try {
      response = await fetch(`${BASE}${path}`, {
        ...options,
        headers: { 'content-type': 'application/json', ...headers, ...(options.headers || {}) },
      });
    } catch (_error) {
      throw new Error('Could not reach Taggy. Check your connection and try again.');
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Taggy request failed (HTTP ${response.status}).`);
    }
    return response.status === 204 ? null : response.json();
  }

  function drawScaled(bitmap, maxDim) {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function encodeCanvas(canvas, preferPng) {
    let mime = preferPng ? 'image/png' : 'image/jpeg';
    let dataUrl = canvas.toDataURL(mime, JPEG_QUALITY);
    if (preferPng && dataUrl.length > 900000) {
      mime = 'image/jpeg';
      dataUrl = canvas.toDataURL(mime, JPEG_QUALITY);
    }
    return { mime, data: dataUrl.slice(dataUrl.indexOf(',') + 1) };
  }

  async function compressImage(file) {
    const bitmap = await createImageBitmap(file);
    try {
      const full = encodeCanvas(drawScaled(bitmap, MAX_DIM), true);
      const thumb = encodeCanvas(drawScaled(bitmap, THUMB_DIM), false);
      return { mime: full.mime, data: full.data, thumbMime: thumb.mime, thumb: thumb.data };
    } finally {
      bitmap.close?.();
    }
  }

  async function dataUriToFile(dataUri, name) {
    const response = await fetch(dataUri);
    const blob = await response.blob();
    return new File([blob], name, { type: blob.type });
  }

  window.taggyClient = {
    baseUrl: BASE,
    getState: () => req('/api/state'),
    createTask: (text, tagIds) =>
      req('/api/tasks', { method: 'POST', body: JSON.stringify({ text, tagIds }) }),
    listTaskImages: (taskId) => req(`/api/tasks/${taskId}/images`),
    addTaskImage: async (taskId, file) => {
      const payload = await compressImage(file);
      return req(`/api/tasks/${taskId}/images`, { method: 'POST', body: JSON.stringify(payload) });
    },
    dataUriToFile,
  };
}());
