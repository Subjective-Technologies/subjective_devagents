const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/renderer.js'), 'utf8');
function harness({ fail = false } = {}) {
  const context = vm.createContext({
    File, Uint8Array, atob,
    pendingImages: [], pendingImageId: 0, renderPendingImages() {},
    FileReader: class {
      readAsDataURL(file) {
        queueMicrotask(async () => {
          if (fail) return this.onerror();
          this.result = `data:${file.type || 'application/octet-stream'};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`;
          this.onload();
        });
      }
    }
  });
  for (const name of ['imageMimeType', 'readImagePreview', 'imageFileSignature', 'uniqueImageFiles', 'addPendingImages']) {
    vm.runInContext(source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^}`, 'm'))[0], context);
  }
  return context;
}

test('mobile file with empty MIME gets a preview and independent upload bytes', async () => {
  const ctx = harness();
  const file = new File([new Uint8Array([137, 80, 78, 71])], 'Screenshot.PNG');
  assert.equal(ctx.uniqueImageFiles([file]).length, 1);
  const loading = ctx.addPendingImages([file]);
  assert.equal(ctx.pendingImages[0].loading, true);
  await loading;
  const image = ctx.pendingImages[0];
  assert.equal(image.url, 'data:image/png;base64,iVBORw==');
  assert.equal(image.file.type, 'image/png');
  assert.notEqual(image.file, file);
  assert.deepEqual(Buffer.from(await image.file.arrayBuffer()), Buffer.from(await file.arrayBuffer()));
  assert.equal(image.loading, false);
  assert.equal(image.error, '');
});

test('failed phone file reads retain removable error state', async () => {
  const ctx = harness({ fail: true });
  await ctx.addPendingImages([new File(['x'], 'photo.png', { type: 'image/png' })]);
  assert.equal(ctx.pendingImages[0].loading, false);
  assert.match(ctx.pendingImages[0].error, /Select it again/);
  assert.equal(ctx.pendingImages[0].url, '');
});
