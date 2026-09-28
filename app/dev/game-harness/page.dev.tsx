import { notFound } from 'next/navigation';
import '../../../src/client/devtools/developer-tools.css';

export default async function GameHarnessPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  const { HarnessPreview } =
    await import('../../../src/client/devtools/game-harness/HarnessPreview.tsx');
  return <HarnessPreview />;
}
