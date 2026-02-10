import React, { useState, useRef, useEffect, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import JSZip from 'jszip';
import { Upload, Download, Settings, Layers, Image as ImageIcon, Loader2, Crop as CropIcon, Check, RefreshCw, Printer, Coffee, Youtube, Github, Flag, Mail, PlayCircle } from 'lucide-react';
import { quantizeImage, resizeImageToCanvas, drawQuantizedPreview, getCroppedImg, smoothIndices } from './utils/imageHelper';
import { generate3MF, generateSTLs } from './utils/stlHelper';
import { BookmarkSettings, ProcessingState, RGB } from './types';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './constants';

export default function App() {
  // State
  const [rawImgSrc, setRawImgSrc] = useState<string | null>(null);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [quantizedData, setQuantizedData] = useState<{ palette: RGB[], indices: Uint8Array, rawIndices: Uint8Array } | null>(null);

  // Cropper State
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);

  // Gallery State
  const [randomGalleryImage, setRandomGalleryImage] = useState<string | null>(null);

  const [settings, setSettings] = useState<BookmarkSettings>({
    baseHeight: 0.8,
    layerHeights: [0.6, 0.8, 1.0, 1.2],
    isTactile: false, // Default to Flat
    widthMm: 50,
    heightMm: 160,
    smoothing: 2
  });

  const [processing, setProcessing] = useState<ProcessingState>({ status: 'idle' });

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize Random Image
  useEffect(() => {
    // Select a random number between 1 and 6
    const idx = Math.floor(Math.random() * 6) + 1;
    setRandomGalleryImage(`https://raw.githubusercontent.com/danackermannyc/3D-bookmark-maker-v2/main/public/gallery/bmark-${idx}.jpg`);
  }, []);

  // --- Handlers ---

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setRawImgSrc(event.target.result as string);
          setImgSrc(null);
          setQuantizedData(null);
        }
      };
      reader.readAsDataURL(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onCropComplete = useCallback((croppedArea: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleCropConfirm = async () => {
    if (rawImgSrc && croppedAreaPixels) {
      setProcessing({ status: 'processing', message: 'Cropping...' });
      try {
        const croppedImage = await getCroppedImg(rawImgSrc, croppedAreaPixels);
        setImgSrc(croppedImage);
        setRawImgSrc(null);
        setProcessing({ status: 'idle' });
      } catch (e) {
        console.error(e);
        setProcessing({ status: 'error', message: 'Crop failed' });
      }
    }
  };

  const handleReset = () => {
    setRawImgSrc(null);
    setImgSrc(null);
    setQuantizedData(null);
    setProcessing({ status: 'idle' });
  };

  // Process image when final source changes
  useEffect(() => {
    if (!imgSrc) return;
    const img = new Image();
    img.onload = () => {
        const canvas = resizeImageToCanvas(img);
        const ctx = canvas.getContext('2d');
        if(!ctx) return;
        const result = quantizeImage(ctx, 4);
        // Store raw indices so we can re-apply smoothing without re-quantizing
        setQuantizedData({ ...result, rawIndices: result.indices });
    };
    img.src = imgSrc;
  }, [imgSrc]);

  // Apply/Re-apply smoothing when settings or data change
  useEffect(() => {
    if (quantizedData?.rawIndices) {
        const smoothed = smoothIndices(quantizedData.rawIndices, CANVAS_WIDTH, CANVAS_HEIGHT, settings.smoothing);
        setQuantizedData(prev => prev ? ({ ...prev, indices: smoothed }) : null);
    }
  }, [settings.smoothing]);

  // Redraw preview
  useEffect(() => {
    if (quantizedData && canvasRef.current) {
        drawQuantizedPreview(canvasRef.current, quantizedData.indices, quantizedData.palette);
    }
  }, [quantizedData]);


  const handleDownload3MF = async () => {
    if (!quantizedData || !imgSrc) return;
    setProcessing({ status: 'generating_stl', message: 'Generating 3MF...' });
    setTimeout(async () => {
        try {
            const effectiveSettings = { ...settings };
            if (!settings.isTactile) effectiveSettings.layerHeights = [0.2, 0.2, 0.2, 0.2];
            const thumbnailData = canvasRef.current?.toDataURL('image/png') || imgSrc;
            const blob = await generate3MF(quantizedData.indices, effectiveSettings, quantizedData.palette, thumbnailData);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'bambu_bookmark_project.3mf'; a.click();
            URL.revokeObjectURL(url);
            setProcessing({ status: 'done', message: 'Download ready!' });
            setTimeout(() => setProcessing({ status: 'idle' }), 3000);
        } catch (e) {
            console.error(e);
            setProcessing({ status: 'error', message: 'Generation failed.' });
        }
    }, 100);
  };

  const handleDownloadSTL = async () => {
    if (!quantizedData) return;
    setProcessing({ status: 'generating_stl', message: 'Generating STLs...' });
    setTimeout(async () => {
        try {
            const effectiveSettings = { ...settings };
            if (!settings.isTactile) effectiveSettings.layerHeights = [0.2, 0.2, 0.2, 0.2];
            const stlBuffers = await generateSTLs(quantizedData.indices, effectiveSettings);
            setProcessing({ status: 'zipping', message: 'Zipping STLs...' });
            const zip = new JSZip();
            Object.keys(stlBuffers).forEach(filename => { zip.file(filename, stlBuffers[filename]); });
            const blob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'bookmark_stls.zip'; a.click();
            URL.revokeObjectURL(url);
            setProcessing({ status: 'done', message: 'Download ready!' });
            setTimeout(() => setProcessing({ status: 'idle' }), 3000);
        } catch (e) {
            console.error(e);
            setProcessing({ status: 'error', message: 'Generation failed.' });
        }
    }, 100);
  };

  const updateLayerHeight = (idx: number, val: number) => {
    const newHeights = [...settings.layerHeights] as [number, number, number, number];
    newHeights[idx] = val;
    setSettings(prev => ({ ...prev, layerHeights: newHeights }));
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center py-8 px-4 font-sans text-slate-800">
      
      {/* Header */}
      <header className="max-w-4xl w-full flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
            <div className="bg-emerald-600 p-2 rounded-lg text-white shadow-md">
                <Layers size={28} />
            </div>
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">3D Bookmark Creator</h1>
                <p className="text-slate-500 text-sm">Convert images to bold 4-color printable files</p>
            </div>
        </div>
        
        {imgSrc && (
            <button 
                onClick={handleReset}
                className="flex items-center gap-2 bg-white border border-slate-200 shadow-sm px-4 py-2 rounded-md hover:bg-slate-50 transition-colors text-sm font-medium text-slate-600"
            >
                <RefreshCw size={16} /> New Project
            </button>
        )}
        <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" className="hidden" />
      </header>

      {/* Cropper Modal Overlay */}
      {rawImgSrc && (
          <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-4 backdrop-blur-sm">
              <div className="relative w-full max-w-2xl h-[60vh] bg-slate-900 rounded-xl overflow-hidden shadow-2xl">
                  <Cropper
                    image={rawImgSrc}
                    crop={crop}
                    zoom={zoom}
                    aspect={5 / 16}
                    onCropChange={setCrop}
                    onCropComplete={onCropComplete}
                    onZoomChange={setZoom}
                  />
              </div>
              <div className="mt-6 flex gap-4 bg-white p-6 rounded-2xl shadow-2xl items-end">
                  <div className="flex flex-col gap-2">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Crop Zoom</label>
                      <input
                        type="range"
                        value={zoom}
                        min={1} max={3} step={0.1}
                        onChange={(e) => setZoom(Number(e.target.value))}
                        className="w-48 accent-emerald-600"
                      />
                  </div>
                  <button 
                    onClick={handleCropConfirm}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 shadow-lg transition-all active:scale-95"
                  >
                      <Check size={20} /> Use This Area
                  </button>
              </div>
          </div>
      )}

      <main className="max-w-6xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Editor & Preview */}
        <div className="lg:col-span-7 flex flex-col gap-6">
            
            {/* Start Section: Upload Only */}
            {!imgSrc && !rawImgSrc && (
                <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="bg-white p-8 rounded-2xl shadow-sm border-2 border-dashed border-slate-200 text-center flex flex-col items-center justify-center gap-4 min-h-[320px] hover:border-emerald-500 hover:bg-emerald-50/50 transition-all cursor-pointer group relative overflow-hidden"
                >
                    <div className="bg-slate-100 group-hover:bg-emerald-100 p-5 rounded-full transition-colors z-10">
                        <Upload className="text-slate-400 group-hover:text-emerald-600" size={32} />
                    </div>
                    <div className="z-10">
                        <h2 className="text-lg font-bold text-slate-700 group-hover:text-emerald-700">Upload Image</h2>
                        <p className="text-slate-500 text-xs mt-2 leading-relaxed px-4">
                            Use your own photos or graphics. High contrast works best.
                        </p>
                    </div>
                </div>
            )}

            {/* Canvas Preview */}
            {imgSrc && (
                <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-center">
                    <div className="flex justify-between w-full mb-6 items-center">
                         <h3 className="font-bold text-xl flex items-center gap-2 text-slate-800"><ImageIcon size={22} className="text-emerald-500" /> Preview</h3>
                         <div className="flex gap-4">
                            <button onClick={() => { setRawImgSrc(imgSrc); setImgSrc(null); }} className="text-xs font-bold text-emerald-600 hover:bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-100 flex items-center gap-1 transition-all">
                                <CropIcon size={14} /> Adjust Crop
                            </button>
                            <span className="text-xs font-mono font-bold bg-slate-100 px-2 py-1.5 rounded-lg text-slate-500 tracking-tight">50mm x 160mm</span>
                         </div>
                    </div>
                   
                    <div className="relative shadow-2xl bg-slate-900 p-2 rounded-2xl overflow-hidden border-4 border-slate-800">
                         <canvas 
                            ref={canvasRef} 
                            width={CANVAS_WIDTH} 
                            height={CANVAS_HEIGHT} 
                            className="w-[180px] h-[576px] object-contain block"
                            style={{ imageRendering: 'pixelated' }}
                         />
                    </div>
                    
                    {quantizedData && (
                        <div className="flex gap-6 mt-8 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                            {quantizedData.palette.map((c, i) => (
                                <div key={i} className="flex flex-col items-center gap-2">
                                    <div 
                                        className="w-12 h-12 rounded-2xl border-2 border-white shadow-lg relative transform hover:scale-110 transition-transform cursor-pointer"
                                        style={{ backgroundColor: `rgb(${c.r},${c.g},${c.b})` }}
                                    >
                                        {i === 0 && (
                                            <div className="absolute -top-3 -right-3 bg-slate-900 text-white text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider shadow-md">Base</div>
                                        )}
                                    </div>
                                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Slot {i+1}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Detailed Printing Instructions */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <h3 className="font-bold text-lg mb-6 flex items-center gap-2 text-slate-800">
                    <Printer className="text-emerald-600" size={24} />
                    How to print with Bambu AMS
                </h3>
                <ul className="space-y-5">
                    <li className="flex gap-4 text-sm text-slate-600">
                        <span className="bg-slate-100 text-slate-600 font-bold w-7 h-7 flex items-center justify-center rounded-full shrink-0 text-xs mt-0.5 border border-slate-200">1</span>
                        <span>
                            <strong className="text-slate-900 block mb-1">Download your design</strong>
                            Export either the 3MF file (recommended) or the Stacked STLs (for manual control) directly from the app.
                        </span>
                    </li>
                    <li className="flex gap-4 text-sm text-slate-600">
                        <span className="bg-slate-100 text-slate-600 font-bold w-7 h-7 flex items-center justify-center rounded-full shrink-0 text-xs mt-0.5 border border-slate-200">2</span>
                        <span>
                             <strong className="text-slate-900 block mb-1">Import into Bambu Studio</strong>
                             Drag your file(s) onto the build plate. If the slicer asks to "Load as a single object with multiple parts," always select <strong className="text-emerald-700">YES</strong> to ensure the layers stay perfectly aligned.
                        </span>
                    </li>
                    <li className="flex gap-4 text-sm text-slate-600">
                        <span className="bg-slate-100 text-slate-600 font-bold w-7 h-7 flex items-center justify-center rounded-full shrink-0 text-xs mt-0.5 border border-slate-200">3</span>
                        <span>
                             <strong className="text-slate-900 block mb-1">Locate the Parts</strong>
                             Switch to the <em>Objects</em> tab in the left-hand sidebar to see each color layer and the base plate listed as distinct components. <strong className="text-emerald-600 font-bold">Note: Your object will likely appear monochrome until you assign AMS colors to the four individual objects!</strong>
                        </span>
                    </li>
                     <li className="flex gap-4 text-sm text-slate-600">
                        <span className="bg-slate-100 text-slate-600 font-bold w-7 h-7 flex items-center justify-center rounded-full shrink-0 text-xs mt-0.5 border border-slate-200">4</span>
                        <span>
                             <strong className="text-slate-900 block mb-1">Assign AMS Colors</strong>
                             Select a layer from the list and press the number on your keyboard (1, 2, 3, or 4) that matches the filament slot in your AMS.
                        </span>
                    </li>
                </ul>
            </div>
            
             {/* Contact */}
             <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <div className="flex items-center gap-2 mb-4">
                    <Mail className="text-sky-500" size={20} />
                    <h2 className="font-bold text-lg text-slate-800">Contact</h2>
                </div>
                <p className="text-slate-500 text-sm leading-relaxed">
                   Have a question or feedback?<br/>
                   <a href="mailto:dan@3dbookmark.app" className="font-bold text-emerald-600 hover:text-emerald-700 hover:underline">dan@3dbookmark.app</a>
                </p>
             </div>
        </div>

        {/* Right Column: Controls */}
        <div className="lg:col-span-5 flex flex-col gap-6">
             
             {/* 3D Configuration */}
             <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <div className="flex items-center gap-2 mb-6 border-b border-slate-100 pb-4">
                    <Settings className="text-emerald-600" size={20} />
                    <h2 className="font-bold text-lg">3D Configuration</h2>
                </div>

                <div className="space-y-8">
                    
                    {/* Smoothing Slider */}
                    <div>
                         <div className="flex justify-between mb-2">
                             <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                Style Boldness
                             </label>
                             <span className="text-xs font-bold text-emerald-600">{settings.smoothing === 0 ? 'More Detailed' : settings.smoothing === 5 ? 'Bolder' : 'Balanced'}</span>
                         </div>
                         <input 
                            type="range" min="0" max="5" step="1"
                            value={settings.smoothing}
                            onChange={(e) => setSettings(s => ({...s, smoothing: parseInt(e.target.value)}))}
                            className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                         />
                         <p className="text-[10px] text-slate-400 mt-2 font-medium">Higher smoothness merges small pixels into larger, cleaner blocks of color.</p>
                    </div>

                    {/* Mode Toggle */}
                    <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-100">
                        <span className="text-sm font-bold text-slate-600">3D Texture</span>
                        <div className="flex bg-slate-200 p-1 rounded-lg">
                            <button 
                                onClick={() => setSettings(s => ({...s, isTactile: false}))}
                                className={`px-4 py-1.5 text-[11px] font-black uppercase tracking-wider rounded-md transition-all ${!settings.isTactile ? 'bg-white shadow-sm text-emerald-700' : 'text-slate-500'}`}
                            >
                                Flat
                            </button>
                            <button 
                                onClick={() => setSettings(s => ({...s, isTactile: true}))}
                                className={`px-4 py-1.5 text-[11px] font-black uppercase tracking-wider rounded-md transition-all ${settings.isTactile ? 'bg-white shadow-sm text-emerald-700' : 'text-slate-500'}`}
                            >
                                Tactile
                            </button>
                        </div>
                    </div>

                    {/* Base Height */}
                    <div>
                         <div className="flex justify-between mb-2">
                             <label className="text-sm font-bold text-slate-700">Base Plate Thickness</label>
                             <span className="text-xs font-bold bg-slate-100 px-2 py-1 rounded-lg text-slate-600">{settings.baseHeight}mm</span>
                         </div>
                         <input 
                            type="range" min="0.2" max="2.0" step="0.2"
                            value={settings.baseHeight}
                            onChange={(e) => setSettings(s => ({...s, baseHeight: parseFloat(e.target.value)}))}
                            className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                         />
                    </div>

                    {/* Layer Heights */}
                    {settings.isTactile && (
                        <div className="space-y-4 pt-6 border-t border-slate-100">
                            <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Tactile Depths (mm)</p>
                            {settings.layerHeights.map((h, i) => (
                                <div key={i} className="flex items-center gap-4">
                                    <div className="w-16 text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                                        {i === 0 ? "Slot 1 (Min)" : `Slot ${i+1}`}
                                    </div>
                                    <input 
                                        type="range" min="0.2" max="3.0" step="0.2"
                                        value={h}
                                        onChange={(e) => updateLayerHeight(i, parseFloat(e.target.value))}
                                        className="flex-1 h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                                    />
                                    <span className="w-12 text-xs font-bold text-right text-slate-500">{h}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
             </div>

             {/* Action Buttons */}
             <div className="bg-white p-6 rounded-2xl shadow-xl border border-slate-200">
                <div className="flex flex-col gap-4">
                    <button
                        onClick={handleDownload3MF}
                        disabled={!quantizedData || processing.status !== 'idle'}
                        className={`w-full py-4 rounded-2xl font-black text-white shadow-lg flex items-center justify-center gap-3 transition-all uppercase tracking-widest
                            ${!quantizedData ? 'bg-slate-200 cursor-not-allowed text-slate-400' : 'bg-emerald-600 hover:bg-emerald-700 hover:shadow-emerald-200 hover:translate-y-[-2px] active:translate-y-[0px]'}
                        `}
                    >
                        {processing.status === 'idle' || processing.status === 'done' || processing.status === 'error' ? (
                            <>
                                <Download size={22} /> Download 3MF Project
                            </>
                        ) : (
                            <>
                                <Loader2 className="animate-spin" size={22} /> {processing.message}
                            </>
                        )}
                    </button>
                    
                    <button
                        onClick={handleDownloadSTL}
                        disabled={!quantizedData || processing.status !== 'idle'}
                        className={`w-full py-4 rounded-2xl font-black text-emerald-700 border-2 border-emerald-100 bg-emerald-50 hover:bg-emerald-100 flex items-center justify-center gap-3 transition-all uppercase tracking-widest
                             ${!quantizedData ? 'opacity-30 cursor-not-allowed' : ''}
                        `}
                    >
                        <Download size={20} /> STL Stack (ZIP)
                    </button>
                </div>
                
                {processing.status === 'error' && (
                    <p className="text-red-500 text-[11px] font-bold text-center mt-3 bg-red-50 py-2 rounded-lg">{processing.message}</p>
                )}
                <p className="text-[10px] text-slate-400 font-medium text-center mt-4">
                    Recommended: 3MF maintains layer color assignments automatically.
                </p>
             </div>

             {/* Updates Card */}
             <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                 <div className="flex justify-between items-center mb-4">
                     <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Updates</span>
                     <span className="bg-emerald-50 text-emerald-600 text-[10px] px-2 py-0.5 rounded-full font-bold">v1.5.0</span>
                 </div>
                 <ul className="space-y-3">
                     <li className="flex items-start gap-2 text-xs text-slate-600">
                         <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0"></span>
                         <span><strong className="text-slate-900">Gallery Mode:</strong> Added video guide and print showcase.</span>
                     </li>
                     <li className="flex items-start gap-2 text-xs text-slate-600">
                         <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0"></span>
                         <span><strong className="text-slate-900">Smart 3MF:</strong> Added thumbnails & auto-color assignment.</span>
                     </li>
                     <li className="flex items-start gap-2 text-xs text-slate-600">
                         <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0"></span>
                         <span><strong className="text-slate-900">High Res Engine:</strong> Resolution increased by 60% (8px/mm).</span>
                     </li>
                 </ul>
             </div>

             {/* Support */}
             <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <div className="flex items-center gap-2 mb-4">
                    <Coffee className="text-rose-500" size={20} />
                    <h2 className="font-bold text-lg text-slate-800">Support</h2>
                </div>
                <p className="text-slate-500 text-sm mb-6 leading-relaxed">
                    This tool is free and open-source. If you enjoy using it, a coffee is always appreciated!
                </p>
                <a 
                  href="https://ko-fi.com/danackerman" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="group block w-full bg-[#FF5E5B] hover:bg-[#ff4845] text-white p-4 rounded-xl font-bold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all active:translate-y-0 text-center flex items-center justify-center gap-3"
                >
                  <Coffee size={20} className="group-hover:rotate-12 transition-transform" />
                  <span>Buy me a coffee</span>
                </a>
             </div>

        </div>
      </main>

      {/* New Footer Section: Video & Gallery */}
      <section className="max-w-6xl w-full mt-12 mb-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 items-start">
        
        {/* 1. Showcase */}
        <div className="flex flex-col gap-4">
            <h3 className="font-bold text-xl text-slate-800 flex items-center gap-3">
              <div className="bg-red-600 p-1.5 rounded-lg text-white">
                 <Youtube size={20} fill="currentColor" />
              </div>
              Showcase
            </h3>
            <div className="relative rounded-2xl overflow-hidden shadow-2xl border-4 border-white bg-slate-900 w-full aspect-video group">
                <iframe 
                    className="w-full h-full"
                    src="https://www.youtube.com/embed/xjQbWemTaN0?rel=0" 
                    title="Showcase Video" 
                    frameBorder="0" 
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                    allowFullScreen
                ></iframe>
            </div>
        </div>

        {/* 2. Tutorial */}
        <div className="flex flex-col gap-4">
             <h3 className="font-bold text-xl text-slate-800 flex items-center gap-3">
              <div className="bg-blue-600 p-1.5 rounded-lg text-white">
                 <PlayCircle size={20} />
              </div>
              Tutorial
            </h3>
            <div className="relative rounded-2xl overflow-hidden shadow-2xl border-4 border-white bg-slate-900 w-full aspect-video group">
                <iframe 
                    className="w-full h-full"
                    src="https://www.youtube.com/embed/pfiGALx8F_0?rel=0" 
                    title="Tutorial Video" 
                    frameBorder="0" 
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                    allowFullScreen
                ></iframe>
            </div>
        </div>

        {/* 3. Gallery */}
        <div className="flex flex-col gap-4">
            <h3 className="font-bold text-xl text-slate-800 flex items-center gap-3">
              <div className="bg-indigo-600 p-1.5 rounded-lg text-white">
                 <ImageIcon size={20} />
              </div>
              Gallery
            </h3>
            <div className="relative rounded-2xl overflow-hidden shadow-2xl border-4 border-white bg-slate-100 w-full aspect-video group">
                 {randomGalleryImage ? (
                    <img 
                        src={randomGalleryImage} 
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" 
                        alt="Gallery Print" 
                    />
                 ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300">
                        <Loader2 className="animate-spin" size={32}/>
                    </div>
                 )}
                 <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6 pt-12 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end justify-center">
                    <p className="text-white text-sm font-medium tracking-wide">
                        Printed on Bambu Lab A1 Mini
                    </p>
                 </div>
            </div>
        </div>
      </section>

      {/* Bottom Footer Bar */}
      <footer className="w-full border-t border-slate-200 py-8 text-center bg-white/50">
        <div className="max-w-4xl mx-auto px-4">
            <p className="text-slate-500 text-sm mb-4">
                <strong>Bambu Bookmark Creator</strong> is an open-source tool designed for the Bambu Lab A1, A1 Mini, P1S, and X1C with AMS.
            </p>
            <div className="flex justify-center gap-6 text-sm font-medium text-slate-400">
                 <a href="#" className="hover:text-emerald-600 flex items-center gap-1 transition-colors"><Github size={14}/> GitHub</a>
                 <a href="#" className="hover:text-emerald-600 flex items-center gap-1 transition-colors"><Flag size={14}/> Report Issue</a>
            </div>
        </div>
      </footer>

    </div>
  );
}