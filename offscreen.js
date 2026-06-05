// Listen for OCR processing requests from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "processImageOcr") {
    const { dataUrl, rect, devicePixelRatio } = message;
    performCropAndOcr(dataUrl, rect, devicePixelRatio);
  }
});

/**
 * Loads the screenshot image, crops the target element region, and executes local Tesseract OCR.
 */
function performCropAndOcr(dataUrl, rect, dpr) {
  const img = new Image();
  img.onload = async () => {
    try {
      const canvas = document.createElement("canvas");
      
      // Bounding rect coordinates are scaled by the device pixel ratio to match physical screenshot coordinates
      const x = rect.left * dpr;
      const y = rect.top * dpr;
      const w = rect.width * dpr;
      const h = rect.height * dpr;

      // Safe guards to prevent invalid canvas dimensions
      if (w <= 0 || h <= 0) {
        throw new Error("Invalid crop dimensions");
      }

      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);

      const croppedDataUrl = canvas.toDataURL("image/png");

      // Initialize Tesseract worker pointing to bundled local files
      const worker = await Tesseract.createWorker("eng", 1, {
        workerPath: chrome.runtime.getURL("tesseract/worker.min.js"),
        corePath: chrome.runtime.getURL("tesseract/"),
        langPath: chrome.runtime.getURL("tesseract/"),
        workerBlobURL: false // Crucial to prevent MV3 CSP block on blob worker URL creation
      });

      // Run OCR on the cropped image
      const { data: { text } } = await worker.recognize(croppedDataUrl);
      
      // Clean up the worker
      await worker.terminate();

      // Return OCR result back to background.js
      chrome.runtime.sendMessage({
        action: "ocrResult",
        status: "success",
        text: text.trim()
      });
    } catch (error) {
      console.error("OCR execution error:", error);
      chrome.runtime.sendMessage({
        action: "ocrResult",
        status: "error",
        error: error.message || error.toString()
      });
    }
  };

  img.onerror = (err) => {
    console.error("Screenshot image load error:", err);
    chrome.runtime.sendMessage({
      action: "ocrResult",
      status: "error",
      error: "Failed to load screenshot image for cropping"
    });
  };

  img.src = dataUrl;
}
