/**
 * Native screenshot utility — replaces html2canvas
 *
 * Charts rendered by lightweight-charts use <canvas> elements natively.
 * We can capture them directly with canvas.toDataURL() — no library needed,
 * and the result is sharper (no DOM-recursion cost).
 *
 * Fallback: if no canvas is found inside the target, we render the element
 * via the browser's SVG <foreignObject> + drawImage technique. This is the
 * "native html2canvas" approach.
 */

/** Capture the first <canvas> inside an element as a PNG download. */
export async function captureCanvasScreenshot(
  element: HTMLElement | null,
  filename = `lazuli-${Date.now()}.png`
): Promise<void> {
  if (!element) return;

  const canvas = element.querySelector('canvas');
  if (!canvas) {
    // No canvas found — silently skip. Caller can show a toast.
    return;
  }

  try {
    const url = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    link.click();
  } catch (err) {
    console.error('Screenshot failed:', err);
  }
}

/**
 * Generic element screenshot via SVG <foreignObject> serialization.
 *
 * This is the W3C-standard way to render DOM to an image without external deps.
 * It serializes the element to SVG, draws the SVG onto a canvas, then exports.
 *
 * Caveats: external images may not render due to CORS. For charts (which are
 * canvas-based), prefer `captureCanvasScreenshot` instead.
 */
export async function captureElementScreenshot(
  element: HTMLElement | null,
  filename = `lazuli-${Date.now()}.png`,
  backgroundColor = '#0a0e1f'
): Promise<void> {
  if (!element) return;

  // Try canvas first — fast and reliable for chart elements
  const canvas = element.querySelector('canvas');
  if (canvas) {
    return captureCanvasScreenshot(element, filename);
  }

  // Fall back to SVG foreignObject technique
  try {
    const rect = element.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);

    // Clone the node so we don't mutate the live DOM
    const clone = element.cloneNode(true) as HTMLElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');

    const serializer = new XMLSerializer();
    const serialized = serializer.serializeToString(clone);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;background:${backgroundColor};">
          ${serialized}
        </div>
      </foreignObject>
    </svg>`;

    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.crossOrigin = 'anonymous';

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load serialized SVG'));
      img.src = svgUrl;
    });

    const renderCanvas = document.createElement('canvas');
    renderCanvas.width = width * 2; // 2x for retina
    renderCanvas.height = height * 2;
    const ctx = renderCanvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');

    ctx.scale(2, 2);
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0);

    URL.revokeObjectURL(svgUrl);

    renderCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = filename;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  } catch (err) {
    console.error('Element screenshot failed:', err);
  }
}
