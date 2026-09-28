'use client';
import { useEffect, useState } from 'react';
import { Gamepad2, LayoutGrid } from 'lucide-react';
import App from '../client/shell/App.tsx';
import { MotionLab } from '../client/MotionLab.tsx';
import { Designer } from '../controls/designer/Designer.tsx';
import { Gallery } from '../controls/gallery/Gallery.tsx';
import { Preview } from '../controls/preview/Preview.tsx';
import { toolRequest } from './routing.ts';
import './developer-tools.css';

/** This entry is selected by Vite only while serving, never by a build. */
export default function DevelopmentApp() {
  const [tool, setTool] = useState<ReturnType<typeof toolRequest>>(null);
  useEffect(() => {
    queueMicrotask(() => setTool(toolRequest(location.search)));
  }, []);
  if (tool?.page === 'designer') return <Designer layoutId={tool.layout} />;
  if (tool?.page === 'gallery') return <Gallery />;
  if (tool?.page === 'preview') return <Preview layoutId={tool.layout} />;
  return (
    <App
      extensions={{
        homeNavigation: (
          <nav className="tool-links" aria-label="Controller tools">
            <button
              type="button"
              onClick={() => location.assign('/?role=designer')}
            >
              <LayoutGrid /> Layout designer
            </button>
            <button
              type="button"
              onClick={() => location.assign('/?role=gallery')}
            >
              <Gamepad2 /> Controller playground
            </button>
          </nav>
        ),
        controllerPanel: { label: 'Motion lab', Component: MotionLab },
      }}
    />
  );
}
