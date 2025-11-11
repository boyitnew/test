// scripts/run-cdp-windows.js
const CDP = require('chrome-remote-interface');
const fs = require('fs');
const path = require('path');

(async () => {
  const url = process.env.TARGET_URL;
  const waitSeconds = parseInt(process.env.WAIT_SECONDS || '3', 10);
  const port = 9222;
  const outFile = path.join(process.env.GITHUB_WORKSPACE || process.cwd(), 'screenshot.png');

  if (!url) {
    console.error('TARGET_URL not set. Provide URL when running the workflow.');
    process.exit(1);
  }

  let client;
  try {
    // retry connect to CDP because chrome may take time
    const maxRetries = 12;
    for (let i = 0; i < maxRetries; i++) {
      try {
        client = await CDP({ port });
        break;
      } catch (e) {
        if (i === maxRetries - 1) throw e;
        await new Promise(r => setTimeout(r, 500));
      }
    }

    const { Page, Runtime, Target } = client;
    await Page.enable();

    // create a clean new tab and connect to it
    const created = await Target.createTarget({ url: 'about:blank' });
    const targetId = created && created.targetId;
    if (!targetId) throw new Error('Failed to create target');

    // reconnect to the new target
    await client.close();
    client = await CDP({ port, target: targetId });
    const page = client.Page;
    const runtime = client.Runtime;
    await page.enable();

    console.log('Navigating to:', url);
    await page.navigate({ url });

    // wait for load or fixed wait
    await Promise.race([
      page.loadEventFired(),
      new Promise(r => setTimeout(r, waitSeconds * 1000))
    ]);
    console.log(`Page loaded (waited initial ${waitSeconds}s). Now waiting 20s before screenshot...`);

    // wait 20 seconds before screenshot
    await new Promise(r => setTimeout(r, 20000));

    // evaluate document.title
    const evalRes = await runtime.evaluate({
      expression: 'document.title',
      returnByValue: true,
      awaitPromise: true
    });

    const title = evalRes && evalRes.result && evalRes.result.value !== undefined ? evalRes.result.value : null;
    console.log('== Page <title> ==');
    console.log(title);
    console.log('== End ==');

    // capture screenshot (full page)
    // Use fromSurface:true to capture compositor surface
    const shot = await page.captureScreenshot({ format: 'png', fromSurface: true });
    if (shot && shot.data) {
      fs.writeFileSync(outFile, Buffer.from(shot.data, 'base64'));
      console.log('Screenshot saved to', outFile);
    } else {
      console.warn('No screenshot data returned.');
    }

    await client.close();
    process.exit(0);
  } catch (err) {
    console.error('Error during CDP operation:', err);
    if (client) {
      try { await client.close(); } catch (e) {}
    }
    process.exit(2);
  }
})();
