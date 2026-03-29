/**
 * imageProcessing.js
 * 純函式模組：所有影像處理與數學演算法。
 * 此模組不依賴任何 DOM API，可直接進行單元測試。
 */

/**
 * 以高斯消去法（部分選主元）求解 n 元線性方程組。
 * @param {number[][]} matrix - 增廣矩陣，大小為 n×(n+1)
 * @returns {number[]|null} 解向量；若矩陣為奇異矩陣則回傳 null
 */
export function solveLinearSystem(matrix) {
    const n = matrix.length;
    const m = matrix.map(row => [...row]); // 深複製，避免改動原始輸入

    for (let i = 0; i < n; i++) {
        // 尋找部分主元
        let maxRow = i;
        for (let j = i + 1; j < n; j++) {
            if (Math.abs(m[j][i]) > Math.abs(m[maxRow][i])) maxRow = j;
        }
        [m[i], m[maxRow]] = [m[maxRow], m[i]];

        if (Math.abs(m[i][i]) < 1e-10) return null; // 奇異矩陣

        // 向前消去
        for (let j = i + 1; j < n; j++) {
            const factor = m[j][i] / m[i][i];
            for (let k = i; k <= n; k++) {
                m[j][k] -= factor * m[i][k];
            }
        }
    }

    // 回代求解
    const solution = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
        let sum = 0;
        for (let j = i + 1; j < n; j++) sum += m[i][j] * solution[j];
        solution[i] = (m[i][n] - sum) / m[i][i];
    }
    return solution;
}

/**
 * 計算將來源四點映射至目標四點的 8 參數透視變換矩陣。
 * @param {Array<{x:number, y:number}>} src - 四個來源點
 * @param {Array<{x:number, y:number}>} dst - 四個目標點
 * @returns {number[]|null} 8 元素矩陣；若點位退化則回傳 null
 */
export function getPerspectiveTransform(src, dst) {
    const system = [];
    for (let i = 0; i < 4; i++) {
        system.push([
            src[i].x, src[i].y, 1, 0, 0, 0,
            -src[i].x * dst[i].x, -src[i].y * dst[i].x, dst[i].x,
        ]);
        system.push([
            0, 0, 0, src[i].x, src[i].y, 1,
            -src[i].x * dst[i].y, -src[i].y * dst[i].y, dst[i].y,
        ]);
    }
    return solveLinearSystem(system);
}

/**
 * 以雙線性插值法在影像的分數座標位置取樣像素值。
 * 呼叫端須確保 (sx, sy) 在有效範圍內（即 sx < srcWidth-1, sy < srcHeight-1）。
 * @param {Uint8ClampedArray} srcData - 來源像素資料（RGBA 排列）
 * @param {number} srcWidth - 來源影像寬度
 * @param {number} srcHeight - 來源影像高度（供未來邊界檢查使用）
 * @param {number} sx - 分數 x 座標
 * @param {number} sy - 分數 y 座標
 * @returns {number[]} RGBA 四元素陣列
 */
export function bilinearInterpolate(srcData, srcWidth, srcHeight, sx, sy) {
    const ix = Math.floor(sx);
    const iy = Math.floor(sy);
    const dx = sx - ix;
    const dy = sy - iy;
    const result = new Array(4);

    for (let c = 0; c < 4; c++) {
        const p00 = srcData[(iy * srcWidth + ix) * 4 + c];
        const p10 = srcData[(iy * srcWidth + (ix + 1)) * 4 + c];
        const p01 = srcData[((iy + 1) * srcWidth + ix) * 4 + c];
        const p11 = srcData[((iy + 1) * srcWidth + (ix + 1)) * 4 + c];
        result[c] = (1 - dx) * (1 - dy) * p00
                  + dx       * (1 - dy) * p10
                  + (1 - dx) * dy       * p01
                  + dx       * dy       * p11;
    }
    return result;
}

/**
 * 以反向映射（backward mapping）搭配雙線性插值，對影像套用透視變換。
 * @param {ImageData} srcImageData - 來源影像資料
 * @param {number[]} matrix - 8 元素透視矩陣（由 getPerspectiveTransform 產生）
 * @param {number} targetWidth - 輸出影像寬度（像素）
 * @param {number} targetHeight - 輸出影像高度（像素）
 * @returns {ImageData} 變換後的影像資料
 */
export function applyPerspectiveTransform(srcImageData, matrix, targetWidth, targetHeight) {
    const w = Math.floor(targetWidth);
    const h = Math.floor(targetHeight);
    const destImageData = new ImageData(w, h);
    const sD = srcImageData.data;
    const dD = destImageData.data;
    const sW = srcImageData.width;
    const sH = srcImageData.height;
    const m = [...matrix, 1]; // 加入隱含的第 9 個係數 h8=1

    for (let v = 0; v < h; v++) {
        for (let u = 0; u < w; u++) {
            const den = m[6] * u + m[7] * v + m[8];
            const sx  = (m[0] * u + m[1] * v + m[2]) / den;
            const sy  = (m[3] * u + m[4] * v + m[5]) / den;
            const dIdx = (v * w + u) * 4;

            if (sx >= 0 && sx < sW - 1 && sy >= 0 && sy < sH - 1) {
                const pixel = bilinearInterpolate(sD, sW, sH, sx, sy);
                for (let c = 0; c < 4; c++) dD[dIdx + c] = pixel[c];
            }
        }
    }
    return destImageData;
}

/**
 * 偵測高亮（反光）區域並動態降低其亮度。
 * 感知亮度超過 180 的像素會按比例降低。
 * @param {ImageData} imageData - 影像資料（就地修改）
 * @param {number} amount - 抑制強度，0（無效果）至 1（最強）
 */
export function applyGlareReduction(imageData, amount) {
    const data = imageData.data;
    const threshold = 180;
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        if (luma > threshold) {
            const diff      = (luma - threshold) / (255 - threshold);
            const reduction = 1 - (diff * amount * 0.5);
            data[i]     *= reduction;
            data[i + 1] *= reduction;
            data[i + 2] *= reduction;
        }
    }
}

/**
 * 以 Unsharp Mask 核心銳化影像。
 * 邊框像素（1px）保持不變，避免邊緣偽影。
 * @param {ImageData} imageData - 影像資料（就地修改）
 * @param {number} amount - 銳化強度，0（無效果）至 1（最強）
 */
export function applySharpen(imageData, amount) {
    const { data, width, height } = imageData;
    const output = new Uint8ClampedArray(data); // 複製作為輸出緩衝

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            for (let c = 0; c < 3; c++) {
                const i       = (y * width + x) * 4 + c;
                const center  = data[i];
                const neighbors =
                    data[((y - 1) * width + x) * 4 + c] +
                    data[((y + 1) * width + x) * 4 + c] +
                    data[(y * width + (x - 1)) * 4 + c] +
                    data[(y * width + (x + 1)) * 4 + c];
                const laplacian = center * 5 - neighbors;
                output[i] = Math.max(0, Math.min(255, center + (laplacian - center) * amount));
            }
        }
    }
    data.set(output);
}

/**
 * 以中點（128）為基準調整影像對比度。
 * @param {ImageData} imageData - 影像資料（就地修改）
 * @param {number} contrast - 對比度倍數（1.0 不變，>1 增強，<1 降低）
 */
export function applyContrast(imageData, contrast) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        data[i]     = Math.max(0, Math.min(255, (data[i]     - 128) * contrast + 128));
        data[i + 1] = Math.max(0, Math.min(255, (data[i + 1] - 128) * contrast + 128));
        data[i + 2] = Math.max(0, Math.min(255, (data[i + 2] - 128) * contrast + 128));
        // data[i + 3]：Alpha 通道不修改
    }
}

/**
 * 依序套用完整的影像增強流程：反光抑制 → 銳化 → 對比度。
 * 不修改輸入資料，回傳新的 ImageData。
 * @param {ImageData} rawImageData - 原始影像資料
 * @param {{ sharpness: number, contrast: number, glare: number }} options
 * @returns {ImageData} 增強後的影像資料
 */
export function processEnhancements(rawImageData, { sharpness, contrast, glare }) {
    const workingData = new ImageData(
        new Uint8ClampedArray(rawImageData.data),
        rawImageData.width,
        rawImageData.height,
    );
    if (glare > 0)        applyGlareReduction(workingData, glare);
    if (sharpness > 0)    applySharpen(workingData, sharpness);
    if (contrast !== 1.0) applyContrast(workingData, contrast);
    return workingData;
}
