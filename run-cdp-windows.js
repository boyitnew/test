// scripts/run-cdp-windows.js
const CDP = require('chrome-remote-interface');

(async () => {
  const url = process.env.TARGET_URL;
  const waitSeconds = parseInt(process.env.WAIT_SECONDS || '3', 10);
  const port = 9222;

  if (!url) {
    console.error('TARGET_URL not set. Provide URL when running the workflow.');
    process.exit(1);
  }

  let client;
  try {
    // try to connect (retry a few times because chrome may still be starting)
    const maxRetries = 8;
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

    // Create a new target (tab) and attach to it so we have a clean context
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
