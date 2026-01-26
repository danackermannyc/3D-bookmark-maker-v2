import { RGB } from '../types';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../constants';

// --- Image Processing ---

export const getCroppedImg = async (
  imageSrc: string,
  pixelCrop: { x: number; y: number; width: number; height: number }
): Promise<string> => {
  const image = new Image();
  image.src = imageSrc;
  await new Promise((resolve) => { image.onload = resolve; });

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext('2d');

  if (!ctx) throw new Error('No 2d context');

  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    CANVAS_WIDTH,
    CANVAS_HEIGHT
  );

  return canvas.toDataURL('image/png');
};

const getDistanceSq = (c1: RGB, c2: RGB) => {
  return (c1.r - c2.r) ** 2 + (c1.g - c2.g) ** 2 + (c1.b - c2.b) ** 2;
};

const getSaturation = (r: number, g: number, b: number) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (max === 0) return 0;
  return d / max;
};

const getExtremesBonus = (r: number, g: number, b: number) => {
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum < 0.15 || lum > 0.85) return 0.5;
  return 0;
};

/**
 * Applies a majority filter to clean up "pointillism" noise.
 * Iterates through the indices and replaces each pixel with the most common neighbor.
 */
export const smoothIndices = (
  indices: Uint8Array,
  width: number,
  height: number,
  passes: number = 1
): Uint8Array => {
  if (passes <= 0) return indices;
  
  let current = new Uint8Array(indices);
  const k = 4; // Assuming 4 colors

  for (let p = 0; p < passes; p++) {
    const next = new Uint8Array(current.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const counts = new Uint8Array(k);
        // Look at 3x3 neighborhood
        for (let ny = -1; ny <= 1; ny++) {
          for (let nx = -1; nx <= 1; nx++) {
            const curY = Math.max(0, Math.min(height - 1, y + ny));
            const curX = Math.max(0, Math.min(width - 1, x + nx));
            counts[current[curY * width + curX]]++;
          }
        }
        // Find majority
        let maxCount = -1;
        let majority = 0;
        for (let i = 0; i < k; i++) {
          if (counts[i] > maxCount) {
            maxCount = counts[i];
            majority = i;
          }
        }
        next[y * width + x] = majority;
      }
    }
    current = next;
  }
  return current;
};

export const quantizeImage = (
  ctx: CanvasRenderingContext2D,
  k: number = 4
): { palette: RGB[]; indices: Uint8Array } => {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const pixelCount = width * height;

  let centroids: RGB[] = [];
  const firstIdx = Math.floor(Math.random() * pixelCount);
  centroids.push({
    r: data[firstIdx * 4],
    g: data[firstIdx * 4 + 1],
    b: data[firstIdx * 4 + 2],
  });

  for (let c = 1; c < k; c++) {
    const dists = new Float32Array(pixelCount);
    let sumDistSq = 0;
    for (let i = 0; i < pixelCount; i++) {
      const p = { r: data[i * 4], g: data[i * 4 + 1], b: data[i * 4 + 2] };
      let minDistSq = Infinity;
      for (const centroid of centroids) {
        const d = getDistanceSq(p, centroid);
        if (d < minDistSq) minDistSq = d;
      }
      dists[i] = minDistSq;
      sumDistSq += minDistSq;
    }
    let target = Math.random() * sumDistSq;
    let nextCentroidIdx = -1;
    for (let i = 0; i < pixelCount; i++) {
      target -= dists[i];
      if (target <= 0) {
        nextCentroidIdx = i;
        break;
      }
    }
    if (nextCentroidIdx === -1) nextCentroidIdx = pixelCount - 1;
    centroids.push({ r: data[nextCentroidIdx * 4], g: data[nextCentroidIdx * 4 + 1], b: data[nextCentroidIdx * 4 + 2] });
  }

  let assignments = new Uint8Array(pixelCount);
  const iterations = 15;
  for (let iter = 0; iter < iterations; iter++) {
    const sums = Array(k).fill(0).map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
    for (let i = 0; i < pixelCount; i++) {
      const p = { r: data[i * 4], g: data[i * 4 + 1], b: data[i * 4 + 2] };
      let minDist = Infinity;
      let bestCluster = 0;
      for (let j = 0; j < k; j++) {
        const dist = getDistanceSq(p, centroids[j]);
        if (dist < minDist) { minDist = dist; bestCluster = j; }
      }
      assignments[i] = bestCluster;
      sums[bestCluster].r += p.r; sums[bestCluster].g += p.g; sums[bestCluster].b += p.b; sums[bestCluster].count++;
    }
    let changed = false;
    for (let j = 0; j < k; j++) {
      if (sums[j].count > 0) {
        const newR = Math.round(sums[j].r / sums[j].count);
        const newG = Math.round(sums[j].g / sums[j].count);
        const newB = Math.round(sums[j].b / sums[j].count);
        if (newR !== centroids[j].r || newG !== centroids[j].g || newB !== centroids[j].b) {
            centroids[j] = { r: newR, g: newG, b: newB };
            changed = true;
        }
      }
    }
    if (!changed) break;
  }

  const medoids: RGB[] = centroids.map(c => ({...c})); 
  const minMedoidScores = new Array(k).fill(Infinity);
  const WEIGHT = 3000;
  for (let i = 0; i < pixelCount; i++) {
    const clusterIdx = assignments[i];
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const distSq = getDistanceSq({r,g,b}, centroids[clusterIdx]);
    const saturation = getSaturation(r, g, b);
    const extremeBonus = getExtremesBonus(r, g, b); 
    const score = distSq - (saturation * WEIGHT) - (extremeBonus * WEIGHT);
    if (score < minMedoidScores[clusterIdx]) {
      minMedoidScores[clusterIdx] = score;
      medoids[clusterIdx] = { r, g, b };
    }
  }
  
  const clusterCounts = new Array(k).fill(0).map((_, i) => ({ index: i, count: 0 }));
  for(let i=0; i<pixelCount; i++) clusterCounts[assignments[i]].count++;
  clusterCounts.sort((a, b) => b.count - a.count);

  const oldToNew = new Array(k).fill(0);
  const sortedPalette = new Array(k);
  clusterCounts.forEach((item, newIndex) => {
    oldToNew[item.index] = newIndex;
    sortedPalette[newIndex] = medoids[item.index];
  });

  const finalIndices = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) finalIndices[i] = oldToNew[assignments[i]];

  return { palette: sortedPalette, indices: finalIndices };
};

export const drawQuantizedPreview = (
  canvas: HTMLCanvasElement,
  indices: Uint8Array,
  palette: RGB[]
) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = canvas.width, height = canvas.height;
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;
  for (let i = 0; i < indices.length; i++) {
    const color = palette[indices[i]];
    data[i * 4] = color.r; data[i * 4 + 1] = color.g; data[i * 4 + 2] = color.b; data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
};

export const resizeImageToCanvas = (img: HTMLImageElement | HTMLCanvasElement): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const ctx = canvas.getContext('2d');
    if(ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
    return canvas;
}