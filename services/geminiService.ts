import { GoogleGenAI } from "@google/genai";
import { MODEL_NAMES } from "../constants";

export const generatePattern = async (prompt: string): Promise<string> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key not found");

  const ai = new GoogleGenAI({ apiKey });
  
  const finalPrompt = `Create a bold, high-contrast pop-art bookmark pattern. 
  Theme/Style: ${prompt}. 
  Visual Requirements:
  - POP ART STYLE: Think Lichtenstein or Warhol vibes.
  - COLOR BLOCKS: Use large, solid areas of vibrant color. No gradients.
  - BOLD OUTLINES: Use thick, dark lines to separate shapes.
  - MINIMALISM: Simple, powerful vector shapes. Avoid tiny details or fine textures.
  - COMPOSITION: Vertical orientation (1:3 aspect ratio).
  - COLORS: 4 distinct, highly saturated colors. No pastels or muddy tones.
  - STRICTLY NO: Shadows, photographic elements, dithering, or noise.`;

  const response = await ai.models.generateContent({
    model: MODEL_NAMES.IMAGE_GEN,
    contents: {
        parts: [{ text: finalPrompt }]
    }
  });

  const candidates = response.candidates;
  if (candidates && candidates.length > 0) {
      const parts = candidates[0].content.parts;
      for (const part of parts) {
          if (part.inlineData && part.inlineData.data) {
              return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          }
      }
  }
  
  throw new Error("No image generated");
};