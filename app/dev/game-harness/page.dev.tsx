import { notFound } from 'next/navigation';
import '../../../src/devtools/developer-tools.css';

export default async function GameHarnessPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  const { HarnessPreview } =
    await import('../../../src/experiments/architecture/HarnessPreview.tsx');
  return <HarnessPreview />;
}
