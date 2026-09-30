import { notFound } from 'next/navigation';
import App from '@controlla/app-entry';
import { MAX_SCREENS, ROOM_CODE } from '@/src/shared/room.ts';

/** `/K7QMX/2`: screen 2's QR, so a phone joins it without being asked. */
export default async function ScreenPage({
  params,
}: {
  params: Promise<{ room: string; screen: string }>;
}) {
  const { room, screen } = await params;
  const index = Number(screen);
  if (
    !ROOM_CODE.test(room.toUpperCase()) ||
    !Number.isInteger(index) ||
    index < 1 ||
    index > MAX_SCREENS
  )
    notFound();
  return <App />;
}
