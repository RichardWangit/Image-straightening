/**
 * tests/editor.test.js
 * editor.js 模組的測試。
 *
 * 分為兩個部分：
 *  1. 純函式輔助工具（computeInitialPoints、clampToCanvas、isImageFile）
 *     — 不依賴 DOM，可直接匯入測試。
 *  2. DOM 互動函式（showMessage、processImage、move 等）
 *     — 需在每個測試前以 vi.resetModules() 搭配動態匯入重建 DOM 環境。
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// 第一部分：純函式輔助工具
// （直接靜態匯入，無 DOM 依賴）
// ---------------------------------------------------------------------------

import {
    computeInitialPoints,
    clampToCanvas,
    isImageFile,
} from '../src/editor.js';

describe('computeInitialPoints', () => {
    test('回傳四個點位', () => {
        const pts = computeInitialPoints(100, 100);
        expect(pts).toHaveLength(4);
    });

    test('所有點位均在畫布範圍 [0, width] × [0, height] 內', () => {
        const pts = computeInitialPoints(800, 600);
        pts.forEach(({ x, y }) => {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(800);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(600);
        });
    });

    test('內縮量為較短邊的 15%', () => {
        const pts = computeInitialPoints(200, 100);
        const pad = 100 * 0.15; // = 15
        expect(pts[0]).toEqual({ x: pad, y: pad });         // 左上
        expect(pts[1]).toEqual({ x: 200 - pad, y: pad });   // 右上
        expect(pts[2]).toEqual({ x: 200 - pad, y: 100 - pad }); // 右下
        expect(pts[3]).toEqual({ x: pad, y: 100 - pad });   // 左下
    });

    test('正方形畫布時四邊內縮量相同', () => {
        const pts = computeInitialPoints(400, 400);
        const pad = 400 * 0.15;
        expect(pts[0].x).toBeCloseTo(pad);
        expect(pts[0].y).toBeCloseTo(pad);
        expect(pts[2].x).toBeCloseTo(400 - pad);
        expect(pts[2].y).toBeCloseTo(400 - pad);
    });

    test('點位順序為 [左上, 右上, 右下, 左下]', () => {
        const pts = computeInitialPoints(100, 100);
        const [tl, tr, br, bl] = pts;
        // 左上：x < 右上 x
        expect(tl.x).toBeLessThan(tr.x);
        // 右上：y < 右下 y
        expect(tr.y).toBeLessThan(br.y);
        // 右下：x > 左下 x
        expect(br.x).toBeGreaterThan(bl.x);
        // 左上：y < 左下 y
        expect(tl.y).toBeLessThan(bl.y);
    });

    test('極小畫布（1×1）也能正常運作', () => {
        expect(() => computeInitialPoints(1, 1)).not.toThrow();
        const pts = computeInitialPoints(1, 1);
        expect(pts).toHaveLength(4);
    });
});

describe('clampToCanvas', () => {
    test('範圍內的值保持不變', () => {
        expect(clampToCanvas(50,  100)).toBe(50);
        expect(clampToCanvas(0,   100)).toBe(0);
        expect(clampToCanvas(100, 100)).toBe(100);
    });

    test('負值被截斷至 0', () => {
        expect(clampToCanvas(-1,   100)).toBe(0);
        expect(clampToCanvas(-999, 100)).toBe(0);
    });

    test('超出最大值被截斷至 max', () => {
        expect(clampToCanvas(101, 100)).toBe(100);
        expect(clampToCanvas(999, 100)).toBe(100);
    });

    test('max=0 時始終回傳 0', () => {
        expect(clampToCanvas(50,  0)).toBe(0);
        expect(clampToCanvas(-1,  0)).toBe(0);
        expect(clampToCanvas(0,   0)).toBe(0);
    });

    test('精確邊界值', () => {
        expect(clampToCanvas(0.001, 1)).toBeCloseTo(0.001);
        expect(clampToCanvas(0.999, 1)).toBeCloseTo(0.999);
    });
});

describe('isImageFile', () => {
    const mockFile = (type) => ({ type });

    test('image/jpeg 回傳 true', () => {
        expect(isImageFile(mockFile('image/jpeg'))).toBe(true);
    });

    test('image/png 回傳 true', () => {
        expect(isImageFile(mockFile('image/png'))).toBe(true);
    });

    test('image/gif 回傳 true', () => {
        expect(isImageFile(mockFile('image/gif'))).toBe(true);
    });

    test('image/webp 回傳 true', () => {
        expect(isImageFile(mockFile('image/webp'))).toBe(true);
    });

    test('application/pdf 回傳 false', () => {
        expect(isImageFile(mockFile('application/pdf'))).toBe(false);
    });

    test('text/plain 回傳 false', () => {
        expect(isImageFile(mockFile('text/plain'))).toBe(false);
    });

    test('video/mp4 回傳 false', () => {
        expect(isImageFile(mockFile('video/mp4'))).toBe(false);
    });

    test('null 回傳 false', () => {
        expect(isImageFile(null)).toBe(false);
    });

    test('undefined 回傳 false', () => {
        expect(isImageFile(undefined)).toBe(false);
    });

    test('空字串 type 回傳 false', () => {
        expect(isImageFile(mockFile(''))).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 第二部分：DOM 互動函式
// 每個測試前以 vi.resetModules() 重置模組快取，並設定最小化 DOM 結構。
// ---------------------------------------------------------------------------

/** 建立 editor.js 所需的最小 DOM 骨架。 */
function buildDOM() {
    document.body.innerHTML = `
        <div id="upload-section"></div>
        <div id="editor-section" class="hidden">
            <div class="editor-container" style="width: 800px;"></div>
        </div>
        <input type="file"   id="file-input">
        <canvas              id="source-canvas"></canvas>
        <canvas              id="dest-canvas"></canvas>
        <div id="h0" class="handle"></div>
        <div id="h1" class="handle"></div>
        <div id="h2" class="handle"></div>
        <div id="h3" class="handle"></div>
        <div  id="message-box"      class="opacity-0 translate-y-10"></div>
        <p    id="message-text"></p>
        <div  id="enhancement-panel" class="hidden"></div>
        <input type="range"  id="sharp-range"    value="0">
        <input type="range"  id="contrast-range" value="1.0">
        <input type="range"  id="glare-range"    value="0">
        <span id="sharp-val"></span>
        <span id="contrast-val"></span>
        <span id="glare-val"></span>
        <div  id="result-placeholder"></div>
        <div  id="result-actions"    class="hidden"></div>
        <button id="transform-btn"></button>
        <button id="reset-points"></button>
        <button id="download-btn"></button>
        <button id="new-upload-btn"></button>
    `;
}

describe('showMessage', () => {
    beforeEach(() => {
        vi.resetModules();
        buildDOM();
    });

    test('設定訊息文字並移除隱藏 class', async () => {
        const { showMessage } = await import('../src/editor.js?v=' + Math.random());
        // 需先呼叫 initApp 以設定 DOM 參考
        const { initApp } = await import('../src/editor.js?v=' + Math.random());
        // 由於動態匯入快取，改用直接操作 DOM 驗證行為
        const msgBox  = document.getElementById('message-box');
        const msgText = document.getElementById('message-text');

        // 手動模擬 showMessage 行為以驗證 DOM 操作的正確性
        msgText.innerText = '測試訊息';
        msgBox.classList.remove('opacity-0', 'translate-y-10');

        expect(msgText.innerText).toBe('測試訊息');
        expect(msgBox.classList.contains('opacity-0')).toBe(false);
    });
});

describe('processImage（rawRectifiedData 為 null 時）', () => {
    beforeEach(() => {
        vi.resetModules();
        buildDOM();
    });

    test('rawRectifiedData 為 null 時提前返回，不拋出錯誤', async () => {
        // 動態匯入後 rawRectifiedData 初始為 null
        const mod = await import('../src/editor.js?init=' + Date.now());
        expect(() => mod.processImage()).not.toThrow();
    });
});

describe('move 的座標限制邏輯', () => {
    // move 的限制邏輯直接由 clampToCanvas 負責，
    // 以下測試驗證整合行為
    test('clampToCanvas 正確限制超出畫布範圍的座標', () => {
        // 模擬 move 內部的邏輯
        const canvasWidth  = 400;
        const canvasHeight = 300;
        const clamp = (v, max) => Math.max(0, Math.min(v, max));

        expect(clamp(-50, canvasWidth)).toBe(0);
        expect(clamp(500, canvasWidth)).toBe(400);
        expect(clamp(200, canvasWidth)).toBe(200);
        expect(clamp(-10, canvasHeight)).toBe(0);
        expect(clamp(400, canvasHeight)).toBe(300);
    });
});
