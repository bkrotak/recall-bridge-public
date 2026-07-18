import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function captureWeb({ url, outputDir, width = 390, height = 844, fullPage = true, sections = true }) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('Visual capture requires Playwright. Run: npm install --save-dev playwright && npx playwright install chromium');
  }

  await mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const consoleMessages = [];
  const failedRequests = [];
  page.on('console', (message) => consoleMessages.push({ type: message.type(), text: message.text() }));
  page.on('pageerror', (error) => consoleMessages.push({ type: 'pageerror', text: error.message }));
  page.on('requestfailed', (request) => failedRequests.push({ url: request.url(), method: request.method(), error: request.failure()?.errorText }));

  try {
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.screenshot({ path: path.join(outputDir, 'viewport.png') });
    if (fullPage) await page.screenshot({ path: path.join(outputDir, 'full-page.png'), fullPage: true });

    const dimensions = await page.evaluate(() => ({
      width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
      height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
      title: document.title,
    }));
    const sectionFiles = [];
    if (sections) {
      const count = Math.max(1, Math.ceil(dimensions.height / height));
      for (let index = 0; index < count; index += 1) {
        await page.evaluate((top) => window.scrollTo(0, top), index * height);
        await page.waitForTimeout(150);
        const name = `section-${String(index + 1).padStart(3, '0')}.png`;
        await page.screenshot({ path: path.join(outputDir, name) });
        sectionFiles.push(name);
      }
    }

    const report = {
      url,
      capturedAt: new Date().toISOString(),
      viewport: { width, height },
      page: dimensions,
      status: response?.status() || null,
      files: { viewport: 'viewport.png', fullPage: fullPage ? 'full-page.png' : null, sections: sectionFiles },
      console: consoleMessages,
      failedRequests,
    };
    await writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
    return report;
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [url, outputDir, width, height] = process.argv.slice(2);
  const report = await captureWeb({ url, outputDir, width: Number(width || 390), height: Number(height || 844) });
  console.log(JSON.stringify(report));
}
