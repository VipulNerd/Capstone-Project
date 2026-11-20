import { useCallback, useEffect, useState } from 'react';

// Copies the app's styles into the PiP window so components look the same there.
function copyStyles(target) {
  [...document.styleSheets].forEach((sheet) => {
    try {
      const style = target.document.createElement('style');
      style.textContent = [...sheet.cssRules].map((r) => r.cssText).join('\n');
      target.document.head.appendChild(style);
    } catch {
      if (sheet.href) {
        const link = target.document.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        target.document.head.appendChild(link);
      }
    }
  });
}

/**
 * Opens an always-on-top floating window (Document Picture-in-Picture API,
 * Chrome/Edge 116+). Render into it with createPortal(…, pipWindow.document.body).
 */
export default function usePictureInPicture({ width = 360, height = 460 } = {}) {
  const supported = typeof window !== 'undefined' && 'documentPictureInPicture' in window;
  const [pipWindow, setPipWindow] = useState(null);

  const open = useCallback(async () => {
    if (!supported) return null;
    if (window.documentPictureInPicture.window) return window.documentPictureInPicture.window;
    const win = await window.documentPictureInPicture.requestWindow({ width, height });
    copyStyles(win);
    win.document.title = 'MinutesAI overlay';
    win.addEventListener('pagehide', () => setPipWindow(null));
    setPipWindow(win);
    return win;
  }, [supported, width, height]);

  const close = useCallback(() => {
    pipWindow?.close();
    setPipWindow(null);
  }, [pipWindow]);

  // Close the floating window if the page using it unmounts.
  useEffect(() => () => pipWindow?.close(), [pipWindow]);

  return { supported, pipWindow, open, close };
}
