import { MuseumWorkbench } from '../../../features/studio/museum-workbench';

export default async function MuseumPage({ params }: { params: Promise<{ museumId: string }> }) {
  return <MuseumWorkbench museumId={(await params).museumId} />;
}
