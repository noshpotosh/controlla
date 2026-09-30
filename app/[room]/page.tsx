import { notFound } from 'next/navigation';
import App from '@controlla/app-entry';
import { ROOM_CODE } from '@/src/shared/room.ts';

/** `/K7QMX`: the room invite. Any device opens it; the app picks its role. */
export default async function RoomPage({
  params,
}: {
  params: Promise<{ room: string }>;
}) {
  const { room } = await params;
  if (!ROOM_CODE.test(room.toUpperCase())) notFound();
  return <App />;
}
