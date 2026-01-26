// Bookmark physical dimensions
export const BOOKMARK_WIDTH_MM = 50;
export const BOOKMARK_HEIGHT_MM = 160;
export const ASPECT_RATIO = BOOKMARK_WIDTH_MM / BOOKMARK_HEIGHT_MM;

// Processing resolution (pixels). Higher = finer detail but larger STLs.
// 50mm * 8 px/mm = 400px width.
export const RES_PPM = 8; // Pixels per MM
export const CANVAS_WIDTH = BOOKMARK_WIDTH_MM * RES_PPM; 
export const CANVAS_HEIGHT = BOOKMARK_HEIGHT_MM * RES_PPM;

export const DEFAULT_PALETTE = [
  { r: 255, g: 255, b: 255 }, // White
  { r: 0, g: 0, b: 0 },       // Black
  { r: 255, g: 0, b: 0 },     // Red
  { r: 0, g: 0, b: 255 },     // Blue
];

export const MODEL_NAMES = {
    IMAGE_GEN: 'gemini-2.5-flash-image'
}