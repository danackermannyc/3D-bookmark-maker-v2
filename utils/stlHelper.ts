import JSZip from 'jszip';
import { BookmarkSettings, RGB } from '../types';
import { CANVAS_WIDTH, CANVAS_HEIGHT, BOOKMARK_WIDTH_MM, BOOKMARK_HEIGHT_MM } from '../constants';

// --- Types ---

interface MeshData {
  vertices: number[]; // Flat array [x,y,z, x,y,z...]
  triangles: number[]; // Flat array of indices [v1,v2,v3...]
}

class MeshBuilder {
  private vertices: number[] = [];
  private triangles: number[] = [];
  private vertexMap = new Map<string, number>();

  addVertex(x: number, y: number, z: number): number {
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    const existing = this.vertexMap.get(key);
    if (existing !== undefined) return existing;

    const index = this.vertices.length / 3;
    this.vertices.push(x, y, z);
    this.vertexMap.set(key, index);
    return index;
  }

  addBox(x: number, y: number, z: number, w: number, h: number, d: number) {
    const v0 = this.addVertex(x, y, z);
    const v1 = this.addVertex(x + w, y, z);
    const v2 = this.addVertex(x + w, y + h, z);
    const v3 = this.addVertex(x, y + h, z);
    const v4 = this.addVertex(x, y, z + d);
    const v5 = this.addVertex(x + w, y, z + d);
    const v6 = this.addVertex(x + w, y + h, z + d);
    const v7 = this.addVertex(x, y + h, z + d);

    // Bottom
    this.triangles.push(v0, v2, v1, v0, v3, v2);
    // Top
    this.triangles.push(v4, v5, v6, v4, v6, v7);
    // Front
    this.triangles.push(v0, v1, v5, v0, v5, v4);
    // Back
    this.triangles.push(v2, v3, v7, v2, v7, v6);
    // Left
    this.triangles.push(v0, v4, v7, v0, v7, v3);
    // Right
    this.triangles.push(v1, v2, v6, v1, v6, v5);
  }

  getData(): MeshData {
    return { vertices: this.vertices, triangles: this.triangles };
  }
}

// --- Helpers ---

const rgbToHex = (c: RGB) => {
  const f = (x: number) => Math.round(x).toString(16).padStart(2, '0').toUpperCase();
  return `#${f(c.r)}${f(c.g)}${f(c.b)}`;
};

const base64ToUint8Array = (base64: string) => {
  const binaryString = atob(base64.split(',')[1]);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

// --- STL Generation ---

const writeFloat = (view: DataView, offset: number, value: number) => {
  view.setFloat32(offset, value, true);
};

const writeBinarySTL = (mesh: MeshData): ArrayBuffer => {
  const triangleCount = mesh.triangles.length / 3;
  const headerSize = 80;
  const countSize = 4;
  const triangleSize = 50;
  
  const bufferLength = headerSize + countSize + (triangleCount * triangleSize);
  const buffer = new ArrayBuffer(bufferLength);
  const view = new DataView(buffer);

  view.setUint32(headerSize, triangleCount, true);

  let offset = headerSize + countSize;
  
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const v1Idx = mesh.triangles[i] * 3;
    const v2Idx = mesh.triangles[i+1] * 3;
    const v3Idx = mesh.triangles[i+2] * 3;

    writeFloat(view, offset, 0); writeFloat(view, offset + 4, 0); writeFloat(view, offset + 8, 0);
    writeFloat(view, offset + 12, mesh.vertices[v1Idx]); writeFloat(view, offset + 16, mesh.vertices[v1Idx+1]); writeFloat(view, offset + 20, mesh.vertices[v1Idx+2]);
    writeFloat(view, offset + 24, mesh.vertices[v2Idx]); writeFloat(view, offset + 28, mesh.vertices[v2Idx+1]); writeFloat(view, offset + 32, mesh.vertices[v2Idx+2]);
    writeFloat(view, offset + 36, mesh.vertices[v3Idx]); writeFloat(view, offset + 40, mesh.vertices[v3Idx+1]); writeFloat(view, offset + 44, mesh.vertices[v3Idx+2]);
    view.setUint16(offset + 48, 0, true);
    offset += triangleSize;
  }
  return buffer;
}

export const generateSTLs = async (
  indices: Uint8Array,
  settings: BookmarkSettings
): Promise<{ [key: string]: ArrayBuffer }> => {
  const scaleX = BOOKMARK_WIDTH_MM / CANVAS_WIDTH;
  const scaleY = BOOKMARK_HEIGHT_MM / CANVAS_HEIGHT;
  const result: { [key: string]: ArrayBuffer } = {};

  for (let c = 0; c < 4; c++) {
    const builder = new MeshBuilder();
    const zStart = settings.baseHeight;
    const height = settings.layerHeights[c];
    if (c === 0) builder.addBox(0, 0, 0, BOOKMARK_WIDTH_MM, BOOKMARK_HEIGHT_MM, settings.baseHeight);

    for (let y = 0; y < CANVAS_HEIGHT; y++) {
      let startX = -1;
      for (let x = 0; x < CANVAS_WIDTH; x++) {
        if (indices[y * CANVAS_WIDTH + x] === c) {
            if (startX === -1) startX = x;
        } else if (startX !== -1) {
            builder.addBox(startX * scaleX, (CANVAS_HEIGHT - 1 - y) * scaleY, zStart, (x - startX) * scaleX, 1 * scaleY, height);
            startX = -1;
        }
      }
      if (startX !== -1) builder.addBox(startX * scaleX, (CANVAS_HEIGHT - 1 - y) * scaleY, zStart, (CANVAS_WIDTH - startX) * scaleX, 1 * scaleY, height);
    }
    const data = builder.getData();
    if (data.triangles.length > 0) result[c === 0 ? "Color_1_Base.stl" : `Color_${c + 1}.stl`] = writeBinarySTL(data);
  }
  return result;
};

// --- 3MF Helper Functions ---

const get3DModelXML = (
  meshes: { id: number, name: string, data: MeshData, paletteIdx: number }[],
  palette: RGB[]
): string => {
  const objectIds = meshes.map(m => m.id);
  const containerId = 100; // Unique assembly ID
  const materialId = 200;  // Unique materials ID

  let materialsXML = `<basematerials id="${materialId}">`;
  palette.forEach((color, i) => {
    materialsXML += `<base name="Color ${i + 1}" displaycolor="${rgbToHex(color)}FF" />`;
  });
  materialsXML += `</basematerials>`;

  let objectsXML = '';
  for (const mesh of meshes) {
    let verticesXML = '';
    for (let i = 0; i < mesh.data.vertices.length; i += 3) {
      verticesXML += `<vertex x="${mesh.data.vertices[i].toFixed(4)}" y="${mesh.data.vertices[i+1].toFixed(4)}" z="${mesh.data.vertices[i+2].toFixed(4)}" />`;
    }
    let trianglesXML = '';
    for (let i = 0; i < mesh.data.triangles.length; i += 3) {
      // Assign specific material index to each triangle
      trianglesXML += `<triangle v1="${mesh.data.triangles[i]}" v2="${mesh.data.triangles[i+1]}" v3="${mesh.data.triangles[i+2]}" p1="${mesh.paletteIdx}" />`;
    }

    objectsXML += `
    <object id="${mesh.id}" pid="${materialId}" name="${mesh.name}" type="model">
      <mesh>
        <vertices>${verticesXML}</vertices>
        <triangles>${trianglesXML}</triangles>
      </mesh>
    </object>`;
  }

  const componentsXML = objectIds.map(id => `<component objectid="${id}" />`).join('');
  objectsXML += `
    <object id="${containerId}" type="model">
      <components>${componentsXML}</components>
    </object>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Application">BambuBookmarkCreator</metadata>
  <metadata name="Thumbnail">/Metadata/thumbnail.png</metadata>
  <resources>
    ${materialsXML}
    ${objectsXML}
  </resources>
  <build>
    <item objectid="${containerId}" />
  </build>
</model>`;
};

const getRelsXML = () => `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

const getContentTypesXML = () => `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
  <Default Extension="png" ContentType="image/png" />
</Types>`;

// --- Main Generation Function ---

export const generate3MF = async (
  indices: Uint8Array,
  settings: BookmarkSettings,
  palette: RGB[],
  thumbnailSrc: string
): Promise<Blob> => {
  const scaleX = BOOKMARK_WIDTH_MM / CANVAS_WIDTH;
  const scaleY = BOOKMARK_HEIGHT_MM / CANVAS_HEIGHT;
  const meshObjects: { id: number, name: string, data: MeshData, paletteIdx: number }[] = [];

  for (let c = 0; c < 4; c++) {
    const builder = new MeshBuilder();
    const zStart = settings.baseHeight;
    const height = settings.layerHeights[c];
    if (c === 0) builder.addBox(0, 0, 0, BOOKMARK_WIDTH_MM, BOOKMARK_HEIGHT_MM, settings.baseHeight);

    for (let y = 0; y < CANVAS_HEIGHT; y++) {
      let startX = -1;
      for (let x = 0; x < CANVAS_WIDTH; x++) {
        if (indices[y * CANVAS_WIDTH + x] === c) {
            if (startX === -1) startX = x;
        } else if (startX !== -1) {
            builder.addBox(startX * scaleX, (CANVAS_HEIGHT - 1 - y) * scaleY, zStart, (x - startX) * scaleX, 1 * scaleY, height);
            startX = -1;
        }
      }
      if (startX !== -1) builder.addBox(startX * scaleX, (CANVAS_HEIGHT - 1 - y) * scaleY, zStart, (CANVAS_WIDTH - startX) * scaleX, 1 * scaleY, height);
    }
    const data = builder.getData();
    if (data.vertices.length > 0) {
        const hex = rgbToHex(palette[c]).substring(1);
        const name = c === 0 ? `Layer_1_Base_${hex}` : `Layer_${c + 1}_${hex}`;
        meshObjects.push({ id: c + 1, name, data, paletteIdx: c });
    }
  }

  const zip = new JSZip();
  zip.file('[Content_Types].xml', getContentTypesXML());
  zip.folder('_rels')?.file('.rels', getRelsXML());
  zip.folder('3D')?.file('3dmodel.model', get3DModelXML(meshObjects, palette));
  zip.folder('Metadata')?.file('thumbnail.png', base64ToUint8Array(thumbnailSrc));

  return await zip.generateAsync({ type: 'blob' });
};