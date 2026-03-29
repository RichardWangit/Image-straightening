/**
 * tests/imageProcessing.test.js
 * imageProcessing.js 模組的單元測試。
 * 所有函式均為純函式，不依賴 DOM，測試可直接執行。
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
    solveLinearSystem,
    getPerspectiveTransform,
    bilinearInterpolate,
    applyPerspectiveTransform,
    applyGlareReduction,
    applySharpen,
    applyContrast,
    processEnhancements,
} from '../src/imageProcessing.js';

// ---------------------------------------------------------------------------
// 輔助工具
// ---------------------------------------------------------------------------

/** 建立指定尺寸的 ImageData，以純色填滿（預設黑色不透明）。 */
function makeImageData(width, height, fillRGBA = [0, 0, 0, 255]) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
        data[i]     = fillRGBA[0];
        data[i + 1] = fillRGBA[1];
        data[i + 2] = fillRGBA[2];
        data[i + 3] = fillRGBA[3];
    }
    return new ImageData(data, width, height);
}

/** 取得 ImageData 中指定像素的 RGBA 值。 */
function getPixel(imageData, x, y) {
    const i = (y * imageData.width + x) * 4;
    return [
        imageData.data[i],
        imageData.data[i + 1],
        imageData.data[i + 2],
        imageData.data[i + 3],
    ];
}

// ---------------------------------------------------------------------------
// solveLinearSystem
// ---------------------------------------------------------------------------

describe('solveLinearSystem', () => {
    test('求解 2×2 方程組', () => {
        // 2x + y = 5
        // x + 3y = 10  →  x=1, y=3
        const result = solveLinearSystem([[2, 1, 5], [1, 3, 10]]);
        expect(result[0]).toBeCloseTo(1);
        expect(result[1]).toBeCloseTo(3);
    });

    test('求解 3×3 對角方程組', () => {
        // x=1, y=2, z=3
        const result = solveLinearSystem([
            [1, 0, 0, 1],
            [0, 1, 0, 2],
            [0, 0, 1, 3],
        ]);
        expect(result[0]).toBeCloseTo(1);
        expect(result[1]).toBeCloseTo(2);
        expect(result[2]).toBeCloseTo(3);
    });

    test('奇異矩陣（線性相依列）回傳 null', () => {
        // 兩列相同 → 奇異
        expect(solveLinearSystem([[1, 2, 3], [2, 4, 6]])).toBeNull();
    });

    test('全零主對角線回傳 null', () => {
        expect(solveLinearSystem([[0, 0, 1], [0, 0, 1]])).toBeNull();
    });

    test('不修改原始輸入矩陣', () => {
        const matrix = [[2, 1, 5], [1, 3, 10]];
        const original = matrix.map(r => [...r]);
        solveLinearSystem(matrix);
        expect(matrix).toEqual(original);
    });

    test('回傳精確解（驗算：Ax = b）', () => {
        // 3x + 2y - z = 1
        // 2x - 2y + 4z = -2
        // -x + y/2 - z = 0
        const A = [
            [3,  2, -1,  1],
            [2, -2,  4, -2],
            [-1, 0.5, -1, 0],
        ];
        const result = solveLinearSystem(A);
        expect(result).not.toBeNull();
        // 驗算：Ax ≈ b
        expect(3*result[0] + 2*result[1] - result[2]).toBeCloseTo(1);
        expect(2*result[0] - 2*result[1] + 4*result[2]).toBeCloseTo(-2);
        expect(-result[0] + 0.5*result[1] - result[2]).toBeCloseTo(0);
    });
});

// ---------------------------------------------------------------------------
// getPerspectiveTransform
// ---------------------------------------------------------------------------

describe('getPerspectiveTransform', () => {
    test('恆等變換（來源 = 目標）產生恆等映射矩陣', () => {
        const pts = [
            { x: 0, y: 0 }, { x: 1, y: 0 },
            { x: 1, y: 1 }, { x: 0, y: 1 },
        ];
        const m = getPerspectiveTransform(pts, pts);
        expect(m).not.toBeNull();
        // 以矩陣驗算：點 (0.5, 0.5) 應映射至 (0.5, 0.5)
        const u = 0.5, v = 0.5;
        const den = m[6]*u + m[7]*v + 1;
        expect((m[0]*u + m[1]*v + m[2]) / den).toBeCloseTo(0.5);
        expect((m[3]*u + m[4]*v + m[5]) / den).toBeCloseTo(0.5);
    });

    test('將單位正方形映射至 2× 縮放後的正方形', () => {
        const src = [
            { x: 0, y: 0 }, { x: 1, y: 0 },
            { x: 1, y: 1 }, { x: 0, y: 1 },
        ];
        const dst = [
            { x: 0, y: 0 }, { x: 2, y: 0 },
            { x: 2, y: 2 }, { x: 0, y: 2 },
        ];
        const m = getPerspectiveTransform(src, dst);
        expect(m).not.toBeNull();
        // src 的角落點應映射至 dst 的對應角落點
        const checkPoint = (sx, sy, ex, ey) => {
            const den = m[6]*sx + m[7]*sy + 1;
            expect((m[0]*sx + m[1]*sy + m[2]) / den).toBeCloseTo(ex);
            expect((m[3]*sx + m[4]*sy + m[5]) / den).toBeCloseTo(ey);
        };
        checkPoint(0, 0, 0, 0);
        checkPoint(1, 0, 2, 0);
        checkPoint(1, 1, 2, 2);
        checkPoint(0, 1, 0, 2);
    });

    test('共線點（退化情形）回傳 null', () => {
        // 四點共線
        const line = [
            { x: 0, y: 0 }, { x: 1, y: 1 },
            { x: 2, y: 2 }, { x: 3, y: 3 },
        ];
        expect(getPerspectiveTransform(line, line)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// bilinearInterpolate
// ---------------------------------------------------------------------------

describe('bilinearInterpolate', () => {
    test('整數座標（dx=0, dy=0）回傳精確像素值', () => {
        // 2×2 影像，四個角落各有不同顏色
        const data = new Uint8ClampedArray([
            255,   0,   0, 255, // (0,0) 紅
              0, 255,   0, 255, // (1,0) 綠
              0,   0, 255, 255, // (0,1) 藍
            255, 255,   0, 255, // (1,1) 黃
        ]);
        const result = bilinearInterpolate(data, 2, 2, 0, 0);
        expect(result[0]).toBeCloseTo(255); // R
        expect(result[1]).toBeCloseTo(0);   // G
        expect(result[2]).toBeCloseTo(0);   // B
        expect(result[3]).toBeCloseTo(255); // A
    });

    test('中心點（dx=0.5, dy=0.5）回傳四鄰像素的平均值', () => {
        // 四個像素 R 通道：100, 200, 150, 50 → 平均 = 125
        const data = new Uint8ClampedArray([
            100, 0, 0, 255,
            200, 0, 0, 255,
            150, 0, 0, 255,
             50, 0, 0, 255,
        ]);
        const result = bilinearInterpolate(data, 2, 2, 0.5, 0.5);
        expect(result[0]).toBeCloseTo(125);
    });

    test('水平插值（dy=0）', () => {
        // 左像素 R=0，右像素 R=200，在 x=0.25 處應得 50
        const data = new Uint8ClampedArray([
              0, 0, 0, 255,
            200, 0, 0, 255,
              0, 0, 0, 255,
            200, 0, 0, 255,
        ]);
        const result = bilinearInterpolate(data, 2, 2, 0.25, 0);
        expect(result[0]).toBeCloseTo(50);
    });

    test('Alpha 通道亦被正確插值', () => {
        const data = new Uint8ClampedArray([
            0, 0, 0,   0,
            0, 0, 0, 200,
            0, 0, 0, 100,
            0, 0, 0,  50,
        ]);
        const result = bilinearInterpolate(data, 2, 2, 0.5, 0.5);
        // (0 + 200 + 100 + 50) / 4 = 87.5
        expect(result[3]).toBeCloseTo(87.5);
    });
});

// ---------------------------------------------------------------------------
// applyPerspectiveTransform
// ---------------------------------------------------------------------------

describe('applyPerspectiveTransform', () => {
    test('恆等矩陣正確複製來源像素', () => {
        // 3×3 來源影像，中心像素為紅色
        const srcData = new Uint8ClampedArray(3 * 3 * 4).fill(0);
        // 設定 (1,1) 為紅色不透明
        srcData[(1 * 3 + 1) * 4]     = 200;
        srcData[(1 * 3 + 1) * 4 + 3] = 255;
        const src = new ImageData(srcData, 3, 3);

        // 恆等矩陣 [1,0,0, 0,1,0, 0,0]
        const identity = [1, 0, 0, 0, 1, 0, 0, 0];
        const result = applyPerspectiveTransform(src, identity, 1, 1);

        // 輸出 (0,0) 對應來源 (0,0)，來源 (0,0) 為黑色
        expect(result.width).toBe(1);
        expect(result.height).toBe(1);
    });

    test('輸出尺寸與 targetWidth/Height 相符（無條件捨去）', () => {
        const src = makeImageData(10, 10, [128, 128, 128, 255]);
        const matrix = [1, 0, 0, 0, 1, 0, 0, 0];
        const result = applyPerspectiveTransform(src, matrix, 5.9, 3.2);
        expect(result.width).toBe(5);
        expect(result.height).toBe(3);
    });

    test('超出來源範圍的像素保持透明黑色', () => {
        // 來源 2×2 全紅影像，用遠離原點的矩陣使所有輸出像素超出範圍
        const src = makeImageData(2, 2, [255, 0, 0, 255]);
        // 平移矩陣：sx = u + 1000（遠超來源範圍）
        const shiftMatrix = [1, 0, 1000, 0, 1, 1000, 0, 0];
        const result = applyPerspectiveTransform(src, shiftMatrix, 2, 2);
        // 所有像素應為初始值 0（黑色透明）
        expect(result.data[0]).toBe(0);
        expect(result.data[1]).toBe(0);
        expect(result.data[2]).toBe(0);
        expect(result.data[3]).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// applyGlareReduction
// ---------------------------------------------------------------------------

describe('applyGlareReduction', () => {
    test('低於亮度門檻（luma ≤ 180）的像素不被修改', () => {
        // luma = 0.299*100 + 0.587*100 + 0.114*100 = 100 < 180
        const img = makeImageData(1, 1, [100, 100, 100, 255]);
        applyGlareReduction(img, 1.0);
        expect(getPixel(img, 0, 0)).toEqual([100, 100, 100, 255]);
    });

    test('amount=0 時所有像素不變', () => {
        const img = makeImageData(1, 1, [255, 255, 255, 255]);
        const before = [...img.data];
        applyGlareReduction(img, 0);
        expect([...img.data]).toEqual(before);
    });

    test('純白像素在 amount=1.0 時亮度減半', () => {
        // luma=255, diff=1, reduction=1-(1*1*0.5)=0.5
        // 255 * 0.5 = 127.5 → Uint8ClampedArray 四捨六入五取偶（ToUint8Clamp）→ 128
        const img = makeImageData(1, 1, [255, 255, 255, 255]);
        applyGlareReduction(img, 1.0);
        const [r, g, b, a] = getPixel(img, 0, 0);
        expect(r).toBe(128);
        expect(g).toBe(128);
        expect(b).toBe(128);
        expect(a).toBe(255); // Alpha 通道不變
    });

    test('Alpha 通道永遠不被修改', () => {
        const img = makeImageData(1, 1, [255, 255, 255, 128]);
        applyGlareReduction(img, 1.0);
        expect(getPixel(img, 0, 0)[3]).toBe(128);
    });

    test('剛好超過門檻的像素（luma=181）只受到極小幅度的降低', () => {
        // luma ≈ 181：diff = 1/75 ≈ 0.013, reduction ≈ 1 - 0.013*0.5 ≈ 0.993
        // 使用近似色：R=181, G=0, B=0 → luma ≈ 54.1（太低），改用純亮度接近 181 的灰色
        // (181, 181, 181) → luma = 181
        const img = makeImageData(1, 1, [181, 181, 181, 255]);
        applyGlareReduction(img, 1.0);
        const [r] = getPixel(img, 0, 0);
        // reduction ≈ 0.993，181 * 0.993 ≈ 179.7 → 179
        expect(r).toBeGreaterThanOrEqual(178);
        expect(r).toBeLessThan(181); // 應略有降低
    });
});

// ---------------------------------------------------------------------------
// applySharpen
// ---------------------------------------------------------------------------

describe('applySharpen', () => {
    test('均勻純色影像銳化後不變', () => {
        // 所有像素相同 → Laplacian = 0 → 無銳化效果
        const img = makeImageData(3, 3, [128, 64, 32, 255]);
        const before = new Uint8ClampedArray(img.data);
        applySharpen(img, 1.0);
        expect(img.data).toEqual(before);
    });

    test('邊框像素（1px）保持不變', () => {
        const img = makeImageData(3, 3, [100, 100, 100, 255]);
        // 修改中心像素
        img.data[(1 * 3 + 1) * 4] = 200;
        applySharpen(img, 1.0);
        // 角落 (0,0) 應不受影響
        expect(getPixel(img, 0, 0)[0]).toBe(100);
        expect(getPixel(img, 2, 0)[0]).toBe(100);
        expect(getPixel(img, 0, 2)[0]).toBe(100);
        expect(getPixel(img, 2, 2)[0]).toBe(100);
    });

    test('amount=0 時所有像素不變', () => {
        const img = makeImageData(3, 3, [100, 50, 25, 255]);
        img.data[(1 * 3 + 1) * 4] = 200; // 中心像素不同
        const before = new Uint8ClampedArray(img.data);
        applySharpen(img, 0);
        expect(img.data).toEqual(before);
    });

    test('中心像素依已知公式銳化並限制於 [0, 255]', () => {
        // 3×3：背景=100，中心=120，amount=0.5
        // center=120, neighbors=4*100=400
        // laplacian=120*5-400=200
        // output = 120 + (200 - 120) * 0.5 = 120 + 40 = 160
        const img = makeImageData(3, 3, [100, 0, 0, 255]);
        img.data[(1 * 3 + 1) * 4] = 120; // 中心 R=120
        applySharpen(img, 0.5);
        expect(getPixel(img, 1, 1)[0]).toBe(160);
    });

    test('超出範圍的值被截斷至 255 或 0', () => {
        // 中心=200，背景=0 → laplacian=1000，amount=1.0 → 1000 → 截斷至 255
        const img = makeImageData(3, 3, [0, 0, 0, 255]);
        img.data[(1 * 3 + 1) * 4]     = 200;
        img.data[(1 * 3 + 1) * 4 + 3] = 255;
        applySharpen(img, 1.0);
        expect(getPixel(img, 1, 1)[0]).toBe(255);
    });

    test('Alpha 通道不被修改', () => {
        const img = makeImageData(3, 3, [100, 100, 100, 128]);
        applySharpen(img, 1.0);
        // 所有像素的 Alpha 應保持 128
        for (let i = 3; i < img.data.length; i += 4) {
            expect(img.data[i]).toBe(128);
        }
    });
});

// ---------------------------------------------------------------------------
// applyContrast
// ---------------------------------------------------------------------------

describe('applyContrast', () => {
    test('contrast=1.0 時不改變任何像素', () => {
        const img = makeImageData(2, 2, [100, 150, 200, 255]);
        const before = new Uint8ClampedArray(img.data);
        applyContrast(img, 1.0);
        expect(img.data).toEqual(before);
    });

    test('中點像素（128, 128, 128）在任何對比度下保持不變', () => {
        const img = makeImageData(1, 1, [128, 128, 128, 255]);
        applyContrast(img, 3.0);
        const [r, g, b] = getPixel(img, 0, 0);
        expect(r).toBe(128);
        expect(g).toBe(128);
        expect(b).toBe(128);
    });

    test('contrast=2.0 使距中點距離加倍', () => {
        // R=200 → (200-128)*2+128 = 272 → 截斷為 255
        // G=128 → (128-128)*2+128 = 128
        // B=50  → (50-128)*2+128  = -28 → 截斷為 0
        const img = makeImageData(1, 1, [200, 128, 50, 255]);
        applyContrast(img, 2.0);
        const [r, g, b, a] = getPixel(img, 0, 0);
        expect(r).toBe(255);
        expect(g).toBe(128);
        expect(b).toBe(0);
        expect(a).toBe(255); // Alpha 不變
    });

    test('contrast=0.5 縮小距中點的距離', () => {
        // R=200 → (200-128)*0.5+128 = 164
        const img = makeImageData(1, 1, [200, 128, 100, 255]);
        applyContrast(img, 0.5);
        const [r, g, b] = getPixel(img, 0, 0);
        expect(r).toBe(164);
        expect(g).toBe(128);
        // B=100 → (100-128)*0.5+128 = 114
        expect(b).toBe(114);
    });

    test('輸出值被截斷至 [0, 255]', () => {
        const img = makeImageData(1, 1, [255, 0, 128, 255]);
        applyContrast(img, 10.0);
        const [r, g] = getPixel(img, 0, 0);
        expect(r).toBe(255);
        expect(g).toBe(0);
    });

    test('Alpha 通道永遠不被修改', () => {
        const img = makeImageData(2, 2, [200, 100, 50, 200]);
        applyContrast(img, 2.0);
        for (let i = 3; i < img.data.length; i += 4) {
            expect(img.data[i]).toBe(200);
        }
    });
});

// ---------------------------------------------------------------------------
// processEnhancements
// ---------------------------------------------------------------------------

describe('processEnhancements', () => {
    test('所有參數為中性值時輸出與輸入相同', () => {
        const img = makeImageData(3, 3, [100, 150, 200, 255]);
        const result = processEnhancements(img, { sharpness: 0, contrast: 1.0, glare: 0 });
        expect(result.data).toEqual(img.data);
    });

    test('回傳新的 ImageData，不修改原始輸入', () => {
        const img = makeImageData(3, 3, [255, 255, 255, 255]);
        const originalData = new Uint8ClampedArray(img.data);
        processEnhancements(img, { sharpness: 0.5, contrast: 1.5, glare: 0.5 });
        expect(img.data).toEqual(originalData);
    });

    test('glare > 0 時套用反光抑制（純白像素變暗）', () => {
        const img = makeImageData(1, 1, [255, 255, 255, 255]);
        const result = processEnhancements(img, { sharpness: 0, contrast: 1.0, glare: 1.0 });
        expect(result.data[0]).toBeLessThan(255);
    });

    test('contrast !== 1.0 時套用對比度調整', () => {
        const img = makeImageData(1, 1, [200, 128, 50, 255]);
        const result = processEnhancements(img, { sharpness: 0, contrast: 2.0, glare: 0 });
        expect(result.data[0]).toBe(255); // 截斷
        expect(result.data[2]).toBe(0);   // 截斷
    });

    test('濾鏡依照「反光 → 銳化 → 對比度」的順序套用', () => {
        // 驗證方式：只開啟對比度，與直接呼叫 applyContrast 的結果一致
        const source = makeImageData(3, 3, [200, 100, 50, 255]);
        const expected = makeImageData(3, 3, [200, 100, 50, 255]);
        applyContrast(expected, 1.5);

        const result = processEnhancements(source, { sharpness: 0, contrast: 1.5, glare: 0 });
        expect(result.data).toEqual(expected.data);
    });
});
