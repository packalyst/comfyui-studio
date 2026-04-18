export interface FormInputData {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'image' | 'audio' | 'video' | 'number' | 'slider' | 'select' | 'toggle';
  required: boolean;
  description?: string;
  placeholder?: string;
  default?: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string }[];
  nodeId?: number;
  nodeType?: string;
  mediaType?: string;
}

export interface TemplateData {
  name: string;
  title: string;
  description: string;
  mediaType: string;
  mediaSubtype?: string;
  tags: string[];
  models: string[];
  category: string;
  studioCategory?: 'image' | 'video' | 'audio' | '3d' | 'tools';
  io: {
    inputs: Array<{
      nodeId: number;
      nodeType: string;
      file?: string;
      mediaType: string;
    }>;
    outputs: Array<{
      nodeId: number;
      nodeType: string;
      file: string;
      mediaType: string;
    }>;
  };
  formInputs?: FormInputData[];
  thumbnail: string[];
  thumbnailVariant?: string;
  workflow?: Record<string, unknown>;
  size?: number;
  vram?: number;
  usage?: number;
  openSource?: boolean;
  username?: string;
  date?: string;
  logos?: Array<{ provider: string | string[]; label?: string }>;
  searchRank?: number;
}

// Map ComfyUI template category titles to studio categories
function mapCategory(categoryTitle: string, type: string): 'image' | 'video' | 'audio' | '3d' | 'tools' {
  const title = categoryTitle.toLowerCase();
  if (title.includes('video')) return 'video';
  if (title.includes('audio')) return 'audio';
  if (title.includes('3d')) return '3d';
  if (title.includes('utility') || title.includes('tool')) return 'tools';
  if (title.includes('llm')) return 'tools';
  return 'image';
}

// Generate form inputs from template io.inputs
function generateFormInputs(template: RawTemplate): FormInputData[] {
  const inputs: FormInputData[] = [];

  if (!template.io?.inputs) {
    // No io inputs means text-only (text-to-image, text-to-video, etc.)
    inputs.push({
      id: 'prompt',
      label: 'Prompt',
      type: 'textarea',
      required: true,
      description: template.description,
      placeholder: 'Describe what you want to generate...',
    });
    return inputs;
  }

  // Check if template has text/prompt input (workflows with io.inputs but also needing a prompt)
  // Most image edit / video workflows need both a prompt and image inputs
  const hasImageInput = template.io.inputs.some(i => i.mediaType === 'image');
  const hasAudioInput = template.io.inputs.some(i => i.mediaType === 'audio');
  const hasVideoInput = template.io.inputs.some(i => i.mediaType === 'video');

  // Add prompt field if tags suggest it needs text input
  const needsPrompt = template.tags?.some(t =>
    ['Text to Image', 'Text to Video', 'Text to Audio', 'Image Edit', 'Image to Video',
     'Text to Model', 'Text to Speech', 'Video Edit', 'Style Transfer', 'Inpainting',
     'Outpainting', 'Relight', 'ControlNet', 'Image', 'Video', 'API'].includes(t)
  );

  if (needsPrompt) {
    inputs.push({
      id: 'prompt',
      label: 'Prompt',
      type: 'textarea',
      required: true,
      description: template.description,
      placeholder: 'Describe what you want to generate...',
    });
  }

  // Add inputs based on io.inputs
  template.io.inputs.forEach((input, index) => {
    if (input.mediaType === 'image') {
      inputs.push({
        id: `image_${index}`,
        label: input.file ? cleanFileName(input.file) : `Image ${index + 1}`,
        type: 'image',
        required: true,
        nodeId: input.nodeId,
        nodeType: input.nodeType,
        mediaType: 'image',
      });
    } else if (input.mediaType === 'audio') {
      inputs.push({
        id: `audio_${index}`,
        label: input.file ? cleanFileName(input.file) : `Audio ${index + 1}`,
        type: 'audio',
        required: true,
        nodeId: input.nodeId,
        nodeType: input.nodeType,
        mediaType: 'audio',
      });
    } else if (input.mediaType === 'video') {
      inputs.push({
        id: `video_${index}`,
        label: input.file ? cleanFileName(input.file) : `Video ${index + 1}`,
        type: 'video',
        required: true,
        nodeId: input.nodeId,
        nodeType: input.nodeType,
        mediaType: 'video',
      });
    }
  });

  // If no inputs were generated, add a generic prompt
  if (inputs.length === 0) {
    inputs.push({
      id: 'prompt',
      label: 'Prompt',
      type: 'textarea',
      required: true,
      placeholder: 'Describe what you want to generate...',
    });
  }

  return inputs;
}

function cleanFileName(file: string): string {
  return file
    .replace(/\.[^/.]+$/, '') // remove extension
    .replace(/[_-]/g, ' ')   // replace _ and - with space
    .replace(/\b\w/g, c => c.toUpperCase()); // capitalize words
}

interface RawTemplate {
  name: string;
  title: string;
  description: string;
  mediaType: string;
  mediaSubtype?: string;
  tags?: string[];
  models?: string[];
  date?: string;
  size?: number;
  vram?: number;
  usage?: number;
  openSource?: boolean;
  searchRank?: number;
  username?: string;
  thumbnail?: string[];
  thumbnailVariant?: string;
  logos?: Array<{ provider: string | string[]; label?: string }>;
  io?: {
    inputs?: Array<{
      nodeId: number;
      nodeType: string;
      file?: string;
      mediaType: string;
    }>;
    outputs?: Array<{
      nodeId: number;
      nodeType: string;
      file: string;
      mediaType: string;
    }>;
  };
}

interface RawCategory {
  moduleName: string;
  category: string;
  icon: string;
  title: string;
  type: string;
  isEssential?: boolean;
  templates: RawTemplate[];
}

let cachedTemplates: TemplateData[] = [];

export async function loadTemplatesFromComfyUI(comfyuiUrl: string): Promise<void> {
  try {
    const res = await fetch(`${comfyuiUrl}/templates/index.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const categories: RawCategory[] = await res.json();
    const templates: TemplateData[] = [];

    for (const cat of categories) {
      if (!cat.templates) continue;
      const studioCat = mapCategory(cat.title, cat.type);

      for (const t of cat.templates) {
        templates.push({
          name: t.name,
          title: t.title,
          description: t.description || '',
          mediaType: t.mediaType || 'image',
          mediaSubtype: t.mediaSubtype,
          tags: t.tags || [],
          models: t.models || [],
          category: cat.title,
          studioCategory: studioCat,
          io: {
            inputs: t.io?.inputs || [],
            outputs: t.io?.outputs || [],
          },
          formInputs: generateFormInputs(t),
          thumbnail: t.thumbnail || [],
          thumbnailVariant: t.thumbnailVariant,
          size: t.size || 0,
          vram: t.vram || 0,
          usage: t.usage || 0,
          openSource: t.openSource,
          username: t.username,
          date: t.date,
          logos: t.logos,
          searchRank: t.searchRank,
        });
      }
    }

    cachedTemplates = templates;
    console.log(`Loaded ${templates.length} templates from ComfyUI (${categories.length} categories)`);
  } catch (err) {
    console.error('Failed to load templates from ComfyUI:', err);
    console.log('No templates available - ComfyUI may not be running');
  }
}

export function getTemplates(): TemplateData[] {
  return cachedTemplates;
}

export function getTemplate(name: string): TemplateData | undefined {
  return cachedTemplates.find(t => t.name === name);
}
