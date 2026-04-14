/**
 * editor.js
 * UI 互動模組：所有 DOM 操作與事件處理。
 * 純函式輔助工具（computeInitialPoints、clampToCanvas、isImageFile）
 * 已匯出以便進行單元測試。
 */

import {
    getPerspectiveTransform,
    applyPerspectiveTransform,
    processEnhancements,
} from './imageProcessing.js';

// ---------------------------------------------------------------------------
// 純函式輔助工具（已匯出，可單元測試）
// ---------------------------------------------------------------------------

/**
 * 計算預設的四個角落點位，內縮距離為畫布較短邊的 15%。
 * @param {number} width  - 畫布寬度
 * @param {number} height - 畫布高度
 * @returns {Array<{x:number, y:number}>} [左上, 右上, 右下, 左下]
 */
export function computeInitialPoints(width, height) {
    const pad = Math.min(width, height) * 0.15;
    return [
        { x: pad,         y: pad },
        { x: width - pad, y: pad },
        { x: width - pad, y: height - pad },
        { x: pad,         y: height - pad },
    ];
}

/**
 * 將座標值限制在畫布有效範圍 [0, max] 內。
 * @param {number} value - 原始座標
 * @param {number} max   - 畫布尺寸（寬或高）
 * @returns {number} 限制後的座標值
 */
export function clampToCanvas(value, max) {
    return Math.max(0, Math.min(value, max));
}

/**
 * 依據 MIME 類型判斷檔案是否為圖片。
 * @param {File} file
 * @returns {boolean}
 */
export function isImageFile(file) {
    return !!(file && typeof file.type === 'string' && file.type.startsWith('image/'));
}

// ---------------------------------------------------------------------------
// 應用程式狀態
// ---------------------------------------------------------------------------

let originalImg      = new Image();
let points           = [];
let scale            = 1;
let isDragging   = false;
let activeHandle = null;
let rawRectifiedData = null;

/** 拖曳時控制點視覺偏移的距離（px），避免游標／手指遮擋十字中心。 */
const DRAG_OFFSET = 48;

/**
 * 依控制點索引決定拖曳偏移方向：
 * 1、2 號（索引 0、1，上方角落）→ 向上偏移（-1）
 * 3、4 號（索引 2、3，下方角落）→ 向下偏移（+1）
 */
function dragOffsetSign(index) {
    return index <= 1 ? -1 : 1;
}

// ---------------------------------------------------------------------------
// DOM 參考（在應用程式初始化時設定）
// ---------------------------------------------------------------------------

let dom = {};

// ---------------------------------------------------------------------------
// UI 函式（已匯出，可透過 jsdom 進行測試）
// ---------------------------------------------------------------------------

/**
 * 在畫面下方顯示短暫提示訊息。
 * @param {string} text
 */
export function showMessage(text) {
    dom.msgText.innerText = text;
    dom.msgBox.classList.remove('opacity-0', 'translate-y-10');
    setTimeout(() => dom.msgBox.classList.add('opacity-0', 'translate-y-10'), 3000);
}

/**
 * 初始化（或重置）編輯器：設定畫布尺寸與預設控制點。
 */
export function initEditor() {
    // 若影像還未正確載入（寬或高為 0）則停止初始化，避免除以 0 或產生 Infinity
    if (!originalImg || !originalImg.width || !originalImg.height) {
        showMessage('無效影像');
        return;
    }

    dom.editorSection.classList.remove('hidden');
    dom.uploadSection.classList.add('hidden');
    dom.enhancementPanel.classList.add('hidden');

    dom.sharpRange.value   = 0;
    dom.contrastRange.value = 1.0;
    dom.glareRange.value   = 0;

    const containerWidth = dom.editorContainer.clientWidth - 80;
    scale = Math.min(1, containerWidth / originalImg.width);

    dom.sourceCanvas.width  = originalImg.width  * scale;
    dom.sourceCanvas.height = originalImg.height * scale;

    points = computeInitialPoints(dom.sourceCanvas.width, dom.sourceCanvas.height);

    updateCanvas();
    dom.resultPlaceholder.classList.remove('hidden');
    dom.resultActions.classList.add('hidden');
    dom.destCanvas.width = 0;
    rawRectifiedData = null;
}

/**
 * 重新繪製來源畫布：影像底圖 + 選取框 + 控制點。
 */
export function updateCanvas() {
    const sCtx = dom.sourceCanvas.getContext('2d');
    sCtx.clearRect(0, 0, dom.sourceCanvas.width, dom.sourceCanvas.height);
    sCtx.drawImage(originalImg, 0, 0, dom.sourceCanvas.width, dom.sourceCanvas.height);

    sCtx.beginPath();
    sCtx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < 4; i++) sCtx.lineTo(points[i].x, points[i].y);
    sCtx.closePath();
    sCtx.strokeStyle = '#3b82f6';
    sCtx.setLineDash([5, 5]);
    sCtx.lineWidth = 1.5;
    sCtx.stroke();
    sCtx.setLineDash([]);
    sCtx.fillStyle = 'rgba(59, 130, 246, 0.1)';
    sCtx.fill();

    points.forEach((p, i) => {
        const handle = dom.handles[i];
        if (!handle) return;
        handle.style.left = `${p.x}px`;
        // 拖曳時（觸控或滑鼠皆適用），依角落位置決定偏移方向：
        // 上方角落（1、2）往上偏移，下方角落（3、4）往下偏移
        const visualY = (isDragging && activeHandle === i)
            ? p.y + dragOffsetSign(i) * DRAG_OFFSET
            : p.y;
        handle.style.top = `${visualY}px`;
    });
}

/**
 * 處理檔案選取：驗證類型後讀取並載入圖片。
 */
export function handleFileSelect() {
    const file = dom.fileInput.files[0];
    if (!isImageFile(file)) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        originalImg.onload = () => initEditor();
        originalImg.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

/**
 * 處理拖曳移動：更新作用中控制點的座標（限制於畫布範圍內）。
 * @param {MouseEvent|TouchEvent} e
 */
export function move(e) {
    if (!isDragging) return;
    const rect    = dom.sourceCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = clampToCanvas(clientX - rect.left, dom.sourceCanvas.width);
    const y = clampToCanvas(clientY - rect.top,  dom.sourceCanvas.height);
    points[activeHandle] = { x, y };
    updateCanvas();
}

/**
 * 根據目前滑桿數值，套用影像增強並更新輸出畫布。
 */
export function processImage() {
    if (!rawRectifiedData) return;

    const sharpness = parseFloat(dom.sharpRange.value)   / 100;
    const contrast  = parseFloat(dom.contrastRange.value);
    const glare     = parseFloat(dom.glareRange.value)   / 100;

    dom.sharpValDisplay.innerText   = Math.round(sharpness * 100);
    dom.contrastValDisplay.innerText = contrast.toFixed(1);
    dom.glareValDisplay.innerText   = Math.round(glare * 100);

    const enhanced = processEnhancements(rawRectifiedData, { sharpness, contrast, glare });
    dom.destCanvas.getContext('2d').putImageData(enhanced, 0, 0);
}

/**
 * 測試/工具用：設定內部的 originalImg 物件（供測試注入使用）
 * @param {{width:number,height:number,src?:string}} img
 */
export function setOriginalImage(img) {
    originalImg = img;
}

// ---------------------------------------------------------------------------
// 應用程式初始化（設定 DOM 參考與事件監聽器）
// ---------------------------------------------------------------------------

/**
 * 初始化整個應用程式。
 * 在 DOMContentLoaded 後呼叫，或於測試中以模擬 DOM 呼叫。
 */
export function initApp() {
    dom = {
        fileInput:          document.getElementById('file-input'),
        uploadSection:      document.getElementById('upload-section'),
        editorSection:      document.getElementById('editor-section'),
        editorContainer:    document.querySelector('.editor-container'),
        sourceCanvas:       document.getElementById('source-canvas'),
        destCanvas:         document.getElementById('dest-canvas'),
        handles:            [0, 1, 2, 3].map(i => document.getElementById(`h${i}`)),
        msgBox:             document.getElementById('message-box'),
        msgText:            document.getElementById('message-text'),
        enhancementPanel:   document.getElementById('enhancement-panel'),
        sharpRange:         document.getElementById('sharp-range'),
        contrastRange:      document.getElementById('contrast-range'),
        glareRange:         document.getElementById('glare-range'),
        sharpValDisplay:    document.getElementById('sharp-val'),
        contrastValDisplay: document.getElementById('contrast-val'),
        glareValDisplay:    document.getElementById('glare-val'),
        resultPlaceholder:  document.getElementById('result-placeholder'),
        resultActions:      document.getElementById('result-actions'),
        transformBtn:       document.getElementById('transform-btn'),
        resetPointsBtn:     document.getElementById('reset-points'),
        downloadBtn:        document.getElementById('download-btn'),
        newUploadBtn:       document.getElementById('new-upload-btn'),
    };

    // 拖放上傳
    if (dom.fileInput) dom.fileInput.addEventListener('change', handleFileSelect);

    ['dragover', 'dragleave', 'drop'].forEach(evt => {
        document.body.addEventListener(evt, (e) => {
            e.preventDefault();
            if (evt === 'dragover')  dom.uploadSection.classList.add('drag-over');
            if (evt === 'dragleave') dom.uploadSection.classList.remove('drag-over');
            if (evt === 'drop') {
                dom.uploadSection.classList.remove('drag-over');
                if (e.dataTransfer.files.length) {
                    dom.fileInput.files = e.dataTransfer.files;
                    handleFileSelect();
                }
            }
        });
    });

    // 控制點拖曳（若某些 handle 缺失則跳過）
    dom.handles.forEach((handle, index) => {
        if (!handle) return;
        const onStart = (e) => {
            e.preventDefault();
            isDragging   = true;
            activeHandle = index;

            // 拖曳期間關閉 top/left 過渡動畫，確保圓圈即時跟隨（觸控與滑鼠皆適用）
            handle.style.transition = 'border-color 0.2s';

            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup',   onEnd);
            window.addEventListener('touchmove', move,  { passive: false });
            window.addEventListener('touchend',  onEnd);
        };
        handle.addEventListener('mousedown',  onStart);
        handle.addEventListener('touchstart', onStart, { passive: false });
    });

    function onEnd() {
        const releasedHandle = activeHandle;

        if (releasedHandle !== null) {
            // 拖曳結束（觸控或滑鼠皆適用）：將座標更新至圓圈中心座標
            // 上方角落偏移量為負（圓圈在游標上方），下方角落為正（圓圈在游標下方）
            points[releasedHandle] = {
                x: points[releasedHandle].x,
                y: clampToCanvas(
                    points[releasedHandle].y + dragOffsetSign(releasedHandle) * DRAG_OFFSET,
                    dom.sourceCanvas.height,
                ),
            };
        }

        isDragging   = false;
        activeHandle = null;

        if (releasedHandle !== null && dom.handles[releasedHandle]) {
            dom.handles[releasedHandle].style.transition = '';
        }
        updateCanvas(); // 以更新後座標重繪；觸控時圓圈位置不變，滑鼠時同樣不移動

        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup',   onEnd);
        window.removeEventListener('touchmove', move);
        window.removeEventListener('touchend',  onEnd);
    }

    // 重置點位
    dom.resetPointsBtn.addEventListener('click', initEditor);

    // 執行透視校正
    dom.transformBtn.addEventListener('click', () => {
        const w1 = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
        const w2 = Math.hypot(points[2].x - points[3].x, points[2].y - points[3].y);
        const h1 = Math.hypot(points[3].x - points[0].x, points[3].y - points[0].y);
        const h2 = Math.hypot(points[2].x - points[1].x, points[2].y - points[1].y);

        const targetWidth  = Math.max(w1, w2) / scale;
        const targetHeight = Math.max(h1, h2) / scale;

        dom.destCanvas.width  = targetWidth;
        dom.destCanvas.height = targetHeight;

        const srcPoints = points.map(p => ({ x: p.x / scale, y: p.y / scale }));
        const dstPoints = [
            { x: 0,           y: 0            },
            { x: targetWidth, y: 0            },
            { x: targetWidth, y: targetHeight },
            { x: 0,           y: targetHeight },
        ];

        const matrix = getPerspectiveTransform(dstPoints, srcPoints);
        if (!matrix) return showMessage('點位無效');

        const tempCanvas  = document.createElement('canvas');
        tempCanvas.width  = originalImg.width;
        tempCanvas.height = originalImg.height;
        const tCtx        = tempCanvas.getContext('2d');
        tCtx.drawImage(originalImg, 0, 0);
        const srcImgData = tCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);

        rawRectifiedData = applyPerspectiveTransform(srcImgData, matrix, targetWidth, targetHeight);
        dom.destCanvas.getContext('2d').putImageData(rawRectifiedData, 0, 0);

        dom.resultPlaceholder.classList.add('hidden');
        dom.resultActions.classList.remove('hidden');
        dom.enhancementPanel.classList.remove('hidden');
        showMessage('轉換成功！');
    });

    // 影像增強滑桿（防抖動）
    let filterTimeout;
    const debouncedProcess = () => {
        clearTimeout(filterTimeout);
        filterTimeout = setTimeout(processImage, 50);
    };
    [dom.sharpRange, dom.contrastRange, dom.glareRange]
        .forEach(r => r.addEventListener('input', debouncedProcess));

    // 下載
    dom.downloadBtn.addEventListener('click', () => {
        const link      = document.createElement('a');
        link.download   = `rectified_${Date.now()}.png`;
        link.href       = dom.destCanvas.toDataURL('image/png');
        link.click();
    });

    // 重新上傳
    dom.newUploadBtn.addEventListener('click', () => location.reload());
}

// 注意：initApp 需由 HTML 的入口腳本明確呼叫，而非在模組載入時自動執行。
// 這樣可以確保測試環境在匯入此模組時不會意外觸發 DOM 操作。
