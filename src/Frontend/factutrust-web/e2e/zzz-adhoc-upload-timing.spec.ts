import { test } from '@playwright/test';

test('upload progress timing with big payload, delayed fulfill', async ({ page }) => {
  await page.route('**/echo', async route => {
    await new Promise(r => setTimeout(r, 3000));
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.goto('/');
  const events: string[] = [];
  await page.exposeFunction('logEvent', (e: string) => events.push(e));
  await page.evaluate(() => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/echo');
    xhr.upload.onprogress = (e) => (window as any).logEvent(`upload-progress ${e.loaded}/${e.total} @ ${Date.now()}`);
    xhr.onloadstart = () => (window as any).logEvent(`loadstart @ ${Date.now()}`);
    xhr.onload = () => (window as any).logEvent(`load @ ${Date.now()}`);
    const blob = new Blob([new Uint8Array(30 * 1024 * 1024)]);
    const fd = new FormData();
    fd.append('file', blob, 'x.bin');
    (window as any).logEvent(`start @ ${Date.now()}`);
    xhr.send(fd);
  });
  await page.waitForTimeout(8000);
  console.log('EVENTS', JSON.stringify(events, null, 1));
});
