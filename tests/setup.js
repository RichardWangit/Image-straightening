/**
 * tests/setup.js
 * Vitest 全域測試環境設定。
 * 在每個測試檔案執行前，為 jsdom 補充 Canvas API 的模擬實作。
 */

import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// ImageData polyfill
// jsdom 的部分版本未內建 ImageData，手動補充以支援影像處理測試。
// ---------------------------------------------------------------------------

if (typeof global.ImageData === 'undefined') {
    global.ImageData = class ImageData {
        constructor(...args) {
            if (args[0] instanceof Uint8ClampedArray) {
                // new ImageData(data, width[, height])
                this.data   = args[0];
                this.width  = args[1];
                this.height = args[2] !== undefined
                    ? args[2]
                    : args[0].length / (args[1] * 4);
            } else {
                // new ImageData(width, height)
                this.width  = args[0];
                this.height = args[1];
                this.data   = new Uint8ClampedArray(args[0] * args[1] * 4);
            }
        }
    };
}

// ---------------------------------------------------------------------------
// Canvas Context 模擬
// jsdom 不支援 Canvas 渲染，以假物件取代，避免 getContext() 回傳 null。
// ---------------------------------------------------------------------------

const mockContext = () => ({
    clearRect:       vi.fn(),
    drawImage:       vi.fn(),
    beginPath:       vi.fn(),
    moveTo:          vi.fn(),
    lineTo:          vi.fn(),
    closePath:       vi.fn(),
    stroke:          vi.fn(),
    fill:            vi.fn(),
    setLineDash:     vi.fn(),
    putImageData:    vi.fn(),
    getImageData:    vi.fn((x, y, w, h) => new ImageData(w || 1, h || 1)),
    createImageData: vi.fn((w, h) => new ImageData(w, h)),
    toDataURL:       vi.fn(() => 'data:image/png;base64,'),
});

HTMLCanvasElement.prototype.getContext  = vi.fn(mockContext);
HTMLCanvasElement.prototype.toDataURL   = vi.fn(() => 'data:image/png;base64,');

// ---------------------------------------------------------------------------
// location.reload 模擬
// jsdom 環境中呼叫 location.reload() 會拋出錯誤，以空函式替代。
// ---------------------------------------------------------------------------

Object.defineProperty(window, 'location', {
    value:    { ...window.location, reload: vi.fn() },
    writable: true,
});
